# 0.8.1：停靠在屏幕四个角、拖边改宽。
# mock_cn.js 里的 set_corner 假装外壳摆了窗口：测试给一份“显示器 / 工作区 / 窗口”的几何（任务栏分别在下、上、左、右），
# 然后量真实的元素位置和玻璃里壁纸的 background-position，按“这张壁纸铺满整块显示器”倒推它在屏幕上的原点，四个角、任务栏在哪边都必须对得上。
# 改宽用真实的鼠标拖那条边。窗口真的挪没挪、挪得对不对，只能在真机上看（外壳那段靠 CI 编译）。
import json, datetime, os, re, warnings
warnings.filterwarnings('ignore')
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = HERE + 'shots/'
os.makedirs(OUT, exist_ok=True)
WP = 'https://local.test/wp.jpg'
now = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)
t = now.date()
ws = t - datetime.timedelta(days=(t.weekday() + 1) % 7)
D = lambda i: (ws + datetime.timedelta(days=i)).isoformat()
VW, VH = 1536, 960   # 浏览器视口 = 假装的主窗口（CSS 像素，缩放 1）
def event(i, date, title, **kw):
    d = {'id': i, 'kind': 'event', 'date': date, 'title': title, 'start': '09:00', 'end': '10:00', 'place': '', 'notes': '', 'subs': [], 'remind': 'none'}; d.update(kw); return d
def settings(**kw):
    s = {'theme': 'dark', 'tint': 50, 'blur': True, 'carry': False, 'autostart': False, 'top': False, 'sync': {'on': False, 'user': '', 'cals': [], 'target': ''}}
    s.update(kw); return s
ok = True
def check(name, cond, extra=''):
    global ok
    if not cond: ok = False
    print(('PASS ' if cond else 'FAIL ') + name, str(extra) if extra != '' else '')

# 假的屏幕：显示器 1920 宽；任务栏在某一边占 bar 像素；窗口就是视口那么大，贴工作区的左边或右边、顶着工作区的上边
def geo_js(side, bar=48):
    mon = {'bottom': [0, 0, 1920, VH + bar], 'top': [0, 0, 1920, VH + bar], 'left': [0, 0, 1920, VH], 'right': [0, 0, 1920, VH], 'none': [0, 0, 1920, VH]}[side]
    work = {'bottom': [0, 0, 1920, VH], 'top': [0, bar, 1920, VH], 'left': [bar, 0, 1920 - bar, VH], 'right': [0, 0, 1920 - bar, VH], 'none': [0, 0, 1920, VH]}[side]
    return ('window.__GEO = (corner) => { const mon = %s, work = %s; const x = corner.charAt(1) === "l" ? work[0] : work[0] + work[2] - %d; return { win: [x, work[1], %d, %d], mon: mon, work: work, scale: 1 }; };'
            % (json.dumps(mon), json.dumps(work), VW, VW, VH))

# 这块玻璃里的壁纸，原点落在屏幕的哪里（应该是 -ox, -oy：壁纸居中铺满显示器）
ORIGIN = '''(sel) => {
  const el = document.querySelector(sel);
  const r = el.getBoundingClientRect();
  const c = getComputedStyle(el, '::before');
  const size = c.backgroundSize.split(' ').map(parseFloat);
  const box = { l: r.left - 30, t: r.top - 30, w: r.width + 60, h: r.height + 60 };   // ::before 四边各伸出 30
  const pos = (text, room) => { const p = /(-?[\\d.]+)%/.exec(text); const px = text.replace(/-?[\\d.]+%/, '').match(/([+-])?\\s*(-?[\\d.]+)px/); return (p ? room * parseFloat(p[1]) / 100 : 0) + (px ? (px[1] === '-' ? -1 : 1) * parseFloat(px[2]) : 0); };
  const x = box.l + pos(c.backgroundPositionX, box.w - size[0]);
  const y = box.t + pos(c.backgroundPositionY, box.h - size[1]);
  const k = geo ? geo.scale : 1;
  const wx = geo ? (geo.win[0] - geo.mon[0]) / k : 0;
  const wy = geo ? (geo.win[1] - geo.mon[1]) / k : 0;
  const root = getComputedStyle(document.documentElement);
  return { x: wx + x + parseFloat(root.getPropertyValue('--ox')), y: wy + y + parseFloat(root.getPropertyValue('--oy')), size: size, pos: c.backgroundPosition };
}'''

with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    def page(items=None, init='', **st):
        ctx = b.new_context(viewport={'width': VW, 'height': VH}, screen={'width': VW, 'height': VH}, timezone_id='Asia/Shanghai')
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.route(WP, lambda r: r.fulfill(path=HERE + 'assets/wallpaper.jpg', headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
        seed = json.dumps({'version': 2, 'items': items or [], 'note': '', 'settings': settings(**st)})
        pg.add_init_script('window.__SEED = %s; window.__WP = %s; %s' % (json.dumps(seed), json.dumps(WP), init))
        pg.add_init_script(path=HERE + 'mock_cn.js')
        pg.goto('file://' + ROOT + '/src/index.html')
        pg.wait_for_timeout(1000)
        return pg, errs
    rect = lambda pg, sel: pg.evaluate('(s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }', sel)
    near = lambda a, b_, tol=0.6: abs(a - b_) <= tol

    # =====================================================================
    # 一、默认右上；在设置里换角
    # =====================================================================
    items = [event('e1', D(2), '评审'), event('e2', t.isoformat(), '今天的事', start='10:00', end='11:00')]
    pg, errs = page(items)
    ev = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    sh = rect(pg, '#shell')
    check('default is top-right, same place and width as before', ev('document.documentElement.dataset.corner') == 'tr' and near(sh['r'], VW - 24) and near(sh['t'], 24) and near(sh['w'], 372) and ev('S.settings.corner') == 'tr' and ev('S.settings.width') == 372, sh)
    check('shell asked to place the window once at start, with the saved corner', ev('window.__log.corner') == ['tr'])
    ev('onAct("settings", document.body)'); pg.wait_for_timeout(600)
    seg = ev('[...document.querySelectorAll("#s-corner button")].map(x => [x.dataset.v, x.textContent, x.getAttribute("aria-pressed")])')
    check('settings: four corners to choose from, current one pressed', seg == [['tl', '左上', 'false'], ['tr', '右上', 'true'], ['bl', '左下', 'false'], ['br', '右下', 'false']], seg)
    st0 = rect(pg, '#settings')
    check('settings panel sits on the inner side (left of the widget)', near(st0['r'], sh['l'] - 16) and near(st0['t'], 24), st0)
    pg.click('#s-corner button[data-v="tl"]'); pg.wait_for_timeout(700)
    sh, st1 = rect(pg, '#shell'), rect(pg, '#settings')
    check('picked 左上: widget on the left edge, settings flips to its right', near(sh['l'], 24) and near(sh['t'], 24) and near(st1['l'], sh['r'] + 16) and ev('document.documentElement.dataset.corner') == 'tl', [sh, st1])
    check('picked 左上: saved, shell asked to move the window, button state follows', ev('JSON.parse(window.__stored).settings.corner') == 'tl' and ev('window.__log.corner') == ['tr', 'tl'] and ev('document.querySelector("#s-corner button[data-v=tl]").getAttribute("aria-pressed")') == 'true')
    check('shown again after the move (not left hidden)', not ev('document.documentElement.classList.contains("docking")') and ev('getComputedStyle(document.getElementById("stage")).opacity') == '1')
    rects = ev('window.__log.lastRects')
    check('hit rects re-sent for the new place', rects and near(rects[0][0], sh['l'], 1) and near(rects[0][2], sh['r'], 1) and any(near(r[0], st1['l'], 1) for r in rects), rects)
    pg.click('#s-corner button[data-v="br"]'); pg.wait_for_timeout(700)
    sh, st1 = rect(pg, '#shell'), rect(pg, '#settings')
    check('picked 右下: bottom-right, settings bottom-aligned on its left', near(sh['r'], VW - 24) and near(sh['b'], VH - 24) and near(st1['r'], sh['l'] - 16) and near(st1['b'], VH - 24), [sh, st1])
    pg.click('#s-layer button[data-v="top"]'); pg.wait_for_timeout(200)
    check('window layer switch still works after moving', ev('window.__log.calls.filter(c => c === "set_layer").length') == 1 and ev('S.settings.top') is True and ev('S.settings.corner') == 'br')
    pg.click('#s-layer button[data-v="desk"]'); pg.wait_for_timeout(200)
    ev('closePanels()'); pg.wait_for_timeout(300)
    # 屏幕变了（分辨率 / 缩放 / 任务栏）：重新摆
    n = len(ev('window.__log.corner'))
    ev('checkScreen()'); pg.wait_for_timeout(200)
    same = len(ev('window.__log.corner'))
    ev('lastScreen = "changed"; checkScreen()'); pg.wait_for_timeout(600)
    check('screen changed: window placed again; unchanged: left alone', same == n and ev('window.__log.corner') [n:] == ['br'], ev('window.__log.corner'))
    check('no page errors (settings)', not errs, errs)

    # =====================================================================
    # 二、玻璃里的壁纸和屏幕对齐：四个角 × 任务栏在下 / 上 / 左 / 右
    # =====================================================================
    worst = 0
    for side in ['bottom', 'top', 'left', 'right']:
        for corner, width in [('tr', 372), ('tl', 320), ('bl', 480), ('br', 440)]:
            pg, errs = page(items, init=geo_js(side), corner=corner, width=width)
            ev = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
            got = {'shell': ev(ORIGIN, '#shell > .glass')}
            ev('onAct("settings", document.body)'); pg.wait_for_timeout(600)
            got['settings'] = ev(ORIGIN, '#settings .glass')
            ev('closePanels(); openDetail("e2", false)'); pg.wait_for_timeout(600)
            got['detail'] = ev(ORIGIN, '#panel .glass')
            ev('closePanels(); S.compact = "capsule"; render()'); pg.wait_for_timeout(700)
            got['capsule'] = ev(ORIGIN, '#capsule .glass')
            cap = rect(pg, '#capsule')
            off = max(max(abs(g['x']), abs(g['y'])) for g in got.values())
            worst = max(worst, off)
            edge_ok = (near(cap['l'], 0) if corner[1] == 'l' else near(cap['r'], VW)) and (near(cap['b'], VH - 120) if corner[0] == 'b' else near(cap['t'], 120))
            g = ev('geo')
            sizes_ok = all(near(x['size'][0] / x['size'][1], 16 / 9, 0.01) and x['size'][0] >= g['mon'][2] - 0.5 and x['size'][1] >= g['mon'][3] - 0.5 for x in got.values())
            check('aligned: taskbar %s, corner %s, width %d' % (side, corner, width), off < 0.6 and edge_ok and sizes_ok and not errs, {k: [round(v['x'], 2), round(v['y'], 2)] for k, v in got.items()} if off >= 0.6 else '')
            if side == 'left' and corner == 'bl':
                ev('S.compact = ""; render(); openDetail("e2", false)'); pg.wait_for_timeout(700)
                pg.screenshot(path=OUT + 'v81-bl-taskbar-left.png')
            pg.context.close()
    check('worst misalignment over all 16 layouts is sub-pixel', worst < 0.6, worst)

    # 一个反例，确认上面的量法真的能量出错位：把“窗口边到屏幕边的距离”抹掉，任务栏在上面时就该差出任务栏那么高
    pg, errs = page(items, init=geo_js('top'), corner='tr')
    pg.evaluate('document.documentElement.style.setProperty("--ey", "0px")')
    bad = pg.evaluate(ORIGIN, '#shell > .glass')
    check('the measurement notices a wrong offset (sanity check of this test)', near(abs(bad['y']), 48, 1) and near(bad['x'], 0), bad)
    pg.context.close()

    # 换角以后重新对齐（同一个页面里连着换）
    pg, errs = page(items, init=geo_js('left'))
    ev = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    seq = []
    for corner in ['bl', 'tl', 'br', 'tr']:
        ev('onAct("settings", document.body)'); pg.wait_for_timeout(500)
        pg.click('#s-corner button[data-v="%s"]' % corner); pg.wait_for_timeout(800)
        a, s2 = ev(ORIGIN, '#shell > .glass'), ev(ORIGIN, '#settings .glass')
        seq.append([corner, round(max(abs(a['x']), abs(a['y']), abs(s2['x']), abs(s2['y'])), 2), ev('geo.win[0]')])
        ev('closePanels()'); pg.wait_for_timeout(300)
    check('switching corners in one session: realigned every time, window x follows the work area', all(x[1] < 0.6 for x in seq) and [x[2] for x in seq] == [48, 48, 1920 - VW, 1920 - VW], seq)
    check('no page errors (alignment)', not errs, errs)
    pg.context.close()

    # =====================================================================
    # 三、拖靠屏幕内侧的那条边改宽
    # =====================================================================
    pg, errs = page(items)
    ev = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    g = rect(pg, '#grip'); sh = rect(pg, '#shell')
    check('grip is the inner (left) edge when docked right', near(g['l'], sh['l']) and g['w'] <= 12 and ev('getComputedStyle(document.getElementById("grip")).cursor') == 'ew-resize', g)
    m = pg.mouse
    m.move(g['l'] + 4, 400); m.down(); pg.wait_for_timeout(40); m.move(g['l'] + 4 - 30, 400, steps=4); m.move(g['l'] + 4 - 60, 430, steps=4); pg.wait_for_timeout(60)
    mid = ev('({ w: document.getElementById("shell").offsetWidth, rect: document.getElementById("shell").getBoundingClientRect().width, right: document.getElementById("shell").getBoundingClientRect().right, hold: window.__log.hold.slice(), cls: document.documentElement.className })')
    check('dragging inwards: widens at once (no easing lag), outer edge stays put, shell told to stay clickable', mid['w'] == 432 and near(mid['rect'], 432) and near(mid['right'], VW - 24) and mid['hold'] == [True] and 'resizing' in mid['cls'], mid)
    m.up(); pg.wait_for_timeout(500)
    check('released: width kept and saved, hold released', ev('S.settings.width') == 432 and ev('JSON.parse(window.__stored).settings.width') == 432 and ev('window.__log.hold') == [True, False] and 'resizing' not in ev('document.documentElement.className'))
    ev('openDetail("e2", false)'); pg.wait_for_timeout(600)
    sh, pn = rect(pg, '#shell'), rect(pg, '#panel')
    check('detail panel keeps its 16px gap from the wider widget, wallpaper still aligned', near(pn['r'], sh['l'] - 16) and abs(ev(ORIGIN, '#panel .glass')['x']) < 0.6 and abs(ev(ORIGIN, '#shell > .glass')['x']) < 0.6, [sh, pn])
    # 开着详情拖：详情跟着走
    g = rect(pg, '#grip')
    m.move(g['l'] + 4, 500); m.down(); pg.wait_for_timeout(40); m.move(g['l'] + 4 + 40, 500, steps=5); pg.wait_for_timeout(60)
    sh, pn = rect(pg, '#shell'), rect(pg, '#panel')
    check('dragging with the detail open: the panel follows the edge immediately', near(sh['w'], 392) and near(pn['r'], sh['l'] - 16), [sh, pn])
    m.up(); pg.wait_for_timeout(300); ev('closePanels()'); pg.wait_for_timeout(300)
    g = rect(pg, '#grip')
    m.move(g['l'] + 4, 400); m.down(); m.move(100, 400, steps=6); pg.wait_for_timeout(60); wmax = ev('document.getElementById("shell").offsetWidth'); m.up(); pg.wait_for_timeout(300)
    g = rect(pg, '#grip')
    m.move(g['l'] + 4, 400); m.down(); m.move(VW - 5, 400, steps=6); pg.wait_for_timeout(60); wmin = ev('document.getElementById("shell").offsetWidth'); m.up(); pg.wait_for_timeout(300)
    check('clamped to 320–480', wmax == 480 and wmin == 320 and ev('S.settings.width') == 320, [wmax, wmin])
    pg.screenshot(path=OUT + 'v81-narrow.png', clip={'x': VW - 520, 'y': 0, 'width': 520, 'height': VH})
    over = ev('[...document.querySelectorAll("#widget *")].filter(el => { const r = el.getBoundingClientRect(); const s = document.getElementById("shell").getBoundingClientRect(); return r.width > 0 && el.offsetParent && (r.left < s.left - 0.5 || r.right > s.right + 0.5); }).map(el => el.id || el.className).slice(0, 5)')
    check('at 320 nothing in the widget sticks out of the glass', over == [], over)
    g = rect(pg, '#grip')
    pg.mouse.dblclick(g['l'] + 4, 400); pg.wait_for_timeout(400)
    check('double-click the edge: back to 372', ev('S.settings.width') == 372 and near(rect(pg, '#shell')['w'], 372) and ev('JSON.parse(window.__stored).settings.width') == 372)
    pg.focus('#grip'); pg.keyboard.press('ArrowLeft'); pg.wait_for_timeout(200)
    check('keyboard: arrow towards the inside widens by a step', ev('S.settings.width') == 380)
    pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(200)
    # 只有平常的小组件能改宽
    ev('onAct("big-open", document.body)'); pg.wait_for_timeout(600); hid_big = ev('document.getElementById("grip").hidden')
    ev('onAct("big-close", document.body); S.compact = "card"; render()'); pg.wait_for_timeout(600); hid_card = ev('document.getElementById("grip").hidden')
    card = rect(pg, '#shell')
    ev('S.compact = ""; render()'); pg.wait_for_timeout(500)
    check('no grip in the expanded calendar or the mini card; mini card is 24 narrower than the widget', hid_big and hid_card and not ev('document.getElementById("grip").hidden') and near(card['w'], 348), card)
    check('no page errors (resize, right)', not errs, errs)
    pg.context.close()

    # 靠左停靠：把手在右边，往右拖是变宽；宽度记在数据里，下次打开还在
    pg, errs = page(items, corner='bl', width=440)
    ev = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    g = rect(pg, '#grip'); sh = rect(pg, '#shell')
    check('remembered width is used on start; docked left: grip is the right edge', near(sh['w'], 440) and near(sh['l'], 24) and near(sh['b'], VH - 24) and near(g['r'], sh['r']), [sh, g])
    m = pg.mouse
    m.move(g['r'] - 4, 500); m.down(); pg.wait_for_timeout(40); m.move(g['r'] - 4 + 30, 500, steps=5); pg.wait_for_timeout(60); m.up(); pg.wait_for_timeout(400)
    sh = rect(pg, '#shell')
    check('docked left: dragging right widens, left edge stays put', ev('S.settings.width') == 470 and near(sh['l'], 24) and near(sh['w'], 470), sh)
    check('no page errors (resize, left)', not errs, errs)
    pg.context.close()

    # 窗口放不下“详情 + 最宽的小组件”时（小屏幕），最宽到放得下为止
    pg, errs = page(items, init='window.__GEO = () => ({ win: [0, 0, 853, 960], mon: [0, 0, 853, 1000], work: [0, 0, 853, 960], scale: 1 });', width=480)
    check('narrow work area: the widest allowed shrinks so the detail still fits', pg.evaluate('widthOf()') == 853 - 428 and pg.evaluate('document.getElementById("shell").offsetWidth') == 425)
    pg.context.close()

    # =====================================================================
    # 四、展开的月视图 / 周视图、详情气泡跟着停靠的角走
    # =====================================================================
    for corner in ['tr', 'tl', 'bl', 'br']:
        pg, errs = page(items, corner=corner)
        ev = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
        small = rect(pg, '#shell')
        hidden_tf = ev('getComputedStyle(document.getElementById("panel")).transform')
        ev('onAct("big-open", document.body)'); pg.wait_for_timeout(250)
        growing = rect(pg, '#shell')
        pg.wait_for_timeout(600)
        big = rect(pg, '#shell')
        left, bottom = corner[1] == 'l', corner[0] == 'b'
        fixed_x = (near(big['l'], 24) and near(growing['l'], 24)) if left else (near(big['r'], VW - 24) and near(growing['r'], VW - 24))
        fixed_y = (near(big['b'], VH - 24) and near(growing['b'], VH - 24)) if bottom else (near(big['t'], 24) and near(growing['t'], 24))
        check('%s: month view grows away from the docked corner (%s, %s) to 768×640' % (corner, '往右' if left else '往左', '往上' if bottom else '往下'), fixed_x and fixed_y and near(big['w'], 768) and near(big['h'], 640) and small['w'] < growing['w'] <= 768.5, [small, growing, big])
        check('%s: animation origin and slide direction follow the corner' % corner, ev('getComputedStyle(document.getElementById("big")).transformOrigin') == ('%spx %spx' % ('0' if left else '768', '640' if bottom else '0'))
              and hidden_tf == ('matrix(1, 0, 0, 1, %d, 0)' % (-28 if left else 28)), [ev('getComputedStyle(document.getElementById("big")).transformOrigin'), hidden_tf])
        # 月视图里点一条：气泡贴着那一格，整个在玻璃里
        ev('S.date = %s; S.vm = { y: %d, m: %d }; render()' % (json.dumps(D(2)), int(D(2)[:4]), int(D(2)[5:7]) - 1)); pg.wait_for_timeout(200)
        pg.click('#big-grid .line[data-id="e1"]'); pg.wait_for_timeout(700)
        pn = rect(pg, '#panel'); cell = rect(pg, '#big-grid .cell[data-date="%s"]' % D(2))
        st = ev('(() => { const s = document.getElementById("panel").style; return { l: s.left, r: s.right, t: s.top, b: s.bottom }; })()')
        check('%s: month bubble hugs its cell and stays inside the glass' % corner, (near(pn['l'], cell['r'] + 12, 1.5) or near(pn['r'], cell['l'] - 12, 1.5)) and pn['t'] >= big['t'] + 11 and pn['b'] <= big['b'] - 11 and pn['l'] >= big['l'] and pn['r'] <= big['r'], [pn, cell])
        check('%s: bubble is positioned from the docked edges' % corner, bool(st['l']) == left and bool(st['r']) == (not left) and bool(st['b']) == bottom and bool(st['t']) == (not bottom), st)
        ev('closePanels()'); pg.wait_for_timeout(300)
        # 周视图：同一块玻璃；拖一下照常能用；气泡贴着那一列
        pg.click('#big-v-week'); pg.wait_for_timeout(900)
        wk = rect(pg, '#shell')
        ev('document.getElementById("week-body").scrollTop = %d' % int(7.8 * 48)); pg.wait_for_timeout(150)
        r1 = rect(pg, '#week .wk-it[data-id="e1"]')
        stride = ev('document.querySelectorAll("#week-inner .week-col")[1].getBoundingClientRect().left - document.querySelectorAll("#week-inner .week-col")[0].getBoundingClientRect().left')
        cx, cy = r1['l'] + r1['w'] / 2, r1['t'] + r1['h'] / 2
        m = pg.mouse
        m.move(cx, cy); m.down(); pg.wait_for_timeout(40); m.move(cx + stride * 0.5, cy + 12, steps=4); m.move(cx + stride, cy + 24, steps=6); pg.wait_for_timeout(80); m.up(); pg.wait_for_timeout(500)
        moved = ev('(() => { const it = find("e1"); return [it.date, it.start, it.end]; })()')
        check('%s: week view in the same place and size; dragging still works' % corner, [round(wk[k]) for k in 'ltwh'] == [round(big[k]) for k in 'ltwh'] and moved == [D(3), '09:30', '10:30'], [wk, moved])
        r1 = rect(pg, '#week .wk-it[data-id="e1"]')
        pg.mouse.click(r1['l'] + r1['w'] / 2, r1['t'] + r1['h'] / 2); pg.wait_for_timeout(700)
        pn = rect(pg, '#panel'); col = rect(pg, '#week-inner .week-col[data-date="%s"]' % D(3))
        check('%s: week bubble hugs its column and stays inside the glass' % corner, ev('S.sel') == 'e1' and (near(pn['l'], col['r'] + 12, 1.5) or near(pn['r'], col['l'] - 12, 1.5)) and pn['t'] >= big['t'] + 11 and pn['b'] <= big['b'] - 11 and pn['l'] >= big['l'] and pn['r'] <= big['r'], [pn, col])
        if corner == 'bl': pg.screenshot(path=OUT + 'v81-bl-week.png')
        if corner == 'tl': pg.screenshot(path=OUT + 'v81-tl-week.png')
        ev('closePanels()'); pg.wait_for_timeout(300)
        # 收起：回到原来的角；折叠日历、迷你条变矮时靠的那条边不动
        pg.keyboard.press('Escape'); pg.wait_for_timeout(800)
        back = rect(pg, '#shell')
        ev('S.compact = "card"; render()'); pg.wait_for_timeout(700)
        card = rect(pg, '#shell')
        check('%s: collapses back to the corner; the mini card shrinks towards it' % corner, [round(back[k]) for k in 'ltwh'] == [round(small[k]) for k in 'ltwh'] and card['h'] < 300
              and (near(card['l'], 24) if left else near(card['r'], VW - 24)) and (near(card['b'], VH - 24) if bottom else near(card['t'], 24)), [back, card])
        # 小组件旁边的详情（不是气泡）：在靠屏幕里面的那一侧，上下和小组件同一头对齐
        ev('S.compact = ""; render(); openDetail("e2", false)'); pg.wait_for_timeout(700)
        sh, pn = rect(pg, '#shell'), rect(pg, '#panel')
        st = ev('(() => { const s = document.getElementById("panel").style; return [s.left, s.right, s.top, s.bottom].join("|"); })()')
        check('%s: detail beside the widget on the inner side, aligned to the docked edge' % corner, (near(pn['l'], sh['r'] + 16) if left else near(pn['r'], sh['l'] - 16)) and (near(pn['b'], VH - 24) if bottom else near(pn['t'], 24)) and st == '|||', [sh, pn, st])
        # 提示条在小组件下沿之内
        ev('closePanels(); showToast("已删除", "撤销", () => {})'); pg.wait_for_timeout(300)
        ts = rect(pg, '#toast')
        check('%s: toast stays over the widget' % corner, ts['l'] >= sh['l'] and ts['r'] <= sh['r'] and ts['b'] <= sh['b'] and ts['t'] >= sh['t'], ts)
        check('%s: no page errors' % corner, not errs, errs)
        pg.context.close()
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
