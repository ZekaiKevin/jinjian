import json, datetime, re
from playwright.sync_api import sync_playwright
import os
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
WP = 'https://local.test/wp.jpg'
WPFILE = HERE + 'assets/wallpaper.jpg'
OUT = HERE + 'shots/'
os.makedirs(OUT, exist_ok=True)
t = (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).date()
T = t.isoformat()
items = [
 {'id':'a','kind':'todo','date':T,'title':'交西语作业','done':False,'star':True,'due':'18:00','place':'','notes':'','subs':[]},
 {'id':'b','kind':'todo','date':T,'title':'回复房东邮件','done':False,'star':True,'due':'','place':'','notes':'','subs':[]},
 {'id':'c','kind':'todo','date':T,'title':'预约牙医','done':False,'star':False,'due':'','place':'','notes':'','subs':[{'id':'s1','text':'查电话','done':False}]},
 {'id':'d','kind':'todo','date':T,'title':'取快递','done':True,'star':False,'due':'','place':'','notes':'','subs':[]},
 {'id':'e','kind':'todo','date':T,'title':'给猫买粮','done':False,'star':False,'due':'','place':'','notes':'','subs':[]},
]
seed = json.dumps({'version':2,'items':items,'note':'牙医电话在冰箱贴上。'})
res = {}
def say(k, v): print(k + ':', v)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    def page(w, h):
        ctx = b.new_context(viewport={'width': w, 'height': h}, screen={'width': w, 'height': h}, timezone_id='Asia/Shanghai')
        pg = ctx.new_page()
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.route(WP, lambda r: r.fulfill(path=WPFILE, headers={'Content-Type': 'image/jpeg'}))
        pg.add_init_script('window.__SEED = %s; window.__WP = %s;' % (json.dumps(seed), json.dumps(WP)))
        pg.add_init_script(path=HERE + 'mock_cn.js')
        pg.goto('file://' + ROOT + '/src/index.html')
        pg.wait_for_timeout(1200)
        return pg, errs

    # ---------- 150% 缩放的 1080p：可用高度 672 ----------
    pg, errs = page(1280, 672)
    pg.click('[data-act=settings]'); pg.fill('#s-user', 'me@icloud.com'); pg.fill('#s-pass', 'x'); pg.click('#s-connect button[type=submit]'); pg.wait_for_timeout(1200)
    pg.click('[data-act=s-close]'); pg.wait_for_timeout(700)
    g = pg.evaluate('''(() => { const r = (id) => document.getElementById(id).getBoundingClientRect();
      const day = document.getElementById('day');
      return { shell: Math.round(r('shell').height), events: Math.round(r('events').height), evN: document.querySelectorAll('#events .ev').length,
               todos: Math.round(r('todos').height), note: Math.round(r('note').getBoundingClientRect ? r('note').height : 0),
               noteBottom: Math.round(document.querySelector('.note').getBoundingClientRect().bottom), dayBottom: Math.round(r('day').bottom),
               dayScroll: day.scrollHeight - day.clientHeight }; })()''')
    say('150% layout', g)
    pg.screenshot(path=OUT + 'v4-150.png')

    # ---------- 正常尺寸 ----------
    pg, errs = page(1536, 960)
    pg.click('[data-act=settings]'); pg.fill('#s-user', 'me@icloud.com'); pg.fill('#s-pass', 'x'); pg.click('#s-connect button[type=submit]'); pg.wait_for_timeout(1200)
    pg.click('[data-act=s-close]'); pg.wait_for_timeout(600)
    order = lambda: pg.evaluate('Array.from(document.querySelectorAll("#todos .td .name")).map(n => n.textContent)')
    say('todo order', order())
    # 勾掉一个重点待办：先停在原位，约 1 秒后沉底
    pg.click('#todos .td:nth-child(1) .check'); pg.wait_for_timeout(200); say('right after check', order()[0])
    pg.wait_for_timeout(1100); say('after settle', order())
    # 行内星标
    pg.hover('#todos .td:has-text("给猫买粮")'); pg.click('#todos .td:has-text("给猫买粮") .row-star'); pg.wait_for_timeout(300); say('after row-star', order()[:3])
    pg.screenshot(path=OUT + 'v4-todos.png', clip={'x': 1140, 'y': 380, 'width': 372, 'height': 330})
    # 点“+”不写就关：不留“未命名”
    n0 = len(order()); pg.click('[data-act=add-todo]'); pg.wait_for_timeout(300); pg.keyboard.press('Escape'); pg.wait_for_timeout(300); say('draft cleaned', (n0, len(order()), pg.evaluate('S.panel')))
    # 新建后写了标题，按 Enter 保存并关闭
    pg.click('[data-act=add-todo]'); pg.wait_for_timeout(200); pg.keyboard.type('洗衣服'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300); say('enter saves', ('洗衣服' in order(), pg.evaluate('S.panel')))
    # Esc 没有焦点也能关
    pg.click('#todos .td:has-text("预约牙医") .open'); pg.wait_for_timeout(300); pg.mouse.click(5, 5); pg.keyboard.press('Escape'); pg.wait_for_timeout(200); say('esc closes', pg.evaluate('S.panel'))
    # 再点同一条收起
    pg.click('#todos .td:has-text("预约牙医") .open'); pg.wait_for_timeout(200); pg.click('#todos .td:has-text("预约牙医") .open'); pg.wait_for_timeout(200); say('click again closes', pg.evaluate('S.panel'))
    # 子任务直接改字
    pg.click('#todos .td:has-text("预约牙医") .open'); pg.wait_for_timeout(300); pg.fill('#p-subs .sub-name', '查诊所电话'); pg.wait_for_timeout(100)
    say('sub edited', pg.evaluate('S.items.find(i => i.id === "c").subs[0].text'))
    # 删除本机待办 → 撤销
    pg.click('#p-del'); pg.wait_for_timeout(400); say('toast', pg.evaluate('[toast.classList.contains("on"), document.getElementById("toast-text").textContent]'))
    pg.screenshot(path=OUT + 'v4-toast.png')
    pg.click('#toast-btn'); pg.wait_for_timeout(300); say('undo restored', '预约牙医' in order())
    # 日程 ⇄ 待办、全天
    pg.click('#todos .td:has-text("洗衣服") .open'); pg.wait_for_timeout(300); pg.click('#p-kind'); pg.wait_for_timeout(300)
    say('todo->event', pg.evaluate('(() => { const it = S.items.find(i => i.title === "洗衣服"); return [it.kind, it.start, it.end, document.getElementById("p-time-row").hidden, !document.getElementById("p-cal-pick").hidden]; })()'))
    pg.fill('#p-start', '20:15'); pg.wait_for_timeout(100); say('start moves end', pg.evaluate('[document.getElementById("p-end").value, S.items.find(i => i.title === "洗衣服").end]'))
    pg.click('#p-allday'); pg.wait_for_timeout(200); say('allday', pg.evaluate('[S.items.find(i => i.title === "洗衣服").allDay, document.getElementById("p-time-row").hidden]'))
    pg.click('#p-allday'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # 底部“记一笔”：有时间 → 日程；只有日期 → 待办，并提示加到了哪天
    pg.fill('#quick-input', '明天 买牛奶'); pg.press('#quick-input', 'Enter'); pg.wait_for_timeout(300)
    say('quick date-only', pg.evaluate('(() => { const it = S.items.find(i => i.title === "买牛奶"); return [it.kind, it.date]; })()'), )
    say('quick toast', pg.evaluate('document.getElementById("toast-text").textContent'))
    pg.click('#toast-btn'); pg.wait_for_timeout(300); viewing = pg.evaluate('S.date'); say('jumped to', viewing)
    pg.fill('#quick-input', '下午3点到4点半 开组会'); pg.press('#quick-input', 'Enter'); pg.wait_for_timeout(300)
    say('quick timed on viewed day', pg.evaluate('(() => { const it = S.items.find(i => i.title === "开组会"); return [it.kind, it.date, it.start, it.end]; })()'))
    pg.click('[data-act=go-today]'); pg.wait_for_timeout(300)
    # 改 iCloud 日程的提醒：写回去的文本里提醒是新的；只改地点不动提醒
    pg.click('#events .ev:has-text("取体检报告")'); pg.wait_for_timeout(300)
    say('remind enabled', pg.evaluate('!document.getElementById("p-remind").disabled'))
    pg.select_option('#p-remind', '30'); pg.wait_for_timeout(2200)
    key = 'https://p42-caldav.icloud.com.cn:443/123/calendars/home/ONE.ics'
    say('server alarm', pg.evaluate('(() => { const t = window.__server[%s].ics; return [(t.match(/BEGIN:VALARM/g)||[]).length, (/TRIGGER:(.*)/.exec(t)||[])[1]]; })()' % json.dumps(key)))
    pg.fill('#p-place', '校医院'); pg.wait_for_timeout(2200)
    say('place kept alarm', pg.evaluate('(() => { const t = window.__server[%s].ics; return [/LOCATION:(.*)/.exec(t)[1], (t.match(/BEGIN:VALARM/g)||[]).length, (/TRIGGER:(.*)/.exec(t)||[])[1]]; })()' % json.dumps(key)))
    # 重复课程：只读，提醒也锁着
    pg.click('#events .ev:not(:has-text("取体检报告")) >> nth=0'); pg.wait_for_timeout(300); say('recurring locked', pg.evaluate('[document.getElementById("p-title").disabled, document.getElementById("p-remind").disabled, document.getElementById("p-del").hidden, document.getElementById("p-kind").disabled]'))
    pg.keyboard.press('Escape')
    # 新建到 iCloud 带提醒
    pg.click('[data-act=settings]'); pg.select_option('#s-target', index=2); pg.click('[data-act=s-close]')
    pg.click('[data-act=add-event]'); pg.wait_for_timeout(200); pg.keyboard.type('小组讨论'); pg.select_option('#p-remind', '5'); pg.keyboard.press('Escape'); pg.wait_for_timeout(900)
    say('uploaded alarm', pg.evaluate('Object.values(window.__server).filter(v => /小组讨论/.test(v.ics)).map(v => (/TRIGGER:(.*)/.exec(v.ics)||[])[1])'))
    # 月视图：点格子空白弹出当天，小窗口里直接勾待办
    pg.click('[data-act=view]'); pg.click('[data-act=big-open]'); pg.wait_for_timeout(700)
    cell = pg.locator('#big-grid .cell.sel')
    bb = cell.bounding_box(); pg.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] - 4); pg.wait_for_timeout(500)
    say('pop by blank', pg.evaluate('S.pop'))
    before = pg.evaluate('S.items.find(i => i.title === "回复房东邮件").done')
    pg.click('#pop-list .prow.todo:has-text("回复房东邮件") .pcheck'); pg.wait_for_timeout(300)
    say('pop toggle', (before, pg.evaluate('S.items.find(i => i.title === "回复房东邮件").done'), pg.evaluate('S.pop') is not None))
    pg.screenshot(path=OUT + 'v4-pop.png')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200); say('esc pop', pg.evaluate('[S.pop, S.big]'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(600); say('esc big', pg.evaluate('[S.big, S.mode]'))
    # 20 秒刷新不重写列表
    pg.evaluate('window.__mark = document.querySelector("#todos .td")'); pg.evaluate('render()'); say('dom kept on re-render', pg.evaluate('window.__mark === document.querySelector("#todos .td")'))
    say('errors', errs)

    # ---------- 快速记录窗口 ----------
    ctx = b.new_context(viewport={'width': 680, 'height': 320}, timezone_id='Asia/Shanghai')
    cp = ctx.new_page(); cerr = []
    cp.on('pageerror', lambda e: cerr.append(str(e)))
    cp.add_init_script('window.__sent = []; window.__TAURI__ = { core: { invoke: async (c, a) => { window.__sent.push([c, a]); } }, event: { listen: async (n, f) => { (window.__L = window.__L || {})[n] = f; } } }; localStorage.setItem("jinjian-theme", "light");')
    cp.goto('file://' + ROOT + '/src/capture.html'); cp.wait_for_timeout(500)
    cp.keyboard.type('明天'); cp.keyboard.press('Tab'); cp.keyboard.press('Tab'); cp.keyboard.type(' 想法：周报模板'); cp.wait_for_timeout(100)
    say('capture kind kept', cp.evaluate('document.querySelector("[aria-pressed=true]").dataset.kind'))
    cp.evaluate('window.dispatchEvent(new Event("blur"))'); cp.evaluate('window.__L["capture-open"]()'); cp.wait_for_timeout(200)
    say('draft kept', cp.input_value('#text'))
    say('capture theme', cp.evaluate('document.documentElement.dataset.theme'))
    cp.screenshot(path=OUT + 'v4-capture-light.png')
    cp.keyboard.press('Escape'); say('esc clears', repr(cp.input_value('#text')))
    cp.keyboard.type('明天下午2点到4点 开会'); cp.keyboard.press('Enter'); cp.wait_for_timeout(100)
    say('capture payload', json.loads([x for x in cp.evaluate('window.__sent') if x[0] == 'capture_submit'][-1][1]['payload']))
    cp.keyboard.type('明天 买牛奶'); cp.wait_for_timeout(100); say('date-only kind', cp.evaluate('document.querySelector("[aria-pressed=true]").dataset.kind'))
    say('capture errors', cerr)
    b.close()
