// 今笺 Jinjian：一天里的时间冲突和空档（0.9.0）。纯函数，浏览器和 Node 里都能用，单测在 tests/slots.test.js。
// 时刻一律是“一天里的第几分钟”（0–1440）。list：[{ id, start, end }]，end 不晚于 start 的不算数。
(function (global) {
  'use strict';

  const LAST = 23 * 60 + 59;
  const valid = (x) => x && Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start;
  const up = (m, step) => Math.ceil(m / step) * step;

  // 扫线：按开始时间排好，从早到晚扫一遍；手里留着“还没结束的”那几条，新来的一条和它们每一条都重叠。
  // 返回 { id: [和它重叠的 id, …] }，没有重叠的 id 不出现。首尾相接（一个 10:00 结束、一个 10:00 开始）不算重叠。
  function conflicts(list) {
    const evs = (list || []).filter(valid).slice().sort((a, b) => (a.start - b.start) || (a.end - b.end));
    const out = {};
    let active = [];
    evs.forEach((e) => {
      active = active.filter((a) => a.end > e.start);
      active.forEach((a) => {
        (out[a.id] = out[a.id] || []).push(e.id);
        (out[e.id] = out[e.id] || []).push(a.id);
      });
      active.push(e);
    });
    return out;
  }

  // 占用的时间段并起来：[[start, end], …]，按先后排、互不相接
  function busy(list) {
    const evs = (list || []).filter(valid).map((x) => [x.start, x.end]).sort((a, b) => a[0] - b[0]);
    const out = [];
    evs.forEach((r) => {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1]) { if (r[1] > last[1]) last[1] = r[1]; } else out.push(r.slice());
    });
    return out;
  }

  // [from, to] 里不短于 min 分钟的空档：[{ start, end }, …]
  function free(list, from, to, min) {
    const need = min > 0 ? min : 1;
    const out = [];
    let at = from;
    busy(list).forEach((r) => {
      if (r[1] <= at) return;
      if (r[0] > at && Math.min(r[0], to) - at >= need) out.push({ start: at, end: Math.min(r[0], to) });
      at = Math.max(at, r[1]);
    });
    if (to - at >= need) out.push({ start: at, end: to });
    return out.filter((g) => g.start < to);
  }

  // 从 from 起（往后取整到 step 分钟）第一段不短于 len 的空档，整段给出；没有返回 null
  function nextFree(list, from, to, len, step) {
    const s = step || 15;
    const gaps = free(list, from, to, 1);
    for (let i = 0; i < gaps.length; i += 1) {
      const start = up(gaps[i].start, s);
      if (gaps[i].end - start >= len) return { start: start, end: gaps[i].end };
    }
    return null;
  }

  // “顺延”：把 it（list 里的一条）往后挪到第一个放得下、不和别人撞的位置，时长不变；起点取整到 step。
  // 不撞就返回 null（不用挪）；今天之内放不下也返回 null。
  function postpone(list, id, to, step) {
    const s = step || 15;
    const it = (list || []).find((x) => x && x.id === id);
    if (!valid(it)) return null;
    const others = (list || []).filter((x) => x && x.id !== id);
    const hit = (st) => others.filter(valid).some((o) => o.start < st + (it.end - it.start) && st < o.end);
    if (!hit(it.start)) return null;
    const g = nextFree(others, it.start, to === undefined ? LAST : to, it.end - it.start, s);
    return g ? { start: g.start, end: g.start + (it.end - it.start) } : null;
  }

  const api = { conflicts: conflicts, busy: busy, free: free, nextFree: nextFree, postpone: postpone, LAST: LAST };
  global.Slots = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
