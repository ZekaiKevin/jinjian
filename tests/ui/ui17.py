# 0.9.0：附件 Batch 2 要求的界面验证，外加 Batch 1 里和界面打交道的几处。
#   一、事务级撤销 / 重做（本机）：新建、改、勾选、删除（子任务深拷贝）、输入框里的 Ctrl + Z 归系统、输入法组字不写
#   二、撤销和 iCloud 打通：没传的直接撤回那次上传、传了的反向 PUT、删了没去删的撤回删除
#   三、周视图：待办栏拖进时间轴变成时间块（勾哪一端都是同一条）、时间轴 ↔ 顶部一行、拖到边上停一下翻周
#   四、1280×720 / 1366×768 配 150%（矮屏）：底栏不被截断，展开的视图、设置不出屏
#   五、1080×1920 配 150%（竖屏）：不横向溢出，详情 / 设置不出窗口
#   六、0% 全透明（.bare）：没有半透明的字、没有白雾；三区测光；小色块跟着隐去
#   七、“跟随壁纸”配色：对比度够 4.5:1；日历色上的字自动选黑白
#   八、Ctrl + K、记一笔小胶囊、导入预览、节假日跳过
import datetime, json, os, re, warnings
warnings.filterwarnings('ignore')
from playwright.sync_api import sync_playwright
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
WP = 'https://local.test/wp.png'
CAL = 'https://p42-caldav.icloud.com.cn:443/123/calendars/'
SYNC = {'on': True, 'user': 'me@icloud.com', 'cals': [], 'target': ''}
TODAY = datetime.date.today()
def D(n=0): return (TODAY + datetime.timedelta(days=n)).isoformat()

ok = True
def check(name, cond, extra=''):
    global ok
    if not cond: ok = False
    print(('PASS ' if cond else 'FAIL ') + name, str(extra) if extra != '' else '')

def settings(**kw):
    s = {'theme': 'dark', 'tint': 50, 'blur': True, 'carry': False, 'autostart': False, 'top': False, 'sync': {'on': False, 'user': '', 'cals': [], 'target': ''}}
    s.update(kw); return s
def event(id, date, title, **kw):
    e = {'id': id, 'kind': 'event', 'date': date, 'title': title, 'start': '09:00', 'end': '10:00', 'place': '', 'notes': '', 'subs': [], 'remind': 'none'}
    e.update(kw); return e
def todo(id, date, title, **kw):
    t = {'id': id, 'kind': 'todo', 'date': date, 'title': title, 'done': False, 'star': False, 'due': '', 'place': '', 'notes': '', 'subs': []}
    t.update(kw); return t

# 合成壁纸：从上到下几段颜色（横向一样）
def wallpaper(name, bands, size=(1536, 960)):
    img = Image.new('RGB', size)
    h = size[1]; y = 0
    for frac, rgb in bands:
        y2 = min(h, y + int(round(h * frac)))
        img.paste(rgb, (0, y, size[0], y2)); y = y2
    if y < h: img.paste(bands[-1][1], (0, y, size[0], h))
    path = '/tmp/jinjian-wp-' + name + '.png'
    img.save(path); return path

CONTRAST = '''(a) => {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const x = lum(a[0]), y = lum(a[1]);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}'''
def hex2rgb(h):
    h = h.strip().lstrip('#'); return [int(h[i:i + 2], 16) for i in (0, 2, 4)]

with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])

    def page(items, sync=False, view=(1536, 960), screen=None, dpr=1, geo=None, wp=None, note='', **kw):
        ctx = b.new_context(viewport={'width': view[0], 'height': view[1]}, screen={'width': (screen or view)[0], 'height': (screen or view)[1]},
                            device_scale_factor=dpr, timezone_id='Asia/Shanghai')
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        path = wp or (HERE + 'assets/wallpaper.jpg')
        pg.route(WP, lambda r: r.fulfill(path=path, headers={'Content-Type': 'image/png' if path.endswith('.png') else 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
        seed = json.dumps({'version': 2, 'items': items, 'note': note, 'settings': settings(**kw)})
        init = 'window.__SEED = %s; window.__WP = %s;' % (json.dumps(seed), json.dumps(WP))
        if geo: init += geo
        pg.add_init_script(init)
        pg.add_init_script(path=HERE + 'mock_cn.js')
        pg.goto('file://' + ROOT + '/src/index.html')
        pg.wait_for_timeout(1000)
        if sync:
            pg.evaluate('S.settings.sync = %s; syncNow(true)' % json.dumps(SYNC)); pg.wait_for_timeout(1500)
        return pg, errs

    def blur(pg):
        pg.evaluate('document.activeElement && document.activeElement.blur && document.activeElement.blur()')

    # =====================================================================
    # 一、撤销 / 重做（本机）
    # =====================================================================
    items = [todo('t1', D(), '交报销', subs=[{'id': 's1', 'text': '贴发票', 'done': True}, {'id': 's2', 'text': '找签字', 'done': False}]), todo('t2', D(), '取快递')]
    pg, errs = page(items)
    ev = pg.evaluate
    titles = lambda: ev('S.items.map((x) => x.title)')

    # 记一笔：识别出来的排成小胶囊；点掉“地点”那一个，它就回到标题里
    pg.fill('#quick-input', '明天下午3点 开会 立德407'); pg.wait_for_timeout(250)
    chips = ev('[...document.querySelectorAll("#quick-chips .qchip")].map((c) => c.textContent)')
    check('记一笔：日期、时间、地点各一个胶囊', any('15:00' in c for c in chips) and '立德407' in chips and any('月' in c for c in chips), chips)
    pg.click('#quick-chips .qchip[data-k="place"]'); pg.wait_for_timeout(150)
    check('点掉地点胶囊：它变成划掉的样子', ev('document.querySelector("#quick-chips .qchip[data-k=place]").classList.contains("off")'))
    pg.click('#quick-chips .qchip[data-k="place"]'); pg.wait_for_timeout(150)
    pg.press('#quick-input', 'Enter'); pg.wait_for_timeout(300)
    made = ev('S.items.find((x) => x.title === "开会")')
    check('回车：存成日程，地点也存上了', made and made['place'] == '立德407' and made['start'] == '15:00' and made['date'] == D(1), made)
    blur(pg)
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(250)
    check('Ctrl+Z：刚记的那一条没了', '开会' not in titles(), titles())
    pg.keyboard.press('Control+Shift+z'); pg.wait_for_timeout(250)
    check('Ctrl+Shift+Z：又回来了', '开会' in titles())
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(200)
    pg.keyboard.press('Control+y'); pg.wait_for_timeout(200)
    check('Ctrl+Y 也是重做', '开会' in titles())

    # 勾选完成 → 撤销
    pg.click('#todos [data-act="toggle"][data-id="t2"]'); pg.wait_for_timeout(300)
    check('勾选完成', ev('find("t2").done') is True)
    blur(pg); pg.keyboard.press('Control+z'); pg.wait_for_timeout(300)
    check('Ctrl+Z：取消完成', ev('find("t2").done') is False)

    # 删除 → 撤销：子任务原样回来，而且是一份新的（不和删之前共用同一个对象）
    ev('window.__oldSubs = find("t1").subs')
    ev('openDetail("t1", false)'); pg.wait_for_timeout(400)
    pg.click('#p-del'); pg.wait_for_timeout(400)
    check('删除了', ev('!find("t1")'))
    blur(pg); pg.keyboard.press('Control+z'); pg.wait_for_timeout(300)
    back = ev('find("t1")')
    check('撤销删除：子任务原样回来', back and [s['text'] for s in back['subs']] == ['贴发票', '找签字'] and back['subs'][0]['done'] is True, back and back['subs'])
    check('撤销删除：子任务是新的一份，不和删之前共用', ev('find("t1").subs !== window.__oldSubs && find("t1").subs[0] !== window.__oldSubs[0]'))
    check('撤销删除：回到原来的位置', ev('S.items.findIndex((x) => x.id === "t1")') == 0)

    # 详情里连着打字是一步；输入法组字时一个字都不写
    ev('openDetail("t2", false)'); pg.wait_for_timeout(400)
    ev('''() => { const el = document.getElementById("p-title");
      el.dispatchEvent(new CompositionEvent("compositionstart"));
      el.value = "qu kuai di"; el.dispatchEvent(new InputEvent("input", { isComposing: true, inputType: "insertCompositionText" })); }''')
    pg.wait_for_timeout(250)
    check('输入法组字时（拼音）不写进去', ev('find("t2").title') == '取快递')
    ev('''() => { const el = document.getElementById("p-title"); el.value = "取快递和信"; el.dispatchEvent(new CompositionEvent("compositionend")); }''')
    pg.wait_for_timeout(250)
    check('组完字：写进去', ev('find("t2").title') == '取快递和信')
    n0 = ev('H.sizes()[0]')
    pg.type('#p-title', '件', delay=30); pg.wait_for_timeout(250)
    check('连着打的字和前面并成一步', ev('H.sizes()[0]') == n0)
    # 光标在输入框里时 Ctrl+Z 归系统，不动别的
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(250)
    check('输入框里按 Ctrl+Z：不撤销别的改动（“开会”还在）', '开会' in titles())
    ev('setSel(null); S.panel = ""; render()'); pg.wait_for_timeout(300)
    # 便签里的 Ctrl+Z 也是系统的
    pg.click('#note'); pg.keyboard.type('abc'); pg.wait_for_timeout(150)
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(200)
    check('便签里按 Ctrl+Z：不撤销别的改动', '开会' in titles() and ev('find("t2").title').startswith('取快递'))
    blur(pg)
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(250)
    check('焦点离开便签后 Ctrl+Z：撤销的是便签', ev('S.note') == '', ev('S.note'))
    check('一、没有报错', not errs, errs[:3])
    pg.context.close()

    # =====================================================================
    # 二、撤销和 iCloud 打通
    # =====================================================================
    pg, errs = page([], sync=True)
    ev = pg.evaluate
    href = ev('Object.keys(S.remote.res).find((h) => h.indexOf("ONE") > 0)')
    rid = ev('R.find((x) => x.href === %s).id' % json.dumps(href))
    puts = lambda: ev('__log.dav.filter((d) => d.method === "PUT" && d.url.indexOf("ONE") > 0).length')
    dels = lambda: ev('__log.dav.filter((d) => d.method === "DELETE" && d.url.indexOf("ONE") > 0).length')
    srv = lambda: ev('__server[%s] ? __server[%s].ics : ""' % (json.dumps(href.replace('.com.cn/', '.com.cn:443/')), json.dumps(href.replace('.com.cn/', '.com.cn:443/'))))
    orig = ev('S.remote.res[%s].ics' % json.dumps(href))

    ev('openDetail(%s, false)' % json.dumps(rid)); pg.wait_for_timeout(400)
    pg.fill('#p-title', '取体检报告和化验单'); pg.wait_for_timeout(200)
    ev('setSel(null); S.panel = ""; render()'); pg.wait_for_timeout(150)
    check('改了标题：等着上传', ev('S.remote.res[%s].dirty' % json.dumps(href)) is True)
    blur(pg); pg.keyboard.press('Control+z'); pg.wait_for_timeout(2600)
    check('还没传就撤销：撤回那次上传，一个 PUT 都没发', puts() == 0, puts())
    check('还没传就撤销：.ics 原文一字不差', ev('S.remote.res[%s].ics' % json.dumps(href)) == orig)
    check('还没传就撤销：不算待上传', ev('!!S.remote.res[%s].dirty' % json.dumps(href)) is False)

    ev('openDetail(%s, false)' % json.dumps(rid)); pg.wait_for_timeout(400)
    pg.fill('#p-title', '取体检报告（下午）'); pg.wait_for_timeout(200)
    ev('setSel(null); S.panel = ""; render()'); pg.wait_for_timeout(2600)
    check('改了、传上去了', puts() == 1 and '取体检报告（下午）' in srv(), puts())
    blur(pg); pg.keyboard.press('Control+z'); pg.wait_for_timeout(2600)
    check('传了再撤销：反向 PUT，把原来那份传回去', puts() == 2 and '取体检报告（下午）' not in srv() and 'SUMMARY:取体检报告' in srv(), puts())
    check('传了再撤销：画面上也回来了', ev('R.some((x) => x.title === "取体检报告")'))

    ev('deleteItem(find(%s))' % json.dumps(rid)); pg.wait_for_timeout(100)
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(1500)
    check('删了马上撤销：一个 DELETE 都没发，服务器上还在', dels() == 0 and srv() != '', dels())
    check('删了马上撤销：画面上回来了', ev('R.some((x) => x.href === %s)' % json.dumps(href)))
    pg.keyboard.press('Control+Shift+z'); pg.wait_for_timeout(1500)
    check('重做删除：宽限期里（和撤销提示条一样长）还没去删', dels() == 0 and srv() != '', dels())
    pg.wait_for_timeout(4500)
    check('重做删除：过了宽限期真的去 iCloud 删了', dels() == 1 and srv() == '', dels())
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(2600)
    check('已经删了再撤销：重新建回来', srv() != '' and 'SUMMARY:取体检报告' in srv())
    check('缓存单独存，不在 data.json 里', '"remote"' not in ev('window.__stored || ""') and len(ev('window.__cache || ""')) > 100)
    check('二、没有报错', not errs, errs[:3])
    pg.context.close()

    # =====================================================================
    # 三、周视图：待办排成时间块、顶部一行 ↔ 时间轴、翻周
    # =====================================================================
    items = [todo('tw', D(), '写周报'), event('ew', D(), '组会', start='10:00', end='11:00'), event('ex', D(), '散步', start='18:00', end='19:00'),
             event('ea', D(), '运动会', allDay=True, start='', end='')]
    pg, errs = page(items)
    ev = pg.evaluate
    ev('onAct("big-open", document.body)'); pg.wait_for_timeout(700)
    pg.click('#big-v-week'); pg.wait_for_timeout(900)
    pg.click('#big-side'); pg.wait_for_timeout(500)
    check('待办栏打开，里面有还没排的待办', ev('!!document.querySelector("#week-side-list [data-id=tw]")'))
    keys = ev('Week.weekKeys(S.date)')
    ci = keys.index(D())
    col = lambda i: ev('(i) => { const r = document.querySelectorAll("#week-inner .week-col")[i].getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, cx: r.left + r.width / 2 }; }', i)
    ev('document.getElementById("week-body").scrollTop = 9 * 48'); pg.wait_for_timeout(150)
    y_of = lambda hm: col(0)['y'] + (int(hm[:2]) * 60 + int(hm[3:])) * 48 / 60
    def rect(sel):
        return ev('(s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }', sel)
    def drag(a, bx, by, hold=0, then=None):
        m = pg.mouse
        m.move(a['cx'], a['cy']); m.down(); pg.wait_for_timeout(40)
        m.move(a['cx'] + 6, a['cy'] + 6, steps=2)
        m.move(bx, by, steps=12); pg.wait_for_timeout(80 + hold)
        if then: m.move(then[0], then[1], steps=8); pg.wait_for_timeout(100)
        m.up(); pg.wait_for_timeout(500)

    tgt = col(ci)
    drag(rect('#week-side-list [data-id=tw]'), tgt['cx'], y_of('14:07') + 4)
    it = ev('find("tw")')
    check('待办栏 → 时间轴：变成 14:00–15:00 的时间块（吸附 15 分钟）', it['due'] == '14:00' and it.get('end') == '15:00' and it['date'] == D(), it)
    check('时间块画在时间轴上', ev('!!document.querySelector("#week-inner .wk-ev.todo[data-id=tw]")'))
    check('拖动时外壳一直保持可点击，松手后放开', ev('__log.hold.slice(-1)[0]') is False and True in ev('__log.hold'))
    pg.click('#week-inner .wk-ev.todo[data-id=tw] .wk-chk'); pg.wait_for_timeout(400)
    check('勾时间块上的圈：这条待办完成了（和列表里是同一条）', ev('find("tw").done') is True and ev('S.items.filter((x) => x.id === "tw").length') == 1)
    check('勾圈不是“打开详情”', ev('S.panel') != 'detail')
    pg.click('#week-inner .wk-ev.todo[data-id=tw] .wk-chk'); pg.wait_for_timeout(400)

    # 时间轴 → 顶部一行：变成全天；顶部一行 → 时间轴：变成有时间的
    ad = ev('(i) => { const r = document.querySelectorAll("#week-allday .wk-ad")[i].getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }', (ci + 1) % 7)
    drag(rect('#week-inner [data-id=ex]'), ad['cx'], ad['cy'])
    it = ev('find("ex")')
    check('时间轴 → 顶部一行：变成全天，换到那一天', it['allDay'] is True and it['date'] == keys[(ci + 1) % 7], it)
    drag(rect('#week-allday [data-id=ea]'), tgt['cx'], y_of('16:00') + 4)
    it = ev('find("ea")')
    check('顶部一行 → 时间轴：变成 16:00–17:00', it.get('allDay') is False and it['start'] == '16:00' and it['end'] == '17:00', it)

    # 拖到右边停一下：翻到下一周，接着拖，放下就是下一周的同一列
    body = rect('#week-body')
    a = rect('#week-inner [data-id=ew]')
    drag(a, body['x'] + body['w'] - 6, a['cy'], hold=900, then=(tgt['cx'], a['cy']))
    it = ev('find("ew")')
    nxt = (datetime.date.fromisoformat(D()) + datetime.timedelta(days=7)).isoformat()
    check('拖到右边停一下：翻到下一周，放下在下一周同一天', it['date'] == nxt and it['start'] == '10:00', it)
    check('翻周后画面停在下一周', ev('Week.weekKeys(S.date)[0]') == (datetime.date.fromisoformat(keys[0]) + datetime.timedelta(days=7)).isoformat())
    check('翻周拖动后外壳放开了', ev('__log.hold.slice(-1)[0]') is False)
    blur(pg); pg.keyboard.press('Control+z'); pg.wait_for_timeout(400)
    check('Ctrl+Z：拖动改期也能撤销', ev('find("ew").date') == D())
    check('三、没有报错', not errs, errs[:3])
    pg.screenshot(path=HERE + 'shots/ui17-week.png')
    pg.context.close()

    # =====================================================================
    # 四、矮屏幕配 150%：底栏不被截断
    # =====================================================================
    busy = [event('d%d' % i, D(), '课程 %d' % i, start='%02d:00' % (8 + i), end='%02d:50' % (8 + i)) for i in range(6)] + [todo('dt%d' % i, D(), '待办 %d' % i) for i in range(5)]
    def geo_js(mon, work, scale):
        w = min(int(round(928 * scale)), work[2])
        return ('window.__GEO = (corner) => { const work = %s; const x = corner.charAt(1) === "l" ? work[0] : work[0] + work[2] - %d; return { win: [x, work[1], %d, work[3]], mon: %s, work: work, scale: %s }; };'
                % (json.dumps(work), w, w, json.dumps(mon), scale)), (w / scale, work[3] / scale)
    for name, mon, work in [('1280×720', [0, 0, 1280, 720], [0, 0, 1280, 648]), ('1366×768', [0, 0, 1366, 768], [0, 0, 1366, 696])]:
        g, view = geo_js(mon, work, 1.5)
        vw, vh = int(view[0]), int(view[1])
        pg, errs = page(busy, view=(vw, vh), screen=(int(mon[2] / 1.5), int(mon[3] / 1.5)), dpr=1.5, geo=g)
        ev = pg.evaluate
        pg.wait_for_timeout(600)
        q = rect('#quick'); sh = rect('#shell')
        check(name + '@150%：外壳在窗口里', sh['y'] >= 0 and sh['y'] + sh['h'] <= vh + 1, (sh, vh))
        check(name + '@150%：“记一笔”整个露在外壳里', q and q['y'] >= sh['y'] and q['y'] + q['h'] <= sh['y'] + sh['h'] + 0.5, (q, sh))
        lz = ev('getComputedStyle(document.getElementById("h-lz")).fontSize')
        check(name + '@150%：头上的农历还是小字（0.8.2 在矮屏上把它一起放大成了 40px）', lz == '11px', lz)
        hit = ev('(p) => { const el = document.elementFromPoint(p[0], p[1]); return !!el && !!el.closest("#quick"); }', [q['cx'], q['cy']])
        check(name + '@150%：“记一笔”点得到（没被盖住）', hit)
        ev('onAct("big-open", document.body)'); pg.wait_for_timeout(800)
        bg = rect('#big')
        check(name + '@150%：展开的月视图不出窗口', bg['x'] >= 0 and bg['x'] + bg['w'] <= vw + 1 and bg['y'] + bg['h'] <= vh + 1, (bg, vw, vh))
        cells_ok = ev('[...document.querySelectorAll("#big .cell")].every((c) => c.scrollHeight <= c.clientHeight + 2)')
        check(name + '@150%：月视图每一格的条数按格高算，不溢出', cells_ok)
        ev('S.big = false; S.mode = "day"; render()'); pg.wait_for_timeout(600)
        pg.click('#b-settings'); pg.wait_for_timeout(700)
        st = rect('#settings')
        check(name + '@150%：设置不出窗口', st['y'] >= 0 and st['y'] + st['h'] <= vh + 1 and st['x'] >= 0 and st['x'] + st['w'] <= vw + 1, (st, vw, vh))
        check(name + '：没有报错', not errs, errs[:3])
        pg.screenshot(path=HERE + 'shots/ui17-short-%s.png' % name.replace('×', 'x'))
        pg.context.close()

    # =====================================================================
    # 五、1080×1920 竖屏配 150%
    # =====================================================================
    g, view = geo_js([0, 0, 1080, 1920], [0, 0, 1080, 1848], 1.5)
    vw, vh = int(view[0]), int(view[1])
    pg, errs = page(busy, view=(vw, vh), screen=(720, 1280), dpr=1.5, geo=g)
    ev = pg.evaluate
    over = lambda: ev('document.scrollingElement.scrollWidth')
    check('竖屏：小组件不横向溢出', over() <= vw, (over(), vw))
    ev('openDetail("d1", false)'); pg.wait_for_timeout(700)
    pn = rect('#panel')
    check('竖屏：详情不出窗口', pn['x'] >= 0 and pn['x'] + pn['w'] <= vw + 1, (pn, vw))
    ev('setSel(null); S.panel = ""; render()'); pg.wait_for_timeout(500)
    for v in ['month', 'week']:
        ev('onAct("big-open", document.body)') if v == 'month' else pg.click('#big-v-week')
        pg.wait_for_timeout(900)
        bg = rect('#big')
        check('竖屏：展开的%s视图宽度跟着窗口，不横向溢出' % ('月' if v == 'month' else '周'), bg['x'] >= 0 and bg['x'] + bg['w'] <= vw + 1 and over() <= vw, (bg, vw))
    ev('openDetail("d2", false)'); pg.wait_for_timeout(700)
    pn = rect('#panel')
    check('竖屏：周视图里的详情气泡不出窗口', pn['x'] >= 0 and pn['x'] + pn['w'] <= vw + 1, (pn, vw))
    ev('setSel(null); S.panel = ""; S.big = false; render()'); pg.wait_for_timeout(600)
    pg.click('#b-settings'); pg.wait_for_timeout(700)
    st = rect('#settings')
    check('竖屏：设置不出窗口', st['x'] >= 0 and st['x'] + st['w'] <= vw + 1, (st, vw))
    check('竖屏：没有报错', not errs, errs[:3])
    pg.screenshot(path=HERE + 'shots/ui17-portrait.png')
    pg.context.close()

    # =====================================================================
    # 六、0% 全透明（.bare）
    # =====================================================================
    past = [event('p1', D(), '早上的会', start='00:10', end='00:40'), event('p2', D(), '晚上的课', start='23:00', end='23:50'), todo('pt', D(), '买菜', done=True), todo('pt2', D(), '买花')]
    MEASURE = '''() => {
      const bad = [];
      const sels = ['.ev.past', '.meta', '.soft', '.week', '.lz', '.hint', 'h2', '.td.done .open', '.now-range', '.ev .t', '.ev .p'];
      sels.forEach((s) => document.querySelectorAll('#shell ' + s).forEach((el) => {
        if (!el.offsetParent) return;
        const c = getComputedStyle(el).color.match(/[\\d.]+/g).map(Number);
        if (c.length > 3 && c[3] < 0.999) bad.push(s + ' ' + getComputedStyle(el).color);
      }));
      const ph = getComputedStyle(document.getElementById('quick-input'), '::placeholder').color;
      const alpha = (sel, prop) => { const el = document.querySelector(sel); if (!el) return 0; const m = getComputedStyle(el)[prop].match(/[\\d.]+/g); return m && m.length > 3 ? Number(m[3]) : (getComputedStyle(el)[prop] === 'rgba(0, 0, 0, 0)' ? 0 : 1); };
      const blurs = (getComputedStyle(document.body).textShadow.match(/(-?[\\d.]+)px/g) || []).map((x) => parseFloat(x));
      const radii = [];
      for (let i = 2; i < blurs.length; i += 3) radii.push(blurs[i]);
      const weights = [...document.querySelectorAll('#shell .meta, #shell .ev .t')].filter((e) => e.offsetParent).map((e) => Number(getComputedStyle(e).fontWeight));
      return { bad: bad, ph: ph, shadow: getComputedStyle(document.body).textShadow, radii: radii,
        now: [alpha('#now', 'backgroundColor'), alpha('#now', 'borderTopColor')], note: [alpha('.note', 'backgroundColor'), alpha('.note', 'borderTopColor')],
        quick: [alpha('#quick', 'backgroundColor'), alpha('#quick', 'borderTopColor')], minWeight: Math.min.apply(null, weights.concat([999])),
        bare: document.documentElement.classList.contains('bare'), ink: document.documentElement.dataset.ink };
    }'''
    # 上面三分之一是亮云、下面是暗山：0.8.x 拿整块的平均（偏亮）判成深色字，压在暗山上看不清
    cloud = wallpaper('cloud', [(0.34, (244, 244, 248)), (0.66, (38, 48, 58))])
    pg, errs = page(past, wp=cloud, tint=0)
    ev = pg.evaluate; pg.wait_for_timeout(800)
    m = ev(MEASURE)
    check('亮云配暗山、0%：用白字（三区里最暗的一段说了算）', m['ink'] == 'light' and m['bare'], m['ink'])
    check('0%：没有半透明的字色', not m['bad'], m['bad'][:5])
    check('0%：占位字也是实色', m['ph'].startswith('rgb(') or m['ph'].endswith(', 1)'), m['ph'])
    check('0%：文字的影子是紧贴的黑影（最大 6px），没有 12px 的白雾', m['radii'] and max(m['radii']) <= 6 and 'rgba(255, 255, 255' not in m['shadow'], m['shadow'])
    check('0%：小字字重提到 500', m['minWeight'] >= 500, m['minWeight'])
    check('0%：“正在进行”、便签、记一笔的底色和边框都隐去了', max(m['now'] + m['note'] + m['quick']) < 0.01, (m['now'], m['note'], m['quick']))
    pg.screenshot(path=HERE + 'shots/ui17-bare-cloud.png')
    check('六、没有报错（亮云）', not errs, errs[:3])
    pg.context.close()
    snow = wallpaper('snow', [(1.0, (246, 246, 244))])
    pg, errs = page(past, wp=snow, tint=0)
    ev = pg.evaluate; pg.wait_for_timeout(800)
    m = ev(MEASURE)
    check('整片雪地、0%：才换深色字', m['ink'] == 'dark', m['ink'])
    check('深色字：只剩一丝贴边微光（不超过 1px），没有白雾', m['radii'] and max(m['radii']) <= 1, m['shadow'])
    check('深色字：没有半透明的字色', not m['bad'], m['bad'][:5])
    pg.screenshot(path=HERE + 'shots/ui17-bare-snow.png')
    # 壁纸重读（系统换了壁纸）：上一张的 blob 地址要释放
    ev('''() => { window.__revoked = []; const r = URL.revokeObjectURL.bind(URL); URL.revokeObjectURL = (u) => { window.__revoked.push(u); r(u); }; }''')
    ev('''() => { window.__WP = null; }''')
    pg.unroute(WP); pg.route(WP, lambda r: r.fulfill(path=cloud, headers={'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*'}))
    ev('window.__WP = %s' % json.dumps(WP))
    ev('(window.__listeners["wallpaper-changed"] || []).forEach((f) => f({}))'); pg.wait_for_timeout(1200)
    check('外壳说壁纸换了：重读，换成白字', ev('document.documentElement.dataset.ink') == 'light')
    check('重读壁纸：上一张的 blob 地址释放了', len(ev('window.__revoked')) >= 1, ev('window.__revoked'))
    check('六、没有报错（雪地）', not errs, errs[:3])
    pg.context.close()

    # =====================================================================
    # 七、跟随壁纸配色
    # =====================================================================
    dusk = wallpaper('dusk', [(0.4, (232, 122, 44)), (0.6, (22, 22, 30))])
    for theme in ['dark', 'light']:
        pg, errs = page(past, wp=dusk, theme=theme, palette='wall')
        ev = pg.evaluate; pg.wait_for_timeout(900)
        root = ev('''() => { const s = document.documentElement.style; return { pal: document.documentElement.dataset.palette, ink: document.documentElement.dataset.ink,
          accent: s.getPropertyValue("--accent"), bg: s.getPropertyValue("--bg"), ink2: s.getPropertyValue("--accent-ink"), on: s.getPropertyValue("--on-accent") }; }''')
        check('跟随壁纸（%s）：配色生效，强调色从壁纸来' % theme, root['pal'] == 'wall' and root['accent'].strip().startswith('#'), root)
        a = hex2rgb(root['accent']); bgc = [int(x) for x in root['bg'].split()]
        hue = ev('Monet.toOklch(%s)[2]' % json.dumps(a))
        check('跟随壁纸（%s）：强调色是暖色（跟着晚霞走）' % theme, 20 <= hue <= 90, hue)
        under = [255, 255, 255] if root['ink'] == 'dark' else bgc
        c1 = ev(CONTRAST, [a, under])
        check('跟随壁纸（%s）：强调色对底色 ≥ 4.5:1' % theme, c1 >= 4.5, round(c1, 2))
        c2 = ev(CONTRAST, [hex2rgb(root['on']), a])
        check('跟随壁纸（%s）：按钮上的字对强调色 ≥ 4.5:1' % theme, c2 >= 4.5, round(c2, 2))
        check('跟随壁纸（%s）：快速记录窗口拿得到这一套' % theme, ev('!!localStorage.getItem("jinjian-wall")'))
        pg.click('#b-settings'); pg.wait_for_timeout(600)
        check('设置里“跟随壁纸”是选中的', ev('document.querySelector("#s-palette [data-v=wall]").getAttribute("aria-pressed")') == 'true')
        ev('S.settings.palette = "indigo"; applySettings()'); pg.wait_for_timeout(200)
        check('换回默认配色：壁纸算的变量都拿掉', ev('document.documentElement.style.getPropertyValue("--accent")') == '')
        pg.screenshot(path=HERE + 'shots/ui17-wall-%s.png' % theme)
        check('七、没有报错（%s）' % theme, not errs, errs[:3])
        pg.context.close()
    pg, errs = page([], theme='light')
    ev = pg.evaluate
    check('日历色上的字自动选黑白：亮黄上用深色字', '--oc:#1b1408' in ev('color("#FFCC00")'))
    check('日历色上的字自动选黑白：深蓝上用白字', '--oc:#ffffff' in ev('color("#2a3a8f")'))
    acc = ev('getComputedStyle(document.documentElement).getPropertyValue("--accent")').strip()
    c = ev(CONTRAST, [hex2rgb(acc), [255, 255, 255]])
    check('深色字时默认配色的强调色调深到 ≥ 4.5:1', c >= 4.5, (acc, round(c, 2)))
    pg.context.close()

    # =====================================================================
    # 八、Ctrl + K、导入预览、节假日跳过
    # =====================================================================
    items = [event('k1', D(), '例会', start='14:00', end='15:00'), todo('k2', D(), '交周报', done=True),
             event('h1', '2026-09-21', '西语课', start='18:00', end='19:00', rrule='FREQ=WEEKLY;BYDAY=MO,TH')]
    pg, errs = page(items)
    ev = pg.evaluate
    check('Ctrl+K 指令条平时不显示', ev('!document.getElementById("cmd").classList.contains("on")'))
    pg.keyboard.press('Control+k'); pg.wait_for_timeout(500)
    check('Ctrl+K：打开，焦点在输入框里', ev('document.getElementById("cmd").classList.contains("on") && document.activeElement.id === "cmd-input"'))
    pg.keyboard.type('zhoushitu'); pg.wait_for_timeout(150); pg.keyboard.press('Enter'); pg.wait_for_timeout(900)
    check('Ctrl+K → 周视图', ev('S.big && S.week && !S.cmd'))
    pg.keyboard.press('Control+k'); pg.wait_for_timeout(400)
    pg.keyboard.type('周报'); pg.wait_for_timeout(150); pg.keyboard.press('Enter'); pg.wait_for_timeout(700)
    ex = ev('__log.exports.slice(-1)[0]')
    check('Ctrl+K → 导出完成周报（Markdown，写到“下载”）', ex and ex['name'].endswith('.md') and '交周报' in ex['text'], ex and ex['name'])
    pg.keyboard.press('Control+k'); pg.wait_for_timeout(400); pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    check('Esc 收起指令条', ev('!S.cmd'))
    ev('S.big = false; S.mode = "day"; render()'); pg.wait_for_timeout(400)

    # 导出备份 → 再导回来：全是“已有”，一条不加
    ev('exportBackup("json")'); pg.wait_for_timeout(300)
    bk = ev('__log.exports.slice(-1)[0]')
    check('导出备份：JSON，带版本号', bk['name'].endswith('.json') and json.loads(bk['text'])['appVersion'] == '0.9.0')
    ev('(t) => previewImport("备份.json", t)', bk['text']); pg.wait_for_timeout(500)
    check('导入预览：设置里显示，全是“已有”', ev('!document.getElementById("s-import").hidden') and '已有 3' in ev('document.getElementById("s-import-text").textContent') and ev('document.getElementById("s-import-go").disabled'),
          ev('document.getElementById("s-import-text").textContent'))
    ev('onAct("import-cancel", document.body)')
    n = ev('S.items.length')
    ics = ev('Backup.exportIcs([{ id: "z", kind: "event", date: "%s", title: "外面导进来的", start: "08:00", end: "09:00", subs: [] }], {})' % D(2))
    ev('(t) => previewImport("别人的.ics", t)', ics); pg.wait_for_timeout(400)
    pg.click('#s-import-go'); pg.wait_for_timeout(400)
    check('导入 .ics：新增 1 条，只存本机', ev('S.items.length') == n + 1 and ev('!S.items.find((x) => x.title === "外面导进来的").cal'))
    blur(pg); pg.keyboard.press('Control+z'); pg.wait_for_timeout(300)
    check('导入也能撤销', ev('S.items.length') == n)
    ev('setSel(null); S.panel = ""; render()')

    # 节假日跳过：国庆那一周的课不显示，关掉又回来
    ev('S.date = "2026-09-28"; render()'); pg.wait_for_timeout(200)
    vid = 'h1@2026-09-28'
    ev('openDetail(%s, false)' % json.dumps(vid)); pg.wait_for_timeout(500)
    check('重复日程的详情里有“节假日跳过”', ev('!document.getElementById("p-hol-row").hidden'))
    pg.click('#p-hol'); pg.wait_for_timeout(400)
    occ = lambda: ev('Recur.expand(S.items, "2026-09-28", "2026-10-12").map((o) => o.date)')
    check('打开：10-01、10-05 两节课跳过', occ() == ['2026-09-28', '2026-10-08', '2026-10-12'], occ())
    check('开关的状态写在按钮上', ev('document.getElementById("p-hol").getAttribute("aria-pressed")') == 'true')
    pg.click('#p-hol'); pg.wait_for_timeout(400)
    check('关掉：又回来了', occ() == ['2026-09-28', '2026-10-01', '2026-10-05', '2026-10-08', '2026-10-12'], occ())
    check('八、没有报错', not errs, errs[:3])
    pg.context.close()
    b.close()

print('ALL PASS' if ok else 'SOME FAILED')
