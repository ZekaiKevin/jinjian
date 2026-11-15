import json, datetime
from playwright.sync_api import sync_playwright
import os
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
WP = 'https://local.test/wp.jpg'
BASE = HERE
WPFILE = BASE + 'assets/wallpaper.jpg'
OUT = BASE + 'shots/'
os.makedirs(OUT, exist_ok=True)
t = (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).date(); T = t.isoformat()
Y = (t - datetime.timedelta(days=1)).isoformat(); M = (t + datetime.timedelta(days=1)).isoformat()
items = [
 {'id':'a','kind':'todo','date':T,'title':'交西语作业','done':False,'star':True,'due':'18:00','place':'','notes':'','subs':[]},
 {'id':'b','kind':'todo','date':T,'title':'回复房东邮件','done':True,'star':False,'due':'','place':'','notes':'','subs':[]},
 {'id':'c','kind':'todo','date':M,'title':'明天的事','done':False,'star':False,'due':'','place':'','notes':'','subs':[]},
 {'id':'e1','kind':'event','date':T,'title':'组会','start':'09:00','end':'10:00','place':'','notes':'','subs':[],'remind':'10'},
 {'id':'e2','kind':'event','date':M,'title':'明天的课','start':'10:00','end':'11:00','place':'','notes':'','subs':[],'remind':'10'},
 {'id':'e3','kind':'event','date':Y,'title':'昨天的会','start':'10:00','end':'11:00','place':'','notes':'','subs':[],'remind':'10'},
]
seed = json.dumps({'version':2,'items':items,'note':'\n牙医电话在冰箱贴上。\n第二行'})
ok = True
def check(name, cond, extra=''):
    global ok
    if not cond: ok = False
    print(('PASS ' if cond else 'FAIL ') + name, extra)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    def page(w, h, sd=seed):
        ctx = b.new_context(viewport={'width': w, 'height': h}, screen={'width': w, 'height': h}, timezone_id='Asia/Shanghai')
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.route(WP, lambda r: r.fulfill(path=WPFILE, headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
        pg.add_init_script('window.__SEED = %s; window.__WP = %s;' % (json.dumps(sd), json.dumps(WP)))
        pg.add_init_script(path=HERE + 'mock_cn.js')
        pg.goto('file://' + ROOT + '/src/index.html')
        pg.add_style_tag(content='body{background:url(%s) center/cover no-repeat !important}' % WP)
        pg.wait_for_timeout(1200)
        return pg, errs
    pg, errs = page(1536, 960)
    ev = lambda js: pg.evaluate(js)
    names = lambda sel: ev('Array.from(document.querySelectorAll("%s")).map(n => n.textContent)' % sel)

    # ---- 前一天 / 今天 / 后一天 ----
    check('today: nav hidden, now shown', ev('document.getElementById("day-nav").hidden && !document.getElementById("now").hidden'))
    pg.click('#b-view'); pg.wait_for_timeout(500); pg.click('.cday[data-date="%s"]' % M); pg.wait_for_timeout(600)
    check('other day: nav shown', ev('!document.getElementById("day-nav").hidden && document.getElementById("now").hidden'))
    r = ev('''(() => { const q = (s) => document.querySelector(s).getBoundingClientRect(); const d = document.getElementById('day').getBoundingClientRect();
      const a = q('#day-nav [data-act=day-prev]'), c = q('#day-nav [data-act=go-today]'), n = q('#day-nav [data-act=day-next]');
      return { left: Math.round(a.left - d.left), right: Math.round(d.right - n.right), mid: Math.round((c.left + c.right) / 2 - (d.left + d.right) / 2) }; })()''')
    check('nav layout: prev left, today centered, next right', r['left'] == 0 and r['right'] == 0 and abs(r['mid']) <= 1, r)
    check('tomorrow lists', names('#events .n') == ['明天的课'] and names('#todos .name') == ['明天的事'])
    pg.screenshot(path=OUT + 'v5-nav.png', clip={'x': 1140, 'y': 0, 'width': 396, 'height': 420})
    pg.click('#day-nav [data-act=day-prev]'); pg.wait_for_timeout(400)
    check('prev from tomorrow → today: nav stays, now card back, today marked', ev('S.date') == T and not ev('document.getElementById("day-nav").hidden') and not ev('document.getElementById("now").hidden') and ev('document.getElementById("nav-today").getAttribute("aria-pressed")') == 'true')
    pg.click('#nav-today'); pg.wait_for_timeout(300)
    check('today pressed on today → nav gone', ev('document.getElementById("day-nav").hidden'))
    pg.click('#b-view'); pg.wait_for_timeout(400); pg.click('.cday[data-date="%s"]' % M); pg.wait_for_timeout(500)
    pg.click('#day-nav [data-act=day-next]'); pg.wait_for_timeout(300)
    D2 = (t + datetime.timedelta(days=2)).isoformat()
    check('next → day after tomorrow', ev('S.date') == D2 and ev('document.getElementById("h-day").textContent') == str((t + datetime.timedelta(days=2)).day))
    pg.click('#day-nav [data-act=day-prev]'); pg.click('#day-nav [data-act=day-prev]'); pg.click('#day-nav [data-act=day-prev]'); pg.wait_for_timeout(400)
    check('prev x3 → yesterday', ev('S.date') == Y and names('#events .n') == ['昨天的会'])
    # 详情开着时切换日期：详情收起
    pg.click('#events .ev'); pg.wait_for_timeout(400); check('detail open', ev('S.panel') == 'detail')
    pg.click('#day-nav [data-act=day-next]'); pg.wait_for_timeout(400); check('detail closed after day switch', ev('S.panel') == '' and ev('S.date') == T)
    pg.click('#b-view'); pg.wait_for_timeout(400); pg.click('.cday[data-date="%s"]' % Y); pg.wait_for_timeout(400)
    pg.click('#day-nav [data-act=go-today]'); pg.wait_for_timeout(400); check('today button', ev('S.date') == T and ev('S.mode') == 'day')

    # ---- 折叠 ----
    h = lambda id: ev('Math.round(document.getElementById("%s").getBoundingClientRect().height)' % id)
    h0 = {k: h(k) for k in ['sec-ev', 'sec-td', 'sec-note', 'todos']}
    pg.click('[data-act=fold][data-k=note]'); pg.wait_for_timeout(700)
    check('note folded', h('sec-note') < h0['sec-note'] - 20 and ev('document.getElementById("note-peek").textContent') == '牙医电话在冰箱贴上。', (h0['sec-note'], h('sec-note')))
    check('note fold gives room to todos', h('todos') > h0['todos'] + 20, (h0['todos'], h('todos')))
    check('folded textarea not focusable', ev('getComputedStyle(document.querySelector("#note-wrap .clip")).visibility') == 'hidden')
    pg.click('[data-act=fold][data-k=ev]'); pg.wait_for_timeout(700)
    check('events folded + count', h('sec-ev') <= 32 and ev('document.getElementById("ev-meta").textContent') == '1', h('sec-ev'))
    pg.click('[data-act=fold][data-k=td]'); pg.wait_for_timeout(700)
    check('todos folded + count', h('sec-td') <= 30 and ev('document.getElementById("td-meta").textContent') == '1/2', h('sec-td'))
    check('note stays at bottom', ev('Math.round(document.getElementById("day").getBoundingClientRect().bottom - document.getElementById("sec-note").getBoundingClientRect().bottom)') == 0)
    pg.screenshot(path=OUT + 'v5-folded.png', clip={'x': 1140, 'y': 0, 'width': 396, 'height': 920})
    pg.wait_for_timeout(400)
    check('fold saved', ev('JSON.stringify(S.settings.fold)') == '{"ev":true,"td":true,"note":true}')
    pg.click('[data-act=add-todo]'); pg.wait_for_timeout(500)
    check('add-todo unfolds todos', ev('S.settings.fold.td') is False and ev('S.panel') == 'detail')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.click('[data-act=fold][data-k=ev]'); pg.click('[data-act=fold][data-k=note]'); pg.wait_for_timeout(700)
    check('unfold restores heights', abs(h('sec-ev') - h0['sec-ev']) <= 1 and abs(h('sec-note') - h0['sec-note']) <= 1 and abs(h('todos') - h0['todos']) <= 1, ({k: h(k) for k in h0}, h0))

    # ---- 完全透明 ----
    cs = lambda v: ev('getComputedStyle(document.documentElement).getPropertyValue("%s").trim()' % v)
    pg.click('[data-act=settings]'); pg.wait_for_timeout(400)
    check('slider range 0-100', ev('[document.getElementById("s-tint").min, document.getElementById("s-tint").max].join()') == '0,100')
    pg.evaluate('(() => { const el = document.getElementById("s-tint"); el.value = 0; el.dispatchEvent(new Event("input", { bubbles: true })); })()'); pg.wait_for_timeout(400)
    g = ev('''(() => { const gl = document.querySelector('#shell > .glass'); const sh = getComputedStyle(document.getElementById('shell')).boxShadow; return { op: getComputedStyle(gl).opacity, shadow: sh, bare: document.documentElement.classList.contains('bare'), ink: document.documentElement.dataset.ink, ts: getComputedStyle(document.getElementById('h-month')).textShadow.slice(0, 40) }; })()''')
    check('0%: glass gone, no shadow, halo on', g['op'] == '0' and 'rgba(10, 6, 24, 0)' in g['shadow'] and g['bare'] and cs('--halo') == '1.000', g)
    pg.screenshot(path=OUT + 'v5-clear-dark.png', clip={'x': 760, 'y': 0, 'width': 776, 'height': 920})
    pg.click('[data-act=theme][data-v=light]'); pg.wait_for_timeout(400)
    check('0% light theme over dark wallpaper → light ink', ev('document.documentElement.dataset.ink') == 'light')
    pg.evaluate('(() => { const el = document.getElementById("s-tint"); el.value = 60; el.dispatchEvent(new Event("input", { bubbles: true })); })()'); pg.wait_for_timeout(400)
    check('60% light → dark ink, full glass, no halo', ev('document.documentElement.dataset.ink') == 'dark' and cs('--glass') == '1.000' and cs('--halo') == '0.000' and not ev('document.documentElement.classList.contains("bare")'))
    pg.evaluate('(() => { const el = document.getElementById("s-tint"); el.value = 12; el.dispatchEvent(new Event("input", { bubbles: true })); })()'); pg.wait_for_timeout(400)
    check('12%: glass partly faded', cs('--glass') == '0.480', cs('--glass'))
    pg.screenshot(path=OUT + 'v5-12-light.png', clip={'x': 760, 'y': 0, 'width': 776, 'height': 920})
    # 月视图里的气泡不跟着变透明
    pg.evaluate('(() => { const el = document.getElementById("s-tint"); el.value = 0; el.dispatchEvent(new Event("input", { bubbles: true })); })()')
    pg.click('[data-act=s-close]'); pg.click('#b-view'); pg.wait_for_timeout(400); pg.click('[data-act=big-open]'); pg.wait_for_timeout(700)
    pg.evaluate('document.querySelector("#big-grid .cell:not(.out) .line").click()'); pg.wait_for_timeout(700)
    check('bubble stays opaque at 0%', ev('getComputedStyle(document.querySelector("#panel .glass")).opacity') == '1')
    pg.screenshot(path=OUT + 'v5-clear-big.png', clip={'x': 700, 'y': 0, 'width': 836, 'height': 700})
    check('no console errors', not errs, errs[:3])

    # ---- 150% 缩放：折起便签后待办更高 ----
    pg, errs = page(1280, 672)
    g0 = ev('''(() => { const r = (id) => Math.round(document.getElementById(id).getBoundingClientRect().height); const d = document.getElementById('day'); return { todos: r('todos'), note: r('sec-note'), scroll: d.scrollHeight - d.clientHeight }; })()''')
    pg.click('[data-act=fold][data-k=note]'); pg.wait_for_timeout(700)
    g1 = ev('''(() => { const r = (id) => Math.round(document.getElementById(id).getBoundingClientRect().height); const d = document.getElementById('day'); return { todos: r('todos'), note: r('sec-note'), scroll: d.scrollHeight - d.clientHeight }; })()''')
    check('150%: no overflow, fold frees space', g0['scroll'] == 0 and g1['scroll'] == 0 and g1['todos'] > g0['todos'], (g0, g1))
    pg.screenshot(path=OUT + 'v5-150.png', clip={'x': 880, 'y': 0, 'width': 400, 'height': 672})
    check('no console errors (150%)', not errs, errs[:3])
print('ALL OK' if ok else 'SOME FAILED')
