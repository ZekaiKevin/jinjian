# 0.8.0：展开日历里的周视图和拖拽排期。全部用真实的鼠标按下 / 移动 / 松开来走：
# 月 / 周切换（大小不变）→ 七列头（农历、休 / 班、今天）、顶部一行、时间轴、“现在”线、自动滚动、重叠并排 →
# 拖到别的天 / 别的时间（15 分钟吸附，拖的时候只动 transform、不重画）→ 拖下边缘 → 空白处拖出一段新建并输入标题 →
# 待办换天 → 点一块弹出旁边的详情 → 重复日程走“仅此次 / 此次及以后 / 全部” → Esc 取消 →
# iCloud：立刻生效 + 带版本标记上传 + 失败重试；系列里置灰的选项 → 弹回原位；跨天只读 → 弹回原位。
# 拖动时通知外壳“保持可点击”（set_hit_hold）也在这里对：按下 true，松开 false。
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
ws = t - datetime.timedelta(days=(t.weekday() + 1) % 7)          # 这一周的周日
D = lambda i: (ws + datetime.timedelta(days=i)).isoformat()      # 这一周的第 i 天（0 = 周日）
YMD = lambda i: D(i).replace('-', '')
def event(i, date, title, **kw):
    d = {'id': i, 'kind': 'event', 'date': date, 'title': title, 'start': '09:00', 'end': '10:00', 'place': '', 'notes': '', 'subs': [], 'remind': 'none'}; d.update(kw); return d
def todo(i, date, title, **kw):
    d = {'id': i, 'kind': 'todo', 'date': date, 'title': title, 'done': False, 'star': False, 'due': '', 'place': '', 'notes': '', 'subs': []}; d.update(kw); return d
def settings(**kw):
    s = {'theme': 'dark', 'tint': 50, 'blur': True, 'carry': False, 'autostart': False, 'top': False, 'sync': {'on': False, 'user': '', 'cals': [], 'target': ''}}
    s.update(kw); return s
ok = True
def check(name, cond, extra=''):
    global ok
    if not cond: ok = False
    print(('PASS ' if cond else 'FAIL ') + name, str(extra).replace('\r\n', ' / ') if extra != '' else '')
SYNC = {'on': True, 'user': 'me@icloud.com', 'cals': [], 'target': ''}
CAL = 'https://p42-caldav.icloud.com.cn:443/123/calendars/'
def vevent(uid, title, start, end):
    return '\r\n'.join(['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:' + uid, 'DTSTART;TZID=Asia/Shanghai:' + start, 'DTEND;TZID=Asia/Shanghai:' + end, 'SUMMARY:' + title, 'END:VEVENT', 'END:VCALENDAR'])

with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    def page(items, sync=False, server=None, holidays=None):
        ctx = b.new_context(viewport={'width': 1536, 'height': 960}, screen={'width': 1536, 'height': 960}, timezone_id='Asia/Shanghai')
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.route(WP, lambda r: r.fulfill(path=HERE + 'assets/wallpaper.jpg', headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
        seed = json.dumps({'version': 2, 'items': items, 'note': '', 'settings': settings()})
        pg.add_init_script('window.__SEED = %s; window.__WP = %s; window.__HOLIDAYS = %s;' % (json.dumps(seed), json.dumps(WP), json.dumps(holidays or '')))
        pg.add_init_script(path=HERE + 'mock_cn.js')
        pg.goto('file://' + ROOT + '/src/index.html')
        pg.wait_for_timeout(900)
        if sync:
            for k, v in (server or {}).items():
                pg.evaluate('(a) => { window.__server[a[0]] = { etag: a[1], ics: a[2] }; }', [k, v[0], v[1]])
            pg.evaluate('S.settings.sync = %s; syncNow(true)' % json.dumps(SYNC)); pg.wait_for_timeout(1500)
        return pg, errs

    # 这一页用的小工具
    class T:
        def __init__(self, pg):
            self.pg = pg
        def ev(self, js, arg=None):
            return self.pg.evaluate(js, arg) if arg is not None else self.pg.evaluate(js)
        def open_week(self):
            self.ev('onAct("big-open", document.body)'); self.pg.wait_for_timeout(700)
            self.pg.click('#big-v-week'); self.pg.wait_for_timeout(900)
        def scroll(self, hour):
            self.ev('document.getElementById("week-body").scrollTop = %d' % int(hour * 48)); self.pg.wait_for_timeout(120)
        def rect(self, id, zone=None):
            return self.ev('(a) => { const el = blockOf(a[0], a[1]); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }', [id, zone])
        def col(self, i):
            return self.ev('(i) => { const r = document.querySelectorAll("#week-inner .week-col")[i].getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, cx: r.left + r.width / 2 }; }', i)
        def stride(self):
            return self.col(1)['x'] - self.col(0)['x']
        def y_of(self, hm):
            h, m = hm.split(':')
            return self.col(0)['y'] + (int(h) * 60 + int(m)) * 48 / 60
        def item(self, id):
            return self.ev('(id) => { const it = find(id); return it ? { date: it.date, start: it.start, end: it.end, due: it.due, allDay: !!it.allDay, title: it.title } : null; }', id)
        def drag(self, x0, y0, x1, y1, mid=None, up=True, steps=10):
            m = self.pg.mouse
            m.move(x0, y0); m.down(); self.pg.wait_for_timeout(40)
            m.move(x0 + (x1 - x0) * 0.4, y0 + (y1 - y0) * 0.4, steps=4)
            m.move(x1, y1, steps=steps); self.pg.wait_for_timeout(80)
            res = mid() if mid else None
            if up: m.up(); self.pg.wait_for_timeout(450)
            return res
        def holds(self):
            return self.ev('window.__log.hold.slice()')
        def scope_open(self):
            return self.ev('!document.getElementById("scope").hidden')

    # =====================================================================
    # 一、本机数据：外观、排版、各种拖动
    # =====================================================================
    items = [event('e1', D(2), '评审'), event('e2', D(2), '午饭前对一下', start='09:30', end='10:30'), event('e3', D(2), '周会', start='09:00', end='09:45'),
             event('e4', D(3), '全天活动', allDay=True, start='', end=''), event('e5', D(5), '看牙', start='16:00', end='17:00', countdown=True),
             todo('t1', D(2), '交报销'), todo('t2', D(2), '取快递', due='15:30'),
             event('r', (ws + datetime.timedelta(days=4 - 14)).isoformat(), '组会', start='14:00', end='15:00', rrule='FREQ=WEEKLY')]
    pg, errs = page(items, holidays=json.dumps({'off': [D(1)], 'work': [D(6)]}))
    w = T(pg); ev = w.ev
    ev('onAct("big-open", document.body)'); pg.wait_for_timeout(700)
    size0 = ev('[document.getElementById("shell").offsetWidth, document.getElementById("shell").offsetHeight]')
    month_lz = ev('(k) => { const c = document.querySelector("#big-grid .cell[data-date=\\"" + k + "\\"]"); return c && c.querySelector(".lz") ? c.querySelector(".lz").textContent : null; }', D(2))
    check('month view: switch present, 月 pressed, no extra wording', ev('document.getElementById("big-v-month").getAttribute("aria-pressed")') == 'true'
          and ev('document.querySelector(".seg.mini").textContent.replace(/\\s+/g, "")') == '月周')
    pg.click('#big-v-week'); pg.wait_for_timeout(900)
    check('week view shown, month grid hidden', ev('!document.getElementById("week").hidden && document.getElementById("month-wrap").hidden && document.getElementById("month-days").hidden')
          and ev('document.getElementById("big-v-week").getAttribute("aria-pressed")') == 'true')
    check('same size as the month view', ev('[document.getElementById("shell").offsetWidth, document.getElementById("shell").offsetHeight]') == size0 == [768, 640], size0)
    curve = ev('getComputedStyle(document.getElementById("shell")).transitionTimingFunction + "|" + getComputedStyle(document.getElementById("big")).transitionTimingFunction')
    check('same curve as before, no overshoot (all control points within 0..1)', 'cubic-bezier' in curve and all(0 <= float(x) <= 1 for x in re.findall(r'-?\d*\.?\d+', ' '.join(re.findall(r'cubic-bezier\(([^)]*)\)', curve)))), curve)
    check('title is the week range', ev('document.getElementById("big-title").textContent') == ev('Week.rangeTitle(S.date)') and ev('document.getElementById("big").getAttribute("aria-label")') == '周视图')

    # 列头：周日开始、今天高亮、农历 / 休班角标是原来那一套
    heads = ev('[...document.querySelectorAll("#week-head .wk-day")].map(x => ({ date: x.dataset.date, today: x.classList.contains("today"), lz: x.querySelector(".lz") ? x.querySelector(".lz").textContent : "", hol: x.querySelector(".hol") ? x.querySelector(".hol").textContent + "|" + x.querySelector(".hol").className : "", wd: x.querySelector(".wk-r1 span").textContent, num: x.querySelector(".wk-num").textContent }))')
    check('seven columns, Sunday first', [h['date'] for h in heads] == [D(i) for i in range(7)] and [h['wd'] for h in heads] == ['周' + c for c in '日一二三四五六'], [h['date'] for h in heads])
    check('today highlighted (and only today)', [h['today'] for h in heads] == [D(i) == t.isoformat() for i in range(7)])
    check('lunar text reuses lunarOf', [h['lz'] for h in heads] == ev('Week.weekKeys(S.date).map(k => lunarOf(k).sub)') and all(h['lz'] for h in heads) and heads[2]['lz'] == month_lz, [h['lz'] for h in heads])
    check('休 / 班 badges reuse the same marks', heads[1]['hol'] == '休|hol off' and heads[6]['hol'] == '班|hol work' and heads[3]['hol'] == '', [h['hol'] for h in heads])
    today_i = (t.weekday() + 1) % 7
    nowline = ev('(() => { const n = document.querySelectorAll("#week-inner .wk-now"); return { n: n.length, date: n[0] ? n[0].parentElement.dataset.date : "", top: n[0] ? parseFloat(n[0].style.top) : -1, now: nowMin() }; })()')
    check('"now" line sits in today\'s column at the current time', nowline['n'] == 1 and nowline['date'] == t.isoformat() and abs(nowline['top'] - nowline['now'] * 0.8) <= 1.6, nowline)
    sc = ev('(() => { const b = document.getElementById("week-body"); return { top: b.scrollTop, max: b.scrollHeight - b.clientHeight, want: Week.scrollTop({ now: nowMin() }) }; })()')
    check('opens scrolled to now', abs(sc['top'] - min(sc['max'], sc['want'])) <= 2, sc)

    # 顶部一行、时间轴上的块和标记
    check('all-day event and untimed todo sit in the top row', ev('[...document.querySelectorAll("#week-allday .wk-chip")].map(x => x.dataset.id + "@" + x.parentElement.dataset.date).sort()') == sorted(['e4@' + D(3), 't1@' + D(2)]))
    check('timed todo is a small marker on the timeline at its time', ev('(() => { const m = document.querySelector("#week-inner .wk-mark"); return m && m.dataset.id === "t2" && m.parentElement.dataset.date === %s && parseFloat(m.style.top) === 15.5 * 48 && m.offsetHeight <= 18; })()' % json.dumps(D(2))))
    w.scroll(7.8)
    r1, r2, r3 = w.rect('e1'), w.rect('e2'), w.rect('e3')
    c2 = w.col(2)
    apart = lambda a, b_: a['x'] + a['w'] <= b_['x'] + 0.5 or b_['x'] + b_['w'] <= a['x'] + 0.5
    check('three overlapping events laid out side by side inside the column', apart(r1, r2) and apart(r1, r3) and apart(r2, r3) and all(c2['x'] - 0.5 <= r['x'] and r['x'] + r['w'] <= c2['x'] + c2['w'] + 0.5 and abs(r['w'] - (c2['w'] / 3 - 2)) < 1 for r in (r1, r2, r3)), [r1, r2, r3, c2])
    check('block position follows the time (09:00 → 432px, one hour → 47px)', abs(r1['y'] - w.y_of('09:00')) < 0.6 and abs(r1['h'] - 47) < 0.6 and abs(r2['y'] - w.y_of('09:30')) < 0.6, r1)
    check('repeating event shows this week\'s occurrence', w.rect('r@' + D(4)) is not None and abs(w.rect('r@' + D(4))['y'] - w.y_of('14:00')) < 0.6)
    pg.screenshot(path=OUT + 'v80-week.png', clip={'x': 700, 'y': 0, 'width': 836, 'height': 700})

    # ---- 点一块：详情气泡出现在它旁边 ----
    pg.mouse.click(r1['cx'], r1['cy']); pg.wait_for_timeout(600)
    geo = ev('(() => { const p = document.getElementById("panel").getBoundingClientRect(); const c = document.querySelectorAll("#week-inner .week-col")[2].getBoundingClientRect(); const a = document.querySelector("#panel .arrow").getBoundingClientRect(); return { on: document.getElementById("panel").classList.contains("on"), bubble: document.getElementById("panel").classList.contains("bubble"), sel: S.sel, left: p.left, right: p.right, top: p.top, bottom: p.bottom, colL: c.left, colR: c.right, ay: a.top + a.height / 2 }; })()')
    check('click a block: detail bubble opens right next to its column', geo['on'] and geo['bubble'] and geo['sel'] == 'e1' and abs(geo['left'] - (geo['colR'] + 12)) <= 1.5 and geo['top'] <= r1['cy'] <= geo['bottom'] and abs(geo['ay'] - r1['cy']) <= 8, geo)
    check('clicking did not move anything, hold was on then off', w.item('e1') == {'date': D(2), 'start': '09:00', 'end': '10:00', 'due': None, 'allDay': False, 'title': '评审'} and w.holds() == [True, False], w.holds())
    pg.screenshot(path=OUT + 'v80-week-bubble.png', clip={'x': 700, 'y': 0, 'width': 836, 'height': 700})
    # 右半边的列：气泡翻到左边
    pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    w.scroll(12); r5 = w.rect('e5'); pg.mouse.click(r5['cx'], r5['cy']); pg.wait_for_timeout(600)
    geo = ev('(() => { const p = document.getElementById("panel").getBoundingClientRect(); const c = document.querySelectorAll("#week-inner .week-col")[5].getBoundingClientRect(); return { sel: S.sel, right: p.right, colL: c.left }; })()')
    check('block on the right half: bubble flips to the left side', geo['sel'] == 'e5' and abs(geo['right'] - (geo['colL'] - 12)) <= 1.5, geo)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    check('Esc closes the bubble, still in week view', ev('S.panel') == '' and ev('S.big && S.week'))

    # 点列头：选中那一天（“+ 日程”就建在那天），不离开这一周
    pg.click('#week-head .wk-day[data-date="%s"]' % D(3)); pg.wait_for_timeout(300)
    check('click a column head: that day is selected', ev('S.date') == D(3) and ev('[...document.querySelectorAll("#week-head .wk-day.sel")].map(x => x.dataset.date)') == [D(3)] and ev('document.querySelector("#week-head .wk-day").dataset.date') == D(0))

    # ---- 拖到别的天、别的时间：15 分钟吸附；拖的时候只动 transform，不重画 ----
    w.scroll(7.8); ev('window.__log.hold.length = 0')
    r1 = w.rect('e1'); st = w.stride()
    tf = lambda s: [round(float(x), 1) for x in re.findall(r'-?\d+\.?\d*', s or '')]
    ev('blockOf("e1").__mark = 1; window.__html0 = document.getElementById("week-inner").innerHTML.length; window.__mut = 0; window.__mo = new MutationObserver((l) => { l.forEach((m) => { if (m.type === "childList" && !(m.target.classList && m.target.classList.contains("wk-time"))) window.__mut += 1; }); }); window.__mo.observe(document.getElementById("week"), { childList: true, subtree: true })')
    def mid_move():
        ev('render()')   # 20 秒一次的刷新正好在拖的时候来了
        return ev('(() => { const el = blockOf("e1"); return { mark: el.__mark, tf: el.style.transform, cls: el.className, mut: window.__mut, hold: window.__log.hold.slice(), time: el.querySelector(".wk-time").textContent, stale: drag && drag.stale }; })()')
    # 往右两列、往下 100 分钟（80 像素）→ 10:40 → 吸附到 10:45
    m = w.drag(r1['cx'], r1['cy'], r1['cx'] + 2 * st, r1['cy'] + 80, mid=mid_move)
    check('while dragging: same node, moved by transform only, snapped to the 15-minute grid', m['mark'] == 1 and tf(m['tf']) == [round(2 * st, 1), 84.0] and m['tf'].startswith('translate(') and 'dragging' in m['cls'] and m['mut'] == 0, m)
    check('while dragging: the block shows where it will land; a refresh in the middle is put off', m['time'] == '10:45–11:45' and m['stale'] is True, m)
    check('while dragging: shell told to stay clickable', m['hold'] == [True], m['hold'])
    check('dropped: other day, snapped time, same length', w.item('e1') == {'date': D(4), 'start': '10:45', 'end': '11:45', 'due': None, 'allDay': False, 'title': '评审'}, w.item('e1'))
    check('dropped: shell released, saved, no detail popped open by the trailing click', w.holds() == [True, False] and ev('S.sel') is None and D(4) in ev('window.__stored') and ev('JSON.parse(window.__stored).items.find(x => x.id === "e1").start') == '10:45', w.holds())
    check('dropped: block redrawn in the new column at the new time', abs(w.rect('e1')['y'] - w.y_of('10:45')) < 0.6 and abs(w.rect('e1')['x'] - (w.col(4)['x'] + 1)) < 0.6 and ev('blockOf("e1").style.transform') == '', w.rect('e1'))
    ev('window.__mo.disconnect()')
    pg.wait_for_timeout(350)
    r2, r3 = w.rect('e2'), w.rect('e3')
    check('the two left behind re-flow to half a column each', abs(r2['w'] - (c2['w'] / 2 - 2)) < 1 and abs(r3['w'] - (c2['w'] / 2 - 2)) < 1 and apart(r2, r3), [r2, r3])

    # ---- 鼠标拖出小组件：不丢，回来照样放得下；出界时按最边上那一列算 ----
    ev('window.__log.hold.length = 0')
    shell = ev('(() => { const r = document.getElementById("shell").getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()')
    def mid_out():
        return ev('(() => { const el = blockOf("e2"); return { tf: el.style.transform, hold: window.__log.hold.slice(), active: !!(drag && drag.active) }; })()')
    m = w.drag(r2['cx'], r2['cy'], shell['l'] - 300, r2['cy'], mid=mid_out)
    check('pointer far outside the widget: drag still alive, hold still on, clamped to the first column', m['active'] and m['hold'] == [True] and tf(m['tf']) == [round(-2 * st, 1), 0.0], m)
    check('released outside: lands on Sunday, time untouched, hold released', w.item('e2')['date'] == D(0) and w.item('e2')['start'] == '09:30' and w.item('e2')['end'] == '10:30' and w.holds() == [True, False], [w.item('e2'), w.holds()])

    # ---- 拖下边缘：改结束时间 ----
    r3 = w.rect('e3')
    def mid_size():
        return ev('(() => { const el = blockOf("e3"); return { h: el.style.height, tf: el.style.transform, cls: document.getElementById("week").className, time: el.querySelector(".wk-time").textContent }; })()')
    m = w.drag(r3['cx'], r3['y'] + r3['h'] - 3, r3['cx'] + 60, r3['y'] + r3['h'] - 3 + 58, mid=mid_size)   # 09:45 往下 72.5 分钟 → 10:57.5 → 11:00
    check('resize: only the height changes while dragging', m['h'] == '95px' and m['tf'] == '' and 'sizing' in m['cls'] and m['time'] == '09:00–11:00', m)
    check('resize: end time snapped, start and day untouched', w.item('e3') == {'date': D(2), 'start': '09:00', 'end': '11:00', 'due': None, 'allDay': False, 'title': '周会'}, w.item('e3'))
    r3 = w.rect('e3')
    w.drag(r3['cx'], r3['y'] + r3['h'] - 3, r3['cx'], r3['y'] - 200)
    check('dragging past the top edge scrolls the timeline by itself', ev('document.getElementById("week-body").scrollTop') < 7.8 * 48 - 40, ev('document.getElementById("week-body").scrollTop'))
    check('resize upwards past the start: stops at 15 minutes', w.item('e3')['end'] == '09:15' and w.item('e3')['start'] == '09:00', w.item('e3'))

    # ---- 在空白处按下拖出一段：新建，立刻输入标题 ----
    n0 = ev('S.items.length')
    w.scroll(7.8)   # 刚才往上拖出了时间轴，它自己跟着滚上去了
    c6 = w.col(6)
    pg.mouse.click(c6['cx'], w.y_of('12:00')); pg.wait_for_timeout(300)
    check('a plain click on blank creates nothing', ev('S.items.length') == n0 and ev('S.panel') == '')
    def mid_new():
        return ev('(() => { const g = document.querySelector("#week-inner .wk-ghost"); return g ? { date: g.parentElement.dataset.date, top: g.style.top, h: g.style.height, text: g.textContent } : null; })()')
    m = w.drag(c6['cx'], w.y_of('13:10'), c6['cx'] + 150, w.y_of('14:20'), mid=mid_new)
    check('drag on blank: ghost covers the dragged slots, stays in its own day', m == {'date': D(6), 'top': '624px', 'h': '72px', 'text': '13:00–14:30'}, m)
    fresh = ev('S.items[S.items.length - 1]')
    check('released: new event with that time, detail open with the title focused', ev('S.items.length') == n0 + 1 and fresh['date'] == D(6) and fresh['start'] == '13:00' and fresh['end'] == '14:30' and fresh['kind'] == 'event'
          and ev('S.sel') == fresh['id'] and ev('S.panel') == 'detail' and ev('document.activeElement.id') == 'p-title' and ev('document.querySelector("#week-inner .wk-ghost")') is None, fresh)
    pg.keyboard.type('和导师聊开题'); pg.wait_for_timeout(100)
    pg.screenshot(path=OUT + 'v80-week-new.png', clip={'x': 700, 'y': 0, 'width': 836, 'height': 700})
    pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
    check('typed a title, Enter: kept', ev('S.panel') == '' and w.item(fresh['id'])['title'] == '和导师聊开题' and ev('blockOf(%s).querySelector(".wk-t").textContent' % json.dumps(fresh['id'])) == '和导师聊开题')
    m = w.drag(c6['cx'], w.y_of('16:00'), c6['cx'], w.y_of('15:20'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    check('dragged upwards works too; left without a title it is not kept', ev('S.items.length') == n0 + 1 and ev('S.panel') == '', ev('S.items.length'))

    # ---- 待办：没时间的在顶部一行拖到别的天；有时间的小标记也只换天 ----
    rt = w.rect('t1')
    # 0.9.0：往下拖进时间轴就是排成时间块了（三、ui17 测），这里只是横着拖、手往下偏一点
    m = w.drag(rt['cx'], rt['cy'], rt['cx'] + 3 * st, rt['cy'] + 6, mid=lambda: ev('blockOf("t1").style.transform'))
    check('untimed todo dragged along the top row to another day', tf(m) == [round(3 * st, 1), 0.0] and w.item('t1')['date'] == D(5) and ev('blockOf("t1").parentElement.dataset.date') == D(5), [m, w.item('t1')])
    rm = w.rect('t2')
    w.drag(rm['cx'], rm['cy'], rm['cx'] - st, rm['cy'] + 90)
    check('timed todo marker: day changes, due time stays', w.item('t2')['date'] == D(1) and w.item('t2')['due'] == '15:30' and ev('blockOf("t2").parentElement.dataset.date') == D(1), w.item('t2'))
    ra = w.rect('e4')
    w.drag(ra['cx'], ra['cy'], ra['cx'] - 2 * st, ra['cy'])
    check('all-day event dragged to another day stays all-day', w.item('e4')['date'] == D(1) and w.item('e4')['allDay'] is True, w.item('e4'))

    # ---- Esc：拖到一半取消 ----
    ev('window.__log.hold.length = 0')
    r1 = w.rect('e1')
    w.drag(r1['cx'], r1['cy'], r1['cx'] - st, r1['cy'] + 60, up=False)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(450)
    check('Esc in the middle of a drag: nothing changes, hold released, still in week view', w.item('e1')['date'] == D(4) and w.item('e1')['start'] == '10:45' and w.holds() == [True, False] and ev('drag') is None and ev('S.big && S.week') and ev('blockOf("e1").style.transform') == '', [w.item('e1'), w.holds()])
    pg.mouse.up(); pg.wait_for_timeout(200)

    # ---- 重复日程的某一次：走原来的“仅此次 / 此次及以后 / 全部” ----
    occ = 'r@' + D(4)
    ro = w.rect(occ)
    w.drag(ro['cx'], ro['cy'], ro['cx'], ro['cy'] + 24)   # 往下 30 分钟
    pending = ev('(() => { const a = S.ask; const el = blockOf(%s); return { ask: a && a.mode, patch: a && a.patch, drag: a && a.drag, sel: S.sel, panel: S.panel, labels: [...document.querySelectorAll("#scope button")].map(x => x.textContent.trim()), off: [...document.querySelectorAll("#scope button[aria-disabled=true]")].length, top: parseFloat(el.style.top), pstart: document.getElementById("p-start").value }; })()' % json.dumps(occ))
    check('drag one occurrence: the usual scope bubble asks, nothing written yet', w.scope_open() and pending['ask'] == 'edit' and pending['patch'] == {'start': '14:30', 'end': '15:30'} and pending['sel'] == occ and pending['panel'] == 'detail'
          and pending['labels'] == ['仅此次', '此次及以后', '全部'] and pending['off'] == 0 and ev('S.items.find(x => x.id === "r").start') == '14:00' and not ev('S.items.find(x => x.id === "r").overrides'), pending)
    check('while asking: block waits at the dropped place, detail shows the pending time', pending['top'] == 14.5 * 48 and pending['pstart'] == '14:30', pending)
    pg.screenshot(path=OUT + 'v80-week-scope.png', clip={'x': 700, 'y': 0, 'width': 836, 'height': 700})
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    check('Esc at the question: springs back, series untouched', not w.scope_open() and abs(w.rect(occ)['y'] - w.y_of('14:00')) < 0.6 and ev('S.items.find(x => x.id === "r").start') == '14:00' and not ev('S.items.find(x => x.id === "r").overrides') and ev('document.getElementById("p-start").value') == '14:00')
    ro = w.rect(occ)
    w.drag(ro['cx'], ro['cy'], ro['cx'], ro['cy'] + 24)
    pg.click('#scope button[data-v="one"]'); pg.wait_for_timeout(500)
    master = ev('S.items.find(x => x.id === "r")')
    check('仅此次: only this occurrence moves (override on the master)', master['start'] == '14:00' and master.get('overrides', {}).get(D(4), {}).get('start') == '14:30' and abs(w.rect(occ)['y'] - w.y_of('14:30')) < 0.6
          and ev('Recur.expand(S.items, %s, %s).filter(o => o.title === "组会").map(o => o.start)' % (json.dumps(D(7)), json.dumps(D(13)))) == ['14:00'], master)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # 下一周的那一场：拖到前一天，选“此次及以后”
    pg.click('#big-next'); pg.wait_for_timeout(700)
    check('next week: title and columns move on a week', ev('document.getElementById("big-title").textContent') == ev('Week.rangeTitle(%s)' % json.dumps(D(9))) and ev('document.querySelector("#week-head .wk-day").dataset.date') == D(7) and ev('document.querySelectorAll("#week-inner .wk-now").length') == 0)
    sc = ev('document.getElementById("week-body").scrollTop')
    check('a week without today opens near its first event (14:00)', abs(sc - (14 * 48 - 96)) <= 2, sc)
    w.scroll(11)
    occ2 = 'r@' + D(11)
    ro = w.rect(occ2)
    w.drag(ro['cx'], ro['cy'], ro['cx'] - st, ro['cy'])
    check('other week: asks again', w.scope_open() and ev('S.ask.patch') == {'date': D(10)})
    pg.click('#scope button[data-v="future"]'); pg.wait_for_timeout(500)
    series = ev('S.items.filter(x => x.title === "组会").map(x => ({ date: x.date, rrule: x.rrule }))')
    check('此次及以后: the series is split, later ones follow the new weekday', len(series) == 2 and any('UNTIL' in s['rrule'] for s in series) and any(s['date'] == D(10) for s in series)
          and ev('Recur.expand(S.items, %s, %s).filter(o => o.title === "组会").map(o => o.date)' % (json.dumps(D(14)), json.dumps(D(20)))) == [D(17)], series)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.click('#big-prev'); pg.wait_for_timeout(700)
    check('back to this week', ev('document.querySelector("#week-head .wk-day").dataset.date') == D(0))

    # ---- 还在问范围时又去拖别的：前一个不算，弹回去；后一个照常 ----
    w.scroll(7.8)
    occ = 'r@' + D(4)
    ro = w.rect(occ); y_before = ro['y']
    w.drag(ro['cx'], ro['cy'], ro['cx'], ro['cy'] - 48)
    check('asks again (the answer is remembered only while that occurrence stays selected)', w.scope_open() and ev('S.ask.patch.start') == '13:30', w.item(occ))
    r2 = w.rect('e2')
    w.drag(r2['cx'], r2['cy'], r2['cx'], r2['cy'] + 48)
    check('press another block while the question is up: the pending one springs back, the new drag goes through',
          not w.scope_open() and abs(w.rect(occ)['y'] - y_before) < 0.6 and w.item(occ)['start'] == '14:30' and w.item('e2')['start'] == '10:30', [w.item(occ), w.item('e2')])

    # ---- 详情气泡跟着时间轴滚；那一块滚出去了就贴在可视范围的边上 ----
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    w.scroll(7.8)
    r1 = w.rect('e1'); pg.mouse.click(r1['cx'], r1['cy']); pg.wait_for_timeout(600)
    arrow = lambda: ev('(() => { const a = document.querySelector("#panel .arrow").getBoundingClientRect(); return a.top + a.height / 2; })()')
    a0 = arrow()
    w.scroll(8.8); pg.wait_for_timeout(600)
    check('scroll the timeline: the bubble arrow follows the block', abs(arrow() - (a0 - 48)) <= 2 and abs(arrow() - w.rect('e1')['cy']) <= 8, [a0, arrow(), w.rect('e1')['cy']])
    w.scroll(16); pg.wait_for_timeout(600)
    body_top = ev('document.getElementById("week-body").getBoundingClientRect().top')
    check('block scrolled out of sight: bubble stays, pinned to the edge of the timeline', ev('S.sel') == 'e1' and w.rect('e1')['cy'] < body_top and abs(arrow() - (body_top + 12)) <= 2, [arrow(), body_top])
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # ---- 按住不放超过 5 秒：给外壳续一次“保持可点击” ----
    w.scroll(7.8); ev('window.__log.hold.length = 0')
    r1 = w.rect('e1')
    w.drag(r1['cx'], r1['cy'], r1['cx'], r1['cy'] + 12, up=False)
    pg.wait_for_timeout(5300)
    check('held for more than 5 s: hold renewed', w.holds() == [True, True], w.holds())
    pg.mouse.up(); pg.wait_for_timeout(400)
    check('released: hold off, no more renewals', w.holds() == [True, True, False] and w.item('e1')['start'] == '11:00', [w.holds(), w.item('e1')])
    pg.wait_for_timeout(5300)
    check('nothing renewed after release', w.holds() == [True, True, False], w.holds())

    # ---- 没受影响的：搜索、倒数日条、月视图的农历 ----
    pg.keyboard.press('Control+f'); pg.wait_for_timeout(500)
    pg.keyboard.type('看牙'); pg.wait_for_timeout(300)
    check('Ctrl+F works from the week view', ev('S.search') and ev('document.querySelectorAll("#search .hit").length') == 1)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(700)
    w.scroll(12)
    check('opening the hit: back in the week view with its bubble', ev('S.big && S.week && !S.search') and ev('S.sel') == 'e5' and ev('document.getElementById("panel").classList.contains("bubble")') and ev('blockOf("e5").classList.contains("sel")'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.click('#big-v-month'); pg.wait_for_timeout(600)
    check('back to month: grid and lunar badges as before', ev('!document.getElementById("month-wrap").hidden && document.getElementById("week").hidden') and ev('document.querySelectorAll("#big-grid .cell .lz").length') >= 28
          and ev('(k) => document.querySelector("#big-grid .cell[data-date=\\"" + k + "\\"] .lz").textContent', D(2)) == month_lz and ev('document.getElementById("big-title").textContent') == ev('(() => { const d = fromIso(S.date); return d.getFullYear() + "年" + (d.getMonth() + 1) + "月"; })()'))
    check('month: the event dragged earlier shows on its new day', ev('(k) => [...document.querySelectorAll("#big-grid .cell[data-date=\\"" + k + "\\"] .line")].map(x => x.dataset.id)', D(4)).count('e1') == 1)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(700)
    check('collapsed: countdown bar still there', ev('!S.big') and ev('[...document.querySelectorAll("#countdowns .cd")].map(x => x.dataset.id)') == ['e5'] and not ev('document.getElementById("countdowns").hidden'))
    check('no page errors (local)', not errs, errs)

    # 浅色主题截一张
    pg, errs = page(items)
    w = T(pg); ev = w.ev
    ev('S.settings.theme = "light"; applySettings(); render()'); pg.wait_for_timeout(300)
    w.open_week(); w.scroll(7.8)
    pg.screenshot(path=OUT + 'v80-week-light.png', clip={'x': 700, 'y': 0, 'width': 836, 'height': 700})
    check('no page errors (light)', not errs, errs)

    # =====================================================================
    # 二、iCloud
    # =====================================================================
    one = CAL + 'home/DRAG1.ics'
    multi = CAL + 'home/MULTI.ics'
    server = {one: ['"x1"', vevent('DRAG1', '答辩彩排', YMD(2) + 'T110000', YMD(2) + 'T120000')],
              multi: ['"m1"', vevent('MULTI', '出差', YMD(0) + 'T200000', YMD(2) + 'T080000')]}
    pg, errs = page([], sync=True, server=server)
    w = T(pg); ev = w.ev
    w.open_week(); w.scroll(8.5)
    rid = ev('(R.find(o => o.title === "答辩彩排") || {}).id')
    one = ev('(R.find(o => o.title === "答辩彩排") || {}).href')
    skey = CAL + 'home/DRAG1.ics'   # 假服务器里的键带端口
    st = w.stride()
    check('iCloud events show in the week view', w.rect(rid) is not None and abs(w.rect(rid)['y'] - w.y_of('11:00')) < 0.6 and ev('R.filter(o => o.title === "匹克球" && o.date === %s).length' % json.dumps(D(4))) == 1)
    puts = lambda: ev('window.__log.dav.filter(d => d.method === "PUT").map(d => ({ url: d.url, im: (d.headers.find(h => h[0].toLowerCase() === "if-match") || [])[1] || "" }))')
    n_put = len(puts())
    r = w.rect(rid)
    w.drag(r['cx'], r['cy'], r['cx'] + st, r['cy'] + 48)   # 后一天、晚一小时
    check('iCloud event: moved on screen at once, upload queued', w.item(rid)['date'] == D(3) and w.item(rid)['start'] == '12:00' and w.item(rid)['end'] == '13:00' and ev('S.remote.res[%s].dirty' % json.dumps(one)) is True and len(puts()) == n_put
          and abs(w.rect(rid)['y'] - w.y_of('12:00')) < 0.6 and ev('S.sel') is None, w.item(rid))
    pg.wait_for_timeout(2300)
    ps = puts()
    check('uploaded through the usual path with the version tag (If-Match)', len(ps) == n_put + 1 and 'DRAG1.ics' in ps[-1]['url'] and ps[-1]['im'] == '"x1"' and ('DTSTART:' + YMD(3) + 'T040000Z') in ev('window.__server[%s].ics' % json.dumps(skey))
          and ('DTEND:' + YMD(3) + 'T050000Z') in ev('window.__server[%s].ics' % json.dumps(skey)) and not ev('S.remote.res[%s].dirty' % json.dumps(one)), [ps[-1:], ev('window.__server[%s].ics' % json.dumps(skey))])
    # 上传失败：界面不回退，过几秒自己重试
    ev('window.__davOpts.failPut = 1')
    r = w.rect(rid)
    w.drag(r['cx'], r['cy'] + r['h'] / 2 - 3, r['cx'], r['cy'] + r['h'] / 2 - 3 + 24)   # 拖下边缘，结束晚 30 分钟
    pg.wait_for_timeout(2300)
    check('upload fails: change stays on screen, still marked to send', w.item(rid)['end'] == '13:30' and ev('S.remote.res[%s].dirty' % json.dumps(one)) is True and ('DTEND:' + YMD(3) + 'T050000Z') in ev('window.__server[%s].ics' % json.dumps(skey)), w.item(rid))
    pg.wait_for_timeout(5600)
    check('retried by itself and went through', ('DTEND:' + YMD(3) + 'T053000Z') in ev('window.__server[%s].ics' % json.dumps(skey)) and not ev('S.remote.res[%s].dirty' % json.dumps(one)) and w.item(rid)['end'] == '13:30', ev('window.__server[%s].ics' % json.dumps(skey)))

    # iCloud 的重复日程（0.9.0）：问范围的小气泡和详情里一样，三项都能选；Esc 弹回原位、什么都不发；
    # 选“全部”整组挪；Ctrl+Z 把原来那份原样传回去
    cid = ev('R.find(o => o.title === "匹克球" && o.date === %s).id' % json.dumps(D(4)))
    chref = ev('R.find(o => o.id === %s).href' % json.dumps(cid))
    ics0 = ev('S.remote.res[%s].ics' % json.dumps(chref))
    n_put = len(puts())
    r = w.rect(cid)
    w.drag(r['cx'], r['cy'], r['cx'], r['cy'] + 36)   # 晚 45 分钟
    st8 = ev('(() => ({ open: !document.getElementById("scope").hidden, off: [...document.querySelectorAll("#scope button")].map(x => [x.dataset.v, x.getAttribute("aria-disabled") === "true"]), top: parseFloat(blockOf(%s).style.top), drag: S.ask && S.ask.drag }))()' % json.dumps(cid))
    check('iCloud series: same bubble, all three choices on (0.9.0)', st8['open'] and st8['drag'] is True and st8['off'] == [['one', False], ['future', False], ['all', False]] and st8['top'] == 10.75 * 48, st8)
    pg.screenshot(path=OUT + 'v80-week-icloud-scope.png', clip={'x': 700, 'y': 0, 'width': 836, 'height': 700})
    pg.keyboard.press('Escape'); pg.wait_for_timeout(600)
    check('Esc: springs back to where it was, nothing changed', not w.scope_open() and abs(w.rect(cid)['y'] - w.y_of('10:00')) < 0.6 and w.item(cid)['start'] == '10:00'
          and ev('S.remote.res[%s].ics' % json.dumps(chref)) == ics0 and not ev('S.remote.res[%s].dirty' % json.dumps(chref)), w.item(cid))
    pg.wait_for_timeout(2000)
    check('still nothing sent', len(puts()) == n_put)
    r = w.rect(cid)
    w.drag(r['cx'], r['cy'], r['cx'], r['cy'] + 36)
    pg.click('#scope button[data-v="all"]'); pg.wait_for_timeout(2400)
    text = ev('window.__server[Object.keys(window.__server).find(k => window.__server[k].ics.indexOf("SUMMARY:匹克球") >= 0)].ics')
    later = ev('R.filter(o => o.title === "匹克球").map(o => o.start)')
    check('全部: the whole series moves to 10:45 (master DTSTART), one PUT', re.search(r'DTSTART;TZID=Asia/Shanghai:\d{8}T104500', text) is not None and 'RRULE:FREQ=WEEKLY' in text and set(later) == {'10:45'} and len(puts()) == n_put + 1, [later[:3], text])
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    ev('document.activeElement && document.activeElement.blur()')
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(2400)
    text = ev('window.__server[Object.keys(window.__server).find(k => window.__server[k].ics.indexOf("SUMMARY:匹克球") >= 0)].ics')
    check('Ctrl+Z: reverse PUT puts the exact original back', ev('S.remote.res[%s].ics' % json.dumps(chref)) == ics0 and 'T100000' in text and 'T104500' not in text and len(puts()) == n_put + 2 and w.item(cid)['start'] == '10:00', len(puts()) - n_put)
    n_put = len(puts())
    r = w.rect(cid)
    w.drag(r['cx'], r['cy'], r['cx'], r['cy'] + 36)
    pg.click('#scope button[data-v="one"]'); pg.wait_for_timeout(400)
    check('仅此次: moves on screen at once', w.item(ev('S.sel'))['start'] == '10:45' and w.item(ev('S.sel'))['date'] == D(4))
    pg.wait_for_timeout(2300)
    text = ev('window.__server[Object.keys(window.__server).find(k => window.__server[k].ics.indexOf("SUMMARY:匹克球") >= 0)].ics')
    check('仅此次: written as RECURRENCE-ID for that day, series rule kept', ('RECURRENCE-ID;TZID=Asia/Shanghai:' + YMD(4) + 'T100000') in text and ('DTSTART:' + YMD(4) + 'T024500Z') in text and 'RRULE:FREQ=WEEKLY' in text and len(puts()) == n_put + 1, text)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # 跨天的 iCloud 日程：只读，拖了弹回原位，详情里还是那句话
    parts = ev('R.filter(o => o.title === "出差").map(o => ({ id: o.id, date: o.date, parts: o.parts }))')
    check('cross-day iCloud event sits in the top row on each of its days', len(parts) == 3 and all(x['parts'] for x in parts) and ev('[...document.querySelectorAll("#week-allday .wk-chip.wk-ro")].length') == 3, parts)
    pid = [x['id'] for x in parts if x['date'] == D(1)][0]
    n_put = len(puts())
    rp = w.rect(pid, 'allday')
    w.drag(rp['cx'], rp['cy'], rp['cx'] + 3 * st, rp['cy'])
    pg.wait_for_timeout(300)
    check('cross-day: springs back, nothing changes', ev('R.filter(o => o.title === "出差").map(o => o.date)') == [D(0), D(1), D(2)] and abs(w.rect(pid, 'allday')['x'] - rp['x']) < 0.6 and ev('blockOf(%s, "allday").style.transform' % json.dumps(pid)) == '')
    check('cross-day: told the same way as in the detail', ev('S.sel') == pid and ev('S.panel') == 'detail' and not ev('document.getElementById("p-ro").hidden') and ev('document.getElementById("p-ro").textContent') == '跨天日程，请在 Apple 日历里修改')
    pg.wait_for_timeout(1900)
    check('cross-day: nothing sent', len(puts()) == n_put)
    pg.screenshot(path=OUT + 'v80-week-icloud.png', clip={'x': 700, 'y': 0, 'width': 836, 'height': 700})
    check('no page errors (iCloud)', not errs, errs)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
