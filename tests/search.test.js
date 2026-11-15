// Ctrl+F 搜索：纯函数部分（切词、匹配、排序、片段、高亮）。界面部分见 tests/ui/ui10.py。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Search = require('../src/search.js');

const ev = (id, date, title, more) => Object.assign({ id: id, kind: 'event', date: date, start: '10:00', end: '11:00', title: title, place: '', notes: '', subs: [] }, more || {});
const td = (id, date, title, more) => Object.assign({ id: id, kind: 'todo', date: date, title: title, done: false, due: '', place: '', notes: '', subs: [] }, more || {});
const ids = (r) => r.items.map((x) => x.id);
const run = (items, query, more) => Search.run(Object.assign({ items: items, note: '', query: query, today: '2026-11-15' }, more || {}));

test('切词：空白（含全角空格）分开，去重，全部折叠成小写、半角', () => {
  assert.deepEqual(Search.tokens('  西语   作业 '), ['西语', '作业']);
  assert.deepEqual(Search.tokens('西语　作业'), ['西语', '作业']);
  assert.deepEqual(Search.tokens('Ａｐｐ app APP'), ['app']);
  assert.deepEqual(Search.tokens(''), []);
  assert.deepEqual(Search.tokens('   　 '), []);
  assert.deepEqual(Search.tokens(null), []);
  assert.equal(Search.tokens('a b c d e f g h i j k l').length, 8, '最多 8 个词，免得每个字都要比一遍');
});

test('折叠不改变长度（高亮要靠下标）', () => {
  for (const s of ['İstanbul', 'ＡＢＣ１２３', '㈱ABC', '𠮷野家 abc', '西语 Spanish']) {
    assert.equal(Search.fold(s).length, s.length, s);
  }
  assert.equal(Search.fold('ＡＢＣ１２３'), 'abc123');
});

test('空查询：什么都不返回，包括便签', () => {
  const r = run([ev('a', '2026-11-15', '开会')], '', { note: '开会纪要' });
  assert.deepEqual(r.items, []);
  assert.equal(r.note, null);
  assert.equal(r.total, 0);
  assert.deepEqual(run([ev('a', '2026-11-15', '开会')], '   ').items, []);
});

test('匹配标题、地点、备注、子任务；不区分大小写、全角半角', () => {
  const items = [
    ev('t', '2026-11-15', '周会 Sprint'),
    ev('p', '2026-11-16', '面试', { place: '明商208' }),
    ev('n', '2026-11-17', '体检', { notes: '空腹，带身份证' }),
    td('s', '2026-11-18', '搬家', { subs: [{ id: 'x', text: '预约货拉拉', done: false }] }),
    td('z', '2026-11-19', '无关'),
  ];
  assert.deepEqual(ids(run(items, 'sprint')), ['t']);
  assert.deepEqual(ids(run(items, 'ＳＰＲＩＮＴ')), ['t']);
  assert.deepEqual(ids(run(items, '明商')), ['p']);
  assert.deepEqual(ids(run(items, '身份证')), ['n']);
  assert.deepEqual(ids(run(items, '货拉拉')), ['s']);
  assert.deepEqual(ids(run(items, '不存在的词')), []);
});

test('日历名、日期、截止时间不参与匹配', () => {
  const items = [ev('a', '2026-11-15', '开会', { calName: '个人', color: '#fff' }), td('b', '2026-11-15', '写周报', { due: '15:00' })];
  assert.deepEqual(ids(run(items, '个人')), []);
  assert.deepEqual(ids(run(items, '15:00')), []);
  assert.deepEqual(ids(run(items, '2026')), []);
});

test('多个词是“且”：可以分散在标题和备注里', () => {
  const items = [
    ev('a', '2026-11-15', '西语作业', { notes: '第三课' }),
    ev('b', '2026-11-16', '西语考试'),
    ev('c', '2026-11-17', '数学作业', { notes: '第三课' }),
  ];
  assert.deepEqual(ids(run(items, '西语 作业')), ['a']);
  assert.deepEqual(ids(run(items, '西语 第三课')), ['a']);
  assert.deepEqual(ids(run(items, '作业 第三课')).sort(), ['a', 'c']);
  assert.deepEqual(ids(run(items, '西语 不存在')), []);
});

test('排序：标题命中在前，其次离今天近，再按日期时间', () => {
  const items = [
    ev('far', '2026-01-05', '复习'),
    ev('note', '2026-11-14', '开会', { notes: '要复习' }),     // 只在备注里命中，离今天最近
    ev('near', '2026-11-20', '复习'),
    ev('past', '2026-11-10', '复习'),                          // 距今 5 天
    ev('same', '2026-11-20', '复习', { start: '08:00' }),      // 和 near 同一天，更早
    ev('adv', '2026-11-10', '复习', { start: '09:00' }),       // 和 past 同一天（同距离），past 10:00 在后
  ];
  assert.deepEqual(ids(run(items, '复习')), ['adv', 'past', 'same', 'near', 'far', 'note']);
});

test('完成的待办也搜得到，带上完成状态', () => {
  const r = run([td('d', '2025-03-02', '交报税材料', { done: true })], '报税');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].done, true);
  assert.equal(r.items[0].kind, 'todo');
});

test('片段：标题命中时没有；别的字段命中时给出带字段名的一小段', () => {
  const long = '前面是一大段没有关系的文字用来把命中的词挤到很靠后的位置，然后才出现关键词货拉拉，后面还有一大段同样没有关系的文字';
  const r = run([ev('a', '2026-11-15', '搬家'), ev('b', '2026-11-16', '体检', { notes: long })], '货拉拉 搬家');
  assert.deepEqual(ids(r), [], '两个词要都命中，这里 b 的标题没有“搬家”');
  const r2 = run([ev('a', '2026-11-15', '搬家', { notes: '约了货拉拉' }), ev('b', '2026-11-16', '体检', { notes: long })], '货拉拉');
  const a = r2.items.find((x) => x.id === 'a');
  const b = r2.items.find((x) => x.id === 'b');
  assert.equal(a.field, 'notes');
  assert.equal(a.snippet, '约了货拉拉');
  assert.equal(b.field, 'notes');
  assert.ok(b.snippet.includes('货拉拉') && b.snippet.startsWith('…') && b.snippet.length <= 34, b.snippet);
  const r3 = run([ev('t', '2026-11-15', '货拉拉', { notes: '货拉拉备注' })], '货拉拉');
  assert.equal(r3.items[0].field, '');
  assert.equal(r3.items[0].snippet, '');
  const r4 = run([ev('p', '2026-11-15', '面试', { place: '明商208' })], '明商');
  assert.equal(r4.items[0].field, 'place');
  const r5 = run([td('s', '2026-11-15', '搬家', { subs: [{ id: 'q', text: '打包书', done: true }] })], '打包');
  assert.equal(r5.items[0].field, 'subs');
  assert.equal(r5.items[0].snippet, '打包书');
});

test('片段是单行：换行压成空格', () => {
  const r = run([ev('a', '2026-11-15', '会', { notes: '第一行\n第二行有关键词\n第三行' })], '关键词');
  assert.equal(r.items[0].snippet, '第一行 第二行有关键词 第三行');
});

test('iCloud 的重复课、跨天日程只留离今天最近的一场', () => {
  const cls = (id, date) => ev(id, date, '基础西班牙语3', { remote: true, recurring: true, href: '/cal/AAA.ics' });
  const items = [cls('r|AAA|1', '2026-09-08'), cls('r|AAA|2', '2026-11-10'), cls('r|AAA|3', '2026-11-17'), cls('r|AAA|4', '2026-12-01'),
    ev('r|BBB|1', '2026-11-16', '基础西班牙语（补课）', { remote: true, recurring: false, href: '/cal/BBB.ics' }),
    ev('loc', '2026-05-01', '基础西班牙语笔记')];
  const r = run(items, '西班牙语');
  assert.deepEqual(ids(r), ['r|BBB|1', 'r|AAA|3', 'loc']); // 距今 1 天、2 天、198 天
  assert.equal(r.total, 3);
  // 跨天日程（parts）也是同一件事的几天
  const multi = [1, 2, 3].map((i) => ev('r|M|' + i, '2026-11-1' + (3 + i), '出差', { remote: true, parts: 3, href: '/cal/M.ics' }));
  assert.equal(run(multi, '出差').items.length, 1);
});

test('最多返回 100 条，total 是总数', () => {
  const items = [];
  for (let i = 0; i < 130; i++) items.push(td('t' + i, '2026-11-' + String(1 + (i % 28)).padStart(2, '0'), '买菜' + i));
  const r = run(items, '买菜');
  assert.equal(r.items.length, 100);
  assert.equal(r.total, 130);
  assert.equal(run(items, '买菜', { limit: 5 }).items.length, 5);
});

test('便签：词都在便签里才算命中，给出位置和那一行的片段', () => {
  const note = '牙医电话在冰箱贴上。\n房东微信：zhang_2026\n周五前把报销单交给财务';
  const r = run([], '房东 微信', { note: note });
  assert.ok(r.note);
  assert.equal(r.note.pos, note.indexOf('房东'));
  assert.equal(r.note.len, 2);
  assert.equal(r.note.snippet, '房东微信：zhang_2026');
  assert.equal(run([], '房东 报销', { note: note }).note.snippet, '房东微信：zhang_2026', '词在不同行也算，片段取第一个词所在的行');
  assert.equal(run([], '房东 不存在', { note: note }).note, null);
  assert.equal(run([], 'ZHANG', { note: note }).note.pos, note.indexOf('zhang'));
  assert.equal(run([], '房东', { note: '' }).note, null);
  assert.equal(run([], '房东', {}).note, null);
});

test('高亮：切成命中和没命中的段，合并重叠，不区分大小写', () => {
  const seg = (text, q) => Search.segments(text, Search.tokens(q)).map((s) => (s.m ? '[' + s.t + ']' : s.t)).join('');
  assert.equal(seg('西语作业', '作业'), '西语[作业]');
  assert.equal(seg('西语作业 西语', '西语'), '[西语]作业 [西语]');
  assert.equal(seg('Sprint 规划', 'sprint'), '[Sprint] 规划');
  assert.equal(seg('abcabc', 'ab bc'), '[abcabc]');
  assert.equal(seg('没有', '关键'), '没有');
  assert.equal(seg('', '关键'), '');
  assert.equal(seg('ＡＢＣ', 'abc'), '[ＡＢＣ]', '全角命中时高亮原文');
  assert.deepEqual(Search.segments('abc', []), [{ t: 'abc', m: false }]);
});

test('条目缺字段、是奇怪的值也不报错', () => {
  const items = [{ id: 'x', kind: 'todo', date: '2026-11-15' }, { id: 'y', kind: 'event', date: '2026-11-15', title: null, notes: 5, subs: null }, null, undefined, ev('ok', '2026-11-15', '正常')];
  assert.deepEqual(ids(run(items, '正常')), ['ok']);
  assert.deepEqual(ids(run(items, 'x')), []);
  assert.doesNotThrow(() => Search.run({ query: '正常' }));
  assert.doesNotThrow(() => Search.run({ items: items, query: '正常', today: 'bad' }));
});

test('结果里带着界面要用的字段', () => {
  const e = run([ev('e', '2026-11-20', '开会', { place: '会议室', color: '#1BADF8', remote: true })], '开会').items[0];
  assert.deepEqual(Object.assign({}, e), { id: 'e', kind: 'event', title: '开会', date: '2026-11-20', start: '10:00', end: '11:00', allDay: false, due: '', done: false, star: false, place: '会议室', color: '#1BADF8', remote: true, field: '', snippet: '' });
});
