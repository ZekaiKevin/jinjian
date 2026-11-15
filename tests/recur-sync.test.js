// 重复日程和 iCloud：本机系列生成标准日历文本（RRULE / EXDATE / RECURRENCE-ID），iCloud 系列改一次、删一次、截断、改全部。
// 验证方法：生成或改过的文本再用 ics.js 自己的 parse / expand 读回来，场次要和预期一字不差。
// 时区按上海写，由 tests/run.js 设好 TZ。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ICS = require('../src/ics.js');
const Recur = require('../src/recur.js');

const TZ = { id: 'Asia/Shanghai', offsetMin: 480 };
const ev = (id, date, more) => Object.assign({ id: id, kind: 'event', date: date, title: '课', start: '18:00', end: '19:40', place: '明商208', notes: '', subs: [], remind: '10' }, more || {});
const show = (list) => list.map((o) => [o.date, o.allDay ? '全天' : o.start + '-' + o.end, o.title, o.place || '']).sort((a, b) => (a.join() < b.join() ? -1 : 1));
const local = (m, from, to) => show(Recur.expand([m], from, to));
const remote = (text, from, to) => show(ICS.expand(ICS.parse(text), new Date(from + 'T00:00:00'), new Date(to + 'T23:59:59')));
const upload = (m) => ICS.buildSeries('U-1', Recur.forUpload(m, TZ));

test('本机系列 → 日历文本：读回来和本机展开的一模一样', () => {
  const cases = [
    ev('a', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' }),
    ev('b', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221', start: '07:30', end: '08:10' }), // 早上 8 点前：UTC 里是前一天
    ev('c', '2026-01-31', { rrule: 'FREQ=MONTHLY;COUNT=6', start: '00:30', end: '01:00' }),
    ev('d', '2026-11-16', { rrule: 'FREQ=DAILY;COUNT=5' }),
    ev('e', '2026-02-17', { rrule: 'FREQ=YEARLY', allDay: true, start: '', end: '' }),
    ev('f', '2026-11-04', { rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=4' }), // 开始那天不是周一：第一场是 11-09
    ev('g', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130', allDay: true }),
  ];
  cases.forEach((m) => {
    const text = upload(m);
    assert.deepEqual(remote(text, '2025-12-01', '2028-12-31'), local(m, '2025-12-01', '2028-12-31'), m.id + '\n' + text);
  });
});

test('为什么开始时间带 TZID 而不写 UTC：早上 8 点前的每周一，UTC 里是周日，BYDAY 按 UTC 算就落到了周二', () => {
  const utc = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:x', 'DTSTART:20261101T233000Z', 'DTEND:20261102T001000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2', 'SUMMARY:a', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  assert.deepEqual(remote(utc, '2026-11-01', '2026-11-30').map((x) => x[0]), ['2026-11-03', '2026-11-10'], 'UTC 写法：周二');
  const ok = upload(ev('b', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=2', start: '07:30', end: '08:10' }));
  assert.deepEqual(remote(ok, '2026-11-01', '2026-11-30').map((x) => x[0]), ['2026-11-02', '2026-11-09'], 'TZID 写法：周一');
});

test('本机系列 → 日历文本：格式（时区、结束日期用 UTC、提醒）', () => {
  const text = upload(ev('a', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221', start: '07:30', end: '08:10' }));
  assert.match(text, /BEGIN:VTIMEZONE\r\nTZID:Asia\/Shanghai\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:\+0800\r\nTZOFFSETTO:\+0800\r\nEND:STANDARD\r\nEND:VTIMEZONE/);
  assert.match(text, /DTSTART;TZID=Asia\/Shanghai:20261102T073000\r\n/);
  assert.match(text, /DTEND;TZID=Asia\/Shanghai:20261102T081000\r\n/);
  assert.match(text, /RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221T155959Z\r\n/, '结束那天（上海）的 23:59:59 换成 UTC');
  assert.match(text, /TRIGGER:-PT10M/);
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 1);
  const allDay = upload(ev('b', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221', allDay: true }));
  assert.match(allDay, /DTSTART;VALUE=DATE:20261102\r\n/);
  assert.match(allDay, /RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221\r\n/, '全天的结束日期就写日期');
});

test('本机系列 → 日历文本：删掉的写 EXDATE，改过的写成带 RECURRENCE-ID 的单独一场', () => {
  const m = ev('a', '2026-11-02', {
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    exdates: ['2026-11-09'],
    overrides: { '2026-11-16': { title: '期中', start: '14:00', end: '16:00' }, '2026-11-23': { date: '2026-11-25', place: '明商301' } },
  });
  const text = upload(m);
  assert.match(text, /EXDATE;TZID=Asia\/Shanghai:20261109T180000\r\n/);
  assert.match(text, /RECURRENCE-ID;TZID=Asia\/Shanghai:20261116T180000\r\n/);
  assert.match(text, /RECURRENCE-ID;TZID=Asia\/Shanghai:20261123T180000\r\n/);
  assert.equal((text.match(/UID:U-1\r\n/g) || []).length, 3, '单独改的那几场和主条目同一个 UID');
  assert.deepEqual(remote(text, '2026-11-01', '2026-11-30'), local(m, '2026-11-01', '2026-11-30'));
  // 规则排不出的改动、被删掉那一场的改动：不写
  const odd = ev('b', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO', exdates: ['2026-11-09'], overrides: { '2026-11-09': { title: 'x' }, '2026-11-10': { title: 'y' } } });
  assert.equal((upload(odd).match(/RECURRENCE-ID/g) || []).length, 0);
});

test('不上传的：农历、待办、一场都没有的', () => {
  assert.equal(Recur.forUpload(ev('a', '2026-02-17', { rrule: 'FREQ=YEARLY', lunar: true }), TZ), null);
  assert.equal(Recur.forUpload({ id: 't', kind: 'todo', date: '2026-11-16', title: 'x', rrule: 'FREQ=DAILY' }, TZ), null);
  assert.equal(Recur.forUpload(ev('n', '2026-11-16'), TZ), null);
  assert.equal(Recur.forUpload(ev('z', '2026-11-16', { rrule: 'FREQ=DAILY;COUNT=1', exdates: ['2026-11-16'] }), TZ), null);
});

// ---------- iCloud 上已有的重复日程（Apple 日历写的样子） ----------

const apple = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iOS 18.0//EN', 'CALSCALE:GREGORIAN',
  'BEGIN:VTIMEZONE', 'TZID:Asia/Shanghai', 'BEGIN:STANDARD', 'DTSTART:19890917T020000', 'TZNAME:GMT+8', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0800', 'END:STANDARD', 'END:VTIMEZONE',
  'BEGIN:VEVENT', 'CREATED:20260901T010000Z', 'DTEND;TZID=Asia/Shanghai:20260907T193000', 'DTSTAMP:20260901T010000Z', 'DTSTART;TZID=Asia/Shanghai:20260907T180000',
  'EXDATE;TZID=Asia/Shanghai:20261005T180000',
  'LAST-MODIFIED:20260901T010000Z', 'LOCATION:明商208', 'RRULE:FREQ=WEEKLY;UNTIL=20270104T155959Z', 'SEQUENCE:1', 'SUMMARY:经济学原理', 'UID:AAA-111', 'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC',
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT10M', 'UID:alarm1', 'END:VALARM',
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT30M', 'UID:alarm2', 'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT', 'DTEND;TZID=Asia/Shanghai:20261123T203000', 'DTSTART;TZID=Asia/Shanghai:20261123T190000', 'RECURRENCE-ID;TZID=Asia/Shanghai:20261123T180000', 'SUMMARY:经济学原理', 'UID:AAA-111', 'LOCATION:明商301', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTEND;TZID=Asia/Shanghai:20261207T193000', 'DTSTART;TZID=Asia/Shanghai:20261207T180000', 'RECURRENCE-ID;TZID=Asia/Shanghai:20261207T180000', 'SUMMARY:经济学（习题课）', 'UID:AAA-111', 'LOCATION:明商208', 'END:VEVENT',
  'END:VCALENDAR'].join('\r\n') + '\r\n';
const occOf = (text, date) => ICS.expand(ICS.parse(text), new Date(date + 'T00:00:00'), new Date(date + 'T23:59:59'))[0];
const nov = (text) => remote(text, '2026-11-01', '2026-12-31');

test('展开出来的每一场带着原来的时间（RECURRENCE-ID 用），改过时间的也是', () => {
  const o = occOf(apple, '2026-11-16');
  assert.equal(o.ridKey, '202611161800');
  assert.equal(ICS.toDate(o.rid).getTime(), new Date('2026-11-16T18:00:00').getTime());
  const moved = occOf(apple, '2026-11-23');
  assert.equal(moved.start, '19:00');
  assert.equal(moved.ridKey, '202611231800', '按原来那一场记，不按改后的时间');
  assert.equal(moved.key, '202611231900');
});

test('仅此次：没改过的那一场新加一个 RECURRENCE-ID，别的场次一个字不动', () => {
  const o = occOf(apple, '2026-11-16');
  const text = ICS.setOccurrence(apple, o.rid, { title: '经济学原理', date: '2026-11-17', start: '14:00', end: '15:30', allDay: false, place: '明商101', notes: '' });
  assert.match(text, /RECURRENCE-ID;TZID=Asia\/Shanghai:20261116T180000\r\n/);
  const before = nov(apple).filter((x) => x[0] !== '2026-11-16');
  const after = nov(text);
  assert.deepEqual(after.filter((x) => x[0] !== '2026-11-17'), before);
  assert.deepEqual(after.filter((x) => x[0] === '2026-11-17'), [['2026-11-17', '14:00-15:30', '经济学原理', '明商101']]);
  assert.equal((text.match(/TRIGGER:-PT30M/g) || []).length, 2, '新的这一场照抄主条目的两条提醒');
  assert.ok(text.indexOf('X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC') > 0, '主条目原样保留');
  // 再改同一场：改那一块，不再多出一块
  const again = ICS.setOccurrence(text, o.rid, { title: '经济学原理（换教室）', date: '2026-11-17', start: '14:00', end: '15:30', allDay: false, place: '明商102', notes: '' });
  assert.equal((again.match(/RECURRENCE-ID/g) || []).length, 3);
  assert.deepEqual(nov(again).filter((x) => x[0] === '2026-11-17'), [['2026-11-17', '14:00-15:30', '经济学原理（换教室）', '明商102']]);
});

test('仅此次：已经改过的那一场（Apple 写的）就地改', () => {
  const o = occOf(apple, '2026-11-23');
  const text = ICS.setOccurrence(apple, o.rid, { title: '经济学原理', date: '2026-11-23', start: '19:00', end: '20:30', allDay: false, place: '明商401', notes: '' });
  assert.equal((text.match(/RECURRENCE-ID/g) || []).length, 2);
  assert.deepEqual(nov(text).filter((x) => x[0] === '2026-11-23'), [['2026-11-23', '19:00-20:30', '经济学原理', '明商401']]);
  assert.deepEqual(nov(text).filter((x) => x[0] !== '2026-11-23'), nov(apple).filter((x) => x[0] !== '2026-11-23'));
});

test('删仅此次：主条目加 EXDATE（格式和开始时间一样），这一场的单独改动一起删掉', () => {
  const t1 = ICS.exclude(apple, occOf(apple, '2026-11-16').rid);
  assert.match(t1, /EXDATE;TZID=Asia\/Shanghai:20261116T180000\r\n/);
  assert.deepEqual(nov(t1), nov(apple).filter((x) => x[0] !== '2026-11-16'));
  const t2 = ICS.exclude(apple, occOf(apple, '2026-11-23').rid);
  assert.equal((t2.match(/RECURRENCE-ID/g) || []).length, 1);
  assert.deepEqual(nov(t2), nov(apple).filter((x) => x[0] !== '2026-11-23'));
  assert.ok(t2.indexOf('EXDATE;TZID=Asia/Shanghai:20261005T180000') > 0, '原来的 EXDATE 还在');
});

test('删此次及以后：规则在前一刻结束，之后的单独改动删掉', () => {
  const text = ICS.endBefore(apple, occOf(apple, '2026-11-23').rid);
  assert.match(text, /RRULE:FREQ=WEEKLY;UNTIL=20261123T095959Z\r\n/);
  assert.equal((text.match(/RECURRENCE-ID/g) || []).length, 0);
  assert.deepEqual(nov(text), nov(apple).filter((x) => x[0] < '2026-11-23'));
  // 有次数限制的：改成前面的次数（被删的那几场也算）
  const counted = apple.replace('RRULE:FREQ=WEEKLY;UNTIL=20270104T155959Z', 'RRULE:FREQ=WEEKLY;COUNT=12');
  const t2 = ICS.endBefore(counted, occOf(counted, '2026-11-16').rid);
  assert.match(t2, /RRULE:FREQ=WEEKLY;COUNT=10\r\n/);
  assert.deepEqual(remote(t2, '2026-09-01', '2027-12-31'), remote(counted, '2026-09-01', '2027-12-31').filter((x) => x[0] < '2026-11-16'));
  // 全天的：结束日期写日期
  const day = ICS.build('D', { title: 'x', date: '2026-11-02', allDay: true }).replace('END:VEVENT', 'RRULE:FREQ=WEEKLY\r\nEND:VEVENT');
  assert.match(ICS.endBefore(day, occOf(day, '2026-11-16').rid), /RRULE:FREQ=WEEKLY;UNTIL=20261115\r\n/);
});

test('改全部（标题、地点、备注、提醒）：不碰时间、规则、例外；单独改过的场次里和原来一样的也跟着改', () => {
  const text = ICS.patchSeries(apple, { title: '经济学', place: '明商208', notes: '带计算器' }, { title: '经济学原理', place: '明商208', notes: '' });
  const list = nov(text);
  assert.deepEqual(list.map((x) => [x[0], x[1]]), nov(apple).map((x) => [x[0], x[1]]), '时间一样');
  assert.equal(list.find((x) => x[0] === '2026-11-16')[2], '经济学');
  assert.equal(list.find((x) => x[0] === '2026-11-23')[2], '经济学', 'Apple 那一场的标题原来和主条目一样：跟着改');
  assert.equal(list.find((x) => x[0] === '2026-11-23')[3], '明商301', '它自己改过的地点不动');
  assert.equal(list.find((x) => x[0] === '2026-12-07')[2], '经济学（习题课）', '自己改过标题的不动');
  assert.ok(text.indexOf('DTSTART;TZID=Asia/Shanghai:20260907T180000') > 0 && text.indexOf('RRULE:FREQ=WEEKLY;UNTIL=20270104T155959Z') > 0 && text.indexOf('EXDATE;TZID=Asia/Shanghai:20261005T180000') > 0);
  assert.equal((text.match(/TRIGGER:-PT30M/g) || []).length, 1, '没改提醒：原来两条都在');
  assert.equal(ICS.parse(text)[0].notes, '带计算器');
  const r2 = ICS.patchSeries(apple, { title: '经济学原理', place: '明商208', notes: '', remind: '5' }, { title: '经济学原理', place: '明商208', notes: '' });
  assert.equal(ICS.parse(r2)[0].alarm, 5);
  assert.equal((r2.match(/TRIGGER:/g) || []).length, 1);
});

test('不重复的日程：patch 的老行为不变（改第一个 VEVENT）', () => {
  const one = ICS.build('X', { title: 'a', date: '2026-11-16', start: '10:00', end: '11:00', remind: '10' });
  const p = ICS.patch(one, { title: 'b', date: '2026-11-17', start: '09:00', end: '10:00' });
  assert.deepEqual(remote(p, '2026-11-01', '2026-11-30'), [['2026-11-17', '09:00-10:00', 'b', '']]);
  // 有单独改动块排在前面时，改的是主条目
  const swapped = apple.replace(/(BEGIN:VEVENT[\s\S]*?END:VEVENT\r\n)(BEGIN:VEVENT[\s\S]*?END:VEVENT\r\n)/, '$2$1');
  assert.ok(swapped.indexOf('RECURRENCE-ID') < swapped.indexOf('RRULE'));
  const t = ICS.patchSeries(swapped, { title: '新', place: '明商208', notes: '' }, { title: '经济学原理', place: '明商208', notes: '' });
  assert.equal(nov(t).find((x) => x[0] === '2026-11-16')[2], '新');
});
