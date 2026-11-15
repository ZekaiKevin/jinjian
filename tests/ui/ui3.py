import json, datetime, sys
from playwright.sync_api import sync_playwright
import os
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
WP = 'https://local.test/wp.jpg'
WPFILE = HERE + 'assets/wallpaper.jpg'
OUT = HERE + 'shots/'
os.makedirs(OUT, exist_ok=True)
t = (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).date().isoformat()
items = [
 {'id':'a','kind':'todo','date':t,'title':'交西语作业','done':False,'star':True,'due':'18:00','place':'','notes':'','subs':[]},
 {'id':'b','kind':'todo','date':t,'title':'回复房东邮件','done':True,'star':True,'due':'','place':'','notes':'','subs':[]},
 {'id':'c','kind':'todo','date':t,'title':'预约牙医','done':False,'star':False,'due':'','place':'','notes':'','subs':[]},
 {'id':'e9','kind':'event','date':t,'title':'健身房','start':'21:30','end':'22:30','place':'小区东门','notes':'','subs':[],'remind':'30'},
]
seed = json.dumps({'version':1,'items':items,'note':'牙医电话在冰箱贴上。'})
with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    ctx = b.new_context(viewport={'width':1536,'height':960}, timezone_id='Asia/Shanghai')
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.add_init_script('window.__SEED = %s; window.__WP = %s;' % (json.dumps(seed), json.dumps(WP)))
    pg.add_init_script(path=HERE + 'mock_cn.js')
    pg.route('https://local.test/wp.jpg', lambda r: r.fulfill(path=WPFILE, headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/jpeg'}))
    pg.goto('file://' + ROOT + '/src/index.html')
    pg.wait_for_timeout(1500)
    def shot(n): pg.wait_for_timeout(750); pg.screenshot(path=OUT + n + '.png')
    def acts(sel): pg.click(sel)
    shot('v3-01-day')
    # 设置并连接 iCloud
    pg.click('[data-act=settings]'); pg.wait_for_timeout(300)
    pg.fill('#s-user', 'me@icloud.com'); pg.fill('#s-pass', 'abcd-efgh-ijkl-mnop'); pg.click('#s-connect button[type=submit]')
    pg.wait_for_timeout(1200)
    shot('v3-02-settings')
    print('status:', pg.inner_text('#s-status'), '| cals:', pg.locator('#s-cals .sw').count())
    pg.select_option('#s-target', index=2)
    # 提示：悬停“?”立即出现
    pg.hover('#s-sync-help'); pg.wait_for_timeout(350)
    print('tip sync:', pg.evaluate('[tip.classList.contains("on"), tip.textContent.slice(0, 12), tip.getBoundingClientRect().right <= innerWidth, tip.getBoundingClientRect().bottom <= innerHeight]'))
    pg.screenshot(path=OUT + 'v3-tip-sync.png')
    pg.hover('.swrow .help >> nth=1'); pg.wait_for_timeout(350)
    print('tip lock:', pg.evaluate('tip.textContent.slice(0, 14)'))
    pg.screenshot(path=OUT + 'v3-tip-lock.png')
    pg.mouse.move(300, 800); pg.wait_for_timeout(300)
    print('tip hidden:', pg.evaluate('!tip.classList.contains("on")'))
    # 折叠 iCloud 区域
    h1 = pg.evaluate('settings.offsetHeight')
    pg.click('#s-fold'); pg.wait_for_timeout(600)
    print('fold:', h1, '->', pg.evaluate('[settings.offsetHeight, document.getElementById("s-fold").getAttribute("aria-expanded"), document.getElementById("s-fold-meta").textContent, getComputedStyle(document.querySelector("#s-sync .clip")).visibility]'))
    pg.screenshot(path=OUT + 'v3-folded.png')
    pg.click('#s-fold'); pg.wait_for_timeout(600)
    # 开关原地切换
    pg.click('.sw[data-k=blur]'); print('blur off:', pg.evaluate('[document.documentElement.classList.contains("no-blur"), document.querySelector(".sw[data-k=blur]").getAttribute("aria-checked")]')); pg.click('.sw[data-k=blur]')
    pg.click('.sw[data-k=lock]'); pg.wait_for_timeout(100); print('lock sw:', pg.evaluate('document.querySelector(".sw[data-k=lock]").getAttribute("aria-checked")')); pg.click('.sw[data-k=lock]')
    pg.click('[data-act=s-close]')
    shot('v3-03-day-synced')
    # 待办悬停：整行高亮；悬停圆圈只高亮圆圈
    bg = 'getComputedStyle(document.querySelector("#todos .td")).backgroundColor'
    pg.hover('#todos .td >> nth=0 >> .open'); pg.wait_for_timeout(400); print('row hover bg:', pg.evaluate(bg)); pg.screenshot(path=OUT + 'v3-hover-row.png', clip={'x': 1140, 'y': 400, 'width': 372, 'height': 160})
    pg.hover('#todos .td >> nth=0 >> .check'); pg.wait_for_timeout(400); print('check hover bg:', pg.evaluate(bg), '| ghost:', pg.evaluate('getComputedStyle(document.querySelector("#todos .td .ghost")).opacity')); pg.screenshot(path=OUT + 'v3-hover-check.png', clip={'x': 1140, 'y': 400, 'width': 372, 'height': 160})
    # 图标按钮：停半秒出名字
    pg.hover('#b-lock'); pg.wait_for_timeout(900); print('icon tip:', pg.evaluate('[tip.classList.contains("on"), tip.textContent]')); pg.screenshot(path=OUT + 'v3-tip-icon.png', clip={'x': 1140, 'y': 20, 'width': 392, 'height': 160})
    pg.mouse.move(300, 800)
    print('events today:', pg.locator('#events .ev').count(), '| now:', pg.inner_text('#now-title'), pg.inner_text('#now-right'))
    # 折叠日历
    pg.click('[data-act=view]'); shot('v3-04-cal')
    print('shell cal size:', pg.evaluate('[shell.offsetWidth, shell.offsetHeight]'))
    # 展开
    pg.click('[data-act=big-open]'); shot('v3-05-big')
    print('shell big size:', pg.evaluate('[shell.offsetWidth, shell.offsetHeight]'), 'lines:', pg.locator('#big-grid .line').count())
    over = pg.evaluate('Array.from(document.querySelectorAll("#big-grid .cell")).filter(c => c.scrollHeight > c.clientHeight + 1).length')
    print('cells overflowing:', over)
    pg.click('#big-grid .cell.sel .num'); shot('v3-06-pop')
    print('pop rows:', pg.locator('#pop-list .prow').count())
    pg.click('#pop-list .prow >> nth=0'); shot('v3-07-bubble')
    print('bubble:', pg.evaluate('[panel.classList.contains("bubble"), panel.style.top, panel.style.right, panel.offsetHeight]'), 'ro hidden:', pg.evaluate('document.getElementById("p-ro").hidden'))
    # 点另一格里的日程，气泡应移动
    pg.evaluate('document.querySelector("#big-grid .cell:nth-child(20) .line").click()'); shot('v3-08-bubble2')
    print('bubble2:', pg.evaluate('[panel.style.top, panel.style.right]'), 'title disabled:', pg.evaluate('document.getElementById("p-title").disabled'))
    pg.click('[data-act=p-close]')
    # 改一条不重复的 iCloud 日程
    pg.click('[data-act=big-close]'); pg.wait_for_timeout(700)
    print('after big-close:', pg.evaluate('S.mode'))
    pg.click('#cal [data-act=go-today]'); pg.click('#b-view'); pg.wait_for_timeout(600)
    pg.click('#events .ev:has-text("取体检报告")'); pg.wait_for_timeout(500)
    pg.fill('#p-title', '取体检报告（改）'); pg.fill('#p-place', '校医院')
    pg.wait_for_timeout(2200)
    puts = pg.evaluate('window.__log.dav.filter(d => d.method === "PUT").map(d => [d.url, JSON.stringify(d.headers), d.hasPass])')
    print('PUT after edit:', puts)
    print('server title:', pg.evaluate('/SUMMARY:(.*)/.exec(window.__server["https://p42-caldav.icloud.com.cn:443/123/calendars/home/ONE.ics"].ics)[1]'))
    # 新建一条存到 iCloud
    pg.click('[data-act=add-event]'); pg.wait_for_timeout(300); pg.fill('#p-title', '小组讨论'); pg.click('[data-act=p-close]'); pg.wait_for_timeout(900)
    print('created on server:', pg.evaluate('Object.keys(window.__server).filter(k => /小组讨论/.test(window.__server[k].ics)).length'), 'local left:', pg.evaluate('JSON.parse(window.__stored).items.filter(i => i.title === "小组讨论").length'))
    print('shown after create:', pg.locator('#events .ev:has-text("小组讨论")').count())
    # 删除 iCloud 日程：点两次
    pg.click('#events .ev:has-text("小组讨论")'); pg.wait_for_timeout(300)
    pg.click('#p-del'); print('confirm state:', pg.evaluate('document.getElementById("p-del").classList.contains("confirm")')); pg.click('#p-del'); pg.wait_for_timeout(600)
    print('after delete on server:', pg.evaluate('Object.keys(window.__server).filter(k => /小组讨论/.test(window.__server[k].ics)).length'), 'shown:', pg.locator('#events .ev:has-text("小组讨论")').count())
    # 快速记录回传
    pg.evaluate('window.__listeners.capture.forEach(f => f({payload: JSON.stringify({kind:"todo", raw:"x", title:"给猫买粮", date:"", time:""})}))')
    pg.evaluate('window.__listeners.capture.forEach(f => f({payload: JSON.stringify({kind:"note", raw:"点子：周报模板一键生成", title:"", date:"", time:""})}))')
    print('todos:', pg.locator('#todos .td').count(), '| note:', repr(pg.input_value('#note')))
    # 浅色
    pg.click('[data-act=settings]'); pg.click('[data-act=theme][data-v=light]'); shot('v3-09-light-settings')
    pg.click('[data-act=s-close]'); pg.click('[data-act=view]'); pg.click('[data-act=big-open]'); pg.click('#big-grid .cell.sel .line >> nth=0'); shot('v3-10-light-big')
    pg.click('[data-act=p-close]'); pg.click('[data-act=big-close]')
    pg.click('[data-act=settings]'); pg.click('[data-act=theme][data-v=dark]'); pg.click('[data-act=s-close]')
    # 迷你条与胶囊
    pg.click('[data-act=compact]'); shot('v3-11-compact'); print('compact size:', pg.evaluate('[shell.offsetWidth, shell.offsetHeight]'))
    pg.click('[data-act=dock]'); shot('v3-12-capsule'); print('rects in capsule:', pg.evaluate('window.__log.rects'))
    pg.click('#capsule'); pg.wait_for_timeout(700); print('back size:', pg.evaluate('[shell.offsetWidth, shell.offsetHeight, shell.classList.contains("gone")]'))
    print('notify:', pg.evaluate('window.__log.notify'))
    print('errors:', errs)
    b.close()
