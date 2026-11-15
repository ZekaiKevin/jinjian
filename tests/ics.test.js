// iCalendar 的解析、重复规则展开、生成与修改。
// 时区相关的期望值按“本机时区是上海”写，运行时由 tests/run.js 设好 TZ。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ICS = require('../src/ics.js');

const wrap = (body) => 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\n' + body + '\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const cal = (...lines) => lines.join('\r\n');
const dates = (text, from, to) => ICS.expand(ICS.parse(text), from, to).map((o) => o.date);
const span = (text, from, to) => ICS.expand(ICS.parse(text), from, to).map((o) => o.date + ' ' + o.start);

const weekly = cal(
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iOS 18.0//EN', 'CALSCALE:GREGORIAN',
  'BEGIN:VTIMEZONE', 'TZID:Asia/Shanghai', 'BEGIN:STANDARD', 'DTSTART:19890917T020000', 'TZNAME:GMT+8', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0800', 'END:STANDARD', 'END:VTIMEZONE',
  'BEGIN:VEVENT', 'CREATED:20260901T010000Z', 'DTEND;TZID=Asia/Shanghai:20260908T193000', 'DTSTAMP:20260901T010000Z', 'DTSTART;TZID=Asia/Shanghai:20260908T180000',
  'EXDATE;TZID=Asia/Shanghai:20261006T180000',
  'LAST-MODIFIED:20260901T010000Z', 'LOCATION:明商208', 'RRULE:FREQ=WEEKLY;UNTIL=20270105T155959Z', 'SEQUENCE:1', 'SUMMARY:经济学原理', 'UID:AAA-111',
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT10M', 'UID:alarm1', 'END:VALARM',
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT30M', 'UID:alarm2', 'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT', 'DTEND;TZID=Asia/Shanghai:20261124T203000', 'DTSTART;TZID=Asia/Shanghai:20261124T190000', 'RECURRENCE-ID;TZID=Asia/Shanghai:20261124T180000', 'SUMMARY:经济学原理（调课）', 'UID:AAA-111', 'LOCATION:明商301', 'END:VEVENT',
  'END:VCALENDAR');

test('每周课表：例外日期、结束日期、单次调课', () => {
  const evs = ICS.parse(weekly);
  assert.equal(evs.length, 2);
  assert.equal(evs[0].title, '经济学原理');
  assert.equal(evs[0].alarm, 10);
  let occ = ICS.expand(evs, new Date(2026, 10, 1), new Date(2026, 11, 1));
  assert.deepEqual(occ.map((o) => o.date), ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']);
  assert.equal(occ[0].start, '18:00');
  assert.equal(occ[0].end, '19:30');
  assert.equal(occ[3].start, '19:00');
  assert.equal(occ[3].place, '明商301');
  occ = ICS.expand(evs, new Date(2026, 9, 1), new Date(2026, 9, 31)); // 10-06 被排除
  assert.deepEqual(occ.map((o) => o.date), ['2026-10-13', '2026-10-20', '2026-10-27']);
  occ = ICS.expand(evs, new Date(2026, 11, 20), new Date(2027, 1, 1)); // 到 2027-01-05 为止
  assert.deepEqual(occ.map((o) => o.date), ['2026-12-22', '2026-12-29', '2027-01-05']);
});

test('每两周的周一三五、UTC 时间、次数限制', () => {
  const t = cal('BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:B', 'DTSTART:20261102T020000Z', 'DTEND:20261102T033000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=5', 'SUMMARY:基础西班牙语3', 'END:VEVENT', 'END:VCALENDAR');
  const occ = ICS.expand(ICS.parse(t), new Date(2026, 9, 1), new Date(2027, 0, 1));
  assert.deepEqual(occ.map((o) => o.date), ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-16', '2026-11-18']);
  assert.equal(occ[0].start, '10:00');
});

test('全天事件每年重复', () => {
  const t = cal('BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:C', 'DTSTART;VALUE=DATE:20201122', 'DTEND;VALUE=DATE:20201123', 'RRULE:FREQ=YEARLY', 'SUMMARY:小雪', 'END:VEVENT', 'END:VCALENDAR');
  const occ = ICS.expand(ICS.parse(t), new Date(2026, 0, 1), new Date(2027, 0, 1));
  assert.deepEqual(occ.map((o) => [o.date, o.allDay, o.start]), [['2026-11-22', true, '']]);
});

test('每月 31 号跳过小月；每月第几个周几', () => {
  const m31 = cal('BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:D', 'DTSTART:20260131T010000Z', 'DURATION:PT1H', 'RRULE:FREQ=MONTHLY', 'SUMMARY:m', 'END:VEVENT', 'END:VCALENDAR');
  assert.deepEqual(dates(m31, new Date(2026, 0, 1), new Date(2026, 5, 30)), ['2026-01-31', '2026-03-31', '2026-05-31']);
  const second = cal('BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:O1', 'DTSTART:20261110T090000', 'DTEND:20261110T100000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3', 'SUMMARY:例会', 'END:VEVENT', 'END:VCALENDAR');
  assert.deepEqual(dates(second, new Date(2026, 10, 1), new Date(2027, 1, 28)), ['2026-11-10', '2026-12-08', '2027-01-12']);
  const lastFri = cal('BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:L', 'DTSTART;TZID=Asia/Shanghai:20261127T150000', 'DTEND;TZID=Asia/Shanghai:20261127T160000', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3', 'SUMMARY:月末复盘', 'END:VEVENT', 'END:VCALENDAR');
  assert.deepEqual(dates(lastFri, new Date(2026, 10, 1), new Date(2027, 2, 1)), ['2026-11-27', '2026-12-25', '2027-01-29']);
});

test('每月最后一天、倒数第二天、多个日子', () => {
  const body = (rule, day) => wrap('DTSTART:202601' + (day || '31') + 'T180000\r\nDTEND:202601' + (day || '31') + 'T190000\r\nSUMMARY:x\r\nRRULE:' + rule);
  const from = new Date(2026, 0, 1);
  const to = new Date(2026, 5, 1);
  assert.deepEqual(dates(body('FREQ=MONTHLY;BYMONTHDAY=-1'), from, to), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  assert.deepEqual(dates(body('FREQ=MONTHLY;BYMONTHDAY=-2;COUNT=2', '30'), from, to), ['2026-01-30', '2026-02-27']);
  assert.deepEqual(dates(body('FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=4', '31'), new Date(2026, 1, 1), new Date(2026, 5, 1)), ['2026-02-01', '2026-02-15', '2026-03-01', '2026-03-15']);
  // 31 号在没有 31 号的月份里跳过
  assert.deepEqual(dates(body('FREQ=MONTHLY;BYMONTHDAY=31'), from, to), ['2026-01-31', '2026-03-31', '2026-05-31']);
});

test('每年的第几个周几（感恩节）、每年指定月份', () => {
  const t = wrap('DTSTART:20201126T180000\r\nDTEND:20201126T190000\r\nSUMMARY:tg\r\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH');
  assert.deepEqual(dates(t, new Date(2026, 0, 1), new Date(2028, 11, 31)), ['2026-11-26', '2027-11-25', '2028-11-23']);
  const two = wrap('DTSTART:20260301T090000\r\nDTEND:20260301T100000\r\nSUMMARY:季\r\nRRULE:FREQ=YEARLY;BYMONTH=3,9;BYMONTHDAY=1');
  assert.deepEqual(dates(two, new Date(2026, 0, 1), new Date(2027, 11, 31)), ['2026-03-01', '2026-09-01', '2027-03-01', '2027-09-01']);
  // 2 月 29 号生日：只在闰年出现
  const leap = wrap('DTSTART;VALUE=DATE:20240229\r\nSUMMARY:b\r\nRRULE:FREQ=YEARLY');
  assert.deepEqual(dates(leap, new Date(2024, 0, 1), new Date(2029, 0, 1)), ['2024-02-29', '2028-02-29']);
});

test('每天里只限工作日', () => {
  const t = wrap('DTSTART:20261109T090000\r\nDTEND:20261109T093000\r\nSUMMARY:晨会\r\nRRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=7');
  assert.deepEqual(dates(t, new Date(2026, 10, 1), new Date(2026, 11, 1)), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17']);
});

test('其他时区换算到本机：纽约跨夏令时', () => {
  const t = cal('BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:E', 'DTSTART;TZID=America/New_York:20261030T090000', 'DTEND;TZID=America/New_York:20261030T100000', 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:ny', 'END:VEVENT', 'END:VCALENDAR');
  assert.deepEqual(span(t, new Date(2026, 9, 1), new Date(2026, 11, 1)), ['2026-10-30 21:00', '2026-11-06 22:00']);
});

test('时区名写在引号里、参数里带分号', () => {
  const t = wrap('DTSTART;TZID="Asia/Shanghai":20261116T090000\r\nDTEND;TZID="Asia/Shanghai":20261116T100000\r\nSUMMARY:q\r\nLOCATION;ALTREP="http://x.y/a:b;c":Room');
  const ev = ICS.parse(t)[0];
  assert.equal(ev.place, 'Room');
  assert.deepEqual(span(t, new Date(2026, 10, 1), new Date(2026, 11, 31)), ['2026-11-16 09:00']);
});

test('Windows 的时区名', () => {
  const t = (tz) => wrap('DTSTART;TZID=' + tz + ':20261116T090000\r\nDTEND;TZID=' + tz + ':20261116T100000\r\nSUMMARY:w');
  const r = [new Date(2026, 10, 1), new Date(2026, 11, 31)];
  assert.deepEqual(span(t('Pacific Standard Time'), ...r), ['2026-11-17 01:00']);
  assert.deepEqual(span(t('Eastern Standard Time'), ...r), ['2026-11-16 22:00']);
  assert.deepEqual(span(t('China Standard Time'), ...r), ['2026-11-16 09:00']);
});

test('日历文件自带的时区定义（没有夏令时的）兜底', () => {
  const t = cal('BEGIN:VCALENDAR',
    'BEGIN:VTIMEZONE', 'TZID:Custom Zone East', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0300', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', 'UID:Z', 'DTSTART;TZID=Custom Zone East:20261116T090000', 'DTEND;TZID=Custom Zone East:20261116T100000', 'SUMMARY:z', 'END:VEVENT', 'END:VCALENDAR');
  // 东三区 09:00 = 06:00 UTC = 上海 14:00
  assert.deepEqual(span(t, new Date(2026, 10, 1), new Date(2026, 11, 31)), ['2026-11-16 14:00']);
});

test('文字转义：反斜杠加 n 不是换行', () => {
  const t = wrap('DTSTART:20261116T090000\r\nDTEND:20261116T100000\r\nSUMMARY:C:\\\\new\\, a\r\nDESCRIPTION:第一行\\n第二行');
  const ev = ICS.parse(t)[0];
  assert.equal(ev.title, 'C:\\new, a');
  assert.equal(ev.notes, '第一行\n第二行');
});

test('只收到某一次改动、没有重复规则本体', () => {
  const t = cal('BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:ONLY', 'RECURRENCE-ID;TZID=Asia/Shanghai:20261120T100000', 'DTSTART;TZID=Asia/Shanghai:20261120T140000', 'DTEND;TZID=Asia/Shanghai:20261120T150000', 'SUMMARY:被邀请的那一场', 'END:VEVENT', 'END:VCALENDAR');
  assert.deepEqual(span(t, new Date(2026, 10, 1), new Date(2026, 11, 31)), ['2026-11-20 14:00']);
});

test('被取消的单次改动不显示；规则外的单次改动照样显示', () => {
  const master = ['BEGIN:VEVENT', 'UID:M', 'DTSTART:20261102T090000', 'DTEND:20261102T100000', 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:周会', 'END:VEVENT'];
  const cancelled = ['BEGIN:VEVENT', 'UID:M', 'RECURRENCE-ID:20261109T090000', 'DTSTART:20261109T090000', 'DTEND:20261109T100000', 'STATUS:CANCELLED', 'SUMMARY:周会', 'END:VEVENT'];
  assert.deepEqual(dates(cal('BEGIN:VCALENDAR', ...master, ...cancelled, 'END:VCALENDAR'), new Date(2026, 10, 1), new Date(2026, 11, 31)), ['2026-11-02']);
  // 第 5 周的这一场超出了 COUNT=2，但服务器上有它的单次改动
  const extra = ['BEGIN:VEVENT', 'UID:M', 'RECURRENCE-ID:20261130T090000', 'DTSTART:20261201T090000', 'DTEND:20261201T100000', 'SUMMARY:周会（补）', 'END:VEVENT'];
  assert.deepEqual(dates(cal('BEGIN:VCALENDAR', ...master, ...extra, 'END:VCALENDAR'), new Date(2026, 10, 1), new Date(2026, 11, 31)), ['2026-11-02', '2026-11-09', '2026-12-01']);
});

test('多天全天事件、跨午夜的定时事件', () => {
  const md = cal('BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:M1', 'DTSTART;VALUE=DATE:20261111', 'DTEND;VALUE=DATE:20261114', 'SUMMARY:三天出差', 'END:VEVENT', 'END:VCALENDAR');
  assert.deepEqual(dates(md, new Date(2026, 10, 1), new Date(2026, 10, 30)), ['2026-11-11', '2026-11-12', '2026-11-13']);
  const night = cal('BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:N', 'DTSTART;TZID=Asia/Shanghai:20261113T220000', 'DTEND;TZID=Asia/Shanghai:20261115T013000', 'SUMMARY:夜车', 'END:VEVENT', 'END:VCALENDAR');
  const occ = ICS.expand(ICS.parse(night), new Date(2026, 10, 1), new Date(2026, 11, 1));
  assert.deepEqual(occ.map((o) => [o.date, o.allDay, o.start, o.end, o.part, o.parts]), [['2026-11-13', false, '22:00', '23:59', 1, 3], ['2026-11-14', true, '', '', 2, 3], ['2026-11-15', false, '00:00', '01:30', 3, 3]]);
  assert.equal(new Set(occ.map((o) => o.key)).size, 3);
  const mid = cal('BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:Q', 'DTSTART;TZID=Asia/Shanghai:20261113T220000', 'DTEND;TZID=Asia/Shanghai:20261114T000000', 'SUMMARY:x', 'END:VEVENT', 'END:VCALENDAR');
  assert.equal(ICS.expand(ICS.parse(mid), new Date(2026, 10, 1), new Date(2026, 11, 1)).length, 1);
});

test('生成：转义、折行、提醒', () => {
  const made = ICS.build('uid-1', { title: '朋友聚餐; 火锅, 八点', date: '2026-11-13', start: '20:30', end: '22:00', place: '火锅店', notes: '第一行\n第二行' });
  const back = ICS.parse(made);
  assert.equal(back[0].title, '朋友聚餐; 火锅, 八点');
  assert.equal(back[0].notes, '第一行\n第二行');
  const occ = ICS.expand(back, new Date(2026, 10, 1), new Date(2026, 11, 1));
  assert.deepEqual([occ[0].date, occ[0].start, occ[0].end], ['2026-11-13', '20:30', '22:00']);
  const long = ICS.build('u', { title: '很长的标题'.repeat(20), date: '2026-11-13', start: '08:00', end: '09:00' });
  assert.ok(long.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
  assert.equal(ICS.parse(long)[0].title, '很长的标题'.repeat(20));
  const built = ICS.build('UID-1', { title: '产品评审', date: '2026-11-11', start: '14:00', end: '15:00', remind: '10' });
  assert.ok(built.includes('BEGIN:VALARM') && built.includes('TRIGGER:-PT10M'));
  assert.equal(ICS.parse(built)[0].alarm, 10);
  assert.equal(ICS.parse(ICS.build('z', { title: 'z', date: '2026-11-13', start: '10:00', remind: '0' }))[0].alarm, 0);
});

test('修改：保留没碰的字段，提醒只在传了的时候替换', () => {
  const single = cal('BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:F', 'DTSTART;TZID=Asia/Shanghai:20261114T100000', 'DTEND;TZID=Asia/Shanghai:20261114T103000', 'SUMMARY:取体检报告', 'SEQUENCE:2', 'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:x', 'TRIGGER:-PT30M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR');
  const patched = ICS.patch(single, { title: '取体检报告（改）', date: '2026-11-15', start: '11:00', end: '11:45', place: '社区医院', notes: '' });
  const back = ICS.parse(patched);
  const occ = ICS.expand(back, new Date(2026, 10, 1), new Date(2026, 11, 1));
  assert.deepEqual([back.length, back[0].uid, back[0].title, back[0].place, back[0].alarm], [1, 'F', '取体检报告（改）', '社区医院', 30]);
  assert.deepEqual([occ[0].date, occ[0].start, occ[0].end], ['2026-11-15', '11:00', '11:45']);
  assert.ok(/SEQUENCE:3/.test(patched) && /X-APPLE-TRAVEL/.test(patched) && /TRIGGER:-PT30M/.test(patched));
  // 原来有两条提醒，改标题不传提醒就都留着
  const two = cal('BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:T', 'DTSTART:20261113T020000Z', 'DTEND:20261113T030000Z', 'SUMMARY:a', 'BEGIN:VALARM', 'TRIGGER:-PT10M', 'END:VALARM', 'BEGIN:VALARM', 'TRIGGER:-PT30M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR');
  const keep = ICS.patch(two, { title: 'b', date: '2026-11-13', start: '10:00', end: '11:00' });
  assert.equal((keep.match(/BEGIN:VALARM/g) || []).length, 2);
  assert.equal(ICS.parse(keep)[0].title, 'b');
  // 传了提醒：整体替换；传 none：全部去掉
  const built = ICS.build('UID-1', { title: '产品评审', date: '2026-11-11', start: '14:00', end: '15:00', remind: '10' });
  const p25 = ICS.patch(built, { title: '产品评审', date: '2026-11-11', start: '14:00', end: '15:00', remind: '25' });
  assert.equal((p25.match(/BEGIN:VALARM/g) || []).length, 1);
  assert.equal(ICS.parse(p25)[0].alarm, 25);
  const none = ICS.patch(p25, { title: '产品评审', date: '2026-11-11', start: '14:00', end: '15:00', remind: 'none' });
  assert.ok(!none.includes('BEGIN:VALARM'));
  assert.equal(ICS.parse(none)[0].alarm, null);
});

test('提醒类型为 NONE 的不算提醒', () => {
  const t = wrap('DTSTART:20261116T090000\r\nDTEND:20261116T100000\r\nSUMMARY:a\r\nBEGIN:VALARM\r\nACTION:NONE\r\nTRIGGER;VALUE=DATE-TIME:19760401T005545Z\r\nEND:VALARM');
  assert.equal(ICS.parse(t)[0].alarm, null);
});
