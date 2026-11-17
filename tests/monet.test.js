// 0.9.0：“跟随壁纸”配色。取色（中位切分）、挑主情绪色、OKLCH 对比度求解。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Monet = require('../src/monet.js');

// 一张假“壁纸”：每种颜色占多少像素
function pixels(parts) {
  const out = [];
  parts.forEach(([rgb, n]) => { for (let i = 0; i < n; i += 1) out.push(rgb[0], rgb[1], rgb[2], 255); });
  return new Uint8ClampedArray(out);
}

test('OKLCH 往返：常见颜色转过去再转回来差不了 1', () => {
  [[255, 0, 0], [0, 128, 255], [27, 20, 8], [255, 180, 84], [128, 128, 128], [255, 255, 255], [0, 0, 0]].forEach((c) => {
    const back = Monet.fromOklch(Monet.toOklch(c));
    back.forEach((v, i) => assert.ok(Math.abs(v - c[i]) <= 1, c + ' → ' + back));
  });
  // 白的明度是 1，黑的是 0，灰没有彩度
  assert.ok(Math.abs(Monet.toOklch([255, 255, 255])[0] - 1) < 1e-3);
  assert.ok(Monet.toOklch([0, 0, 0])[0] < 1e-3);
  assert.ok(Monet.toOklch([128, 128, 128])[1] < 1e-3);
});

test('显示不出来的颜色：明度、色相不动，彩度收回来，结果都在 0–255 里', () => {
  const c = Monet.fromOklch([0.7, 0.4, 150]);
  c.forEach((v) => assert.ok(Number.isInteger(v) && v >= 0 && v <= 255));
  const lch = Monet.toOklch(c);
  assert.ok(Math.abs(lch[0] - 0.7) < 0.01);
  assert.ok(Math.abs(lch[2] - 150) < 3);
});

test('对比度：和 WCAG 的定义一致', () => {
  assert.ok(Math.abs(Monet.contrast([255, 255, 255], [0, 0, 0]) - 21) < 0.01);
  assert.equal(Monet.contrast([90, 90, 90], [90, 90, 90]), 1);
  assert.ok(Math.abs(Monet.contrast([118, 118, 118], [255, 255, 255]) - 4.54) < 0.02);
  // 亮黄底上用黑字，深蓝底上用白字
  assert.deepEqual(Monet.onColor([255, 204, 0]), [27, 20, 8]);
  assert.deepEqual(Monet.onColor([20, 40, 120]), [255, 255, 255]);
});

test('中位切分：两种颜色各一半，分出来就是这两种', () => {
  const b = Monet.quantize(pixels([[[200, 40, 40], 300], [[30, 60, 200], 100]]), 2);
  assert.equal(b.length, 2);
  assert.deepEqual(b[0], { rgb: [200, 40, 40], n: 300 });
  assert.deepEqual(b[1], { rgb: [30, 60, 200], n: 100 });
  // 透明的像素不算；一个像素也不剩时返回空
  assert.deepEqual(Monet.quantize(new Uint8ClampedArray([1, 2, 3, 0]), 4), []);
  // 只有一种颜色：分不开，就一组
  assert.equal(Monet.quantize(pixels([[[10, 20, 30], 50]]), 8).length, 1);
});

test('主情绪色：大片的黑、白、灰不算，挑面积大又有颜色的那一组', () => {
  // 夜空占八成、一片橙色的晚霞占两成：主色是橙
  const sunset = Monet.quantize(pixels([[[12, 12, 18], 800], [[230, 120, 40], 200]]), 4);
  assert.deepEqual(Monet.mood(sunset), [230, 120, 40]);
  // 雪地 + 一点蓝天
  const snow = Monet.quantize(pixels([[[250, 250, 252], 700], [[90, 150, 220], 150], [[120, 120, 120], 150]]), 4);
  assert.deepEqual(Monet.mood(snow), [90, 150, 220]);
  // 全是灰：没有主色
  assert.equal(Monet.mood(Monet.quantize(pixels([[[40, 40, 40], 100], [[200, 200, 200], 100]]), 4)), null);
});

test('配出来的颜色：强调色和它背后的底色对比度都够 4.5:1，压在强调色上的字也够', () => {
  const seeds = [[230, 120, 40], [40, 160, 90], [90, 150, 220], [200, 40, 120], [250, 230, 60], [120, 60, 200], null];
  seeds.forEach((seed) => {
    const s = Monet.fromSeed(seed);
    const tag = String(seed);
    assert.ok(Monet.contrast(s.onDark.accent, s.veil.dark) >= 4.5, tag + ' 深底上的强调色');
    assert.ok(Monet.contrast(s.onLight.accent, [255, 255, 255]) >= 4.5, tag + ' 浅底上的强调色');
    assert.ok(Monet.contrast(s.onLight.ink, s.veil.light) >= 4.5, tag + ' 浅底上强调色的字');
    assert.ok(Monet.contrast(s.onDark.on, s.onDark.accent) >= 4.5, tag + ' 深色主题里按钮上的字');
    assert.ok(Monet.contrast(s.onLight.on, s.onLight.accent) >= 4.5, tag + ' 浅色主题里按钮上的字');
    // 玻璃底色只带一点点主色：深的够深，浅的够浅
    assert.ok(Monet.toOklch(s.veil.dark)[0] < 0.25 && Monet.toOklch(s.veil.light)[0] > 0.95, tag);
  });
  // 强调色的色相跟着主色走
  const warm = Monet.fromSeed([230, 120, 40]);
  assert.ok(Math.abs(Monet.toOklch(warm.onDark.accent)[2] - Monet.toOklch([230, 120, 40])[2]) < 12);
});

test('scheme：整张壁纸的像素一步到位；hex 输出', () => {
  const s = Monet.scheme(pixels([[[12, 12, 18], 800], [[230, 120, 40], 200]]), 8);
  assert.deepEqual(s.seed, [230, 120, 40]);
  assert.match(Monet.hex(s.onDark.accent), /^#[0-9a-f]{6}$/);
  assert.equal(Monet.hex([255, 0, 16]), '#ff0010');
});
