# 0.7.0（三）：顶部倒数日条。详情里的开关、最多 3 个胶囊、没有倒数日时不占位置、长标题只截标题、iCloud 日程的标记存在本机。
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
def todo(i, date, title, **kw):
    d = {'id': i, 'kind': 'todo', 'date': date, 'title': title, 'done': False, 'star': False, 'due': '', 'place': '', 'notes': '', 'subs': []}; d.update(kw); return d
def event(i, date, title, **kw):
    d = {'id': i, 'kind': 'event', 'date': date, 'title': title, 'start': '10:00', 'end': '11:00', 'place': '', 'notes': '', 'subs': [], 'remind': 'none'}; d.update(kw); return d
LONG = '一个特别特别特别特别特别特别特别特别特别特别特别特别特别特别长的考试名称'
def items(flags=True):
    return [
        event('e1', day(83), '西语期末考试', countdown=flags),   # 第四近，不显示
        todo('t1', day(10), '交论文', countdown=flags),
        event('e2', day(3), '体检', countdown=flags),
        event('e3', day(30), '旅行', countdown=flags),
        event('old', day(-1), '昨天的', countdown=flags),         # 已过去，不显示
        todo('done', day(1), '做完了的', countdown=flags, done=True),  # 完成了，不显示
        event('plain', day(2), '普通日程'),
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
    def page(its, note='', w=1536, h=960):
        ctx = b.new_context(viewport={'width': w, 'height': h}, screen={'width': w, 'height': h}, timezone_id='Asia/Shanghai')
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.route(WP, lambda r: r.fulfill(path=HERE + 'assets/wallpaper.jpg', headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
        seed = json.dumps({'version': 2, 'items': its, 'note': note, 'settings': settings()})
        pg.add_init_script('window.__SEED = %s; window.__WP = %s;' % (json.dumps(seed), json.dumps(WP)))
        pg.add_init_script(path=HERE + 'mock_cn.js')
        pg.goto('file://' + ROOT + '/src/index.html')
        pg.add_style_tag(content='body{background:url(%s) center/cover no-repeat !important}' % WP)
        pg.wait_for_timeout(900)
        return pg, errs
    # ---- 1. 没有倒数日：完全不占位置、没有任何字 ----
    pg, errs = page(items(False))
    ev = lambda js: pg.evaluate(js)
    geo = lambda: ev('''(() => { const q = (s) => document.querySelector(s).getBoundingClientRect(); const bar = document.getElementById('countdowns');
      return { gap: Math.round(q('.views').top - q('#widget header').bottom), barH: bar.offsetHeight, barHidden: bar.hidden, text: bar.textContent.trim(), views: Math.round(q('.views').height) }; })()''')
    g0 = geo()
    check('no countdown: bar hidden, no height, no text', g0['barHidden'] and g0['barH'] == 0 and g0['text'] == '', g0)
    check('no countdown: layout same as before (12px gap)', g0['gap'] == 12, g0)
    pg.screenshot(path=OUT + 'v7-cd-none.png', clip={'x': 1140, 'y': 0, 'width': 396, 'height': 300})

    # ---- 2. 详情里的开关 ----
    ev('openDetail("plain", false)'); pg.wait_for_timeout(400)
    vis = lambda sel: ev('(() => { const e = document.querySelector(%s); return !!e && !e.hidden && getComputedStyle(e).display !== "none"; })()' % json.dumps(sel))
    check('event detail: toggle row shows only 倒数日', vis('#p-toggles') and vis('#p-count') and not vis('#p-done') and not vis('#p-star'))
    check('toggle label and state', ev('document.getElementById("p-count").textContent') == '倒数日' and ev('document.getElementById("p-count").getAttribute("aria-pressed")') == 'false')
    pg.click('#p-count'); pg.wait_for_timeout(300)
    check('toggle on: pressed + saved on the item', ev('document.getElementById("p-count").getAttribute("aria-pressed")') == 'true' and ev('S.items.find(x => x.id === "plain").countdown') is True)
    check('toggle on: pill appears', ev('[...document.querySelectorAll("#countdowns .cd")].map(x => x.dataset.id)') == ['plain'], ev('[...document.querySelectorAll("#countdowns .cd")].map(x => x.dataset.id)'))
    check('bar not hidden now', not ev('document.getElementById("countdowns").hidden'))
    pg.click('#p-count'); pg.wait_for_timeout(300)
    check('toggle off: pill gone, bar hidden again', ev('document.getElementById("countdowns").hidden') and ev('S.items.find(x => x.id === "plain").countdown') is False and geo()['barH'] == 0 and geo()['gap'] == 12, geo())
    ev('closePanels()')
    ev('openDetail("t1", false)'); pg.wait_for_timeout(400)
    check('todo detail: 完成 / 重点 / 倒数日 all there', vis('#p-done') and vis('#p-star') and vis('#p-count'))
    ev('closePanels()')

    # ---- 3. 有倒数日：最多 3 个，按近到远 ----
    pg, errs = page(items(True))
    ev = lambda js: pg.evaluate(js)
    pills = lambda: ev('[...document.querySelectorAll("#countdowns .cd")].map(x => ({ id: x.dataset.id, text: x.textContent.replace(/\\s+/g, " ").trim(), aria: x.getAttribute("aria-label"), tag: x.tagName }))')
    r = pills()
    check('three pills, nearest first', [x['id'] for x in r] == ['e2', 't1', 'e3'], r)
    check('text: 距 X 还有 N 天', [x['text'] for x in r] == ['距 体检 还有 3 天', '距 交论文 还有 10 天', '距 旅行 还有 30 天'], r)
    check('buttons with full aria-label', all(x['tag'] == 'BUTTON' and x['aria'] == x['text'] for x in r), r)
    check('not shown: 4th, past, done', not any(x['id'] in ('e1', 'old', 'done') for x in r))
    g = ev('''(() => { const bar = document.getElementById('countdowns'), b = bar.getBoundingClientRect(), h = document.querySelector('#widget header').getBoundingClientRect(), v = document.querySelector('.views').getBoundingClientRect();
      const ps = [...bar.querySelectorAll('.cd')].map(x => x.getBoundingClientRect());
      return { barH: Math.round(b.height), above: Math.round(b.top - h.bottom), below: Math.round(v.top - b.bottom), over: bar.scrollWidth > bar.clientWidth, w: Math.round(b.width), right: Math.round(Math.max(...ps.map(x => x.right))), barRight: Math.round(b.right), maxH: Math.round(Math.max(...ps.map(x => x.height))) }; })()''')
    check('bar is slim (at most two rows) and sits between header and list', g['barH'] <= 48 and g['above'] == 12 and g['below'] == 12 and not g['over'] and g['right'] <= g['barRight'], g)
    q = ev('''[...document.querySelectorAll('#countdowns .cd')].map(x => { const t = x.querySelector('.cd-title'), tail = x.querySelector('.cd-tail'), r = x.getBoundingClientRect();
      return { clipped: t.scrollWidth > t.clientWidth + 1, tailIn: tail.getBoundingClientRect().right <= r.right + 0.5, titleW: Math.round(t.getBoundingClientRect().width), l: r.left, r: r.right, t: r.top, b: r.bottom }; })''')
    check('short titles are fully readable (not squeezed)', all(not x['clipped'] and x['tailIn'] and x['titleW'] >= 20 for x in q), q)
    overlap = [[i, j] for i in range(len(q)) for j in range(i + 1, len(q)) if q[i]['l'] < q[j]['r'] - 0.5 and q[j]['l'] < q[i]['r'] - 0.5 and q[i]['t'] < q[j]['b'] - 0.5 and q[j]['t'] < q[i]['b'] - 0.5]
    check('pills do not overlap', not overlap, overlap)
    pg.screenshot(path=OUT + 'v7-cd-three.png', clip={'x': 1140, 'y': 0, 'width': 396, 'height': 420})
    # 点胶囊：跳到那一天，打开详情
    pg.click('#countdowns .cd[data-id=t1]'); pg.wait_for_timeout(500)
    check('click pill: jump to the day + open detail', ev('S.date') == day(10) and ev('S.sel') == 't1' and ev('S.panel') == 'detail', [ev('S.date'), ev('S.sel')])
    ev('closePanels()')

    # ---- 4. 长标题：只截标题，“还有 N 天”完整 ----
    pg, errs = page([event('long', day(5), LONG, countdown=True), event('b', day(6), '体检', countdown=True), todo('c', day(0), '今天截止的事', countdown=True)])
    ev = lambda js: pg.evaluate(js)
    d = ev('''[...document.querySelectorAll('#countdowns .cd')].map(x => { const t = x.querySelector('.cd-title'), tail = x.querySelector('.cd-tail'), xr = x.getBoundingClientRect(), tr = tail.getBoundingClientRect();
      return { id: x.dataset.id, clipped: t.scrollWidth > t.clientWidth + 1, tailIn: tr.right <= xr.right + 0.5 && tail.scrollWidth <= tail.clientWidth + 1, text: x.textContent.replace(/\\s+/g, ' ').trim(), titleW: Math.round(t.getBoundingClientRect().width) }; })''')
    byid = {x['id']: x for x in d}
    check('long title is ellipsized, tail intact', byid['long']['clipped'] and byid['long']['tailIn'], byid['long'])
    check('short titles untouched', not byid['b']['clipped'] and byid['b']['tailIn'] and byid['b']['titleW'] >= 20, byid['b'])
    check('today: X 今天', byid['c']['text'] == '今天截止的事 今天', byid['c'])
    check('long pills fit in the bar', ev('(() => { const bar = document.getElementById("countdowns"); return bar.scrollWidth <= bar.clientWidth + 1; })()'))
    pg.screenshot(path=OUT + 'v7-cd-long.png', clip={'x': 1140, 'y': 0, 'width': 396, 'height': 300})

    # ---- 5. 折叠日历：卡片高度要把倒数日条算进去，底下的输入框不被切掉 ----
    pg, errs = page(items(False))
    ev = lambda js: pg.evaluate(js)
    ev('S.mode = "cal"; render()'); pg.wait_for_timeout(600)
    clip = lambda: ev('(() => { const s = document.getElementById("shell").getBoundingClientRect(), q = document.getElementById("quick").getBoundingClientRect(); return [Math.round(s.height), Math.round(s.bottom - q.bottom)]; })()')
    h0, room0 = clip()
    check('cal without bar: quick box inside the card', room0 >= 18, [h0, room0])
    ev('S.items.find(x => x.id === "e2").countdown = true; render()'); pg.wait_for_timeout(700)
    h1, room1 = clip()
    check('cal with bar: card grows by the bar, quick box still inside', h1 > h0 and h1 - h0 == ev('document.getElementById("countdowns").offsetHeight') + 12 and room1 == room0, [h0, h1, room0, room1])
    ev('S.items.find(x => x.id === "e2").countdown = false; render()'); pg.wait_for_timeout(700)
    check('cal: back to the original height', clip()[0] == h0, clip())

    # ---- 6. iCloud 日程：标记存在本机，不写回 iCloud ----
    pg, errs = page(items(False))
    ev = lambda js: pg.evaluate(js)
    ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:X1\r\nDTSTART;TZID=Asia/Shanghai:' + day(7).replace('-', '') + 'T090000\r\nDTEND;TZID=Asia/Shanghai:' + day(7).replace('-', '') + 'T100000\r\nSUMMARY:iCloud 里的面试\r\nEND:VEVENT\r\nEND:VCALENDAR'
    ev('''(() => { S.settings.sync = { on: true, user: "me@icloud.com", cals: [{ href: "/cal/", name: "个人", color: "#1BADF8", on: true }], target: "" };
      S.remote = { res: { "/cal/X1.ics": { etag: '"e1"', ics: %s, cal: "/cal/" } }, at: Date.now() }; rebuildRemote(); render(); })()''' % json.dumps(ics))
    check('remote event is in R', ev('R.some(x => x.id === "r|/cal/X1.ics")'), ev('R.map(x => x.id)'))
    dav0 = ev('window.__log.dav.length')
    ev('openDetail("r|/cal/X1.ics", false)'); pg.wait_for_timeout(400)
    check('remote detail shows the toggle', vis('#p-count') and not vis('#p-done') and not vis('#p-star'))
    pg.click('#p-count'); pg.wait_for_timeout(400)
    check('remote: flag stored in extras', ev('S.extras["r|/cal/X1.ics"] && S.extras["r|/cal/X1.ics"].countdown') is True, ev('JSON.stringify(S.extras)'))
    check('remote: pill appears', ev('[...document.querySelectorAll("#countdowns .cd")].map(x => x.dataset.id)') == ['r|/cal/X1.ics'])
    check('remote: not marked dirty, nothing sent to iCloud', ev('S.remote.res["/cal/X1.ics"].dirty') in (None, False) and ev('window.__log.dav.length') == dav0, [ev('S.remote.res["/cal/X1.ics"].dirty'), ev('window.__log.dav.length'), dav0])
    ev('rebuildRemote(); render()'); pg.wait_for_timeout(200)
    check('remote: survives rebuild (copied from extras)', ev('R.find(x => x.id === "r|/cal/X1.ics").countdown') is True and ev('document.querySelectorAll("#countdowns .cd").length') == 1)
    check('remote: saved to disk with the extras', ev('JSON.parse(window.__stored).extras["r|/cal/X1.ics"].countdown') is True)
    pg.click('#p-count'); pg.wait_for_timeout(300)
    check('remote: toggle off clears it', ev('document.querySelectorAll("#countdowns .cd").length') == 0 and ev('document.getElementById("countdowns").hidden'))
    ev('closePanels()')

    # ---- 7. 走真实流程：发现日历 → 选目标日历 → 本机日程上传 → 再同步一次，子任务和倒数日标记都还在 ----
    local = items(False)
    local[-1].update({'countdown': True, 'subs': [{'id': 's1', 'text': '带证件', 'done': False}]})  # plain
    sync_on = {'on': True, 'user': 'me@icloud.com', 'cals': [], 'target': ''}
    pg, errs = page(local)
    ev = lambda js: pg.evaluate(js)
    ev('S.settings.sync = %s; syncNow(true)' % json.dumps(sync_on)); pg.wait_for_timeout(1500)
    ev('''(() => { const c = S.settings.sync.cals.find(c => c.name === "个人"); S.settings.sync.target = c.href; S.items.find(x => x.id === "plain").cal = c.href; })()''')
    ev('uploadPending()'); pg.wait_for_timeout(1200)
    mine = 'R.filter(x => x.title === "普通日程").map(x => [x.subs.length, !!x.countdown])'
    check('uploaded: sub-task and flag carried, local copy gone', ev(mine) == [[1, True]] and not ev('S.items.some(x => x.id === "plain")'), ev(mine))
    check('uploaded: pill shows', ev('[...document.querySelectorAll("#countdowns .cd")].some(x => x.textContent.indexOf("普通日程") >= 0)'))
    ev('syncNow(false)'); pg.wait_for_timeout(1500)
    check('after the next sync: still there (address form matches)', ev(mine) == [[1, True]], ev(mine))
    check('after the next sync: pill still shows', ev('[...document.querySelectorAll("#countdowns .cd")].some(x => x.textContent.indexOf("普通日程") >= 0)'))
    check('no page errors', not errs, errs)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
raise SystemExit(0 if ok else 1)
