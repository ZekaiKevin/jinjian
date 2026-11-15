'use strict';
// 周视图的纯函数：一周的日子、重叠排版、时间和像素互换、15 分钟吸附、拖动的结果。
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/week.js');

// ---------- 一周的日子 ----------

test('一周从周日开始', () => {
  // 2026-11-16 是周一
  assert.equal(W.weekStart('2026-11-16'), '2026-11-15');
  assert.equal(W.weekStart('2026-11-15'), '2026-11-15'); // 周日自己
  assert.equal(W.weekStart('2026-11-21'), '2026-11-15'); // 周六
  assert.deepEqual(W.weekKeys('2026-11-18'), ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
});

test('一周跨月、跨年也对', () => {
  assert.deepEqual(W.weekKeys('2026-10-31'), ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
  assert.equal(W.weekKeys('2026-01-01')[0], '2025-12-28');
  assert.equal(W.weekKeys('2026-01-01')[6], '2026-01-03');
  assert.equal(W.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(W.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(W.addDays('2026-11-16', -7), '2026-11-09');
});

test('周标题：同月、跨月、跨年', () => {
  assert.equal(W.rangeTitle('2026-11-18'), '2026年11月15日 – 21日');
  assert.equal(W.rangeTitle('2026-10-31'), '2026年10月25日 – 31日');
  assert.equal(W.rangeTitle('2026-11-01'), '2026年11月1日 – 7日');
  assert.equal(W.rangeTitle('2026-09-30'), '2026年9月27日 – 10月3日');
  assert.equal(W.rangeTitle('2026-01-01'), '2025年12月28日 – 2026年1月3日');
});

test('月视图切到周视图落在哪天', () => {
  const vm = { y: 2026, m: 10 }; // 2026 年 11 月
  assert.equal(W.anchor(vm, '2026-11-20', '2026-11-16'), '2026-11-20'); // 看的那天在这个月里
  assert.equal(W.anchor(vm, '2026-12-05', '2026-11-16'), '2026-11-16'); // 不在，但今天在
  assert.equal(W.anchor(vm, '2026-12-05', '2026-12-05'), '2026-11-01'); // 都不在，用 1 号
  assert.equal(W.anchor({ y: 2027, m: 0 }, '2026-11-20', '2026-11-16'), '2027-01-01');
});

// ---------- 时刻、像素、吸附 ----------

test('时刻和分钟互换，最晚到 23:59', () => {
  assert.equal(W.toMin('09:05'), 545);
  assert.equal(W.toMin('9:05'), 545);
  assert.equal(W.toMin(''), null);
  assert.equal(W.toMin(undefined), null);
  assert.equal(W.fromMin(545), '09:05');
  assert.equal(W.fromMin(1440), '23:59');
  assert.equal(W.fromMin(-5), '00:00');
});

test('时间和像素：一小时 48 像素，15 分钟 12 像素', () => {
  assert.equal(W.minToY(60), 48);
  assert.equal(W.minToY(15), 12);
  assert.equal(W.yToMin(48), 60);
  assert.equal(W.yToMin(12), 15);
  assert.equal(W.yToMin(W.minToY(437)), 437);
  assert.equal(W.minToY(90, 60), 90); // 换一小时的高度也行
});

test('15 分钟吸附：四舍五入到最近的一格', () => {
  assert.equal(W.snap(7), 0);
  assert.equal(W.snap(8), 15);
  assert.equal(W.snap(22), 15);
  assert.equal(W.snap(23), 30);
  assert.equal(W.snap(547), 540);
  assert.equal(W.snap(548), 555);
  assert.equal(W.snap(100, 30), 90);
});

test('看到哪里：本周有今天看现在，否则看那天第一个日程，再没有从 7 点', () => {
  assert.equal(W.scrollTop({ now: 14 * 60 }), 14 * 48 - 96);
  assert.equal(W.scrollTop({ now: null, first: 9 * 60 }), 9 * 48 - 96);
  assert.equal(W.scrollTop({ now: 14 * 60, first: 9 * 60 }), 14 * 48 - 96); // 现在优先
  assert.equal(W.scrollTop({}), 7 * 48 - 96);
  assert.equal(W.scrollTop({ now: 30 }), 0); // 不会是负的
});

test('指针落在第几列，超出两边就贴边', () => {
  assert.equal(W.colAt(100, 50, 100, 7), 0);
  assert.equal(W.colAt(149, 50, 100, 7), 0);
  assert.equal(W.colAt(150, 50, 100, 7), 1);
  assert.equal(W.colAt(749, 50, 100, 7), 6);
  assert.equal(W.colAt(5000, 50, 100, 7), 6);
  assert.equal(W.colAt(-20, 50, 100, 7), 0);
});

// ---------- 重叠排版 ----------

const ev = (id, s, e) => ({ id: id, start: s, end: e });

test('不重叠的各占一整列', () => {
  const l = W.layout([ev('a', 540, 600), ev('b', 600, 660), ev('c', 720, 780)]);
  assert.deepEqual(l.a, { col: 0, cols: 1, span: 1 });
  assert.deepEqual(l.b, { col: 0, cols: 1, span: 1 }); // 首尾相接不算重叠
  assert.deepEqual(l.c, { col: 0, cols: 1, span: 1 });
});

test('同一时段三个日程并排，三栏各一份', () => {
  const l = W.layout([ev('a', 600, 660), ev('b', 600, 660), ev('c', 600, 660)]);
  assert.deepEqual([l.a.col, l.b.col, l.c.col], [0, 1, 2]);
  assert.deepEqual([l.a.cols, l.b.cols, l.c.cols], [3, 3, 3]);
});

test('连着重叠成一簇：a 和 b 重叠、b 和 c 重叠，a 和 c 不重叠，c 回到第一栏', () => {
  const l = W.layout([ev('a', 540, 620), ev('b', 600, 700), ev('c', 650, 720)]);
  assert.equal(l.a.col, 0);
  assert.equal(l.b.col, 1);
  assert.equal(l.c.col, 0);
  assert.equal(l.a.cols, 2);
  assert.equal(l.c.cols, 2);
});

test('两簇互不影响：上午挤三个、下午只有一个，下午那个还是整列', () => {
  const l = W.layout([ev('a', 540, 600), ev('b', 540, 600), ev('c', 540, 600), ev('d', 840, 900)]);
  assert.equal(l.a.cols, 3);
  assert.deepEqual(l.d, { col: 0, cols: 1, span: 1 });
});

test('右边几栏在这段时间里没人，就向右撑宽', () => {
  // k0 贯穿整段占第 0 栏；i（9:00–10:00）和 z（11:00–12:00）先后占第 1 栏；j（11:30–12:30）只好在第 2 栏。
  // i 的时段里第 2 栏是空的，所以 i 占两栏；z 和 j 重叠，不能撑；k0 的右边有 i，不能撑。
  const l = W.layout([ev('k0', 540, 750), ev('i', 540, 600), ev('z', 660, 720), ev('j', 690, 750)]);
  assert.deepEqual(l.k0, { col: 0, cols: 3, span: 1 });
  assert.deepEqual(l.i, { col: 1, cols: 3, span: 2 });
  assert.deepEqual(l.z, { col: 1, cols: 3, span: 1 });
  assert.deepEqual(l.j, { col: 2, cols: 3, span: 1 });
});

test('栏的分配：先开始的占靠左的栏，空出来的栏被后面的接着用', () => {
  const l = W.layout([ev('a', 540, 600), ev('b', 570, 660), ev('c', 600, 700)]);
  assert.deepEqual([l.a.col, l.b.col, l.c.col], [0, 1, 0]); // c 在 a 结束时开始，接 a 的栏
  assert.deepEqual([l.a.cols, l.b.cols, l.c.cols], [2, 2, 2]);
});

test('排好的结果里同一簇的两块不会压在一起', () => {
  // 随机 200 次，每次 12 个，检查同一栏里的块互不重叠、栏号都小于栏数
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let n = 0; n < 200; n += 1) {
    const list = [];
    for (let i = 0; i < 12; i += 1) { const s = Math.floor(rnd() * 90) * 15; list.push(ev('e' + i, s, s + 15 * (1 + Math.floor(rnd() * 8)))); }
    const l = W.layout(list);
    list.forEach((a) => {
      assert.ok(l[a.id].col < l[a.id].cols);
      assert.ok(l[a.id].col + l[a.id].span <= l[a.id].cols);
      list.forEach((b) => {
        if (a.id >= b.id) return;
        const ae = W.visEnd(a.start, a.end);
        const be = W.visEnd(b.start, b.end);
        if (a.start < be && b.start < ae) {
          // 重叠的两块：栏不能相交
          const A = l[a.id];
          const B = l[b.id];
          assert.ok(A.col + A.span <= B.col || B.col + B.span <= A.col, JSON.stringify([a, b, A, B]));
        }
      });
    });
  }
});

test('太短的日程按 30 分钟算重叠：9:00–9:10 和 9:20–10:00 并排', () => {
  const l = W.layout([ev('a', 540, 550), ev('b', 560, 600)]);
  assert.equal(l.a.cols, 2);
  assert.notEqual(l.a.col, l.b.col);
});

test('位置：top 和 height 是像素，left 和 width 是百分比', () => {
  const r = { start: 9 * 60, end: 10 * 60 + 30 };
  const p = W.place(r, { col: 1, cols: 3, span: 1 });
  assert.equal(p.top, 9 * 48);
  assert.equal(p.height, 1.5 * 48 - 1);
  assert.ok(Math.abs(p.left - 100 / 3) < 1e-9);
  assert.ok(Math.abs(p.width - 100 / 3) < 1e-9);
  assert.equal(W.place({ start: 600, end: 610 }).height, 0.5 * 48 - 1); // 太短的按 30 分钟画
  assert.equal(W.place({ start: 600, end: 610 }, { col: 0, cols: 2, span: 2 }).width, 100);
});

test('哪些日程在时间轴上：没写开始时间的和全天的不在', () => {
  assert.deepEqual(W.rangeOf({ start: '09:00', end: '10:30' }), { start: 540, end: 630 });
  assert.deepEqual(W.rangeOf({ start: '09:00', end: '' }), { start: 540, end: 600 });          // 没写结束：一小时
  assert.deepEqual(W.rangeOf({ start: '09:00', end: '08:00' }), { start: 540, end: 600 });     // 结束早于开始：一小时
  assert.deepEqual(W.rangeOf({ start: '23:30', end: '' }), { start: 1410, end: 1440 });
  assert.equal(W.rangeOf({ start: '', end: '' }), null);
  assert.equal(W.rangeOf({ allDay: true, start: '09:00', end: '10:00' }), null);
});

// ---------- 拖动：整块挪 ----------

const E = (start, end, extra) => Object.assign({ kind: 'event', date: '2026-11-17', start: start, end: end }, extra || {});

test('挪到别的时间：开始吸附到 15 分钟，时长不变', () => {
  // 9:00–10:30 往下拖 100 分钟 → 10:40 → 吸附 10:45，结束 12:15
  assert.deepEqual(W.moveTimed(E('09:00', '10:30'), 100, 0), { date: '2026-11-17', start: '10:45', end: '12:15' });
  // 往上拖 40 分钟 → 8:20 → 8:15
  assert.deepEqual(W.moveTimed(E('09:00', '10:30'), -40, 0), { date: '2026-11-17', start: '08:15', end: '09:45' });
});

test('挪到别的天：时间不变；又挪天又挪时间两个都变', () => {
  assert.deepEqual(W.moveTimed(E('09:00', '10:30'), 0, 2), { date: '2026-11-19', start: '09:00', end: '10:30' });
  assert.deepEqual(W.moveTimed(E('09:00', '10:30'), 0, -3), { date: '2026-11-14', start: '09:00', end: '10:30' });
  assert.deepEqual(W.moveTimed(E('09:00', '10:30'), 30, 1), { date: '2026-11-18', start: '09:30', end: '11:00' });
});

test('挪得很小（不到半格）算没挪，原来不在 15 分钟上的时间不会被吸掉', () => {
  assert.deepEqual(W.moveTimed(E('09:07', '09:52'), 5, 0), { date: '2026-11-17', start: '09:07', end: '09:52' });
  assert.deepEqual(W.moveTimed(E('09:07', '09:52'), -7, 0), { date: '2026-11-17', start: '09:07', end: '09:52' });
  // 到半格以上才吸附
  assert.deepEqual(W.moveTimed(E('09:07', '09:52'), 8, 0), { date: '2026-11-17', start: '09:15', end: '10:00' });
});

test('整块不出这一天：拖过头就贴在 0 点或 23:59', () => {
  assert.deepEqual(W.moveTimed(E('09:00', '10:30'), -9999, 0), { date: '2026-11-17', start: '00:00', end: '01:30' });
  // 时长 90 分钟，最晚开始 22:15（22:15 + 90 = 23:45）；再晚的 22:30 会越过 23:59
  assert.deepEqual(W.moveTimed(E('09:00', '10:30'), 9999, 0), { date: '2026-11-17', start: '22:15', end: '23:45' });
  // 原来就到 23:59 的：拖到底开始时间吸附在 15 分钟上，结束仍不超过 23:59
  const r = W.moveTimed(E('22:00', '23:59'), 9999, 0);
  assert.equal(r.end <= '23:59', true);
  assert.equal(W.toMin(r.start) % 15, 0);
});

test('没写结束时间的，一挪就按一小时补上结束时间；没挪时间就不补', () => {
  assert.deepEqual(W.moveTimed(E('09:00', ''), 60, 0), { date: '2026-11-17', start: '10:00', end: '11:00' });
  assert.deepEqual(W.moveTimed(E('09:00', ''), 0, 1), { date: '2026-11-18', start: '09:00', end: '' });
  assert.deepEqual(W.drop('move', E('09:00', ''), { dMin: 0, dDays: 1 }), { patch: { date: '2026-11-18' }, reason: '' });
});

test('全天、没写时间的日程和待办只能换天', () => {
  assert.equal(W.moveTimed({ kind: 'event', allDay: true, date: '2026-11-17' }, 60, 1), null);
  assert.deepEqual(W.moveDay({ date: '2026-11-17' }, 3), { date: '2026-11-20' });
  assert.deepEqual(W.moveDay({ date: '2026-11-17' }, 0), { date: '2026-11-17' });
  // 待办：带时间的标记也只挪天，竖着拖多少都不改 due
  const t = { kind: 'todo', date: '2026-11-17', due: '15:30', title: 'x' };
  assert.deepEqual(W.drop('move', t, { dMin: 300, dDays: 2 }), { patch: { date: '2026-11-19' }, reason: '' });
  assert.deepEqual(W.drop('move', t, { dMin: 300, dDays: 0 }), { patch: null, reason: 'none' });
  const ad = { kind: 'event', allDay: true, date: '2026-11-17', start: '', end: '' };
  assert.deepEqual(W.drop('move', ad, { dMin: 99, dDays: -1 }), { patch: { date: '2026-11-16' }, reason: '' });
});

// ---------- 拖动：改结束时间 ----------

test('拖下边缘：结束吸附到 15 分钟', () => {
  assert.deepEqual(W.resizeEnd(E('09:00', '10:00'), 50), { end: '10:45' });   // 10:50 → 10:45
  assert.deepEqual(W.resizeEnd(E('09:00', '10:00'), 53), { end: '11:00' });   // 10:53 → 11:00
  assert.deepEqual(W.resizeEnd(E('09:00', '10:00'), -20), { end: '09:45' });  // 9:40 → 9:45
});

test('拖下边缘：至少比开始晚 15 分钟，最晚 23:59', () => {
  assert.deepEqual(W.resizeEnd(E('09:00', '10:00'), -500), { end: '09:15' });
  assert.deepEqual(W.resizeEnd(E('09:00', '10:00'), 5000), { end: '23:59' });
  assert.deepEqual(W.resizeEnd(E('23:00', '23:30'), 100), { end: '23:59' });
});

test('拖下边缘：很短的日程从画出来的下沿算起，轻轻一碰不改时间', () => {
  // 9:00–9:15 画出来是 30 分钟高；碰一下（不到半格）不变
  assert.deepEqual(W.resizeEnd(E('09:00', '09:15'), 4), { end: '09:15' });
  // 往下拖 15 分钟：从画出来的 9:30 往下 → 9:45
  assert.deepEqual(W.resizeEnd(E('09:00', '09:15'), 15), { end: '09:45' });
  // 往上拖到下沿以内：不会比开始早，最小 9:15
  assert.deepEqual(W.resizeEnd(E('09:00', '09:15'), -15), { end: '09:15' });
  assert.equal(W.resizeEnd({ allDay: true, date: 'x' }, 30), null);
});

test('drop：拖下边缘只改 end；没变化就是 none', () => {
  assert.deepEqual(W.drop('resize', E('09:00', '10:00'), { dMin: 50, dDays: 3 }), { patch: { end: '10:45' }, reason: '' });
  assert.deepEqual(W.drop('resize', E('09:00', '10:00'), { dMin: 3, dDays: 0 }), { patch: null, reason: 'none' });
  assert.deepEqual(W.drop('resize', E('09:00', '10:00'), { dMin: 60, dDays: 0 }), { patch: { end: '11:00' }, reason: '' });
});

test('drop：只写变了的字段', () => {
  assert.deepEqual(W.drop('move', E('09:00', '10:30'), { dMin: 0, dDays: 2 }), { patch: { date: '2026-11-19' }, reason: '' });
  assert.deepEqual(W.drop('move', E('09:00', '10:30'), { dMin: 60, dDays: 0 }), { patch: { start: '10:00', end: '11:30' }, reason: '' });
  assert.deepEqual(W.drop('move', E('09:00', '10:30'), { dMin: 60, dDays: -1 }), { patch: { date: '2026-11-16', start: '10:00', end: '11:30' }, reason: '' });
  assert.deepEqual(W.drop('move', E('09:00', '10:30'), { dMin: 2, dDays: 0 }), { patch: null, reason: 'none' });
});

test('drop：贴到底而位置没变，也算没变', () => {
  assert.deepEqual(W.drop('move', E('22:15', '23:45'), { dMin: 600, dDays: 0 }), { patch: null, reason: 'none' });
});

test('drop：跨天的 iCloud 日程只读，弹回原位', () => {
  const piece = E('20:00', '23:59', { remote: true, parts: 3 });
  assert.deepEqual(W.drop('move', piece, { dMin: 60, dDays: 1 }), { patch: null, reason: 'locked' });
  assert.deepEqual(W.drop('resize', piece, { dMin: 60, dDays: 0 }), { patch: null, reason: 'locked' });
  // 普通的 iCloud 日程和本机的都能拖
  assert.equal(W.drop('move', E('09:00', '10:00', { remote: true, parts: 0 }), { dMin: 60, dDays: 0 }).reason, '');
  assert.equal(W.locked({ remote: true, parts: 2 }), true);
  assert.equal(W.locked({ remote: true, parts: 0 }), false);
  assert.equal(W.locked({ parts: 2 }), false);
  assert.equal(W.locked(null), false);
});

// ---------- 拖出一段新建 ----------

test('拖出一段：覆盖按下那一格到现在那一格', () => {
  // 10:07 按下，拖到 10:40：10:00 – 10:45
  assert.deepEqual(W.createRange('2026-11-17', 10 * 60 + 7, 10 * 60 + 40), { date: '2026-11-17', start: '10:00', end: '10:45' });
  // 反着拖（从下往上）结果一样
  assert.deepEqual(W.createRange('2026-11-17', 10 * 60 + 40, 10 * 60 + 7), { date: '2026-11-17', start: '10:00', end: '10:45' });
  // 恰好在格线上
  assert.deepEqual(W.createRange('2026-11-17', 600, 660), { date: '2026-11-17', start: '10:00', end: '11:00' });
});

test('拖出一段：在同一格里拖也至少 15 分钟', () => {
  assert.deepEqual(W.createRange('2026-11-17', 603, 606), { date: '2026-11-17', start: '10:00', end: '10:15' });
  assert.deepEqual(W.createRange('2026-11-17', 600, 600), { date: '2026-11-17', start: '10:00', end: '10:15' });
});

test('拖出一段：到底了结束是 23:59，开始最晚 23:45', () => {
  assert.deepEqual(W.createRange('2026-11-17', 23 * 60 + 10, 5000), { date: '2026-11-17', start: '23:00', end: '23:59' });
  assert.deepEqual(W.createRange('2026-11-17', 1430, 1439), { date: '2026-11-17', start: '23:45', end: '23:59' });
  assert.deepEqual(W.createRange('2026-11-17', -50, 20), { date: '2026-11-17', start: '00:00', end: '00:30' });
});
