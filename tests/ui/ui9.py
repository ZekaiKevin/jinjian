# 0.7.0（一）：农历 / 节气 / 节日 / 休班角标。头部、月历小格、月视图格子，设置开关，holidays.json 覆盖。
import json, os, warnings
warnings.filterwarnings('ignore')
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = HERE + 'shots/'
os.makedirs(OUT, exist_ok=True)
WP = 'https://local.test/wp.jpg'
ok = True
def check(name, cond, extra=''):
    global ok
    if not cond: ok = False
    print(('PASS ' if cond else 'FAIL ') + name, extra if extra != '' else '')

with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    def page(holidays=None, w=1536, h=960):
        ctx = b.new_context(viewport={'width': w, 'height': h}, screen={'width': w, 'height': h}, timezone_id='Asia/Shanghai')
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.route(WP, lambda r: r.fulfill(path=HERE + 'assets/wallpaper.jpg', headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
        pg.add_init_script('window.__SEED = ""; window.__WP = %s; window.__HOLIDAYS = %s;' % (json.dumps(WP), json.dumps(holidays or '')))
        pg.add_init_script(path=HERE + 'mock_cn.js')
        pg.goto('file://' + ROOT + '/src/index.html')
        pg.add_style_tag(content='body{background:url(%s) center/cover no-repeat !important}' % WP)
        pg.wait_for_timeout(900)
        return pg, errs
    pg, errs = page()
    ev = lambda js: pg.evaluate(js)
    def goto(key, mode='day'):
        ev('(() => { S.date = %s; S.vm = null; S.mode = %s; S.big = false; S.pop = null; render(); })()' % (json.dumps(key), json.dumps(mode)))
        pg.wait_for_timeout(120)
    def head():
        return ev('''(() => { const q = (s) => document.querySelector(s); const vis = (e) => !e.hidden && getComputedStyle(e).display !== 'none';
          const hb = q('header').getBoundingClientRect(), db = q('#date-btn').getBoundingClientRect(), st = q('#day-step').getBoundingClientRect(), lock = q('#b-view').getBoundingClientRect();
          return { lz: vis(q('#h-lz')) ? q('#h-lz').textContent : null, hol: vis(q('#h-hol')) ? q('#h-hol').textContent : null, hh: Math.round(hb.height),
                   dateRight: Math.round(db.right - 8), stepLeft: Math.round(st.left), viewLeft: Math.round(lock.left), tip: q('#date-btn').dataset.tip, aria: q('#date-btn').getAttribute('aria-label') }; })()''')

    # ---- 0. 默认与引用 ----
    check('lunar module loaded', ev('typeof Lunar === "object" && typeof Lunar.info === "function"'))
    check('defaults on', ev('S.settings.lunar === true && S.settings.hol === true'))

    # ---- 1. 头部 ----
    goto('2026-11-07')
    h = head()
    check('header: solar term shown (立冬)', h['lz'] == '立冬' and h['hol'] is None, h)
    goto('2026-10-01')
    h = head()
    check('header: festival + 休', h['lz'] == '国庆节' and h['hol'] == '休', h)
    check('header: tip carries full lunar date', '农历' in (h['tip'] or '') and '点日期打开日历' in (h['tip'] or ''), h['tip'])
    goto('2026-10-10')
    h = head()
    check('header: 班 on makeup workday', h['hol'] == '班', h)
    goto('2027-02-06')
    h = head()
    check('header: 2027 春节 with 休', h['lz'] == '春节' and h['hol'] == '休', h)
    goto('2026-11-15')
    h = head()
    check('header: plain day shows day name', h['lz'] == '初七' and h['hol'] is None, h)
    # 不撑开头部：高度不变，日期按钮不压到前后一天的箭头
    longest = ['2026-09-25', '2026-05-01', '2026-10-01', '2027-02-20', '2025-07-25', '2026-12-31', '2027-02-09', '2026-06-19']
    bad = []
    for k in longest:
        goto(k); h = head()
        if h['hh'] != 46 or h['dateRight'] > h['stepLeft'] or h['stepLeft'] > h['viewLeft']: bad.append([k, h])
    check('header: never grows or overlaps arrows', not bad, bad)
    goto('2025-07-25'); h = head()
    check('header: leap month name fits', h['lz'] == '闰六月' and h['dateRight'] <= h['stepLeft'], h)
    # 超出农历表：不显示，不报错
    goto('2101-03-01'); h = head()
    check('header: out of range is blank', h['lz'] is None and h['hol'] is None, h)
    goto('1899-12-31'); h = head()
    check('header: before range is blank', h['lz'] is None, h)

    # ---- 2. 折叠月历小格 ----
    goto('2026-10-15', 'cal')
    cells = ev('''[...document.querySelectorAll('#cal-grid .cday')].map(c => { const lz = c.querySelector('.lz'), hol = c.querySelector('.hol'), r = c.getBoundingClientRect();
      return { d: c.dataset.date, lz: lz ? lz.textContent : null, hol: hol ? hol.textContent : null, h: Math.round(r.height), over: lz ? lz.scrollWidth > lz.clientWidth + 1 : false, aria: c.getAttribute('aria-label') }; })''')
    byd = {c['d']: c for c in cells}
    check('cal: every cell has lunar text', all(c['lz'] for c in cells), [c['d'] for c in cells if not c['lz']])
    check('cal: 10-01 国庆节 休', byd['2026-10-01']['lz'] == '国庆节' and byd['2026-10-01']['hol'] == '休', byd['2026-10-01'])
    check('cal: 10-10 班', byd['2026-10-10']['hol'] == '班', byd['2026-10-10'])
    check('cal: 10-08 是普通日（国庆放完）', byd['2026-10-08']['hol'] is None, byd['2026-10-08'])
    check('cal: 10-08 寒露', byd['2026-10-08']['lz'] == '寒露', byd['2026-10-08'])
    check('cal: cell height unchanged, no overflow', all(c['h'] == 44 and not c['over'] for c in cells), [c for c in cells if c['h'] != 44 or c['over']])
    check('cal: aria-label has lunar and holiday', '农历' in byd['2026-10-01']['aria'] and '休' in byd['2026-10-01']['aria'] and '班' in byd['2026-10-10']['aria'], byd['2026-10-01']['aria'])
    check('cal: day number still first', ev('document.querySelector("#cal-grid .cday > span").textContent') == ev('document.querySelector("#cal-grid .cday").dataset.date.slice(8).replace(/^0/, "")'))
    pg.screenshot(path=OUT + 'v7-cal-lunar.png', clip={'x': 1140, 'y': 0, 'width': 396, 'height': 560})

    # ---- 3. 月视图 ----
    goto('2026-10-15', 'cal')
    pg.click('[data-act=big-open]'); pg.wait_for_timeout(700)
    big = ev('''[...document.querySelectorAll('#big-grid .cell')].map(c => { const head = c.querySelector('.cell-head'), lz = c.querySelector('.lz'), hol = c.querySelector('.hol'), num = c.querySelector('.num'), hb = head.getBoundingClientRect();
      return { d: c.dataset.date, lz: lz ? lz.textContent : null, hol: hol ? hol.textContent : null, hh: Math.round(hb.height), over: head.scrollWidth > head.clientWidth + 1, numRight: Math.round(num.getBoundingClientRect().right), headRight: Math.round(hb.right) }; })''')
    byd = {c['d']: c for c in big}
    check('big: cells have lunar text', sum(1 for c in big if c['lz']) == len(big), [c['d'] for c in big if not c['lz']])
    check('big: 10-01 国庆节 休, 10-10 班', byd['2026-10-01']['lz'] == '国庆节' and byd['2026-10-01']['hol'] == '休' and byd['2026-10-10']['hol'] == '班', [byd['2026-10-01'], byd['2026-10-10']])
    check('big: head stays 20px, no overflow', all(c['hh'] == 20 and not c['over'] for c in big), [c for c in big if c['hh'] != 20 or c['over']])
    check('big: day number stays at the right edge', all(c['numRight'] <= c['headRight'] for c in big))
    pg.screenshot(path=OUT + 'v7-big-lunar.png', clip={'x': 744, 'y': 0, 'width': 792, 'height': 700})
    # 点日期数字仍然弹出当天的小窗口
    pg.click('#big-grid .cell[data-date="2026-10-01"] .num'); pg.wait_for_timeout(400)
    check('big: number still opens the pop', ev('document.getElementById("pop").classList.contains("on")'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    pg.click('[data-act=big-close]'); pg.wait_for_timeout(600)

    # ---- 4. 设置开关 ----
    pg.click('[data-act=settings]'); pg.wait_for_timeout(500)
    names = ev('[...document.querySelectorAll("#s-switches .sw")].map(b => b.getAttribute("aria-label") + ":" + b.dataset.k + ":" + b.getAttribute("aria-checked"))')
    check('settings: two new switches, on', any(':lunar:true' in n for n in names) and any(':hol:true' in n for n in names), names)
    pg.click('#s-switches [data-k=hol]'); pg.wait_for_timeout(300)
    goto('2026-10-01', 'cal'); h = head()
    check('hol off: badge gone, lunar stays', h['hol'] is None and h['lz'] == '国庆节', h)
    check('hol off: no badge in cal', ev('document.querySelectorAll("#cal-grid .hol").length') == 0)
    check('hol off saved', ev('JSON.parse(window.__stored).settings.hol') is False)
    pg.click('#s-switches [data-k=lunar]'); pg.wait_for_timeout(300)
    h = head()
    check('lunar off: header line gone', h['lz'] is None and h['hol'] is None, h)
    check('lunar off: nothing in cal', ev('document.querySelectorAll("#cal-grid .lz, #cal-grid .hol").length') == 0)
    check('lunar off: nothing in big', ev('(() => { S.big = true; render(); return document.querySelectorAll("#big-grid .lz, #big-grid .hol").length; })()') == 0)
    check('lunar off: cell height back to 44', ev('[...document.querySelectorAll("#cal-grid .cday")].every(c => Math.round(c.getBoundingClientRect().height) == 44)'))
    ev('S.big = false; render()')
    pg.click('#s-switches [data-k=lunar]'); pg.click('#s-switches [data-k=hol]'); pg.wait_for_timeout(300)
    h = head()
    check('both back on', h['lz'] == '国庆节' and h['hol'] == '休', h)
    pg.click('[data-act=s-close]'); pg.wait_for_timeout(300)
    check('no page errors (main)', not errs, errs)

    # ---- 5. 窄窗口也不撑开（372px 的小组件在 1280 宽的屏幕上同样是 372） ----
    # ---- 6. holidays.json 覆盖 ----
    pg2, errs2 = page('{"off":["2028-01-01","2028-01-26..2028-02-02"],"work":["2028-01-22"]}')
    ev2 = lambda js: pg2.evaluate(js)
    def goto2(key):
        ev2('(() => { S.date = %s; S.vm = null; S.mode = "day"; render(); })()' % json.dumps(key)); pg2.wait_for_timeout(100)
        return ev2('(() => { const h = document.getElementById("h-hol"); return h.hidden ? null : h.textContent; })()')
    check('override: 2028-01-22 班', goto2('2028-01-22') == '班')
    check('override: range start 休', goto2('2028-01-26') == '休')
    check('override: range end 休', goto2('2028-02-02') == '休')
    check('override: day after range plain', goto2('2028-02-03') is None)
    check('override: built-in still works', goto2('2026-10-01') == '休')
    check('override: no errors', not errs2, errs2)
    pg3, errs3 = page('{坏的 json')
    ev3 = lambda js: pg3.evaluate(js)
    ev3('(() => { S.date = "2026-10-01"; S.vm = null; render(); })()'); pg3.wait_for_timeout(100)
    check('bad holidays.json: built-in kept, no crash', ev3('document.getElementById("h-hol").textContent') == '休' and not errs3, errs3)
    pg4, errs4 = page('﻿{"work":["2026-10-01"]}')
    ev4 = lambda js: pg4.evaluate(js)
    ev4('(() => { S.date = "2026-10-01"; S.vm = null; render(); })()'); pg4.wait_for_timeout(100)
    check('BOM holidays.json: 国庆当天改成班', ev4('document.getElementById("h-hol").textContent') == '班' and not errs4, errs4)

    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
raise SystemExit(0 if ok else 1)
