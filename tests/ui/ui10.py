# 0.7.0（二）：Ctrl+F 搜索。打开、输入、输入法、Esc 往回退、点结果跳到那一天并打开详情、便签、iCloud 重复课折叠。
import json, datetime, os, warnings
warnings.filterwarnings('ignore')
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = HERE + 'shots/'
os.makedirs(OUT, exist_ok=True)
WP = 'https://local.test/wp.jpg'
now = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)
t = now.date()
day = lambda off: (t + datetime.timedelta(days=off)).isoformat()
NOTE = '牙医电话在冰箱贴上。\n房东微信：zhang_2026\n' + '\n'.join('填充行 %d' % i for i in range(1, 40)) + '\n最后一行有个暗号：蓝鲸'
def todo(i, date, title, **kw):
    d = {'id': i, 'kind': 'todo', 'date': date, 'title': title, 'done': False, 'star': False, 'due': '', 'place': '', 'notes': '', 'subs': []}; d.update(kw); return d
def event(i, date, title, **kw):
    d = {'id': i, 'kind': 'event', 'date': date, 'title': title, 'start': '10:00', 'end': '11:00', 'place': '', 'notes': '', 'subs': [], 'remind': 'none'}; d.update(kw); return d
items = [
    todo('a', day(0), '交西班牙语作业'),
    event('b', day(3), '周会', place='明商208', notes='带笔记本，打印议程'),
    todo('c', '2025-03-02', '准备报税材料', done=True),
    event('d', day(-40), '搬家', subs=[{'id': 's1', 'text': '预约货拉拉', 'done': False}]),
    todo('e', day(1), '<b>粗体</b>标题 & 符号'),
]
def settings(**kw):
    s = {'theme': 'dark', 'tint': 50, 'blur': True, 'carry': False, 'autostart': False, 'top': False, 'sync': {'on': False, 'user': '', 'cals': [], 'target': ''}}
    s.update(kw); return s
ok = True
def check(name, cond, extra=''):
    global ok
    if not cond: ok = False
    print(('PASS ' if cond else 'FAIL ') + name, extra if extra != '' else '')

with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    def page(w=1536, h=960):
        ctx = b.new_context(viewport={'width': w, 'height': h}, screen={'width': w, 'height': h}, timezone_id='Asia/Shanghai')
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.route(WP, lambda r: r.fulfill(path=HERE + 'assets/wallpaper.jpg', headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
        seed = json.dumps({'version': 2, 'items': items, 'note': NOTE, 'settings': settings()})
        pg.add_init_script('window.__SEED = %s; window.__WP = %s;' % (json.dumps(seed), json.dumps(WP)))
        pg.add_init_script(path=HERE + 'mock_cn.js')
        pg.goto('file://' + ROOT + '/src/index.html')
        pg.add_style_tag(content='body{background:url(%s) center/cover no-repeat !important}' % WP)
        pg.wait_for_timeout(900)
        return pg, errs
    pg, errs = page()
    ev = lambda js: pg.evaluate(js)
    # 假装有 iCloud 的每周课（重复日程，只读）：四场，离今天最近的是 3 天前那场
    ev('''(() => { R = [-10, -3, 4, 11].map((off) => { const d = new Date(); d.setDate(d.getDate() + off); const k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      return { id: "r|/cal/A.ics|k" + off, kind: "event", remote: true, href: "/cal/A.ics", recurring: true, cal: "/cal/", calName: "课表", color: "#FFCC00", date: k, start: "10:00", end: "11:30", allDay: false, title: "基础西班牙语3", place: "明商208", notes: "", remind: "none", subs: [], parts: 0 }; }); render(); })()''')
    rows = lambda: ev('[...document.querySelectorAll("#search-list .hit")].map(r => ({ id: r.dataset.id || "", act: r.dataset.act, title: r.querySelector(".pn").textContent, sub: r.querySelector(".ps").textContent, when: (r.querySelector(".pw") || {}).textContent || "", on: r.classList.contains("on") }))')
    is_open = lambda: ev('document.getElementById("search").classList.contains("on")')
    active = lambda: ev('document.activeElement ? document.activeElement.id : ""')
    dp = lambda: ev('window.__dp')

    # ---- 1. 打开 ----
    ev('window.addEventListener("keydown", (e) => { if (e.key === "f") window.__dp = e.defaultPrevented; })')
    check('closed at start', not is_open() and ev('typeof Search === "object"'))
    pg.keyboard.press('Control+f'); pg.wait_for_timeout(500)
    check('Ctrl+F opens search', is_open())
    check('input focused', active() == 'search-input', active())
    check('browser find prevented', dp() is True, dp())
    check('widget layer hidden under it', not ev('document.getElementById("widget").classList.contains("on")'))
    check('empty query: no rows, no text', rows() == [] and ev('document.getElementById("search-list").textContent.trim()') == '')
    pg.screenshot(path=OUT + 'v7-search-empty.png', clip={'x': 1140, 'y': 0, 'width': 396, 'height': 420})

    # ---- 2. 输入、结果 ----
    pg.keyboard.type('西班牙语'); pg.wait_for_timeout(200)
    r = rows()
    check('results for 西班牙语 (local todo + one collapsed class)', len(r) == 2, r)
    check('collapsed class is the nearest one', ev('S.date') and any(x['id'] == 'r|/cal/A.ics|k-3' for x in r), r)
    check('highlight marks', ev('document.querySelectorAll("#search-list .hit mark").length') >= 2)
    check('first row active by default', r and r[0]['on'] and not r[1]['on'], r)
    pg.keyboard.press('Control+a'); pg.keyboard.type('报税'); pg.wait_for_timeout(200)
    r = rows()
    check('old done todo found, year shown', len(r) == 1 and '2025年3月2日' in r[0]['when'] and r[0]['id'] == 'c', r)
    pg.keyboard.press('Control+a'); pg.keyboard.type('货拉拉'); pg.wait_for_timeout(200)
    r = rows()
    check('sub-task match shows field + snippet', len(r) == 1 and r[0]['id'] == 'd' and r[0]['sub'].startswith('子任务：') and '预约货拉拉' in r[0]['sub'], r)
    pg.keyboard.press('Control+a'); pg.keyboard.type('笔记本'); pg.wait_for_timeout(200)
    r = rows()
    check('notes match', len(r) == 1 and r[0]['id'] == 'b' and r[0]['sub'].startswith('备注：'), r)
    pg.keyboard.press('Control+a'); pg.keyboard.type('明商 周会'); pg.wait_for_timeout(200)
    check('AND across words/fields', [x['id'] for x in rows()] == ['b'], rows())
    pg.keyboard.press('Control+a'); pg.keyboard.type('粗体'); pg.wait_for_timeout(200)
    check('html in title is text, not markup', ev('document.querySelector("#search-list .hit .pn").textContent') == '<b>粗体</b>标题 & 符号' and ev('document.querySelectorAll("#search-list .hit .pn b").length') == 0)
    pg.keyboard.press('Control+a'); pg.keyboard.type('完全没有的词'); pg.wait_for_timeout(200)
    check('no result: short text only', rows() == [] and ev('document.getElementById("search-list").textContent.trim()') == '没有找到', ev('document.getElementById("search-list").textContent'))

    # ---- 3. 输入法：组字中不搜、不吞 Enter / Esc ----
    pg.keyboard.press('Control+a'); pg.keyboard.type('周会'); pg.wait_for_timeout(200)
    check('before IME: 周会 found', [x['id'] for x in rows()] == ['b'])
    ev('''(() => { const i = document.getElementById('search-input'); i.focus(); window.__ime = []; i.addEventListener('keydown', (e) => window.__ime.push(e.key + ':' + e.defaultPrevented));
      i.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      i.value = '西 yu'; i.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' })); })()''')
    pg.wait_for_timeout(200)
    check('IME composing: results not touched', [x['id'] for x in rows()] == ['b'], rows())
    ev('''(() => { const i = document.getElementById('search-input');
      for (const key of ['Enter', 'Escape', 'ArrowDown']) i.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: true, keyCode: 229 })); })()''')
    pg.wait_for_timeout(200)
    check('IME composing: Enter / Esc / arrows are ignored', is_open() and ev('S.panel') == '' and ev('document.getElementById("search-input").value') == '西 yu', [is_open(), ev('S.panel')])
    ev('''(() => { const i = document.getElementById('search-input'); i.value = '西班牙语'; i.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '西班牙语' })); })()''')
    pg.wait_for_timeout(200)
    check('IME commit: searches the final text', len(rows()) == 2 and ev('document.getElementById("search-input").value') == '西班牙语', rows())

    # ---- 4. 方向键、回车 ----
    pg.keyboard.press('ArrowDown'); pg.wait_for_timeout(100)
    r = rows(); check('ArrowDown moves the highlight', r[1]['on'] and not r[0]['on'], r)
    pg.keyboard.press('ArrowUp'); pg.keyboard.press('ArrowUp'); pg.wait_for_timeout(100)
    r = rows(); check('ArrowUp stops at the first', r[0]['on'], r)
    pg.keyboard.press('ArrowDown'); pg.keyboard.press('Enter'); pg.wait_for_timeout(600)
    first = r[1]['id']
    check('Enter opens the highlighted result', not is_open() and ev('S.sel') == first and ev('S.panel') == 'detail', [ev('S.sel'), first])
    check('jumped to that day, day view', ev('S.date') == ev('find(S.sel).date') and ev('S.mode') == 'day')
    check('detail panel shows the item', ev('document.getElementById("panel").classList.contains("on")') and ev('document.getElementById("p-title").value') in ('交西班牙语作业', '基础西班牙语3'))
    pg.screenshot(path=OUT + 'v7-search-jump.png', clip={'x': 760, 'y': 0, 'width': 776, 'height': 700})

    # ---- 5. Esc 一层一层退 ----
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check('Esc closes the detail', ev('S.panel') == '' and ev('S.sel') is None)
    # 从折叠日历打开搜索：Esc 退回折叠日历（不是别的地方）
    ev('S.mode = "cal"; render()'); pg.wait_for_timeout(300)
    pg.keyboard.press('Control+f'); pg.wait_for_timeout(500)
    check('search over cal mode: card is full height', is_open() and ev('document.getElementById("shell").offsetHeight') > 600, ev('document.getElementById("shell").offsetHeight'))
    pg.keyboard.type('周会'); pg.wait_for_timeout(150)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(600)
    check('Esc back to cal mode', not is_open() and ev('S.mode') == 'cal' and ev('document.getElementById("cal").classList.contains("on")'))
    check('cal card shrinks back', ev('document.getElementById("shell").offsetHeight') < 700, ev('document.getElementById("shell").offsetHeight'))
    ev('S.mode = "day"; render()')
    # 从详情打开搜索：详情先收起；Esc 只关搜索
    ev('openDetail("a", false)'); pg.wait_for_timeout(300)
    pg.keyboard.press('Control+f'); pg.wait_for_timeout(500)
    check('opening search closes the detail', is_open() and ev('S.panel') == '' and not ev('document.getElementById("panel").classList.contains("on")'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    check('Esc closes only the search', not is_open() and ev('S.mode') == 'day')
    # 关闭按钮、再按 Ctrl+F 保留上次的词并全选
    pg.keyboard.press('Control+f'); pg.wait_for_timeout(300); pg.keyboard.type('周会'); pg.wait_for_timeout(100)
    pg.click('[data-act=search-close]'); pg.wait_for_timeout(400)
    check('close button works', not is_open())
    pg.keyboard.press('Control+f'); pg.wait_for_timeout(400)
    check('reopen keeps last query, selected', ev('document.getElementById("search-input").value') == '周会' and ev('document.getElementById("search-input").selectionEnd - document.getElementById("search-input").selectionStart') == 2 and len(rows()) == 1)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # ---- 6. 点结果；便签 ----
    pg.keyboard.press('Control+f'); pg.wait_for_timeout(300); pg.keyboard.press('Control+a'); pg.keyboard.type('搬家'); pg.wait_for_timeout(200)
    pg.click('#search-list .hit'); pg.wait_for_timeout(600)
    check('click result: that day (40 days ago) + detail', ev('S.date') == day(-40) and ev('S.sel') == 'd' and ev('S.panel') == 'detail', [ev('S.date'), ev('S.sel')])
    ev('closePanels()')
    pg.keyboard.press('Control+f'); pg.wait_for_timeout(300); pg.keyboard.press('Control+a'); pg.keyboard.type('蓝鲸'); pg.wait_for_timeout(200)
    r = rows()
    check('note row', len(r) == 1 and r[0]['act'] == 'hit-note' and r[0]['title'] == '便签' and '蓝鲸' in r[0]['sub'], r)
    ev('S.settings.fold.note = true; S.mode = "cal"; render()')
    pg.click('#search-list .hit'); pg.wait_for_timeout(700)
    sel = ev('(() => { const n = document.getElementById("note"); return [n.value.slice(n.selectionStart, n.selectionEnd), document.activeElement === n, n.scrollTop > 0, S.mode, S.settings.fold.note]; })()')
    check('note: unfolded, day view, match selected and scrolled into view', sel == ['蓝鲸', True, True, 'day', False], sel)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)

    # ---- 7. 月视图里搜索 ----
    ev('S.date = "%s"; S.vm = null; S.mode = "cal"; render()' % day(0)); pg.wait_for_timeout(200)
    pg.click('[data-act=big-open]'); pg.wait_for_timeout(700)
    pg.keyboard.press('Control+f'); pg.wait_for_timeout(500)
    check('big: search keeps the 768 card', is_open() and ev('document.getElementById("shell").offsetWidth') == 768, ev('document.getElementById("shell").offsetWidth'))
    pg.keyboard.type('搬家'); pg.wait_for_timeout(150)
    pg.screenshot(path=OUT + 'v7-search-big.png', clip={'x': 744, 'y': 0, 'width': 792, 'height': 700})
    pg.keyboard.press('Enter'); pg.wait_for_timeout(700)
    check('big: jump shows that month and opens the bubble', ev('S.big') is True and ev('S.vm.m') == ev('fromIso("%s").getMonth()' % day(-40)) and ev('S.panel') == 'detail' and ev('S.sel') == 'd')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.keyboard.press('Control+f'); pg.wait_for_timeout(400)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    check('big: Esc from search stays in big', ev('S.big') is True and not is_open())
    ev('onAct("big-close", document.body)'); pg.wait_for_timeout(500)

    # ---- 8. 迷你条：展开来搜，Esc 再收回去 ----
    pg.click('[data-act=compact]'); pg.wait_for_timeout(700)
    check('compact card before', ev('S.compact') == 'card')
    pg.keyboard.press('Control+f'); pg.wait_for_timeout(700)
    check('Ctrl+F on the mini card expands it', is_open() and ev('S.compact') == '' and ev('document.getElementById("shell").offsetHeight') > 600)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(700)
    check('Esc puts the mini card back', not is_open() and ev('S.compact') == 'card')
    ev('onAct("expand", document.body)'); pg.wait_for_timeout(500)

    # ---- 9. 不抢别的快捷键 ----
    pg.keyboard.press('Control+g'); pg.wait_for_timeout(100)
    check('other Ctrl keys do nothing', not is_open())
    pg.keyboard.press('Control+Shift+f'); pg.wait_for_timeout(100)
    check('Ctrl+Shift+F does nothing', not is_open())
    ev('document.getElementById("quick-input").focus()')
    pg.keyboard.press('Control+f'); pg.wait_for_timeout(300)
    check('works while typing in another box', is_open() and active() == 'search-input')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    ev('window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, isComposing: true, keyCode: 229, bubbles: true, cancelable: true }))'); pg.wait_for_timeout(200)
    check('Ctrl+F during IME composition is ignored', not is_open())
    check('no page errors', not errs, errs)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
raise SystemExit(0 if ok else 1)
