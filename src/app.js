// 今笺 Jinjian：界面逻辑（第一版：今日日程、待办、便签、详情面板）。
// 不依赖任何框架。列表整体重画；详情面板里的输入框只在切换条目时填一次，
// 这样打字时不会丢焦点。
'use strict';

const TAURI = window.__TAURI__ || null;
const invoke = TAURI ? TAURI.core.invoke : null;
const root = document.documentElement;
const $ = (id) => document.getElementById(id);

const WK = '日一二三四五六';
const CHECK = '<svg class="pop" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#10241B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.5l3 3 6-6.5"/></svg>';
const CHECK_STILL = CHECK.replace('class="pop" ', '');
const STAR = '<svg class="star" width="14" height="14" viewBox="0 0 14 14" fill="currentColor" role="img" aria-label="重点"><path d="M7 1.2l1.8 3.7 4 .6-2.9 2.8.7 4L7 10.4l-3.6 1.9.7-4L1.2 5.5l4-.6z"/></svg>';
const CROSS = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';

const state = {
  items: [],      // 日程和待办都放在这里，用 kind 区分
  note: '',       // 便签
  sel: null,      // 详情面板里打开的条目 id
  justDone: null, // 刚被勾选的 id，只让它播一次动画
  day: '',        // 当前显示的日期，用来发现“过了零点”
};
let saveTimer = null;

// ---------- 小工具 ----------

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => iso(new Date());
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const fromMin = (m) => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function span(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return h + ' 小时 ' + m + ' 分';
  if (h) return h + ' 小时';
  return m + ' 分钟';
}

const find = (id) => state.items.find((it) => it.id === id) || null;
const startOf = (e) => { const v = toMin(e.start); return v === null ? 9999 : v; };

// ---------- 读写 ----------

async function load() {
  let raw = '';
  try {
    raw = invoke ? await invoke('load_data') : (localStorage.getItem('jinjian') || '');
  } catch (err) {
    console.error('读取数据失败', err);
  }
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    state.items = Array.isArray(data.items) ? data.items : [];
    state.note = typeof data.note === 'string' ? data.note : '';
  } catch (err) {
    console.error('数据文件解析失败', err);
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const json = JSON.stringify({ version: 1, items: state.items, note: state.note });
    try {
      if (invoke) await invoke('save_data', { json: json });
      else localStorage.setItem('jinjian', json);
    } catch (err) {
      console.error('保存失败', err);
    }
  }, 250);
}

// 没做完的待办不标逾期，直接顺延到今天。
function rollOver() {
  const t = today();
  let moved = false;
  state.items.forEach((it) => {
    if (it.kind === 'todo' && !it.done && it.date < t) { it.date = t; moved = true; }
  });
  if (moved) save();
}

// ---------- 画界面 ----------

function phase(e) {
  const s = toMin(e.start);
  const en = toMin(e.end);
  const n = nowMin();
  if (s === null) return 'none';
  if (en !== null && en <= n) return 'past';
  if (s <= n) return 'now';
  return 'next';
}

function dayEvents() {
  const t = today();
  return state.items.filter((it) => it.kind === 'event' && it.date === t).sort((a, b) => startOf(a) - startOf(b));
}

function dayTodos() {
  const t = today();
  const list = state.items.filter((it) => it.kind === 'todo' && it.date === t);
  return list.filter((x) => x.star).concat(list.filter((x) => !x.star));
}

function renderHeader() {
  const d = new Date();
  $('h-day').textContent = d.getDate();
  $('h-month').textContent = (d.getMonth() + 1) + '月';
  $('h-week').textContent = '周' + WK.charAt(d.getDay());
}

function renderPips(todos) {
  const done = todos.filter((x) => x.done).length;
  $('pips-row').hidden = todos.length === 0;
  $('pips').innerHTML = todos.map((_, i) => '<span class="pip' + (i < done ? ' on' : '') + '"></span>').join('');
  $('count').textContent = done + '/' + todos.length;
}

function renderNow(events) {
  const active = events.find((e) => phase(e) === 'now');
  const next = events.find((e) => phase(e) === 'next');
  const n = nowMin();
  let v = { id: '', label: '今天', title: events.length ? '日程都结束了' : '还没有日程', range: '', left: '', right: '', pct: 0 };
  if (active) {
    const s = toMin(active.start);
    const en = toMin(active.end);
    v = {
      id: active.id,
      label: '正在进行',
      title: active.title || '未命名',
      range: active.start + (active.end ? ' – ' + active.end : ''),
      left: active.place || '',
      right: en !== null ? '还剩 ' + span(en - n) : '',
      pct: en !== null && en > s ? Math.min(100, Math.round(((n - s) / (en - s)) * 100)) : 0,
    };
  } else if (next) {
    v = {
      id: next.id,
      label: '接下来',
      title: next.title || '未命名',
      range: next.start + (next.end ? ' – ' + next.end : ''),
      left: next.place || '',
      right: span(toMin(next.start) - n) + '后',
      pct: 0,
    };
  }
  $('now').dataset.id = v.id;
  $('now-label').textContent = v.label;
  $('now-title').textContent = v.title;
  $('now-range').textContent = v.range;
  $('now-left').textContent = v.left;
  $('now-right').textContent = v.right;
  $('now-bar').style.width = v.pct + '%';
}

function renderEvents(events) {
  $('events').innerHTML = events.map((e) => {
    const ph = phase(e);
    const cls = ['ev', 'tap'];
    if (ph === 'past') cls.push('past');
    if (ph === 'now') cls.push('now-on');
    if (e.id === state.sel) cls.push('sel');
    return '<button type="button" class="' + cls.join(' ') + '" data-id="' + esc(e.id) + '">'
      + '<span class="t">' + esc(e.start || '--:--') + '</span>'
      + '<span class="dot"></span>'
      + '<span class="n">' + esc(e.title || '未命名') + '</span>'
      + '<span class="p">' + esc(e.place || '') + '</span>'
      + '</button>';
  }).join('');
}

function renderTodos(todos) {
  $('todos').innerHTML = todos.map((t) => {
    const subs = t.subs || [];
    const bits = [];
    if (t.due) bits.push(t.due);
    if (subs.length) bits.push(subs.filter((x) => x.done).length + '/' + subs.length);
    const name = t.title || '未命名';
    const fresh = t.id === state.justDone;
    const cls = ['td'];
    if (t.done) cls.push('done');
    if (t.id === state.sel) cls.push('sel');
    return '<div class="' + cls.join(' ') + '" data-id="' + esc(t.id) + '">'
      + '<button type="button" class="check tap" data-act="toggle" aria-pressed="' + (t.done ? 'true' : 'false') + '" aria-label="' + esc((t.done ? '标为未完成：' : '标为完成：') + name) + '">'
      + '<span class="box' + (fresh ? ' jelly' : '') + '">' + (t.done ? (fresh ? CHECK : CHECK_STILL) : '') + '</span>'
      + '</button>'
      + '<button type="button" class="open grow tap" data-act="open">'
      + '<span class="name">' + esc(name) + '</span>'
      + (t.star ? STAR : '')
      + '<span class="meta">' + esc(bits.join(' · ')) + '</span>'
      + '</button>'
      + '</div>';
  }).join('');
}

function render() {
  const events = dayEvents();
  const todos = dayTodos();
  renderHeader();
  renderPips(todos);
  renderNow(events);
  renderEvents(events);
  renderTodos(todos);
  state.justDone = null;
}

// ---------- 详情面板 ----------

function renderSubs(it, freshId) {
  const subs = it.subs || [];
  $('p-subcount').textContent = subs.length ? subs.filter((x) => x.done).length + '/' + subs.length : '';
  $('p-subs').innerHTML = subs.map((s) => {
    const fresh = s.id === freshId;
    return '<div class="sub' + (s.done ? ' done' : '') + '" data-sub="' + esc(s.id) + '">'
      + '<button type="button" class="sub-toggle tap" data-act="sub-toggle" aria-pressed="' + (s.done ? 'true' : 'false') + '">'
      + '<span class="box small' + (fresh ? ' jelly' : '') + '">' + (s.done ? (fresh ? CHECK : CHECK_STILL) : '') + '</span>'
      + '<span class="sub-name">' + esc(s.text) + '</span>'
      + '</button>'
      + '<button type="button" class="icon sub-remove tap" data-act="sub-remove" aria-label="' + esc('删除子任务：' + s.text) + '">' + CROSS + '</button>'
      + '</div>';
  }).join('');
}

function fillPanel(it) {
  const isTodo = it.kind === 'todo';
  $('p-kind').textContent = isTodo ? '待办' : '日程';
  $('p-title').value = it.title || '';
  $('p-toggles').hidden = !isTodo;
  $('p-time-row').hidden = isTodo;
  $('p-due-row').hidden = !isTodo;
  $('p-date').value = it.date || '';
  $('p-start').value = it.start || '';
  $('p-end').value = it.end || '';
  $('p-due').value = it.due || '';
  $('p-place').value = it.place || '';
  $('p-notes').value = it.notes || '';
  $('p-sub').value = '';
  $('p-done').setAttribute('aria-pressed', it.done ? 'true' : 'false');
  $('p-star').setAttribute('aria-pressed', it.star ? 'true' : 'false');
  renderSubs(it, null);
}

function openPanel(id, focusTitle) {
  const it = find(id);
  if (!it) return;
  state.sel = id;
  fillPanel(it);
  const panel = $('panel');
  const body = $('panel-body');
  panel.classList.add('on');
  panel.setAttribute('aria-hidden', 'false');
  body.classList.remove('fade');
  void body.offsetWidth; // 让切换条目时内容的淡入重新播一次
  body.classList.add('fade');
  render();
  sendRects();
  if (focusTitle) setTimeout(() => $('p-title').focus(), 80);
}

function closePanel() {
  state.sel = null;
  const panel = $('panel');
  panel.classList.remove('on');
  panel.setAttribute('aria-hidden', 'true');
  render();
  sendRects();
}

function patch(p) {
  const it = find(state.sel);
  if (!it) return;
  Object.assign(it, p);
  save();
  render();
}

function addItem(kind, title, open) {
  const base = { id: uid(kind === 'event' ? 'e' : 't'), kind: kind, date: today(), title: title || '', place: '', notes: '', subs: [] };
  if (kind === 'event') {
    const start = Math.min(23 * 60, Math.ceil((nowMin() + 1) / 30) * 30);
    base.start = fromMin(start);
    base.end = fromMin(Math.min(23 * 60 + 59, start + 60));
  } else {
    base.done = false;
    base.star = false;
    base.due = '';
  }
  state.items.push(base);
  save();
  if (open) openPanel(base.id, true);
  else render();
}

// ---------- 和外壳打交道 ----------

// 告诉外壳哪些区域是“实心”的，其余透明区域让鼠标落到桌面上。
function sendRects() {
  if (!invoke) return;
  const dpr = window.devicePixelRatio || 1;
  const rects = [];
  const add = (el) => {
    const r = el.getBoundingClientRect();
    rects.push([r.left * dpr, r.top * dpr, r.right * dpr, r.bottom * dpr]);
  };
  add($('shell'));
  if (state.sel) add($('panel'));
  invoke('set_hit_rects', { rects: rects }).catch(() => {});
}

function layout() {
  const avail = invoke ? window.screen.availHeight : window.innerHeight;
  root.style.setProperty('--shell-h', Math.max(480, Math.min(864, avail - 48)) + 'px');
}

// 把壁纸按“填充”方式铺满屏幕，算出它相对屏幕的偏移，玻璃内部据此对位。
function applyWallpaper(url, iw, ih, sw, sh) {
  const s = Math.max(sw / iw, sh / ih);
  root.style.setProperty('--wp', 'url("' + url + '")');
  root.style.setProperty('--wp-size', (iw * s) + 'px ' + (ih * s) + 'px');
  root.style.setProperty('--ox', ((iw * s - sw) / 2) + 'px');
  root.style.setProperty('--oy', ((ih * s - sh) / 2) + 'px');
  root.classList.remove('no-wp');
}

function showWallpaper(url, sw, sh) {
  const img = new Image();
  img.onload = () => applyWallpaper(url, img.naturalWidth, img.naturalHeight, sw, sh);
  img.onerror = () => root.classList.add('no-wp');
  img.src = url;
}

async function loadWallpaper() {
  if (invoke) {
    try {
      const bytes = await invoke('wallpaper');
      showWallpaper(URL.createObjectURL(new Blob([bytes])), window.screen.width, window.screen.height);
    } catch (err) {
      console.warn('读不到壁纸，改用实色底', err);
    }
    return;
  }
  // 浏览器预览：?wp=图片地址
  const wp = new URLSearchParams(location.search).get('wp');
  if (wp) showWallpaper(wp, window.innerWidth, window.innerHeight);
}

// ---------- 事件 ----------

function bind() {
  $('events').addEventListener('click', (e) => {
    const row = e.target.closest('.ev');
    if (row) openPanel(row.dataset.id, false);
  });

  $('todos').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const row = e.target.closest('.td');
    if (!btn || !row) return;
    const it = find(row.dataset.id);
    if (!it) return;
    if (btn.dataset.act === 'toggle') {
      it.done = !it.done;
      if (it.done) state.justDone = it.id;
      save();
      if (state.sel === it.id) $('p-done').setAttribute('aria-pressed', it.done ? 'true' : 'false');
      render();
    } else {
      openPanel(it.id, false);
    }
  });

  $('now').addEventListener('click', () => {
    const id = $('now').dataset.id;
    if (id) openPanel(id, false);
  });

  $('add-event').addEventListener('click', () => addItem('event', '', true));
  $('add-todo').addEventListener('click', () => addItem('todo', '', true));

  $('quick').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('quick-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addItem('todo', text, false);
  });

  $('note').addEventListener('input', (e) => { state.note = e.target.value; save(); });

  // 详情面板
  const text = (id, key) => $(id).addEventListener('input', (e) => patch({ [key]: e.target.value }));
  text('p-title', 'title');
  text('p-start', 'start');
  text('p-end', 'end');
  text('p-due', 'due');
  text('p-place', 'place');
  text('p-notes', 'notes');
  $('p-date').addEventListener('change', (e) => { if (e.target.value) patch({ date: e.target.value }); });

  $('p-done').addEventListener('click', () => {
    const it = find(state.sel);
    if (!it) return;
    if (!it.done) state.justDone = it.id;
    $('p-done').setAttribute('aria-pressed', it.done ? 'false' : 'true');
    patch({ done: !it.done });
  });
  $('p-star').addEventListener('click', () => {
    const it = find(state.sel);
    if (!it) return;
    $('p-star').setAttribute('aria-pressed', it.star ? 'false' : 'true');
    patch({ star: !it.star });
  });

  $('p-close').addEventListener('click', closePanel);
  $('p-del').addEventListener('click', () => {
    state.items = state.items.filter((it) => it.id !== state.sel);
    save();
    closePanel();
  });
  $('panel').addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });

  $('p-subform').addEventListener('submit', (e) => {
    e.preventDefault();
    const it = find(state.sel);
    const input = $('p-sub');
    const value = input.value.trim();
    if (!it || !value) return;
    it.subs = (it.subs || []).concat([{ id: uid('s'), text: value, done: false }]);
    input.value = '';
    save();
    renderSubs(it, null);
    render();
  });
  $('p-subs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const row = e.target.closest('.sub');
    const it = find(state.sel);
    if (!btn || !row || !it) return;
    const id = row.dataset.sub;
    let fresh = null;
    if (btn.dataset.act === 'sub-remove') {
      it.subs = (it.subs || []).filter((s) => s.id !== id);
    } else {
      it.subs = (it.subs || []).map((s) => {
        if (s.id !== id) return s;
        if (!s.done) fresh = s.id;
        return Object.assign({}, s, { done: !s.done });
      });
    }
    save();
    renderSubs(it, fresh);
    render();
  });

  // 鼠标穿透：打开后界面点不到，要从托盘菜单关掉。
  $('lock').addEventListener('click', () => { if (invoke) invoke('set_locked', { locked: true }).catch(() => {}); });
  if (TAURI && TAURI.event) {
    TAURI.event.listen('locked', (e) => {
      $('lock').setAttribute('aria-pressed', e.payload ? 'true' : 'false');
    });
  }

  $('panel').addEventListener('transitionend', sendRects);
  window.addEventListener('resize', () => { layout(); sendRects(); });
}

// ---------- 启动 ----------

async function start() {
  if (!invoke) root.classList.add('preview');
  layout();
  await load();
  rollOver();
  state.day = today();
  $('note').value = state.note;
  bind();
  render();
  loadWallpaper();
  sendRects();
  setTimeout(sendRects, 800);

  // 每 20 秒刷新一次“还剩多久”；过了零点顺便换日、顺延待办。
  setInterval(() => {
    if (today() !== state.day) {
      state.day = today();
      rollOver();
    }
    render();
  }, 20000);
}

start();
