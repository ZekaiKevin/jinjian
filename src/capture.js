// 今笺：全局快捷键呼出的“快速记录”小窗口。
// 写一句话，自动拆出时间；保存后交给主窗口入库。
'use strict';

(function () {
  const TAURI = window.__TAURI__ || null;
  const call = (cmd, args) => (TAURI ? TAURI.core.invoke(cmd, args) : Promise.resolve());
  const $ = (id) => document.getElementById(id);
  const WK = '日一二三四五六';
  const KINDS = ['event', 'todo', 'note'];
  let picked = null; // 手动选的类型；没选就按有没有时间自动判断

  function current() {
    const raw = $('text').value;
    const q = parseQuick(raw, new Date());
    const kind = picked || (q.hasWhen ? 'event' : 'todo');
    return { raw: raw.trim(), q: q, kind: kind };
  }

  function whenText(q) {
    if (!q.date) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q.date);
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WK.charAt(d.getDay()) + (q.time ? ' · ' + q.time : '');
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
      when.textContent = c.kind === 'event' ? (w || '今天') : (w ? w + ' 截止' : '今天');
      what.textContent = c.q.title || c.raw;
    }
  }

  function reset() {
    picked = null;
    $('text').value = '';
    render();
    const box = $('box');
    box.classList.remove('show');
    void box.offsetWidth;
    box.classList.add('show');
    setTimeout(() => $('text').focus(), 30);
  }

  function hide() { call('hide_capture').catch(() => {}); }

  $('text').addEventListener('input', () => { picked = null; render(); });
  $('kinds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    picked = b.dataset.kind;
    render();
    $('text').focus();
  });
  $('box').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); hide(); }
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
    const payload = { kind: c.kind, raw: c.raw, title: c.q.title || c.raw, date: c.q.date, time: c.q.time };
    call('capture_submit', { payload: JSON.stringify(payload) }).catch(() => {});
    $('text').value = '';
  });
  // 点“?”不抢输入框的焦点
  document.querySelector('.help').addEventListener('mousedown', (e) => e.preventDefault());
  window.addEventListener('blur', hide);

  if (TAURI && TAURI.event) TAURI.event.listen('capture-open', reset);
  reset();
})();
