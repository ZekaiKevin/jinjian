// 0.9.0：时间冲突（扫线）和空档。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Slots = require('../src/slots.js');

const e = (id, s, t) => ({ id: id, start: s * 60, end: t * 60 });
const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const span = (g) => (g ? hm(g.start) + '-' + hm(g.end) : null);

test('冲突：重叠的互相记着；首尾相接不算', () => {
  const c = Slots.conflicts([e('a', 9, 10), e('b', 9.5, 11), e('c', 10, 10.5), e('d', 11, 12), e('x', 14, 15)]);
  assert.deepEqual(Object.keys(c).sort(), ['a', 'b', 'c']);
  assert.deepEqual(c.a, ['b']);
  assert.deepEqual(c.b.slice().sort(), ['a', 'c']);
  assert.deepEqual(c.c, ['b']);
  assert.deepEqual(Slots.conflicts([e('a', 9, 10), e('b', 10, 11)]), {});
  assert.deepEqual(Slots.conflicts([]), {});
});

test('冲突：一个长的盖住好几个短的；写坏的时间不算', () => {
  const c = Slots.conflicts([e('long', 8, 18), e('a', 9, 10), e('b', 12, 13), e('c', 17.5, 19), { id: 'bad', start: 600, end: 600 }, { id: 'nan', start: NaN, end: 700 }]);
  assert.deepEqual(c.long.slice().sort(), ['a', 'b', 'c']);
  assert.deepEqual([c.a, c.b, c.c], [['long'], ['long'], ['long']]);
  assert.equal(c.bad, undefined);
});

test('冲突：和两两比较的结果一样（随机 200 组）', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let k = 0; k < 200; k += 1) {
    const list = [];
    for (let i = 0; i < 12; i += 1) { const s = Math.floor(rnd() * 96) * 15; list.push({ id: 'e' + i, start: s, end: s + (1 + Math.floor(rnd() * 8)) * 15 }); }
    const want = {};
    list.forEach((a) => list.forEach((b) => { if (a !== b && a.start < b.end && b.start < a.end) (want[a.id] = want[a.id] || []).push(b.id); }));
    const got = Slots.conflicts(list);
    Object.keys(got).forEach((id) => got[id].sort());
    Object.keys(want).forEach((id) => want[id].sort());
    assert.deepEqual(got, want);
  }
});

test('空档：占用的并起来，中间的空出来', () => {
  const list = [e('a', 9, 10), e('b', 9.5, 11), e('c', 13, 14)];
  assert.deepEqual(Slots.busy(list), [[540, 660], [780, 840]]);
  assert.deepEqual(Slots.free(list, 8 * 60, 18 * 60, 30).map(span), ['08:00-09:00', '11:00-13:00', '14:00-18:00']);
  assert.deepEqual(Slots.free(list, 9 * 60, 14 * 60, 30).map(span), ['11:00-13:00']);
  assert.deepEqual(Slots.free(list, 8 * 60, 18 * 60, 180).map(span), ['14:00-18:00']);
  assert.deepEqual(Slots.free([], 8 * 60, 9 * 60, 30).map(span), ['08:00-09:00']);
});

test('下一个空档：从现在往后、起点取整到 15 分钟、够长才算', () => {
  const list = [e('a', 15, 16), e('b', 16.25, 17)];
  assert.equal(span(Slots.nextFree(list, 14 * 60 + 48, Slots.LAST, 30)), '17:00-23:59'); // 15:00 前没有空，16:00–16:15 不够 30 分钟
  assert.equal(span(Slots.nextFree(list, 14 * 60 + 10, Slots.LAST, 30)), '14:15-15:00');
  assert.equal(span(Slots.nextFree(list, 14 * 60 + 48, Slots.LAST, 15)), '16:00-16:15');
  assert.equal(Slots.nextFree([e('a', 0, 24)], 600, Slots.LAST, 30), null);
  assert.equal(span(Slots.nextFree([], 600, Slots.LAST, 30)), '10:00-23:59');
});

test('顺延：往后找第一个放得下的位置，时长不变；不撞就不动', () => {
  const list = [e('me', 9, 10), e('a', 9.5, 10.5), e('b', 10.5, 11), e('c', 11.5, 13)];
  assert.equal(span(Slots.postpone(list, 'me')), '13:00-14:00');     // 11:00–11:30 只有半小时，放不下一小时
  assert.equal(span(Slots.postpone([e('me', 9, 9.5), e('a', 9, 10.5), e('b', 10.5, 11), e('c', 11.5, 13)], 'me')), '11:00-11:30');
  assert.equal(Slots.postpone([e('me', 9, 10), e('a', 10, 11)], 'me'), null);
  assert.equal(Slots.postpone([e('me', 22, 23.5), e('a', 22.5, 23.9)], 'me'), null);  // 今天之内放不下
  assert.equal(Slots.postpone(list, 'nobody'), null);
});
