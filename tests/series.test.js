// 0.9.0：iCloud 重复日程的“此次及以后”和整组改时间，以及 0.8.2 那个把系列删成无限重复的 bug。
// 验证方法和 recur-sync.test.js 一样：改过的文本再用 ics.js 自己的 parse / expand 读回来看场次。时区按上海（tests/run.js 设 TZ）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ICS = require('../src/ics.js');

const TZ = { id: 'Asia/Shanghai', offsetMin: 480 };
const cal = (lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0'].concat(lines, ['END:VCALENDAR']).join('\r\n') + '\r\n';
const weekly = (more, start) => cal(['BEGIN:VEVENT', 'UID:W1', 'DTSTART;TZID=Asia/Shanghai:' + (start || '20261102T180000'), 'DTEND;TZID=Asia/Shanghai:' + (start || '20261102T180000').slice(0, 9) + '194000',
  'SUMMARY:课', 'LOCATION:明商208'].concat(more, ['END:VEVENT']));
const show = (text, from, to) => ICS.expand(ICS.parse(text), new Date(from + 'T00:00:00'), new Date(to + 'T23:59:59'))
  .map((o) => o.date + ' ' + (o.allDay ? '全天' : o.start + '-' + o.end) + ' ' + o.title).sort();
const ridOf = (text, date) => ICS.expand(ICS.parse(text), new Date(date + 'T00:00:00'), new Date(date + 'T23:59:59'))[0].rid;
const dates = (text, from, to) => show(text, from, to).map((x) => x.slice(0, 10));

test('COUNT=0 是一场都没有，不是无限重复', () => {
  const text = weekly(['RRULE:FREQ=WEEKLY;COUNT=0']);
  assert.deepEqual(show(text, '2026-10-01', '2027-12-31'), []);
  assert.equal(ICS.parseRRule('FREQ=WEEKLY;COUNT=0').counted, true);
  assert.equal(ICS.parseRRule('FREQ=WEEKLY').counted, false);
  // 写了次数的照旧
  assert.equal(show(weekly(['RRULE:FREQ=WEEKLY;COUNT=3']), '2026-10-01', '2027-12-31').length, 3);
});

test('countBefore：这一场之前排了几场，不拿 DTSTART 比', () => {
  // 周三建的“每周一”：DTSTART 是 11-04（周三），第一场是 11-09
  const text = weekly(['RRULE:FREQ=WEEKLY;BYDAY=MO'], '20261104T180000');
  assert.deepEqual(dates(text, '2026-11-01', '2026-11-30'), ['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
  assert.deepEqual(ICS.countBefore(text, ridOf(text, '2026-11-09')), { all: 0, live: 0 });
  assert.deepEqual(ICS.countBefore(text, ridOf(text, '2026-11-23')), { all: 2, live: 2 });
  // 前面的都被删掉了：all 还算，live 是 0
  const ex = ICS.exclude(text, ridOf(text, '2026-11-09'));
  assert.deepEqual(ICS.countBefore(ex, ridOf(ex, '2026-11-16')), { all: 1, live: 0 });
});

test('endBefore：之前一场都没有时返回 null，不写 COUNT=0，也不写早于第一场的 UNTIL', () => {
  const byDay = weekly(['RRULE:FREQ=WEEKLY;BYDAY=MO'], '20261104T180000');
  assert.equal(ICS.endBefore(byDay, ridOf(byDay, '2026-11-09')), null);
  const counted = weekly(['RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5'], '20261104T180000');
  assert.equal(ICS.endBefore(counted, ridOf(counted, '2026-11-09')), null);
  // 之前有场次的照旧截断
  const cut = ICS.endBefore(counted, ridOf(counted, '2026-11-23'));
  assert.match(cut, /RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2/);
  assert.deepEqual(dates(cut, '2026-11-01', '2027-12-31'), ['2026-11-09', '2026-11-16']);
  const open = ICS.endBefore(byDay, ridOf(byDay, '2026-11-23'));
  assert.deepEqual(dates(open, '2026-11-01', '2027-12-31'), ['2026-11-09', '2026-11-16']);
});

test('include：把删掉的那一场放回来，一行写了几个的只拿掉这一个', () => {
  const text = weekly(['RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE;TZID=Asia/Shanghai:20261109T180000,20261116T180000']);
  assert.deepEqual(dates(text, '2026-11-01', '2026-12-31'), ['2026-11-02', '2026-11-23']);
  const back = ICS.include(text, { allDay: false, utc: false, tz: 'Asia/Shanghai', wall: { y: 2026, m: 11, d: 9, h: 18, mi: 0, s: 0 } });
  assert.deepEqual(dates(back, '2026-11-01', '2026-12-31'), ['2026-11-02', '2026-11-09', '2026-11-23']);
  const a = ICS.exclude(weekly(['RRULE:FREQ=WEEKLY;COUNT=4']), ridOf(text, '2026-11-23'));
  assert.deepEqual(dates(ICS.include(a, ridOf(text, '2026-11-23')), '2026-11-01', '2026-12-31'), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
});

test('shiftSeries：全部改时间，删掉的和单独改过的都跟着对上', () => {
  let text = weekly(['RRULE:FREQ=WEEKLY;COUNT=5']);
  text = ICS.exclude(text, ridOf(text, '2026-11-09'));                                   // 删一场
  text = ICS.setOccurrence(text, ridOf(text, '2026-11-16'), { title: '调课', date: '2026-11-17', start: '10:00', end: '11:00', place: '', notes: '' }); // 挪一场
  text = ICS.setOccurrence(text, ridOf(text, '2026-11-23'), { title: '课（期中）', date: '2026-11-23', start: '18:00', end: '19:40', place: '明商208', notes: '' }); // 只改标题的一场
  const from = { date: '2026-11-30', start: '18:00', end: '19:40', allDay: false };
  const out = ICS.shiftSeries(text, ridOf(text, '2026-11-30'), { date: '2026-11-30', start: '20:00', end: '21:00', allDay: false }, { from: from, tz: TZ });
  assert.deepEqual(show(out, '2026-11-01', '2026-12-31'), [
    '2026-11-02 20:00-21:00 课', '2026-11-17 10:00-11:00 调课', '2026-11-23 20:00-21:00 课（期中）', '2026-11-30 20:00-21:00 课',
  ]);
  assert.match(out, /DTSTART;TZID=Asia\/Shanghai:20261102T200000/);
  assert.match(out, /EXDATE;TZID=Asia\/Shanghai:20261109T200000/);
});

test('shiftSeries：整组挪一天，每周几跟着转；按“第几个周几”排的做不了', () => {
  const text = weekly(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261130T155959Z']);
  const from = { date: '2026-11-09', start: '18:00', end: '19:40', allDay: false };
  const out = ICS.shiftSeries(text, ridOf(text, '2026-11-09'), { date: '2026-11-10', start: '18:00', end: '19:40', allDay: false }, { from: from, tz: TZ });
  assert.deepEqual(dates(out, '2026-11-01', '2026-12-31'), ['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12', '2026-11-17', '2026-11-19', '2026-11-24', '2026-11-26', '2026-12-01']);
  assert.match(out, /BYDAY=TU,TH/);
  const nth = cal(['BEGIN:VEVENT', 'UID:N', 'DTSTART;TZID=Asia/Shanghai:20261110T180000', 'DTEND;TZID=Asia/Shanghai:20261110T190000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'SUMMARY:例会', 'END:VEVENT']);
  assert.equal(ICS.shiftSeries(nth, ridOf(nth, '2026-11-10'), { date: '2026-11-11', start: '18:00', end: '19:00', allDay: false }, { from: { date: '2026-11-10', start: '18:00', end: '19:00' }, tz: TZ }), null);
  // 只改时刻不挪天的可以
  assert.ok(ICS.shiftSeries(nth, ridOf(nth, '2026-11-10'), { date: '2026-11-10', start: '19:00', end: '20:00', allDay: false }, { from: { date: '2026-11-10', start: '18:00', end: '19:00' }, tz: TZ }));
});

test('shiftSeries：有时间 ↔ 全天', () => {
  const text = ICS.exclude(weekly(['RRULE:FREQ=WEEKLY;COUNT=4']), ridOf(weekly(['RRULE:FREQ=WEEKLY;COUNT=4']), '2026-11-09'));
  const from = { date: '2026-11-16', start: '18:00', end: '19:40', allDay: false };
  const all = ICS.shiftSeries(text, ridOf(text, '2026-11-16'), { date: '2026-11-16', start: '', end: '', allDay: true }, { from: from, tz: TZ });
  assert.deepEqual(show(all, '2026-11-01', '2026-12-31'), ['2026-11-02 全天 课', '2026-11-16 全天 课', '2026-11-23 全天 课']);
  assert.match(all, /DTSTART;VALUE=DATE:20261102/);
  assert.match(all, /EXDATE;VALUE=DATE:20261109/);
  const back = ICS.shiftSeries(all, ridOf(all, '2026-11-16'), { date: '2026-11-16', start: '09:00', end: '10:30', allDay: false }, { from: { date: '2026-11-16', start: '', end: '', allDay: true }, tz: TZ });
  assert.deepEqual(show(back, '2026-11-01', '2026-12-31'), ['2026-11-02 09:00-10:30 课', '2026-11-16 09:00-10:30 课', '2026-11-23 09:00-10:30 课']);
  assert.match(back, /BEGIN:VTIMEZONE/);
  // 不知道本机时区（有夏令时）时，全天改成有时间做不了
  assert.equal(ICS.shiftSeries(all, ridOf(all, '2026-11-16'), { date: '2026-11-16', start: '09:00', end: '10:30', allDay: false }, { from: { date: '2026-11-16', allDay: true }, tz: null }), null);
});

test('splitSeries：此次及以后改时间 / 改全天，原系列到前一场为止，新系列换 UID', () => {
  let text = weekly(['RRULE:FREQ=WEEKLY;COUNT=6', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT10M', 'END:VALARM']);
  text = ICS.exclude(text, ridOf(text, '2026-11-30'));
  text = ICS.setOccurrence(text, ridOf(text, '2026-11-09'), { title: '早的那次调课', date: '2026-11-09', start: '08:00', end: '09:00', place: '', notes: '' });
  const from = { date: '2026-11-16', start: '18:00', end: '19:40', allDay: false };
  const r = ICS.splitSeries(text, ridOf(text, '2026-11-16'), { date: '2026-11-17', start: '19:00', end: '20:30', allDay: false, title: '新课', place: '立德407', notes: '' }, { from: from, tz: TZ, uid: 'NEW-1' });
  assert.equal(r.whole, false);
  assert.deepEqual(show(r.head, '2026-11-01', '2027-01-31'), ['2026-11-02 18:00-19:40 课', '2026-11-09 08:00-09:00 早的那次调课']);
  assert.match(r.head, /COUNT=2/);
  // 6 场里前 2 场留在原系列；新系列 4 场，其中原来 11-30 那一场是删掉的（现在是 12-01）
  assert.deepEqual(show(r.tail, '2026-11-01', '2027-01-31'), ['2026-11-17 19:00-20:30 新课', '2026-11-24 19:00-20:30 新课', '2026-12-08 19:00-20:30 新课']);
  assert.match(r.tail, /UID:NEW-1/);
  assert.doesNotMatch(r.tail, /UID:W1/);
  assert.match(r.tail, /COUNT=4/);
  assert.match(r.tail, /BYDAY|FREQ=WEEKLY/);
  assert.match(r.tail, /TRIGGER:-PT10M/);
  assert.doesNotMatch(r.tail, /早的那次调课/);
  const p = ICS.parse(r.tail)[0];
  assert.deepEqual([p.title, p.place], ['新课', '立德407']);
  // 改成全天
  const a = ICS.splitSeries(text, ridOf(text, '2026-11-16'), { date: '2026-11-16', start: '', end: '', allDay: true, title: '课', place: '明商208', notes: '' }, { from: from, tz: TZ, uid: 'NEW-2' });
  assert.deepEqual(show(a.tail, '2026-11-01', '2027-01-31'), ['2026-11-16 全天 课', '2026-11-23 全天 课', '2026-12-07 全天 课']);
});

test('splitSeries：从第一场改“此次及以后”就是改全部；有结束日期的沿用到新系列', () => {
  const text = weekly(['RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261207T155959Z'], '20261104T180000');
  const from = { date: '2026-11-09', start: '18:00', end: '18:40', allDay: false };
  assert.deepEqual(ICS.splitSeries(text, ridOf(text, '2026-11-09'), { date: '2026-11-09', start: '19:00', end: '20:00', allDay: false }, { from: from, tz: TZ, uid: 'X' }), { whole: true, head: null, tail: null });
  const r = ICS.splitSeries(text, ridOf(text, '2026-11-23'), { date: '2026-11-23', start: '19:00', end: '20:00', allDay: false }, { from: { date: '2026-11-23', start: '18:00', end: '19:40' }, tz: TZ, uid: 'X' });
  assert.deepEqual(dates(r.head, '2026-11-01', '2027-01-31'), ['2026-11-09', '2026-11-16']);
  assert.deepEqual(show(r.tail, '2026-11-01', '2027-01-31'), ['2026-11-23 19:00-20:00 课', '2026-11-30 19:00-20:00 课', '2026-12-07 19:00-20:00 课']);
});

test('UTC 写的系列改时间：还是按 UTC 写，场次落在本机的新时刻', () => {
  const text = cal(['BEGIN:VEVENT', 'UID:U', 'DTSTART:20261102T100000Z', 'DTEND:20261102T110000Z', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:周会', 'END:VEVENT']);
  const out = ICS.shiftSeries(text, ridOf(text, '2026-11-09'), { date: '2026-11-09', start: '20:30', end: '21:00', allDay: false }, { from: { date: '2026-11-09', start: '18:00', end: '19:00' }, tz: TZ });
  assert.match(out, /DTSTART:20261102T123000Z/);
  assert.deepEqual(show(out, '2026-11-01', '2026-12-31'), ['2026-11-02 20:30-21:00 周会', '2026-11-09 20:30-21:00 周会', '2026-11-16 20:30-21:00 周会']);
});
