// 0.9.0：导出备份、导入备份 / .ics。重点是三件事：读得回来、重复导入不翻倍、iCloud 的东西不会被当成新日程。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ICS = require('../src/ics.js');
const Recur = require('../src/recur.js');
const Backup = require('../src/backup.js');

const TZ = { id: 'Asia/Shanghai', offsetMin: 480 };
const ev = (id, date, more) => Object.assign({ id: id, kind: 'event', date: date, title: '课', start: '18:00', end: '19:40', place: '明商208', notes: '', subs: [], remind: '10' }, more || {});
const td = (id, date, more) => Object.assign({ id: id, kind: 'todo', date: date, title: '交作业', done: false, star: false, due: '', place: '', notes: '', subs: [] }, more || {});
let n = 0;
const newId = (k) => (k === 'event' ? 'e' : k === 'todo' ? 't' : 's') + 'N' + (n += 1);
const REMOTE = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:ICLOUD-1', 'DTSTART;TZID=Asia/Shanghai:20261118T140000', 'DTEND;TZID=Asia/Shanghai:20261118T150000', 'SUMMARY:iCloud 上的会', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const state = () => ({
  items: [ev('e1', '2026-11-16'), ev('e2', '2026-11-02', { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261230', exdates: ['2026-11-09'], overrides: { '2026-11-11': { start: '20:00', end: '21:00', title: '调课' } } }),
    td('t1', '2026-11-17', { due: '17:30', star: true }), td('t2', '2026-11-18', { done: true }), ev('e3', '2026-11-20', { allDay: true, start: '', end: '', cal: 'https://p1/cal/home/' })],
  note: '买牛奶\n取快递', extras: { 'r|/cal/X.ics': { subs: [{ id: 's1', text: '带电脑', done: false }] } },
  settings: { theme: 'dark', sync: { on: true, user: 'me@icloud.com', cals: [], target: '' } },
  remote: { res: { '/cal/home/ICLOUD-1.ics': { etag: '"1"', ics: REMOTE, cal: '/cal/home/' } } },
});
const occ = (items, from, to) => Recur.expand(items, from, to).map((o) => o.date + ' ' + o.start + ' ' + o.title).sort();

test('JSON 备份：导出再读回来，条目、便签、附加内容都在，iCloud 镜像只数个数', () => {
  const text = Backup.exportJson(state(), { version: '0.9.0', now: new Date(2026, 10, 16, 12, 0) });
  const d = JSON.parse(text);
  assert.deepEqual([d.app, d.kind, d.appVersion], ['jinjian', 'backup', '0.9.0']);
  const r = Backup.read(text);
  assert.equal(r.ok, true);
  assert.deepEqual([r.kind, r.items.length, r.note, r.mirror], ['json', 5, '买牛奶\n取快递', 1]);
  assert.deepEqual(r.items, state().items);
  assert.ok(r.extras['r|/cal/X.ics']);
});

test('也认直接拿来的 data.json；不是今笺的文件说清楚', () => {
  const raw = JSON.stringify({ version: 2, items: [ev('e1', '2026-11-16'), { kind: 'weird' }, ev('bad', 'not-a-date')], note: 'x', remote: { res: { a: {}, b: {} } } });
  const r = Backup.read(raw);
  assert.deepEqual([r.ok, r.items.length, r.mirror], [true, 1, 2]);
  assert.equal(Backup.read('{"hello":1}').ok, false);
  assert.equal(Backup.read('{坏了').ok, false);
  assert.equal(Backup.read('随便一段字').ok, false);
  assert.equal(Backup.read('﻿' + raw).ok, true);
});

test('导入自己导出的备份：全是“已有”，一条都不新增（重复导入不翻倍）', () => {
  const s = state();
  const r = Backup.read(Backup.exportJson(s, {}));
  const p = Backup.plan(s.items, r.items, Backup.mirrorUids(s.remote.res));
  assert.deepEqual([p.add.length, p.dup.length, p.clash.length, p.mirror.length], [0, 5, 0, 0]);
  const out = Backup.apply(s.items, p, 'both', newId);
  assert.deepEqual([out.added, out.replaced, out.items.length], [0, 0, 5]);
});

test('导入到空的本机：全部新增，只存本机（不带 cal），id 不撞，子任务 id 换新', () => {
  const s = state();
  s.items[0].subs = [{ id: 'sub-old', text: '带书', done: true }];
  const r = Backup.read(Backup.exportJson(s, {}));
  const p = Backup.plan([], r.items, {});
  assert.equal(p.add.length, 5);
  const out = Backup.apply([], p, 'both', newId);
  assert.equal(out.added, 5);
  assert.ok(out.items.every((it) => !('cal' in it) && !it.uploading));
  assert.equal(new Set(out.items.map((it) => it.id)).size, 5);
  assert.deepEqual(out.items[0].subs.map((x) => [x.text, x.done]), [['带书', true]]);
  assert.notEqual(out.items[0].subs[0].id, 'sub-old');
  // 重复规则、删掉的、改过的都带过来了
  assert.deepEqual(occ(out.items, '2026-11-01', '2026-11-15'), occ(s.items, '2026-11-01', '2026-11-15'));
});

test('同一条但内容不同是冲突：两份都留（换新 id）/ 用导入的替换 / 跳过', () => {
  const cur = [ev('e1', '2026-11-16', { title: '本机改过的' }), td('t1', '2026-11-17')];
  const inc = [ev('e1', '2026-11-16', { title: '备份里的' }), td('t1', '2026-11-17'), ev('e9', '2026-11-19')];
  const p = Backup.plan(cur, inc, {});
  assert.deepEqual([p.add.length, p.dup.length, p.clash.length], [1, 1, 1]);
  assert.deepEqual([p.clash[0].inc.title, p.clash[0].cur.title], ['备份里的', '本机改过的']);
  const both = Backup.apply(cur, p, 'both', newId);
  assert.deepEqual(both.items.map((x) => x.title).sort(), ['交作业', '备份里的', '本机改过的', '课']);
  assert.equal(new Set(both.items.map((x) => x.id)).size, 4);
  const rep = Backup.apply(cur, p, 'replace', newId);
  assert.deepEqual([rep.replaced, rep.items.length, rep.items.find((x) => x.id === 'e1').title], [1, 3, '备份里的']);
  const skip = Backup.apply(cur, p, 'skip', newId);
  assert.deepEqual([skip.added, skip.items.find((x) => x.id === 'e1').title], [1, '本机改过的']);
  assert.equal(cur.length, 2); // 不改传进来的数组
});

test('.ics 导出：标准的 VCALENDAR，日程 / 重复 / 待办 / iCloud 镜像都在，读回来场次一样', () => {
  const s = state();
  const text = Backup.exportIcs(s.items, { tz: TZ, mirror: [REMOTE] });
  assert.match(text, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(text, /END:VCALENDAR\r\n$/);
  assert.equal((text.match(/BEGIN:VTIMEZONE/g) || []).length, 1);
  assert.equal((text.match(/BEGIN:VTODO/g) || []).length, 2);
  assert.match(text, /UID:ICLOUD-1/);
  assert.match(text, /RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261230T155959Z/);
  assert.match(text, /STATUS:COMPLETED/);
  text.split('\r\n').forEach((l) => assert.ok(Buffer.byteLength(l) <= 75, l));
  const got = ICS.expand(ICS.parse(text), new Date(2026, 10, 1), new Date(2026, 10, 30, 23, 59)).map((o) => o.date + ' ' + (o.allDay ? '全天' : o.start) + ' ' + o.title).sort();
  assert.deepEqual(got, ['2026-11-02 18:00 课', '2026-11-04 18:00 课', '2026-11-11 20:00 调课', '2026-11-16 18:00 课', '2026-11-16 18:00 课', '2026-11-18 14:00 iCloud 上的会', '2026-11-18 18:00 课',
    '2026-11-20 全天 课', '2026-11-23 18:00 课', '2026-11-25 18:00 课', '2026-11-30 18:00 课']);
});

test('.ics 导入：iCloud 里已有的（按 UID）跳过，其余只进本机；再导一次全是“已有”', () => {
  const s = state();
  const text = Backup.exportIcs(s.items, { tz: TZ, mirror: [REMOTE] });
  const r = Backup.read(text);
  assert.deepEqual([r.ok, r.kind, r.items.length], [true, 'ics', 6]);
  const uids = Backup.mirrorUids(s.remote.res);
  assert.deepEqual(uids, { 'ICLOUD-1': true });
  // 空的本机 + 连着 iCloud：镜像那一条不进来
  const p = Backup.plan([], r.items, uids);
  assert.deepEqual([p.add.length, p.mirror.length, p.mirror[0].title], [5, 1, 'iCloud 上的会']);
  const out = Backup.apply([], p, 'both', newId);
  assert.ok(out.items.every((it) => !('cal' in it)));
  const series = out.items.find((it) => it.rrule);
  assert.deepEqual([series.date, series.rrule, series.exdates, series.overrides], ['2026-11-02', 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261230', ['2026-11-09'], { '2026-11-11': { title: '调课', start: '20:00', end: '21:00' } }]);
  assert.deepEqual(occ(out.items, '2026-11-01', '2026-11-30'), occ(s.items, '2026-11-01', '2026-11-30'));
  const todo = out.items.find((it) => it.kind === 'todo' && it.due);
  assert.deepEqual([todo.title, todo.date, todo.due, todo.star, todo.done], ['交作业', '2026-11-17', '17:30', true, false]);
  assert.equal(out.items.find((it) => it.kind === 'todo' && !it.due).done, true);
  // 第二次导同一个文件
  const again = Backup.plan(out.items, Backup.read(text).items, uids);
  assert.deepEqual([again.add.length, again.clash.length, again.dup.length, again.mirror.length], [0, 0, 5, 1]);
});

test('.ics 导入：别的日历软件导出的（UTC、跨天、取消的、认不了的规则）', () => {
  const text = ['BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:A', 'DTSTART:20261116T060000Z', 'DTEND:20261116T070000Z', 'SUMMARY:周会', 'LOCATION:3 楼\\, 东侧', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT30M', 'END:VALARM', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:B', 'DTSTART;VALUE=DATE:20261120', 'DTEND;VALUE=DATE:20261123', 'SUMMARY:出差', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:C', 'DTSTART:20261121T140000Z', 'DTEND:20261121T180000Z', 'SUMMARY:跨午夜', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:D', 'DTSTART:20261122T010000Z', 'SUMMARY:取消了', 'STATUS:CANCELLED', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:E', 'DTSTART:20261123T010000Z', 'DTEND:20261123T020000Z', 'RRULE:FREQ=HOURLY;COUNT=3', 'SUMMARY:每小时', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:F', 'RECURRENCE-ID:20261124T010000Z', 'DTSTART:20261124T030000Z', 'DTEND:20261124T040000Z', 'SUMMARY:只收到一场', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const items = Backup.read(text).items;
  const by = (t) => items.find((x) => x.title === t);
  assert.deepEqual([by('周会').date, by('周会').start, by('周会').end, by('周会').place, by('周会').remind], ['2026-11-16', '14:00', '15:00', '3 楼, 东侧', '30']);
  assert.deepEqual([by('出差').date, by('出差').allDay], ['2026-11-20', true]);
  assert.deepEqual([by('跨午夜').date, by('跨午夜').start, by('跨午夜').end], ['2026-11-21', '22:00', '23:59']);
  assert.equal(by('取消了'), undefined);
  assert.deepEqual([by('每小时').rrule, by('每小时').start], [undefined, '09:00']);
  assert.deepEqual([by('只收到一场').date, by('只收到一场').start], ['2026-11-24', '11:00']);
});

test('便签：备份里现在没有的那几行接在后面，已有的不重复', () => {
  assert.equal(Backup.mergeNote('买牛奶\n取快递', '买牛奶\n交电费'), '买牛奶\n取快递\n交电费');
  assert.equal(Backup.mergeNote('买牛奶', '买牛奶'), '买牛奶');
  assert.equal(Backup.mergeNote('', '交电费'), '交电费');
  assert.equal(Backup.mergeNote('买牛奶\n', ''), '买牛奶\n');
});
