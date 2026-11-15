# 0.6.0：配色选项、随手记的截止词/跨午夜、输入法保护、草稿保留
import json, os, sys, warnings
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
    ctx = b.new_context(viewport={'width': 1536, 'height': 960}, screen={'width': 1536, 'height': 960}, timezone_id='Asia/Shanghai')
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(WP, lambda r: r.fulfill(path=HERE + 'assets/wallpaper.jpg', headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
    pg.add_init_script('window.__SEED = ""; window.__WP = %s;' % json.dumps(WP))
    pg.add_init_script(path=HERE + 'mock_cn.js')
    pg.goto('file://' + ROOT + '/src/index.html'); pg.wait_for_timeout(800)
    ev = lambda js: pg.evaluate(js)
    css = lambda name: ev('getComputedStyle(document.documentElement).getPropertyValue(%s).trim()' % json.dumps(name))

    # ---- 1. 配色 ----
    check('default palette indigo', ev('document.documentElement.dataset.palette') == 'indigo' and css('--bg') == '22 18 36', css('--bg'))
    pg.click('[data-act=settings]'); pg.wait_for_timeout(500)
    check('palette buttons', ev('[...document.querySelectorAll("#s-palette button")].map(b => b.textContent + ":" + b.getAttribute("aria-pressed"))') == ['默认:true', '石墨灰:false'])
    pg.click('#s-palette [data-v=graphite]'); pg.wait_for_timeout(500)
    check('graphite dark', ev('document.documentElement.dataset.palette') == 'graphite' and css('--bg') == '20 22 26' and css('--sh') == '8 10 14', css('--bg'))
    check('palette saved', ev('JSON.parse(window.__stored).settings.palette') == 'graphite')
    check('shared with capture window', ev('localStorage.getItem("jinjian-palette")') == 'graphite')
    pg.screenshot(path=OUT + 'v6-graphite-dark-settings.png', clip={'x': 760, 'y': 0, 'width': 776, 'height': 920})
    pg.click('#s-theme [data-v=light]'); pg.wait_for_timeout(500)
    check('graphite light', css('--bg') == '246 247 249', css('--bg'))
    pg.screenshot(path=OUT + 'v6-graphite-light-settings.png', clip={'x': 760, 'y': 0, 'width': 776, 'height': 920})
    pg.click('#s-theme [data-v=dark]'); pg.click('[data-act=s-close]'); pg.wait_for_timeout(500)
    # 浅色字配石墨灰深色字：深色字的颜色是石墨灰，不带紫
    pg.click('[data-act=settings]'); pg.click('#s-theme [data-v=light]'); pg.click('[data-act=s-close]'); pg.wait_for_timeout(400)
    ev('document.documentElement.dataset.ink = "dark"')
    check('graphite dark ink text', css('--fg') == '20 22 26', css('--fg'))
    pg.click('[data-act=settings]'); pg.click('#s-theme [data-v=dark]'); pg.wait_for_timeout(300)
    pg.screenshot(path=OUT + 'v6-graphite-day.png', clip={'x': 1140, 'y': 0, 'width': 396, 'height': 900})
    pg.click('#s-palette [data-v=indigo]'); pg.wait_for_timeout(400)
    check('back to default', css('--bg') == '22 18 36' and ev('JSON.parse(window.__stored).settings.palette') == 'indigo')
    pg.click('[data-act=s-close]'); pg.wait_for_timeout(300)

    # ---- 2. 快速添加：截止、跨午夜 ----
    def quick(text):
        pg.fill('#quick-input', text); pg.keyboard.press('Enter'); pg.wait_for_timeout(250)
        return ev('S.items.slice(-1)[0]')
    it = quick('下午3点前 交周报')
    check('deadline → todo with due', it['kind'] == 'todo' and it['title'] == '交周报' and it['due'] == '15:00', it)
    it = quick('晚上11点到凌晨1点 赶稿')
    check('overnight → event to 23:59', it['kind'] == 'event' and it['start'] == '23:00' and it['end'] == '23:59' and it['title'] == '赶稿', it)
    it = quick('下午3点 开会')
    check('plain time still event', it['kind'] == 'event' and it['start'] == '15:00', it)
    check('no page errors (main)', not errs, errs)

    # ---- 3. 随手记窗口 ----
    cx = b.new_context(viewport={'width': 680, 'height': 320}, timezone_id='Asia/Shanghai')
    cp = cx.new_page(); cerr = []
    cp.on('pageerror', lambda e: cerr.append(str(e)))
    cp.add_init_script('window.__sent = []; window.__TAURI__ = { core: { invoke: async (c, a) => { window.__sent.push([c, a]); } }, event: { listen: async (n, f) => { (window.__L = window.__L || {})[n] = f; } } };')
    cp.goto('file://' + ROOT + '/src/capture.html'); cp.wait_for_timeout(500)
    kind = lambda: cp.evaluate('document.querySelector("[aria-pressed=true]").dataset.kind')
    cp.keyboard.type('下午3点前 交周报'); cp.wait_for_timeout(100)
    check('capture: deadline is a todo', kind() == 'todo', kind())
    check('capture: title cleaned', cp.inner_text('#what') == '交周报', cp.inner_text('#what'))
    cp.fill('#text', ''); cp.keyboard.type('晚上11点到凌晨1点 赶稿'); cp.keyboard.press('Enter'); cp.wait_for_timeout(100)
    pl = json.loads([x for x in cp.evaluate('window.__sent') if x[0] == 'capture_submit'][-1][1]['payload'])
    check('capture: overnight payload', pl['kind'] == 'event' and pl['time'] == '23:00' and pl['endTime'] == '23:59', pl)

    # 输入法组字中：Esc、Tab 不能关窗口、清草稿、切类型
    cp.fill('#text', '明天 开会'); cp.wait_for_timeout(100)
    sent0 = len(cp.evaluate('window.__sent'))
    cp.evaluate('''() => { const t = document.getElementById('text'); t.focus();
      for (const key of ['Escape', 'Tab']) t.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: true, keyCode: 229 })); }''')
    cp.wait_for_timeout(100)
    check('IME: Esc/Tab ignored while composing', cp.input_value('#text') == '明天 开会' and len(cp.evaluate('window.__sent')) == sent0 and kind() == 'todo', cp.input_value('#text'))
    # 没在组字时 Esc 照常放弃
    cp.keyboard.press('Escape'); cp.wait_for_timeout(100)
    check('Esc without IME clears and hides', cp.input_value('#text') == '' and cp.evaluate('window.__sent').pop()[0] == 'hide_capture')

    # 草稿：重新加载窗口后还在
    cp.fill('#text', '想法：周报模板'); cp.wait_for_timeout(100)
    cp.reload(); cp.wait_for_timeout(500)
    check('draft survives reload', cp.input_value('#text') == '想法：周报模板', cp.input_value('#text'))
    check('caret at end (not selected)', cp.evaluate('[document.getElementById("text").selectionStart, document.getElementById("text").selectionEnd]') == [7, 7], cp.evaluate('[document.getElementById("text").selectionStart, document.getElementById("text").selectionEnd]'))
    cp.keyboard.type('！'); check('typing appends', cp.input_value('#text') == '想法：周报模板！')
    # 保存后草稿清掉
    cp.keyboard.press('Enter'); cp.wait_for_timeout(100); cp.reload(); cp.wait_for_timeout(400)
    check('draft cleared after save', cp.input_value('#text') == '')

    # 配色同步到随手记窗口
    cp.evaluate('window.__L["palette"]({ payload: "graphite" })'); check('capture follows palette', cp.evaluate('document.documentElement.dataset.palette') == 'graphite')
    cp.screenshot(path=OUT + 'v6-capture-graphite.png')
    check('no page errors (capture)', not cerr, cerr)
    b.close()
print('ALL OK' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
