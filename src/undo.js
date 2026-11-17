// 今笺 Jinjian：撤销 / 重做的历史栈（0.9.0）。纯函数，浏览器和 Node 里都能用，单测在 tests/undo.test.js。
//
// 一步（entry）是一次用户操作前后“变了的那几样”，不是整份数据的快照：
//   { label, key, at, hold, changes: [{ t, id, before, after, index }] }
//   t: 'item'  本机的一条日程 / 待办（重复的是主条目）；before / after 是那一条的 JSON 文本，null 表示当时没有这一条
//      'note'  便签全文
//      'extra' 挂在 iCloud 日程上的本机附加内容（子任务、倒数日）
//      'res'   iCloud 上的一条：{ ics, cal } 的 JSON 文本（.ics 原文一字不差），null 表示当时没有
// before / after 都是字符串，天然是深拷贝：恢复出来的子任务和现在画面上的不会是同一个对象。
// 连着打字（同一个 key、间隔不长）并成一步；新建之后在详情里填的内容和“新建”并成一步（hold）。
(function (global) {
  'use strict';

  const TRANSIENT = ['uploading', 'draft']; // 运行时的标记（正在上传、刚新建还没填），不算内容

  function clean(it) {
    const c = Object.assign({}, it);
    TRANSIENT.forEach((k) => delete c[k]);
    return c;
  }

  // 现在的样子：每条各自的 JSON 文本和先后顺序
  function snap(items, note, extras) {
    const map = {};
    const order = [];
    (Array.isArray(items) ? items : []).forEach((it) => {
      if (!it || it.id === undefined || it.id === null) return;
      map[it.id] = JSON.stringify(clean(it));
      order.push(it.id);
    });
    const ex = {};
    Object.keys(extras || {}).forEach((k) => { ex[k] = JSON.stringify(extras[k]); });
    return { items: map, order: order, note: String(note || ''), extras: ex };
  }

  // 两个样子之间变了什么
  function diff(a, b) {
    const out = [];
    b.order.forEach((id, i) => {
      if (!(id in a.items)) out.push({ t: 'item', id: id, before: null, after: b.items[id], index: i });
      else if (a.items[id] !== b.items[id]) out.push({ t: 'item', id: id, before: a.items[id], after: b.items[id], index: a.order.indexOf(id) });
    });
    a.order.forEach((id, i) => { if (!(id in b.items)) out.push({ t: 'item', id: id, before: a.items[id], after: null, index: i }); });
    if (a.note !== b.note) out.push({ t: 'note', id: 'note', before: a.note, after: b.note });
    const keys = {};
    Object.keys(a.extras).forEach((k) => { keys[k] = true; });
    Object.keys(b.extras).forEach((k) => { keys[k] = true; });
    Object.keys(keys).forEach((k) => {
      const x = k in a.extras ? a.extras[k] : null;
      const y = k in b.extras ? b.extras[k] : null;
      if (x !== y) out.push({ t: 'extra', id: k, before: x, after: y });
    });
    return out;
  }

  const sameThing = (a, b) => a.t === b.t && a.id === b.id;

  function create(limit) {
    const max = limit > 0 ? limit : 100;
    let done = [];
    let undone = [];

    // 记一步。和栈顶同一个 key、且（两步里有 hold，或者隔得不久）就并进栈顶：留最早的 before、最新的 after；
    // 并完又回到原样的那几样拿掉，一样都不剩时这一步整个取消。返回栈顶（没记成返回 null）。
    function push(e) {
      if (!e || !Array.isArray(e.changes) || !e.changes.length) return null;
      const top = done[done.length - 1];
      const at = e.at || 0;
      if (top && e.key && top.key === e.key && (e.hold || top.hold || at - top.at <= (e.window || 1500))) {
        e.changes.forEach((c) => {
          const mine = top.changes.find((x) => sameThing(x, c));
          if (mine) mine.after = c.after; else top.changes.push(c);
        });
        top.changes = top.changes.filter((c) => c.before !== c.after);
        top.at = at;
        top.hold = !!e.hold;
        undone = [];
        if (!top.changes.length) { done.pop(); return null; }
        return top;
      }
      done.push({ label: e.label || '', key: e.key || '', at: at, hold: !!e.hold, changes: e.changes.slice(), ctx: e.ctx || null });
      undone = [];
      if (done.length > max) done = done.slice(done.length - max);
      return done[done.length - 1];
    }

    // 拿出要撤销的一步（调用方按 before 逐样恢复，从后往前）；没有返回 null
    function undo() {
      const e = done.pop();
      if (!e) return null;
      e.hold = false;
      undone.push(e);
      return e;
    }

    function redo() {
      const e = undone.pop();
      if (!e) return null;
      done.push(e);
      return e;
    }

    // 撤销 / 重做没做成（别处改过了）：把这一步放回去
    function restore(e, wasUndo) {
      if (wasUndo) { undone = undone.filter((x) => x !== e); done.push(e); } else { done = done.filter((x) => x !== e); undone.push(e); }
    }

    // 把某些东西从历史里抹掉（新建的空白草稿关掉后被清走了、断开了 iCloud）；抹完空了的步骤一并拿掉
    function forget(match) {
      const strip = (list) => list.map((e) => { e.changes = e.changes.filter((c) => !match(c)); return e; }).filter((e) => e.changes.length);
      done = strip(done);
      undone = strip(undone);
    }

    // 栈顶不再接着并（详情关了、焦点离开了输入框）
    function seal() {
      const top = done[done.length - 1];
      if (top) { top.hold = false; top.key = ''; }
    }

    return {
      push: push, undo: undo, redo: redo, restore: restore, forget: forget, seal: seal,
      clear: () => { done = []; undone = []; },
      canUndo: () => done.length > 0, canRedo: () => undone.length > 0,
      peek: () => done[done.length - 1] || null,
      sizes: () => [done.length, undone.length],
    };
  }

  const api = { create: create, snap: snap, diff: diff, clean: clean };
  global.Undo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
