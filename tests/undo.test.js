// 0.9.0：撤销 / 重做的历史栈。只测栈和“前后差了什么”，真正恢复数据在 app.js 里（界面测试 ui17 走整条路）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Undo = require('../src/undo.js');

const item = (id, more) => Object.assign({ id: id, kind: 'event', date: '2026-11-16', title: id, subs: [] }, more || {});
const ch = (id, before, after) => ({ t: 'item', id: id, before: before, after: after, index: 0 });

test('snap / diff：新建、修改、删除、便签、附加内容各是一样变化', () => {
  const a = Undo.snap([item('a'), item('b'), item('c', { subs: [{ id: 's1', text: '带伞', done: false }] })], '买菜', { 'r|x': { subs: [] } });
  const items = [item('a', { title: '改了' }), item('c', { subs: [{ id: 's1', text: '带伞', done: false }] }), item('d')];
  const b = Undo.snap(items, '买菜\n取快递', { 'r|x': { subs: [], countdown: true }, 'r|y': { subs: [] } });
  const d = Undo.diff(a, b);
  const by = (t, id) => d.find((x) => x.t === t && x.id === id);
  assert.equal(d.length, 6);
  assert.equal(JSON.parse(by('item', 'a').after).title, '改了');
  assert.equal(JSON.parse(by('item', 'a').before).title, 'a');
  assert.deepEqual([by('item', 'b').after, by('item', 'b').index], [null, 1]);
  assert.deepEqual([by('item', 'd').before, by('item', 'd').index], [null, 2]);
  assert.deepEqual([by('note', 'note').before, by('note', 'note').after], ['买菜', '买菜\n取快递']);
  assert.equal(by('extra', 'r|y').before, null);
  assert.equal(by('item', 'c'), undefined);
  assert.deepEqual(Undo.diff(b, b), []);
});

test('快照是深拷贝：恢复出来的子任务和现在的不是同一个对象', () => {
  const live = item('a', { subs: [{ id: 's1', text: '带伞', done: false }] });
  const a = Undo.snap([live], '', {});
  live.subs[0].done = true;       // 快照之后原地改
  live.subs.push({ id: 's2', text: '后加的', done: false });
  const back = JSON.parse(a.items.a);
  assert.deepEqual(back.subs, [{ id: 's1', text: '带伞', done: false }]);
  assert.notEqual(back.subs, live.subs);
});

test('运行时的标记（uploading）不算内容', () => {
  const a = Undo.snap([item('a')], '', {});
  const b = Undo.snap([item('a', { uploading: true })], '', {});
  assert.deepEqual(Undo.diff(a, b), []);
});

test('多步撤销、重做；撤销后再做新的事，重做的那一截清掉', () => {
  const h = Undo.create();
  h.push({ label: '一', changes: [ch('a', null, '1')], at: 0 });
  h.push({ label: '二', changes: [ch('a', '1', '2')], at: 10000 });
  h.push({ label: '三', changes: [ch('b', null, '1')], at: 20000 });
  assert.deepEqual(h.sizes(), [3, 0]);
  assert.equal(h.undo().label, '三');
  assert.equal(h.undo().label, '二');
  assert.deepEqual(h.sizes(), [1, 2]);
  assert.equal(h.redo().label, '二');
  assert.equal(h.redo().label, '三');
  assert.equal(h.redo(), null);
  h.undo();
  h.push({ label: '四', changes: [ch('c', null, '1')], at: 30000 });
  assert.equal(h.canRedo(), false);
  assert.deepEqual([h.undo().label, h.undo().label, h.undo().label, h.undo()], ['四', '二', '一', null]);
});

test('连着打字并成一步：留最早的 before 和最新的 after；隔久了另算一步', () => {
  const h = Undo.create();
  h.push({ label: '改标题', key: 'edit:a:title', changes: [ch('a', '"开"', '"开会"')], at: 1000 });
  h.push({ label: '改标题', key: 'edit:a:title', changes: [ch('a', '"开会"', '"开会了"')], at: 1800 });
  assert.deepEqual(h.sizes(), [1, 0]);
  assert.deepEqual([h.peek().changes[0].before, h.peek().changes[0].after], ['"开"', '"开会了"']);
  h.push({ label: '改标题', key: 'edit:a:title', changes: [ch('a', '"开会了"', '"开会了吗"')], at: 9000 });
  assert.deepEqual(h.sizes(), [2, 0]);
  // 换了一处改（key 不同）也另算
  h.push({ label: '改地点', key: 'edit:a:place', changes: [ch('a', '"x"', '"y"')], at: 9100 });
  assert.deepEqual(h.sizes(), [3, 0]);
});

test('新建后在详情里填的内容和“新建”是一步；改回原样的那一步取消', () => {
  const h = Undo.create();
  h.push({ label: '新建', key: 'new:a', hold: true, changes: [ch('a', null, '{"t":""}')], at: 0 });
  h.push({ label: '新建', key: 'new:a', hold: true, changes: [ch('a', '{"t":""}', '{"t":"开会"}')], at: 60000 });
  assert.deepEqual(h.sizes(), [1, 0]);
  assert.deepEqual([h.peek().changes[0].before, h.peek().changes[0].after], [null, '{"t":"开会"}']);
  // 打了字又删光
  const g = Undo.create();
  g.push({ label: '改', key: 'k', changes: [ch('a', '"x"', '"xy"')], at: 0 });
  assert.equal(g.push({ label: '改', key: 'k', changes: [ch('a', '"xy"', '"x"')], at: 100 }), null);
  assert.deepEqual(g.sizes(), [0, 0]);
});

test('seal：详情关了以后栈顶不再接着并', () => {
  const h = Undo.create();
  h.push({ label: '新建', key: 'new:a', hold: true, changes: [ch('a', null, '1')], at: 0 });
  h.seal();
  h.push({ label: '新建', key: 'new:a', hold: true, changes: [ch('a', '1', '2')], at: 10 });
  assert.deepEqual(h.sizes(), [2, 0]);
});

test('forget：空白草稿被清走后，历史里不留它', () => {
  const h = Undo.create();
  h.push({ label: '改别的', changes: [ch('x', '1', '2')], at: 0 });
  h.push({ label: '新建', changes: [ch('a', null, '1')], at: 5000 });
  h.push({ label: '一起改', changes: [ch('a', '1', '2'), ch('x', '2', '3')], at: 10000 });
  h.forget((c) => c.t === 'item' && c.id === 'a');
  assert.deepEqual(h.sizes(), [2, 0]);
  assert.deepEqual(h.peek().changes.map((c) => c.id), ['x']);
});

test('restore：没做成的撤销放回去，下次还能撤', () => {
  const h = Undo.create();
  h.push({ label: '一', changes: [ch('a', null, '1')], at: 0 });
  const e = h.undo();
  h.restore(e, true);
  assert.deepEqual(h.sizes(), [1, 0]);
  const r = h.undo();
  h.redo();
  h.restore(r, false);
  assert.deepEqual(h.sizes(), [0, 1]);
});

test('最多留 100 步', () => {
  const h = Undo.create(100);
  for (let i = 0; i < 130; i += 1) h.push({ label: String(i), changes: [ch('a', String(i), String(i + 1))], at: i * 10000 });
  assert.deepEqual(h.sizes(), [100, 0]);
  assert.equal(h.peek().label, '129');
});
