// 本机日程 / 待办的重复：展开、单次改动、拆分、删除、迁移。纯函数部分；界面见 tests/ui/ui12.py。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Recur = require('../src/recur.js');
const Lunar = require('../src/lunar.js');
const Search = require('../src/search.js');
const Countdown = require('../src/countdown.js');

const ev = (id, date, more) => Object.assign({ id: id, kind: 'event', date: date, title: '课', start: '10:00', end: '11:40', place: '', notes: '', subs: [], remind: '10' }, more || {});
const td = (id, date, more) => Object.assign({ id: id, kind: 'todo', date: date, title: '倒垃圾', done: false, star: false, due: '', place: '', notes: '', subs: [] }, more || {});
const days = (items, from, to) => Recur.expand(items, from, to).map((o) => o.date).sort();
const clone = (x) => JSON.parse(JSON.stringify(x));
let n = 0;
const newId = () => 'new' + (n += 1);

test('没有重复规则的条目：不展开，不算重复', () => {
  const items = [ev('a', '2026-11-16'), td('b', '2026-11-16')];
  assert.equal(Recur.isRepeating(items[0]), false);
  assert.deepEqual(Recur.expand(items, '2026-11-01', '2026-12-31'), []);
});

test('每周一、三：只存一份，按天展开成虚拟场次', () => {
  const m = ev('w', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' });
  assert.equal(Recur.isRepeating(m), true);
  assert.deepEqual(days([m], '2026-11-01', '2026-11-15'), ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11']);
  const o = Recur.expand([m], '2026-11-09', '2026-11-09')[0];
  assert.equal(o.id, 'w@2026-11-09');
  assert.equal(o.masterId, 'w');
  assert.equal(o.occ, '2026-11-09');
  assert.equal(o.title, '课');
  assert.equal(o.start, '10:00');
  assert.ok(!('rrule' in o) || o.rrule === m.rrule);
  assert.ok(!o.overrides && !o.exdates && !o.doneDates, '场次上不带主条目的例外表');
  assert.equal(m.date, '2026-11-02', '展开不改主条目');
});

test('每天、次数、结束日期（含当天）', () => {
  assert.deepEqual(days([td('d', '2026-11-16', { rrule: 'FREQ=DAILY;COUNT=3' })], '2026-11-01', '2026-12-31'), ['2026-11-16', '2026-11-17', '2026-11-18']);
  assert.deepEqual(days([td('d', '2026-11-16', { rrule: 'FREQ=DAILY;UNTIL=20261119' })], '2026-11-01', '2026-12-31'), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
  assert.deepEqual(days([td('d', '2026-11-16', { rrule: 'FREQ=DAILY' })], '2026-11-10', '2026-11-17'), ['2026-11-16', '2026-11-17'], '开始之前没有');
});

test('每月 31 号跳过小月，每年 2 月 29 只在闰年（复用 ics.js 的规则）', () => {
  assert.deepEqual(days([ev('m', '2026-01-31', { rrule: 'FREQ=MONTHLY' })], '2026-01-01', '2026-07-31'), ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
  assert.deepEqual(days([ev('y', '2024-02-29', { rrule: 'FREQ=YEARLY' })], '2024-01-01', '2032-12-31'), ['2024-02-29', '2028-02-29', '2032-02-29']);
});

test('每年农历：生日按农历日期落到每年的公历', () => {
  // 2026-02-17 是正月初一；2027 年春节是 2-06，2030 年是 2-03
  const m = ev('b', '2026-02-17', { rrule: 'FREQ=YEARLY', lunar: true, allDay: true, title: '妈妈生日' });
  const got = days([m], '2026-01-01', '2030-12-31');
  assert.deepEqual(got.slice(0, 2), ['2026-02-17', '2027-02-06']);
  assert.equal(got[4], '2030-02-03');
  // 每一场换回农历都是正月初一
  got.forEach((k) => { const l = Lunar.solarToLunar(...k.split('-').map(Number)); assert.equal(l.month + '/' + l.day + '/' + l.leap, '1/1/false', k); });
  // 十月初八：每年都是十月初八
  const b2 = ev('b2', '2026-11-16', { rrule: 'FREQ=YEARLY', lunar: true });
  days([b2], '2026-01-01', '2036-12-31').forEach((k) => assert.equal(Lunar.solarToLunar(...k.split('-').map(Number)).text, '十月初八', k));
  // 三十：小月落到廿九
  const big = ev('b3', '2026-03-18', { rrule: 'FREQ=YEARLY', lunar: true });
  assert.equal(Lunar.solarToLunar(2026, 3, 18).day, 30);
  days([big], '2026-01-01', '2032-12-31').forEach((k) => { const l = Lunar.solarToLunar(...k.split('-').map(Number)); assert.equal(l.month, 1); assert.ok(l.day === 30 || (l.day === 29 && l.monthLen === 29), k); });
  // 次数也算数
  assert.equal(days([Object.assign({}, m, { rrule: 'FREQ=YEARLY;COUNT=2' })], '2026-01-01', '2035-12-31').length, 2);
  // 只有 YEARLY 才认农历
  assert.deepEqual(days([ev('x', '2026-11-16', { rrule: 'FREQ=MONTHLY;COUNT=2', lunar: true })], '2026-01-01', '2027-12-31'), ['2026-11-16', '2026-12-16']);
});

test('单次删除（exdates）和单次改动（overrides，含挪到别的日子）', () => {
  const m = ev('w', '2026-11-02', {
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    exdates: ['2026-11-09'],
    overrides: { '2026-11-16': { title: '调课', start: '14:00' }, '2026-11-23': { date: '2026-11-25' } },
  });
  const list = Recur.expand([m], '2026-11-01', '2026-11-30');
  assert.deepEqual(list.map((o) => o.date).sort(), ['2026-11-02', '2026-11-25', '2026-11-30']
    .concat(['2026-11-16']).sort());
  const moved = list.find((o) => o.occ === '2026-11-23');
  assert.equal(moved.date, '2026-11-25');
  assert.equal(moved.id, 'w@2026-11-23', 'id 跟着原来那一场走');
  const changed = list.find((o) => o.occ === '2026-11-16');
  assert.equal(changed.title, '调课');
  assert.equal(changed.start, '14:00');
  assert.equal(changed.end, '11:40', '没改的字段沿用主条目');
  // 从窗口外挪进来的也算
  assert.deepEqual(days([m], '2026-11-24', '2026-11-26'), ['2026-11-25']);
  // 挪出窗口的不算
  assert.deepEqual(days([m], '2026-11-23', '2026-11-23'), []);
});

test('按 id 取某一场；不存在的、被删掉的取不到', () => {
  const m = ev('w', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO', exdates: ['2026-11-09'] });
  const items = [m, ev('plain', '2026-11-03')];
  assert.equal(Recur.get(items, 'w@2026-11-16').date, '2026-11-16');
  assert.equal(Recur.get(items, 'w@2026-11-09'), null);
  assert.equal(Recur.get(items, 'w@2026-11-17'), null, '不是周一');
  assert.equal(Recur.get(items, 'w@2026-10-26'), null, '开始之前');
  assert.equal(Recur.get(items, 'plain'), null);
  assert.equal(Recur.get(items, 'nope@2026-11-16'), null);
});

test('重复待办：每一场单独记完成', () => {
  const items = [td('t', '2026-11-16', { rrule: 'FREQ=DAILY' })];
  let r = Recur.edit(items, 't@2026-11-17', { done: true }, 'one', newId);
  const list = Recur.expand(r.items, '2026-11-16', '2026-11-18');
  assert.deepEqual(list.map((o) => [o.date, o.done]), [['2026-11-16', false], ['2026-11-17', true], ['2026-11-18', false]]);
  assert.deepEqual(r.items[0].doneDates, { '2026-11-17': true });
  assert.equal(r.items[0].done, false, '主条目自己的完成状态不动');
  r = Recur.edit(r.items, 't@2026-11-17', { done: false }, 'all', newId);
  assert.ok(!r.items[0].doneDates || !r.items[0].doneDates['2026-11-17'], '完成状态和范围无关，总是只管这一场');
  assert.equal(r.items.length, 1);
});

test('改“仅此次”：只写进 overrides，和主条目一样的字段不留', () => {
  const items = [ev('w', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO' })];
  let r = Recur.edit(items, 'w@2026-11-09', { title: '期中' }, 'one', newId);
  assert.equal(r.sel, 'w@2026-11-09');
  assert.deepEqual(items[0].overrides, { '2026-11-09': { title: '期中' } });
  assert.equal(items[0].title, '课');
  r = Recur.edit(items, 'w@2026-11-09', { title: '课' }, 'one', newId);
  assert.ok(!items[0].overrides || !items[0].overrides['2026-11-09'], '改回去就清掉');
  r = Recur.edit(items, 'w@2026-11-09', { date: '2026-11-10' }, 'one', newId);
  assert.equal(Recur.get(items, 'w@2026-11-09').date, '2026-11-10');
  assert.deepEqual(days(items, '2026-11-09', '2026-11-10'), ['2026-11-10']);
});

test('改“全部”：写主条目；挪日期时整组一起挪（周几跟着变）', () => {
  const items = [ev('w', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130', exdates: ['2026-11-16'], overrides: { '2026-11-09': { title: '期中', place: 'A' } } })];
  let r = Recur.edit(items, 'w@2026-11-09', { place: 'B' }, 'all', newId);
  assert.equal(items[0].place, 'B');
  assert.deepEqual(items[0].overrides['2026-11-09'], { title: '期中' }, '这一场自己改过的同一字段让位给新值');
  assert.equal(r.sel, 'w@2026-11-09');
  r = Recur.edit(items, 'w@2026-11-09', { date: '2026-11-10' }, 'all', newId);
  assert.equal(items[0].date, '2026-11-03');
  assert.equal(items[0].rrule, 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20261201');
  assert.deepEqual(items[0].exdates, ['2026-11-17']);
  assert.deepEqual(Object.keys(items[0].overrides), ['2026-11-10']);
  assert.equal(r.sel, 'w@2026-11-10');
  assert.deepEqual(days(items, '2026-11-01', '2026-12-31'), ['2026-11-03', '2026-11-10', '2026-11-24', '2026-12-01']);
});

test('改“此次及以后”：原系列在前一天结束，新系列从这一场开始，例外表按日期分家', () => {
  const items = [ev('w', '2026-11-02', {
    rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
    exdates: ['2026-11-04', '2026-11-18'],
    overrides: { '2026-11-09': { title: '早的' }, '2026-11-23': { title: '晚的' } },
  })];
  const r = Recur.edit(items, 'w@2026-11-16', { start: '14:00', end: '15:40' }, 'future', () => 'w2');
  assert.equal(r.items.length, 2);
  const [a, b] = r.items;
  assert.equal(a.rrule, 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261115');
  assert.deepEqual(a.exdates, ['2026-11-04']);
  assert.deepEqual(Object.keys(a.overrides), ['2026-11-09']);
  assert.equal(a.start, '10:00');
  assert.equal(b.id, 'w2');
  assert.equal(b.date, '2026-11-16');
  assert.equal(b.rrule, 'FREQ=WEEKLY;BYDAY=MO,WE');
  assert.equal(b.start, '14:00');
  assert.deepEqual(b.exdates, ['2026-11-18']);
  assert.deepEqual(Object.keys(b.overrides), ['2026-11-23']);
  assert.equal(r.sel, 'w2@2026-11-16');
  const all = Recur.expand(r.items, '2026-11-01', '2026-11-30').sort((x, y) => (x.date < y.date ? -1 : 1));
  assert.deepEqual(all.map((o) => o.date + ' ' + o.start), ['2026-11-02 10:00', '2026-11-09 10:00', '2026-11-11 10:00', '2026-11-16 14:00', '2026-11-23 14:00', '2026-11-25 14:00', '2026-11-30 14:00']);
});

test('“此次及以后”遇到次数限制：两段次数加起来不变（被删的那几场也算次数）', () => {
  const items = [td('t', '2026-11-16', { rrule: 'FREQ=DAILY;COUNT=10', exdates: ['2026-11-17'] })];
  const r = Recur.edit(items, 't@2026-11-20', { title: '后半' }, 'future', () => 't2');
  assert.equal(r.items[0].rrule, 'FREQ=DAILY;COUNT=4');
  assert.equal(r.items[1].rrule, 'FREQ=DAILY;COUNT=6');
  assert.equal(days(r.items, '2026-11-01', '2026-12-31').length, 9);
});

test('从第一场选“此次及以后”就等于“全部”，不拆', () => {
  const items = [ev('w', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO', exdates: ['2026-11-02'] })];
  const r = Recur.edit(items, 'w@2026-11-09', { title: '新' }, 'future', newId);
  assert.equal(r.items.length, 1, '前面只剩被删掉的那一场，没有可留的');
  assert.equal(r.items[0].title, '新');
});

test('系列级的字段（类型、倒数日、重点）不分范围，直接写主条目', () => {
  const items = [td('t', '2026-11-16', { rrule: 'FREQ=DAILY' })];
  Recur.edit(items, 't@2026-11-18', { star: true, countdown: true }, 'one', newId);
  assert.equal(items[0].star, true);
  assert.equal(items[0].countdown, true);
  assert.ok(!items[0].overrides);
});

test('删除：仅此次 / 此次及以后 / 全部', () => {
  const base = () => [ev('w', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO', overrides: { '2026-11-16': { title: 'x' }, '2026-11-30': { title: 'y' } } }), ev('p', '2026-11-03')];
  let r = Recur.remove(base(), 'w@2026-11-16', 'one');
  assert.deepEqual(r.items[0].exdates, ['2026-11-16']);
  assert.deepEqual(Object.keys(r.items[0].overrides), ['2026-11-30']);
  assert.deepEqual(days(r.items, '2026-11-01', '2026-11-30'), ['2026-11-02', '2026-11-09', '2026-11-23', '2026-11-30']);
  r = Recur.remove(base(), 'w@2026-11-16', 'future');
  assert.equal(r.items[0].rrule, 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261115');
  assert.ok(!r.items[0].overrides);
  assert.deepEqual(days(r.items, '2026-11-01', '2027-12-31'), ['2026-11-02', '2026-11-09']);
  r = Recur.remove(base(), 'w@2026-11-02', 'future');
  assert.deepEqual(r.items.map((x) => x.id), ['p'], '从第一场删以后 = 全删');
  r = Recur.remove(base(), 'w@2026-11-23', 'all');
  assert.deepEqual(r.items.map((x) => x.id), ['p']);
  const fin = [td('t', '2026-11-16', { rrule: 'FREQ=DAILY;COUNT=2', exdates: ['2026-11-16'] })];
  assert.deepEqual(Recur.remove(fin, 't@2026-11-17', 'one').items, [], '有限的系列一场都不剩了，整个删掉');
});

test('下一场 / 离今天最近的一场', () => {
  const t = td('t', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO', doneDates: { '2026-11-16': true } });
  assert.equal(Recur.next(t, '2026-11-16', false).date, '2026-11-16');
  assert.equal(Recur.next(t, '2026-11-16', true).date, '2026-11-23', '今天这场做完了就看下一场');
  assert.equal(Recur.next(td('x', '2026-11-02', { rrule: 'FREQ=WEEKLY;COUNT=2' }), '2026-11-16', false), null);
  const yearly = ev('y', '2020-03-01', { rrule: 'FREQ=YEARLY' });
  assert.equal(Recur.next(yearly, '2026-11-16', false).date, '2027-03-01');
  assert.equal(Recur.nearest(yearly, '2026-11-16').date, '2027-03-01');
  assert.equal(Recur.nearest(yearly, '2026-04-01').date, '2026-03-01');
  assert.equal(Recur.nearest(td('o', '2020-01-06', { rrule: 'FREQ=WEEKLY;COUNT=2' }), '2026-11-16').date, '2020-01-13', '早就结束的系列：最后一场');
});

test('详情里的表单 ↔ 规则', () => {
  assert.deepEqual(Recur.toForm(ev('a', '2026-11-16')), { freq: '', byday: [], end: 'never', until: '', count: 0 });
  assert.deepEqual(Recur.toForm(ev('a', '2026-11-16', { rrule: 'FREQ=WEEKLY' })), { freq: 'WEEKLY', byday: [1], end: 'never', until: '', count: 0 });
  assert.deepEqual(Recur.toForm(ev('a', '2026-11-16', { rrule: 'FREQ=WEEKLY;BYDAY=WE,MO;COUNT=8' })), { freq: 'WEEKLY', byday: [1, 3], end: 'count', until: '', count: 8 });
  assert.deepEqual(Recur.toForm(ev('a', '2026-11-16', { rrule: 'FREQ=YEARLY;UNTIL=20300101', lunar: true })), { freq: 'LUNAR', byday: [], end: 'until', until: '2030-01-01', count: 0 });
  assert.deepEqual(Recur.fromForm({ freq: 'WEEKLY', byday: [3, 1], end: 'never' }, '2026-11-16'), { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', lunar: false });
  assert.deepEqual(Recur.fromForm({ freq: 'WEEKLY', byday: [], end: 'count', count: 5 }, '2026-11-16'), { rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=5', lunar: false });
  assert.deepEqual(Recur.fromForm({ freq: 'LUNAR', end: 'until', until: '2030-01-01' }, '2026-11-16'), { rrule: 'FREQ=YEARLY;UNTIL=20300101', lunar: true });
  assert.deepEqual(Recur.fromForm({ freq: 'DAILY', end: 'until', until: 'bad' }, '2026-11-16'), { rrule: 'FREQ=DAILY', lunar: false });
  assert.deepEqual(Recur.fromForm({ freq: '' }, '2026-11-16'), { rrule: '', lunar: false });
});

test('设重复 / 取消重复', () => {
  const items = [td('t', '2026-11-16', { done: true })];
  let r = Recur.setRule(items, 't', { freq: 'WEEKLY', byday: [1], end: 'never' });
  assert.equal(items[0].rrule, 'FREQ=WEEKLY;BYDAY=MO');
  assert.equal(r.sel, 't@2026-11-16');
  assert.deepEqual(items[0].doneDates, { '2026-11-16': true }, '原来的完成状态记到这一场');
  // 改成不包含开始那天的周几：选中跳到下一场
  r = Recur.setRule(items, 't@2026-11-16', { freq: 'WEEKLY', byday: [3], end: 'never' });
  assert.equal(r.sel, 't@2026-11-18');
  // 在某一场上取消重复：留下这一场
  Recur.edit(items, 't@2026-11-25', { title: '这周的' }, 'one', newId);
  r = Recur.setRule(items, 't@2026-11-25', { freq: '' });
  assert.equal(r.sel, 't');
  assert.equal(items[0].date, '2026-11-25');
  assert.equal(items[0].title, '这周的');
  ['rrule', 'lunar', 'exdates', 'overrides', 'doneDates'].forEach((k) => assert.ok(!(k in items[0]), k));
});

test('搜索：一个重复系列只列一条（离今天最近的一场）', () => {
  const m = ev('w', '2026-09-07', { rrule: 'FREQ=WEEKLY;BYDAY=MO', title: '经济学原理' });
  const list = Recur.expand([m], '2026-09-01', '2027-06-30').concat([ev('p', '2026-11-20', { title: '经济学讲座' })]);
  const r = Search.run({ items: list, note: '', query: '经济学', today: '2026-11-18' });
  assert.deepEqual(r.items.map((h) => h.id), ['w@2026-11-16', 'p']);
  assert.equal(r.total, 2);
  // 两个不同的本机系列不会被并成一条
  const m2 = ev('w2', '2026-09-08', { rrule: 'FREQ=WEEKLY;BYDAY=TU', title: '经济学习题课' });
  const r2 = Search.run({ items: list.concat(Recur.expand([m2], '2026-09-01', '2027-06-30')), note: '', query: '经济学', today: '2026-11-18' });
  assert.deepEqual(r2.items.map((h) => h.id).sort(), ['p', 'w2@2026-11-17', 'w@2026-11-16']);
});

test('倒数日：重复的指向下一次', () => {
  const b = ev('b', '2026-02-17', { rrule: 'FREQ=YEARLY', lunar: true, title: '生日', countdown: true });
  const nx = Recur.next(b, '2026-11-16', false);
  const c = Countdown.pick([nx], '2026-11-16');
  assert.equal(c[0].date, '2027-02-06');
  assert.equal(c[0].days, 82);
  assert.equal(c[0].id, 'b@2027-02-06');
});

test('迁移：0.7.0 的 data.json 原样读进来，一个字都不改', () => {
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'data-0.7.0.json'), 'utf8');
  const d = JSON.parse(raw);
  const before = clone(d.items);
  const out = Recur.normalize(d.items);
  assert.deepEqual(out, before);
  assert.equal(JSON.stringify(out), JSON.stringify(before), '连字段顺序都不变');
  assert.ok(out.every((it) => !Recur.isRepeating(it)));
});

test('迁移：写坏的重复字段丢掉，不影响别的', () => {
  const items = [
    ev('a', '2026-11-16', { rrule: 'FREQ=SECONDLY', exdates: ['2026-11-17'] }),
    ev('b', '2026-11-16', { rrule: 42 }),
    ev('c', '2026-11-16', { rrule: 'FREQ=WEEKLY', exdates: ['bad', '2026-11-23', 7], overrides: { '2026-11-30': { title: 'x' }, nope: { title: 'y' }, '2026-12-07': 'str' }, doneDates: { '2026-11-16': true, x: true }, lunar: 'yes' }),
    td('d', '2026-11-16', { exdates: ['2026-11-17'] }),
  ];
  Recur.normalize(items);
  ['rrule', 'exdates'].forEach((k) => { assert.ok(!(k in items[0]), 'a ' + k); assert.ok(!(k in items[1]), 'b ' + k); });
  assert.equal(items[0].title, '课');
  assert.deepEqual(items[2].exdates, ['2026-11-23']);
  assert.deepEqual(items[2].overrides, { '2026-11-30': { title: 'x' } });
  assert.deepEqual(items[2].doneDates, { '2026-11-16': true });
  assert.ok(!('lunar' in items[2]));
  assert.ok(!('exdates' in items[3]), '没有规则就没有例外');
});
