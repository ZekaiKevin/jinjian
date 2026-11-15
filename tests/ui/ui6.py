import json, datetime, warnings
warnings.filterwarnings('ignore')
from playwright.sync_api import sync_playwright
import os
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
WP = 'https://local.test/wp.jpg'
BASE = HERE
OUT = BASE + 'shots/'
os.makedirs(OUT, exist_ok=True)
now = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
t = now.date(); T = t.isoformat()
Y = (t - datetime.timedelta(days=1)).isoformat(); Y3 = (t - datetime.timedelta(days=3)).isoformat(); M = (t + datetime.timedelta(days=1)).isoformat()
def hm(dt): return dt.strftime('%H:%M')
soon = now + datetime.timedelta(minutes=5)
items = [
 {'id':'a','kind':'todo','date':T,'title':'交西语作业','done':False,'star':True,'due':'','place':'','notes':'','subs':[]},
 {'id':'old1','kind':'todo','date':Y,'title':'昨天没做完','done':False,'star':False,'due':'','place':'','notes':'','subs':[]},
 {'id':'old2','kind':'todo','date':Y3,'title':'三天前没做完','done':False,'star':False,'due':'','place':'','notes':'','subs':[]},
 {'id':'old3','kind':'todo','date':Y,'title':'昨天做完了','done':True,'star':False,'due':'','place':'','notes':'','subs':[]},
 {'id':'e2','kind':'event','date':M,'title':'明天的课','start':'10:00','end':'11:00','place':'','notes':'','subs':[],'remind':'10'},
]
if soon.date() == t:
    items.append({'id':'e1','kind':'event','date':T,'title':'马上开会','start':hm(soon),'end':hm(soon + datetime.timedelta(minutes=30)),'place':'','notes':'','subs':[],'remind':'10'})
def settings(**kw):
    s = {'theme':'dark','tint':50,'blur':True,'carry':False,'autostart':False,'top':False,'sync':{'on':False,'user':'','cals':[],'target':''}}
    s.update(kw); return s
ok = True
def check(name, cond, extra=''):
    global ok
    if not cond: ok = False
    print(('PASS ' if cond else 'FAIL ') + name, extra if extra != '' else '')
with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    def page(w, h, its=items, **kw):
        ctx = b.new_context(viewport={'width': w, 'height': h}, screen={'width': w, 'height': h}, timezone_id='Asia/Shanghai')
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.route(WP, lambda r: r.fulfill(path=BASE + 'assets/wallpaper.jpg', headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
        seed = json.dumps({'version':2,'items':its,'note':'牙医电话在冰箱贴上。','settings':settings(**kw)})
        pg.add_init_script('window.__SEED = %s; window.__WP = %s;' % (json.dumps(seed), json.dumps(WP)))
        pg.add_init_script(path=HERE + 'mock_cn.js')
        pg.goto('file://' + ROOT + '/src/index.html')
        pg.add_style_tag(content='body{background:url(%s) center/cover no-repeat !important}' % WP)
        pg.wait_for_timeout(1200)
        return pg, errs
    pg, errs = page(1536, 960)
    ev = lambda js: pg.evaluate(js)
    box = lambda sel: ev('(() => { const r = document.querySelector(%s).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; })()' % json.dumps(sel))

    # ---- 2. 今天也能翻 ----
    hd = ev('''(() => { const w = document.getElementById('widget').getBoundingClientRect(); const items = [...document.querySelectorAll('#widget header > *')].filter(e => e.offsetWidth).map(e => e.getBoundingClientRect());
      let overlap = false; for (let i = 1; i < items.length; i++) if (items[i].left < items[i-1].right - 0.5) overlap = true;
      return { overlap, right: Math.round(w.right - 20 - items[items.length-1].right), step: !document.getElementById('day-step').hidden }; })()''')
    check('header: arrows shown on today, nothing overlaps', hd['step'] and not hd['overlap'] and hd['right'] >= 0, hd)
    pg.click('#day-step [data-act=day-next]'); pg.wait_for_timeout(400)
    check('header › from today → tomorrow, bottom row shows', ev('S.date') == M and not ev('document.getElementById("day-nav").hidden'))
    pg.click('#day-step [data-act=day-prev]'); pg.wait_for_timeout(400)
    check('header ‹ back to today → row gone', ev('S.date') == T and ev('document.getElementById("day-nav").hidden'))
    pg.click('#day-step [data-act=day-prev]'); pg.wait_for_timeout(400)
    check('header ‹ from today → yesterday', ev('S.date') == Y)
    pg.click('#day-nav [data-act=go-today]'); pg.wait_for_timeout(300)
    pg.click('#b-view'); pg.wait_for_timeout(400)
    check('arrows hidden in calendar mode', ev('document.getElementById("day-step").hidden'))
    pg.click('#b-view'); pg.wait_for_timeout(400)
    pg.screenshot(path=OUT + 'v51-header.png', clip={'x': 1140, 'y': 0, 'width': 396, 'height': 120})

    # ---- 7a. 关了顺延：之前没做完的提示 ----
    check('overdue hint on today', ev('(document.querySelector("#todos .overdue") || {}).textContent') == '2 项之前没做完移到今天')
    pg.screenshot(path=OUT + 'v51-overdue.png', clip={'x': 1140, 'y': 280, 'width': 396, 'height': 300})
    pg.click('#day-step [data-act=day-next]'); pg.wait_for_timeout(300)
    check('no hint on other days', ev('!document.querySelector("#todos .overdue")'))
    pg.click('#day-nav [data-act=go-today]'); pg.wait_for_timeout(300)
    pg.click('[data-act=carry-now]'); pg.wait_for_timeout(400)
    check('carry-now moves only unfinished past todos', ev('S.items.filter(x => x.date === S.date && x.kind === "todo").map(x => x.id).sort().join()') == 'a,old1,old2' and ev('S.items.find(x => x.id === "old3").date') == Y and ev('!document.querySelector("#todos .overdue")'))

    # ---- 3. 没有日程不占空白 ----
    has_ev = soon.date() == t
    h = ev('Math.round(document.getElementById("sec-ev").getBoundingClientRect().height)')
    check('events section height fits content', (h >= 104) if has_ev else (h <= 32), h)
    pg.click('#day-step [data-act=day-prev]'); pg.wait_for_timeout(400)
    h2 = ev('Math.round(document.getElementById("sec-ev").getBoundingClientRect().height)')
    check('empty day: events section shrinks to header', h2 <= 32, h2)
    pg.screenshot(path=OUT + 'v51-empty.png', clip={'x': 1140, 'y': 0, 'width': 396, 'height': 520})
    pg.click('#day-nav [data-act=go-today]'); pg.wait_for_timeout(300)

    # ---- 7c. 改晚了还会再提醒 ----
    if has_ev:
        ev('checkReminders()')
        n1 = ev('window.__log.notify.length')
        ev('checkReminders()')
        n2 = ev('window.__log.notify.length')
        later = hm(soon + datetime.timedelta(minutes=3))
        ev('(() => { const it = S.items.find(x => x.id === "e1"); updateItem(it, { start: %s }); checkReminders(); })()' % json.dumps(later))
        n3 = ev('window.__log.notify.length')
        check('reminder once, again after moving later', (n1, n2, n3) == (1, 1, 2), (n1, n2, n3))
    else:
        print('SKIP reminder test (too close to midnight)')
    # 待办截止时间
    ev('(() => { const it = S.items.find(x => x.id === "a"); updateItem(it, { due: %s }); checkReminders(); })()' % json.dumps(hm(now - datetime.timedelta(minutes=1))))
    d1 = ev('window.__log.notify.length')
    ev('(() => { const it = S.items.find(x => x.id === "a"); updateItem(it, { due: %s }); checkReminders(); })()' % json.dumps(hm(now)))
    d2 = ev('window.__log.notify.length')
    check('todo due re-notifies after change', d2 == d1 + 1 and now.hour * 60 + now.minute >= 1, (d1, d2))

    # ---- 7b. 新建后先转类型再关 ----
    n0 = ev('S.items.length')
    pg.click('[data-act=add-event]'); pg.wait_for_timeout(300); pg.click('#p-kind'); pg.wait_for_timeout(200)
    check('converted draft still a draft', ev('find(S.sel).kind') == 'todo' and ev('!!find(S.sel).draft'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check('empty converted draft removed', ev('S.items.length') == n0)
    pg.click('[data-act=add-todo]'); pg.wait_for_timeout(300); pg.keyboard.type('写周报'); pg.click('#p-kind'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check('typed draft kept', ev('S.items.length') == n0 + 1 and ev('S.items[S.items.length-1].title') == '写周报' and ev('!S.items[S.items.length-1].draft'))

    # ---- 6. 点空白处收起 ----
    pg.click('#todos .td .open'); pg.wait_for_timeout(400)
    sp = box('#widget header > .grow')
    pg.mouse.click((sp[0] + sp[2]) / 2, (sp[1] + sp[3]) / 2); pg.wait_for_timeout(400)
    check('blank in header closes detail', ev('S.panel') == '')
    pg.click('#todos .td .open'); pg.wait_for_timeout(500)
    pb = box('#panel-body')
    pg.mouse.click(pb[0] + 6, pb[1] + 120); pg.wait_for_timeout(300)
    check('blank inside panel keeps it', ev('S.panel') == 'detail')
    nb = box('#p-notes')
    pg.mouse.move(nb[0] + 20, nb[1] + 20); pg.mouse.down(); pg.mouse.move(sp[0] + 10, sp[1] + 10, steps=8); pg.mouse.up(); pg.wait_for_timeout(300)
    check('drag from notes to blank keeps it', ev('S.panel') == 'detail')
    tl = box('#todos')
    pg.mouse.click(tl[0] + 100, tl[3] - 6); pg.wait_for_timeout(300)
    check('blank under the list closes detail', ev('S.panel') == '')
    pg.click('[data-act=settings]'); pg.wait_for_timeout(300)
    pg.mouse.click((sp[0] + sp[2]) / 2, (sp[1] + sp[3]) / 2); pg.wait_for_timeout(300)
    check('blank closes settings', ev('S.panel') == '')

    # ---- 6. 月视图收起回到折叠日历 ----
    pg.click('#b-view'); pg.wait_for_timeout(400); pg.click('[data-act=big-open]'); pg.wait_for_timeout(700)
    ev('document.querySelector("#big-grid .cell:not(.out) .num").click()'); pg.wait_for_timeout(500)
    check('pop open', ev('!!S.pop'))
    bt = box('#big-title')
    pg.mouse.click(bt[2] + 60, (bt[1] + bt[3]) / 2); pg.wait_for_timeout(300)
    check('blank in big view closes pop first', ev('S.pop') is None and ev('S.big'))
    pg.click('[data-act=big-close]'); pg.wait_for_timeout(600)
    check('big-close returns to folded calendar', ev('[S.big, S.mode]') == [False, 'cal'])
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check('esc then back to day', ev('S.mode') == 'day')

    # ---- 5. 鼠标穿透的锁 ----
    ev('window.__TAURI__.core.invoke("set_locked", { locked: true })'); pg.wait_for_timeout(200)
    check('locked: header shows lock glyph', ev('document.documentElement.classList.contains("locked")') and ev('getComputedStyle(document.querySelector("#b-lock .when-locked")).display') == 'block' and ev('getComputedStyle(document.querySelector("#b-lock .when-free")).display') == 'none')
    ev('S.compact = "card"; render()'); pg.wait_for_timeout(600)
    check('locked: compact shows badge, hides dock/expand', ev('getComputedStyle(document.querySelector("#compact .lock-badge")).display') == 'flex' and ev('getComputedStyle(document.querySelector("#compact [data-act=dock]")).display') == 'none')
    pg.screenshot(path=OUT + 'v51-compact-locked.png', clip={'x': 1140, 'y': 0, 'width': 396, 'height': 200})
    ev('S.compact = "capsule"; render()'); pg.wait_for_timeout(600)
    check('locked: capsule shows lock', ev('getComputedStyle(document.querySelector("#capsule .lock-badge")).display') == 'flex')
    pg.screenshot(path=OUT + 'v51-capsule-locked.png', clip={'x': 1136, 'y': 100, 'width': 400, 'height': 90})
    ev('window.__TAURI__.core.invoke("set_locked", { locked: false })'); pg.wait_for_timeout(200)
    check('unlocked: badge gone', ev('getComputedStyle(document.querySelector("#capsule .lock-badge")).display') == 'none' and not ev('document.documentElement.classList.contains("locked")'))
    ev('S.compact = ""; render()'); pg.wait_for_timeout(500)

    # ---- 1. 0% 时设置和详情看得清 ----
    pg.click('[data-act=settings]'); pg.wait_for_timeout(300)
    ev('(() => { const el = document.getElementById("s-tint"); el.value = 0; el.dispatchEvent(new Event("input", { bubbles: true })); })()'); pg.wait_for_timeout(500)
    g = ev('''(() => { const cs = (s) => getComputedStyle(document.querySelector(s)); return { shell: cs('#shell > .glass').opacity, settings: cs('#settings .glass').opacity, solid: getComputedStyle(document.documentElement).getPropertyValue('--solidify').trim(), ts: cs('#settings-body h1, #settings-body .h2').textShadow, shellTs: cs('#h-month').textShadow.slice(0, 4) }; })()''')
    check('0%: widget clear, settings opaque, no halo in settings', g['shell'] == '0' and g['settings'] == '1' and g['solid'] == '1.000' and g['ts'] == 'none' and g['shellTs'] == 'rgba', g)
    pg.screenshot(path=OUT + 'v51-clear-settings-dark.png', clip={'x': 760, 'y': 0, 'width': 776, 'height': 920})
    pg.click('[data-act=theme][data-v=light]'); pg.wait_for_timeout(400)
    pg.screenshot(path=OUT + 'v51-clear-settings-light.png', clip={'x': 760, 'y': 0, 'width': 776, 'height': 920})
    ev('(() => { const el = document.getElementById("s-tint"); el.value = 60; el.dispatchEvent(new Event("input", { bubbles: true })); })()'); pg.wait_for_timeout(400)
    check('60%: settings looks like the widget again', ev('getComputedStyle(document.documentElement).getPropertyValue("--solidify").trim()') == '0.000')
    ev('(() => { const el = document.getElementById("s-tint"); el.value = 0; el.dispatchEvent(new Event("input", { bubbles: true })); })()'); pg.wait_for_timeout(300)
    pg.click('[data-act=s-close]'); pg.wait_for_timeout(300)
    pg.click('#day-nav [data-act=go-today]'); pg.wait_for_timeout(300)
    pg.click('#todos .td .open'); pg.wait_for_timeout(600)
    check('0%: detail panel opaque', ev('getComputedStyle(document.querySelector("#panel .glass")).opacity') == '1')
    pg.screenshot(path=OUT + 'v51-clear-detail-light.png', clip={'x': 720, 'y': 0, 'width': 816, 'height': 920})
    pg.keyboard.press('Escape')
    check('no console errors', not errs, errs[:3])

    # ---- 4. 气泡：没有 zoom、不探出底边（150% 缩放） ----
    import calendar
    last = t.replace(day=calendar.monthrange(t.year, t.month)[1]).isoformat()
    bottom = items + [{'id':'eb','kind':'event','date':last,'title':'月底复盘','start':'20:00','end':'21:00','place':'','notes':'','subs':[],'remind':'10'}]
    pg, errs = page(1280, 672, its=bottom, tint=50)
    ev = lambda js: pg.evaluate(js)
    pg.click('#b-view'); pg.wait_for_timeout(400); pg.click('[data-act=big-open]'); pg.wait_for_timeout(800)
    ev('(() => { const lines = [...document.querySelectorAll("#big-grid .cell:not(.out) .line")]; lines.find(l => l.textContent.includes(`月底复盘`)).click(); })()'); pg.wait_for_timeout(800)
    r = ev('''(() => { const p = document.getElementById('panel'); const b = p.getBoundingClientRect(); const s = document.getElementById('shell').getBoundingClientRect();
      const z = getComputedStyle(p.querySelector('.zoom')).zoom; const fonts = [...p.querySelectorAll('label, .meta, .chip, .field, .pill, h2, .del')].filter(e => e.offsetWidth).map(e => parseFloat(getComputedStyle(e).fontSize));
      return { w: Math.round(b.width), top: Math.round(b.top), bottom: Math.round(b.bottom), shellBottom: Math.round(s.bottom), zoom: z, minFont: Math.min(...fonts), bubble: p.classList.contains('bubble') }; })()''')
    check('150%: bubble inside the month view, no zoom, fonts ≥ 11px', r['bubble'] and r['zoom'] in ('1', 'normal') and r['w'] == 248 and r['bottom'] <= r['shellBottom'] and r['top'] >= 24 and r['minFont'] >= 11, r)
    pg.screenshot(path=OUT + 'v51-bubble-150.png', clip={'x': 480, 'y': 0, 'width': 800, 'height': 672})
    arrow = ev('(() => { const a = document.querySelector("#panel .arrow").getBoundingClientRect(); const l = document.querySelector("#big-grid .line.sel").getBoundingClientRect(); return Math.abs((a.top + a.height / 2) - (l.top + l.height / 2)); })()')
    check('arrow points at the event', arrow <= 3, arrow)
    check('no console errors (150%)', not errs, errs[:3])
print('ALL OK' if ok else 'SOME FAILED')
