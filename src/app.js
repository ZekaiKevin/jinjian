// 今笺 Jinjian：主界面逻辑。
// 不用框架：数据放在 S 里，每次改动后整体重画列表；
// 详情面板里的输入框只在切换条目时填一次，打字时不会丢焦点。
'use strict';

const TAURI = window.__TAURI__ || null;
const invoke = TAURI ? TAURI.core.invoke : null;
const call = (cmd, args) => (invoke ? invoke(cmd, args) : Promise.reject(new Error('浏览器预览里没有这个功能')));
const dav = CalDav.create((req) => call('dav', { req: req }));
const root = document.documentElement;
const $ = (id) => document.getElementById(id);

const WK = '日一二三四五六';
const CHECK = '<svg class="pop" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.5l3 3 6-6.5"/></svg>';
const CHECK_STILL = CHECK.replace('class="pop" ', '');
const STAR = '<svg class="star" width="14" height="14" viewBox="0 0 14 14" fill="currentColor" role="img" aria-label="重点"><path d="M7 1.2l1.8 3.7 4 .6-2.9 2.8.7 4L7 10.4l-3.6 1.9.7-4L1.2 5.5l4-.6z"/></svg>';
const CROSS = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';

const SWITCHES = [
  { k: 'blur', name: '背景模糊' },
  { k: 'lock', name: '鼠标穿透' },
  { k: 'carry', name: '未完成顺延到明天' },
  { k: 'autostart', name: '开机自启' },
];

// ---------- 小工具 ----------

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => iso(new Date());
const fromIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(); };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const fromMin = (m) => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const color = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? ' style="--c:' + c + '"' : '');

function span(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return h + ' 小时 ' + m + ' 分';
  if (h) return h + ' 小时';
  return m + ' 分钟';
}

function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// ---------- 数据 ----------

function defaults() {
  return { theme: 'dark', tint: 50, blur: true, carry: true, autostart: false, top: false, sync: { on: false, user: '', cals: [], target: '' } };
}

const S = {
  // 存盘的
  items: [],        // 本机的日程和待办，用 kind 区分
  note: '',         // 便签
  extras: {},       // 同步来的日程在本机附加的内容（子任务），按 id 存
  notified: { day: '', ids: {} },
  settings: defaults(),
  remote: { res: {}, at: 0 }, // iCloud 条目的本地缓存：res[地址] = { etag, ics, cal, dirty }
  // 只在运行时用的
  mode: 'day',      // 小组件里显示“某一天”还是“折叠日历”
  big: false,       // 是否展开成月视图
  compact: '',      // ''、'card'（迷你条）、'capsule'（贴边胶囊）
  date: today(),    // 当前看的日期
  vm: null,         // 日历显示的月份 { y, m }
  sel: null,        // 详情里打开的条目
  pop: null,        // 月视图里弹出小窗口的日期
  panel: '',        // ''、'detail'、'settings'
  justDone: null,
  day: today(),
  locked: false,
  syncing: false,
  status: '',
};
let R = [];           // 同步来的日程展开后的具体场次
let saveTimer = null;
const pushTimers = {};

const allItems = () => S.items.concat(R);
const find = (id) => S.items.find((x) => x.id === id) || R.find((x) => x.id === id) || null;

async function load() {
  let raw = '';
  try {
    raw = invoke ? await invoke('load_data') : (localStorage.getItem('jinjian') || '');
  } catch (err) {
    console.error('读取数据失败', err);
  }
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    S.items = Array.isArray(d.items) ? d.items : [];
    S.items.forEach((it) => { delete it.uploading; });
    S.note = typeof d.note === 'string' ? d.note : '';
    S.extras = d.extras && typeof d.extras === 'object' ? d.extras : {};
    if (d.notified && d.notified.ids) S.notified = d.notified;
    if (d.settings) {
      const base = defaults();
      S.settings = Object.assign(base, d.settings, { sync: Object.assign(base.sync, d.settings.sync || {}) });
    }
    if (d.remote && d.remote.res) S.remote = { res: d.remote.res, at: d.remote.at || 0 };
  } catch (err) {
    console.error('数据文件解析失败', err);
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const json = JSON.stringify({
      version: 2,
      items: S.items.map((it) => { const c = Object.assign({}, it); delete c.uploading; return c; }),
      note: S.note,
      extras: S.extras,
      notified: S.notified,
      settings: S.settings,
      remote: S.remote,
    });
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
  if (!S.settings.carry) return;
  const t = today();
  let moved = false;
  S.items.forEach((it) => {
    if (it.kind === 'todo' && !it.done && it.date < t) { it.date = t; moved = true; }
  });
  if (moved) save();
}

// ---------- iCloud 同步 ----------

function syncWindow() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 62);
  const to = new Date(from.getTime());
  to.setDate(to.getDate() + 462);
  return [from, to];
}

// 把缓存的日历原文展开成一场一场的日程。
function rebuildRemote() {
  const sync = S.settings.sync;
  const out = [];
  if (sync.on) {
    const cals = {};
    sync.cals.forEach((c) => { cals[c.href] = c; });
    const range = syncWindow();
    Object.keys(S.remote.res).forEach((href) => {
      const res = S.remote.res[href];
      const cal = cals[res.cal];
      if (!cal || !cal.on) return;
      let evs = [];
      try { evs = ICS.parse(res.ics); } catch (err) { return; }
      const recurring = evs.some((e) => e.rrule);
      ICS.expand(evs, range[0], range[1]).forEach((o) => {
        const id = recurring ? 'r|' + href + '|' + o.key : 'r|' + href;
        const extra = S.extras[id] || {};
        out.push({
          id: id, kind: 'event', remote: true, href: href, recurring: recurring, cal: res.cal, calName: cal.name, color: cal.color || '',
          date: o.date, start: o.start, end: o.end, allDay: o.allDay, title: o.title, place: o.place, notes: o.notes,
          remind: o.remind === null || o.remind === undefined ? 'none' : String(o.remind), subs: extra.subs || [],
        });
      });
    });
  }
  R = out;
}

function setStatus(text) {
  S.status = text;
  $('s-status').textContent = text;
}

function errText(err) {
  const msg = err && err.message ? err.message : String(err);
  if (msg === 'auth') return 'Apple ID 或 App 专用密码不对';
  return '同步失败：' + msg;
}

async function syncNow(rediscover) {
  const sync = S.settings.sync;
  if (!sync.on || !sync.user || S.syncing) return;
  S.syncing = true;
  setStatus('正在同步…');
  try {
    if (rediscover || !sync.cals.length) {
      const old = {};
      sync.cals.forEach((c) => { old[c.href] = c; });
      const found = await dav.discover(sync.user, null);
      sync.cals = found.map((c) => Object.assign({ on: old[c.href] ? old[c.href].on : true }, c));
      if (sync.target && !sync.cals.some((c) => c.href === sync.target)) sync.target = '';
    }
    const range = syncWindow();
    const res = {};
    for (const cal of sync.cals) {
      if (!cal.on) continue;
      const list = await dav.fetchCalendar(sync.user, cal.href, range[0], range[1]);
      list.forEach((r) => { res[r.href] = { etag: r.etag, ics: r.ics, cal: cal.href }; });
    }
    // 本机改了还没传上去的，先留着本机这份
    Object.keys(S.remote.res).forEach((h) => { if (S.remote.res[h].dirty) res[h] = S.remote.res[h]; });
    S.remote = { res: res, at: Date.now() };
    const d = new Date();
    setStatus('上次同步 ' + pad(d.getHours()) + ':' + pad(d.getMinutes()));
  } catch (err) {
    setStatus(errText(err));
  }
  S.syncing = false;
  rebuildRemote();
  save();
  if (S.panel === 'settings') fillSettings();
  render();
}

function pushSoon(href) {
  clearTimeout(pushTimers[href]);
  pushTimers[href] = setTimeout(() => pushRes(href), 1500);
}

// 把本机改过的一条日程传回 iCloud。
async function pushRes(href) {
  const res = S.remote.res[href];
  const user = S.settings.sync.user;
  if (!res || !res.dirty || !user) return;
  try {
    const r = await dav.put(user, href, res.ics, res.etag);
    if (r.ok) {
      res.dirty = false;
      res.etag = r.etag || '';
      setStatus('已保存到 iCloud');
      if (!r.etag) setTimeout(() => syncNow(false), 2000);
    } else if (r.status === 412) {
      res.dirty = false;
      setStatus('iCloud 上有更新的版本，已重新同步');
      await syncNow(false);
    } else {
      setStatus('保存到 iCloud 失败（' + r.status + '）');
    }
  } catch (err) {
    setStatus(errText(err));
  }
  save();
}

// 本机新建、指定要存到 iCloud 的日程：等详情关掉后再上传。
async function uploadPending() {
  const sync = S.settings.sync;
  if (!sync.on || !sync.user) return;
  const list = S.items.filter((it) => it.kind === 'event' && it.cal && (it.title || '').trim() && it.id !== S.sel && !it.uploading);
  if (!list.length) return;
  for (const it of list) {
    it.uploading = true;
    const id = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : uid('u')).toUpperCase();
    const href = it.cal + id + '.ics';
    const ics = ICS.build(id, it);
    try {
      const r = await dav.put(sync.user, href, ics, null);
      if (r.ok) {
        S.remote.res[href] = { etag: r.etag || '', ics: ics, cal: it.cal };
        if (it.subs && it.subs.length) S.extras['r|' + href] = { subs: it.subs };
        S.items = S.items.filter((x) => x !== it);
        setStatus('已保存到 iCloud');
        if (!r.etag) setTimeout(() => syncNow(false), 2000);
      } else {
        it.uploading = false;
        setStatus('上传到 iCloud 失败（' + r.status + '）');
      }
    } catch (err) {
      it.uploading = false;
      setStatus(errText(err));
    }
  }
  rebuildRemote();
  save();
  render();
}

// ---------- 改数据 ----------

function updateItem(it, p) {
  const rest = Object.assign({}, p);
  if (it.remote) {
    if ('subs' in rest) {
      S.extras[it.id] = Object.assign({}, S.extras[it.id], { subs: rest.subs });
      it.subs = rest.subs;
      delete rest.subs;
    }
    if (Object.keys(rest).length && !it.recurring) {
      Object.assign(it, rest);
      const res = S.remote.res[it.href];
      if (res) {
        res.ics = ICS.patch(res.ics, it);
        res.dirty = true;
        pushSoon(it.href);
      }
    }
  } else {
    Object.assign(it, rest);
  }
  save();
}

async function deleteItem(it) {
  if (!it.remote) {
    S.items = S.items.filter((x) => x.id !== it.id);
    save();
    return;
  }
  const res = S.remote.res[it.href];
  try {
    const r = await dav.remove(S.settings.sync.user, it.href, res ? res.etag : '');
    if (r.ok) {
      delete S.remote.res[it.href];
      delete S.extras[it.id];
      setStatus('已从 iCloud 删除');
    } else {
      setStatus('删除失败（' + r.status + '）');
    }
  } catch (err) {
    setStatus(errText(err));
  }
  rebuildRemote();
  save();
}

function addItem(kind, fields, open) {
  const date = (fields && fields.date) || S.date;
  const base = Object.assign({ id: uid(kind === 'event' ? 'e' : 't'), kind: kind, date: date, title: '', place: '', notes: '', subs: [] }, fields || {});
  if (kind === 'event') {
    if (!base.start) {
      const start = date === today() ? Math.min(23 * 60, Math.ceil((nowMin() + 1) / 30) * 30) : 9 * 60;
      base.start = fromMin(start);
    }
    if (!base.end) base.end = fromMin(Math.min(23 * 60 + 59, toMin(base.start) + 60));
    if (!base.remind) base.remind = '10';
    const sync = S.settings.sync;
    if (sync.on && sync.target) base.cal = sync.target;
  } else {
    base.done = false;
    base.star = false;
    if (!base.due) base.due = '';
  }
  S.items.push(base);
  save();
  if (open) openDetail(base.id, true);
  else { render(); uploadPending(); }
  return base;
}

// ---------- 取数 ----------

function byDate() {
  const map = {};
  allItems().forEach((it) => { (map[it.date] = map[it.date] || []).push(it); });
  return map;
}

function sortEvents(list) {
  const key = (e) => (e.allDay ? -1 : (toMin(e.start) === null ? 9999 : toMin(e.start)));
  return list.filter((it) => it.kind === 'event').sort((a, b) => key(a) - key(b));
}

function orderTodos(list) {
  const todos = list.filter((it) => it.kind === 'todo');
  return todos.filter((x) => x.star).concat(todos.filter((x) => !x.star));
}

function phase(e) {
  const t = today();
  if (e.date < t) return 'past';
  if (e.date > t) return 'next';
  if (e.allDay) return 'allday';
  const s = toMin(e.start);
  const en = toMin(e.end);
  const n = nowMin();
  if (s === null) return 'none';
  if (en !== null && en <= n) return 'past';
  if (s <= n) return 'now';
  return 'next';
}

// “正在进行 / 接下来”的那一条，小组件、迷你条、胶囊共用。
function nowInfo(map) {
  const events = sortEvents(map[today()] || []);
  const active = events.find((e) => phase(e) === 'now');
  const next = events.find((e) => phase(e) === 'next');
  const n = nowMin();
  const range = (e) => e.start + (e.end ? ' – ' + e.end : '');
  const v = { id: '', label: '今天', title: events.length ? '日程都结束了' : '还没有日程', range: '', left: '', right: '', pct: 0, next: '', short: '' };
  if (active) {
    const s = toMin(active.start);
    const en = toMin(active.end);
    v.id = active.id;
    v.label = '正在进行';
    v.title = active.title || '未命名';
    v.range = range(active);
    v.left = active.place || '';
    v.right = en !== null ? '还剩 ' + span(en - n) : '';
    v.short = en !== null ? span(en - n) : '';
    v.pct = en !== null && en > s ? Math.min(100, Math.round(((n - s) / (en - s)) * 100)) : 0;
    if (next) v.next = next.start + ' ' + (next.title || '未命名');
  } else if (next) {
    v.id = next.id;
    v.label = '接下来';
    v.title = next.title || '未命名';
    v.range = range(next);
    v.left = next.place || '';
    v.right = span(toMin(next.start) - n) + '后';
    v.short = v.right;
  }
  return v;
}

function monthDays() {
  const first = new Date(S.vm.y, S.vm.m, 1);
  const offset = first.getDay();
  const count = new Date(S.vm.y, S.vm.m + 1, 0).getDate();
  const rows = Math.ceil((offset + count) / 7);
  const days = [];
  for (let i = 0; i < rows * 7; i += 1) {
    const d = new Date(S.vm.y, S.vm.m, 1 - offset + i);
    days.push({ d: d, key: iso(d), out: d.getMonth() !== S.vm.m });
  }
  return { days: days, rows: rows };
}

// ---------- 画界面 ----------

function pipsHtml(todos) {
  const done = todos.filter((x) => x.done).length;
  return todos.map((_, i) => '<span class="pip' + (i < done ? ' on' : '') + '"></span>').join('');
}

function renderHeader() {
  const d = fromIso(S.date);
  $('h-day').textContent = d.getDate();
  $('h-month').textContent = (d.getMonth() + 1) + '月';
  $('h-week').textContent = '周' + WK.charAt(d.getDay());
  $('b-view').setAttribute('aria-pressed', S.mode === 'cal' ? 'true' : 'false');
  $('b-settings').setAttribute('aria-pressed', S.panel === 'settings' ? 'true' : 'false');
  $('b-lock').setAttribute('aria-pressed', S.locked ? 'true' : 'false');
}

function renderDay(map, info) {
  const list = map[S.date] || [];
  const events = sortEvents(list);
  const todos = orderTodos(list);
  const isToday = S.date === today();

  $('pips-row').hidden = todos.length === 0;
  $('pips').innerHTML = pipsHtml(todos);
  $('count').textContent = todos.filter((x) => x.done).length + '/' + todos.length;

  $('now').hidden = !isToday;
  $('back-today').hidden = isToday;
  if (isToday) {
    $('now').dataset.id = info.id;
    $('now-label').textContent = info.label;
    $('now-title').textContent = info.title;
    $('now-range').textContent = info.range;
    $('now-left').textContent = info.left;
    $('now-right').textContent = info.right;
    $('now-bar').style.width = info.pct + '%';
  }

  $('events').innerHTML = events.map((e) => {
    const ph = phase(e);
    const cls = ['ev', 'tap'];
    if (ph === 'past') cls.push('past');
    if (ph === 'now') cls.push('now-on');
    if (e.id === S.sel) cls.push('sel');
    return '<button type="button" class="' + cls.join(' ') + '" data-act="open" data-id="' + esc(e.id) + '"' + color(e.color) + '>'
      + '<span class="t">' + esc(e.allDay ? '全天' : (e.start || '--:--')) + '</span>'
      + '<span class="dot"></span>'
      + '<span class="n">' + esc(e.title || '未命名') + '</span>'
      + '<span class="p">' + esc(e.place || '') + '</span>'
      + '</button>';
  }).join('');

  $('todos').innerHTML = todos.map((t) => {
    const subs = t.subs || [];
    const bits = [];
    if (t.due) bits.push(t.due);
    if (subs.length) bits.push(subs.filter((x) => x.done).length + '/' + subs.length);
    const name = t.title || '未命名';
    const fresh = t.id === S.justDone;
    const cls = ['td'];
    if (t.done) cls.push('done');
    if (t.id === S.sel) cls.push('sel');
    return '<div class="' + cls.join(' ') + '">'
      + '<button type="button" class="check tap" data-act="toggle" data-id="' + esc(t.id) + '" aria-pressed="' + (t.done ? 'true' : 'false') + '" aria-label="' + esc((t.done ? '标为未完成：' : '标为完成：') + name) + '">'
      + '<span class="box' + (fresh ? ' jelly' : '') + '">' + (t.done ? (fresh ? CHECK : CHECK_STILL) : '') + '</span>'
      + '</button>'
      + '<button type="button" class="open grow tap" data-act="open" data-id="' + esc(t.id) + '">'
      + '<span class="name">' + esc(name) + '</span>'
      + (t.star ? STAR : '')
      + '<span class="meta">' + esc(bits.join(' · ')) + '</span>'
      + '</button>'
      + '</div>';
  }).join('');
}

function renderCal(map, month) {
  const t = today();
  $('cal-title').textContent = S.vm.y + '年' + (S.vm.m + 1) + '月';
  $('cal-grid').innerHTML = month.days.map((x) => {
    const list = map[x.key] || [];
    const evN = list.filter((it) => it.kind === 'event').length;
    const tdN = list.filter((it) => it.kind === 'todo' && !it.done).length;
    const cls = ['cday', 'tap'];
    if (x.out) cls.push('out');
    if (x.key === t) cls.push('today');
    if (x.key === S.date) cls.push('sel');
    const label = (x.d.getMonth() + 1) + '月' + x.d.getDate() + '日，' + evN + ' 个日程，' + tdN + ' 个待办';
    return '<button type="button" class="' + cls.join(' ') + '" data-act="pick-day" data-date="' + x.key + '" aria-label="' + label + '">'
      + '<span>' + x.d.getDate() + '</span>'
      + '<span class="dots">' + (evN >= 1 ? '<i class="e"></i>' : '') + (evN >= 2 ? '<i class="e"></i>' : '') + (tdN >= 1 ? '<i class="t"></i>' : '') + '</span>'
      + '</button>';
  }).join('');
}

function renderBig(map, month) {
  const t = today();
  const max = month.rows >= 6 ? 4 : 5;
  $('big-title').textContent = S.vm.y + '年' + (S.vm.m + 1) + '月';
  $('big-grid').innerHTML = month.days.map((x) => {
    const list = map[x.key] || [];
    const events = sortEvents(list);
    const tdN = list.filter((it) => it.kind === 'todo' && !it.done).length;
    const shown = events.length > max ? events.slice(0, max - 1) : events;
    const cls = ['cell'];
    if (x.out) cls.push('out');
    if (x.key === S.date) cls.push('sel');
    const label = (x.d.getMonth() + 1) + '月' + x.d.getDate() + '日，' + events.length + ' 个日程，' + tdN + ' 个待办';
    let html = '<div class="' + cls.join(' ') + '" data-date="' + x.key + '">'
      + '<div class="cell-head">'
      + '<span class="badge">' + (tdN ? '<i role="img" aria-label="未完成待办"></i><span>' + tdN + '</span>' : '') + '</span>'
      + '<button type="button" class="num tap' + (x.key === t ? ' today' : '') + '" data-act="pop-day" data-date="' + x.key + '" aria-label="' + label + '">' + x.d.getDate() + '</button>'
      + '</div>';
    html += shown.map((e) => '<button type="button" class="line tap' + (e.id === S.sel ? ' sel' : '') + '" data-act="open" data-id="' + esc(e.id) + '"' + color(e.color) + '>'
      + '<i></i><span class="n">' + esc(e.title || '未命名') + '</span><span class="t">' + esc(e.allDay ? '' : e.start) + '</span></button>').join('');
    if (events.length > max) {
      html += '<button type="button" class="line more tap" data-act="pop-day" data-date="' + x.key + '"><i></i><span class="n">+' + (events.length - shown.length) + '</span><span class="t"></span></button>';
    }
    return html + '</div>';
  }).join('');
}

function renderPop(map) {
  const pop = $('pop');
  const cell = S.pop && S.big ? $('big-grid').querySelector('.cell[data-date="' + S.pop + '"]') : null;
  pop.classList.toggle('on', !!cell);
  pop.setAttribute('aria-hidden', cell ? 'false' : 'true');
  if (!cell) return;
  const d = fromIso(S.pop);
  const list = map[S.pop] || [];
  $('pop-title').textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WK.charAt(d.getDay());
  const rows = sortEvents(list).map((e) => '<button type="button" class="prow tap' + (e.id === S.sel ? ' sel' : '') + '" data-act="open" data-id="' + esc(e.id) + '"' + color(e.color) + '>'
    + '<span class="mark"></span><span class="col"><span class="pn ellipsis">' + esc(e.title || '未命名') + '</span>'
    + '<span class="ps ellipsis">' + esc((e.allDay ? '全天' : e.start + (e.end ? ' – ' + e.end : '')) + (e.place ? ' · ' + e.place : '')) + '</span></span></button>')
    .concat(orderTodos(list).map((x) => '<button type="button" class="prow todo tap' + (x.done ? ' done' : '') + (x.id === S.sel ? ' sel' : '') + '" data-act="open" data-id="' + esc(x.id) + '">'
      + '<span class="mark"></span><span class="col"><span class="pn ellipsis">' + esc(x.title || '未命名') + '</span>'
      + '<span class="ps ellipsis">' + esc(x.due ? '待办 · ' + x.due + ' 截止' : '待办') + '</span></span></button>'));
  $('pop-list').innerHTML = rows.length ? rows.join('') : '<div class="pempty">没有安排</div>';

  // 贴着被点的那一格：左半边的格子往右弹，右半边的往左弹
  const wrap = pop.parentElement.getBoundingClientRect();
  const r = cell.getBoundingClientRect();
  const idx = Array.prototype.indexOf.call(cell.parentElement.children, cell);
  const total = cell.parentElement.children.length / 7;
  const onRight = idx % 7 <= 3;
  pop.style.left = (onRight ? r.right - wrap.left + 4 : r.left - wrap.left - 268) + 'px';
  if (Math.floor(idx / 7) < total / 2) {
    pop.style.top = (r.top - wrap.top) + 'px';
    pop.style.bottom = 'auto';
    pop.style.transformOrigin = (onRight ? 'left' : 'right') + ' top';
  } else {
    pop.style.top = 'auto';
    pop.style.bottom = (wrap.bottom - r.bottom) + 'px';
    pop.style.transformOrigin = (onRight ? 'left' : 'right') + ' bottom';
  }
}

function renderCompact(map, info) {
  const todos = orderTodos(map[today()] || []);
  $('c-label').textContent = info.label;
  $('c-range').textContent = info.range;
  $('c-title').textContent = info.title;
  $('c-bar').style.width = info.pct + '%';
  $('c-left').textContent = info.right;
  $('c-next').textContent = info.next;
  $('c-pips').innerHTML = pipsHtml(todos);
  $('c-count').textContent = todos.filter((x) => x.done).length + '/' + todos.length;
  $('cap-title').textContent = info.title;
  $('cap-left').textContent = info.short;
}

// 小组件、折叠日历、月视图、迷你条是同一块玻璃在变大小。
function applyMode() {
  const shell = $('shell');
  const full = parseFloat(getComputedStyle(root).getPropertyValue('--shell-h')) || 864;
  let w = 372;
  let h = full;
  if (S.compact === 'card') {
    w = 348;
    h = $('compact').offsetHeight;
  } else if (S.big) {
    w = 768;
    h = Math.min(640, full);
  } else if (S.mode === 'cal') {
    h = Math.min(full, 156 + $('cal').offsetHeight);
  }
  shell.style.width = w + 'px';
  shell.style.height = h + 'px';
  shell.classList.toggle('gone', S.compact === 'capsule');
  $('widget').classList.toggle('on', !S.big && !S.compact);
  $('big').classList.toggle('on', S.big && !S.compact);
  $('compact').classList.toggle('on', S.compact === 'card');
  $('capsule').classList.toggle('on', S.compact === 'capsule');
  $('day').classList.toggle('on', S.mode === 'day');
  $('cal').classList.toggle('on', S.mode === 'cal');
}

// 详情：平时停在小组件左边；月视图里变成贴着那条日程的气泡。
function positionPanel() {
  const panel = $('panel');
  const arrow = panel.querySelector('.arrow');
  panel.classList.toggle('bubble', S.big);
  if (!S.big) {
    panel.style.top = '';
    panel.style.right = '';
    panel.style.transformOrigin = '';
    return;
  }
  const W = 230;
  const h = panel.offsetHeight;
  const grid = $('big-grid');
  const anchor = grid.querySelector('.line.sel') || (find(S.sel) ? grid.querySelector('.cell[data-date="' + find(S.sel).date + '"] .num') : null);
  const shellRight = window.innerWidth - 24;
  const shellLeft = shellRight - 768;
  if (!anchor) {
    panel.style.top = '60px';
    panel.style.right = (24 + (768 - W) / 2) + 'px';
    arrow.style.display = 'none';
    return;
  }
  const a = anchor.getBoundingClientRect();
  const cell = anchor.closest('.cell').getBoundingClientRect();
  const ay = a.top + a.height / 2;
  const onRight = cell.left + cell.width / 2 < shellLeft + 768 * 0.55;
  const left = onRight ? cell.right + 12 : cell.left - 12 - W;
  const top = Math.max(36, Math.min(24 + 640 - 12 - h, ay - 56));
  const at = Math.max(30, Math.min(h - 40, ay - top));
  panel.style.top = Math.round(top) + 'px';
  panel.style.right = Math.round(window.innerWidth - left - W) + 'px';
  panel.style.transformOrigin = (onRight ? 'left ' : 'right ') + Math.round(at) + 'px';
  arrow.style.display = '';
  arrow.style.top = Math.round(at) + 'px';
  arrow.style.left = onRight ? '-8px' : (W - 9) + 'px';
}

function render() {
  if (!S.vm) { const d = fromIso(S.date); S.vm = { y: d.getFullYear(), m: d.getMonth() }; }
  if (S.sel && !find(S.sel)) { S.sel = null; if (S.panel === 'detail') S.panel = ''; }
  const map = byDate();
  const info = nowInfo(map);
  const month = monthDays();
  renderHeader();
  renderDay(map, info);
  renderCal(map, month);
  renderBig(map, month);
  renderCompact(map, info);
  applyMode();
  renderPop(map);

  const detail = S.panel === 'detail' && !!S.sel;
  $('panel').classList.toggle('on', detail);
  $('panel').setAttribute('aria-hidden', detail ? 'false' : 'true');
  $('settings').classList.toggle('on', S.panel === 'settings');
  $('settings').setAttribute('aria-hidden', S.panel === 'settings' ? 'false' : 'true');
  if (detail) positionPanel();
  S.justDone = null;
  sendRectsSoon();
}

// ---------- 详情 ----------

function renderSubs(it, freshId) {
  const subs = it.subs || [];
  $('p-subcount').textContent = subs.length ? subs.filter((x) => x.done).length + '/' + subs.length : '';
  $('p-subs').innerHTML = subs.map((s) => {
    const fresh = s.id === freshId;
    return '<div class="sub' + (s.done ? ' done' : '') + '">'
      + '<button type="button" class="sub-toggle tap" data-act="sub-toggle" data-id="' + esc(s.id) + '" aria-pressed="' + (s.done ? 'true' : 'false') + '">'
      + '<span class="box small' + (fresh ? ' jelly' : '') + '">' + (s.done ? (fresh ? CHECK : CHECK_STILL) : '') + '</span>'
      + '<span class="sub-name">' + esc(s.text) + '</span>'
      + '</button>'
      + '<button type="button" class="icon sub-remove tap" data-act="sub-remove" data-id="' + esc(s.id) + '" aria-label="' + esc('删除子任务：' + s.text) + '">' + CROSS + '</button>'
      + '</div>';
  }).join('');
}

function fillPanel(it) {
  const isTodo = it.kind === 'todo';
  const locked = !!it.remote && !!it.recurring;
  $('p-kind').textContent = isTodo ? '待办' : '日程';
  $('p-cal').textContent = it.remote ? it.calName : '';
  $('p-ro').hidden = !locked;
  $('p-del').hidden = locked;
  $('p-del').classList.remove('confirm');
  $('p-del').setAttribute('aria-label', '删除');
  $('p-toggles').hidden = !isTodo;
  $('p-time-row').hidden = isTodo || !!it.allDay;
  $('p-due-row').hidden = !isTodo;
  $('p-remind-row').hidden = isTodo;
  $('p-title').value = it.title || '';
  $('p-date').value = it.date || '';
  $('p-start').value = it.start || '';
  $('p-end').value = it.end || '';
  $('p-due').value = it.due || '';
  $('p-place').value = it.place || '';
  $('p-notes').value = it.notes || '';
  $('p-sub').value = '';
  const remind = $('p-remind');
  const value = it.remind || 'none';
  if (!Array.prototype.some.call(remind.options, (o) => o.value === value)) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = '提前 ' + span(Number(value));
    remind.appendChild(o);
  }
  remind.value = value;
  ['p-title', 'p-date', 'p-start', 'p-end', 'p-place', 'p-notes'].forEach((id) => { $(id).disabled = locked; });
  remind.disabled = !!it.remote;
  $('p-done').setAttribute('aria-pressed', it.done ? 'true' : 'false');
  $('p-star').setAttribute('aria-pressed', it.star ? 'true' : 'false');
  renderSubs(it, null);
}

function openDetail(id, focusTitle) {
  const it = find(id);
  if (!it) return;
  const switching = S.sel && S.sel !== id;
  S.sel = id;
  S.panel = 'detail';
  S.pop = null;
  fillPanel(it);
  replay($('panel-body'), 'fade');
  render();
  if (switching) uploadPending();
  if (focusTitle) setTimeout(() => $('p-title').focus(), 80);
}

function closePanels() {
  const had = S.panel;
  S.sel = null;
  S.panel = '';
  render();
  if (had === 'detail') uploadPending();
}

// ---------- 设置 ----------

function applySettings() {
  const s = S.settings;
  const light = s.theme === 'light' || (s.theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  root.dataset.theme = light ? 'light' : 'dark';
  root.style.setProperty('--tint', (s.tint / 100).toFixed(2));
  root.classList.toggle('no-blur', !s.blur);
}

function switchHtml(act, key, name, on, extra) {
  return '<button type="button" class="sw" role="switch" data-act="' + act + '" data-k="' + esc(key) + '" aria-checked="' + (on ? 'true' : 'false') + '">'
    + (extra || '') + '<span class="name ellipsis">' + esc(name) + '</span><span class="track"><span class="knob"></span></span></button>';
}

function fillSettings() {
  const s = S.settings;
  Array.prototype.forEach.call($('s-theme').children, (b) => b.setAttribute('aria-pressed', b.dataset.v === s.theme ? 'true' : 'false'));
  Array.prototype.forEach.call($('s-layer').children, (b) => b.setAttribute('aria-pressed', (b.dataset.v === 'top') === !!s.top ? 'true' : 'false'));
  $('s-tint').value = s.tint;
  $('s-tint-text').textContent = s.tint + '%';
  $('s-switches').innerHTML = SWITCHES.map((x) => switchHtml('sw', x.k, x.name, x.k === 'lock' ? S.locked : !!s[x.k])).join('');
  const sync = s.sync;
  $('s-connect').hidden = sync.on;
  $('s-account').hidden = !sync.on;
  if (sync.on) {
    $('s-account-name').textContent = sync.user;
    $('s-cals').innerHTML = sync.cals.map((c) => switchHtml('cal-sw', c.href, c.name, c.on, '<span class="swatch"' + color(c.color) + '></span>')).join('');
    $('s-target').innerHTML = '<option value="">本机</option>' + sync.cals.map((c) => '<option value="' + esc(c.href) + '">' + esc(c.name) + '</option>').join('');
    $('s-target').value = sync.target || '';
  } else if (!$('s-user').value) {
    $('s-user').value = sync.user || '';
  }
  $('s-status').textContent = S.status;
}

async function connect() {
  const user = $('s-user').value.trim();
  const pass = $('s-pass').value.trim();
  if (!user || !pass) { setStatus('请填 Apple ID 邮箱和 App 专用密码'); return; }
  setStatus('正在连接…');
  try {
    const found = await dav.discover(user, pass);
    await call('cred_set', { user: user, pass: pass });
    $('s-pass').value = '';
    S.settings.sync = { on: true, user: user, cals: found.map((c) => Object.assign({ on: true }, c)), target: '' };
    save();
    fillSettings();
    await syncNow(false);
  } catch (err) {
    setStatus(errText(err).replace('同步失败', '连接失败'));
  }
}

function disconnect() {
  const user = S.settings.sync.user;
  if (user) call('cred_delete', { user: user }).catch(() => {});
  S.items.forEach((it) => { delete it.cal; });
  S.settings.sync = { on: false, user: user, cals: [], target: '' };
  S.remote = { res: {}, at: 0 };
  rebuildRemote();
  save();
  setStatus('已断开，iCloud 里的日程没有被改动');
  fillSettings();
  render();
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
  if (S.compact === 'capsule') add($('capsule'));
  else add($('shell'));
  if ($('panel').classList.contains('on')) add($('panel'));
  if ($('settings').classList.contains('on')) add($('settings'));
  invoke('set_hit_rects', { rects: rects }).catch(() => {});
}

let rectTimer = null;
function sendRectsSoon() {
  sendRects();
  clearTimeout(rectTimer);
  rectTimer = setTimeout(sendRects, 560);
}

function layout() {
  const avail = invoke ? window.screen.availHeight : window.innerHeight;
  root.style.setProperty('--shell-h', Math.max(480, Math.min(864, avail - 48)) + 'px');
}

// 把壁纸按“填充”方式铺满屏幕，算出它相对屏幕的偏移，玻璃内部据此对位。
function showWallpaper(url, sw, sh) {
  const img = new Image();
  img.onload = () => {
    const s = Math.max(sw / img.naturalWidth, sh / img.naturalHeight);
    root.style.setProperty('--wp', 'url("' + url + '")');
    root.style.setProperty('--wp-size', (img.naturalWidth * s) + 'px ' + (img.naturalHeight * s) + 'px');
    root.style.setProperty('--ox', ((img.naturalWidth * s - sw) / 2) + 'px');
    root.style.setProperty('--oy', ((img.naturalHeight * s - sh) / 2) + 'px');
    root.classList.remove('no-wp');
  };
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
  const wp = new URLSearchParams(location.search).get('wp'); // 浏览器预览：?wp=图片地址
  if (wp) showWallpaper(wp, window.innerWidth, window.innerHeight);
}

function checkReminders() {
  if (!invoke) return;
  const t = today();
  const n = nowMin();
  if (S.notified.day !== t) S.notified = { day: t, ids: {} };
  allItems().forEach((it) => {
    if (it.kind !== 'event' || it.date !== t || it.allDay || !it.remind || it.remind === 'none') return;
    const s = toMin(it.start);
    const before = Number(it.remind);
    if (s === null || isNaN(before) || S.notified.ids[it.id]) return;
    if (n >= s - before && n <= s) {
      S.notified.ids[it.id] = 1;
      const lead = n < s ? span(s - n) + '后开始 · ' : '';
      call('notify', { title: it.title || '日程', body: lead + it.start + (it.place ? ' · ' + it.place : '') }).catch(() => {});
      save();
    }
  });
}

// 全局快捷键呼出的“快速记录”窗口把结果发回来。
function fromCapture(p) {
  if (!p || !p.kind) return;
  if (p.kind === 'note') {
    S.note = (S.note ? S.note.replace(/\s+$/, '') + '\n' : '') + p.raw;
    $('note').value = S.note;
    save();
  } else if (p.kind === 'event') {
    addItem('event', { title: p.title, date: p.date || today(), start: p.time || '' }, false);
  } else {
    addItem('todo', { title: p.title, date: p.date || today(), due: p.time || '' }, false);
  }
  render();
}

// ---------- 事件 ----------

function shiftMonth(step) {
  const d = new Date(S.vm.y, S.vm.m + step, 1);
  S.vm = { y: d.getFullYear(), m: d.getMonth() };
  S.pop = null;
  replay($('cal-grid'), 'fade');
  replay($('big-grid'), 'fade');
}

function onAct(act, t) {
  const id = t.dataset.id;
  const date = t.dataset.date;
  const cur = find(S.sel);
  switch (act) {
    case 'open': openDetail(id, false); return;
    case 'now-open': if (t.dataset.id) openDetail(t.dataset.id, false); return;
    case 'toggle': {
      const it = find(id);
      if (!it) return;
      if (!it.done) S.justDone = it.id;
      updateItem(it, { done: !it.done });
      if (S.sel === it.id) $('p-done').setAttribute('aria-pressed', it.done ? 'true' : 'false');
      break;
    }
    case 'add-event': addItem('event', { date: S.date }, true); return;
    case 'add-todo': addItem('todo', { date: S.date }, true); return;
    case 'view': {
      const d = fromIso(S.date);
      S.mode = S.mode === 'cal' ? 'day' : 'cal';
      S.vm = { y: d.getFullYear(), m: d.getMonth() };
      break;
    }
    case 'lock': call('set_locked', { locked: true }).catch(() => {}); return;
    case 'settings':
      S.sel = null;
      S.panel = S.panel === 'settings' ? '' : 'settings';
      if (S.panel) fillSettings();
      break;
    case 's-close': case 'p-close': closePanels(); return;
    case 'compact': S.compact = 'card'; S.sel = null; S.panel = ''; S.pop = null; break;
    case 'dock': S.compact = 'capsule'; break;
    case 'expand': S.compact = ''; break;
    case 'big-open': S.big = true; S.sel = null; S.panel = ''; break;
    case 'big-close': S.big = false; S.mode = 'day'; S.pop = null; break;
    case 'prev-month': shiftMonth(-1); break;
    case 'next-month': shiftMonth(1); break;
    case 'go-today': {
      const d = new Date();
      S.date = today();
      S.vm = { y: d.getFullYear(), m: d.getMonth() };
      S.pop = null;
      break;
    }
    case 'pick-day': S.date = date; S.mode = 'day'; break;
    case 'pop-day': {
      const d = fromIso(date);
      S.date = date;
      S.vm = { y: d.getFullYear(), m: d.getMonth() };
      S.pop = S.pop === date ? null : date;
      if (S.pop) replay($('pop-list'), 'fade');
      break;
    }
    case 'pop-close': S.pop = null; break;
    case 'pop-add': addItem('event', { date: S.pop || S.date }, true); return;
    case 'p-done':
      if (!cur) return;
      if (!cur.done) S.justDone = cur.id;
      updateItem(cur, { done: !cur.done });
      t.setAttribute('aria-pressed', cur.done ? 'true' : 'false');
      break;
    case 'p-star':
      if (!cur) return;
      updateItem(cur, { star: !cur.star });
      t.setAttribute('aria-pressed', cur.star ? 'true' : 'false');
      break;
    case 'p-del':
      if (!cur) return;
      if (cur.remote && !t.classList.contains('confirm')) {
        // iCloud 上的日程删了就没了，要再点一次确认
        t.classList.add('confirm');
        t.setAttribute('aria-label', '再点一次，从 iCloud 删除');
        setTimeout(() => { t.classList.remove('confirm'); t.setAttribute('aria-label', '删除'); }, 3000);
        return;
      }
      S.sel = null;
      S.panel = '';
      deleteItem(cur).then(render);
      break;
    case 'sub-toggle': case 'sub-remove': {
      if (!cur) return;
      let fresh = null;
      const subs = act === 'sub-remove'
        ? (cur.subs || []).filter((s) => s.id !== id)
        : (cur.subs || []).map((s) => {
          if (s.id !== id) return s;
          if (!s.done) fresh = s.id;
          return Object.assign({}, s, { done: !s.done });
        });
      updateItem(cur, { subs: subs });
      renderSubs(cur, fresh);
      break;
    }
    case 'theme': S.settings.theme = t.dataset.v; applySettings(); save(); fillSettings(); return;
    case 'layer':
      S.settings.top = t.dataset.v === 'top';
      call('set_layer', { top: S.settings.top }).catch(() => {});
      save();
      fillSettings();
      return;
    case 'sw': {
      const k = t.dataset.k;
      if (k === 'lock') { call('set_locked', { locked: !S.locked }).catch(() => {}); return; }
      S.settings[k] = !S.settings[k];
      if (k === 'autostart') call('set_autostart', { on: S.settings.autostart }).catch(() => {});
      if (k === 'carry') rollOver();
      applySettings();
      save();
      fillSettings();
      break;
    }
    case 'cal-sw': {
      const cal = S.settings.sync.cals.find((c) => c.href === t.dataset.k);
      if (!cal) return;
      cal.on = !cal.on;
      save();
      fillSettings();
      rebuildRemote();
      render();
      if (cal.on) syncNow(false);
      return;
    }
    case 'sync-now': syncNow(true); return;
    case 'disconnect': disconnect(); return;
    default: return;
  }
  render();
}

function bind() {
  $('stage').addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (t) onAct(t.dataset.act, t);
  });

  $('quick').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('quick-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const q = parseQuick(text, new Date());
    addItem('todo', { title: q.title || text, date: q.date || S.date, due: q.time }, false);
  });

  $('note').addEventListener('input', (e) => { S.note = e.target.value; save(); });

  // 详情里的输入框
  const field = (id, key, ev) => $(id).addEventListener(ev || 'input', (e) => {
    const it = find(S.sel);
    if (!it) return;
    if (key === 'date' && !e.target.value) return;
    updateItem(it, { [key]: e.target.value });
    render();
  });
  field('p-title', 'title');
  field('p-start', 'start');
  field('p-end', 'end');
  field('p-due', 'due');
  field('p-place', 'place');
  field('p-notes', 'notes');
  field('p-date', 'date', 'change');
  field('p-remind', 'remind', 'change');

  $('p-subform').addEventListener('submit', (e) => {
    e.preventDefault();
    const it = find(S.sel);
    const input = $('p-sub');
    const value = input.value.trim();
    if (!it || !value) return;
    input.value = '';
    updateItem(it, { subs: (it.subs || []).concat([{ id: uid('s'), text: value, done: false }]) });
    renderSubs(it, null);
    render();
  });

  ['panel', 'settings'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanels(); }));

  // 设置
  $('s-tint').addEventListener('input', (e) => {
    S.settings.tint = Number(e.target.value);
    $('s-tint-text').textContent = S.settings.tint + '%';
    applySettings();
    save();
  });
  $('s-target').addEventListener('change', (e) => { S.settings.sync.target = e.target.value; save(); });
  $('s-connect').addEventListener('submit', (e) => { e.preventDefault(); connect(); });

  // 入场动画播完就摘掉，否则它会压住后面的显隐过渡
  $('shell').addEventListener('animationend', (e) => { if (e.target === $('shell')) $('shell').classList.remove('rise'); });
  ['panel', 'settings', 'shell'].forEach((id) => $(id).addEventListener('transitionend', sendRects));
  window.addEventListener('resize', () => { layout(); render(); });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applySettings);

  if (TAURI && TAURI.event) {
    TAURI.event.listen('locked', (e) => {
      S.locked = !!e.payload;
      renderHeader();
      if (S.panel === 'settings') fillSettings();
    });
    TAURI.event.listen('capture', (e) => {
      try { fromCapture(typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload); } catch (err) { console.error(err); }
    });
  }
}

// ---------- 启动 ----------

async function start() {
  if (!invoke) root.classList.add('preview');
  layout();
  await load();
  applySettings();
  rollOver();
  rebuildRemote();
  $('note').value = S.note;
  bind();
  render();
  loadWallpaper();
  if (invoke) {
    if (S.settings.top) call('set_layer', { top: true }).catch(() => {});
    Object.keys(S.remote.res).forEach((h) => { if (S.remote.res[h].dirty) pushSoon(h); });
    setTimeout(() => { uploadPending(); syncNow(false); }, 2500);
    setInterval(() => syncNow(false), 10 * 60 * 1000);
  }

  // 每 20 秒刷新一次“还剩多久”和提醒；过了零点换日、顺延待办。
  setInterval(() => {
    if (today() !== S.day) {
      if (S.date === S.day) S.date = today();
      S.day = today();
      rollOver();
      rebuildRemote();
    }
    checkReminders();
    render();
  }, 20000);
  checkReminders();
}

start();
