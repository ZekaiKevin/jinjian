// 0.9.0：同步内核里不碰网络的那一半：串行队列、“这一轮要不要拉”、合并拉回来的结果、缓存文件的读写。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sync = require('../src/sync.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('队列：一个做完再做下一个，慢的不会被快的插队', async () => {
  const q = Sync.queue();
  const log = [];
  const job = (name, ms) => q.run(name, async () => { log.push(name + ' 开始'); await wait(ms); log.push(name + ' 结束'); return name; });
  const all = await Promise.all([job('同步', 30), job('上传', 1), job('删除', 5)]);
  assert.deepEqual(all, ['同步', '上传', '删除']);
  assert.deepEqual(log, ['同步 开始', '同步 结束', '上传 开始', '上传 结束', '删除 开始', '删除 结束']);
  assert.equal(q.busy(), false);
});

test('队列：出错的那一个不拖住后面的', async () => {
  const q = Sync.queue();
  const bad = q.run('坏的', async () => { throw new Error('断网'); });
  const good = q.run('好的', async () => 'ok');
  await assert.rejects(bad, /断网/);
  assert.equal(await good, 'ok');
  assert.equal(q.size(), 0);
});

test('队列：同一个 key 还在排队时不重复排（防重入）；已经开始跑的不算', async () => {
  const q = Sync.queue();
  let runs = 0;
  const up = () => q.run('上传', async () => { runs += 1; await wait(10); return runs; }, 'upload');
  const hold = q.run('占着', () => wait(20));
  const a = up();
  const b = up();
  const c = up();
  assert.equal(a, b);
  assert.equal(b, c);
  await hold;
  assert.equal(await a, 1);
  assert.equal(runs, 1);
  // 正在跑的时候再喊一次：排一个新的（它会看到更新的状态）
  const d = up();
  await wait(2);
  assert.equal(q.running(), '上传');
  const e = up();
  assert.notEqual(d, e);
  assert.equal(await e, 3);
  assert.equal(runs, 3);
});

test('decide：没变跳过、变了只拉变化、其余整个重拉', () => {
  const st = { ctag: 'c1', token: 't1', win: '2026-09-15' };
  assert.equal(Sync.decide(null, { ctag: 'c1', token: 't1' }, '2026-09-15'), 'full');          // 第一次
  assert.equal(Sync.decide(st, { ctag: 'c1', token: 't1' }, '2026-09-15'), 'skip');            // ctag 没变
  assert.equal(Sync.decide(st, { ctag: 'c2', token: 't2' }, '2026-09-15'), 'delta');           // 变了，有 token
  assert.equal(Sync.decide(st, { ctag: 'c1', token: 't1' }, '2026-09-16'), 'full');            // 过了一天，时间窗口挪了
  assert.equal(Sync.decide({ ctag: 'c1', token: '', win: 'w' }, { ctag: 'c2', token: '' }, 'w'), 'full'); // 服务器不给 token
  assert.equal(Sync.decide({ ctag: '', token: '', win: 'w' }, { ctag: '', token: '' }, 'w'), 'full');      // 什么都不给：每次全量
  assert.equal(Sync.decide({ ctag: '', token: 't1', win: 'w' }, { ctag: '', token: 't1' }, 'w'), 'skip');  // 只给 token 的服务器
});

test('mergeFull：换成服务器的；本机改了没传的留着；等着删的不复活；别的日历不动', () => {
  const res = {
    '/a/1.ics': { etag: '"1"', ics: 'OLD1', cal: '/a/' },
    '/a/2.ics': { etag: '"2"', ics: 'MINE2', cal: '/a/', dirty: true },
    '/a/3.ics': { etag: '', ics: 'NEW3', cal: '/a/', dirty: true },      // 本机新建的，还没传
    '/a/4.ics': { etag: '"4"', ics: 'GONE-ON-SERVER', cal: '/a/' },
    '/b/9.ics': { etag: '"9"', ics: 'OTHER', cal: '/b/' },
  };
  const out = Sync.mergeFull(res, '/a/', [
    { href: '/a/1.ics', etag: '"1b"', ics: 'SRV1' },
    { href: '/a/2.ics', etag: '"2b"', ics: 'SRV2' },
    { href: '/a/5.ics', etag: '"5"', ics: 'SRV5' },
    { href: '/a/6.ics', etag: '"6"', ics: 'SRV6' },
  ], { '/a/6.ics': { etag: '"6"' } });
  assert.deepEqual(Object.keys(out).sort(), ['/a/1.ics', '/a/2.ics', '/a/3.ics', '/a/5.ics', '/b/9.ics']);
  assert.deepEqual(out['/a/1.ics'], { etag: '"1b"', ics: 'SRV1', cal: '/a/', sent: 'SRV1' });
  assert.equal(out['/a/2.ics'].ics, 'MINE2');
  assert.equal(out['/a/2.ics'].etag, '"2"');
  assert.equal(out['/a/3.ics'].ics, 'NEW3');
  assert.equal(out['/b/9.ics'].ics, 'OTHER');
});

test('mergeFull：本机那份缺版本号时补上服务器的', () => {
  const out = Sync.mergeFull({ '/a/1.ics': { etag: '', ics: 'MINE', cal: '/a/', dirty: true } }, '/a/', [{ href: '/a/1.ics', etag: '"s"', ics: 'SRV' }], {});
  assert.deepEqual([out['/a/1.ics'].ics, out['/a/1.ics'].etag], ['MINE', '"s"']);
});

test('mergeDelta：只动变了的；服务器删掉的拿走；规矩和全量一样', () => {
  const res = {
    '/a/1.ics': { etag: '"1"', ics: 'OLD1', cal: '/a/' },
    '/a/2.ics': { etag: '"2"', ics: 'MINE2', cal: '/a/', dirty: true },
    '/a/3.ics': { etag: '"3"', ics: 'KEEP3', cal: '/a/' },
    '/a/4.ics': { etag: '"4"', ics: 'DEL4', cal: '/a/' },
    '/a/5.ics': { etag: '"5"', ics: 'MINE5', cal: '/a/', dirty: true },
  };
  const out = Sync.mergeDelta(res, '/a/', [{ href: '/a/1.ics', etag: '"1b"', ics: 'SRV1' }, { href: '/a/2.ics', etag: '"2b"', ics: 'SRV2' }, { href: '/a/7.ics', etag: '"7"', ics: 'SRV7' }, { href: '/a/8.ics', etag: '"8"', ics: 'SRV8' }],
    ['/a/4.ics', '/a/5.ics', '/a/none.ics'], { '/a/8.ics': {} });
  assert.deepEqual(Object.keys(out).sort(), ['/a/1.ics', '/a/2.ics', '/a/3.ics', '/a/5.ics', '/a/7.ics']);
  assert.equal(out['/a/1.ics'].ics, 'SRV1');
  assert.equal(out['/a/2.ics'].ics, 'MINE2');
  assert.equal(out['/a/3.ics'].ics, 'KEEP3');
  assert.equal(out['/a/5.ics'].ics, 'MINE5');   // 本机改了没传：留着，上传时带着旧版本号会被服务器拒掉，再整个重拉
  assert.equal(res['/a/4.ics'].ics, 'DEL4');    // 不改传进来的那份
});

test('dirtyAfter：撤销后恢复成的原文和服务器上的一样，就不用再传', () => {
  assert.equal(Sync.dirtyAfter({ sent: 'A', ics: 'B' }, 'A'), false);
  assert.equal(Sync.dirtyAfter({ sent: 'A', ics: 'B' }, 'C'), true);
  assert.equal(Sync.dirtyAfter({ ics: 'B' }, 'B'), true);  // 不知道服务器上是什么（重启前就没传完）：照传
  assert.equal(Sync.dirtyAfter(null, 'B'), true);
});

test('缓存文件：sent 不写盘；读回来没传完的还是 dirty，坏条目丢掉', () => {
  const remote = { res: { '/a/1.ics': { etag: '"1"', ics: 'A', cal: '/a/', sent: 'A' }, '/a/2.ics': { etag: '', ics: 'B', cal: '/a/', dirty: true, sent: 'OLD' } },
    cals: { '/a/': { ctag: 'c', token: 't', win: 'w' } }, gone: { '/a/3.ics': { etag: '"3"', ics: 'C', cal: '/a/', timer: 5 } }, at: 7 };
  const text = JSON.stringify(Sync.pack(remote));
  assert.equal(text.indexOf('"sent"'), -1);
  assert.equal(text.indexOf('timer'), -1);
  const back = Sync.unpack(JSON.parse(text));
  assert.deepEqual(back.res['/a/1.ics'], { etag: '"1"', ics: 'A', cal: '/a/', sent: 'A' });
  assert.deepEqual(back.res['/a/2.ics'], { etag: '', ics: 'B', cal: '/a/', dirty: true });
  assert.deepEqual(back.cals, { '/a/': { ctag: 'c', token: 't', win: 'w' } });
  assert.deepEqual(back.gone, { '/a/3.ics': { etag: '"3"', ics: 'C', cal: '/a/' } });
  // 旧版 data.json 里的 remote（没有 cals / gone）、坏内容
  assert.deepEqual(Sync.unpack({ res: { '/x.ics': { etag: '"1"', ics: 'X', cal: '/c/' }, '/bad.ics': { etag: 1 }, '/null.ics': null }, at: 3 }),
    { res: { '/x.ics': { etag: '"1"', ics: 'X', cal: '/c/', sent: 'X' } }, cals: {}, gone: {}, at: 3 });
  assert.deepEqual(Sync.unpack(null), { res: {}, cals: {}, gone: {}, at: 0 });
  assert.deepEqual(Sync.unpack('坏的'), { res: {}, cals: {}, gone: {}, at: 0 });
});

test('重试间隔：5 秒、30 秒、2 分钟，之后每 10 分钟', () => {
  assert.deepEqual([1, 2, 3, 4, 9].map(Sync.backoff), [5, 30, 120, 600, 600]);
});
