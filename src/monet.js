// 今笺 Jinjian：“跟随壁纸”配色（0.9.0）。从壁纸里取一个主色，配出强调色和玻璃的底色。
// 纯函数，浏览器和 Node 里都能用，单测在 tests/monet.test.js。
//
//   quantize()  中位切分 + K-Means：把一堆像素分成 k 组，每组一个代表色
//   mood()      挑“主情绪色”：占的面积大、又有颜色的那一组（大片的黑、白、灰不算）
//   solve()     在 OKLCH 里只动明度，找一个和底色的对比度够（WCAG，默认 4.5:1）的颜色
//   scheme()    上面三步连起来，给出深色字 / 浅色字两套强调色和深 / 浅两种玻璃底色
(function (global) {
  'use strict';

  // ---------- 颜色换算：sRGB ↔ OKLab / OKLCH ----------
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const gam = (v) => { const x = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; return x * 255; };

  function toOklch(rgb) {
    const r = lin(rgb[0]);
    const g = lin(rgb[1]);
    const b = lin(rgb[2]);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    const h = (Math.atan2(B, A) * 180) / Math.PI;
    return [L, Math.sqrt(A * A + B * B), h < 0 ? h + 360 : h];
  }

  // 换回 sRGB，不夹取；第二个返回值说它在不在显示得出来的范围里
  function rawRgb(lch) {
    const a = lch[1] * Math.cos((lch[2] * Math.PI) / 180);
    const b = lch[1] * Math.sin((lch[2] * Math.PI) / 180);
    const l = Math.pow(lch[0] + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(lch[0] - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(lch[0] - 0.0894841775 * a - 1.291485548 * b, 3);
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    const ok = [r, g, bl].every((v) => v >= -0.0005 && v <= 1.0005);
    return { rgb: [gam(Math.max(0, r)), gam(Math.max(0, g)), gam(Math.max(0, bl))], ok: ok };
  }

  // 显示不出来的颜色（太艳）：明度、色相不动，把彩度往回收到显示得出来为止
  function fromOklch(lch) {
    const L = Math.max(0, Math.min(1, lch[0]));
    let lo = 0;
    let hi = Math.max(0, lch[1]);
    let out = rawRgb([L, hi, lch[2]]);
    if (!out.ok) {
      for (let i = 0; i < 18; i += 1) {
        const mid = (lo + hi) / 2;
        if (rawRgb([L, mid, lch[2]]).ok) lo = mid; else hi = mid;
      }
      out = rawRgb([L, lo, lch[2]]);
    }
    return out.rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))));
  }

  // ---------- 对比度（WCAG 2） ----------
  const luminance = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  function contrast(a, b) {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  const onColor = (rgb) => (contrast(rgb, [255, 255, 255]) >= contrast(rgb, [27, 20, 8]) ? [255, 255, 255] : [27, 20, 8]);

  // 色相、彩度定了，只动明度，找和 bg 的对比度不低于 target 的颜色。
  // dir = 1 往亮处找（压在深色底上的浅色字），-1 往暗处找。从 start 起一小步一小步走，取第一个够的（离想要的明度最近）。
  // 走到头都不够（底色是中灰时两头都难）就给走到头的那个。
  function solve(hue, chroma, bg, target, dir, start) {
    const want = target || 4.5;
    let L = start === undefined ? (dir > 0 ? 0.7 : 0.55) : start;
    let best = fromOklch([L, chroma, hue]);
    for (let i = 0; i < 200; i += 1) {
      best = fromOklch([L, chroma, hue]);
      if (contrast(best, bg) >= want) return best;
      L += dir * 0.005;
      if (L > 1 || L < 0) break;
    }
    return best;
  }

  // ---------- 取色：中位切分 + K-Means ----------

  // data：RGBA 一维数组（canvas 的 getImageData）。返回 [{ rgb, n }]，n 是这一组有多少像素，按 n 从大到小。
  function quantize(data, k) {
    const px = [];
    for (let i = 0; i + 3 < data.length; i += 4) { if (data[i + 3] >= 128) px.push([data[i], data[i + 1], data[i + 2]]); }
    if (!px.length) return [];
    let boxes = [px];
    const want = Math.max(1, k || 8);
    while (boxes.length < want) {
      // 挑“最长的那条边最长”的一盒，沿那条边切开。切在这条边的中点而不是像素个数的中位：
      // 一种颜色占了大头时，按个数对半切会把两种颜色切进同一盒，中点切能先把差得最远的两类分开
      let pick = -1;
      let axis = 0;
      let span = 0;
      let cut = 0;
      boxes.forEach((box, bi) => {
        if (box.length < 2) return;
        for (let c = 0; c < 3; c += 1) {
          let lo = 255;
          let hi = 0;
          for (let i = 0; i < box.length; i += 1) { const v = box[i][c]; if (v < lo) lo = v; if (v > hi) hi = v; }
          if (hi - lo > span) { span = hi - lo; pick = bi; axis = c; cut = (lo + hi) / 2; }
        }
      });
      if (pick < 0 || span === 0) break;
      const box = boxes[pick];
      boxes.splice(pick, 1, box.filter((p) => p[axis] < cut), box.filter((p) => p[axis] >= cut));
    }
    // 切出来的几盒给出初始的几个中心，再跑几轮 K-Means：把每个像素归到离它最近的中心，边界上的像素就归对了
    let cs = boxes.filter((b) => b.length).map((box) => {
      const sum = [0, 0, 0];
      box.forEach((p) => { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; });
      return sum.map((v) => v / box.length);
    });
    let groups = [];
    for (let round = 0; round < 8; round += 1) {
      groups = cs.map(() => ({ sum: [0, 0, 0], n: 0 }));
      px.forEach((p) => {
        let best = 0;
        let dist = Infinity;
        cs.forEach((c, i) => {
          const d = (p[0] - c[0]) * (p[0] - c[0]) + (p[1] - c[1]) * (p[1] - c[1]) + (p[2] - c[2]) * (p[2] - c[2]);
          if (d < dist) { dist = d; best = i; }
        });
        const g = groups[best];
        g.sum[0] += p[0]; g.sum[1] += p[1]; g.sum[2] += p[2]; g.n += 1;
      });
      const next = groups.map((g, i) => (g.n ? g.sum.map((v) => v / g.n) : cs[i]));
      const moved = next.some((c, i) => Math.abs(c[0] - cs[i][0]) + Math.abs(c[1] - cs[i][1]) + Math.abs(c[2] - cs[i][2]) > 0.5);
      cs = next;
      if (!moved) break;
    }
    return groups.map((g, i) => ({ rgb: cs[i].map((v) => Math.round(v)), n: g.n })).filter((g) => g.n).sort((a, b) => b.n - a.n);
  }

  // 主情绪色：面积 × 有多“有颜色”。近黑、近白、发灰的大片（夜空、雪地、雾）分数很低；全是灰的壁纸返回 null。
  function mood(buckets) {
    let best = null;
    let top = 0;
    (buckets || []).forEach((b) => {
      const lch = toOklch(b.rgb);
      if (lch[1] < 0.03 || lch[0] < 0.12 || lch[0] > 0.97) return;
      const score = b.n * Math.min(1, lch[1] / 0.12) * (lch[0] < 0.25 || lch[0] > 0.9 ? 0.5 : 1);
      if (score > top) { top = score; best = b; }
    });
    return best ? best.rgb : null;
  }

  const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

  // 一套配色。seed 是主情绪色（null 表示壁纸没什么颜色：用中性的灰底配原来的琥珀色）。
  //   veil.dark / veil.light   深色 / 浅色主题下玻璃的底色（带一点点主色）
  //   onDark / onLight         浅色字 / 深色字时的强调色：accent（实心按钮、圆点）、ink（强调色的字）、on（压在 accent 上的字）
  // 强调色和它背后的底色对比度都不低于 4.5:1。
  function fromSeed(seed) {
    const lch = seed ? toOklch(seed) : [0.5, 0, 70];
    const flat = !seed;
    const hue = flat ? 70 : lch[2];
    const veilDark = fromOklch([0.2, flat ? 0.004 : Math.min(0.045, 0.02 + lch[1] * 0.25), hue]);
    const veilLight = fromOklch([0.975, flat ? 0.002 : 0.012, hue]);
    const c = flat ? 0.13 : Math.max(0.1, Math.min(0.17, lch[1] * 1.15));
    const a1 = solve(hue, c, veilDark, 4.5, 1, 0.78);
    const a2 = solve(hue, c, [255, 255, 255], 4.5, -1, 0.56);
    const ink2 = solve(hue, c * 0.9, veilLight, 7, -1, 0.45);
    return {
      seed: seed || null,
      veil: { dark: veilDark, light: veilLight },
      onDark: { accent: a1, ink: a1, on: onColor(a1) },
      onLight: { accent: a2, ink: ink2, on: onColor(a2) },
    };
  }

  function scheme(data, k) {
    return fromSeed(mood(quantize(data, k || 8)));
  }

  const api = { toOklch: toOklch, fromOklch: fromOklch, luminance: luminance, contrast: contrast, onColor: onColor, solve: solve, quantize: quantize, mood: mood, fromSeed: fromSeed, scheme: scheme, hex: hex };
  global.Monet = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
