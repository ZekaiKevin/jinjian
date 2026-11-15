// 顶部倒数日条：挑哪几条、怎么排、怎么说。纯函数部分；界面见 tests/ui/ui11.py。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Countdown = require('../src/countdown.js');

const ev = (id, date, title, more) => Object.assign({ id: id, kind: 'event', date: date, start: '10:00', title: title, countdown: true }, more || {});
const td = (id, date, title, more) => Object.assign({ id: id, kind: 'todo', date: date, title: title, done: false, countdown: true }, more || {});
const pick = (items, today, max) => Countdown.pick(items, today || '2026-11-15', max);
const ids = (items, today, max) => pick(items, today, max).map((x) => x.id);

test('天数：按日历天算，跨月跨年都对', () => {
  assert.equal(Countdown.days('2026-11-15', '2026-11-15'), 0);
  assert.equal(Countdown.days('2026-11-15', '2026-11-16'), 1);
  assert.equal(Countdown.days('2026-11-15', '2027-02-06'), 83);
  assert.equal(Countdown.days('2026-12-31', '2027-01-01'), 1);
  assert.equal(Countdown.days('2027-02-27', '2027-03-01'), 2);
  assert.equal(Countdown.days('2028-02-28', '2028-03-01'), 2, '闰年');
  assert.equal(Countdown.days('2026-11-15', '2026-11-10'), -5);
  assert.ok(Number.isNaN(Countdown.days('x', '2026-11-10')));
});

test('只挑设为倒数日的，且不早于今天', () => {
  const items = [
    ev('a', '2026-12-01', '考试'),
    ev('plain', '2026-12-02', '没设倒数日', { countdown: false }),
    ev('nokey', '2026-12-03', '没有这个字段', { countdown: undefined }),
    ev('past', '2026-11-14', '昨天的'),
    td('today', '2026-11-15', '今天截止'),
  ];
  assert.deepEqual(ids(items), ['today', 'a']);
  assert.deepEqual(pick([]), []);
  assert.deepEqual(pick(null), []);
});

test('完成的待办不再倒数', () => {
  assert.deepEqual(ids([td('d', '2026-11-20', '交论文', { done: true }), td('u', '2026-11-21', '写报告')]), ['u']);
});

test('按日期排，同一天按开始时间，再按标题；最多 3 条', () => {
  const items = [
    ev('far', '2027-02-06', '春节'),
    ev('b', '2026-11-20', '乙', { start: '09:00' }),
    ev('a2', '2026-11-20', '甲', { start: '10:00' }),
    ev('a1', '2026-11-20', '丙', { start: '08:00' }),
    ev('n', '2026-11-18', '更近'),
    td('t', '2026-11-20', '待办'), // 没有开始时间，排在同一天有时间的后面
  ];
  assert.deepEqual(ids(items), ['n', 'a1', 'b']);
  assert.deepEqual(ids(items, '2026-11-15', 5), ['n', 'a1', 'b', 'a2', 't']);
  assert.deepEqual(ids(items, '2026-11-15', 1), ['n']);
  assert.deepEqual(ids(items, '2026-11-15', 0), []);
  assert.equal(pick(items).length, 3);
});

test('同日同时间同标题：保持原来的顺序', () => {
  const items = [ev('x1', '2026-11-20', '开会'), ev('x2', '2026-11-20', '开会'), ev('x3', '2026-11-20', '开会')];
  assert.deepEqual(ids(items), ['x1', 'x2', 'x3']);
});

test('怎么说：距 X 还有 N 天；当天是 X 今天', () => {
  const r = pick([ev('a', '2027-02-06', '春节'), td('b', '2026-11-15', '交作业'), ev('c', '2026-11-16', '明天的事')]);
  assert.deepEqual(r.map((x) => [x.lead, x.title, x.tail, x.days, x.label]), [
    ['', '交作业', ' 今天', 0, '交作业 今天'],
    ['距 ', '明天的事', ' 还有 1 天', 1, '距 明天的事 还有 1 天'],
    ['距 ', '春节', ' 还有 83 天', 83, '距 春节 还有 83 天'],
  ]);
});

test('标题原样给出（界面负责截断，“还有 N 天”不能被截）；没写标题叫“未命名”', () => {
  const long = '一个非常非常非常非常非常非常长的考试名称加上更长的后缀';
  const r = pick([ev('a', '2026-12-01', long), ev('b', '2026-12-02', ''), ev('c', '2026-12-03', null), ev('d', '2026-12-04', '  ')], '2026-11-15', 10);
  assert.equal(r[0].title, long);
  assert.deepEqual(r.slice(1).map((x) => x.title), ['未命名', '未命名', '未命名']);
});

test('日期写坏了、条目是奇怪的值：跳过，不报错', () => {
  const items = [null, undefined, 5, { id: 'x', countdown: true }, ev('bad', 'tomorrow', '坏日期'), ev('ok', '2026-12-01', '好的')];
  assert.deepEqual(ids(items), ['ok']);
  assert.deepEqual(ids([ev('a', '2026-12-01', '考试')], 'bad today'), []);
});

test('每一条带着界面要用的字段', () => {
  const r = pick([ev('a', '2026-12-01', '考试', { remote: true })])[0];
  assert.deepEqual(Object.assign({}, r), { id: 'a', kind: 'event', title: '考试', date: '2026-12-01', days: 16, lead: '距 ', tail: ' 还有 16 天', label: '距 考试 还有 16 天' });
});
