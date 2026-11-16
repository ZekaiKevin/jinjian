# 0.8.2：下拉框弹出来的选项看得清。
# 弹出列表是系统画的、不透明，Playwright 的截图里拍不到它，所以这里量的是每个 <option> 计算出来的字色和底色：
# 深色 / 浅色主题 × 两种配色 × 浅色字 / 深色字，详情和设置里所有下拉框的每个选项，对比度都要够（WCAG 的 4.5）。
# 修之前选项的字色是从 select 继承来的玻璃字色，底色是透明（系统按白底画），浅色字时对比度只有 1。
import json, os, warnings
warnings.filterwarnings('ignore')
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
WP = 'https://local.test/wp.jpg'
ok = True
def check(name, cond, extra=''):
    global ok
    if not cond: ok = False
    print(('PASS ' if cond else 'FAIL ') + name, str(extra) if extra != '' else '')

# 选项的字色、底色，算对比度。底色透明时按系统的白底算（Windows 上弹出列表默认就是白的）
MEASURE = '''() => {
  const parse = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const over = (top, under) => top.rgb.map((c, i) => c * top.a + under[i] * (1 - top.a));
  const out = [];
  document.querySelectorAll('select').forEach((sel) => {
    if (!sel.options.length) { const o = document.createElement('option'); o.textContent = '测试'; sel.appendChild(o); } // 没同步时日历列表是空的
    [...sel.options].forEach((o) => {
      const cs = getComputedStyle(o);
      const bg = over(parse(cs.backgroundColor), [255, 255, 255]);
      const fg = over(parse(cs.color), bg);
      const a = lum(fg), b = lum(bg);
      out.push({ sel: sel.id, opt: o.textContent.trim(), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) });
    });
  });
  return out;
}'''

with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    ctx = b.new_context(viewport={'width': 1536, 'height': 960}, screen={'width': 1536, 'height': 960}, timezone_id='Asia/Shanghai')
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.route(WP, lambda r: r.fulfill(path=HERE + 'assets/wallpaper.jpg', headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'}))
    seed = json.dumps({'version': 2, 'items': [], 'note': '', 'settings': {'theme': 'dark', 'tint': 50, 'blur': True, 'sync': {'on': False, 'user': '', 'cals': [], 'target': ''}}})
    pg.add_init_script('window.__SEED = %s; window.__WP = %s;' % (json.dumps(seed), json.dumps(WP)))
    pg.add_init_script(path=HERE + 'mock_cn.js')
    pg.goto('file://' + ROOT + '/src/index.html')
    pg.wait_for_timeout(900)
    ids = pg.evaluate('[...document.querySelectorAll("select")].map(s => s.id)')
    check('all the dropdowns are covered (detail: calendar, repeat, repeat end, remind; settings: target calendar)', set(['p-cal-pick', 'p-repeat', 'p-rend', 'p-remind', 's-target']) <= set(ids), ids)
    for theme in ['dark', 'light']:
        for palette in ['indigo', 'graphite']:
            for ink in ['light', 'dark']:
                pg.evaluate('(a) => { const r = document.documentElement; r.dataset.theme = a[0]; r.dataset.palette = a[1]; r.dataset.ink = a[2]; }', [theme, palette, ink])
                rows = pg.evaluate(MEASURE)
                worst = min(rows, key=lambda r: r['ratio'])
                check('options readable: theme %s, palette %s, %s text' % (theme, palette, ink), worst['ratio'] >= 4.5, worst)
    # 实际流程：按壁纸和玻璃自己算出来的字色深浅，打开详情时
    for theme, tint in [('dark', 50), ('light', 100), ('light', 0)]:
        pg.evaluate('(a) => { S.settings.theme = a[0]; S.settings.tint = a[1]; applySettings(); render(); }', [theme, tint]); pg.wait_for_timeout(300)
        rows = pg.evaluate(MEASURE)
        worst = min(rows, key=lambda r: r['ratio'])
        check('options readable as the app sets it up: theme %s, tint %d (ink %s)' % (theme, tint, pg.evaluate('document.documentElement.dataset.ink')), worst['ratio'] >= 4.5, worst)
    check('no page errors', not errs, errs)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
