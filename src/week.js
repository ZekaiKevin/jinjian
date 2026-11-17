// 今笺 Jinjian：周视图的纯函数部分（一周的日子、重叠排版、时间和像素互换、15 分钟吸附、拖动的结果）。
// 不碰界面，浏览器和 Node 里都能用，单测在 tests/week.test.js。
//
// 约定：日期是 'YYYY-MM-DD'，时刻是 'HH:MM'；算的时候都换成“一天里的第几分钟”（0–1439）。
// 日程不跨午夜（详情里也是），所以能到的最晚时刻是 23:59，拖动、拉长都不会越过它。
(function (global) {
  'use strict';

  const HOUR_PX = 48;          // 时间轴上一小时的高度（像素）
  const STEP = 15;             // 拖动吸附的分钟数
  const LAST = 23 * 60 + 59;   // 一天里最晚的时刻
  const MIN_VIS = 30;          // 太短的日程画出来也至少占这么多分钟，字才放得下；重叠排版按画出来的算
  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');

  // ---------- 日期（用 UTC 算天数，不受时区和夏令时影响） ----------
  const keyNo = (k) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof k === 'string' ? k : '');
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY : NaN;
  };
  const noKey = (n) => { const d = new Date(n * DAY); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  const addDays = (k, n) => noKey(keyNo(k) + n);
  const wday = (k) => new Date(keyNo(k) * DAY).getUTCDay();

  // 这一周从周日开始
  const weekStart = (k) => addDays(k, -wday(k));
  const weekKeys = (k) => { const s = weekStart(k); return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(s, i)); };

  // 标题：同一个月“2026年11月8日 – 14日”，跨月“2026年10月25日 – 11月1日”，跨年两边都写年
  function rangeTitle(k) {
    const a = weekStart(k);
    const b = addDays(a, 6);
    const pa = a.split('-').map(Number);
    const pb = b.split('-').map(Number);
    const head = pa[0] + '年' + pa[1] + '月' + pa[2] + '日';
    if (pa[0] !== pb[0]) return head + ' – ' + pb[0] + '年' + pb[1] + '月' + pb[2] + '日';
    if (pa[1] !== pb[1]) return head + ' – ' + pb[1] + '月' + pb[2] + '日';
    return head + ' – ' + pb[2] + '日';
  }

  // 从月视图切到周视图时落在哪一天：正在看的那天在这个月里就用它，否则这个月里有今天用今天，再不然 1 号
  function anchor(vm, date, today) {
    const inMonth = (k) => { const p = String(k).split('-').map(Number); return p[0] === vm.y && p[1] === vm.m + 1; };
    if (inMonth(date)) return date;
    if (inMonth(today)) return today;
    return vm.y + '-' + pad(vm.m + 1) + '-01';
  }

  // ---------- 时刻 ----------
  const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(typeof t === 'string' ? t : ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const fromMin = (m) => { const v = Math.max(0, Math.min(LAST, Math.round(m))); return pad(Math.floor(v / 60)) + ':' + pad(v % 60); };
  const snap = (m, step) => Math.round(m / (step || STEP)) * (step || STEP);

  // 时间和像素互换
  const minToY = (m, hourPx) => (m * (hourPx || HOUR_PX)) / 60;
  const yToMin = (y, hourPx) => (y * 60) / (hourPx || HOUR_PX);

  // 画出来的下沿：太短的按 MIN_VIS 算
  const visEnd = (s, e) => Math.min(1440, Math.max(e, s + MIN_VIS));

  // 一条日程在一天里占的分钟：没写开始时间的不在时间轴上（返回 null）；结束早于开始或没写，按一小时算
  function rangeOf(it) {
    const s = it ? toMin(it.start) : null;
    if (s === null || it.allDay) return null;
    let e = toMin(it.end);
    if (e === null || e <= s) e = Math.min(1440, s + 60);
    return { start: s, end: e };
  }

  // 一条在时间轴上占的分钟。日程按开始 / 结束；待办排成了时间块（有 due 也有 end，0.9.0）也算，
  // 只有 due 的待办是一个截止时刻，不占时间（返回 null，画成小标记）。
  function spanOf(it) {
    if (!it) return null;
    if (it.kind !== 'todo') return rangeOf(it);
    const s = toMin(it.due);
    const e = toMin(it.end);
    return s !== null && e !== null && e > s ? { start: s, end: e } : null;
  }
  // 待办的时间块拖动时当成“有开始 / 结束的一条”来算，算完再换回 due / end
  // 只有排成了时间块的待办才换；只有截止时刻的（小标记）、没写时间的照旧（拖动只换天）
  const asTimed = (it) => (it && it.kind === 'todo' && spanOf(it) ? Object.assign({}, it, { start: it.due, allDay: false }) : it);
  function fromTimed(it, patch) {
    if (!patch || !it || it.kind !== 'todo') return patch;
    const p = {};
    Object.keys(patch).forEach((k) => { p[k === 'start' ? 'due' : k] = patch[k]; });
    return p;
  }

  // ---------- 重叠排版 ----------
  // list：[{ id, start, end }]（分钟）。返回 { id: { col, cols, span } }：
  // 互相连着重叠的分成一簇，簇里贪心分栏；col 是第几栏，cols 是这一簇共几栏，
  // span 是向右能占几栏（右边几栏在这段时间里没人，就让它宽一点）。
  function layout(list) {
    const items = (list || []).map((x, i) => ({ id: x.id, s: x.start, e: visEnd(x.start, x.end), i: i }))
      .sort((a, b) => (a.s - b.s) || (b.e - a.e) || (a.i - b.i));
    const out = {};
    const hit = (a, b) => a.s < b.e && b.s < a.e;
    const finish = (cluster) => {
      const ends = [];
      cluster.forEach((it) => {
        let c = ends.findIndex((end) => end <= it.s);
        if (c < 0) { c = ends.length; ends.push(0); }
        ends[c] = it.e;
        it.col = c;
      });
      cluster.forEach((it) => {
        let span = 1;
        while (it.col + span < ends.length && !cluster.some((o) => o.col === it.col + span && hit(it, o))) span += 1;
        out[it.id] = { col: it.col, cols: ends.length, span: span };
      });
    };
    let cluster = [];
    let until = -1;
    items.forEach((it) => {
      if (cluster.length && it.s >= until) { finish(cluster); cluster = []; until = -1; }
      cluster.push(it);
      until = Math.max(until, it.e);
    });
    if (cluster.length) finish(cluster);
    return out;
  }

  // 一块日程在列里的位置：top / height 是像素，left / width 是百分比
  function place(r, lay, hourPx) {
    const top = minToY(r.start, hourPx);
    const height = Math.max(12, minToY(visEnd(r.start, r.end) - r.start, hourPx) - 1);
    const l = lay || { col: 0, cols: 1, span: 1 };
    return { top: top, height: height, left: (l.col / l.cols) * 100, width: (l.span / l.cols) * 100 };
  }

  // 指针的横坐标落在第几列（0–n-1）：left 是第一列的左边，stride 是相邻两列左边的距离
  const colAt = (x, left, stride, n) => Math.max(0, Math.min((n || 7) - 1, Math.floor((x - left) / stride)));

  // 打开周视图时滚到哪：本周有今天就看现在，否则看那天的第一个日程，再没有就从 7 点看起；留一点上文
  function scrollTop(opts) {
    const o = opts || {};
    const m = o.now != null ? o.now : o.first != null ? o.first : 7 * 60;
    const lead = o.lead === undefined ? 96 : o.lead;
    return Math.max(0, Math.round(minToY(m, o.hourPx) - lead));
  }

  // ---------- 拖动的结果 ----------
  // dMin：指针在垂直方向挪了多少分钟（还没吸附）；dDays：跨了几列。
  // 返回 { date, start, end }，没动的字段原样带回（原来的结束时间是空的，就还是空的）。

  // 挪一块有时间的日程：开始时间吸附到 15 分钟，时长不变，整块不出这一天
  function moveTimed(it, dMin, dDays) {
    const r = rangeOf(it);
    if (!r) return null;
    const date = dDays ? addDays(it.date, dDays) : it.date;
    if (Math.abs(dMin) < STEP / 2) return { date: date, start: it.start, end: it.end };
    const dur = r.end - r.start;
    const top = Math.floor(Math.max(0, LAST - dur) / STEP) * STEP;
    const start = Math.max(0, Math.min(top, snap(r.start + dMin)));
    return { date: date, start: fromMin(start), end: fromMin(Math.min(LAST, start + dur)) };
  }

  // 拖下边缘：结束时间吸附到 15 分钟，至少比开始晚 15 分钟，最晚 23:59。
  // 从画出来的下沿算起（太短的日程画得比真实的长），所以轻轻一碰不会凭空改时间。
  function resizeEnd(it, dMin) {
    const r = rangeOf(it);
    if (!r) return null;
    if (Math.abs(dMin) < STEP / 2) return { end: it.end };
    const end = Math.max(r.start + STEP, Math.min(LAST, snap(visEnd(r.start, r.end) + dMin)));
    return { end: fromMin(end) };
  }

  // 在空白处按下拖出一段：覆盖按下的那一格到现在指针所在的那一格（两端各自吸附到 15 分钟）。
  // m0、m1 是按下和现在的位置（分钟，没吸附）；返回 { date, start, end }。
  function createRange(date, m0, m1) {
    const lo = Math.min(m0, m1);
    const hi = Math.max(m0, m1);
    let start = Math.floor(lo / STEP) * STEP;
    let end = Math.ceil(hi / STEP) * STEP;
    start = Math.max(0, Math.min(1440 - STEP, start));
    if (end <= start) end = start + STEP;
    return { date: date, start: fromMin(start), end: fromMin(Math.min(LAST, end)) };
  }

  // 只能换天的：全天 / 没写时间的日程、待办（有时间的待办只挪天，时刻不变）
  function moveDay(it, dDays) {
    return { date: dDays ? addDays(it.date, dDays) : it.date };
  }

  // 从顶部一行（或待办栏）拖进时间轴：落在 date 那天，指针所在的那一格是开始（吸附到 15 分钟），默认一小时。
  // 待办变成时间块（due / end），全天、没写时间的日程变成有时间的。
  function toBlock(it, date, min, len) {
    const dur = len > 0 ? len : 60;
    const top = Math.floor(Math.max(0, LAST - dur) / STEP) * STEP;
    const start = Math.max(0, Math.min(top, Math.floor(min / STEP) * STEP));
    const s = fromMin(start);
    const e = fromMin(Math.min(LAST, start + dur));
    return it && it.kind === 'todo' ? { date: date, due: s, end: e } : { date: date, allDay: false, start: s, end: e };
  }

  // 从时间轴拖回顶部一行：待办去掉时间块，日程变成全天
  function toAllDay(it, date) {
    return it && it.kind === 'todo' ? { date: date, due: '', end: '' } : { date: date, allDay: true };
  }

  // 只留真的变了的字段
  function changed(it, patch) {
    const out = {};
    Object.keys(patch || {}).forEach((k) => { if ((patch[k] || '') !== (it[k] || '') && !(typeof patch[k] === 'boolean' && patch[k] === !!it[k])) out[k] = patch[k]; });
    return out;
  }

  // 跨天的 iCloud 日程在今笺里只读（详情里也是）
  const locked = (it) => !!(it && it.remote && it.parts);

  // 拖动松手后该怎么办。op：'move'（整块挪）/ 'resize'（拖下边缘）。
  // 返回 { patch, reason }：patch 是要写进条目的字段（只有变了的）；
  // reason：'' 可以写；'locked' 只读的，弹回原位；'none' 没变，什么也不用做。
  function drop(op, it, d) {
    if (locked(it)) return { patch: null, reason: 'locked' };
    const same = (k, a, b) => (k === 'date' ? a === b : toMin(a) === toMin(b) && (toMin(a) !== null || a === b));
    let next = null;
    if (op === 'resize') next = resizeEnd(it, d.dMin || 0);
    else if (rangeOf(it)) next = moveTimed(it, d.dMin || 0, d.dDays || 0);
    else next = moveDay(it, d.dDays || 0);
    const patch = {};
    if (next) Object.keys(next).forEach((k) => { if (!same(k, next[k], it[k])) patch[k] = next[k]; });
    return Object.keys(patch).length ? { patch: patch, reason: '' } : { patch: null, reason: 'none' };
  }

  const api = {
    HOUR_PX: HOUR_PX, STEP: STEP, LAST: LAST, MIN_VIS: MIN_VIS,
    addDays: addDays, weekStart: weekStart, weekKeys: weekKeys, rangeTitle: rangeTitle, anchor: anchor,
    toMin: toMin, fromMin: fromMin, snap: snap, minToY: minToY, yToMin: yToMin, visEnd: visEnd, rangeOf: rangeOf,
    layout: layout, place: place, colAt: colAt, scrollTop: scrollTop,
    moveTimed: moveTimed, resizeEnd: resizeEnd, createRange: createRange, moveDay: moveDay, locked: locked, drop: drop,
    spanOf: spanOf, asTimed: asTimed, fromTimed: fromTimed, toBlock: toBlock, toAllDay: toAllDay, changed: changed,
  };
  global.Week = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
