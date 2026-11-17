// 今笺 Jinjian：同步内核里不碰网络、不碰界面的那一半（0.9.0）。纯函数，浏览器和 Node 里都能用，单测在 tests/sync.test.js。
//
//   queue()      所有和 iCloud 打交道的事（拉取、上传、新建、删除）排成一队，一个做完再做下一个。
//   decide()     这个日历这一轮要不要拉：没变就跳过 / 只拉变化 / 整个重拉。
//   mergeFull()  整个重拉的结果并进本机缓存；mergeDelta() 只并变化的那几条。
//
// 缓存里的一条：res[地址] = { etag, ics, cal, dirty, sent }
//   dirty  本机改了还没传上去；合并时一律留着本机这份
//   sent   服务器上现在的原文（拉下来的，或者刚传成功的）。撤销时拿它判断“恢复成的样子是不是本来就在服务器上”，
//          是的话连上传都不用。只在内存里，不写进缓存文件。
(function (global) {
  'use strict';

  // 串行队列。run(name, fn, key)：排到队尾，返回它的结果。
  // key 给了的话，同一个 key 还在排队（没开始跑）时不再排第二个，直接拿前一个的结果：
  // 连点几次“同步”、几处同时喊“把待上传的传一下”，只会做一次。已经开始跑的不算，后来的再排一个（它看到的是更新的状态）。
  function queue() {
    let tail = Promise.resolve();
    const waiting = {};
    let size = 0;
    let running = '';
    function run(name, fn, key) {
      if (key && waiting[key]) return waiting[key];
      size += 1;
      const job = tail.then(() => {
        if (key) delete waiting[key];
        running = name;
        return fn();
      });
      const done = job.then((v) => { size -= 1; running = ''; return v; }, (e) => { size -= 1; running = ''; throw e; });
      tail = done.catch(() => {});
      if (key) waiting[key] = done;
      return done;
    }
    return { run: run, busy: () => size > 0, size: () => size, running: () => running };
  }

  // st：上次记下的 { ctag, token, win }（没有就是 null）；now：这次问到的 { ctag, token }；win：现在的时间窗口（按天）。
  //   'full'   没同步过、时间窗口挪了（每天一次，窗口尽头新进来的日程要靠它）、服务器不给 ctag 也不给 token
  //   'skip'   ctag（或 token）和上次一样：日历没变，这一轮什么都不用拉
  //   'delta'  变了，而且上次留了 token：只问变了哪些
  function decide(st, now, win) {
    const n = now || {};
    if (!st || st.win !== win) return 'full';
    if (n.ctag && st.ctag && n.ctag === st.ctag) return 'skip';
    if (!n.ctag && n.token && st.token && n.token === st.token) return 'skip';
    if (st.token && n.token) return 'delta';
    return 'full';
  }

  const fresh = (cal, r) => ({ etag: r.etag || '', ics: r.ics, cal: cal, sent: r.ics });

  // 整个重拉：这个日历的条目换成 list（[{ href, etag, ics }]）。
  // 本机改了还没传的留着本机这份（缺版本号的顺手补上）；正在等着删的（gone）不让它复活。
  function mergeFull(res, cal, list, gone) {
    const out = {};
    const dead = gone || {};
    Object.keys(res || {}).forEach((h) => { if (res[h].cal !== cal) out[h] = res[h]; });
    (list || []).forEach((r) => { if (r && r.href && r.ics && !dead[r.href]) out[r.href] = fresh(cal, r); });
    Object.keys(res || {}).forEach((h) => {
      const mine = res[h];
      if (mine.cal !== cal || !mine.dirty) return;
      if (!mine.etag && out[h]) mine.etag = out[h].etag;
      out[h] = mine;
    });
    return out;
  }

  // 只并变化：changed 是拿到新原文的那几条，removed 是服务器上已经没了的地址。规矩和上面一样。
  function mergeDelta(res, cal, changed, removed, gone) {
    const out = Object.assign({}, res || {});
    const dead = gone || {};
    (changed || []).forEach((r) => {
      if (!r || !r.href || !r.ics || dead[r.href]) return;
      const mine = out[r.href];
      if (mine && mine.dirty) { if (!mine.etag) mine.etag = r.etag || ''; return; }
      out[r.href] = fresh(cal, r);
    });
    (removed || []).forEach((h) => { if (out[h] && !out[h].dirty) delete out[h]; });
    return out;
  }

  // 上传失败后隔多久再试（秒）：5 秒、30 秒、2 分钟，之后每 10 分钟
  const backoff = (n) => [5, 30, 120, 600][Math.max(1, Math.min(n, 4)) - 1];

  // 撤销 / 重做把一条的原文恢复成 text 以后，它算不算“还没传”：和服务器上的一样就不算
  const dirtyAfter = (entry, text) => !(entry && entry.sent !== undefined && entry.sent === text);

  // 写进缓存文件的样子：sent 不写（和 ics 一样的那份白占一倍地方）
  function pack(remote) {
    const res = {};
    Object.keys((remote && remote.res) || {}).forEach((h) => {
      const r = remote.res[h];
      res[h] = { etag: r.etag || '', ics: r.ics, cal: r.cal };
      if (r.dirty) res[h].dirty = true;
    });
    const gone = {};
    Object.keys((remote && remote.gone) || {}).forEach((h) => { const g = remote.gone[h]; gone[h] = { etag: g.etag || '', ics: g.ics || '', cal: g.cal || '' }; });
    return { version: 1, res: res, cals: (remote && remote.cals) || {}, gone: gone, at: (remote && remote.at) || 0 };
  }

  // 读缓存文件（或者旧版 data.json 里的 remote）：坏了的条目丢掉，没传完的留着 dirty
  function unpack(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const out = { res: {}, cals: {}, gone: {}, at: Number(d.at) || 0 };
    if (d.res && typeof d.res === 'object') {
      Object.keys(d.res).forEach((h) => {
        const r = d.res[h];
        if (!r || typeof r.ics !== 'string' || !r.ics) return;
        out.res[h] = { etag: typeof r.etag === 'string' ? r.etag : '', ics: r.ics, cal: typeof r.cal === 'string' ? r.cal : '' };
        if (r.dirty) out.res[h].dirty = true; else out.res[h].sent = r.ics;
      });
    }
    if (d.cals && typeof d.cals === 'object') Object.keys(d.cals).forEach((c) => { const s = d.cals[c]; if (s && typeof s === 'object') out.cals[c] = { ctag: String(s.ctag || ''), token: String(s.token || ''), win: String(s.win || '') }; });
    if (d.gone && typeof d.gone === 'object') Object.keys(d.gone).forEach((h) => { const g = d.gone[h]; if (g && typeof g === 'object') out.gone[h] = { etag: String(g.etag || ''), ics: String(g.ics || ''), cal: String(g.cal || '') }; });
    return out;
  }

  const api = { queue: queue, decide: decide, mergeFull: mergeFull, mergeDelta: mergeDelta, backoff: backoff, dirtyAfter: dirtyAfter, pack: pack, unpack: unpack };
  global.Sync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
