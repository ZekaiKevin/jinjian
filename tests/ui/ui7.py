# 0.5.2：iCloud 上传可靠性、退出前保存、重复打开
import json, sys, warnings
warnings.filterwarnings('ignore')
from playwright.sync_api import sync_playwright
import os
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
APP = sys.argv[1] if len(sys.argv) > 1 else ROOT
WP = 'https://local.test/wp.jpg'
ONE = 'https://p42-caldav.icloud.com.cn:443/123/calendars/home/ONE.ics'
ok = True
def check(name, cond, extra=''):
    global ok
    if not cond: ok = False
    print(('PASS ' if cond else 'FAIL ') + name, extra if extra != '' else '')
with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    ctx = b.new_context(viewport={'width': 1536, 'height': 960}, screen={'width': 1536, 'height': 960}, timezone_id='Asia/Shanghai')
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(WP, lambda r: r.fulfill(path=HERE + 'assets/wallpaper.jpg', headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
    pg.add_init_script('window.__SEED = ""; window.__WP = %s;' % json.dumps(WP))
    pg.add_init_script(path=HERE + 'mock_cn.js')
    pg.goto('file://' + APP + '/src/index.html')
    pg.wait_for_timeout(800)
    ev = lambda js: pg.evaluate(js)
    pg.click('[data-act=settings]'); pg.fill('#s-user', 'me@icloud.com'); pg.fill('#s-pass', 'x'); pg.click('#s-connect button[type=submit]')
    pg.wait_for_timeout(1500)
    pg.click('[data-act=s-close]'); pg.wait_for_timeout(300)
    ev('S.syncing = true')  # 关掉自动同步，免得它碰巧把版本号补上、掩盖问题
    title = lambda: ev('/SUMMARY:(.*)/.exec(window.__server[%s].ics)[1]' % json.dumps(ONE))
    puts = lambda: ev('window.__log.dav.filter(d => d.method === "PUT").length')

    # ---- 1. 上传后服务器没给版本号，紧接着又改了一次 ----
    ev('window.__davOpts.noEtag = true')
    pg.click('#events .ev:has-text("取体检报告")'); pg.wait_for_timeout(300)
    pg.fill('#p-title', '改一'); pg.wait_for_timeout(2300)
    check('first edit uploaded', title() == '改一' and ev('S.remote.res[Object.keys(S.remote.res).find(k => /ONE/.test(k))].etag') == '')
    pg.fill('#p-title', '改二'); pg.wait_for_timeout(2300)
    last = ev('window.__log.dav.filter(d => d.method === "PUT").slice(-1)[0].headers')
    check('second edit not lost', title() == '改二', title())
    check('second edit sent as overwrite of the current version', any(h[0] == 'If-Match' for h in last) and ev('window.__log.dav.some(d => d.method === "PROPFIND" && d.headers.some(h => h[0] === "Depth" && h[1] === "0") && /ONE/.test(d.url))'), last)
    check('nothing left pending', ev('!Object.values(S.remote.res).some(r => r.dirty)'))
    ev('window.__davOpts.noEtag = false')

    # ---- 2. 上传失败会自己重试 ----
    ev('window.__davOpts.failPut = 1')
    n0 = puts()
    pg.fill('#p-title', '改三'); pg.wait_for_timeout(2300)
    check('failed upload kept and reported', title() == '改二' and ev('Object.values(S.remote.res).some(r => r.dirty)') and '稍后会再试' in ev('S.status || ""'), ev('S.status'))
    pg.wait_for_timeout(5500)
    check('retried and saved', title() == '改三' and puts() == n0 + 2 and ev('!Object.values(S.remote.res).some(r => r.dirty)'), (title(), puts() - n0))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # ---- 3. 新建的日程上传途中被删 ----
    HOME = ev('S.settings.sync.cals.find(c => c.name === "个人").href')
    def upload(id, name, delete_midway):
        ev('S.items.push({ id: %s, kind: "event", date: S.date, title: %s, start: "20:00", end: "21:00", allDay: false, cal: %s, place: "", notes: "", subs: [], remind: "10" })' % (json.dumps(id), json.dumps(name), json.dumps(HOME)))
        ev('window.__davOpts.delay = 400; window.__up = uploadPending(); 0')
        pg.wait_for_timeout(150)
        if delete_midway:
            ev('deleteItem(S.items.find(x => x.id === %s))' % json.dumps(id))
        ev('window.__up'); pg.wait_for_timeout(1600)
        ev('window.__davOpts.delay = 0')
        on_server = ev('Object.values(window.__server).some(r => r.ics.indexOf(%s) >= 0)' % json.dumps('SUMMARY:' + name))
        shown = ev('R.some(o => o.title === %s) || S.items.some(x => x.title === %s)' % (json.dumps(name), json.dumps(name)))
        return on_server, shown
    check('normal upload lands on server', upload('up1', '临时会议', False) == (True, True))
    check('deleted mid-upload: removed from server too', upload('up2', '取消的会', True) == (False, False))

    # ---- 4. 退出前保存 ----
    ev('window.__log.calls = []')
    pg.fill('#note', '最后一笔')
    ev('window.__listeners.flush.forEach(f => f({ payload: null }))'); pg.wait_for_timeout(100)
    check('flush writes pending note immediately', json.loads(ev('window.__stored')).get('note') == '最后一笔' and 'flush_done' in ev('window.__log.calls'), ev('window.__log.calls'))

    # ---- 5. 重复打开：收起着的展开 ----
    ev('S.compact = "capsule"; render()'); pg.wait_for_timeout(300)
    ev('window.__listeners["second-instance"].forEach(f => f({ payload: null }))'); pg.wait_for_timeout(500)
    check('second launch expands the capsule', ev('S.compact') == '')
    check('no page errors', not errs, errs[:3])
print('ALL OK' if ok else 'SOME FAILED')
