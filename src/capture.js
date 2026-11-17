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
  const DRAFT = 'jinjian-draft';
  let picked = null; // 手动选的类型；选过就一直用它，直到保存或放弃
  let off = {};      // 点掉的小胶囊：这一类不认（{ repeat, date, time, place }）
  let comp = false;  // 输入法正在组字
  const NAMES = { repeat: '重复', date: '日期', time: '时间', place: '地点' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  // 主窗口把“哪天哪段有日程”放在本机存储里（今天起两个月），这里拿来提示时间冲突
  function busyOn(date) {
    try { return (JSON.parse(localStorage.getItem('jinjian-busy') || '{}')[date]) || []; } catch (err) { return []; }
  }

  // 草稿存一份在本机，窗口被重新加载也不丢
  function keepDraft() { try { localStorage.setItem(DRAFT, $('text').value); } catch (err) { /* 存不了就算了 */ } }
  function loadDraft() { try { return localStorage.getItem(DRAFT) || ''; } catch (err) { return ''; } }
  // 输入法正在组字（拼音候选框开着）时，回车、Esc、Tab 是给输入法的
  const composing = (e) => e.isComposing || e.keyCode === 229;

  function current() {
    const raw = $('text').value;
    const q = parseQuick(raw, new Date(), off);
    // 有具体时间的是日程；只有日期（“明天 买牛奶”）、写了“3点前”这样的截止、或什么都没写的是待办
    const kind = picked || (q.time && !q.isDeadline ? 'event' : 'todo');
    return { raw: raw.trim(), q: q, kind: kind };
  }

  // 日程目前只能在一天之内：跨午夜的时间段记到当天 23:59
  const endOf = (q) => (q.endNextDay ? '23:59' : q.endTime);

  function whenText(q) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q.date || '');
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
    const day = m ? (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WK.charAt(d.getDay()) : '今天';
    return day + (q.time ? ' · ' + q.time + (q.endTime ? ' – ' + endOf(q) : '') : '');
  }

  // 认出来的重复 / 日期 / 时间 / 地点排成小胶囊，点一下就是“这个不算”；和已有日程撞了给一条提示
  function renderChips(c) {
    const q = c.q;
    const chips = [];
    if (c.kind !== 'note' && c.raw) {
      if (q.rrule) chips.push(['repeat', q.repeatLabel]);
      if (q.date) chips.push(['date', whenText({ date: q.date })]);
      if (q.time) chips.push(['time', q.time + (q.endTime ? '–' + endOf(q) : '') + (q.isDeadline ? ' 截止' : '')]);
      if (q.place) chips.push(['place', q.place]);
      Object.keys(off).forEach((k) => { if (off[k]) chips.push([k, NAMES[k], true]); });
      if (c.kind === 'event' && q.time) {
        const d = new Date();
        const date = q.date || d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        const s0 = toMin(q.time);
        const e0 = q.endTime && !q.endNextDay && toMin(q.endTime) > s0 ? toMin(q.endTime) : Math.min(1440, s0 + 60);
        const hit = busyOn(date).find((x) => x[0] < e0 && s0 < x[1]);
        if (hit) chips.push(['warn', '与「' + hit[2] + '」重叠']);
      }
    }
    const html = chips.map((x) => (x[0] === 'warn' ? '<span class="chip warn">' + esc(x[1]) + '</span>'
      : '<button type="button" class="chip' + (x[2] ? ' off' : '') + '" data-k="' + x[0] + '" aria-pressed="' + (x[2] ? 'false' : 'true') + '" aria-label="' + esc(NAMES[x[0]] + '：' + x[1]) + '">' + esc(x[1]) + '</button>')).join('');
    if ($('chips')._html !== html) { $('chips')._html = html; $('chips').innerHTML = html; }
  }

  function render() {
    const c = current();
    renderChips(c);
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
    applyWall();
  }

  // “跟随壁纸”：这个窗口读不到壁纸，主窗口把配好的那套颜色放在本机存储里
  function applyWall() {
    const root = document.documentElement;
    const on = root.dataset.palette === 'wall';
    let pack = null;
    try { pack = on ? JSON.parse(localStorage.getItem('jinjian-wall') || 'null') : null; } catch (err) { pack = null; }
    const p = pack ? pack[root.dataset.theme === 'light' ? 'light' : 'dark'] : null;
    ['--bg', '--accent', '--save', '--on-accent'].forEach((v) => root.style.removeProperty(v));
    if (!p) return;
    if (root.dataset.theme !== 'light') root.style.setProperty('--bg', p.bg.join(' '));
    root.style.setProperty('--accent', p.accent);
    root.style.setProperty('--save', p.solid || p.accent);
    root.style.setProperty('--on-accent', p.on);
  }

  function applyPalette(name) {
    if (name === 'graphite' || name === 'indigo' || name === 'wall') document.documentElement.dataset.palette = name;
    applyWall();
  }

  function show() {
    try {
      applyTheme(localStorage.getItem('jinjian-theme'));
      applyPalette(localStorage.getItem('jinjian-palette'));
    } catch (err) { /* 读不到就用默认 */ }
    const box = $('box');
    box.classList.remove('show');
    void box.offsetWidth;
    box.classList.add('show');
    // 光标放在末尾：留着草稿时接着写，不会一敲字就把它覆盖掉
    setTimeout(() => { const t = $('text'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }, 30);
    render();
  }

  function clear() {
    picked = null;
    off = {};
    $('text').value = '';
    keepDraft();
    render();
  }

  function hide() { call('hide_capture').catch(() => {}); }

  // 输入法组字时不解析（拼音还没变成字），组完再认
  $('text').addEventListener('compositionstart', () => { comp = true; });
  $('text').addEventListener('compositionend', () => { comp = false; keepDraft(); render(); });
  $('text').addEventListener('input', (e) => { keepDraft(); if (!$('text').value.trim()) off = {}; if (!comp && !e.isComposing) render(); });
  $('chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    off[b.dataset.k] = !off[b.dataset.k];
    render();
    $('text').focus();
  });
  $('kinds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    picked = b.dataset.kind;
    render();
    $('text').focus();
  });
  $('box').addEventListener('keydown', (e) => {
    if (composing(e)) return;
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
    const payload = { kind: c.kind, raw: c.raw, title: c.q.title || c.raw, date: c.q.date, time: c.q.time, endTime: c.q.endTime ? endOf(c.q) : '', place: c.q.place || '', rrule: c.q.rrule || '' };
    call('capture_submit', { payload: JSON.stringify(payload) }).catch(() => {});
    clear();
  });
  // 点“?”不抢输入框的焦点
  document.querySelector('.help').addEventListener('mousedown', (e) => e.preventDefault());
  // 失焦就收起，但留一小段宽限：刚弹出来时系统偶尔会先把焦点给别的窗口再还回来，点任务栏、输入法切换也会闪一下
  let blurTimer = null;
  window.addEventListener('blur', () => { clearTimeout(blurTimer); blurTimer = setTimeout(hide, 220); });
  window.addEventListener('focus', () => clearTimeout(blurTimer));
  window.addEventListener('storage', (e) => {
    if (e.key === 'jinjian-theme') applyTheme(e.newValue);
    if (e.key === 'jinjian-palette') applyPalette(e.newValue);
    if (e.key === 'jinjian-wall') applyWall();
  });

  if (TAURI && TAURI.event) {
    TAURI.event.listen('capture-open', show);
    TAURI.event.listen('theme', (e) => applyTheme(e.payload));
    TAURI.event.listen('palette', (e) => applyPalette(e.payload));
  }
  $('text').value = loadDraft();
  show();
})();
