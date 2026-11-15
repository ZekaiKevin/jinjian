# 0.7.1（二）：重复日程和 iCloud。用 mock_cn.js 里的假 iCloud 走真实流程：
# 本机的每周日程选 iCloud 日历 → 关详情后上传（RRULE / EXDATE / RECURRENCE-ID）→ 再同步一次读回来还是那些场次；
# iCloud 上的每周课（Apple 日历写的）改一次 → RECURRENCE-ID，删一次 → EXDATE，删以后 → UNTIL，删全部 → 整条删掉，改全部 → 只改文字；
# 做不了的（“此次及以后”的修改、改全部的时间）按钮置灰；农历重复只存本机，带小图标。
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
day = lambda off: (t + datetime.timedelta(days=off)).isoformat()
CODE = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
WD = CODE[t.weekday()]
def event(i, date, title, **kw):
    d = {'id': i, 'kind': 'event', 'date': date, 'title': title, 'start': '18:00', 'end': '19:40', 'place': '', 'notes': '', 'subs': [], 'remind': '10'}; d.update(kw); return d
def todo(i, date, title, **kw):
    d = {'id': i, 'kind': 'todo', 'date': date, 'title': title, 'done': False, 'star': False, 'due': '', 'place': '', 'notes': '', 'subs': []}; d.update(kw); return d
def settings(**kw):
    s = {'theme': 'dark', 'tint': 50, 'blur': True, 'carry': False, 'autostart': False, 'top': False, 'sync': {'on': False, 'user': '', 'cals': [], 'target': ''}}
    s.update(kw); return s
ok = True
def check(name, cond, extra=''):
    global ok
    if not cond: ok = False
    print(('PASS ' if cond else 'FAIL ') + name, extra if extra != '' else '')
SYNC = {'on': True, 'user': 'me@icloud.com', 'cals': [], 'target': ''}

with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    def page(items):
        ctx = b.new_context(viewport={'width': 1536, 'height': 960}, screen={'width': 1536, 'height': 960}, timezone_id='Asia/Shanghai')
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.route(WP, lambda r: r.fulfill(path=HERE + 'assets/wallpaper.jpg', headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
        seed = json.dumps({'version': 2, 'items': items, 'note': '', 'settings': settings()})
        pg.add_init_script('window.__SEED = %s; window.__WP = %s;' % (json.dumps(seed), json.dumps(WP)))
        pg.add_init_script(path=HERE + 'mock_cn.js')
        pg.goto('file://' + ROOT + '/src/index.html')
        pg.wait_for_timeout(900)
        pg.evaluate('S.settings.sync = %s; syncNow(true)' % json.dumps(SYNC)); pg.wait_for_timeout(1500)
        return pg, errs
    srv = lambda pg, part: pg.evaluate('(() => { const k = Object.keys(window.__server).find(k => k.indexOf(%s) >= 0); return k ? window.__server[k].ics : null; })()' % json.dumps(part))

    # ---- 1. 本机每周日程 → 选 iCloud 日历 → 上传 ----
    m = event('w', day(-7), '组会', place='明商208', rrule='FREQ=WEEKLY;BYDAY=' + WD, exdates=[day(7)],
              overrides={day(14): {'title': '组会（改到下午）', 'start': '14:00', 'end': '15:00'}}, countdown=True, subs=[{'id': 's1', 'text': '带电脑', 'done': False}])
    pg, errs = page([m, todo('t', day(0), '倒垃圾', rrule='FREQ=DAILY')])
    ev = lambda js: pg.evaluate(js)
    local_view = ev('Recur.expand(S.items, %s, %s).filter(o => o.kind === "event").map(o => [o.date, o.start, o.title]).sort()' % (json.dumps(day(-7)), json.dumps(day(60))))
    ev('openDetail(%s, false)' % json.dumps('w@' + day(0))); pg.wait_for_timeout(400)
    check('repeating event: calendar picker offered', not ev('document.getElementById("p-cal-pick").hidden') and ev('document.getElementById("p-local").hidden'))
    home = ev('S.settings.sync.cals.find(c => c.name === "个人").href')
    pg.select_option('#p-cal-pick', home); pg.wait_for_timeout(200)
    check('picked: stored on the master', ev('S.items[0].cal') == home)
    ev('closePanels()'); pg.wait_for_timeout(1500)
    text = ev('(() => { const k = Object.keys(window.__server).find(k => k.indexOf("/home/") >= 0 && k.indexOf("ONE") < 0); return k ? window.__server[k].ics : ""; })()')
    check('uploaded: one resource with RRULE, EXDATE, RECURRENCE-ID, TZID', text and 'RRULE:FREQ=WEEKLY;BYDAY=' + WD in text and 'EXDATE;TZID=Asia/Shanghai:' + day(7).replace('-', '') + 'T180000' in text
          and 'RECURRENCE-ID;TZID=Asia/Shanghai:' + day(14).replace('-', '') + 'T180000' in text and 'DTSTART;TZID=Asia/Shanghai:' + day(-7).replace('-', '') + 'T180000' in text, text)
    check('uploaded: local master gone, todo stays local', ev('S.items.map(x => x.id)') == ['t'])
    remote_view = lambda: ev('R.filter(o => o.title.indexOf("组会") === 0 && o.date <= %s).map(o => [o.date, o.start, o.title]).sort()' % json.dumps(day(60)))
    check('uploaded: same occurrences as before, now from iCloud', remote_view() == local_view, [remote_view(), local_view])
    ev('syncNow(false)'); pg.wait_for_timeout(1500)
    check('after the next sync: still the same', remote_view() == local_view)
    check('countdown and sub-tasks carried to the next occurrence', ev('[...document.querySelectorAll("#countdowns .cd")].map(x => x.dataset.id)') == [ev('R.find(o => o.title === "组会" && o.date === today()).id')]
          and ev('R.find(o => o.title === "组会" && o.date === today()).subs.length') == 1)
    check('no page errors (upload)', not errs, errs)

    # ---- 2. 农历重复：只存本机，小图标；待办没有图标 ----
    pg, errs = page([event('b', day(0), '妈妈生日', allDay=True, rrule='FREQ=YEARLY', lunar=True), todo('t', day(0), '倒垃圾', rrule='FREQ=DAILY')])
    ev = lambda js: pg.evaluate(js)
    ev('openDetail(%s, false)' % json.dumps('b@' + day(0))); pg.wait_for_timeout(400)
    check('lunar: no calendar picker, local-only icon', ev('document.getElementById("p-cal-pick").hidden') and not ev('document.getElementById("p-local").hidden'))
    pg.hover('#p-local'); pg.wait_for_timeout(700)
    check('icon tip says 只存本机', ev('document.getElementById("tip").classList.contains("on") && document.getElementById("tip").textContent') == '只存本机，不传到 iCloud')
    pg.screenshot(path=OUT + 'v71-local-icon.png', clip={'x': 700, 'y': 0, 'width': 836, 'height': 600})
    ev('closePanels()'); pg.wait_for_timeout(1200)
    check('lunar: never uploaded', ev('S.items.length') == 2 and not ev('Object.keys(window.__server).some(k => window.__server[k].ics.indexOf("妈妈生日") >= 0)'))
    ev('openDetail(%s, false)' % json.dumps('t@' + day(0))); pg.wait_for_timeout(300)
    check('repeating todo: no icon (todos are always local)', ev('document.getElementById("p-local").hidden'))
    ev('closePanels()')
    check('no page errors (lunar)', not errs, errs)

    # ---- 3. iCloud 上的每周课：改一次、改全部 ----
    pg, errs = page([])
    ev = lambda js: pg.evaluate(js)
    occ = lambda title, d: ev('(() => { const o = R.find(x => x.title === %s && x.date === %s); return o ? o.id : null; })()' % (json.dumps(title), json.dumps(d)))
    dates = ev('R.filter(x => x.title === "马原" && x.date >= today()).map(x => x.date).sort().slice(0, 3)')
    d1, d2, d3 = dates
    oid = occ('马原', d1)
    ev('openDetail(%s, false)' % json.dumps(oid)); pg.wait_for_timeout(400)
    check('remote series: editable now (no read-only hint, fields on)', ev('document.getElementById("p-ro").hidden') and not ev('document.getElementById("p-title").disabled') and not ev('document.getElementById("p-start").disabled'))
    check('remote series: no repeat controls', ev('document.getElementById("p-rep-row").hidden'))
    pg.fill('#p-place', '文史楼'); pg.wait_for_timeout(300)
    btn = lambda v: ev('document.querySelector("#scope [data-v=%s]").getAttribute("aria-disabled")' % v)
    check('remote, text edit: 仅此次 / 全部 on, 此次及以后 off', btn('one') is None and btn('all') is None and btn('future') == 'true')
    pg.screenshot(path=OUT + 'v71-remote-scope.png', clip={'x': 700, 'y': 0, 'width': 836, 'height': 500})
    pg.click('#scope [data-v="future"]', force=True); pg.wait_for_timeout(200)
    check('clicking the greyed one does nothing', not ev('document.getElementById("scope").hidden'))
    pg.click('#scope [data-v="one"]'); pg.wait_for_timeout(2200)
    text = srv(pg, 'C0-1.ics')
    rid = d1.replace('-', '') + 'T140000'
    check('仅此次 → RECURRENCE-ID on the server', 'RECURRENCE-ID;TZID=Asia/Shanghai:' + rid in text and 'LOCATION:文史楼' in text, text)
    check('仅此次: panel stays on the same occurrence', ev('S.sel') == oid and ev('S.panel') == 'detail')
    places = lambda: ev('R.filter(x => x.title === "马原" && x.date >= today()).sort((a, b) => a.date < b.date ? -1 : 1).slice(0, 3).map(x => x.place)')
    check('only that week moved room', places() == ['文史楼', '', ''], places())
    pg.fill('#p-start', '15:00'); pg.wait_for_timeout(300)
    check('same occurrence, scope 仅此次 remembered: time goes straight in', ev('document.getElementById("scope").hidden'))
    ev('closePanels()'); pg.wait_for_timeout(2000)
    text = srv(pg, 'C0-1.ics')
    check('time change → still one RECURRENCE-ID block, new start', text.count('RECURRENCE-ID') == 1 and re.search(r'DTSTART:\d{8}T070000Z', text) is not None, text)
    # 改全部的时间：按钮置灰；改全部的标题：主事件改，别的周跟着变
    oid2 = occ('马原', d2)
    ev('openDetail(%s, false)' % json.dumps(oid2)); pg.wait_for_timeout(400)
    pg.fill('#p-start', '16:00'); pg.wait_for_timeout(300)
    check('remote, time edit: 全部 and 此次及以后 greyed', btn('all') == 'true' and btn('future') == 'true' and btn('one') is None)
    pg.hover('#scope [data-v="all"]'); pg.wait_for_timeout(700)
    check('greyed button tip', ev('document.getElementById("tip").textContent') == '这一项请在 Apple 日历里改')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check('Esc: time change dropped', ev('document.getElementById("p-start").value') == '14:00')
    pg.fill('#p-title', '马克思主义基本原理'); pg.wait_for_timeout(200)
    pg.click('#scope [data-v="all"]'); pg.wait_for_timeout(2200)
    text = srv(pg, 'C0-1.ics')
    titles = lambda: ev('R.filter(x => x.href.indexOf("C0-1.ics") >= 0 && x.date >= today()).sort((a, b) => a.date < b.date ? -1 : 1).slice(0, 3).map(x => x.title)')
    check('全部 → master SUMMARY changed, every week shows it (the moved one too)', 'SUMMARY:马克思主义基本原理' in text and titles() == ['马克思主义基本原理'] * 3, [titles(), text])
    check('全部 (text only): time, rule untouched', 'RRULE:FREQ=WEEKLY' in text and 'T140000' in text)
    pg.fill('#p-start', '16:00'); pg.wait_for_timeout(300)
    check('after 全部, a time change asks again', not ev('document.getElementById("scope").hidden') and btn('all') == 'true')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    ev('closePanels()')
    ev('syncNow(false)'); pg.wait_for_timeout(1500)
    first = ev('(() => { const o = R.find(x => x.href.indexOf("C0-1.ics") >= 0 && x.date === %s); return [o.start, o.place, o.title]; })()' % json.dumps(d1))
    check('after the next sync: changes are there', titles() == ['马克思主义基本原理'] * 3 and first == ['15:00', '文史楼', '马克思主义基本原理'], [titles(), first])
    check('no page errors (remote edit)', not errs, errs)

    # ---- 4. iCloud 上的每周课：删一次、撤销、删以后、删全部 ----
    oid = occ('经济外交', d1) or occ('经济外交', ev('R.filter(x => x.title === "经济外交" && x.date >= today()).map(x => x.date).sort()[0]'))
    od = ev('find(%s).date' % json.dumps(oid))
    ev('openDetail(%s, false)' % json.dumps(oid)); pg.wait_for_timeout(400)
    pg.click('#p-del'); pg.wait_for_timeout(200)
    check('remote delete: all three choices available', btn('one') is None and btn('future') is None and btn('all') is None)
    pg.click('#scope [data-v="one"]'); pg.wait_for_timeout(2200)
    text = srv(pg, 'C0-2.ics')
    check('删仅此次 → EXDATE on the server', 'EXDATE;TZID=Asia/Shanghai:' + od.replace('-', '') + 'T160000' in text, text)
    check('that week gone, others stay', ev('R.filter(x => x.title === "经济外交" && x.date === %s).length' % json.dumps(od)) == 0 and ev('R.filter(x => x.title === "经济外交" && x.date > %s).length' % json.dumps(od)) > 0)
    pg.click('#toast-btn'); pg.wait_for_timeout(2200)
    check('undo → EXDATE removed on the server again', 'EXDATE' not in srv(pg, 'C0-2.ics') and ev('R.filter(x => x.title === "经济外交" && x.date === %s).length' % json.dumps(od)) == 1)
    later = ev('R.filter(x => x.title === "经济外交" && x.date > %s).map(x => x.date).sort()[1]' % json.dumps(od))
    ev('openDetail(%s, false)' % json.dumps(occ('经济外交', later))); pg.wait_for_timeout(400)
    pg.click('#p-del'); pg.wait_for_timeout(200)
    pg.click('#scope [data-v="future"]'); pg.wait_for_timeout(2200)
    text = srv(pg, 'C0-2.ics')
    check('删此次及以后 → UNTIL on the server', re.search(r'RRULE:FREQ=WEEKLY;UNTIL=\d{8}T\d{6}Z', text) is not None, text)
    check('from that week on: gone', ev('R.filter(x => x.title === "经济外交" && x.date >= %s).length' % json.dumps(later)) == 0 and ev('R.filter(x => x.title === "经济外交" && x.date < %s).length' % json.dumps(later)) > 0)
    oid = occ('匹克球', ev('R.filter(x => x.title === "匹克球").map(x => x.date).sort()[2]'))
    ev('openDetail(%s, false)' % json.dumps(oid)); pg.wait_for_timeout(400)
    pg.click('#p-del'); pg.wait_for_timeout(200)
    pg.click('#scope [data-v="all"]'); pg.wait_for_timeout(1500)
    check('删全部 → resource deleted on the server', srv(pg, 'C3-0.ics') is None and ev('R.filter(x => x.title === "匹克球").length') == 0)
    ev('syncNow(false)'); pg.wait_for_timeout(1500)
    check('after the next sync: deletions stick', ev('R.filter(x => x.title === "匹克球").length') == 0 and ev('R.filter(x => x.title === "经济外交" && x.date >= %s).length' % json.dumps(later)) == 0)
    check('no page errors (remote delete)', not errs, errs)

    # ---- 5. 0.7.0 的数据：单独改过时间的那一场，附加内容按改后时间记的 id，读进来挪到新 id 上 ----
    ics = '\r\n'.join(['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:X', 'DTSTART;TZID=Asia/Shanghai:%sT100000' % day(-7).replace('-', ''), 'DTEND;TZID=Asia/Shanghai:%sT110000' % day(-7).replace('-', ''),
                          'RRULE:FREQ=WEEKLY', 'SUMMARY:西语', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:X', 'RECURRENCE-ID;TZID=Asia/Shanghai:%sT100000' % day(0).replace('-', ''),
                          'DTSTART;TZID=Asia/Shanghai:%sT150000' % day(0).replace('-', ''), 'DTEND;TZID=Asia/Shanghai:%sT160000' % day(0).replace('-', ''), 'SUMMARY:西语（调课）', 'END:VEVENT', 'END:VCALENDAR'])
    legacy = 'r|/cal/X.ics|' + day(0).replace('-', '') + '1500'
    seed = {'version': 2, 'items': [], 'note': '', 'extras': {legacy: {'subs': [{'id': 's', 'text': '带词典', 'done': False}]}},
            'settings': settings(sync={'on': True, 'user': 'me@icloud.com', 'cals': [{'href': '/cal/', 'name': '课表', 'color': '#FFCC00', 'on': True}], 'target': ''}),
            'remote': {'res': {'/cal/X.ics': {'etag': '"1"', 'ics': ics, 'cal': '/cal/'}}, 'at': 1}}
    ctx = b.new_context(viewport={'width': 1536, 'height': 960}, screen={'width': 1536, 'height': 960}, timezone_id='Asia/Shanghai')
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(WP, lambda r: r.fulfill(path=HERE + 'assets/wallpaper.jpg', headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
    pg.add_init_script('window.__SEED = %s; window.__WP = %s;' % (json.dumps(json.dumps(seed)), json.dumps(WP)))
    pg.add_init_script(path=HERE + 'mock_cn.js')
    pg.goto('file://' + ROOT + '/src/index.html'); pg.wait_for_timeout(900)
    ev = lambda js: pg.evaluate(js)
    newid = 'r|/cal/X.ics|' + day(0).replace('-', '') + '1000'
    check('0.7.0 extras on a moved occurrence: found under the new id', ev('(() => { const o = R.find(x => x.date === today()); return [o.id, o.start, o.subs.length]; })()') == [newid, '15:00', 1])
    check('… and stored under the new id', ev('Object.keys(S.extras)') == [newid])
    check('no page errors (legacy ids)', not errs, errs)

    # ---- 6. 有夏令时的时区：本机重复日程不传，带“只存本机”图标；不重复的照样能传 ----
    ctx = b.new_context(viewport={'width': 1536, 'height': 960}, screen={'width': 1536, 'height': 960}, timezone_id='America/New_York')
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(WP, lambda r: r.fulfill(path=HERE + 'assets/wallpaper.jpg', headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
    ny = datetime.datetime.now(datetime.timezone.utc).astimezone(datetime.timezone(datetime.timedelta(hours=-5))).date().isoformat()
    seed = {'version': 2, 'items': [event('w', ny, '组会', rrule='FREQ=DAILY'), event('p', ny, '单次')], 'note': '', 'settings': settings()}
    pg.add_init_script('window.__SEED = %s; window.__WP = %s;' % (json.dumps(json.dumps(seed)), json.dumps(WP)))
    pg.add_init_script(path=HERE + 'mock_cn.js')
    pg.goto('file://' + ROOT + '/src/index.html'); pg.wait_for_timeout(900)
    ev = lambda js: pg.evaluate(js)
    ev('S.settings.sync = %s; syncNow(true)' % json.dumps(SYNC)); pg.wait_for_timeout(1500)
    ev('openDetail(%s, false)' % json.dumps('w@' + ev('S.items[0].date'))); pg.wait_for_timeout(400)
    check('DST time zone: repeating event has no picker, shows the local-only icon', ev('localTz()') is None and ev('document.getElementById("p-cal-pick").hidden') and not ev('document.getElementById("p-local").hidden'))
    ev('closePanels()')
    ev('openDetail("p", false)'); pg.wait_for_timeout(300)
    check('DST time zone: a one-off event can still pick a calendar', not ev('document.getElementById("p-cal-pick").hidden'))
    ev('closePanels()')
    ev('S.items[0].cal = S.settings.sync.cals[0].href; uploadPending()'); pg.wait_for_timeout(1200)
    check('DST time zone: repeating event never uploaded even with a calendar set', ev('S.items.some(x => x.id === "w")') and not ev('Object.keys(window.__server).some(k => window.__server[k].ics.indexOf("组会") >= 0)'))
    check('no page errors (DST)', not errs, errs)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
raise SystemExit(0 if ok else 1)
