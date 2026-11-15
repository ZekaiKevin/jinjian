# 0.7.1：本机日程和待办的重复。详情里设重复（每天 / 每周几 / 每月 / 每年 / 每年农历，结束日期或次数）、
# 每一天按场次显示、改 / 删时的范围小气泡、重复待办每一场单独完成且不顺延、搜索只列一条、倒数日指向下一场、
# 月历小点和月视图每一场都有、农历和休班角标不变、旧数据原样读写。
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
CODE = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']  # Python 的 weekday()：周一是 0
WD = CODE[t.weekday()]
def todo(i, date, title, **kw):
    d = {'id': i, 'kind': 'todo', 'date': date, 'title': title, 'done': False, 'star': False, 'due': '', 'place': '', 'notes': '', 'subs': []}; d.update(kw); return d
def event(i, date, title, **kw):
    d = {'id': i, 'kind': 'event', 'date': date, 'title': title, 'start': '18:00', 'end': '19:40', 'place': '', 'notes': '', 'subs': [], 'remind': 'none'}; d.update(kw); return d
def settings(**kw):
    s = {'theme': 'dark', 'tint': 50, 'blur': True, 'carry': True, 'autostart': False, 'top': False, 'sync': {'on': False, 'user': '', 'cals': [], 'target': ''}}
    s.update(kw); return s
ok = True
def check(name, cond, extra=''):
    global ok
    if not cond: ok = False
    print(('PASS ' if cond else 'FAIL ') + name, extra if extra != '' else '')

with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    def page(seed_obj, w=1536, h=960):
        ctx = b.new_context(viewport={'width': w, 'height': h}, screen={'width': w, 'height': h}, timezone_id='Asia/Shanghai')
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.route(WP, lambda r: r.fulfill(path=HERE + 'assets/wallpaper.jpg', headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
        seed = seed_obj if isinstance(seed_obj, str) else json.dumps(seed_obj)
        pg.add_init_script('window.__SEED = %s; window.__WP = %s;' % (json.dumps(seed), json.dumps(WP)))
        pg.add_init_script(path=HERE + 'mock_cn.js')
        pg.goto('file://' + ROOT + '/src/index.html')
        pg.add_style_tag(content='body{background:url(%s) center/cover no-repeat !important}' % WP)
        pg.wait_for_timeout(900)
        return pg, errs
    def stored(pg):
        pg.evaluate('writeNow()'); pg.wait_for_timeout(100)
        return json.loads(pg.evaluate('window.__stored'))

    # ---- 1. 旧数据：原样读进来、原样写回去 ----
    raw = open(os.path.join(ROOT, 'tests', 'fixtures', 'data-0.7.0.json'), encoding='utf-8').read()
    pg, errs = page(raw)
    ev = lambda js: pg.evaluate(js)
    st = stored(pg)
    old = json.loads(raw)
    # 0.7.0 本来就有的顺延：没做完、日期在今天之前的待办挪到今天。除此之外一个字都不变
    want = json.loads(raw)['items']
    for it in want:
        if it['kind'] == 'todo' and not it['done'] and it['date'] < day(0): it['date'] = day(0)
    check('0.7.0 data.json: items written back unchanged (apart from the usual carry-over)', st['items'] == want, [(a, b) for a, b in zip(st['items'], want) if a != b])
    check('0.7.0 data.json: same field order', json.dumps(st['items'], ensure_ascii=False) == json.dumps(want, ensure_ascii=False))
    check('0.7.0 data.json: note / extras / settings / remote unchanged', all(st[k] == old[k] for k in ['note', 'extras', 'remote']) and st['settings']['palette'] == 'graphite' and st['settings']['fold'] == old['settings']['fold'])
    check('0.7.0 data.json: no page errors', not errs, errs)

    # ---- 2. 每周的课：只存一份，每周那一天都显示；月历小点、月视图每一场都有 ----
    base = [event('w', day(-14), '经济学原理', place='明商208', rrule='FREQ=WEEKLY;BYDAY=' + WD), todo('plain', day(0), '普通待办')]
    pg, errs = page({'version': 2, 'items': base, 'note': '', 'settings': settings()})
    ev = lambda js: pg.evaluate(js)
    titles = lambda: ev('[...document.querySelectorAll("#events .ev .n")].map(x => x.textContent)')
    check('today: the weekly class shows', titles() == ['经济学原理'], titles())
    ev('S.date = %s; render()' % json.dumps(day(7))); pg.wait_for_timeout(200)
    check('next week: shows again', titles() == ['经济学原理'])
    ev('S.date = %s; render()' % json.dumps(day(1))); pg.wait_for_timeout(200)
    check('tomorrow: not there', titles() == [])
    ev('S.date = %s; render()' % json.dumps(day(-21))); pg.wait_for_timeout(200)
    check('before the series starts: not there', titles() == [])
    ev('S.date = today(); render()')
    check('only one master stored', len(stored(pg)['items']) == 2 and stored(pg)['items'][0].get('rrule') == 'FREQ=WEEKLY;BYDAY=' + WD)
    # 月历：同一个星期几的每一格都有橙点
    ev('onAct("view", document.body)'); pg.wait_for_timeout(500)
    dots = ev('''(() => { const out = {}; document.querySelectorAll('#cal-grid .cday').forEach((c) => { const d = c.dataset.date; out[d] = !!c.querySelector('.dots .e'); }); return out; })()''')
    want = {k: v for k, v in dots.items() if k >= day(-14) and datetime.date.fromisoformat(k).weekday() == t.weekday()}
    others = {k: v for k, v in dots.items() if datetime.date.fromisoformat(k).weekday() != t.weekday()}
    check('month dots: every occurrence day has an orange dot', len(want) >= 3 and all(want.values()), want)
    check('month dots: other weekdays have none', not any(others.values()))
    lz_before = ev('[...document.querySelectorAll("#cal-grid .cday")].map(c => (c.querySelector(".lz") || {}).textContent + "|" + ((c.querySelector(".hol") || {}).textContent || ""))')
    ev('onAct("big-open", document.body)'); pg.wait_for_timeout(700)
    lines = ev('''(() => { const out = {}; document.querySelectorAll('#big-grid .cell').forEach((c) => { out[c.dataset.date] = [...c.querySelectorAll('.line:not(.more) .n')].map(x => x.textContent); }); return out; })()''')
    occ_days = [k for k in lines if k >= day(-14) and datetime.date.fromisoformat(k).weekday() == t.weekday()]
    check('month view: every occurrence listed in its cell', occ_days and all(lines[k] == ['经济学原理'] for k in occ_days), {k: lines[k] for k in occ_days})
    check('month view: nothing on other days', all(not v for k, v in lines.items() if k not in occ_days))
    pg.screenshot(path=OUT + 'v71-big.png', clip={'x': 700, 'y': 0, 'width': 836, 'height': 700})
    ev('onAct("big-close", document.body)'); pg.wait_for_timeout(500)
    lz_after = ev('[...document.querySelectorAll("#cal-grid .cday")].map(c => (c.querySelector(".lz") || {}).textContent + "|" + ((c.querySelector(".hol") || {}).textContent || ""))')
    check('lunar / holiday badges unchanged next to repeating items', lz_before == lz_after and any('|' in x and x.split('|')[0] not in ('', 'undefined') for x in lz_before))
    ev('S.mode = "day"; render()')

    # ---- 3. 改某一场：小气泡问范围，只有三个选项，没有说明文字 ----
    occ_id = 'w@' + day(0)
    ev('openDetail(%s, false)' % json.dumps(occ_id)); pg.wait_for_timeout(500)
    check('detail: repeat row shows 每周 and today\'s weekday pill', ev('document.getElementById("p-repeat").value') == 'WEEKLY'
          and ev('[...document.querySelectorAll("#p-wk button[aria-pressed=true]")].map(b => b.dataset.d)') == [str((t.weekday() + 1) % 7)])
    check('scope bubble hidden before any change', ev('document.getElementById("scope").hidden'))
    pg.fill('#p-title', '经济学原理（期中）'); pg.wait_for_timeout(300)
    check('typing in a repeating item: bubble appears', not ev('document.getElementById("scope").hidden'))
    check('bubble: exactly 仅此次 / 此次及以后 / 全部, no other text', ev('[...document.querySelectorAll("#scope button")].map(b => b.textContent)') == ['仅此次', '此次及以后', '全部'] and ev('document.getElementById("scope").textContent.replace(/\\s/g, "")') == '仅此次此次及以后全部')
    box = ev('(() => { const r = document.getElementById("scope").getBoundingClientRect(); const p = document.getElementById("panel").getBoundingClientRect(); const a = document.getElementById("p-title").getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, pl: p.left, pr: p.right, at: a.bottom, w: r.width, h: r.height }; })()')
    check('bubble: small, sits right under the title, inside the panel', box['h'] <= 44 and box['w'] <= 300 and 0 <= box['t'] - box['at'] <= 12 and box['l'] >= box['pl'] and box['r'] <= box['pr'], box)
    check('not saved yet while asking', ev('S.items[0].title') == '经济学原理' and not ev('S.items[0].overrides'))
    pg.screenshot(path=OUT + 'v71-scope.png', clip={'x': 700, 'y': 0, 'width': 836, 'height': 500})
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check('Esc: bubble gone, edit dropped, title reverted', ev('document.getElementById("scope").hidden') and ev('document.getElementById("p-title").value') == '经济学原理' and ev('S.items[0].title') == '经济学原理' and ev('S.panel') == 'detail')
    pg.fill('#p-title', '经济学原理（期中）'); pg.wait_for_timeout(200)
    pg.click('#scope [data-v="one"]'); pg.wait_for_timeout(300)
    check('仅此次: only this occurrence changes', ev('S.items[0].overrides') == {day(0): {'title': '经济学原理（期中）'}} and ev('S.items[0].title') == '经济学原理')
    check('仅此次: focus goes back to the title', ev('document.activeElement.id') == 'p-title')
    pg.keyboard.type('!'); pg.wait_for_timeout(200)
    check('same occurrence: no second question', ev('document.getElementById("scope").hidden') and ev('S.items[0].overrides')[day(0)]['title'] == '经济学原理（期中）!')
    check('list shows the changed title only today', titles() == ['经济学原理（期中）!'])
    ev('closePanels()')
    ev('S.date = %s; render()' % json.dumps(day(7))); pg.wait_for_timeout(200)
    check('next week keeps the old title', titles() == ['经济学原理'])

    # 全部：改地点
    ev('openDetail(%s, false)' % json.dumps('w@' + day(7))); pg.wait_for_timeout(400)
    pg.fill('#p-place', '明商301'); pg.wait_for_timeout(200)
    pg.click('#scope [data-v="all"]'); pg.wait_for_timeout(300)
    check('全部: master changed', ev('S.items[0].place') == '明商301' and ev('S.items.length') == 2)
    ev('closePanels()')

    # 此次及以后：改时间
    ev('openDetail(%s, false)' % json.dumps('w@' + day(7))); pg.wait_for_timeout(400)
    pg.fill('#p-start', '14:00'); pg.wait_for_timeout(200)
    pg.click('#scope [data-v="future"]'); pg.wait_for_timeout(300)
    st = stored(pg)['items']
    reps = [x for x in st if x.get('rrule')]
    check('此次及以后: split into two series', len(reps) == 2 and reps[0]['rrule'].endswith('UNTIL=' + day(6).replace('-', '')) and reps[1]['date'] == day(7) and reps[1]['start'] == '14:00' and reps[1]['end'] == '15:40', reps)
    check('此次及以后: the open detail follows the new series', ev('S.sel') == reps[1]['id'] + '@' + day(7))
    pg.fill('#p-place', '明商302'); pg.wait_for_timeout(200)
    check('after 此次及以后: further edits go to the new series without asking', ev('document.getElementById("scope").hidden') and ev('S.items.find(x => x.id === %s).place' % json.dumps(reps[1]['id'])) == '明商302' and ev('S.items[0].place') == '明商301')
    ev('closePanels()')
    starts = lambda d: ev('(S.date = %s, render(), [...document.querySelectorAll("#events .ev .t")].map(x => x.textContent))' % json.dumps(d))
    check('before the split: old time; from the split on: new time', starts(day(0)) == ['18:00'] and starts(day(7)) == ['14:00'] and starts(day(14)) == ['14:00'])
    ev('S.date = today(); render()')

    # ---- 4. 删除：同样的小气泡 ----
    ev('openDetail(%s, false)' % json.dumps('w@' + day(0))); pg.wait_for_timeout(400)
    pg.click('#p-del'); pg.wait_for_timeout(300)
    check('delete: same three choices', not ev('document.getElementById("scope").hidden') and ev('[...document.querySelectorAll("#scope button")].map(b => b.textContent)') == ['仅此次', '此次及以后', '全部'] and ev('document.getElementById("scope").classList.contains("del")'))
    pg.screenshot(path=OUT + 'v71-del.png', clip={'x': 700, 'y': 0, 'width': 836, 'height': 900})
    pg.click('#scope [data-v="one"]'); pg.wait_for_timeout(300)
    check('删除仅此次: exdate added, today empty, panel closed', day(0) in (ev('S.items[0].exdates') or []) and titles() == [] and ev('S.panel') == '')
    check('删除仅此次: undo toast', ev('document.getElementById("toast").classList.contains("on")') and ev('document.getElementById("toast-btn").textContent') == '撤销')
    pg.click('#toast-btn'); pg.wait_for_timeout(300)
    check('undo: back again', titles() == ['经济学原理（期中）!'] and not ev('S.items[0].exdates'))
    ev('openDetail(%s, false)' % json.dumps('w@' + day(0))); pg.wait_for_timeout(400)
    pg.click('#p-del'); pg.wait_for_timeout(200)
    pg.click('#scope [data-v="all"]'); pg.wait_for_timeout(300)
    check('删除全部: the first series is gone, the split-off one stays', ev('S.items.filter(x => x.rrule).length') == 1 and titles() == [] and starts(day(7)) == ['14:00'])
    check('no page errors (edit / delete)', not errs, errs)

    # ---- 5. 设重复：每周几、结束次数、取消；新建什么都没写就关掉不留 ----
    pg, errs = page({'version': 2, 'items': [event('e', day(0), '组会')], 'note': '', 'settings': settings()})
    ev = lambda js: pg.evaluate(js)
    ev('openDetail("e", false)'); pg.wait_for_timeout(400)
    check('plain item: 不重复, no week / end rows', ev('document.getElementById("p-repeat").value') == '' and ev('document.getElementById("p-wk-row").hidden') and ev('document.getElementById("p-end-row").hidden'))
    pg.select_option('#p-repeat', 'WEEKLY'); pg.wait_for_timeout(300)
    check('每周: rule saved with today\'s weekday, detail now shows this occurrence', ev('S.items[0].rrule') == 'FREQ=WEEKLY;BYDAY=' + WD and ev('S.sel') == 'e@' + day(0) and not ev('document.getElementById("p-wk-row").hidden'))
    other = (t.weekday() + 2) % 7
    pg.click('#p-wk button[data-d="%d"]' % ((other + 1) % 7)); pg.wait_for_timeout(300)
    check('click another weekday: added to BYDAY', CODE[other] in ev('S.items[0].rrule'), ev('S.items[0].rrule'))
    ev('S.date = %s; render()' % json.dumps(day(2))); pg.wait_for_timeout(200)
    check('the added weekday shows the meeting', ev('[...document.querySelectorAll("#events .ev .n")].map(x => x.textContent)') == ['组会'])
    pg.select_option('#p-rend', 'count'); pg.wait_for_timeout(300)
    pg.fill('#p-rcount', '3'); pg.press('#p-rcount', 'Tab'); pg.wait_for_timeout(300)
    check('结束：次数 3', ev('S.items[0].rrule').endswith(';COUNT=3') and len(ev('Recur.expand(S.items, %s, %s)' % (json.dumps(day(0)), json.dumps(day(60))))) == 3)
    pg.select_option('#p-rend', 'until'); pg.wait_for_timeout(300)
    pg.fill('#p-until', day(9)); pg.wait_for_timeout(300)
    check('结束：到某天', ev('S.items[0].rrule').endswith(';UNTIL=' + day(9).replace('-', '')))
    pg.fill('#p-until', day(-30)); pg.wait_for_timeout(300)
    check('end date before the start: refused, nothing lost', ev('S.items[0].rrule').endswith(';UNTIL=' + day(9).replace('-', '')) and ev('document.getElementById("p-until").value') == day(9))
    pg.screenshot(path=OUT + 'v71-rule.png', clip={'x': 700, 'y': 0, 'width': 836, 'height': 900})
    ev('S.date = today(); render()')
    ev('openDetail(%s, false)' % json.dumps('e@' + day(0))); pg.wait_for_timeout(300)
    pg.select_option('#p-repeat', ''); pg.wait_for_timeout(300)
    check('不重复: back to a plain item on the day being viewed', ev('S.sel') == 'e' and not ev('"rrule" in S.items[0]') and ev('S.items[0].date') == day(0))
    ev('closePanels()')
    ev('onAct("add-todo", document.querySelector("[data-act=add-todo]"))'); pg.wait_for_timeout(300)
    pg.select_option('#p-repeat', 'DAILY'); pg.wait_for_timeout(200)
    ev('closePanels()'); pg.wait_for_timeout(200)
    check('new + repeat + nothing written: closing leaves nothing', ev('S.items.length') == 1)

    # 农历每年：生日
    ev('openDetail("e", false)'); pg.wait_for_timeout(300)
    pg.select_option('#p-repeat', 'LUNAR'); pg.wait_for_timeout(300)
    nxt = ev('Recur.next(S.items[0], %s, false).date' % json.dumps(day(1)))
    lz = ev('Lunar.solarToLunar(...%s.split("-").map(Number)).text === Lunar.solarToLunar(...%s.split("-").map(Number)).text' % (json.dumps(nxt), json.dumps(day(0))))
    check('每年（农历）: next one falls on the same lunar day next year', ev('S.items[0].lunar') is True and ev('S.items[0].rrule') == 'FREQ=YEARLY' and nxt[:4] == str(t.year + 1) and lz, nxt)
    check('no page errors (rule)', not errs, errs)

    # ---- 6. 重复待办：每一场单独完成，没做完不顺延 ----
    pg, errs = page({'version': 2, 'items': [todo('t', day(-3), '倒垃圾', rrule='FREQ=DAILY')], 'note': '', 'settings': settings(carry=True)})
    ev = lambda js: pg.evaluate(js)
    tds = lambda d: ev('(S.date = %s, render(), [...document.querySelectorAll("#todos .td")].map(x => x.querySelector(".name").textContent + (x.classList.contains("done") ? ":done" : "")))' % json.dumps(d))
    check('carry on, yesterday\'s left undone: master not moved', ev('S.items[0].date') == day(-3))
    check('today: exactly one 倒垃圾 (yesterday\'s not carried over)', tds(day(0)) == ['倒垃圾'], tds(day(0)))
    ev('S.date = today(); render()')
    pg.click('#todos .td .check'); pg.wait_for_timeout(1100)
    check('tick today: only today done', tds(day(0)) == ['倒垃圾:done'] and tds(day(1)) == ['倒垃圾'] and tds(day(-1)) == ['倒垃圾'])
    check('stored as doneDates on the one master', ev('S.items.length') == 1 and ev('S.items[0].doneDates') == {day(0): True} and ev('S.items[0].done') is False)
    ev('rollOver(); render()')
    check('rollOver leaves the series alone', ev('S.items[0].date') == day(-3) and tds(day(0)) == ['倒垃圾:done'])
    ev('S.settings.carry = false; S.date = today(); render()')
    check('carry off: the "之前没做完" hint ignores repeating todos', ev('document.querySelector("#todos .overdue")') is None)
    check('no page errors (todo)', not errs, errs)

    # ---- 7. Ctrl+F：一个系列只列一条；倒数日指向下一场 ----
    bday = day(40)
    its = [event('w', day(-70), '经济学原理', rrule='FREQ=WEEKLY;BYDAY=' + WD), event('b', day(40 - 365 * 2), '妈妈生日', allDay=True, rrule='FREQ=YEARLY', countdown=True), todo('x', day(3), '经济学作业')]
    pg, errs = page({'version': 2, 'items': its, 'note': '', 'settings': settings()})
    ev = lambda js: pg.evaluate(js)
    pg.keyboard.press('Control+f'); pg.wait_for_timeout(300)
    pg.keyboard.type('经济学'); pg.wait_for_timeout(300)
    hits = ev('[...document.querySelectorAll("#search-list .hit")].map(x => x.dataset.id)')
    check('Ctrl+F: the weekly class listed once', len([h for h in hits if h.startswith('w@')]) == 1 and 'x' in hits and len(hits) == 2, hits)
    check('Ctrl+F: the one listed is today\'s', 'w@' + day(0) in hits)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
    check('Enter: opens that occurrence', ev('S.sel') == hits[0] and ev('S.panel') == 'detail')
    ev('closePanels()')
    cds = ev('[...document.querySelectorAll("#countdowns .cd")].map(x => [x.dataset.id, x.textContent])')
    check('countdown on a yearly birthday points at the next one', cds == [['b@' + bday, '距 妈妈生日 还有 40 天']], cds)
    pg.click('#countdowns .cd'); pg.wait_for_timeout(400)
    check('clicking the pill jumps to that day', ev('S.date') == bday and ev('S.sel') == 'b@' + bday)
    check('no page errors (search / countdown)', not errs, errs)

    # ---- 7b. 提醒：今天这一场到点前照样弹通知，一场一次 ----
    soon = (now + datetime.timedelta(minutes=5)).strftime('%H:%M')
    if soon > '00:10' and now.strftime('%H:%M') < '23:50':
        pg, errs = page({'version': 2, 'items': [event('r', day(-7), '例会', start=soon, end='23:59', remind='10', rrule='FREQ=WEEKLY;BYDAY=' + WD)], 'note': '', 'settings': settings()})
        ev = lambda js: pg.evaluate(js)
        ev('checkReminders(); checkReminders()')
        n = ev('window.__log.notify')
        check('reminder for today\'s occurrence, once', len(n) == 1 and n[0]['title'] == '例会', n)
        check('no page errors (reminder)', not errs, errs)

    # ---- 8. 月视图里的气泡详情：问范围的小气泡也在里面 ----
    pg, errs = page({'version': 2, 'items': [event('w', day(-14), '经济学原理', rrule='FREQ=WEEKLY;BYDAY=' + WD)], 'note': '', 'settings': settings()})
    ev = lambda js: pg.evaluate(js)
    ev('onAct("big-open", document.body)'); pg.wait_for_timeout(700)
    pg.click('#big-grid .cell[data-date="%s"] .line' % day(0)); pg.wait_for_timeout(600)
    pg.fill('#p-title', '期中考试'); pg.wait_for_timeout(300)
    box = ev('(() => { const r = document.getElementById("scope").getBoundingClientRect(); const p = document.getElementById("panel").getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, pl: p.left, pr: p.right, pt: p.top, pb: p.bottom }; })()')
    check('bubble mode: scope bubble inside the detail bubble', box['l'] >= box['pl'] and box['r'] <= box['pr'] and box['t'] >= box['pt'] and box['b'] <= box['pb'], box)
    pg.screenshot(path=OUT + 'v71-big-scope.png', clip={'x': 500, 'y': 0, 'width': 1036, 'height': 700})
    pg.click('#scope [data-v="one"]'); pg.wait_for_timeout(300)
    check('bubble mode: 仅此次 works', ev('[...document.querySelectorAll("#big-grid .cell[data-date=\\"%s\\"] .line .n")].map(x => x.textContent)' % day(0)) == ['期中考试']
          and ev('[...document.querySelectorAll("#big-grid .cell[data-date=\\"%s\\"] .line .n")].map(x => x.textContent)' % day(-7)) == ['经济学原理'])
    check('no page errors (big)', not errs, errs)

    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
