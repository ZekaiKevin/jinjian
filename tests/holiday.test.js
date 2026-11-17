// 0.9.0：重复日程“遇法定节假日自动跳过”。按休班表（内置 2025–2027，holidays.json 可覆盖）算出要跳过的那几场，
// 记在 holEx 里：本机展开时不显示，传到 iCloud 时写成 EXDATE。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ICS = require('../src/ics.js');
const Lunar = require('../src/lunar.js');
const Recur = require('../src/recur.js');

const TZ = { id: 'Asia/Shanghai', offsetMin: 480 };
const ev = (id, date, more) => Object.assign({ id: id, kind: 'event', date: date, title: '课', start: '18:00', end: '19:40', place: '', notes: '', subs: [], remind: '10' }, more || {});
const days = (m, from, to) => Recur.expand([m], from, to).map((o) => o.date);

test('offDays：休班表里放假的日子，排好序；holidays.json 里的并进来', () => {
  Lunar.setHolidays(null);
  const off = Lunar.offDays();
  assert.equal(off[0], '2025-01-01');
  assert.ok(off.indexOf('2026-10-01') >= 0 && off.indexOf('2026-10-07') >= 0);
  assert.ok(off.indexOf('2026-10-08') < 0 && off.indexOf('2026-10-10') < 0); // 10-10 是补班
  assert.deepEqual(off, off.slice().sort());
  Lunar.setHolidays({ off: ['2028-01-01'], work: ['2026-10-07'] });
  assert.ok(Lunar.offDays().indexOf('2028-01-01') >= 0 && Lunar.offDays().indexOf('2026-10-07') < 0);
  Lunar.setHolidays(null);
});

test('开了开关：国庆那一周的课不显示；关掉又回来', () => {
  const m = ev('a', '2026-09-21', { rrule: 'FREQ=WEEKLY;BYDAY=MO,TH' });
  assert.deepEqual(days(m, '2026-09-28', '2026-10-12'), ['2026-09-28', '2026-10-01', '2026-10-05', '2026-10-08', '2026-10-12']);
  m.skipHol = true;
  assert.equal(Recur.syncHol([m], Lunar.offDays()), true);
  assert.deepEqual(m.holEx.filter((k) => k >= '2026-09-28' && k <= '2026-10-12'), ['2026-10-01', '2026-10-05']);
  assert.deepEqual(days(m, '2026-09-28', '2026-10-12'), ['2026-09-28', '2026-10-08', '2026-10-12']);
  assert.equal(Recur.syncHol([m], Lunar.offDays()), false); // 没变不重算
  // 用户自己删的那几场和它分开记
  assert.equal(m.exdates, undefined);
  delete m.skipHol;
  assert.equal(Recur.syncHol([m], Lunar.offDays()), true);
  assert.equal(m.holEx, undefined);
  assert.deepEqual(days(m, '2026-09-28', '2026-10-12').length, 5);
});

test('改了规则、换了休班表：跳过的那几场跟着重算', () => {
  const m = ev('b', '2026-09-21', { rrule: 'FREQ=WEEKLY;BYDAY=MO', skipHol: true });
  Recur.syncHol([m], Lunar.offDays());
  assert.ok(m.holEx.indexOf('2026-10-05') >= 0);
  m.rrule = 'FREQ=WEEKLY;BYDAY=FR';
  assert.equal(Recur.syncHol([m], Lunar.offDays()), true);
  assert.ok(m.holEx.indexOf('2026-10-05') < 0 && m.holEx.indexOf('2026-10-02') >= 0);
  // holidays.json 把 10-02 改成上班
  Lunar.setHolidays({ work: ['2026-10-02'] });
  assert.equal(Recur.syncHol([m], Lunar.offDays()), true);
  assert.ok(m.holEx.indexOf('2026-10-02') < 0);
  Lunar.setHolidays(null);
});

test('整个系列一起开关（不问“仅此次”），拆出来的新系列也带着', () => {
  const items = [ev('c', '2026-09-21', { rrule: 'FREQ=WEEKLY;BYDAY=MO' })];
  Recur.edit(items, 'c@2026-09-28', { skipHol: true }, 'one', () => 'x');
  assert.equal(items[0].skipHol, true);
  assert.equal(items[0].overrides, undefined);
  Recur.syncHol(items, Lunar.offDays());
  Recur.edit(items, 'c@2026-10-12', { start: '19:00' }, 'future', () => 'c2');
  Recur.syncHol(items, Lunar.offDays());
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((m) => m.skipHol), [true, true]);
  assert.ok(items[0].holEx.indexOf('2026-10-05') >= 0);
  assert.ok(items[1].holEx.every((k) => k >= '2026-10-12'));
  Recur.edit(items, 'c@2026-09-28', { skipHol: false }, 'one', () => 'x');
  assert.deepEqual([items[0].skipHol, items[0].holEx], [undefined, undefined]);
});

test('传到 iCloud：跳过的写成 EXDATE，Apple 日历里也不显示', () => {
  const m = ev('d', '2026-09-21', { rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261019', skipHol: true, exdates: ['2026-09-28'] });
  Recur.syncHol([m], Lunar.offDays());
  const text = ICS.buildSeries('U-1', Recur.forUpload(m, TZ));
  assert.match(text, /EXDATE;TZID=Asia\/Shanghai:20260928T180000/);
  assert.match(text, /EXDATE;TZID=Asia\/Shanghai:20261005T180000/);
  const got = ICS.expand(ICS.parse(text), new Date(2026, 8, 1), new Date(2026, 10, 30)).map((o) => o.date);
  assert.deepEqual(got, ['2026-09-21', '2026-10-12', '2026-10-19']);
  assert.deepEqual(got, days(m, '2026-09-01', '2026-11-30'));
});

test('读数据：没开开关的不留 holEx；取消重复时一并清掉；旧数据一个字不动', () => {
  const items = Recur.normalize([
    ev('e', '2026-09-21', { rrule: 'FREQ=WEEKLY', skipHol: true, holEx: ['2026-10-05', '坏的', '2026-10-05'] }),
    ev('f', '2026-09-21', { rrule: 'FREQ=WEEKLY', holEx: ['2026-10-05'] }),
    ev('g', '2026-09-21', { skipHol: true }),
    ev('h', '2026-09-21'),
  ]);
  assert.deepEqual(items[0].holEx, ['2026-10-05']);
  assert.equal(items[1].holEx, undefined);
  assert.equal(items[2].skipHol, undefined);
  assert.deepEqual(items[3], ev('h', '2026-09-21'));
  Recur.setRule(items, 'e', { freq: '' });
  assert.deepEqual([items[0].rrule, items[0].skipHol, items[0].holEx], [undefined, undefined, undefined]);
});
