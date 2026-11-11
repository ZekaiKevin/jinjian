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
const GHOST = CHECK.replace('class="pop"', 'class="ghost"'); // 悬停在圆圈上时预览的对勾
const STAR = '<svg class="star" width="14" height="14" viewBox="0 0 14 14" fill="currentColor" role="img" aria-label="重点"><path d="M7 1.2l1.8 3.7 4 .6-2.9 2.8.7 4L7 10.4l-3.6 1.9.7-4L1.2 5.5l4-.6z"/></svg>';
const CROSS = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';

const SWITCHES = [
  { k: 'blur', name: '背景模糊', tip: '关掉后玻璃里不再画模糊的壁纸，只留半透明的底色，更省资源。' },
  { k: 'lock', name: '鼠标穿透', tip: '开启后鼠标会穿过小组件，点到后面的桌面。\n按 Alt + L，或在托盘图标的菜单里关闭。' },
  { k: 'carry', name: '未完成顺延到明天', tip: '当天没勾掉的待办，第二天会自动出现在当天的列表里，不标逾期。' },
  { k: 'autostart', name: '开机自启' },
];
const TIP_CONNECT = '填 Apple ID 邮箱和“App 专用密码”（不是登录密码）。\n专用密码在 account.apple.com →“登录与安全”→“App 专用密码”里生成，保存在 Windows 凭据管理器里。';
const TIP_SYNC = '每 10 分钟同步一次，只同步打开的日历。\n重复日程（比如每周的课）和跨天日程在这里只读，请在 Apple 日历里改。\n其余日程可以直接改，包括提醒，会写回 iCloud。\n待办只存在本机。';

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

// 内容没变就不重写，免得每 20 秒刷新时打断悬停、点击和滚动
function setHtml(el, html) {
  if (el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}

function dayLabel(key) {
  const d = fromIso(key);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
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
  foldSync: null,   // 设置里 iCloud 区域是否展开；null 表示按默认（已连接就收起）
  hold: {},         // 刚勾掉的待办先在原位停一下再沉底：id → 到期时间
};
let R = [];           // 同步来的日程展开后的具体场次
let saveTimer = null;
const pushTimers = {};
const pushing = {};   // 正在上传的 iCloud 条目，避免同一条同时传两次

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
        const id = recurring || o.parts ? 'r|' + href + '|' + o.key : 'r|' + href;
        const extra = S.extras[id] || {};
        out.push({
          id: id, kind: 'event', remote: true, href: href, recurring: recurring, cal: res.cal, calName: cal.name, color: cal.color || '',
          date: o.date, start: o.start, end: o.end, allDay: o.allDay, title: o.title, place: o.place, notes: o.notes,
          remind: o.remind === null || o.remind === undefined ? 'none' : String(o.remind), subs: extra.subs || [], parts: o.parts || 0,
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
    Object.keys(S.remote.res).forEach((h) => {
      const mine = S.remote.res[h];
      if (!mine.dirty) return;
      if (!mine.etag && res[h]) mine.etag = res[h].etag;
      res[h] = mine;
    });
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
  if (pushing[href]) { pushing[href] = 'again'; return; }
  pushing[href] = true;
  const sent = res.ics;
  try {
    const r = await dav.put(user, href, sent, res.etag);
    const cur = S.remote.res[href] || res;
    if (r.ok) {
      cur.etag = r.etag || '';
      cur.dirty = cur.ics !== sent; // 上传途中又改过，留着下一轮再传
      setStatus('已保存到 iCloud');
      if (!r.etag && !cur.dirty) setTimeout(() => syncNow(false), 2000);
    } else if (r.status === 412) {
      cur.dirty = false;
      setStatus('iCloud 上有更新的版本，已重新同步');
      delete pushing[href];
      await syncNow(false);
    } else {
      setStatus('保存到 iCloud 失败（' + r.status + '）');
    }
  } catch (err) {
    setStatus(errText(err));
  }
  delete pushing[href];
  const after = S.remote.res[href];
  if (after && after.dirty && after.ics !== sent) pushSoon(href);
  save();
}

// 本机新建、指定要存到 iCloud 的日程：等详情关掉后再上传。
async function uploadPending() {
  const sync = S.settings.sync;
  if (!sync.on || !sync.user) return;
  const list = S.items.filter((it) => it.kind === 'event' && it.cal && (it.title || '').trim() && it.id !== S.sel && !it.uploading);
  if (!list.length) return;
  const sig = (x) => JSON.stringify([x.title, x.date, x.start, x.end, x.allDay, x.place, x.notes, x.remind]);
  for (const it of list) {
    it.uploading = true;
    const id = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : uid('u')).toUpperCase();
    const href = it.cal + id + '.ics';
    const ics = ICS.build(id, it);
    const before = sig(it);
    try {
      const r = await dav.put(sync.user, href, ics, null);
      if (r.ok) {
        const res = { etag: r.etag || '', ics: ics, cal: it.cal };
        S.remote.res[href] = res;
        if (sig(it) !== before) {
          // 上传途中用户又改了这一条：把改动补上去
          res.ics = ICS.patch(ics, Object.assign({}, it));
          res.dirty = true;
          pushSoon(href);
        }
        if (it.subs && it.subs.length) S.extras['r|' + href] = { subs: it.subs };
        S.items = S.items.filter((x) => x !== it);
        if (S.sel === it.id) S.sel = 'r|' + href; // 详情还开着就接着显示传上去的这条
        setStatus('已保存到 iCloud');
        if (!r.etag && !res.dirty) setTimeout(() => syncNow(false), 2000);
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

// 重复日程、跨天日程只能在 Apple 日历里改
const isLocked = (it) => !!it.remote && (!!it.recurring || !!it.parts);

function updateItem(it, p) {
  const rest = Object.assign({}, p);
  if (it.remote) {
    if ('subs' in rest) {
      S.extras[it.id] = Object.assign({}, S.extras[it.id], { subs: rest.subs });
      it.subs = rest.subs;
      delete rest.subs;
    }
    if (Object.keys(rest).length && !isLocked(it)) {
      Object.assign(it, rest);
      const res = S.remote.res[it.href];
      if (res) {
        const fields = Object.assign({}, it);
        if (!('remind' in rest)) delete fields.remind; // 没改提醒就不动原来的（可能有两条）
        res.ics = ICS.patch(res.ics, fields);
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
  if (open && !base.title) base.draft = true; // 点“+”新建、还没写东西：关掉时没填就删掉
  S.items.push(base);
  save();
  if (open) openDetail(base.id, true);
  else { render(); uploadPending(); }
  return base;
}

function leaveItem(id) {
  const it = S.items.find((x) => x.id === id);
  if (!it || !it.draft) return;
  const empty = !(it.title || '').trim() && !(it.place || '').trim() && !(it.notes || '').trim() && !(it.subs && it.subs.length);
  if (empty) S.items = S.items.filter((x) => x !== it);
  else delete it.draft;
  save();
}

function setSel(id) {
  const prev = S.sel;
  S.sel = id;
  if (prev && prev !== id) {
    leaveItem(prev);
    setTimeout(uploadPending, 0);
  }
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

// 没做完的在前（重点在最前，再按截止时间），做完的沉底；刚勾掉的先停一下
function orderTodos(list) {
  const now = Date.now();
  const done = (x) => (x.done && !(S.hold[x.id] > now) ? 1 : 0);
  return list
    .filter((it) => it.kind === 'todo')
    .map((x, i) => ({ x: x, i: i }))
    .sort((a, b) => done(a.x) - done(b.x)
      || (b.x.star ? 1 : 0) - (a.x.star ? 1 : 0)
      || (a.x.due || '99:99').localeCompare(b.x.due || '99:99')
      || a.i - b.i)
    .map((o) => o.x);
}

function phase(e) {
  const t = today();
  if (e.date < t) return 'past';
  if (e.date > t) return 'next';
  if (e.allDay) return 'allday';
  const s = toMin(e.start);
  let en = toMin(e.end);
  const n = nowMin();
  if (s === null) return 'none';
  if (en === null || en <= s) en = s + 60; // 结束早于开始时按一小时算
  if (en <= n) return 'past';
  if (s <= n) return 'now';
  return 'next';
}

// “正在进行 / 接下来”的那一条，小组件、迷你条、胶囊共用。
function nowInfo(map) {
  const list = map[today()] || [];
  const events = sortEvents(list);
  const active = events.find((e) => phase(e) === 'now');
  const next = events.find((e) => phase(e) === 'next');
  const allDay = events.filter((e) => e.allDay);
  const todos = orderTodos(list);
  const open = todos.filter((x) => !x.done);
  const n = nowMin();
  const range = (e) => e.start + (e.end ? ' – ' + e.end : '');
  const v = { id: '', label: todos.length ? '今天的待办都做完了' : '今天没有安排了', title: '', range: '', left: '', right: '', pct: 0, next: '', short: '', empty: true };
  if (active) {
    const s = toMin(active.start);
    let en = toMin(active.end);
    if (en !== null && en <= s) en = s + 60;
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
  } else if (allDay.length) {
    v.id = allDay[0].id;
    v.label = '全天';
    v.title = (allDay[0].title || '未命名') + (allDay.length > 1 ? ' 等 ' + allDay.length + ' 项' : '');
    v.left = allDay[0].place || '';
  } else if (open.length) {
    // 没有日程了，就看待办：重点或最早截止的那条
    const t = open[0];
    const done = todos.length - open.length;
    v.id = t.id;
    v.label = '待办';
    v.title = t.title || '未命名';
    v.range = t.due ? t.due + ' 截止' : '';
    v.left = open.length > 1 ? '还有 ' + (open.length - 1) + ' 件' : '';
    v.right = '已完成 ' + done + '/' + todos.length;
    v.short = t.due ? t.due : '';
    v.pct = Math.round((done / todos.length) * 100);
  }
  if (v.id) v.empty = false;
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
  setHtml($('pips'), pipsHtml(todos));
  $('count').textContent = todos.filter((x) => x.done).length + '/' + todos.length;

  $('now').hidden = !isToday;
  $('back-today').hidden = isToday;
  if (isToday) {
    $('now').dataset.id = info.id;
    $('now').classList.toggle('empty', info.empty);
    $('now').disabled = info.empty;
    $('now-label').textContent = info.label;
    $('now-title').textContent = info.title;
    $('now-range').textContent = info.range;
    $('now-left').textContent = info.left;
    $('now-right').textContent = info.right;
    $('now-bar').style.width = info.pct + '%';
  }

  setHtml($('events'), events.map((e) => {
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
  }).join(''));

  setHtml($('todos'), todos.map((t) => {
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
      + '<span class="box' + (fresh ? ' jelly' : '') + '">' + (t.done ? (fresh ? CHECK : CHECK_STILL) : GHOST) + '</span>'
      + '</button>'
      + '<button type="button" class="open grow tap" data-act="open" data-id="' + esc(t.id) + '">'
      + '<span class="name">' + esc(name) + '</span>'
      + '<span class="meta">' + esc(bits.join(' · ')) + '</span>'
      + '</button>'
      + '<button type="button" class="row-star tap" data-act="row-star" data-id="' + esc(t.id) + '" aria-pressed="' + (t.star ? 'true' : 'false') + '" aria-label="' + (t.star ? '取消重点：' : '设为重点：') + esc(name) + '">' + STAR.replace(' role="img" aria-label="重点"', ' aria-hidden="true"').replace('class="star"', 'class="star-ico"') + '</button>'
      + '</div>';
  }).join(''));
}

function renderCal(map, month) {
  const t = today();
  $('cal-title').textContent = S.vm.y + '年' + (S.vm.m + 1) + '月';
  setHtml($('cal-grid'), month.days.map((x) => {
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
  }).join(''));
}

function renderBig(map, month) {
  const t = today();
  const max = month.rows >= 6 ? 4 : 5;
  $('big-title').textContent = S.vm.y + '年' + (S.vm.m + 1) + '月';
  setHtml($('big-grid'), month.days.map((x) => {
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
  }).join(''));
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
    .concat(orderTodos(list).map((x) => '<div class="prow todo' + (x.done ? ' done' : '') + (x.id === S.sel ? ' sel' : '') + '">'
      + '<button type="button" class="pcheck tap" data-act="toggle" data-id="' + esc(x.id) + '" aria-pressed="' + (x.done ? 'true' : 'false') + '" aria-label="' + esc((x.done ? '标为未完成：' : '标为完成：') + (x.title || '未命名')) + '"><span class="mark"></span></button>'
      + '<button type="button" class="popen tap" data-act="open" data-id="' + esc(x.id) + '"><span class="pn ellipsis">' + esc(x.title || '未命名') + '</span>'
      + '<span class="ps ellipsis">' + esc(x.due ? '待办 · ' + x.due + ' 截止' : '待办') + '</span></button></div>'));
  setHtml($('pop-list'), rows.length ? rows.join('') : '<div class="pempty">没有安排</div>');

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
  $('c-title').textContent = info.title || info.label;
  $('c-bar').style.width = info.pct + '%';
  $('c-left').textContent = info.right;
  $('c-next').textContent = info.next;
  setHtml($('c-pips'), pipsHtml(todos));
  $('c-count').textContent = todos.filter((x) => x.done).length + '/' + todos.length;
  $('cap-title').textContent = info.title || info.label;
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
      + '<button type="button" class="sub-toggle tap" data-act="sub-toggle" data-id="' + esc(s.id) + '" aria-pressed="' + (s.done ? 'true' : 'false') + '" aria-label="' + esc((s.done ? '标为未完成：' : '标为完成：') + s.text) + '">'
      + '<span class="box small' + (fresh ? ' jelly' : '') + '">' + (s.done ? (fresh ? CHECK : CHECK_STILL) : '') + '</span>'
      + '</button>'
      + '<input class="sub-name" type="text" value="' + esc(s.text) + '" data-sub="' + esc(s.id) + '" aria-label="子任务" autocomplete="off">'
      + '<button type="button" class="icon sub-remove tap" data-act="sub-remove" data-id="' + esc(s.id) + '" aria-label="' + esc('删除子任务：' + s.text) + '">' + CROSS + '</button>'
      + '</div>';
  }).join('');
}

function fillPanel(it) {
  const isTodo = it.kind === 'todo';
  const locked = isLocked(it);
  const sync = S.settings.sync;
  const kind = $('p-kind');
  kind.textContent = isTodo ? '待办' : '日程';
  kind.disabled = !!it.remote;
  if (it.remote) kind.removeAttribute('data-tip');
  else kind.dataset.tip = isTodo ? '点一下改成日程' : '点一下改成待办';
  $('p-cal').textContent = it.remote ? it.calName : '';
  const pick = $('p-cal-pick');
  pick.hidden = !(!it.remote && !isTodo && sync.on && sync.cals.length);
  if (!pick.hidden) {
    pick.innerHTML = '<option value="">仅本机</option>' + sync.cals.map((c) => '<option value="' + esc(c.href) + '">' + esc(c.name) + '</option>').join('');
    pick.value = it.cal || '';
  }
  $('p-ro').hidden = !locked;
  $('p-ro').textContent = it.parts ? '跨天日程，请在 Apple 日历里修改' : '重复日程，请在 Apple 日历里修改';
  resetDelete();
  $('p-del').hidden = locked;
  $('p-allday').hidden = isTodo;
  $('p-allday').disabled = locked;
  $('p-allday').setAttribute('aria-pressed', it.allDay ? 'true' : 'false');
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
  remind.disabled = locked;
  $('p-done').setAttribute('aria-pressed', it.done ? 'true' : 'false');
  $('p-star').setAttribute('aria-pressed', it.star ? 'true' : 'false');
  renderSubs(it, null);
}

function openDetail(id, focusTitle) {
  const it = find(id);
  if (!it) return;
  setSel(id);
  S.panel = 'detail';
  S.pop = null;
  fillPanel(it);
  replay($('panel-body'), 'fade');
  render();
  if (focusTitle) setTimeout(() => $('p-title').focus(), 80);
}

function closePanels() {
  setSel(null);
  S.panel = '';
  render();
}

let delTimer = null;
function resetDelete() {
  clearTimeout(delTimer);
  const b = $('p-del');
  b.classList.remove('confirm');
  b.textContent = '删除';
}

// ---------- 底部提示条 ----------

let toastTimer = null;
let toastAction = null;

function showToast(text, actionText, action) {
  const toast = $('toast');
  $('toast-text').textContent = text;
  $('toast-btn').textContent = actionText || '';
  $('toast-btn').hidden = !actionText;
  toastAction = action || null;
  const r = $('shell').getBoundingClientRect();
  const w = toast.offsetWidth;
  toast.style.left = Math.round(r.left + (r.width - w) / 2) + 'px';
  toast.style.top = Math.round(r.bottom - 44 - (S.big || S.compact ? 16 : 78)) + 'px';
  toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4500);
  sendRectsSoon();
}

function hideToast() {
  clearTimeout(toastTimer);
  toastAction = null;
  $('toast').classList.remove('on');
  sendRectsSoon();
}

// ---------- 设置 ----------

function applySettings() {
  const s = S.settings;
  const light = s.theme === 'light' || (s.theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  root.dataset.theme = light ? 'light' : 'dark';
  root.style.setProperty('--tint', (s.tint / 100).toFixed(2));
  root.classList.toggle('no-blur', !s.blur);
  // 快速记录窗口和这里是同一个来源，读得到这条
  try { localStorage.setItem('jinjian-theme', root.dataset.theme); } catch (err) { /* 存不了就算了 */ }
  if (TAURI && TAURI.event && TAURI.event.emit) TAURI.event.emit('theme', root.dataset.theme).catch(() => {});
}

function helpHtml(tip) {
  return '<button type="button" class="help" data-tip="' + esc(tip) + '" aria-label="说明">?</button>';
}

// 一行开关：名字、可选的提示、开关本身（提示按钮不能套在开关按钮里，所以分开）。
function switchHtml(act, key, name, on, opt) {
  const o = opt || {};
  return '<div class="swrow">' + (o.before || '') + '<span class="name ellipsis">' + esc(name) + '</span>' + (o.tip ? helpHtml(o.tip) : '')
    + '<button type="button" class="sw" role="switch" data-act="' + act + '" data-k="' + esc(key) + '" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="' + esc(name) + '">'
    + '<span class="track"><span class="knob"></span></span></button></div>';
}

function applyFold() {
  const sync = S.settings.sync;
  const open = S.foldSync === null ? !sync.on : S.foldSync;
  $('s-sync').classList.toggle('open', open);
  $('s-fold').setAttribute('aria-expanded', open ? 'true' : 'false');
  $('s-fold-meta').textContent = sync.on ? sync.cals.filter((c) => c.on).length + ' 个日历' : '未连接';
  $('s-sync-help').dataset.tip = sync.on ? TIP_SYNC : TIP_CONNECT;
  return open;
}

function fillSettings() {
  const s = S.settings;
  Array.prototype.forEach.call($('s-theme').children, (b) => b.setAttribute('aria-pressed', b.dataset.v === s.theme ? 'true' : 'false'));
  Array.prototype.forEach.call($('s-layer').children, (b) => b.setAttribute('aria-pressed', (b.dataset.v === 'top') === !!s.top ? 'true' : 'false'));
  $('s-tint').value = s.tint;
  $('s-tint-text').textContent = s.tint + '%';
  $('s-switches').innerHTML = SWITCHES.map((x) => switchHtml('sw', x.k, x.name, x.k === 'lock' ? S.locked : !!s[x.k], { tip: x.tip })).join('');
  applyFold();
  const sync = s.sync;
  $('s-connect').hidden = sync.on;
  $('s-account').hidden = !sync.on;
  if (sync.on) {
    $('s-account-name').textContent = sync.user;
    $('s-cals').innerHTML = sync.cals.map((c) => switchHtml('cal-sw', c.href, c.name, c.on, { before: '<span class="swatch"' + color(c.color) + '></span>' })).join('');
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
    S.foldSync = true; // 刚连上，留着展开方便挑日历
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
  if ($('toast').classList.contains('on')) add($('toast'));
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
    if (it.kind === 'todo') {
      const due = toMin(it.due);
      const key = 'due|' + it.id;
      if (it.done || it.date !== t || due === null || S.notified.ids[key]) return;
      if (n >= due && n <= due + 10) {
        S.notified.ids[key] = 1;
        call('notify', { title: it.title || '待办', body: '到截止时间了 · ' + it.due }).catch(() => {});
        save();
      }
      return;
    }
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
    addItem('event', { title: p.title, date: p.date || today(), start: p.time || '', end: p.endTime || '' }, false);
  } else {
    addItem('todo', { title: p.title, date: p.date || today(), due: p.time || '' }, false);
  }
  render();
}

// ---------- 提示 ----------

let tipTimer = null;
let tipFor = null;
let tipMute = null; // 刚点过的按钮：鼠标离开之前不再弹它的名字

function showTip(el) {
  const text = el.dataset.tip;
  const tip = $('tip');
  if (!text || !el.isConnected) return;
  tipFor = el;
  tip.textContent = text;
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - 8) top = r.top - h - 8;
  tip.style.left = Math.round(left) + 'px';
  tip.style.top = Math.round(top) + 'px';
  tip.classList.add('on');
}

function hideTip() {
  clearTimeout(tipTimer);
  tipFor = null;
  $('tip').classList.remove('on');
}

// “?” 一碰就出；图标按钮停半秒才出名字，免得鼠标路过时到处闪。
function bindTips() {
  const stage = $('stage');
  stage.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el || el === tipFor || el === tipMute) return;
    clearTimeout(tipTimer);
    if (el.classList.contains('help')) showTip(el);
    else tipTimer = setTimeout(() => showTip(el), 550);
  });
  stage.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el && !el.contains(e.relatedTarget)) {
      hideTip();
      if (tipMute === el) tipMute = null;
    }
  });
  stage.addEventListener('focusin', (e) => { if (e.target.matches('.help:focus-visible')) showTip(e.target); });
  stage.addEventListener('focusout', (e) => { if (e.target.matches('.help')) hideTip(); });
  stage.addEventListener('click', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el && el.classList.contains('help')) { showTip(el); return; }
    hideTip();
    tipMute = el;
  });
  document.addEventListener('scroll', hideTip, true);
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
    case 'open':
      if (S.sel === id && S.panel === 'detail') { closePanels(); return; } // 再点一次同一条就收起
      openDetail(id, false);
      return;
    case 'now-open': if (t.dataset.id) openDetail(t.dataset.id, false); return;
    case 'toggle': {
      const it = find(id);
      if (!it) return;
      if (!it.done) {
        S.justDone = it.id;
        S.hold[it.id] = Date.now() + 900;
        setTimeout(render, 950);
      }
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
    case 'row-star': {
      const it = find(id);
      if (!it) return;
      updateItem(it, { star: !it.star });
      if (S.sel === it.id) $('p-star').setAttribute('aria-pressed', it.star ? 'true' : 'false');
      break;
    }
    case 'settings':
      setSel(null);
      S.panel = S.panel === 'settings' ? '' : 'settings';
      if (S.panel) fillSettings();
      break;
    case 's-close': case 'p-close': closePanels(); return;
    case 'compact': setSel(null); S.compact = 'card'; S.panel = ''; S.pop = null; break;
    case 'dock': S.compact = 'capsule'; break;
    case 'expand': S.compact = ''; break;
    case 'big-open': setSel(null); S.big = true; S.panel = ''; break;
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
    case 'pop-add-todo': addItem('todo', { date: S.pop || S.date }, true); return;
    case 'p-allday': {
      if (!cur || isLocked(cur)) return;
      const on = !cur.allDay;
      const p = { allDay: on };
      if (!on && !cur.start) { p.start = '09:00'; p.end = '10:00'; }
      updateItem(cur, p);
      fillPanel(cur);
      break;
    }
    case 'p-kind': {
      // 本机的日程和待办互相转换
      if (!cur || cur.remote) return;
      if (cur.kind === 'event') {
        Object.assign(cur, { kind: 'todo', due: cur.allDay ? '' : (cur.start || ''), done: false, star: false });
        delete cur.cal;
      } else {
        const st = cur.due || (cur.date === today() ? fromMin(Math.min(23 * 60, Math.ceil((nowMin() + 1) / 30) * 30)) : '09:00');
        Object.assign(cur, { kind: 'event', start: st, end: fromMin(Math.min(23 * 60 + 59, toMin(st) + 60)), allDay: false, remind: cur.remind && cur.remind !== 'none' ? cur.remind : '10' });
        const sync = S.settings.sync;
        if (sync.on && sync.target) cur.cal = sync.target;
      }
      delete cur.draft;
      save();
      fillPanel(cur);
      replay($('panel-body'), 'fade');
      break;
    }
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
    case 'p-del': {
      if (!cur) return;
      if (cur.remote) {
        // iCloud 上的日程删了就没了，要再点一次确认
        if (!t.classList.contains('confirm')) {
          t.classList.add('confirm');
          t.textContent = '再点一次，从 iCloud 删除';
          clearTimeout(delTimer);
          delTimer = setTimeout(resetDelete, 3000);
          return;
        }
        resetDelete();
        S.sel = null;
        S.panel = '';
        deleteItem(cur).then(render);
        break;
      }
      // 本机的直接删，底部给 4 秒撤销
      const index = S.items.indexOf(cur);
      const copy = Object.assign({}, cur);
      delete copy.draft;
      S.sel = null;
      S.panel = '';
      deleteItem(cur);
      if (copy.title || copy.notes || (copy.subs && copy.subs.length)) {
        showToast('已删除「' + (copy.title || '未命名') + '」', '撤销', () => {
          S.items.splice(Math.min(index, S.items.length), 0, copy);
          save();
          render();
        });
      }
      break;
    }
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
      t.setAttribute('aria-checked', S.settings[k] ? 'true' : 'false');
      if (k === 'autostart') call('set_autostart', { on: S.settings.autostart }).catch(() => {});
      if (k === 'carry') rollOver();
      applySettings();
      save();
      break;
    }
    case 'cal-sw': {
      const cal = S.settings.sync.cals.find((c) => c.href === t.dataset.k);
      if (!cal) return;
      cal.on = !cal.on;
      t.setAttribute('aria-checked', cal.on ? 'true' : 'false');
      save();
      applyFold();
      rebuildRemote();
      render();
      if (cal.on) syncNow(false);
      return;
    }
    case 'fold-sync': S.foldSync = !applyFold(); applyFold(); sendRectsSoon(); return;
    case 'sync-now': syncNow(true); return;
    case 'disconnect': disconnect(); return;
    default: return;
  }
  render();
}

function bind() {
  bindTips();
  $('stage').addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (t) { onAct(t.dataset.act, t); return; }
    // 月视图里点格子的空白处，也弹出这一天
    const cell = e.target.closest('#big-grid .cell');
    if (cell) onAct('pop-day', cell);
  });
  $('toast-btn').addEventListener('click', () => {
    const action = toastAction;
    hideToast();
    if (action) action();
  });

  // Esc 一层一层往回退：当天小窗口 → 详情/设置 → 月视图 → 折叠日历
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    if (S.pop) { S.pop = null; render(); return; }
    if (S.panel) { closePanels(); return; }
    if (S.big) { onAct('big-close', document.body); return; }
    if (S.mode === 'cal') { S.mode = 'day'; render(); return; }
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  });

  $('quick').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('quick-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    // 只写了时间没写日期，就落在当前看的那天；有具体时间的存成日程，其余存成待办
    const q = parseQuick(text, new Date());
    const date = q.date || S.date;
    if (q.time) addItem('event', { title: q.title || text, date: date, start: q.time, end: q.endTime || '' }, false);
    else addItem('todo', { title: q.title || text, date: date }, false);
    if (date !== S.date) {
      showToast('已添加到 ' + dayLabel(date), '去看看', () => {
        const d = fromIso(date);
        S.date = date;
        S.mode = 'day';
        S.vm = { y: d.getFullYear(), m: d.getMonth() };
        render();
      });
    }
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
  field('p-end', 'end');
  // 改开始时间时整段一起挪，时长不变
  $('p-start').addEventListener('input', (e) => {
    const it = find(S.sel);
    if (!it || !e.target.value) return;
    const s0 = toMin(it.start);
    const e0 = toMin(it.end);
    const s1 = toMin(e.target.value);
    const p = { start: e.target.value };
    if (s0 !== null && s1 !== null) {
      const dur = e0 !== null && e0 > s0 ? e0 - s0 : 60;
      p.end = fromMin(Math.min(23 * 60 + 59, s1 + dur));
      $('p-end').value = p.end;
    }
    updateItem(it, p);
    render();
  });
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

  // 单行输入框里回车：保存并关掉详情
  ['p-title', 'p-place', 'p-date', 'p-start', 'p-end', 'p-due'].forEach((id) => $(id).addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    e.target.blur();
    closePanels();
  }));

  $('p-cal-pick').addEventListener('change', (e) => {
    const it = find(S.sel);
    if (!it || it.remote) return;
    if (e.target.value) it.cal = e.target.value;
    else delete it.cal;
    save();
  });

  // 子任务的文字直接改
  $('p-subs').addEventListener('input', (e) => {
    const input = e.target.closest('.sub-name');
    const it = find(S.sel);
    if (!input || !it) return;
    updateItem(it, { subs: (it.subs || []).map((x) => (x.id === input.dataset.sub ? Object.assign({}, x, { text: input.value }) : x)) });
    render();
  });
  $('p-subs').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.target.closest('.sub-name')) { e.preventDefault(); e.target.blur(); }
  });

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
      const sw = document.querySelector('.sw[data-k="lock"]');
      if (sw) sw.setAttribute('aria-checked', S.locked ? 'true' : 'false');
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
    const cycle = async () => { await uploadPending(); await syncNow(false); };
    setTimeout(cycle, 2500);
    setInterval(cycle, 10 * 60 * 1000);
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
