// 今笺：全局快捷键呼出的“快速记录”小窗口。
// 写一句话，自动拆出时间；保存后交给主窗口入库。
// 切走窗口时草稿保留，下次按 Alt + Q 还在；按 Esc 才是放弃。
'use strict';

(function () {
  const TAURI = window.__TAURI__ || null;
  const call = (cmd, args) => (TAURI ? TAURI.core.invoke(cmd, args) : Promise.resolve());
  const $ = (id) => document.getElementById(id);
  const WK = '日一二三四五六';
  const KINDS = ['event', 'todo', 'note'];
  let picked = null; // 手动选的类型；选过就一直用它，直到保存或放弃

  function current() {
    const raw = $('text').value;
    const q = parseQuick(raw, new Date());
    // 有具体时间的是日程；只有日期（“明天 买牛奶”）或什么都没写的是待办
    const kind = picked || (q.time ? 'event' : 'todo');
    return { raw: raw.trim(), q: q, kind: kind };
  }

  function whenText(q) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q.date || '');
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
    const day = m ? (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WK.charAt(d.getDay()) : '今天';
    return day + (q.time ? ' · ' + q.time + (q.endTime ? ' – ' + q.endTime : '') : '');
  }

  function render() {
    const c = current();
    Array.prototype.forEach.call($('kinds').children, (b) => b.setAttribute('aria-pressed', b.dataset.kind === c.kind ? 'true' : 'false'));
    const when = $('when');
    const what = $('what');
    if (c.kind === 'note') {
      when.className = 'tag';
      when.textContent = '便签';
      what.textContent = c.raw;
    } else {
      when.className = 'when';
      const w = whenText(c.q);
      when.textContent = c.kind === 'todo' && c.q.time ? w + ' 截止' : w;
      what.textContent = c.q.title || c.raw;
    }
  }

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  }

  function show() {
    try { applyTheme(localStorage.getItem('jinjian-theme')); } catch (err) { /* 读不到就用默认 */ }
    const box = $('box');
    box.classList.remove('show');
    void box.offsetWidth;
    box.classList.add('show');
    setTimeout(() => { $('text').focus(); $('text').select(); }, 30);
    render();
  }

  function clear() {
    picked = null;
    $('text').value = '';
    render();
  }

  function hide() { call('hide_capture').catch(() => {}); }

  $('text').addEventListener('input', render);
  $('kinds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    picked = b.dataset.kind;
    render();
    $('text').focus();
  });
  $('box').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); clear(); hide(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const c = current();
      picked = KINDS[(KINDS.indexOf(c.kind) + (e.shiftKey ? 2 : 1)) % 3];
      render();
    }
  });
  $('box').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = current();
    if (!c.raw) return;
    const payload = { kind: c.kind, raw: c.raw, title: c.q.title || c.raw, date: c.q.date, time: c.q.time, endTime: c.q.endTime || '' };
    call('capture_submit', { payload: JSON.stringify(payload) }).catch(() => {});
    clear();
  });
  // 点“?”不抢输入框的焦点
  document.querySelector('.help').addEventListener('mousedown', (e) => e.preventDefault());
  window.addEventListener('blur', hide);
  window.addEventListener('storage', (e) => { if (e.key === 'jinjian-theme') applyTheme(e.newValue); });

  if (TAURI && TAURI.event) {
    TAURI.event.listen('capture-open', show);
    TAURI.event.listen('theme', (e) => applyTheme(e.payload));
  }
  clear();
  show();
})();
