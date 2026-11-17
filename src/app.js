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
  { k: 'carry', name: '未完成顺延到明天', tip: '当天没勾掉的待办，第二天会自动出现在当天的列表里，不标逾期。\n关掉后，今天的待办上方会提示之前还有几项没做完，可以一键移到今天。' },
  { k: 'lunar', name: '农历与节气', tip: '日期旁显示农历、节气和节日。' },
  { k: 'hol', name: '休 / 班角标', tip: '法定节假日标“休”，调休上班的日子标“班”。\n内置 2025–2027 年；之后的年份，把 holidays.json 放进数据目录就能补上。' },
  { k: 'autostart', name: '开机自启' },
  { k: 'edge', name: '贴边自动收起', tip: '平时滑到屏幕边上，只露一条细线；鼠标在那条边上停一下就滑出来，移开后自己收回去。\n按 Alt + W 可以随时把它叫到所有窗口前面，再按一次放回去。' },
];
let hotkeysTaken = []; // 没注册上的全局快捷键（被别的程序占了）
const TIP_MONTH = '点格子或日期数字：弹出这天的日程和待办。\n点某条日程：在旁边直接修改。\n左上角带圆圈的数字：这天没做完的待办。';
const TIP_WEEK = '拖日程到别的天或别的时间，15 分钟一格；拖日程的下边缘改结束时间。\n在空白处按住拖出一段：新建日程。\n待办可以拖到别的天。\n点某条日程：在旁边直接修改。';
const TIP_RO = '跨天日程，请在 Apple 日历里修改';
const TIP_CONNECT = '填 Apple ID 邮箱和“App 专用密码”（不是登录密码）。\n专用密码在 account.apple.com →“登录与安全”→“App 专用密码”里生成，保存在 Windows 凭据管理器里。';
const TIP_SYNC = '每 10 分钟同步一次，只同步打开的日历。\n日程可以直接改，包括提醒，会写回 iCloud。\n重复日程（比如每周的课）可以改、删其中一次，也可以改全部的标题、地点、备注、提醒；改全部的时间请在 Apple 日历里改。\n跨天日程在这里只读。\n待办和农历重复只存在本机。';

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
// 日历自带的颜色：--c 是颜色本身，--oc 是压在它上面的字该用白还是黑（按对比度挑，亮黄上不能再放白字）
function onColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const l = luminance([n >> 16, (n >> 8) & 255, n & 255]);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.058 ? '#ffffff' : '#1b1408';
}
const colorVars = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? ';--c:' + c + ';--oc:' + onColor(c) : '');
const color = (c) => (colorVars(c) ? ' style="' + colorVars(c).slice(1) + '"' : '');

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

// 农历、节气、节日、休班。关掉开关就当它们不存在；表外的年份（1900 年以前、2100 年以后）也是空的。
function lunarOf(key) {
  const d = fromIso(key);
  const i = Lunar.info(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return {
    sub: S.settings.lunar !== false ? i.sub : '',
    kind: i.kind,
    full: S.settings.lunar !== false ? i.lunar : '',
    hol: S.settings.hol !== false ? i.hol : '',
    name: i.festival || i.term,
  };
}
const holText = (h) => (h === 'off' ? '休' : h === 'work' ? '班' : '');
const lzHtml = (z) => (z.sub ? '<span class="lz ' + z.kind + '">' + esc(z.sub) + '</span>' : '');
const holHtml = (z) => (z.hol ? '<i class="hol ' + z.hol + '" aria-hidden="true">' + holText(z.hol) + '</i>' : '');
// 读屏和悬停提示用的完整说法：农历十月初七 · 立冬 · 休息日
function lunarSay(z) {
  const bits = [];
  if (z.full) bits.push('农历' + z.full);
  if (z.name && z.sub) bits.push(z.name);
  if (z.hol) bits.push(z.hol === 'off' ? '休息日' : '调休上班');
  return bits.join(' · ');
}

// ---------- 数据 ----------

function defaults() {
  return {
    theme: 'dark', palette: 'indigo', tint: 50, blur: true, carry: true, lunar: true, hol: true, autostart: false, top: false, edge: false,
    corner: 'tr', width: 372, // 停靠在屏幕哪个角（tl / tr / bl / br）、小组件多宽（320–480）
    fold: { ev: false, td: false, note: false }, // 日程、待办、便签各自是否折起来
    sync: { on: false, user: '', cals: [], target: '' },
  };
}

const S = {
  // 存盘的
  items: [],        // 本机的日程和待办，用 kind 区分
  note: '',         // 便签
  extras: {},       // 同步来的日程在本机附加的内容（子任务），按 id 存
  notified: { day: '', ids: {} },
  settings: defaults(),
  // iCloud 条目的本地缓存（0.9.0 起单独存成 remote_cache.json，不再放在 data.json 里）：
  //   res[地址] = { etag, ics, cal, dirty, sent }；cals[日历] = { ctag, token, win } 上次同步到哪；gone[地址] 本机删了、等着去 iCloud 删的
  remote: { res: {}, cals: {}, gone: {}, at: 0 },
  // 只在运行时用的
  mode: 'day',      // 小组件里显示“某一天”还是“折叠日历”
  big: false,       // 是否展开成月视图（月 / 周都算展开）
  week: false,      // 展开后看周还是看月；周以 S.date 所在的那一周为准（周日起）
  compact: '',      // ''、'card'（迷你条）、'capsule'（贴边胶囊）
  date: today(),    // 当前看的日期
  nav: false,       // 用“前一天 / 后一天”一路翻回今天时，那一排按钮先留着，方便接着翻
  prevMode: 'day',  // 打开月视图前是小组件还是折叠日历，收起时回去
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
  search: false,    // Ctrl + F 搜索层是否打开
  searchBack: null, // 打开搜索前的状态：迷你条 / 胶囊、当时的焦点，Esc 退回去用
  hold: {},         // 刚勾掉的待办先在原位停一下再沉底：id → 到期时间
  ask: null,        // 改 / 删重复条目时正在问范围：{ mode: 'edit' | 'del', id, patch, anchor }
  scopeMem: null,   // 这一场已经选过范围了：{ id, scope }，接着改就不再问
  cmd: false,       // Ctrl + K 快捷指令条是否打开
  side: false,      // 周视图里的待办栏是否展开
  imp: null,        // 设置里正在预览的导入：{ name, kind, data, plan, clash }
};
let R = [];           // 同步来的日程展开后的具体场次
let L = [];           // 本机重复条目展开后的场次（只展开画面上用得到的那些天），主条目本身不直接显示
let saveTimer = null;
const pushTimers = {};
const pushing = {};   // 正在上传的 iCloud 条目（上传排在队列里，一次只有一条在传）
const retries = {};   // 上传失败了几次，决定隔多久再试
const retryTimers = {};
const delTimers = {};
let remoteUids = {};  // 现在 iCloud 缓存里有哪些 UID
let remoteJson = '';  // 上次写进缓存文件的内容，没变就不重写
let migrating = false; // 这次启动是从旧版 data.json 里把 iCloud 缓存搬出来的

// 导入进来的条目带着原来的 UID；iCloud 缓存里已经有同一个 UID 时，本机这份不显示（免得连上 iCloud 后一条日程出现两次）
const shadowed = (it) => !!(it && it.uid && remoteUids[String(it.uid).split('#')[0]]);
const liveItems = () => (Object.keys(remoteUids).length ? S.items.filter((it) => !shadowed(it)) : S.items);
const plainItems = () => liveItems().filter((it) => !Recur.isRepeating(it));
const allItems = () => plainItems().concat(L, R);
const masterOf = (it) => (it && it.masterId ? S.items.find((x) => x.id === it.masterId) || null : it);
const find = (id) => S.items.find((x) => x.id === id && !Recur.isRepeating(x)) || R.find((x) => x.id === id) || Recur.get(S.items, id) || null;
const normCal = (h) => (h && h.charAt(h.length - 1) !== '/' ? h + '/' : h || '');
// 提醒：数字 0 是“到点提醒”，不能当成没设
const remindOf = (it) => (it.remind === undefined || it.remind === null || it.remind === '' ? 'none' : String(it.remind));

// 本机重复条目要展开的日子：今天前后（和 iCloud 一样，前 62 天到后 400 天）、正在看的月份、正在看的那天
function rebuildLocal() {
  const ranges = [];
  const add = (a, b) => ranges.push([a, b]);
  const t = today();
  add(Recur.addDays(t, -62), Recur.addDays(t, 400));
  if (S.vm) {
    const first = new Date(S.vm.y, S.vm.m, 1);
    add(iso(new Date(S.vm.y, S.vm.m, 1 - first.getDay())), iso(new Date(S.vm.y, S.vm.m, 1 - first.getDay() + 41)));
  }
  add(S.date, S.date);
  if (S.big && S.week) add(Week.weekStart(S.date), Week.addDays(Week.weekStart(S.date), 6));
  ranges.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const merged = [];
  ranges.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r[0] <= Recur.addDays(last[1], 1)) { if (r[1] > last[1]) last[1] = r[1]; } else merged.push(r.slice());
  });
  const seen = {};
  L = [];
  if (Recur.syncHol(S.items, Lunar.offDays())) save(); // “遇节假日跳过”的那几场跟着规则、休班表重算
  const src = liveItems();
  merged.forEach((r) => Recur.expand(src, r[0], r[1]).forEach((o) => { if (!seen[o.id]) { seen[o.id] = true; L.push(o); } }));
}

async function load() {
  let raw = '';
  let cache = '';
  try {
    raw = invoke ? await invoke('load_data') : (localStorage.getItem('jinjian') || '');
  } catch (err) {
    console.error('读取数据失败', err);
  }
  // iCloud 缓存单独一个文件；读不到（第一次用 0.9.0、文件坏了）就看旧版 data.json 里有没有，都没有就等下一次同步
  try {
    cache = invoke ? await invoke('load_remote_cache') : (localStorage.getItem('jinjian-remote') || '');
  } catch (err) {
    cache = '';
  }
  let d = null;
  try { d = raw ? JSON.parse(raw) : null; } catch (err) { console.error('数据文件解析失败', err); }
  let rc = null;
  try { rc = cache ? JSON.parse(cache) : null; } catch (err) { rc = null; }
  if (rc && rc.res) {
    S.remote = Sync.unpack(rc);
    remoteJson = JSON.stringify(Sync.pack(S.remote));
  } else if (d && d.remote && d.remote.res) {
    S.remote = Sync.unpack(d.remote);
    migrating = true;
  }
  if (!d) return;
  try {
    S.items = Recur.normalize(Array.isArray(d.items) ? d.items : []);
    S.items.forEach((it) => { delete it.uploading; if (it.cal) it.cal = normCal(it.cal); });
    S.note = typeof d.note === 'string' ? d.note : '';
    S.extras = d.extras && typeof d.extras === 'object' ? d.extras : {};
    if (d.notified && d.notified.ids) S.notified = d.notified;
    if (d.settings) {
      const base = defaults();
      S.settings = Object.assign(base, d.settings, {
        sync: Object.assign(base.sync, d.settings.sync || {}),
        fold: Object.assign(base.fold, d.settings.fold || {}),
      });
      const sync = S.settings.sync;
      sync.cals = (Array.isArray(sync.cals) ? sync.cals : []).map((c) => Object.assign({}, c, { href: normCal(c.href) }));
      sync.target = normCal(sync.target);
    }
  } catch (err) {
    console.error('数据文件解析失败', err);
  }
}

// iCloud 缓存写到它自己的文件里；内容没变不写
async function writeRemote() {
  const json = JSON.stringify(Sync.pack(S.remote));
  if (json === remoteJson) return;
  try {
    if (invoke) await invoke('save_remote_cache', { json: json });
    else localStorage.setItem('jinjian-remote', json);
    remoteJson = json;
  } catch (err) {
    console.error('保存 iCloud 缓存失败', err);
  }
}

// 立刻把当前状态写到磁盘。退出前也走这里。
async function writeNow() {
  clearTimeout(saveTimer);
  const json = JSON.stringify({
    version: 2,
    items: S.items.map((it) => { const c = Object.assign({}, it); delete c.uploading; return c; }),
    note: S.note,
    extras: S.extras,
    notified: S.notified,
    settings: S.settings,
  });
  // 平时先写数据再写缓存：刚传上去的日程万一只写成一半，宁可缓存里暂时没有（下次同步会拉回来），也不能本机和缓存各有一份。
  // 从旧版搬家的那一次反过来：先把缓存落盘，再从 data.json 里拿掉它。
  if (migrating) { await writeRemote(); migrating = remoteJson === ''; }
  try {
    if (invoke) await invoke('save_data', { json: json });
    else localStorage.setItem('jinjian', json);
  } catch (err) {
    console.error('保存失败', err);
  }
  await writeRemote();
  publishBusy();
}

// 快速记录窗口看不到主窗口的数据：把今天起两个月里“哪天哪段有日程”放在本机存储里，它用来提示时间冲突
function publishBusy() {
  try {
    const from = today();
    const to = Recur.addDays(from, 62);
    const out = {};
    allItems().forEach((it) => {
      if (it.kind !== 'event' || it.date < from || it.date > to || it.parts) return;
      const r = Week.rangeOf(it);
      if (r) (out[it.date] = out[it.date] || []).push([r.start, r.end, it.title || '未命名']);
    });
    localStorage.setItem('jinjian-busy', JSON.stringify(out));
  } catch (err) { /* 存不了就算了 */ }
}

// 改动多的时候合并成一次写盘
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 250);
}

// 没做完的待办不标逾期，直接顺延到今天。
function rollOver() {
  if (!S.settings.carry) return;
  const t = today();
  let moved = false;
  S.items.forEach((it) => {
    // 重复待办每一场单独算，没做完的那一场不往后带
    if (it.kind === 'todo' && !it.done && it.date < t && !Recur.isRepeating(it)) { it.date = t; moved = true; }
  });
  if (moved) save();
}

// ---------- 撤销 / 重做 ----------
// 每一次用户操作（新建、改、拖、勾、删、便签）记成一步：只记这一步前后变了的那几样（Undo.diff），iCloud 上的记 .ics 原文。
// 记法是把操作包在 record() 里：进去前拍一张、出来后拍一张，差出来的就是这一步。同步、上传、顺延这些程序自己做的事不包，不进历史。

const H = Undo.create(100);
let txDepth = 0;
let txRes = null;     // 这一步里碰过的 iCloud 条目：地址 → 碰之前的样子（JSON 文本，null 是当时没有）
const moved = {};     // 本机日程传到 iCloud 以后：原来的 id → { href, uid }。撤销它传上去之前的改动时，要改的是 iCloud 上那一条

const resState = (href) => { const r = S.remote.res[href]; return r ? JSON.stringify({ ics: r.ics, cal: r.cal }) : null; };
// 要改 / 删 / 新建某条 iCloud 日程之前先喊一声，这一步才记得住它原来的样子
function touchRes(href) {
  if (txDepth && txRes && !(href in txRes)) txRes[href] = resState(href);
}

function record(label, key, fn, hold) {
  if (txDepth) return fn();
  txDepth = 1;
  txRes = {};
  const before = Undo.snap(S.items, S.note, S.extras);
  try {
    return fn();
  } finally {
    txDepth = 0;
    const changes = Undo.diff(before, Undo.snap(S.items, S.note, S.extras));
    Object.keys(txRes).forEach((h) => { const after = resState(h); if (after !== txRes[h]) changes.push({ t: 'res', id: h, before: txRes[h], after: after }); });
    txRes = null;
    if (changes.length) H.push({ label: label, key: key || '', hold: !!hold, at: Date.now(), changes: changes });
  }
}

// 两份日历原文说的是不是同一回事（服务器可能把换行、属性顺序整理过，不能逐字比）
function sameIcs(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const norm = (text) => {
    try {
      return JSON.stringify(ICS.parse(text).map((e) => [e.uid, e.rid ? ICS.toDate(e.rid).getTime() : 0, ICS.toDate(e.start).getTime(), ICS.durationMin(e), e.title, e.place, e.notes, e.rruleText || '',
        e.exdates.map((x) => ICS.toDate(x).getTime()).sort(), e.status, e.alarm]).sort());
    } catch (err) { return text; }
  };
  return norm(a) === norm(b);
}

// 撤销 / 重做把一条本机条目恢复成 json 的样子（null 是没有这一条）
function restoreItem(id, json, index) {
  const st = json ? JSON.parse(json) : null;
  const mv = moved[id];
  if (mv) {
    if (st && st.kind === 'event' && st.cal && canCloud(st)) {
      // 它已经传到 iCloud 了：把 iCloud 上那一条改成当时的样子
      const cur = S.remote.res[mv.href];
      const series = Recur.isRepeating(st) ? Recur.forUpload(st, localTz()) : null;
      const ics = Recur.isRepeating(st) ? (series ? ICS.buildSeries(mv.uid, series) : '') : (cur ? ICS.patch(cur.ics, st) : ICS.build(mv.uid, st));
      if (ics) putRes(mv.href, { ics: ics, cal: st.cal });
      return;
    }
    // 当时还没有它（撤销的是“新建”），或者当时只存本机：iCloud 上那一条拿掉
    dropRes(mv.href);
    if (!st) return;
    delete moved[id];
  }
  const i = S.items.findIndex((x) => x.id === id);
  if (!st) { if (i >= 0) S.items.splice(i, 1); return; }
  if (i >= 0) { if (S.items[i].draft) st.draft = true; S.items[i] = st; } else S.items.splice(Math.min(index || 0, S.items.length), 0, st);
}

function applyHistory(e, isUndo) {
  const list = isUndo ? e.changes.slice().reverse() : e.changes;
  // iCloud 上的那几条要还是这一步留下的样子才动；别处（手机、Apple 日历）又改过的不去盖它
  const stale = list.some((c) => {
    if (c.t !== 'res') return false;
    const want = isUndo ? c.after : c.before;
    const cur = resState(c.id);
    if (cur === want) return false;
    if (!cur || !want) return !(S.remote.gone[c.id] && !want); // 本来就该没有、现在正等着删：算对得上
    return !sameIcs(JSON.parse(cur).ics, JSON.parse(want).ics);
  });
  if (stale) return false;
  list.forEach((c) => {
    const to = isUndo ? c.before : c.after;
    if (c.t === 'item') restoreItem(c.id, to, c.index);
    else if (c.t === 'note') { S.note = to || ''; $('note').value = S.note; }
    else if (c.t === 'extra') { if (to === null) delete S.extras[c.id]; else S.extras[c.id] = JSON.parse(to); }
    else if (c.t === 'res') putRes(c.id, to ? JSON.parse(to) : null);
  });
  S.ask = null;
  S.scopeMem = null;
  rebuildRemote();
  rebuildLocal();
  if (S.sel && !find(S.sel)) { S.sel = null; if (S.panel === 'detail') S.panel = ''; }
  else if (S.sel && S.panel === 'detail') fillPanel(find(S.sel));
  save();
  render();
  setTimeout(uploadPending, 0);
  return true;
}

function undo() {
  if (drag || sizing) return;
  flushFields();
  const e = H.undo();
  if (!e) return;
  if (!applyHistory(e, true)) { H.restore(e, true); showToast('别处改过，撤销不了'); return; }
  showToast('已撤销' + (e.label ? ' · ' + e.label : ''), '重做', redo);
}

function redo() {
  if (drag || sizing) return;
  flushFields();
  const e = H.redo();
  if (!e) return;
  if (!applyHistory(e, false)) { H.restore(e, false); showToast('别处改过，重做不了'); return; }
  showToast('已重做' + (e.label ? ' · ' + e.label : ''), '撤销', undo);
}

// 删除后底部那条提示上的“撤销”：只在这一步还是最后一步时才管用
function undoToast(text) {
  const mark = H.peek();
  showToast(text, '撤销', () => { if (mark && H.peek() === mark) undo(); });
}

// ---------- iCloud 同步 ----------
// 0.9.0：所有和 iCloud 打交道的事（拉取、上传改动、上传新建、删除）排成一队（Sync.queue），一个做完再做下一个。
// 以前拉取到一半时上传恰好完成，拉回来的旧结果会把刚记下的新版本号盖掉；排队以后不会了。
// do 开头的是真正干活的（只在队列里跑）；不带 do 的是给别处调用的，负责排队。

const Q = Sync.queue();

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
  const uids = {};
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
      evs.forEach((e) => { if (e.uid) uids[e.uid] = true; });
      const recurring = evs.some((e) => e.rrule);
      const skipHol = !!(S.extras['s|' + href] && S.extras['s|' + href].skipHol);
      ICS.expand(evs, range[0], range[1]).forEach((o) => {
        // 重复日程的每一场按“原来那一场”记 id：单独改过时间也不变（0.7.0 按改后的时间记，那几场的附加内容照样认）
        const id = o.parts ? 'r|' + href + '|' + o.key : recurring ? 'r|' + href + '|' + o.ridKey : 'r|' + href;
        const legacy = recurring && !o.parts && o.ridKey !== o.key ? 'r|' + href + '|' + o.key : '';
        if (legacy && S.extras[legacy] && !S.extras[id]) { S.extras[id] = S.extras[legacy]; delete S.extras[legacy]; }
        const extra = S.extras[id] || {};
        out.push({
          id: id, kind: 'event', remote: true, href: href, recurring: recurring, rid: o.rid, cal: res.cal, calName: cal.name, color: cal.color || '',
          date: o.date, start: o.start, end: o.end, allDay: o.allDay, title: o.title, place: o.place, notes: o.notes,
          remind: o.remind === null || o.remind === undefined ? 'none' : String(o.remind), subs: extra.subs || [], parts: o.parts || 0, countdown: !!extra.countdown, skipHol: recurring && skipHol,
        });
      });
    });
  }
  R = out;
  remoteUids = uids;
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

// 拉取。每个日历先问一句“变了没有”（ctag / sync-token）：没变跳过，变了只拉变化，
// 第一次、过了一天（时间窗口挪了）、token 过期（403 / 410）、手动点“同步”时整个重拉。
async function doSync(rediscover) {
  const sync = S.settings.sync;
  if (!sync.on || !sync.user) return;
  S.syncing = true;
  setStatus('正在同步…');
  let clean = true;
  try {
    if (rediscover || !sync.cals.length) {
      const old = {};
      sync.cals.forEach((c) => { old[c.href] = c; });
      const found = (await dav.discover(sync.user, null)).map((c) => Object.assign({}, c, { href: normCal(c.href) }));
      sync.cals = found.map((c) => Object.assign({ on: old[c.href] ? old[c.href].on : true }, c));
      if (sync.target && !sync.cals.some((c) => c.href === sync.target)) sync.target = '';
    }
    const range = syncWindow();
    const win = iso(range[0]);
    const on = {};
    sync.cals.forEach((c) => { if (c.on) on[c.href] = true; });
    // 关掉的、已经不在的日历：缓存里不留（本机改了还没传的除外）
    Object.keys(S.remote.res).forEach((h) => { const r = S.remote.res[h]; if (!on[r.cal] && !r.dirty) delete S.remote.res[h]; });
    Object.keys(S.remote.cals).forEach((c) => { if (!on[c]) delete S.remote.cals[c]; });
    for (const cal of sync.cals) {
      if (!cal.on) continue;
      let now = { ctag: '', token: '' };
      try { now = await dav.state(sync.user, cal.href); } catch (err) { if (err && err.message === 'auth') throw err; }
      const st = S.remote.cals[cal.href] || null;
      let mode = rediscover ? 'full' : Sync.decide(st, now, win);
      if (mode === 'skip') continue;
      if (mode === 'delta') {
        const d = await dav.changes(sync.user, cal.href, st.token);
        if (d.ok) {
          const got = d.changed.length ? await dav.multiget(sync.user, cal.href, d.changed.map((x) => x.href)) : [];
          S.remote.res = Sync.mergeDelta(S.remote.res, cal.href, got, d.removed, S.remote.gone);
          S.remote.cals[cal.href] = { ctag: now.ctag, token: d.token || now.token, win: win };
        } else {
          delete S.remote.cals[cal.href]; // token 过期或服务器不认：清掉，这一轮整个重拉
          mode = 'full';
        }
      }
      if (mode === 'full') {
        const list = await dav.fetchCalendar(sync.user, cal.href, range[0], range[1]);
        S.remote.res = Sync.mergeFull(S.remote.res, cal.href, list, S.remote.gone);
        S.remote.cals[cal.href] = { ctag: now.ctag, token: now.token, win: win };
      }
    }
    S.remote.at = Date.now();
    const d = new Date();
    setStatus('上次同步 ' + pad(d.getHours()) + ':' + pad(d.getMinutes()));
  } catch (err) {
    clean = false;
    setStatus(errText(err));
  }
  S.syncing = false;
  rebuildRemote();
  if (clean) pruneExtras();
  if (syncRemoteHol()) rebuildRemote();
  save();
  if (S.panel === 'settings') fillSettings();
  render();
}

function syncNow(rediscover) {
  const sync = S.settings.sync;
  // 已经在拉了：这一次不另排（和 0.8.x 一样）；手动点“同步”（重新找日历）的照样排在后面
  if (!sync.on || !sync.user || (S.syncing && !rediscover)) return Promise.resolve();
  return Q.run('sync', () => doSync(!!rediscover), rediscover ? 'sync!' : 'sync');
}

// 挂在 iCloud 日程上的本机附加内容：那条日程已经不在缓存里了（别处删了、日历关了），附加内容也不留
function pruneExtras() {
  let changed = false;
  Object.keys(S.extras).forEach((k) => {
    const m = /^(?:r|s)\|([^|]+)/.exec(k);
    if (!m || S.remote.res[m[1]] || S.remote.gone[m[1]]) return;
    delete S.extras[k];
    changed = true;
  });
  return changed;
}

function pushSoon(href) {
  clearTimeout(pushTimers[href]);
  pushTimers[href] = setTimeout(() => pushRes(href), 1500);
}

// 上传失败（断网、服务器出错）：隔 5 秒、30 秒、2 分钟、之后每 10 分钟再试
function retryPush(href) {
  const n = (retries[href] = (retries[href] || 0) + 1);
  clearTimeout(retryTimers[href]);
  retryTimers[href] = setTimeout(() => pushRes(href), Sync.backoff(n) * 1000);
}

// 所有改过还没传上去的、删了还没去 iCloud 删的，排队处理
function pushPending() {
  Object.keys(S.remote.res).forEach((h) => { if (S.remote.res[h].dirty && !pushing[h]) pushSoon(h); });
  Object.keys(S.remote.gone).forEach((h) => delSoon(h));
}

const pushRes = (href) => Q.run('push', () => doPush(href), 'push|' + href);

// 把本机改过的一条日程传回 iCloud。
async function doPush(href) {
  const res = S.remote.res[href];
  const user = S.settings.sync.user;
  if (!res || !res.dirty || !user) return;
  pushing[href] = true;
  clearTimeout(retryTimers[href]);
  const sent = res.ics;
  let failed = false;
  try {
    // 上一次上传后服务器没给新版本号（iCloud 有时不给）、或者这是本机刚建的一条：先问一下服务器上现在是哪个版本。
    // 不问的话这次会被当成“新建”发出去，服务器说“已经有了”，这次修改就丢了。
    let etag = res.etag;
    let isNew = false;
    if (!etag) {
      const e = await dav.etagOf(user, href);
      if (e.status === 404) isNew = true;
      else if (e.status >= 300) throw new Error('HTTP ' + e.status);
      else etag = e.etag;
    }
    const r = await dav.put(user, href, sent, etag, isNew);
    const cur = S.remote.res[href];
    if (!cur) {
      // 上传途中这一条在本机被删了：等着删的那条记下新的版本号，删的时候才对得上
      if (r.ok && S.remote.gone[href]) S.remote.gone[href].etag = r.etag || '';
    } else if (r.ok) {
      cur.etag = r.etag || '';
      cur.sent = sent;
      cur.dirty = cur.ics !== sent; // 上传途中又改过（或者撤销了），留着下一轮再传
      delete retries[href];
      setStatus('已保存到 iCloud');
      if (!r.etag && !cur.dirty) setTimeout(() => syncNow(false), 2000);
    } else if (r.status === 412) {
      cur.dirty = false;
      delete S.remote.cals[cur.cal]; // 别处改过：这个日历整个重拉一次，拿服务器上的为准
      setStatus('iCloud 上有更新的版本，已重新同步');
      delete pushing[href];
      await doSync(false);
    } else {
      failed = true;
      setStatus('保存到 iCloud 失败（' + r.status + '），稍后会再试');
    }
  } catch (err) {
    failed = true;
    setStatus(errText(err));
  }
  delete pushing[href];
  const after = S.remote.res[href];
  if (after && after.dirty) {
    if (failed) retryPush(href);
    else if (after.ics !== sent) pushSoon(href);
  }
  save();
}

// 删一条 iCloud 日程：本机立刻拿掉，过一会儿（DEL_GRACE）才真的去 iCloud 删。这期间撤销，就当没删过，一个请求都不用发。
function dropRes(href) {
  const res = S.remote.res[href];
  if (!res) return;
  clearTimeout(pushTimers[href]);
  clearTimeout(retryTimers[href]);
  delete retries[href];
  S.remote.gone[href] = { etag: res.etag || '', ics: res.sent !== undefined ? res.sent : res.ics, cal: res.cal, was: res, fresh: !res.etag && res.sent === undefined };
  delete S.remote.res[href];
  delSoon(href);
}

// 删除先等一会儿再真的去删：和底部“已删除 · 撤销”的提示条一样长，这期间撤销就什么请求都不用发。
// 等的时候退出也不丢：等着删的记在缓存文件里（S.remote.gone），下次启动 pushPending() 接着删。
const DEL_GRACE = 5000;
function delSoon(href, wait) {
  clearTimeout(delTimers[href]);
  delTimers[href] = setTimeout(() => Q.run('delete', () => doDelete(href), 'del|' + href), wait || DEL_GRACE);
}

async function doDelete(href) {
  const g = S.remote.gone[href];
  const user = S.settings.sync.user;
  if (!g || !user) return;
  g.busy = true;
  try {
    const r = await dav.remove(user, href, g.etag || '');
    if (r.ok) {
      delete S.remote.gone[href];
      setStatus('已从 iCloud 删除');
    } else if (r.status === 412) {
      // 别处改过这一条：不删了，把服务器上的拉回来
      delete S.remote.gone[href];
      delete S.remote.cals[g.cal];
      setStatus('iCloud 上有更新的版本，已重新同步');
      await doSync(false);
    } else {
      g.busy = false;
      g.tries = (g.tries || 0) + 1;
      setStatus('删除失败（' + r.status + '），稍后会再试');
      delSoon(href, Sync.backoff(g.tries) * 1000);
    }
  } catch (err) {
    g.busy = false;
    g.tries = (g.tries || 0) + 1;
    setStatus(errText(err));
    delSoon(href, Sync.backoff(g.tries) * 1000);
  }
  save();
}

// 撤销 / 重做把 iCloud 上的一条恢复成 st（{ ics, cal }；null 是没有这一条）。
//   还没来得及传的改动：恢复后和服务器上的一样，直接撤回那次上传；
//   已经传了的：标成待上传，排队把原来的那份传回去（反向 PUT）；
//   删了还没去 iCloud 删的：撤回那次删除；已经删了的：重新建回来。
function putRes(href, st) {
  if (!st) { dropRes(href); return; }
  let res = S.remote.res[href];
  if (!res) {
    const g = S.remote.gone[href];
    if (g && !g.busy) {
      clearTimeout(delTimers[href]);
      delete S.remote.gone[href];
      res = g.was || (g.fresh ? { etag: '', ics: g.ics, cal: g.cal, dirty: true } : { etag: g.etag, ics: g.ics, cal: g.cal, sent: g.ics });
    } else {
      res = { etag: '', ics: st.ics, cal: st.cal, dirty: true };
    }
    S.remote.res[href] = res;
  }
  res.ics = st.ics;
  if (st.cal) res.cal = st.cal;
  res.dirty = Sync.dirtyAfter(res, st.ics);
  if (res.dirty) pushSoon(href);
  else if (!pushing[href]) { clearTimeout(pushTimers[href]); clearTimeout(retryTimers[href]); delete retries[href]; }
}

// 挂在这条 iCloud 日程（和它每一场）上的本机附加内容
function dropExtras(href) {
  Object.keys(S.extras).forEach((k) => { if (k === 'r|' + href || k === 's|' + href || k.indexOf('r|' + href + '|') === 0) delete S.extras[k]; });
}

// iCloud 的重复日程开了“遇节假日跳过”：落在放假日的那几场写成 EXDATE（记下是哪几场，关掉时好拿回来）。
// 程序自己维护的，不进撤销历史；返回有没有改动。
function syncRemoteHol() {
  const off = {};
  Lunar.offDays().forEach((k) => { off[k] = true; });
  let changed = false;
  Object.keys(S.extras).forEach((k) => {
    const x = S.extras[k];
    if (k.indexOf('s|') !== 0 || !x || !x.skipHol) return;
    const href = k.slice(2);
    const res = S.remote.res[href];
    if (!res) return;
    R.filter((o) => o.href === href && o.recurring && !o.parts && o.rid && off[o.date]).forEach((o) => {
      const ms = ICS.toDate(o.rid).getTime();
      res.ics = ICS.exclude(res.ics, o.rid);
      x.holEx = (x.holEx || []).filter((v) => v !== ms).concat([ms]);
      res.dirty = true;
      changed = true;
    });
    if (res.dirty) pushSoon(href);
  });
  return changed;
}

// 开 / 关 iCloud 重复日程的“遇节假日跳过”
function setRemoteHol(it, on) {
  const key = 's|' + it.href;
  const res = S.remote.res[it.href];
  if (!res) return;
  record(on ? '节假日跳过' : '取消节假日跳过', '', () => {
    touchRes(it.href);
    if (on) {
      S.extras[key] = Object.assign({}, S.extras[key], { skipHol: true });
      syncRemoteHol();
    } else {
      const x = S.extras[key] || {};
      (x.holEx || []).forEach((ms) => {
        const d = new Date(ms);
        res.ics = ICS.include(res.ics, { allDay: false, utc: true, tz: '', wall: { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() } });
      });
      if ((x.holEx || []).length) { res.dirty = true; pushSoon(it.href); }
      delete S.extras[key];
    }
    rebuildRemote();
  });
  save();
}

const uploadPending = () => Q.run('upload', doUpload, 'upload');

// 本机新建、指定要存到 iCloud 的日程：等详情关掉后再上传。排在队列里，同一时间只会有一个在跑（防重入）。
async function doUpload() {
  const sync = S.settings.sync;
  if (!sync.on || !sync.user) return;
  // 详情还开着的那一条（重复日程是它的某一场开着）先不传
  const open = (it) => S.sel === it.id || (typeof S.sel === 'string' && S.sel.indexOf(it.id + '@') === 0);
  const list = S.items.filter((it) => it.kind === 'event' && it.cal && (it.title || '').trim() && !open(it) && !it.uploading && !shadowed(it) && canCloud(it));
  if (!list.length) return;
  const sig = (x) => JSON.stringify([x.title, x.date, x.start, x.end, x.allDay, x.place, x.notes, x.remind, x.rrule, x.exdates, x.overrides, x.holEx]);
  // 重复日程整份写（RRULE / EXDATE / RECURRENCE-ID），不重复的照旧
  const text = (id, it) => (Recur.isRepeating(it) ? (Recur.forUpload(it, localTz()) ? ICS.buildSeries(id, Recur.forUpload(it, localTz())) : '') : ICS.build(id, it));
  for (const it of list) {
    if (S.items.indexOf(it) < 0 || it.uploading || !it.cal) continue; // 排队的这会儿被删了、改成只存本机了
    const cal = it.cal;
    const id = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : uid('u')).toUpperCase();
    const href = normCal(cal) + id + '.ics';
    const ics = text(id, it);
    if (!ics) continue;
    it.uploading = true;
    const series = Recur.isRepeating(it);
    const before = sig(it);
    try {
      const r = await dav.put(sync.user, href, ics, '', true);
      if (r.ok && (S.items.indexOf(it) < 0 || it.kind !== 'event' || it.cal !== cal)) {
        // 上传途中这一条被删了（或者撤销了新建）、改成了待办、或者换了日历：服务器上这份不该留着
        it.uploading = false;
        await dav.remove(sync.user, href, r.etag || '').catch(() => {});
      } else if (r.ok) {
        const res = { etag: r.etag || '', ics: ics, cal: it.cal, sent: ics };
        S.remote.res[href] = res;
        if (sig(it) !== before) {
          // 上传途中用户又改了这一条：把改动补上去
          res.ics = series ? text(id, it) || ics : ICS.patch(ics, Object.assign({}, it));
          res.dirty = true;
          pushSoon(href);
        }
        const carry = {};
        if (it.subs && it.subs.length) carry.subs = it.subs;
        if (it.countdown) carry.countdown = true;
        // 重复日程：子任务和倒数日标记挂到下一场上（iCloud 的重复日程每一场单独记）
        const nx = series ? Recur.next(it, today(), false) : null;
        const rid = nx ? 'r|' + href + '|' + nx.occ.replace(/-/g, '') + (it.allDay ? '' : (it.start || '09:00').replace(':', '')) : 'r|' + href;
        if (Object.keys(carry).length && (!series || nx)) S.extras[rid] = carry;
        // “遇节假日跳过”跟着过去：已经写成 EXDATE 的那几场记下来，关掉时好拿回来
        if (series && it.skipHol) S.extras['s|' + href] = { skipHol: true, holEx: (it.holEx || []).map((k) => fromIso(k).setHours.apply(fromIso(k), it.allDay ? [0, 0, 0, 0] : (it.start || '09:00').split(':').map(Number).concat([0, 0]))) };
        moved[it.id] = { href: href, uid: id };
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

// 跨天日程只能在 Apple 日历里改
const isLocked = (it) => Week.locked(it);
// 重复系列里的一场：本机的（'local'）或 iCloud 的（'remote'），改它要先问范围
const seriesOf = (it) => (!it ? '' : it.masterId ? 'local' : it.remote && it.recurring && !it.parts ? 'remote' : '');
const TIME_KEYS = ['date', 'start', 'end', 'allDay'];
const hasTime = (p) => TIME_KEYS.some((k) => k in p);

// 本机的时区：重复日程传到 iCloud 时按它写；有夏令时的时区不传（写出来的时区定义只有一段，跨夏令时会错一小时）
function localTz() {
  let id = '';
  try { id = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (err) { id = ''; }
  const y = new Date().getFullYear();
  const fixed = new Date(y, 0, 1).getTimezoneOffset() === new Date(y, 6, 1).getTimezoneOffset();
  return id && fixed ? { id: id, offsetMin: -new Date().getTimezoneOffset() } : null;
}
// 这条本机日程能不能传到 iCloud：农历重复、待办、有夏令时的时区里的重复日程不行
const canCloud = (m) => !!m && m.kind === 'event' && !(Recur.isRepeating(m) && (m.lunar || !localTz()));

// iCloud 重复日程的主事件现在的标题、地点、备注
function seriesText(res) {
  let evs = [];
  try { evs = ICS.parse(res.ics); } catch (err) { evs = []; }
  const m = evs.find((e) => !e.rid) || evs[0] || {};
  return { title: m.title || '', place: m.place || '', notes: m.notes || '', start: m.start || null };
}

// 这一步在历史里叫什么、和前一步并不并
function editLabel(it, p) {
  const name = '「' + (it.title || p.title || '未命名') + '」';
  if ('done' in p && Object.keys(p).length === 1) return (p.done ? '完成' : '取消完成') + name;
  if (hasTime(p) && !('title' in p)) return '改期' + name;
  return '修改' + name;
}
const draftOf = (it) => { const m = it.masterId ? masterOf(it) : it; return m && m.draft ? m : null; };

// iCloud 重复日程里这一场要改成的样子，和它现在的样子（给 ICS.shiftSeries / splitSeries）
function seriesArgs(it, patch) {
  const cur = Object.assign({}, it, patch);
  const f = { title: cur.title, date: cur.date, start: cur.start, end: cur.end, allDay: !!cur.allDay, place: cur.place, notes: cur.notes };
  if (patch && 'remind' in patch) f.remind = patch.remind;
  return { f: f, cur: cur, opt: { from: { date: it.date, start: it.start, end: it.end, allDay: !!it.allDay }, tz: localTz() } };
}

// 整组改过时间以后每一场的 id 都变了（id 是按原来的开始时间记的）：把挂在旧 id 上的子任务、倒数日挪到新 id 上，返回正在改的这一场的新 id。
// olds：改之前这个系列的 id（按先后），其中第 i0 个是正在改的这一场；href：改完后它们在哪个地址下；cur：这一场改完的样子。
function rekeySeries(olds, i0, href, cur) {
  const news = R.filter((x) => x.href === href && x.recurring && !x.parts).map((x) => x.id).sort();
  const me = R.find((x) => x.href === href && x.recurring && !x.parts && x.date === cur.date && (cur.allDay ? x.allDay : x.start === cur.start));
  const at = me ? news.indexOf(me.id) : -1;
  if (at < 0) return '';
  let touched = false;
  olds.forEach((old, k) => {
    const id = news[at + k - i0];
    if (!id || id === old || !S.extras[old]) return;
    S.extras[id] = S.extras[old];
    delete S.extras[old];
    touched = true;
  });
  if (touched) rebuildRemote();
  return me.id;
}

// iCloud 的重复日程：仅此次 → 单独一块（RECURRENCE-ID）；全部 → 改主事件（文字、时间、全天）；此次及以后 → 原系列截断，另开一个新系列
function updateRemoteSeries(it, rest, scope) {
  const res = S.remote.res[it.href];
  if (!res || !it.rid) return;
  touchRes(it.href);
  const a = seriesArgs(it, rest);
  const olds = R.filter((x) => x.href === it.href && x.recurring && !x.parts).map((x) => x.id).sort();
  const i0 = Math.max(0, olds.indexOf(it.id));
  const texty = ['title', 'place', 'notes', 'remind'].some((k) => k in rest);
  let sc = scope || 'one';
  let split = null;
  if (sc === 'future') {
    const id = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : uid('u')).toUpperCase();
    split = ICS.splitSeries(res.ics, it.rid, a.f, Object.assign({ uid: id }, a.opt));
    if (!split) return; // 做不了的（按钮本来就是灰的）
    if (split.whole) sc = 'all'; else split.href = normCal(res.cal) + id + '.ics';
  }
  let href = it.href;
  if (sc === 'all') {
    let text = res.ics;
    if (texty) {
      const old = seriesText(res);
      const f = { title: 'title' in rest ? rest.title : old.title, place: 'place' in rest ? rest.place : old.place, notes: 'notes' in rest ? rest.notes : old.notes };
      if ('remind' in rest) f.remind = rest.remind;
      text = ICS.patchSeries(text, f, old);
    }
    if (hasTime(rest)) text = ICS.shiftSeries(text, it.rid, a.f, a.opt) || text;
    res.ics = text;
  } else if (sc === 'future') {
    res.ics = split.head;
    href = split.href;
    touchRes(href);
    S.remote.res[href] = { etag: '', ics: split.tail, cal: res.cal, dirty: true };
    if (S.extras['s|' + it.href]) S.extras['s|' + href] = { skipHol: true, holEx: [] };
    pushSoon(href);
  } else {
    res.ics = ICS.setOccurrence(res.ics, it.rid, a.f);
  }
  res.dirty = true;
  pushSoon(it.href);
  Object.assign(it, rest);
  rebuildRemote();
  if (sc === 'one') return;
  const now = sc === 'future' ? rekeySeries(olds.slice(i0), 0, href, a.cur) : rekeySeries(olds, i0, href, a.cur);
  if (now && now !== it.id && S.sel === it.id) {
    S.sel = now;
    if (S.scopeMem) S.scopeMem.id = now;
  }
}

// scope 只对重复条目的某一场有用：'one' / 'future' / 'all'（完成状态、重点、倒数日、类型不看范围）
function updateItem(it, p, scope) {
  const d = draftOf(it);
  const key = d ? 'new:' + d.id : 'edit:' + it.id + ':' + Object.keys(p).sort().join(',');
  record(editLabel(it, p), key, () => updateItem0(it, p, scope), !!d);
  save();
}

function updateItem0(it, p, scope) {
  const rest = Object.assign({}, p);
  if (it.masterId) {
    const r = Recur.edit(S.items, it.id, rest, scope || 'one', () => uid(it.kind === 'event' ? 'e' : 't'));
    S.items = r.items;
    Object.assign(it, rest); // 手里这份也跟上，下次 find 会重新拼
    if (S.sel === it.id && r.sel !== it.id) {
      S.sel = r.sel;
      if (S.scopeMem) S.scopeMem.id = r.sel;
    }
    return;
  }
  if (it.remote) {
    if ('subs' in rest) {
      S.extras[it.id] = Object.assign({}, S.extras[it.id], { subs: rest.subs });
      it.subs = rest.subs;
      delete rest.subs;
    }
    if ('countdown' in rest) {
      // 倒数日标记只存在本机，不写进 iCloud
      const extra = Object.assign({}, S.extras[it.id]);
      if (rest.countdown) extra.countdown = true; else delete extra.countdown;
      S.extras[it.id] = extra;
      it.countdown = !!rest.countdown;
      delete rest.countdown;
    }
    if (Object.keys(rest).length && !isLocked(it) && seriesOf(it) === 'remote') {
      updateRemoteSeries(it, rest, scope);
    } else if (Object.keys(rest).length && !isLocked(it)) {
      Object.assign(it, rest);
      const res = S.remote.res[it.href];
      if (res) {
        touchRes(it.href);
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
}

// 删一条。iCloud 上的也是本机先拿掉、稍后去删（dropRes），所以和本机的一样可以撤销。
function deleteItem(it) {
  record('删除「' + (it.title || '未命名') + '」', '', () => {
    if (!it.remote) {
      S.items = S.items.filter((x) => x.id !== it.id);
      return;
    }
    touchRes(it.href);
    dropRes(it.href);
    dropExtras(it.href);
    rebuildRemote();
  });
  save();
  return Promise.resolve();
}

function addItem(kind, fields, open) {
  const date = (fields && fields.date) || S.date;
  const base = Object.assign({ id: uid(kind === 'event' ? 'e' : 't'), kind: kind, date: date, title: '', place: '', notes: '', subs: [] }, fields || {});
  if (kind === 'event') {
    if (!base.start && !base.allDay) {
      const start = date === today() ? Math.min(23 * 60, Math.ceil((nowMin() + 1) / 30) * 30) : 9 * 60;
      base.start = fromMin(start);
    }
    if (!base.end && !base.allDay) base.end = fromMin(Math.min(23 * 60 + 59, toMin(base.start) + 60));
    if (!base.remind) base.remind = '10';
    const sync = S.settings.sync;
    if (sync.on && sync.target) base.cal = sync.target;
    if (base.cal && !canCloud(base)) delete base.cal;
  } else {
    base.done = false;
    base.star = false;
    if (!base.due) base.due = '';
  }
  if (!base.rrule) { delete base.rrule; delete base.lunar; }
  if (open && !base.title) base.draft = true; // 点“+”新建、还没写东西：关掉时没填就删掉
  // 新建和接下来在详情里填的内容算一步，撤销一次就整条没了
  record('新建' + (kind === 'event' ? '日程' : '待办') + (base.title ? '「' + base.title + '」' : ''), 'new:' + base.id, () => { S.items.push(base); }, !!base.draft);
  save();
  if (open) openDetail(base.id, true);
  else { render(); uploadPending(); }
  return base;
}

function leaveItem(id) {
  const v = Recur.parseVid(id);
  const it = S.items.find((x) => x.id === id) || (v ? S.items.find((x) => x.id === v.masterId) : null);
  if (!it || !it.draft) return;
  const empty = !(it.title || '').trim() && !(it.place || '').trim() && !(it.notes || '').trim() && !(it.subs && it.subs.length);
  if (empty) {
    S.items = S.items.filter((x) => x !== it);
    H.forget((c) => c.t === 'item' && c.id === it.id); // 什么都没写就关掉：历史里也不留这一条
  } else delete it.draft;
  save();
}

function setSel(id) {
  const prev = S.sel;
  if (prev !== id) flushFields(); // 还压着没写进去的输入（轻防抖）先落下
  S.sel = id;
  if (prev !== id) { S.ask = null; S.scopeMem = null; H.seal(); }
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
  const v = { id: '', label: todos.length ? '今天的待办都做完了' : '今天没有安排了', title: '', range: '', left: '', right: '', pct: 0, bar: false, next: '', short: '', empty: true };
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
    v.bar = en !== null && en > s;
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
    v.bar = true;
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
  const z = lunarOf(S.date);
  $('date-btn').classList.toggle('lz-on', !!z.sub);
  $('h-lz').hidden = !z.sub;
  $('h-lz').textContent = z.sub;
  $('h-lz').className = 'lz ' + z.kind;
  $('h-hol').hidden = !z.hol;
  $('h-hol').textContent = holText(z.hol);
  $('h-hol').className = 'hol ' + z.hol;
  const say = lunarSay(z);
  $('date-btn').dataset.tip = (say ? say + '\n' : '') + '点日期打开日历';
  $('date-btn').setAttribute('aria-label', '日历，' + (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WK.charAt(d.getDay()) + (say ? '，' + say : ''));
  $('b-view').setAttribute('aria-pressed', S.mode === 'cal' ? 'true' : 'false');
  $('b-settings').setAttribute('aria-pressed', S.panel === 'settings' ? 'true' : 'false');
  $('b-lock').setAttribute('aria-pressed', S.locked ? 'true' : 'false');
  $('b-lock').dataset.tip = S.locked ? '鼠标穿透中（Alt + L 解除）' : '鼠标穿透（Alt + L）';
  root.classList.toggle('locked', !!S.locked);
  $('day-step').hidden = S.mode === 'cal';
}

function renderDay(map, info) {
  const list = map[S.date] || [];
  const events = sortEvents(list);
  const todos = orderTodos(list);
  const isToday = S.date === today();

  $('pips-row').hidden = todos.length === 0;
  setHtml($('pips'), pipsHtml(todos));
  $('count').textContent = todos.filter((x) => x.done).length + '/' + todos.length;

  const fold = S.settings.fold;
  [['ev', 'sec-ev'], ['td', 'sec-td'], ['note', 'sec-note']].forEach((x) => {
    const sec = $(x[1]);
    sec.classList.toggle('folded', !!fold[x[0]]);
    sec.querySelector('[data-act="fold"]').setAttribute('aria-expanded', fold[x[0]] ? 'false' : 'true');
  });
  $('note-wrap').classList.toggle('open', !fold.note);
  // 折起来以后，标题旁边留一个数，便签留第一行
  $('ev-meta').textContent = fold.ev && events.length ? String(events.length) : '';
  $('td-meta').textContent = fold.td && todos.length ? todos.filter((x) => x.done).length + '/' + todos.length : '';
  $('note-peek').textContent = (S.note.split('\n').find((l) => l.trim()) || '').trim();

  $('now').hidden = !isToday;
  $('day-nav').hidden = isToday && !S.nav;
  $('nav-today').setAttribute('aria-pressed', isToday ? 'true' : 'false');
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
    $('now').classList.toggle('nobar', !info.bar); // 没有进度可言（接下来 / 全天）：不留一条空的
  }

  // 时间重叠的日程：圆点换成一个小记号，悬停说和谁撞了
  const busy = dayBusy(S.date, map);
  const clash = Slots.conflicts(busy);
  const titleOf = (id) => (busy.find((x) => x.id === id) || {}).title || '';
  // 今天下一个空档（后面还有日程时才显示；整天都空着就不用提示了）：点一下在那里新建
  let gap = null;
  if (isToday && busy.some((x) => x.end > nowMin())) gap = Slots.nextFree(busy, nowMin(), 23 * 60, 30, Week.STEP);
  const free = $('ev-free');
  free.hidden = !gap || !!fold.ev;
  if (gap) {
    free.textContent = '空档 ' + Week.fromMin(gap.start) + '–' + Week.fromMin(gap.end);
    free.dataset.s = Week.fromMin(gap.start);
    free.dataset.e = Week.fromMin(Math.min(gap.end, gap.start + 60));
    free.setAttribute('aria-label', '今天下一个空档 ' + Week.fromMin(gap.start) + ' 到 ' + Week.fromMin(gap.end) + '，点一下在这里新建日程');
  }
  setHtml($('events'), events.map((e) => {
    const ph = phase(e);
    const cls = ['ev', 'tap'];
    if (ph === 'past') cls.push('past');
    if (ph === 'now') cls.push('now-on');
    if (e.id === S.sel) cls.push('sel');
    const hit = clash[e.id];
    if (hit) cls.push('clash');
    return '<button type="button" class="' + cls.join(' ') + '" data-act="open" data-id="' + esc(e.id) + '"' + color(e.color) + (hit ? ' data-tip="' + esc('与「' + titleOf(hit[0]) + '」' + (hit.length > 1 ? '等 ' + hit.length + ' 项' : '') + '时间重叠') + '"' : '') + '>'
      + '<span class="t">' + esc(e.allDay ? '全天' : (e.start || '--:--')) + '</span>'
      + '<span class="dot"></span>'
      + '<span class="n">' + esc(e.title || '未命名') + '</span>'
      + '<span class="p">' + esc(e.place || '') + '</span>'
      + '</button>';
  }).join(''));

  let overdue = '';
  if (isToday && !S.settings.carry) {
    const n = plainItems().filter((x) => x.kind === 'todo' && !x.done && x.date < S.date).length;
    if (n) overdue = '<div class="overdue"><span class="grow">' + n + ' 项之前没做完</span><button type="button" class="pill mini tap" data-act="carry-now">移到今天</button></div>';
  }
  setHtml($('todos'), overdue + todos.map((t) => {
    const subs = t.subs || [];
    const bits = [];
    if (t.due) bits.push(Week.spanOf(t) ? t.due + '–' + t.end : t.due);
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

// 顶部倒数日：最近的三个，“距 X 还有 N 天”。没有就整条隐藏，不占位置也不写字。
function renderCountdowns() {
  // 重复的只看下一场（待办这一场做完了就看再下一场）
  const t = today();
  const next = S.items.filter((m) => m.countdown && Recur.isRepeating(m)).map((m) => Recur.next(m, t, m.kind === 'todo')).filter(Boolean);
  const list = Countdown.pick(plainItems().concat(R, next), t);
  $('countdowns').hidden = list.length === 0;
  setHtml($('countdowns'), list.map((c) => '<button type="button" class="cd tap" data-act="cd" data-id="' + esc(c.id) + '" aria-label="' + esc(c.label) + '">'
    + (c.lead ? '<span class="cd-lead">' + esc(c.lead) + '</span>' : '')
    + '<span class="cd-title">' + esc(c.title) + '</span><span class="cd-tail">' + esc(c.tail) + '</span></button>').join(''));
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
    const z = lunarOf(x.key);
    const say = lunarSay(z);
    const label = (x.d.getMonth() + 1) + '月' + x.d.getDate() + '日，' + (say ? say + '，' : '') + evN + ' 个日程，' + tdN + ' 个待办';
    return '<button type="button" class="' + cls.join(' ') + '" data-act="pick-day" data-date="' + x.key + '" aria-label="' + label + '">'
      + '<span>' + x.d.getDate() + '</span>'
      + lzHtml(z) + holHtml(z)
      + '<span class="dots">' + (evN >= 1 ? '<i class="e"></i>' : '') + (evN >= 2 ? '<i class="e"></i>' : '') + (tdN >= 1 ? '<i class="t"></i>' : '') + '</span>'
      + '</button>';
  }).join(''));
}

function renderBig(map, month) {
  const wk = S.week;
  $('week').hidden = !wk;
  $('month-days').hidden = wk;
  $('month-wrap').hidden = wk;
  $('big').setAttribute('aria-label', wk ? '周视图' : '月视图');
  $('big-title').textContent = wk ? Week.rangeTitle(S.date) : S.vm.y + '年' + (S.vm.m + 1) + '月';
  $('big-prev').setAttribute('aria-label', wk ? '上一周' : '上个月');
  $('big-next').setAttribute('aria-label', wk ? '下一周' : '下个月');
  $('big-close').setAttribute('aria-label', wk ? '收起周视图' : '收起月视图');
  $('big-close').dataset.tip = wk ? '收起周视图' : '收起月视图';
  $('big-help').dataset.tip = wk ? TIP_WEEK : TIP_MONTH;
  $('big-v-month').setAttribute('aria-pressed', wk ? 'false' : 'true');
  $('big-v-week').setAttribute('aria-pressed', wk ? 'true' : 'false');
  $('big-side').hidden = !wk;
  $('big-side').setAttribute('aria-pressed', S.side ? 'true' : 'false');
  if (wk) return;
  const t = today();
  // 一格里放得下几条：按外壳的高度算（矮屏幕上展开的月视图没有 640 高），不写死 4 / 5
  const gridH = bigSize()[1] - 128; // 上下留白 40 + 标题行 44 + 星期行 20 + 三处间距 24
  const cellH = (gridH - (month.rows - 1) * 4) / month.rows;
  const max = Math.max(1, Math.floor((cellH - 24) / 14));
  setHtml($('big-grid'), month.days.map((x) => {
    const list = map[x.key] || [];
    const events = sortEvents(list);
    const tdN = list.filter((it) => it.kind === 'todo' && !it.done).length;
    const shown = events.length > max ? events.slice(0, max - 1) : events;
    const cls = ['cell'];
    if (x.out) cls.push('out');
    if (x.key === S.date) cls.push('sel');
    const z = lunarOf(x.key);
    const say = lunarSay(z);
    const label = (x.d.getMonth() + 1) + '月' + x.d.getDate() + '日，' + (say ? say + '，' : '') + events.length + ' 个日程，' + tdN + ' 个待办';
    let html = '<div class="' + cls.join(' ') + '" data-date="' + x.key + '">'
      + '<div class="cell-head">'
      + holHtml(z)
      + '<span class="badge">' + (tdN ? '<i role="img" aria-label="未完成待办"></i><span>' + tdN + '</span>' : '') + '</span>'
      + lzHtml(z)
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

// ---------- 周视图 ----------
// 七列（周日起）加时间轴，顶部一行放全天、跨天和没写时间的。排版和拖动的计算都在 week.js，这里只管画和接线。
// 拖动的接线在后面“周视图：拖动”一节。

const WV = { key: '', sel: null, set: 0 }; // 现在画的是哪一周、上一次选中的是谁、上一次自动滚到的位置

// 正在问范围的那一项，先按还没定下来的改动来画：拖到哪就画在哪，选了范围才算数，不选就弹回去
const viewOf = (it) => (S.ask && S.ask.mode === 'edit' && S.ask.id === it.id ? Object.assign({}, it, S.ask.patch) : it);
const blockOf = (id, zone) => Array.prototype.find.call(document.querySelectorAll('#week .wk-it'), (el) => el.dataset.id === id && (!zone || el.dataset.zone === zone)) || null;
const num2 = (n) => String(Math.round(n * 100) / 100);
const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; }; // 没变就不碰，拖的时候每一下移动都会来

function chipHtml(it, zone) {
  const todo = it.kind === 'todo';
  const title = it.title || '未命名';
  const cls = ['wk-it', 'wk-chip'];
  if (todo) cls.push('todo');
  if (it.done) cls.push('done');
  if (it.id === S.sel) cls.push('sel');
  if (isLocked(it)) cls.push('wk-ro');
  const side = zone === 'side';
  const d = fromIso(it.date);
  const when = todo ? (it.due ? '，' + it.due + ' 截止' : '') : (it.allDay ? '，全天' : it.start ? '，' + it.start : '');
  return '<button type="button" class="' + cls.join(' ') + '" data-act="open" data-id="' + esc(it.id) + '" data-zone="' + (zone || 'allday') + '" data-date="' + it.date + '"' + color(it.color)
    + ' aria-label="' + esc((todo ? '待办：' : '') + title + when) + '">'
    + (todo ? '<i class="wk-o"></i><span class="n">' + esc(title) + '</span>' + (side ? '<span class="t">' + (d.getMonth() + 1) + '/' + d.getDate() + '</span>' : '')
      : '<i class="bar"></i><span class="n">' + esc(title) + '</span><span class="t">' + esc(it.allDay ? '' : it.start || '') + '</span>')
    + '</button>';
}

function weekColHtml(c, t) {
  const rs = c.timed.map((e) => ({ e: e, r: Week.spanOf(e) }));
  const lay = Week.layout(rs.map((x) => ({ id: x.e.id, start: x.r.start, end: x.r.end })));
  // 时间重叠的打一个小记号（并排排开已经看得出来，记号是给读屏和窄列看的）
  const clash = Slots.conflicts(rs.filter((x) => !x.e.done).map((x) => ({ id: x.e.id, start: x.r.start, end: x.r.end })));
  let html = '<div class="week-col' + (c.key === t ? ' today' : '') + '" data-date="' + c.key + '">';
  rs.forEach((x) => {
    const e = x.e;
    const todo = e.kind === 'todo';
    const p = Week.place(x.r, lay[e.id]);
    const tall = p.height >= 38;
    const ln = Math.max(1, Math.min(4, Math.floor((p.height - (tall ? 20 : 4)) / 14)));
    const time = Week.fromMin(x.r.start) + '–' + (x.r.end >= 1440 ? '24:00' : Week.fromMin(x.r.end));
    const shown = todo ? time : e.start + (e.end ? '–' + e.end : '');
    const hit = clash[e.id] ? clash[e.id].map((id) => (rs.find((y) => y.e.id === id).e.title || '未命名')) : null;
    html += '<button type="button" class="wk-it wk-ev' + (todo ? ' todo' : '') + (e.done ? ' done' : '') + (tall ? '' : ' short') + (hit ? ' clash' : '') + (e.id === S.sel ? ' sel' : '') + '" data-act="open" data-id="' + esc(e.id) + '" data-zone="time" data-date="' + c.key + '"'
      + ' style="top:' + num2(p.top) + 'px;height:' + num2(p.height) + 'px;left:calc(' + num2(p.left) + '% + 1px);width:calc(' + num2(p.width) + '% - 2px);--ln:' + ln + colorVars(e.color) + '"'
      + ' aria-label="' + esc((todo ? '待办：' : '') + (e.title || '未命名') + '，' + shown + (hit ? '，与' + hit.join('、') + '重叠' : '')) + '">'
      + (todo ? '<span class="wk-chk" role="checkbox" aria-checked="' + (e.done ? 'true' : 'false') + '" aria-label="' + (e.done ? '标为未完成' : '标为完成') + '" data-act="toggle" data-id="' + esc(e.id) + '"><i class="wk-o"></i></span>' : '')
      + '<span class="wk-t">' + esc(e.title || '未命名') + '</span><span class="wk-time">' + esc(shown) + '</span>' + (hit ? '<i class="wk-clash" aria-hidden="true"></i>' : '') + '<span class="wk-grip"></span></button>';
  });
  // 只有截止时刻的待办：时间轴上的小标记，靠列的右边，几个挤在一起就并排
  const ms = c.marks.map((m) => ({ m: m, s: Week.toMin(m.due) }));
  const ml = Week.layout(ms.map((x) => ({ id: x.m.id, start: x.s, end: x.s + 20 })));
  ms.forEach((x) => {
    const m = x.m;
    const l = ml[m.id];
    html += '<button type="button" class="wk-it wk-mark' + (m.done ? ' done' : '') + (m.id === S.sel ? ' sel' : '') + '" data-act="open" data-id="' + esc(m.id) + '" data-zone="mark" data-date="' + c.key + '"'
      + ' style="top:' + num2(Week.minToY(x.s)) + 'px;left:calc(38% + ' + num2((l.col / l.cols) * 62) + '%);width:calc(' + num2(62 / l.cols) + '% - 1px)"'
      + ' aria-label="' + esc('待办：' + (m.title || '未命名') + '，' + m.due + ' 截止') + '"><i class="wk-o"></i><span class="wk-tt">' + esc(m.title || '未命名') + '</span></button>';
  });
  if (c.key === t) html += '<div class="wk-now" style="top:' + num2(Week.minToY(nowMin())) + 'px"></div>';
  return html + '</div>';
}

// 重画前后各量一次每一块的位置，位置变了的从原来的地方滑过去（取消、弹回、同一时段的几块重新排开都走这里）
function weekRects() {
  const out = {};
  document.querySelectorAll('#week .wk-it').forEach((el) => { const r = el.getBoundingClientRect(); out[el.dataset.zone + '|' + el.dataset.id] = [r.left, r.top]; });
  return out;
}

function weekFlip(before) {
  const moved = [];
  document.querySelectorAll('#week .wk-it').forEach((el) => {
    const b = before[el.dataset.zone + '|' + el.dataset.id];
    if (!b) return;
    const r = el.getBoundingClientRect();
    const dx = b[0] - r.left;
    const dy = b[1] - r.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    moved.push(el);
  });
  if (!moved.length) return;
  void document.body.offsetWidth;
  moved.forEach((el) => { el.classList.add('settling'); el.style.transform = ''; });
  setTimeout(() => moved.forEach((el) => el.classList.remove('settling')), 320);
}

// 打开 / 换到另一周时自动滚：本周有今天看现在，否则看选中那天的第一个日程，再没有看这一周最早的
function weekScroll(cols, keys) {
  const body = $('week-body');
  const starts = (c) => c.timed.map((e) => Week.rangeOf(e).start);
  const today0 = keys.indexOf(today()) >= 0 ? nowMin() : null;
  const day = cols[Math.max(0, keys.indexOf(S.date))];
  const mine = starts(day);
  const all = [].concat.apply([], cols.map(starts));
  const first = mine.length ? Math.min.apply(null, mine) : all.length ? Math.min.apply(null, all) : null;
  body.scrollTop = Week.scrollTop({ now: today0, first: first, hourPx: Week.HOUR_PX });
  WV.set = body.scrollTop;
}

function renderWeek() {
  if (!(S.big && S.week)) {
    if (drag) cancelDrag();
    WV.key = '';
    return;
  }
  // 按下之后到松手之前不重画（20 秒一次的刷新、同步完成都会走到这里），松手后补一次；拖着翻周的那一下除外
  if (drag && !drag.flipping) { drag.stale = true; return; }
  const keys = Week.weekKeys(S.date);
  const t = today();
  const cols = keys.map((k) => ({ key: k, timed: [], marks: [], top: [] }));
  const side = [];
  allItems().map(viewOf).forEach((it) => {
    // 待办栏：还没做、没排进时间轴的待办，这一周和之前的都在
    if (S.side && it.kind === 'todo' && !it.done && !Week.spanOf(it) && it.date <= keys[6]) side.push(it);
    if (it.date < keys[0] || it.date > keys[6]) return;
    const c = cols[keys.indexOf(it.date)];
    if (!c) return;
    if (it.kind === 'event') {
      if (!it.parts && Week.rangeOf(it)) c.timed.push(it); else c.top.push(it); // 全天、没写时间、跨天的放顶部
    } else if (Week.spanOf(it)) c.timed.push(it); // 排成时间块的待办
    else if (Week.toMin(it.due) !== null) c.marks.push(it);
    else c.top.push(it);
  });

  const head = '<div></div>' + cols.map((c) => {
    const d = fromIso(c.key);
    const z = lunarOf(c.key);
    const say = lunarSay(z);
    const evN = c.timed.filter((x) => x.kind === 'event').length + c.top.filter((x) => x.kind === 'event').length;
    const tdN = c.marks.concat(c.top, c.timed).filter((x) => x.kind === 'todo' && !x.done).length;
    const label = (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WK.charAt(d.getDay()) + '，' + (say ? say + '，' : '') + evN + ' 个日程，' + tdN + ' 个待办';
    return '<button type="button" class="wk-day tap' + (c.key === t ? ' today' : '') + (c.key === S.date ? ' sel' : '') + '" data-act="week-day" data-date="' + c.key + '" aria-label="' + esc(label) + '">'
      + '<span class="wk-r1"><span>周' + WK.charAt(d.getDay()) + '</span>' + holHtml(z) + '</span>'
      + '<span class="wk-r2"><span class="wk-num">' + d.getDate() + '</span>' + lzHtml(z) + '</span></button>';
  }).join('');

  const top = '<div class="wk-lab">全天</div>' + cols.map((c) => {
    const evs = sortEvents(c.top);
    const tds = orderTodos(c.top);
    return '<div class="wk-ad' + (c.key === t ? ' today' : '') + '" data-date="' + c.key + '">' + evs.concat(tds).map((x) => chipHtml(x)).join('') + '</div>';
  }).join('');

  let hours = '<div class="wk-hours">';
  for (let h = 1; h < 24; h += 1) hours += '<span class="wk-hr" style="top:' + h * Week.HOUR_PX + 'px">' + pad(h) + ':00</span>';
  const body = hours + '</div>' + cols.map((c) => weekColHtml(c, t)).join('');

  $('week').classList.toggle('with-side', S.side);
  $('week-side').hidden = !S.side;
  if (S.side) {
    side.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : (y.star ? 1 : 0) - (x.star ? 1 : 0)));
    setHtml($('week-side-list'), side.slice(0, 60).map((x) => chipHtml(x, 'side')).join('') || '<div class="pempty">没有待办</div>');
  }

  const fresh = WV.key !== keys[0];
  const changed = $('week-head')._html !== head || $('week-allday')._html !== top || $('week-inner')._html !== body;
  const before = changed && !fresh ? weekRects() : null;
  setHtml($('week-head'), head);
  setHtml($('week-allday'), top);
  setHtml($('week-inner'), body);
  if (before) weekFlip(before);
  if (fresh) {
    WV.key = keys[0];
    if (!drag) {
      weekScroll(cols, keys);
      // 刚展开时外壳还在变高，量到的可视高度不是最后的，等动画走完再对一次（期间没被手动滚过才对）
      setTimeout(() => { if (!drag && WV.key === keys[0] && Math.abs($('week-body').scrollTop - WV.set) <= 2) weekScroll(cols, keys); }, 580);
    }
  }
  if (S.sel !== WV.sel) {
    WV.sel = S.sel;
    const el = S.sel ? $('week-inner').querySelector('.wk-it.sel') : null;
    if (el) {
      // 刚选中的那一块不在可视范围里：滚到中间
      const b = $('week-body');
      const br = b.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.top < br.top || r.bottom > br.bottom) b.scrollTop += r.top - br.top - (br.height - r.height) / 2;
    }
  }
}

// ---------- 周视图：拖动 ----------
// 按下 → 挪过 4 像素才算拖起来（没拖起来就是普通的点击）→ 整块用 transform 跟着指针走，一格一格吸附，不重画 → 松手。
// 松手后的改动走和详情里一样的 change()：重复日程问“仅此次 / 此次及以后 / 全部”，iCloud 的走原来的上传和重试。
// 计算（挪到哪、拉到哪、能不能挪）都在 week.js；这里只量指针、动一块的 transform、把结果交给 change()。
// 0.9.0：
//   · 顶部一行的待办 / 全天日程、待办栏里的待办可以拖进时间轴（待办变成时间块，全天日程变成有时间的）；时间轴上的可以拖回顶部一行；
//   · 指针停在左右边上不动，过一会儿翻到上一周 / 下一周，拖着的那一块跟过去（期间指针一直抓着、外壳一直保持可点击）。

let drag = null;          // { op: 'move' | 'resize' | 'create', el, id, zone, pid, x0, y0, ... }
let swallowClick = false; // 拖完松手时浏览器还会补一个 click，吞掉它，免得又“点开”了一次
let holdTimer = null;
const DRAG_PX = 4;
const EDGE_WAIT = 650;    // 指针在边上停多久翻周

// 告诉 Rust：拖动中，指针出了小组件也别穿透。按下报一次，拖着时每 5 秒续一次（Rust 那边 30 秒没续就自己放开），松开解除。
function holdHit(on) {
  clearInterval(holdTimer);
  holdTimer = null;
  call('set_hit_hold', { hold: on }).catch(() => {});
  if (on) holdTimer = setInterval(() => call('set_hit_hold', { hold: true }).catch(() => {}), 5000);
}

// 七列现在在屏幕上的位置（第一列的左边、相邻两列的间距）
function weekGeo() {
  const cols = $('week-inner').querySelectorAll('.week-col');
  if (cols.length < 2) return null;
  const c0 = cols[0].getBoundingClientRect();
  return { left: c0.left, stride: cols[1].getBoundingClientRect().left - c0.left };
}

function weekDown(e) {
  if (e.button !== 0 || e.isPrimary === false || drag || !(e.target instanceof Element)) return;
  if (e.target.closest('.wk-chk')) return; // 时间块上的勾：就是勾，不是拖
  let blk = e.target.closest('.wk-it');
  let col = blk ? null : e.target.closest('.week-col');
  if (!blk && !col) return;
  const grip = !!(blk && e.target.closest('.wk-grip'));
  const key = blk ? { id: blk.dataset.id, zone: blk.dataset.zone } : null;
  const date = (blk || col).dataset.date;
  // 还在问范围的时候又按下别处：刚才的改动不算，弹回去
  if (S.ask) {
    cancelAsk();
    if (key) blk = blockOf(key.id, key.zone);
    else col = $('week-inner').querySelector('.week-col[data-date="' + date + '"]');
    if (!blk && !col) return;
  }
  const geo = weekGeo();
  if (!geo) return;
  const keys = Week.weekKeys(S.date);
  const el = blk || col;
  const base = blk ? find(blk.dataset.id) : null;
  if (blk && !base) return;
  const zone = blk ? blk.dataset.zone : 'time';
  drag = {
    op: grip ? 'resize' : blk ? 'move' : 'create',
    el: el, id: blk ? blk.dataset.id : '', zone: zone, date: date, base: Week.asTimed(base),
    pid: e.pointerId, x0: e.clientX, y0: e.clientY, cx: e.clientX, cy: e.clientY, sc0: $('week-body').scrollTop,
    geo: geo, col0: zone === 'side' ? -1 : Math.max(0, keys.indexOf(date)),
    active: false, stale: false, raf: 0, dMin: 0, dDays: 0, h0: blk ? blk.style.height : '',
    m0: blk ? 0 : Week.yToMin(e.clientY - $('week-inner').getBoundingClientRect().top),
    hit: null, drop: null, flip: 0, edge: 0, edgeTimer: null, cap: false, flipping: false,
  };
  drag.m1 = drag.m0;
  holdHit(true);
  try { el.setPointerCapture(e.pointerId); } catch (err) { /* 抓不到也能拖，只是指针出了这一块就收不到移动了 */ }
}

function weekMove(e) {
  const d = drag;
  if (!d || e.pointerId !== d.pid) return;
  d.cx = e.clientX;
  d.cy = e.clientY;
  if (!d.active) {
    if (Math.hypot(d.cx - d.x0, d.cy - d.y0) < DRAG_PX) return;
    d.active = true;
    hideTip();
    $('week').classList.add(d.op === 'resize' ? 'sizing' : 'moving');
    if (d.op === 'create') {
      d.ghost = document.createElement('div');
      d.ghost.className = 'wk-ghost';
      d.el.appendChild(d.ghost);
    } else {
      d.el.classList.remove('settling');
      d.el.classList.add('dragging');
    }
  }
  weekUpdate();
  weekEdge();
  if (!d.raf) d.raf = requestAnimationFrame(weekAuto);
}

// 指针现在在周视图的哪一块上：时间轴（哪一列、第几分钟）、顶部一行（哪一列），还是都不在
function weekHit(d) {
  const x = d.cx;
  const y = d.cy;
  if (x < d.geo.left - 2 || x > d.geo.left + d.geo.stride * 7) return { zone: '' };
  const col = Week.colAt(x, d.geo.left, d.geo.stride, 7);
  const body = $('week-body').getBoundingClientRect();
  // 从顶部一行 / 待办栏拖过来的，要进到时间轴里 12 像素以上才算：横着拖时手往下偏一点，不该被排成时间块
  const into = d.zone === 'allday' || d.zone === 'side' ? 12 : 0;
  if (y >= body.top + into && y <= body.bottom) return { zone: 'time', col: col, min: Week.yToMin(y - $('week-inner').getBoundingClientRect().top) };
  const head = $('week-head').getBoundingClientRect();
  if (y >= head.top && y < body.top) return { zone: 'allday', col: col };
  return { zone: '' };
}

// 要落进时间轴的那一块先用虚线框标出来
function dropGhost(d, col, patch) {
  const host = $('week-inner').querySelectorAll('.week-col')[col];
  if (!host || !patch) { if (d.ghost2) { d.ghost2.remove(); d.ghost2 = null; } return; }
  if (!d.ghost2 || !d.ghost2.isConnected) { d.ghost2 = document.createElement('div'); d.ghost2.className = 'wk-ghost'; }
  if (d.ghost2.parentElement !== host) host.appendChild(d.ghost2);
  const s = Week.toMin(patch.start || patch.due);
  const en = Week.toMin(patch.end);
  d.ghost2.style.top = num2(Week.minToY(s)) + 'px';
  d.ghost2.style.height = num2(Week.minToY(en - s)) + 'px';
  setText(d.ghost2, Week.fromMin(s) + '–' + Week.fromMin(en));
}

// 按指针现在的位置，算出这一块该在哪，只改它自己的 transform / height
function weekUpdate() {
  const d = drag;
  const body = $('week-body');
  const dMin = Week.yToMin(d.cy - d.y0 + body.scrollTop - d.sc0);
  if (d.op === 'create') {
    d.m1 = Week.yToMin(d.cy - $('week-inner').getBoundingClientRect().top);
    d.range = Week.createRange(d.date, d.m0, d.m1);
    const s0 = Week.toMin(d.range.start);
    d.ghost.style.top = num2(Week.minToY(s0)) + 'px';
    d.ghost.style.height = num2(Week.minToY(Week.toMin(d.range.end) - s0)) + 'px';
    setText(d.ghost, d.range.start + '–' + d.range.end);
    return;
  }
  const it = d.base;
  const time = d.el.querySelector('.wk-time');
  if (d.op === 'resize') {
    const rg = Week.rangeOf(it);
    const r = Week.resizeEnd(it, dMin);
    const end = r && Week.toMin(r.end) !== null ? Week.toMin(r.end) : rg.end;
    d.dMin = dMin;
    d.el.style.height = num2(Week.place({ start: rg.start, end: end }).height) + 'px';
    setText(time, it.start + '–' + Week.fromMin(end));
    return;
  }
  const hit = weekHit(d);
  const keys = Week.weekKeys(S.date);
  d.hit = hit;
  d.drop = null;
  d.dMin = dMin;
  d.dDays = d.col0 < 0 ? 0 : Week.colAt(d.cx, d.geo.left, d.geo.stride, 7) - d.col0;
  const free = 'translate(' + num2(d.cx - d.x0) + 'px,' + num2(d.cy - d.y0 + (d.zone === 'time' ? body.scrollTop - d.sc0 : 0)) + 'px)';
  const locked = isLocked(it);
  const inGrid = d.zone === 'time' || d.zone === 'mark';
  if (inGrid && hit.zone === 'allday' && !locked) {
    // 时间轴上的（时间块、截止小标记）拖到顶部一行：跟着指针走，松手变成全天（待办去掉时间）
    d.drop = Week.toAllDay(it, keys[hit.col]);
    d.el.style.transform = free;
    return;
  }
  if (!inGrid && hit.zone === 'time' && !locked && !it.parts) {
    // 顶部一行 / 待办栏里的拖进时间轴：跟着指针走，落点用虚线框标出来
    d.drop = Week.toBlock(it, keys[hit.col], hit.min);
    d.el.style.transform = free;
    dropGhost(d, hit.col, d.drop);
    return;
  }
  dropGhost(d, -1, null);
  if (d.zone === 'side') {
    if (hit.zone === 'allday') d.drop = { date: keys[hit.col] };
    d.el.style.transform = free;
    return;
  }
  let ty = 0;
  if (d.zone === 'time') {
    const r = Week.moveTimed(it, dMin, d.dDays);
    ty = Week.minToY(Week.toMin(r.start) - Week.toMin(it.start));
    setText(time, r.start + (r.end ? '–' + r.end : ''));
  }
  d.el.style.transform = 'translate(' + d.dDays * d.geo.stride + 'px,' + num2(ty) + 'px)';
}

// 指针靠近时间轴的上下边就自己往那边滚，滚了再重新算一次
function weekAuto() {
  const d = drag;
  if (!d) return;
  d.raf = 0;
  // 从顶部一行 / 待办栏拖进来的：要先真正进到时间轴里面（离上沿 40 像素以上）才开始自动滚，不然路过上沿就往上滚，落点跟着跑
  if (d.hit && d.hit.zone === 'time' && d.cy > $('week-body').getBoundingClientRect().top + 40) d.armed = true;
  if (!d.active || (d.op === 'move' && d.zone !== 'time' && d.zone !== 'mark' && !(d.armed && d.hit && d.hit.zone === 'time'))) return;
  const body = $('week-body');
  const r = body.getBoundingClientRect();
  const edge = 28;
  let v = 0;
  if (d.cy < r.top + edge && (d.zone === 'time' ? d.cy > r.top - 8 || d.op !== 'move' : d.cy >= r.top)) v = -Math.ceil((r.top + edge - d.cy) / 3);
  else if (d.cy > r.bottom - edge) v = Math.ceil((d.cy - (r.bottom - edge)) / 3);
  v = Math.max(-16, Math.min(16, v));
  if (!v) return;
  const before = body.scrollTop;
  body.scrollTop = before + v;
  if (body.scrollTop === before) return;
  weekUpdate();
  d.raf = requestAnimationFrame(weekAuto);
}

// 指针停在左右边上：过一会儿翻到上一周 / 下一周。挪开就不翻。
function weekEdge() {
  const d = drag;
  if (!d || !d.active || d.op !== 'move') return;
  const r = $('week-body').getBoundingClientRect();
  const dir = d.cx < d.geo.left - 4 && d.cx > r.left - 60 ? -1 : d.cx > r.right - 16 && d.cx < r.right + 60 ? 1 : 0;
  if (dir === d.edge) return;
  clearTimeout(d.edgeTimer);
  d.edge = dir;
  if (dir) d.edgeTimer = setTimeout(() => flipWeek(dir), EDGE_WAIT);
}

function flipWeek(dir) {
  const d = drag;
  if (!d || d.edge !== dir || !d.active) return;
  d.flip += dir;
  // 拖着的那一块马上要被重画换掉：指针改由 #week 抓着（它一直在），不然拖动就断了
  if (!d.cap) {
    try { d.el.releasePointerCapture(d.pid); } catch (err) { /* 已经松开了 */ }
    try { $('week').setPointerCapture(d.pid); d.cap = true; } catch (err) { /* 抓不到就靠指针留在周视图里 */ }
  }
  dropGhost(d, -1, null);
  S.date = Week.addDays(S.date, 7 * dir);
  const day = fromIso(S.date);
  S.vm = { y: day.getFullYear(), m: day.getMonth() };
  replay($('week-inner'), 'fade');
  d.flipping = true;
  render();
  d.flipping = false;
  d.stale = false;
  // 把拖着的这一块放进新一周里原来那一列，接着拖
  if (d.zone !== 'side') {
    const host = (d.zone === 'allday' ? $('week-allday').querySelectorAll('.wk-ad') : $('week-inner').querySelectorAll('.week-col'))[d.col0];
    if (host) {
      if (d.zone === 'time') { d.el.style.left = '1px'; d.el.style.width = 'calc(100% - 2px)'; }
      host.appendChild(d.el);
      (d.zone === 'allday' ? $('week-allday') : $('week-inner'))._html = null; // 手动塞了一块进去，松手后要整个重画
    }
  }
  d.geo = weekGeo() || d.geo;
  weekUpdate();
  d.edge = 0;
  weekEdge(); // 指针还停在边上：接着等下一次翻
}

// 回到原位：transform / height 慢慢归零（没被重画替换掉的那一块自己滑回去；被替换的由 weekFlip 滑）
function settleBack(d) {
  const el = d.el;
  if (!el || !el.isConnected || d.op === 'create') return;
  if (d.flip) { el.remove(); return; } // 翻过周：它本来不在这一周里
  el.classList.remove('dragging');
  el.classList.add('settling');
  el.style.transform = '';
  if (d.op === 'resize') el.style.height = d.h0;
  const time = el.querySelector('.wk-time');
  const it = d.base;
  if (it && d.zone === 'time') setText(time, it.start + (it.end ? '–' + it.end : ''));
  setTimeout(() => el.classList.remove('settling'), 320);
}

function endDrag() {
  const d = drag;
  if (d.raf) cancelAnimationFrame(d.raf);
  clearTimeout(d.edgeTimer);
  drag = null;
  holdHit(false);
  $('week').classList.remove('moving', 'sizing');
  if (d.ghost2) d.ghost2.remove();
  try { d.el.releasePointerCapture(d.pid); } catch (err) { /* 已经松开了 */ }
  try { $('week').releasePointerCapture(d.pid); } catch (err) { /* 没抓过 */ }
  return d;
}

// Esc、窗口失焦、系统打断：这次拖动不算，回原位（翻过周的回到原来那一周）
function cancelDrag() {
  if (!drag) return;
  const d = endDrag();
  if (d.ghost) d.ghost.remove();
  settleBack(d);
  if (d.flip) {
    S.date = Week.addDays(S.date, -7 * d.flip);
    const day = fromIso(S.date);
    S.vm = { y: day.getFullYear(), m: day.getMonth() };
  }
  if (d.stale || d.flip) render();
}

function weekUp(e) {
  if (!drag || e.pointerId !== drag.pid) return;
  const d = endDrag();
  if (!d.active) { if (d.stale) render(); return; } // 没拖起来：就是一次普通的点击，click 会照常打开详情
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 60);

  if (d.op === 'create') {
    d.ghost.remove();
    const r = d.range || Week.createRange(d.date, d.m0, d.m1);
    const day = fromIso(r.date);
    S.date = r.date;
    S.vm = { y: day.getFullYear(), m: day.getMonth() };
    addItem('event', { date: r.date, start: r.start, end: r.end }, true); // 新建并立刻进入标题输入
    return;
  }

  const it = find(d.id);
  if (!it) { settleBack(d); render(); return; }
  let res;
  if (isLocked(it)) res = { patch: null, reason: 'locked' };
  else if (d.drop) {
    const patch = Week.changed(it, d.drop);
    res = Object.keys(patch).length ? { patch: patch, reason: '' } : { patch: null, reason: 'none' };
  } else if (d.zone === 'side') res = { patch: null, reason: 'none' };
  else {
    res = Week.drop(d.op, Week.asTimed(it), { dMin: d.dMin, dDays: d.dDays + 7 * d.flip });
    if (res.patch) res.patch = Week.fromTimed(it, res.patch);
  }
  if (res.reason === 'none') { settleBack(d); if (d.stale || d.flip) render(); return; }
  if (res.reason === 'locked') {
    // 跨天的 iCloud 日程在今笺里只读：弹回原位，并打开详情，那里已经写着“跨天日程，请在 Apple 日历里修改”
    if (S.sel !== it.id || S.panel !== 'detail') openDetail(it.id, false); else render();
    settleBack(d);
    return;
  }
  if (d.flip && d.zone !== 'side') d.el.remove();
  if (d.zone === 'side') { d.el.style.transform = ''; d.el.classList.remove('dragging'); }

  // 重复日程的某一场：先选中它、打开详情，问范围的小气泡要有地方贴
  if (seriesOf(it) && (S.sel !== it.id || S.panel !== 'detail')) {
    setSel(it.id);
    S.panel = 'detail';
    S.pop = null;
    fillPanel(it);
  }
  const done = change(it, res.patch, null);
  if (!done && S.ask) {
    S.ask.drag = true;
    fillPanel(selView() || it);
  } else if (S.panel === 'detail' && find(S.sel)) fillPanel(find(S.sel));
  $('week-inner')._html = null;
  render();
  setTimeout(uploadPending, 0);
}

// 问范围时选了置灰的那一项（iCloud 系列里少数做不了的改法）：弹回原位，提示还是置灰按钮上那句
function rejectDrag(btn) {
  if (btn && btn.dataset.tip) {
    // 按钮马上跟着小气泡一起消失，提示自己留两秒多
    showTip(btn);
    clearTimeout(tipTimer);
    tipPin = Date.now() + 2400;
    tipTimer = setTimeout(() => { tipPin = 0; hideTip(); }, 2400);
  }
  cancelAsk();
}

// 详情气泡贴在周视图里被选中的那一块旁边
function weekAnchor() {
  const el = $('week-main').querySelector('.wk-it.sel');
  if (!el) return null;
  const col = el.closest('.week-col, .wk-ad');
  const view = (el.dataset.zone === 'allday' ? $('week-allday') : $('week-body')).getBoundingClientRect();
  return { el: el, col: col, view: view };
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
  $('compact').classList.toggle('nobar', !info.bar);
  $('c-left').textContent = info.right;
  $('c-next').textContent = info.next;
  setHtml($('c-pips'), pipsHtml(todos));
  $('c-count').textContent = todos.filter((x) => x.done).length + '/' + todos.length;
  $('cap-title').textContent = info.title || info.label;
  $('cap-left').textContent = info.short;
  root.style.setProperty('--edge-pct', String(info.bar ? Math.max(8, info.pct) : 100)); // 贴边收起时那条细线有多高
}

// 小组件、折叠日历、月视图、迷你条是同一块玻璃在变大小。
function applyMode() {
  const shell = $('shell');
  const full = parseFloat(getComputedStyle(root).getPropertyValue('--shell-h')) || 864;
  let w = widthOf();
  let h = full;
  $('grip').hidden = S.big || !!S.compact || S.search || S.cmd; // 只有平常的小组件能拖边改宽
  if (S.compact === 'card') {
    w = widthOf() - 24;
    h = $('compact').offsetHeight;
  } else if (S.big) {
    w = bigSize()[0];
    h = bigSize()[1];
  } else if (S.mode === 'cal' && !S.search && !S.cmd) {
    const bar = $('countdowns');
    h = Math.min(full, 156 + $('cal').offsetHeight + (bar.hidden ? 0 : bar.offsetHeight + 12)); // 12 是它和上下的间距
  }
  shell.style.width = w + 'px';
  shell.style.height = h + 'px';
  shell.classList.toggle('gone', S.compact === 'capsule');
  $('widget').classList.toggle('on', !S.big && !S.compact && !S.search && !S.cmd);
  $('big').classList.toggle('on', S.big && !S.compact && !S.search && !S.cmd);
  $('search').classList.toggle('on', S.search);
  $('search').setAttribute('aria-hidden', S.search ? 'false' : 'true');
  $('cmd').classList.toggle('on', S.cmd);
  $('cmd').setAttribute('aria-hidden', S.cmd ? 'false' : 'true');
  $('compact').classList.toggle('on', S.compact === 'card');
  $('capsule').classList.toggle('on', S.compact === 'capsule');
  $('day').classList.toggle('on', S.mode === 'day');
  $('cal').classList.toggle('on', S.mode === 'cal');
}

// 详情：平时停在小组件靠屏幕里面的那一侧；月视图 / 周视图里变成贴着那条日程的气泡。
// 气泡的位置按停靠的角写：靠右用 right、靠左用 left，靠上用 top、靠下用 bottom（和 CSS 里用的是同一组属性，过渡才连得上）。
function placePanel(left, top, W, h) {
  const panel = $('panel');
  const l = atLeft();
  const b = atBottom();
  panel.style.left = l ? Math.round(left) + 'px' : '';
  panel.style.right = l ? '' : Math.round(window.innerWidth - left - W) + 'px';
  panel.style.top = b ? '' : Math.round(top) + 'px';
  panel.style.bottom = b ? Math.round(window.innerHeight - top - h) + 'px' : '';
}

function positionPanel() {
  const panel = $('panel');
  const arrow = panel.querySelector('.arrow');
  panel.classList.toggle('bubble', S.big);
  if (!S.big) {
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';
    panel.style.left = '';
    panel.style.transformOrigin = '';
    return;
  }
  const W = panel.offsetWidth || 248;
  const h = panel.offsetHeight;
  const bigW = bigSize()[0]; // 和 applyMode 里一致
  const bigH = bigSize()[1];
  const grid = $('big-grid');
  const wa = S.week ? weekAnchor() : null;
  const anchor = S.week ? (wa && wa.el) : grid.querySelector('.line.sel') || (find(S.sel) ? grid.querySelector('.cell[data-date="' + find(S.sel).date + '"] .num') : null);
  // 展开后的外壳在哪（它还在变大的时候量不准，按停靠的角算）
  const shellLeft = atLeft() ? 24 : window.innerWidth - 24 - bigW;
  const shellTop = atBottom() ? window.innerHeight - 24 - bigH : 24;
  if (!anchor) {
    placePanel(shellLeft + (bigW - W) / 2, shellTop + 36, W, h);
    arrow.style.display = 'none';
    return;
  }
  const a = anchor.getBoundingClientRect();
  const cell = (wa ? wa.col : anchor.closest('.cell')).getBoundingClientRect();
  // 周视图里那一块可能滚出了可视范围：气泡贴在可视范围的边上
  const ay = wa ? Math.max(wa.view.top + 12, Math.min(wa.view.bottom - 12, a.top + a.height / 2)) : a.top + a.height / 2;
  const onRight = cell.left + cell.width / 2 < shellLeft + bigW * 0.55;
  // 窄屏（竖着的 1080p 配 150%）上气泡不能伸到窗口外面
  const left = Math.max(8, Math.min(window.innerWidth - W - 8, onRight ? cell.right + 12 : cell.left - 12 - W));
  const top = Math.max(shellTop + 12, Math.min(shellTop + bigH - 12 - h, ay - 56));
  const at = Math.max(30, Math.min(h - 40, ay - top));
  placePanel(left, top, W, h);
  panel.style.transformOrigin = (onRight ? 'left ' : 'right ') + Math.round(at) + 'px';
  arrow.style.display = '';
  arrow.style.top = Math.round(at) + 'px';
  arrow.style.left = onRight ? '-8px' : (W - 9) + 'px';
}

function render() {
  if (!S.vm) { const d = fromIso(S.date); S.vm = { y: d.getFullYear(), m: d.getMonth() }; }
  rebuildLocal();
  if (S.sel && !find(S.sel)) { S.sel = null; if (S.panel === 'detail') S.panel = ''; }
  if (S.ask && (S.ask.id !== S.sel || S.panel !== 'detail')) S.ask = null;
  const map = byDate();
  const info = nowInfo(map);
  const month = monthDays();
  renderHeader();
  renderDay(map, info);
  renderCal(map, month);
  renderBig(map, month);
  renderWeek();
  renderCompact(map, info);
  renderCountdowns();
  applyMode();
  renderPop(map);

  const detail = S.panel === 'detail' && !!S.sel;
  $('panel').classList.toggle('on', detail);
  $('panel').setAttribute('aria-hidden', detail ? 'false' : 'true');
  $('settings').classList.toggle('on', S.panel === 'settings');
  $('settings').setAttribute('aria-hidden', S.panel === 'settings' ? 'false' : 'true');
  if (detail) {
    positionPanel();
    const cur = find(S.sel);
    if (cur) fillClash(cur); // 别的日程挪了、它自己改了时间：撞没撞要重看
  }
  renderScope();
  S.justDone = null;
  sendRectsSoon();
}

// ---------- Ctrl + F 搜索 ----------
// 盖在整块玻璃上，搜全部历史的日程（含 iCloud 缓存）、待办和便签。纯函数在 search.js。

let searchHits = [];   // 当前结果：{ note: false, h } 或 { note: true, h }
let searchIdx = 0;
let composing = false; // 输入法正在组字

const FIELD_NAME = { place: '地点', notes: '备注', subs: '子任务' };

function markHtml(text, toks) {
  return Search.segments(text, toks).map((x) => (x.m ? '<mark>' + esc(x.t) + '</mark>' : esc(x.t))).join('');
}

function hitDate(key) {
  const d = fromIso(key);
  return (d.getFullYear() === new Date().getFullYear() ? '' : d.getFullYear() + '年') + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

function hitHtml(x, i, toks) {
  const h = x.h;
  const on = i === searchIdx;
  if (x.note) {
    return '<button type="button" class="prow hit n tap' + (on ? ' on' : '') + '" role="option" id="hit-' + i + '" aria-selected="' + on + '" data-act="hit-note" data-i="' + i + '">'
      + '<span class="mark"></span><span class="col"><span class="pn ellipsis">便签</span><span class="ps ellipsis">' + markHtml(h.snippet, toks) + '</span></span><span class="pw"></span></button>';
  }
  let sub;
  if (h.field) sub = esc(FIELD_NAME[h.field]) + '：' + markHtml(h.snippet, toks);
  else if (h.kind === 'todo') sub = esc((h.done ? '已完成' : '待办') + (h.due ? ' · ' + h.due + ' 截止' : '') + (h.place ? ' · ' + h.place : ''));
  else sub = esc((h.allDay ? '全天' : (h.start || '') + (h.end ? ' – ' + h.end : '')) + (h.place ? ' · ' + h.place : ''));
  const cls = ['prow', 'hit', h.kind === 'todo' ? 't' : 'e', 'tap'];
  if (h.done) cls.push('done');
  if (on) cls.push('on');
  return '<button type="button" class="' + cls.join(' ') + '" role="option" id="hit-' + i + '" aria-selected="' + on + '" data-act="hit" data-id="' + esc(h.id) + '" data-i="' + i + '"' + color(h.color) + '>'
    + '<span class="mark"></span><span class="col"><span class="pn ellipsis">' + markHtml(h.title || '未命名', toks) + '</span><span class="ps ellipsis">' + sub + '</span></span>'
    + '<span class="pw">' + esc(hitDate(h.date)) + '</span></button>';
}

function renderSearchList() {
  const toks = Search.tokens($('search-input').value);
  const list = $('search-list');
  setHtml(list, searchHits.map((x, i) => hitHtml(x, i, toks)).join('') || (toks.length ? '<div class="pempty">没有找到</div>' : ''));
  $('search-input').setAttribute('aria-expanded', searchHits.length ? 'true' : 'false');
  if (searchHits.length) $('search-input').setAttribute('aria-activedescendant', 'hit-' + searchIdx);
  else $('search-input').removeAttribute('aria-activedescendant');
}

function runSearch() {
  // 重复条目：展开过的那些场次，再加上离今天最近的一场（窗口外的老系列也搜得到）；search.js 按系列只留一条
  const t = today();
  const have = {};
  L.forEach((o) => { have[o.id] = true; });
  const extra = S.items.filter(Recur.isRepeating).map((m) => Recur.nearest(m, t)).filter((o) => o && !have[o.id]);
  const r = Search.run({ items: allItems().concat(extra), note: S.note, query: $('search-input').value, today: t });
  searchHits = r.items.map((h) => ({ note: false, h: h })).concat(r.note ? [{ note: true, h: r.note }] : []);
  searchIdx = 0;
  $('search-list').scrollTop = 0;
  renderSearchList();
}

function moveHit(step) {
  if (!searchHits.length) return;
  searchIdx = Math.max(0, Math.min(searchHits.length - 1, searchIdx + step));
  renderSearchList();
  const el = $('hit-' + searchIdx);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function openSearch() {
  if (!S.search) {
    S.searchBack = { compact: S.compact, focus: document.activeElement };
    S.cmd = false;
    setSel(null);
    S.panel = '';
    S.pop = null;
    S.compact = ''; // 迷你条和胶囊放不下搜索，先展开
    S.search = true;
    composing = false;
    runSearch();
    render();
  }
  $('search-input').focus();
  $('search-input').select();
}

function closeSearch(restore) {
  if (!S.search) return;
  const back = S.searchBack || {};
  S.search = false;
  composing = false;
  $('search-input').blur();
  if (restore) S.compact = back.compact || '';
  render();
  const f = back.focus;
  if (restore && f && f !== document.body && document.contains(f) && !f.disabled && f.offsetParent !== null) f.focus();
}

function openHit(i) {
  const x = searchHits[i];
  if (!x) return;
  if (x.note) { jumpToNote(x.h); return; }
  jumpTo(x.h.id);
}

// 跳到那一天并打开详情
function jumpTo(id) {
  const it = find(id);
  if (!it) return;
  closeSearch(false);
  const d = fromIso(it.date);
  if (S.date !== it.date) { replay($('events'), 'swap'); replay($('todos'), 'swap'); }
  S.date = it.date;
  S.vm = { y: d.getFullYear(), m: d.getMonth() };
  S.nav = false;
  if (!S.big) S.mode = 'day';
  openDetail(id, false);
}

// 便签在小组件里：展开它，把命中的那一段选中（先聚焦再选，浏览器才会滚到那里）
function jumpToNote(h) {
  closeSearch(false);
  S.settings.fold.note = false;
  S.big = false;
  S.pop = null;
  S.mode = 'day';
  save();
  render();
  setTimeout(() => {
    const n = $('note');
    n.focus();
    n.setSelectionRange(h.pos, h.pos + h.len);
  }, 60);
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
  pick.hidden = !(!it.remote && !isTodo && sync.on && sync.cals.length) || !canCloud(masterOf(it) || it);
  if (!pick.hidden) {
    pick.innerHTML = '<option value="">仅本机</option>' + sync.cals.map((c) => '<option value="' + esc(c.href) + '">' + esc(c.name) + '</option>').join('');
    pick.value = it.cal || '';
  }
  $('p-ro').hidden = !locked;
  $('p-ro').textContent = TIP_RO;
  resetDelete();
  $('p-del').hidden = locked;
  $('p-allday').hidden = isTodo;
  $('p-allday').disabled = locked;
  $('p-allday').setAttribute('aria-pressed', it.allDay ? 'true' : 'false');
  $('p-done').hidden = !isTodo;
  $('p-star').hidden = !isTodo;
  $('p-count').setAttribute('aria-pressed', it.countdown ? 'true' : 'false');
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
  const value = remindOf(it);
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
  fillRepeat(it);
  fillClash(it);
  renderSubs(it, null);
}

// 一天里有时间的日程：[{ id, start, end }]（分钟）。待办排进时间轴的时间块也算占着时间。
function dayBusy(date, map) {
  const list = (map || byDate())[date] || [];
  const out = [];
  list.forEach((x) => {
    if (x.parts || (x.kind === 'todo' && x.done)) return;
    const r = Week.spanOf(x);
    if (r) out.push({ id: x.id, start: r.start, end: r.end, title: x.title || '未命名' });
  });
  return out;
}

// 详情里：这条日程和别的撞了时，说一声和谁撞，给一个“顺延到 HH:MM”（这天往后第一个放得下的空档）
function fillClash(it) {
  const row = $('p-clash');
  const v = S.ask && S.ask.mode === 'edit' && S.ask.id === it.id ? Object.assign({}, it, S.ask.patch) : it;
  const span = !isLocked(v) && !(v.kind === 'todo' && v.done) ? Week.spanOf(v) : null;
  let hit = [];
  let slot = null;
  if (span) {
    const list = dayBusy(v.date).filter((x) => x.id !== v.id).concat([{ id: v.id, start: span.start, end: span.end }]);
    hit = (Slots.conflicts(list)[v.id] || []).map((id) => list.find((x) => x.id === id).title);
    if (hit.length) slot = Slots.postpone(list, v.id, Week.LAST, Week.STEP);
  }
  row.hidden = !hit.length;
  if (!hit.length) return;
  $('p-clash-text').textContent = '与「' + hit[0] + '」' + (hit.length > 1 ? '等 ' + hit.length + ' 项' : '') + '重叠';
  const b = $('p-postpone');
  b.hidden = !slot;
  if (slot) {
    b.textContent = '顺延到 ' + Week.fromMin(slot.start);
    b.dataset.s = Week.fromMin(slot.start);
    b.dataset.e = Week.fromMin(slot.end);
  }
}

// 重复：只有本机的条目能设（iCloud 的重复日程照旧在 Apple 日历里改）
function fillRepeat(it) {
  const own = !it.remote;
  $('p-rep-row').hidden = !own;
  const f = own ? Recur.toForm(masterOf(it) || it) : Recur.toForm(null);
  $('p-repeat').value = f.freq;
  $('p-wk-row').hidden = !own || f.freq !== 'WEEKLY';
  $('p-wk').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', f.byday.indexOf(Number(b.dataset.d)) >= 0 ? 'true' : 'false'));
  $('p-end-row').hidden = !own || !f.freq;
  $('p-rend').value = f.end;
  $('p-until').hidden = f.end !== 'until';
  $('p-until').value = f.until || '';
  $('p-rcount').hidden = f.end !== 'count';
  $('p-rcount').value = f.count ? String(f.count) : '';
  // 开着 iCloud 同步、这条重复日程却传不上去（农历、有夏令时的时区）：标一个“只存本机”
  $('p-local').hidden = !(own && f.freq && it.kind === 'event' && S.settings.sync.on && !canCloud(masterOf(it) || it));
  // 遇法定节假日自动跳过：本机的重复条目、iCloud 的重复日程都能开
  const series = own ? !!f.freq : seriesOf(it) === 'remote';
  $('p-hol-row').hidden = !series;
  $('p-hol').setAttribute('aria-pressed', series && (own ? (masterOf(it) || it).skipHol === true : !!it.skipHol) ? 'true' : 'false');
}

// 详情里正在显示的样子：还在问范围时，把还没定下来的改动叠上去
function selView() {
  const it = find(S.sel);
  if (!it || !S.ask || S.ask.mode !== 'edit' || S.ask.id !== it.id) return it;
  return Object.assign({}, it, S.ask.patch);
}

// 详情里的改动都走这里：重复条目的某一场第一次改时先问范围，问完再写。写进去了返回 true。
function change(it, p, anchor) {
  const series = seriesOf(it);
  // iCloud 条目上的子任务、倒数日只存在本机，不用问
  if (it.remote && Object.keys(p).every((k) => k === 'subs' || k === 'countdown')) { updateItem(it, p); return true; }
  // iCloud 系列选过范围以后接着改的这一下，按那个范围做不了（比如按“第几个周几”排的系列整组挪一天）：重新问
  if (series === 'remote' && S.scopeMem && S.scopeMem.id === it.id && scopeOff(it, { mode: 'edit', patch: p }, S.scopeMem.scope)) S.scopeMem = null;
  if (series && !(S.scopeMem && S.scopeMem.id === it.id)) {
    if (S.ask && S.ask.mode === 'edit' && S.ask.id === it.id) Object.assign(S.ask.patch, p);
    else S.ask = { mode: 'edit', id: it.id, patch: Object.assign({}, p), anchor: anchor || null };
    renderScope();
    return false;
  }
  updateItem(it, p, series ? S.scopeMem.scope : undefined);
  return true;
}

// iCloud 的重复日程里做不了的（详情里置灰；周视图里拖动也走这一条）。0.9.0 起“此次及以后”和按“全部”改时间 / 全天都能做了，
// 只剩少数规则不行：按“第几个周几 / 每月几号 / 指定月份”排的系列整组挪到别的天、全天改成有时间而本机时区有夏令时。
function scopeOff(it, a, scope) {
  if (!a || a.mode !== 'edit' || !it || seriesOf(it) !== 'remote' || scope === 'one') return false;
  const res = S.remote.res[it.href];
  if (!res || !it.rid) return true;
  const patch = a.patch || {};
  const x = seriesArgs(it, patch);
  const whole = () => hasTime(patch) && ICS.shiftSeries(res.ics, it.rid, x.f, x.opt) === null;
  if (scope === 'all') return whole();
  const sp = ICS.splitSeries(res.ics, it.rid, x.f, Object.assign({ uid: 'X' }, x.opt));
  return sp === null || (sp.whole && whole());
}

// 问范围的小气泡：贴在刚改的那一项下面（放不下就放上面），不说明、不遮详情的其余部分
function renderScope() {
  const box = $('scope');
  const a = S.ask;
  const show = !!a && S.panel === 'detail' && $('panel').classList.contains('on');
  if (!show) {
    if (!box.hidden) { box.hidden = true; sendRectsSoon(); }
    return;
  }
  const wasHidden = box.hidden;
  box.hidden = false;
  box.classList.toggle('del', a.mode === 'del');
  box.setAttribute('aria-label', a.mode === 'del' ? '删除哪几次' : '修改哪几次');
  // iCloud 的重复日程：“此次及以后”的修改、改全部的时间，这里不做
  const cur = find(a.id);
  box.querySelectorAll('button').forEach((b) => {
    const off = scopeOff(cur, a, b.dataset.v);
    if (off) { b.setAttribute('aria-disabled', 'true'); b.dataset.tip = '这一项请在 Apple 日历里改'; } else { b.removeAttribute('aria-disabled'); delete b.dataset.tip; }
  });
  const panel = $('panel');
  const pr = panel.getBoundingClientRect();
  const anchor = a.anchor && a.anchor.isConnected && a.anchor.offsetParent !== null ? a.anchor : $('p-title');
  const ar = anchor.getBoundingClientRect();
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const sx = pr.width / (panel.offsetWidth || pr.width) || 1; // 详情正在缩放的话按比例换回去
  let top = (ar.bottom - pr.top) / sx + 6;
  if (top + h > panel.offsetHeight - 6 && (ar.top - pr.top) / sx - h - 6 >= 6) top = (ar.top - pr.top) / sx - h - 6;
  const left = Math.max(8, Math.min(panel.offsetWidth - w - 8, (ar.left - pr.left) / sx));
  box.style.top = Math.round(top) + 'px';
  box.style.left = Math.round(left) + 'px';
  if (wasHidden) sendRectsSoon();
}

function resolveAsk(scope, btn) {
  if (btn && btn.getAttribute('aria-disabled') === 'true') {
    // 周视图里拖出来的改动选了做不了的那一项：弹回原位，提示还是详情里那句
    if (S.ask && S.ask.drag) rejectDrag(btn);
    return;
  }
  const a = S.ask;
  S.ask = null;
  const it = a ? find(a.id) : null;
  if (!a || !it) { render(); return; }
  if (a.mode === 'del') { deleteOcc(it, scope); return; }
  S.scopeMem = { id: it.id, scope: scope };
  updateItem(it, a.patch, scope);
  if (scope === 'future') S.scopeMem.scope = 'all'; // 拆出来的新系列：之后再改就是改它全部
  const now = find(S.sel);
  if (now) fillPanel(now);
  render();
  const back = a.anchor;
  if (back && back.isConnected && back.offsetParent !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(back.tagName)) back.focus();
}

// 没选范围就关掉 / 按 Esc：刚才的改动不算
function cancelAsk() {
  if (!S.ask) return;
  S.ask = null;
  const it = find(S.sel);
  if (it) fillPanel(it);
  render();
}

// 删重复条目的某一场；删完底部有“撤销”，之后也能按 Ctrl + Z
function deleteOcc(it, scope) {
  if (it.remote) { deleteRemoteOcc(it, scope); return; }
  const m = masterOf(it);
  if (!m) return;
  setSel(null);
  S.panel = '';
  record('删除「' + (it.title || '未命名') + '」', '', () => { S.items = Recur.remove(S.items, it.id, scope).items; });
  save();
  undoToast('已删除「' + (it.title || '未命名') + '」');
  render();
}

// iCloud 的重复日程：仅此次 → EXDATE；此次及以后 → 规则提前结束；全部 → 删掉整条。
// “此次及以后”时，这一场之前要是一场都不剩（不能只拿 DTSTART 比：周三建的“每周一”，DTSTART 比第一场还早），也是删掉整条，
// 不然会写出 COUNT=0 那样的规则，变成删不掉的无限重复。
function deleteRemoteOcc(it, scope) {
  const res = S.remote.res[it.href];
  setSel(null);
  S.panel = '';
  const whole = !res || !it.rid || scope === 'all' || (scope === 'future' && ICS.countBefore(res.ics, it.rid).live < 1);
  record('删除「' + (it.title || '未命名') + '」', '', () => {
    touchRes(it.href);
    const next = whole ? null : scope === 'future' ? ICS.endBefore(res.ics, it.rid) : ICS.exclude(res.ics, it.rid);
    if (next === null) {
      dropRes(it.href);
      dropExtras(it.href);
    } else {
      res.ics = next;
      res.dirty = true;
      pushSoon(it.href);
    }
    rebuildRemote();
  });
  save();
  undoToast('已删除「' + (it.title || '未命名') + '」');
  render();
}

// 改重复规则：整个系列的事，不问范围
function applyRule(form) {
  const it = find(S.sel);
  if (!it || it.remote) return;
  const m = masterOf(it);
  const snap = m ? JSON.stringify(m) : '';
  let ok = true;
  const d = m && m.draft ? m : null;
  record('修改重复', d ? 'new:' + d.id : 'rule:' + (m ? m.id : it.id), () => {
    const r = Recur.setRule(S.items, it.id, form);
    if (m && Recur.isRepeating(m) && !Recur.first(m)) {
      // 结束日期早于开始、次数让它一场都不剩：不接受，退回原样
      Object.keys(m).forEach((k) => delete m[k]);
      Object.assign(m, JSON.parse(snap));
      ok = false;
      return;
    }
    if (m && m.cal && !canCloud(m)) delete m.cal; // 农历重复（或有夏令时的时区里的重复）传不上 iCloud
    if (r.sel !== S.sel) { S.sel = r.sel; S.scopeMem = null; S.ask = null; }
  }, !!d);
  if (!ok) { fillPanel(it); return; }
  save();
  render();
  const now = find(S.sel);
  if (now) fillPanel(now);
}

function repeatForm() {
  const it = find(S.sel);
  const f = Recur.toForm(it ? masterOf(it) || it : null);
  return f;
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

let wallRgb = null;   // 小组件背后那块壁纸的平均颜色；读不到就是 null
let wallZones = null; // 同一块壁纸分上、中、下三段各自的平均颜色（0.9.0）
let wallScheme = null; // “跟随壁纸”配色：从整张壁纸取的主色配出来的一套（Monet.scheme）
let wallUrl = '';     // 现在这张壁纸的 blob 地址，换下一张时要释放

function luminance(rgb) {
  const f = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

// 玻璃长什么样，全由“不透明度”决定：
//   0        完全透明：模糊、底色、边框、阴影都没有，只剩文字
//   0 ~ 25   玻璃慢慢显出来
//   25 ~ 100 底色越来越实
// 文字用浅色还是深色，不直接跟主题走，而是算一下“壁纸 + 玻璃”叠出来有多亮再定，
// 这样浅色主题调得很透、壁纸又暗的时候，字不会变成深色压在深色上。
// 各配色的玻璃底色：[深色, 浅色]
const VEIL = { indigo: [[22, 18, 36], [250, 249, 253]], graphite: [[20, 22, 26], [246, 247, 249]] };
// 玻璃很透时（--glass 不到一半）用深色字的门槛：背后那一块最暗的一段也得这么亮。
// 常见的风景、渐变壁纸到不了，一律用白字配一圈紧贴着的黑影；只有大片雪地、白墙这种才换深色字。
const BARE_DARK_LUM = 0.42;

function veilOf(light) {
  if (root.dataset.palette === 'wall' && wallScheme) return wallScheme.veil[light ? 'light' : 'dark'];
  return (VEIL[root.dataset.palette] || VEIL.indigo)[light ? 1 : 0];
}

function applyGlass() {
  const s = S.settings;
  const light = root.dataset.theme === 'light';
  const t = Math.max(0, Math.min(1, s.tint / 100));
  const drawn = s.blur && !root.classList.contains('no-wp'); // 玻璃里画着模糊的壁纸
  const glass = Math.min(1, t / 0.25);
  let veil = light ? 1 - Math.pow(1 - t, 1.5) : t;          // 浅色玻璃要实一些才干净
  if (s.blur && !drawn) veil = 1 - Math.pow(1 - veil, 2);   // 想要模糊却读不到壁纸：底色再实一些
  const covered = veil * glass;
  // 背后是清晰的桌面时（玻璃很透，或者没画模糊），给文字垫一层贴边的影子
  const halo = drawn ? 1 - glass : Math.max(0, Math.min(1, (0.7 - covered) / 0.7));

  const wall = wallRgb || [96, 96, 104]; // 不知道壁纸什么样，按偏暗的灰算
  const veilRgb = veilOf(light); // 和 style.css 里各配色的 --bg 一致
  const boost = light && drawn ? 1.12 : 1;
  const seen = (rgb) => luminance(rgb.map((c, i) => {
    const inner = Math.min(255, c * boost) * (1 - veil) + veilRgb[i] * veil;
    return c * (1 - glass) + inner * glass;
  }));
  const lum = seen(wall);
  let ink;
  if (glass < 0.5) {
    // 很透：字直接压在壁纸上。上、中、下三段分开量，最暗的一段说了算（一片亮云不能把压在暗山上的字也带成深色）
    const low = Math.min.apply(null, (wallZones || [wall]).map(seen));
    ink = low >= BARE_DARK_LUM ? 'dark' : 'light';
  } else {
    ink = (light ? lum >= 0.17 : lum > 0.26) ? 'dark' : 'light';
  }
  root.dataset.ink = ink;
  // 设置和详情：玻璃越透，底色越往 --pop 靠；底色和文字深浅对不上时（浅色玻璃配浅色字）直接用 --pop
  const clash = light === (ink === 'light');
  const solidify = clash ? 1 : Math.max(0, Math.min(1, (0.45 - covered) / 0.45));
  root.style.setProperty('--solidify', solidify.toFixed(3));
  root.style.setProperty('--tint', veil.toFixed(3));
  root.style.setProperty('--glass', glass.toFixed(3));
  root.style.setProperty('--halo', halo.toFixed(3));
  root.classList.toggle('bare', halo > 0.02);
  applyWallPalette(light, ink);
}

// “跟随壁纸”：把取出来的那套颜色写成变量。字的深浅一变，强调色要换另一套（对比度是分别配的），所以跟在 applyGlass 后面。
const WALL_VARS = ['--bg', '--accent', '--accent-rgb', '--accent-ink', '--on-accent'];
function applyWallPalette(light, ink) {
  const on = root.dataset.palette === 'wall' && !!wallScheme;
  let pack = null;
  if (on) {
    const a = wallScheme[ink === 'dark' ? 'onLight' : 'onDark'];
    const veil = wallScheme.veil[light ? 'light' : 'dark'];
    pack = { bg: veil, accent: Monet.hex(a.accent), ink: Monet.hex(a.ink), on: Monet.hex(a.on) };
    root.style.setProperty('--bg', veil.join(' '));
    root.style.setProperty('--accent', pack.accent);
    root.style.setProperty('--accent-rgb', a.accent.join(' '));
    root.style.setProperty('--accent-ink', pack.ink);
    root.style.setProperty('--on-accent', pack.on);
  } else WALL_VARS.forEach((v) => root.style.removeProperty(v));
  // 快速记录窗口用同一套（它读不到壁纸）
  try {
    if (wallScheme) localStorage.setItem('jinjian-wall', JSON.stringify({ dark: { bg: wallScheme.veil.dark, accent: Monet.hex(wallScheme.onDark.accent), on: Monet.hex(wallScheme.onDark.on) }, light: { bg: wallScheme.veil.light, accent: Monet.hex(wallScheme.onLight.ink), on: Monet.hex(wallScheme.onLight.on), solid: Monet.hex(wallScheme.onLight.accent) } }));
  } catch (err) { /* 存不了就算了 */ }
}

const PALETTES = ['indigo', 'graphite', 'wall'];
const paletteOf = () => (PALETTES.indexOf(S.settings.palette) >= 0 ? S.settings.palette : 'indigo');

function applySettings() {
  const s = S.settings;
  const light = s.theme === 'light' || (s.theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  root.dataset.theme = light ? 'light' : 'dark';
  root.dataset.palette = paletteOf();
  root.classList.toggle('no-blur', !s.blur);
  applyGlass();
  // 快速记录窗口和这里是同一个来源，读得到这两条
  try {
    localStorage.setItem('jinjian-theme', root.dataset.theme);
    localStorage.setItem('jinjian-palette', root.dataset.palette);
  } catch (err) { /* 存不了就算了 */ }
  if (TAURI && TAURI.event && TAURI.event.emit) {
    TAURI.event.emit('theme', root.dataset.theme).catch(() => {});
    TAURI.event.emit('palette', root.dataset.palette).catch(() => {});
  }
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
  Array.prototype.forEach.call($('s-palette').children, (b) => b.setAttribute('aria-pressed', b.dataset.v === paletteOf() ? 'true' : 'false'));
  Array.prototype.forEach.call($('s-corner').children, (b) => b.setAttribute('aria-pressed', b.dataset.v === cornerOf() ? 'true' : 'false'));
  Array.prototype.forEach.call($('s-layer').children, (b) => b.setAttribute('aria-pressed', (b.dataset.v === 'top') === !!s.top ? 'true' : 'false'));
  $('s-tint').value = s.tint;
  $('s-tint-text').textContent = s.tint + '%';
  $('s-switches').innerHTML = SWITCHES.map((x) => switchHtml('sw', x.k, x.name, x.k === 'lock' ? S.locked : !!s[x.k], { tip: x.tip })).join('');
  // 全局快捷键被别的程序占了：在这里说一声是哪几个
  $('s-keys').hidden = !hotkeysTaken.length;
  $('s-keys').textContent = hotkeysTaken.length ? hotkeysTaken.join('、') + ' 被别的程序占用，暂时用不了' : '';
  fillImport();
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
    S.settings.sync = { on: true, user: user, cals: found.map((c) => Object.assign({ on: true }, c, { href: normCal(c.href) })), target: '' };
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
  [pushTimers, retryTimers, delTimers].forEach((t) => Object.keys(t).forEach((h) => { clearTimeout(t[h]); delete t[h]; }));
  Object.keys(retries).forEach((h) => delete retries[h]);
  Object.keys(moved).forEach((h) => delete moved[h]);
  H.forget((c) => c.t === 'res' || (c.t === 'extra' && /^[rs]\|/.test(c.id))); // iCloud 上的改动断开后撤销不了了
  if (user) call('cred_delete', { user: user }).catch(() => {});
  S.items.forEach((it) => { delete it.cal; });
  S.settings.sync = { on: false, user: user, cals: [], target: '' };
  S.remote = { res: {}, cals: {}, gone: {}, at: 0 };
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
  if (edgeHidden) add($('edge-bar'));
  else if (S.compact === 'capsule') add($('capsule'));
  else add($('shell'));
  if ($('panel').classList.contains('on')) add($('panel'));
  if ($('settings').classList.contains('on')) add($('settings'));
  if ($('toast').classList.contains('on')) add($('toast'));
  if (!$('scope').hidden) add($('scope'));
  if (!$('quick-chips').hidden && !edgeHidden) add($('quick-chips'));
  invoke('set_hit_rects', { rects: rects }).catch(() => {});
}

let rectTimer = null;
function sendRectsSoon() {
  sendRects();
  clearTimeout(rectTimer);
  rectTimer = setTimeout(sendRects, 560);
}

// ---------- 停靠的角、宽度、窗口在屏幕上的位置（0.8.1） ----------
// 窗口由外壳摆（set_corner：贴工作区的左边或右边，高度占满工作区）；上下、左右怎么靠是 CSS 的事（html 上的 data-corner）。
// 外壳把窗口、显示器、工作区的范围交回来（geo，物理像素），这里换算成 CSS 用的几个数。浏览器预览里没有外壳，geo 是 null，当作窗口就是整块屏幕。

const CORNERS = ['tl', 'tr', 'bl', 'br'];
const W_MIN = 320;
const W_MAX = 480;
const W_DEF = 372;
let geo = null;

const cornerOf = () => (CORNERS.indexOf(S.settings.corner) >= 0 ? S.settings.corner : 'tr');
const atLeft = () => cornerOf().charAt(1) === 'l';
const atBottom = () => cornerOf().charAt(0) === 'b';
const geoScale = () => (geo && geo.scale) || window.devicePixelRatio || 1;
// 屏幕（壁纸铺满的范围）和工作区的大小，CSS 像素
const screenSize = () => (geo ? [geo.mon[2] / geoScale(), geo.mon[3] / geoScale()] : invoke ? [window.screen.width, window.screen.height] : [window.innerWidth, window.innerHeight]);
const workHeight = () => (geo ? geo.work[3] / geoScale() : invoke ? window.screen.availHeight : window.innerHeight);
// 窗口太窄（小屏幕、缩放很大）放不下“详情 + 最宽的小组件”时，最宽就到放得下为止
function widthOf() {
  const room = (geo ? geo.win[2] / geoScale() : window.innerWidth) - 428; // 详情 380 + 间距 16 + 两侧各 24，留 8
  const max = Math.max(W_MIN, Math.min(W_MAX, Math.floor(room)));
  const w = Number(S.settings.width);
  return Math.max(W_MIN, Math.min(max, Number.isFinite(w) && w > 0 ? Math.round(w) : W_DEF));
}

// 把停靠的角、宽度、窗口边到屏幕边的距离写给 CSS；玻璃里的壁纸靠这几个数对到屏幕上
function applyGeo() {
  const k = geoScale();
  let ex = 0;
  let ey = 0;
  if (geo) {
    ex = (atLeft() ? geo.win[0] - geo.mon[0] : geo.mon[0] + geo.mon[2] - geo.win[0] - geo.win[2]) / k;
    ey = (atBottom() ? geo.mon[1] + geo.mon[3] - geo.win[1] - geo.win[3] : geo.win[1] - geo.mon[1]) / k;
  }
  root.dataset.corner = cornerOf();
  root.style.setProperty('--ex', ex + 'px');
  root.style.setProperty('--ey', ey + 'px');
  root.style.setProperty('--w', widthOf() + 'px');
  root.style.setProperty('--big-w', bigSize()[0] + 'px');
  // 详情 / 设置在小组件旁边放不放得下：放不下就收窄，再放不下（窗口不到 620 宽）就盖在小组件上面
  const room = Math.floor(winWidth() - widthOf() - 64);
  root.style.setProperty('--panel-w', Math.max(260, Math.min(380, room)) + 'px');
  root.classList.toggle('stacked', room < 260);
  root.classList.toggle('narrow', widthOf() < W_DEF); // 比默认窄：头上的图标收紧（style.css 里的 .narrow）
}

// 外壳的高度：工作区放得下多少就多少，不设 480 的下限（1280×720 配 150% 缩放时工作区只有 430 多，硬撑到 480 底栏就被截掉了）
function layout() {
  root.style.setProperty('--shell-h', Math.max(240, Math.min(864, workHeight() - 48)) + 'px');
}

// 窗口有多宽（CSS 像素）。浏览器预览里窗口就是整个视口
const winWidth = () => (geo ? geo.win[2] / geoScale() : window.innerWidth);
// 展开的月视图 / 周视图多大：最宽 768，窗口窄（竖屏、缩放大）就跟着窄，不横向溢出
const bigSize = () => [Math.max(320, Math.min(768, Math.floor(winWidth() - 48))), Math.min(640, parseFloat(getComputedStyle(root).getPropertyValue('--shell-h')) || 864)];

// 让外壳按停靠的角摆窗口，再把界面对上。quiet：启动时用，窗口本来就还没显示出东西，不用藏。
let dockSeq = 0;
async function dockWindow(quiet) {
  const seq = (dockSeq += 1);
  if (!quiet) root.classList.add('docking');
  if (invoke) {
    try { geo = (await invoke('set_corner', { corner: cornerOf() })) || null; } catch (err) { geo = null; }
    if (seq !== dockSeq) return; // 又选了别的角，以后一次为准
  }
  applyGeo();
  layout();
  if (!quiet) {
    render();
    loadWallpaper(); // 文字深浅看的是小组件背后那一块壁纸，换了角要重新量
    // 等这一帧画完再显示
    requestAnimationFrame(() => requestAnimationFrame(() => { if (seq === dockSeq) root.classList.remove('docking'); }));
  }
}

// 分辨率、缩放、任务栏变了：窗口要重新摆。20 秒一次的刷新里顺便看
const screenSig = () => [window.screen.width, window.screen.height, window.screen.availWidth, window.screen.availHeight, window.devicePixelRatio].join(',');
let lastScreen = '';
function checkScreen() {
  if (screenSig() === lastScreen) return;
  lastScreen = screenSig();
  dockWindow(false);
}

// ---------- 拖边改宽 ----------
let sizing = null;

function setWidth(w) {
  S.settings.width = Math.max(W_MIN, Math.min(W_MAX, Math.round(w)));
  S.settings.width = widthOf();
  applyGeo();
  applyMode();
}

function gripEnd() {
  if (!sizing) return;
  const g = $('grip');
  try { g.releasePointerCapture(sizing.pid); } catch (err) { /* 已经松开了 */ }
  sizing = null;
  root.classList.remove('resizing');
  holdHit(false);
  save();
  render();
}

function bindGrip() {
  const g = $('grip');
  g.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || sizing) return;
    e.preventDefault();
    sizing = { pid: e.pointerId, x0: e.clientX, w0: widthOf() };
    root.classList.add('resizing'); // 跟手：拖的时候不走过渡
    holdHit(true);                  // 往外拖宽时指针会跑到玻璃外面，不能变成穿透
    try { g.setPointerCapture(e.pointerId); } catch (err) { /* 抓不到也能拖 */ }
  });
  g.addEventListener('pointermove', (e) => {
    if (!sizing || e.pointerId !== sizing.pid) return;
    // 靠右时往左拖是变宽，靠左时往右拖是变宽
    setWidth(sizing.w0 + (e.clientX - sizing.x0) * (atLeft() ? 1 : -1));
  });
  g.addEventListener('pointerup', gripEnd);
  g.addEventListener('pointercancel', gripEnd);
  g.addEventListener('dblclick', () => { setWidth(W_DEF); save(); render(); });
  g.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setWidth(widthOf() + ((e.key === 'ArrowLeft') === atLeft() ? -8 : 8));
    save();
    render();
  });
  window.addEventListener('blur', gripEnd);
}

// 把壁纸按屏幕上的样子画到一张小画布上（64 像素宽），量两样东西：
//   1. 小组件背后（它停靠的那个角）那一块的颜色，整块的平均，再分上、中、下三段各算一次，用来决定文字用浅色还是深色；
//   2. 整张壁纸的像素，交给 Monet 取“主情绪色”（“跟随壁纸”配色用）。
// box：壁纸在屏幕上占的位置 { x, y, w, h }（CSS 像素，可以超出屏幕）。
function sampleWall(img, sw, sh, box) {
  try {
    const W = 64;
    const H = Math.max(1, Math.round((W * sh) / sw));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const k = W / sw;
    g.drawImage(img, box.x * k, box.y * k, box.w * k, box.h * k); // 和屏幕上一样的摆法
    const nx = Math.max(1, Math.min(W, Math.ceil(W * ((widthOf() + 28) / sw))));
    const ny = Math.max(1, Math.min(H, Math.ceil((H * 900) / sh)));
    const x0 = atLeft() ? 0 : W - nx;
    const y0 = atBottom() ? H - ny : 0;
    const mean = (y, h) => {
      const d = g.getImageData(x0, y, nx, Math.max(1, h)).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
      const n = d.length / 4;
      return [sum[0] / n, sum[1] / n, sum[2] / n];
    };
    const third = Math.max(1, Math.floor(ny / 3));
    return {
      avg: mean(y0, ny),
      zones: ny >= 3 ? [mean(y0, third), mean(y0 + third, third), mean(y0 + 2 * third, ny - 2 * third)] : null,
      scheme: Monet.scheme(g.getImageData(0, 0, W, H).data, 8),
    };
  } catch (err) {
    return null; // 图片不让读像素（浏览器预览里的跨域图片）
  }
}

// 壁纸在屏幕上怎么摆（Windows“选择契合度”）：fill 填充（铺满、裁掉多的）/ fit 适应（整张放进去）/ stretch 拉伸 / center 居中（原大）。
// 平铺、跨区按填充算。返回它在屏幕上占的位置，玻璃内部据此对位。
function wallBox(style, iw, ih, sw, sh) {
  const dpr = geoScale();
  let w = iw;
  let h = ih;
  if (style === 'stretch') { w = sw; h = sh; } else if (style === 'center') { w = iw / dpr; h = ih / dpr; } else {
    const k = style === 'fit' ? Math.min(sw / iw, sh / ih) : Math.max(sw / iw, sh / ih);
    w = iw * k;
    h = ih * k;
  }
  return { x: (sw - w) / 2, y: (sh - h) / 2, w: w, h: h };
}

function setWall(sample) {
  wallRgb = sample ? sample.avg : null;
  wallZones = sample ? sample.zones : null;
  wallScheme = sample ? sample.scheme : null;
  applyGlass();
}

function showWallpaper(url, sw, sh, plain, style) {
  const img = new Image();
  const blob = /^(blob|data):/.test(url);
  const cors = !plain && !blob;
  if (cors) img.crossOrigin = 'anonymous'; // 只有浏览器预览会走到这里
  img.onload = () => {
    const box = wallBox(style || 'fill', img.naturalWidth, img.naturalHeight, sw, sh);
    root.style.setProperty('--wp', 'url("' + url + '")');
    root.style.setProperty('--wp-size', box.w + 'px ' + box.h + 'px');
    root.style.setProperty('--ox', (-box.x) + 'px');
    root.style.setProperty('--oy', (-box.y) + 'px');
    root.classList.remove('no-wp');
    // 上一张壁纸的 blob 地址到这里才没人用了：释放掉。不释放的话每换一次壁纸（换角、分辨率变了也会重读）就留一整张图在内存里
    if (wallUrl && wallUrl !== url) URL.revokeObjectURL(wallUrl);
    wallUrl = blob && url.indexOf('blob:') === 0 ? url : '';
    setWall(sampleWall(img, sw, sh, box));
  };
  img.onerror = () => {
    if (cors) { showWallpaper(url, sw, sh, true, style); return; }
    if (url.indexOf('blob:') === 0) URL.revokeObjectURL(url);
    root.classList.add('no-wp');
    setWall(null);
  };
  img.src = url;
}

// 桌面是纯色（没有壁纸图片）：玻璃里不画图，文字深浅、“跟随壁纸”的颜色按那个纯色算
function showSolid(rgb) {
  root.classList.add('no-wp');
  root.style.setProperty('--wp', 'none');
  if (wallUrl) { URL.revokeObjectURL(wallUrl); wallUrl = ''; }
  const data = new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], 255]);
  setWall({ avg: rgb, zones: null, scheme: Monet.scheme(data, 1) });
}

let wallSeq = 0;
async function loadWallpaper() {
  const seq = (wallSeq += 1);
  if (invoke) {
    let info = null;
    try { info = await invoke('wallpaper_info'); } catch (err) { info = null; }
    if (seq !== wallSeq) return;
    if (info && info.solid && Array.isArray(info.color)) { showSolid(info.color); return; }
    try {
      const bytes = await invoke('wallpaper');
      if (seq !== wallSeq) return; // 读的这会儿又换了一张：以后一次为准
      const size = screenSize();
      showWallpaper(URL.createObjectURL(new Blob([bytes])), size[0], size[1], false, info && info.style);
    } catch (err) {
      console.warn('读不到壁纸，改用实色底', err);
      if (info && Array.isArray(info.color)) showSolid(info.color);
    }
    return;
  }
  const wp = new URLSearchParams(location.search).get('wp'); // 浏览器预览：?wp=图片地址
  if (wp) showWallpaper(wp, window.innerWidth, window.innerHeight);
}

// ---------- 贴边自动收起（0.9.0） ----------
// 开着时：平常滑到停靠的那条屏幕边外面，只露一条 4 像素的细线（#edge-bar，高度是当前日程的进度，慢慢呼吸）。
// 外壳盯着鼠标：在那条边上停一下就发 edge-peek（滑出来）；移开一会儿发 edge-leave，这边没在打字、没开着气泡、没在拖东西才收回去。

let edgeHidden = false;

function edgeBusy() {
  const el = document.activeElement;
  const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
  return typing || composing || !!S.panel || !!S.pop || S.search || S.cmd || !!S.ask || !!drag || !!sizing || $('toast').classList.contains('on') || !!Object.keys(pend).length;
}

function setEdgeHidden(hidden) {
  const want = !!hidden && !!S.settings.edge;
  if (want === edgeHidden) return;
  edgeHidden = want;
  root.classList.toggle('edge-hidden', want);
  call('set_edge_hidden', { hidden: want }).catch(() => {});
  sendRectsSoon();
}

function checkReminders() {
  if (!invoke) return;
  const t = today();
  const n = nowMin();
  if (S.notified.day !== t) S.notified = { day: t, ids: {} };
  allItems().forEach((it) => {
    if (it.kind === 'todo') {
      const due = toMin(it.due);
      const key = 'due|' + it.id + '@' + it.due;
      if (it.done || it.date !== t || due === null || S.notified.ids[key]) return;
      if (n >= due && n <= due + 10) {
        S.notified.ids[key] = 1;
        call('notify', { title: it.title || '待办', body: '到截止时间了 · ' + it.due }).catch(() => {});
        save();
      }
      return;
    }
    // 提醒是数字 0（到点提醒）时不能被当成“没设”
    if (it.kind !== 'event' || it.date !== t || it.allDay || remindOf(it) === 'none') return;
    const s = toMin(it.start);
    const before = Number(remindOf(it));
    const key = it.id + '@' + it.start + '@' + before;
    if (s === null || isNaN(before) || S.notified.ids[key]) return;
    // 到点提醒只有“正好这一分钟”一个机会，20 秒一轮的检查万一被系统拖了一下就错过了：往后多留两分钟
    if (n >= s - before && n <= s + (before === 0 ? 2 : 0)) {
      S.notified.ids[key] = 1;
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
    record('便签', '', () => { S.note = (S.note ? S.note.replace(/\s+$/, '') + '\n' : '') + p.raw; });
    $('note').value = S.note;
    save();
  } else if (p.kind === 'event') {
    addItem('event', { title: p.title, date: p.date || today(), start: p.time || '', end: p.endTime || '', place: p.place || '', rrule: p.rrule || '' }, false);
  } else {
    addItem('todo', { title: p.title, date: p.date || today(), due: p.time || '', place: p.place || '', rrule: p.rrule || '' }, false);
  }
  render();
}

// ---------- 记一笔：识别出来的东西排成一排小胶囊，点一下某个就是“这个不算” ----------

let quickOff = {};
const QUICK_KINDS = { repeat: '重复', date: '日期', time: '时间', place: '地点' };

function quickParse() {
  const text = $('quick-input').value.trim();
  return text ? { text: text, q: parseQuick(text, new Date(), quickOff) } : null;
}

function renderQuickChips() {
  const box = $('quick-chips');
  const p = quickParse();
  const chips = [];
  if (p) {
    const q = p.q;
    const date = q.date || S.date;
    if (q.rrule) chips.push(['repeat', q.repeatLabel]);
    if (q.date) { const d = fromIso(q.date); chips.push(['date', (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WK.charAt(d.getDay())]); }
    if (q.time) chips.push(['time', q.time + (q.endTime ? '–' + (q.endNextDay ? '23:59' : q.endTime) : '') + (q.isDeadline ? ' 截止' : '')]);
    if (q.place) chips.push(['place', q.place]);
    Object.keys(quickOff).forEach((k) => { if (quickOff[k]) chips.push([k, QUICK_KINDS[k], true]); });
    // 有具体时间的日程：和那天已有的撞不撞
    if (q.time && !q.isDeadline) {
      const s0 = toMin(q.time);
      const e0 = q.endTime && !q.endNextDay && toMin(q.endTime) > s0 ? toMin(q.endTime) : Math.min(1440, s0 + 60);
      const hit = dayBusy(date).find((x) => x.start < e0 && s0 < x.end);
      if (hit) chips.push(['warn', '与「' + hit.title + '」重叠']);
    }
  }
  box.hidden = chips.length === 0;
  setHtml(box, chips.map((c) => (c[0] === 'warn'
    ? '<span class="qchip warn">' + esc(c[1]) + '</span>'
    : '<button type="button" class="qchip tap' + (c[2] ? ' off' : '') + '" data-act="quick-chip" data-k="' + c[0] + '" aria-pressed="' + (c[2] ? 'false' : 'true') + '" aria-label="' + esc(QUICK_KINDS[c[0]] + '：' + c[1]) + '">' + esc(c[1]) + '</button>')).join(''));
  sendRectsSoon();
}

function submitQuick() {
  const input = $('quick-input');
  const p = quickParse();
  if (!p) return;
  const q = p.q;
  input.value = '';
  quickOff = {};
  renderQuickChips();
  // 只写了时间没写日期，就落在当前看的那天；有具体时间的存成日程，其余存成待办
  const date = q.date || S.date;
  const more = { title: q.title || p.text, date: date, place: q.place || '', rrule: q.rrule || '' };
  // “3点前交周报”是截止时间，记成待办；日程目前只能在一天之内，跨午夜的时间段记到当天 23:59
  if (q.time && !q.isDeadline) addItem('event', Object.assign(more, { start: q.time, end: q.endTime ? (q.endNextDay ? '23:59' : q.endTime) : '' }), false);
  else addItem('todo', Object.assign(more, { due: q.time || '' }), false);
  if (date !== S.date) {
    showToast('已添加到 ' + dayLabel(date), '去看看', () => {
      const d = fromIso(date);
      S.date = date;
      S.mode = 'day';
      S.vm = { y: d.getFullYear(), m: d.getMonth() };
      render();
    });
  }
}

// ---------- 导出备份 / 导入 ----------

const VERSION = '0.9.0';
const stamp = () => { const d = new Date(); return iso(d) + '-' + pad(d.getHours()) + pad(d.getMinutes()); };

// 存一个文件：外壳写到“下载”文件夹；浏览器预览里走普通的下载
async function saveFile(name, text) {
  if (invoke) {
    try { await invoke('export_file', { name: name, text: text }); showToast('已导出到“下载”：' + name); } catch (err) { showToast('导出失败：' + (err && err.message ? err.message : err)); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  showToast('已导出 ' + name);
}

function exportBackup(kind) {
  if (kind === 'ics') {
    const mirror = Object.keys(S.remote.res).map((h) => S.remote.res[h].ics);
    return saveFile('今笺-' + stamp() + '.ics', Backup.exportIcs(S.items, { tz: localTz(), mirror: mirror }));
  }
  return saveFile('今笺备份-' + stamp() + '.json', Backup.exportJson({ items: S.items, note: S.note, extras: S.extras, settings: S.settings, remote: S.remote }, { version: VERSION }));
}

// 读进来先只给预览（新增 / 已有 / 冲突 / iCloud 里已有），点“导入”才写
function previewImport(name, text) {
  const data = Backup.read(text);
  if (!data.ok) { showToast(data.error); return; }
  S.imp = { name: name, data: data, plan: Backup.plan(S.items, data.items, remoteUids), clash: 'both' };
  setSel(null);
  S.panel = 'settings';
  fillSettings();
  render();
}

function readImport(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { showToast('文件太大了'); return; }
  const r = new FileReader();
  r.onload = () => previewImport(file.name, String(r.result || ''));
  r.onerror = () => showToast('读不了这个文件');
  r.readAsText(file);
}

function fillImport() {
  const box = $('s-import');
  const m = S.imp;
  box.hidden = !m;
  if (!m) return;
  const p = m.plan;
  const note = m.data.note && Backup.mergeNote(S.note, m.data.note) !== S.note;
  const bits = ['新增 ' + p.add.length];
  if (p.dup.length) bits.push('已有 ' + p.dup.length);
  if (p.clash.length) bits.push('冲突 ' + p.clash.length);
  if (p.mirror.length) bits.push('iCloud 已有 ' + p.mirror.length);
  if (note) bits.push('便签');
  $('s-import-name').textContent = m.name;
  $('s-import-text').textContent = bits.join(' · ');
  $('s-import-clash').hidden = !p.clash.length;
  Array.prototype.forEach.call($('s-import-clash').children, (b) => b.setAttribute('aria-pressed', b.dataset.v === m.clash ? 'true' : 'false'));
  $('s-import-go').disabled = !(p.add.length || (p.clash.length && m.clash !== 'skip') || note);
}

function applyImport() {
  const m = S.imp;
  if (!m) return;
  let n = 0;
  record('导入 ' + m.name, '', () => {
    const out = Backup.apply(S.items, m.plan, m.clash, (k) => uid(k === 'event' ? 'e' : k === 'todo' ? 't' : 's'));
    S.items = Recur.normalize(out.items);
    n = out.added + out.replaced;
    S.note = Backup.mergeNote(S.note, m.data.note);
    // 备份里挂在 iCloud 日程上的附加内容：现在没有的才拿，不盖现在的
    Object.keys(m.data.extras || {}).forEach((k) => { if (!(k in S.extras) && /^r\|/.test(k)) S.extras[k] = m.data.extras[k]; });
  });
  $('note').value = S.note;
  S.imp = null;
  save();
  fillSettings();
  render();
  undoToast('已导入 ' + n + ' 条');
}

// ---------- Ctrl + K：快捷指令条。平时完全不显示、不占地方 ----------

let cmdHits = [];
let cmdIdx = 0;

function freeText() {
  const t = today();
  const from = Math.max(8 * 60, Math.ceil(nowMin() / 15) * 15);
  const gaps = Slots.free(dayBusy(t), from, 22 * 60, 30);
  const d = fromIso(t);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WK.charAt(d.getDay()) + ' 空档：' + (gaps.length ? gaps.map((g) => Week.fromMin(g.start) + '–' + Week.fromMin(g.end)).join('、') : '没有了');
}

// 这一周（周日起）做完的待办和开过的日程，写成一份 Markdown
function weekReport() {
  const keys = Week.weekKeys(today());
  const map = byDate();
  const lines = ['# 完成周报 ' + keys[0] + ' – ' + keys[6], ''];
  let done = 0;
  keys.forEach((k) => {
    const list = map[k] || [];
    const tds = list.filter((x) => x.kind === 'todo' && x.done);
    const evs = sortEvents(list).filter((e) => phase(e) === 'past');
    if (!tds.length && !evs.length) return;
    const d = fromIso(k);
    lines.push('## ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WK.charAt(d.getDay()));
    tds.forEach((x) => { lines.push('- [x] ' + (x.title || '未命名')); done += 1; });
    evs.forEach((e) => lines.push('- ' + (e.allDay ? '全天' : e.start + (e.end ? '–' + e.end : '')) + ' ' + (e.title || '未命名') + (e.place ? '（' + e.place + '）' : '')));
    lines.push('');
  });
  const open = keys.reduce((n, k) => n + (map[k] || []).filter((x) => x.kind === 'todo' && !x.done).length, 0);
  lines.push('完成 ' + done + ' 项，未完成 ' + open + ' 项');
  return lines.join('\n') + '\n';
}

async function copyText(text, okText) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); } catch (e2) { /* 复制不了就算了 */ }
    t.remove();
  }
  showToast(okText);
}

const COMMANDS = [
  { n: '今天', k: 'jintian today', run: () => onAct('go-today', document.body) },
  { n: '小组件', k: 'xiaozujian day widget', run: () => { S.big = false; S.mode = 'day'; S.pop = null; render(); } },
  { n: '月历', k: 'yueli calendar', run: () => { S.big = false; S.mode = 'cal'; render(); } },
  { n: '月视图', k: 'yueshitu month', run: () => { if (!S.big) { S.prevMode = S.mode; S.big = true; } S.week = false; render(); } },
  { n: '周视图', k: 'zhoushitu week', run: () => { if (!S.big) { S.prevMode = S.mode; S.big = true; } if (!S.week) S.date = Week.anchor(S.vm, S.date, today()); S.week = true; render(); } },
  { n: '新建日程', k: 'xinjian richeng event new', run: () => onAct('add-event', document.body) },
  { n: '新建待办', k: 'xinjian daiban todo new', run: () => onAct('add-todo', document.body) },
  { n: '搜索', k: 'sousuo search find', run: () => openSearch() },
  { n: '复制今日空档', k: 'fuzhi kongdang free copy', run: () => copyText(freeText(), '已复制今日空档') },
  { n: '导出完成周报', k: 'daochu zhoubao report', run: () => { const text = weekReport(); copyText(text, '周报已复制'); saveFile('今笺周报-' + Week.weekStart(today()) + '.md', text); } },
  { n: '导出备份（JSON）', k: 'daochu beifen backup json', run: () => exportBackup('json') },
  { n: '导出日历（.ics）', k: 'daochu rili ics', run: () => exportBackup('ics') },
  { n: '同步', k: 'tongbu sync icloud', run: () => syncNow(true) },
  { n: '撤销', k: 'chexiao undo', run: () => undo() },
  { n: '重做', k: 'chongzuo redo', run: () => redo() },
  { n: '设置', k: 'shezhi settings', run: () => { setSel(null); S.panel = 'settings'; fillSettings(); render(); } },
  { n: '收起成迷你条', k: 'shouqi mini compact', run: () => onAct('compact', document.body) },
];

function runCmdSearch() {
  const q = $('cmd-input').value.trim().toLowerCase();
  cmdHits = COMMANDS.filter((c) => !q || c.n.toLowerCase().indexOf(q) >= 0 || q.split(/\s+/).every((w) => c.k.indexOf(w) >= 0 || c.n.indexOf(w) >= 0));
  cmdIdx = 0;
  renderCmd();
}

function renderCmd() {
  setHtml($('cmd-list'), cmdHits.map((c, i) => '<button type="button" class="prow cmd tap' + (i === cmdIdx ? ' on' : '') + '" role="option" id="cmd-' + i + '" aria-selected="' + (i === cmdIdx) + '" data-act="cmd-run" data-i="' + i + '"><span class="pn ellipsis">' + esc(c.n) + '</span></button>').join('')
    || '<div class="pempty">没有这个指令</div>');
  if (cmdHits.length) $('cmd-input').setAttribute('aria-activedescendant', 'cmd-' + cmdIdx); else $('cmd-input').removeAttribute('aria-activedescendant');
}

function openCmd() {
  if (S.search) closeSearch(false);
  if (!S.cmd) {
    S.cmdBack = S.compact;
    S.compact = '';
    S.cmd = true;
    $('cmd-input').value = '';
    runCmdSearch();
    render();
  }
  $('cmd-input').focus();
}

function closeCmd(restore) {
  if (!S.cmd) return;
  S.cmd = false;
  $('cmd-input').blur();
  if (restore) S.compact = S.cmdBack || '';
  render();
}

function runCmd(i) {
  const c = cmdHits[i];
  if (!c) return;
  closeCmd(false);
  c.run();
}

// ---------- 提示 ----------

let tipTimer = null;
let tipFor = null;
let tipMute = null; // 刚点过的按钮：鼠标离开之前不再弹它的名字
let tipPin = 0;     // 这个时刻之前不收：主动弹出来的提示（按钮随后就消失了）要留一会儿

function showTip(el) {
  const text = el.dataset.tip;
  const tip = $('tip');
  if (!text || !el.isConnected) return;
  tipPin = 0;
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
  if (Date.now() < tipPin) return;
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

// 切换视图、翻月、回今天、选别的日期：开着的详情 / 设置跟着收起
function shutPanel() {
  if (!S.panel) return;
  setSel(null);
  S.panel = '';
}

function shiftWeek(step) {
  S.date = Week.addDays(S.date, 7 * step);
  const d = fromIso(S.date);
  S.vm = { y: d.getFullYear(), m: d.getMonth() };
  S.pop = null;
  setSel(null);
  S.panel = '';
  replay($('week'), 'fade');
}

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
    // 展开的月视图里点“+ 日程”：落在正在看的那个月里（S.vm），不是落在别的月份里还选着的那一天
    case 'add-event': S.settings.fold.ev = false; addItem('event', { date: S.big && !S.week ? Week.anchor(S.vm, S.date, today()) : S.date }, true); return;
    case 'add-todo': S.settings.fold.td = false; addItem('todo', { date: S.date }, true); return;
    case 'carry-now': {
      const t0 = today();
      record('移到今天', '', () => plainItems().forEach((x) => { if (x.kind === 'todo' && !x.done && x.date < t0) x.date = t0; }));
      save();
      replay($('todos'), 'swap');
      break;
    }
    case 'fold': {
      const k = t.dataset.k;
      S.settings.fold[k] = !S.settings.fold[k];
      save();
      break;
    }
    case 'day-prev': case 'day-next': {
      const d = fromIso(S.date);
      d.setDate(d.getDate() + (act === 'day-next' ? 1 : -1));
      S.date = iso(d);
      S.nav = !!t.closest('#day-nav'); // 用下面那一排翻回今天时，那一排先留着
      S.vm = { y: d.getFullYear(), m: d.getMonth() };
      shutPanel();
      replay($('events'), 'swap');
      replay($('todos'), 'swap');
      break;
    }
    case 'view': {
      const d = fromIso(S.date);
      shutPanel();
      S.nav = false;
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
    case 'compact': setSel(null); S.compact = 'card'; S.panel = ''; S.pop = null; S.nav = false; break;
    case 'dock': S.compact = 'capsule'; break;
    case 'expand': S.compact = ''; break;
    case 'big-open': setSel(null); S.prevMode = S.mode; S.big = true; S.panel = ''; break;
    case 'big-close': S.big = false; S.mode = S.prevMode || 'day'; S.pop = null; break;
    case 'hit': case 'hit-note': openHit(Number(t.dataset.i)); return;
    case 'search-close': closeSearch(true); return;
    case 'prev-month': shutPanel(); if (S.week) shiftWeek(-1); else shiftMonth(-1); break;
    case 'next-month': shutPanel(); if (S.week) shiftWeek(1); else shiftMonth(1); break;
    case 'big-view': {
      const wk = t.dataset.v === 'week';
      if (wk === S.week) return;
      setSel(null);
      S.panel = '';
      S.pop = null;
      if (wk) S.date = Week.anchor(S.vm, S.date, today());
      else { const d = fromIso(S.date); S.vm = { y: d.getFullYear(), m: d.getMonth() }; }
      S.week = wk;
      replay($(wk ? 'week' : 'month-wrap'), 'fade');
      break;
    }
    case 'week-day': {
      const d = fromIso(date);
      shutPanel();
      S.date = date;
      S.vm = { y: d.getFullYear(), m: d.getMonth() };
      S.nav = false;
      break;
    }
    case 'go-today': {
      const d = new Date();
      shutPanel();
      if (S.date !== today()) { replay($('events'), 'swap'); replay($('todos'), 'swap'); }
      S.date = today();
      S.nav = false;
      S.vm = { y: d.getFullYear(), m: d.getMonth() };
      S.pop = null;
      break;
    }
    case 'pick-day': shutPanel(); S.date = date; S.mode = 'day'; S.nav = false; break;
    case 'pop-day': {
      const d = fromIso(date);
      shutPanel();
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
      const v = selView();
      if (!v || isLocked(v)) return;
      const on = !v.allDay;
      const p = { allDay: on };
      if (!on && !v.start) { p.start = '09:00'; p.end = '10:00'; }
      change(v, p, t);
      fillPanel(selView());
      break;
    }
    case 'p-kind': {
      // 本机的日程和待办互相转换；重复条目是整个系列一起换
      if (!cur || cur.remote) return;
      S.ask = null;
      const m = masterOf(cur);
      if (!m) return;
      record(m.kind === 'event' ? '改成待办' : '改成日程', m.draft ? 'new:' + m.id : '', () => {
        if (m.kind === 'event') {
          Object.assign(m, { kind: 'todo', due: m.allDay ? '' : (m.start || ''), done: false, star: false });
          delete m.cal;
        } else {
          const st = m.due || (cur.date === today() ? fromMin(Math.min(23 * 60, Math.ceil((nowMin() + 1) / 30) * 30)) : '09:00');
          Object.assign(m, { kind: 'event', start: st, end: fromMin(Math.min(23 * 60 + 59, toMin(st) + 60)), allDay: false, remind: remindOf(m) !== 'none' ? m.remind : '10' });
          const sync = S.settings.sync;
          if (sync.on && sync.target && !m.lunar) m.cal = sync.target;
        }
      }, !!m.draft);
      // 只是换了类型、什么都没写，关掉时照样不留下“未命名”
      save();
      fillPanel(find(S.sel) || cur);
      replay($('panel-body'), 'fade');
      break;
    }
    case 'p-done':
      if (!cur) return;
      if (!cur.done) {
        // 和列表里勾选一样：先在原位停一下再沉底
        S.justDone = cur.id;
        S.hold[cur.id] = Date.now() + 900;
        setTimeout(render, 950);
      }
      updateItem(cur, { done: !cur.done });
      t.setAttribute('aria-pressed', cur.done ? 'true' : 'false');
      break;
    case 'p-star':
      if (!cur) return;
      updateItem(cur, { star: !cur.star });
      t.setAttribute('aria-pressed', cur.star ? 'true' : 'false');
      break;
    case 'p-count':
      if (!cur) return;
      updateItem(cur, { countdown: !cur.countdown });
      t.setAttribute('aria-pressed', cur.countdown ? 'true' : 'false');
      break;
    case 'cd': jumpTo(id); return;
    case 'p-del': {
      if (!cur) return;
      if (seriesOf(cur)) {
        // 重复条目：问删哪几场
        if (S.ask && S.ask.mode === 'del') { S.ask = null; renderScope(); return; }
        S.ask = { mode: 'del', id: cur.id, patch: null, anchor: t };
        renderScope();
        return;
      }
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
        deleteItem(cur);
        undoToast('已删除「' + (cur.title || '未命名') + '」');
        break;
      }
      // 本机的直接删，底部给“撤销”（之后也能按 Ctrl + Z）
      const worth = !!(cur.title || cur.notes || (cur.subs && cur.subs.length));
      flushFields();
      S.sel = null;
      S.panel = '';
      deleteItem(cur);
      if (worth) undoToast('已删除「' + (cur.title || '未命名') + '」');
      else H.forget((c) => c.t === 'item' && c.id === cur.id); // 什么都没写的草稿：删了就当没建过
      break;
    }
    case 'p-hol': {
      // 遇法定节假日自动跳过：整个系列的开关
      if (!cur) return;
      const on = t.getAttribute('aria-pressed') !== 'true';
      if (cur.remote) setRemoteHol(cur, on); else updateItem(cur, { skipHol: on });
      const now = find(S.sel);
      if (now) fillRepeat(now);
      break;
    }
    case 'p-postpone': {
      // 顺延到这天往后第一个放得下的空档
      const v = selView();
      if (!v || !t.dataset.s) return;
      change(v, v.kind === 'todo' ? { due: t.dataset.s, end: t.dataset.e } : { start: t.dataset.s, end: t.dataset.e }, t);
      if (selView()) fillPanel(selView());
      break;
    }
    case 'free-add': addItem('event', { date: today(), start: t.dataset.s, end: t.dataset.e }, true); return;
    case 'quick-chip': quickOff[t.dataset.k] = !quickOff[t.dataset.k]; renderQuickChips(); $('quick-input').focus(); return;
    case 'export-json': exportBackup('json'); return;
    case 'export-ics': exportBackup('ics'); return;
    case 'import-pick': $('s-file').value = ''; $('s-file').click(); return;
    case 'import-clash': if (S.imp) { S.imp.clash = t.dataset.v; fillImport(); } return;
    case 'import-go': applyImport(); return;
    case 'import-cancel': S.imp = null; fillImport(); sendRectsSoon(); return;
    case 'cmd-run': runCmd(Number(t.dataset.i)); return;
    case 'cmd-close': closeCmd(true); return;
    case 'side': S.side = !S.side; break;
    case 'sub-toggle': case 'sub-remove': {
      const v = selView();
      if (!v) return;
      let fresh = null;
      const subs = act === 'sub-remove'
        ? (v.subs || []).filter((s) => s.id !== id)
        : (v.subs || []).map((s) => {
          if (s.id !== id) return s;
          if (!s.done) fresh = s.id;
          return Object.assign({}, s, { done: !s.done });
        });
      change(v, { subs: subs }, $('p-subs'));
      renderSubs(selView(), fresh);
      break;
    }
    case 'scope': resolveAsk(t.dataset.v, t); return;
    case 'p-wk': {
      const f = repeatForm();
      const d = Number(t.dataset.d);
      const i = f.byday.indexOf(d);
      if (i >= 0) { if (f.byday.length > 1) f.byday.splice(i, 1); } else f.byday.push(d);
      applyRule(f);
      return;
    }
    case 'theme': S.settings.theme = t.dataset.v; applySettings(); save(); fillSettings(); return;
    case 'palette': S.settings.palette = t.dataset.v; applySettings(); save(); fillSettings(); return;
    case 'hide-key': call('summon').catch(() => {}); return;
    case 'corner':
      if (CORNERS.indexOf(t.dataset.v) < 0 || t.dataset.v === cornerOf()) return;
      S.settings.corner = t.dataset.v;
      save();
      fillSettings();
      dockWindow(false);
      return;
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
      if (k === 'edge') { call('set_edge', { on: !!S.settings.edge }).catch(() => {}); if (!S.settings.edge) setEdgeHidden(false); }
      if (k === 'carry') rollOver();
      applySettings();
      save();
      if (k === 'lunar' || k === 'hol') render();
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

// 点在玻璃上没东西的地方（不是按钮、输入框、浮层、某一行、滚动条）
function isBlank(e) {
  const el = e.target;
  if (!(el instanceof Element)) return false;
  if (el.closest('#panel, #settings, #pop, #toast, .tip, [data-act], button, input, textarea, select, label, a, .td, #big-grid .cell')) return false;
  if (el.scrollHeight > el.clientHeight && e.offsetX >= el.clientWidth) return false; // 按在滚动条上
  return true;
}

// 详情里打字的那几处：稍等一下再写（轻防抖）。关详情、换条目、回车、撤销之前先 flushFields()，压着的输入不会丢。
const pend = {};
function typed(id, run) {
  if (pend[id]) clearTimeout(pend[id].timer);
  pend[id] = { run: run, timer: setTimeout(() => { const p = pend[id]; delete pend[id]; if (p) p.run(); }, 90) };
}
function flushFields() {
  Object.keys(pend).forEach((id) => {
    const p = pend[id];
    clearTimeout(p.timer);
    delete pend[id];
    p.run();
  });
}
// 光标在能打字的地方：这时 Ctrl + Z 归系统（撤销刚打的字）
function isTyping(el) {
  if (!(el instanceof Element)) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  return el.tagName === 'INPUT' && /^(text|search|email|password|number|url|tel)$/.test(el.type || 'text');
}

function bind() {
  bindTips();
  let downBlank = false; // 按下和松开都在空白处才算，免得在详情里拖选文字、拖到外面松手时被收起
  $('stage').addEventListener('pointerdown', (e) => { downBlank = isBlank(e); });
  $('stage').addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (t) { onAct(t.dataset.act, t); return; }
    // 月视图里点格子的空白处，也弹出这一天
    const cell = e.target.closest('#big-grid .cell');
    if (cell) { onAct('pop-day', cell); return; }
    // 点空白处：先收当天小窗口，再收详情 / 设置
    if (!downBlank || !isBlank(e)) return;
    if (S.pop) { S.pop = null; render(); } else if (S.panel) closePanels();
  });
  bindGrip();
  // 周视图：拖动
  const wkEl = $('week');
  wkEl.addEventListener('pointerdown', weekDown);
  wkEl.addEventListener('pointermove', weekMove);
  wkEl.addEventListener('pointerup', weekUp);
  wkEl.addEventListener('pointercancel', cancelDrag);
  wkEl.addEventListener('click', (e) => { if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
  window.addEventListener('blur', cancelDrag);
  let scrollRaf = 0;
  $('week-body').addEventListener('scroll', () => {
    if (scrollRaf || !S.big || !S.week || S.panel !== 'detail') return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; positionPanel(); });
  });
  $('toast-btn').addEventListener('click', () => {
    const action = toastAction;
    hideToast();
    if (action) action();
  });

  // Esc 一层一层往回退：当天小窗口 → 详情/设置 → 月视图 → 折叠日历
  window.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    // Ctrl + F：只在小组件有焦点时生效，不注册系统级快捷键；顺便挡掉浏览器自己的查找条
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); closeCmd(false); openSearch(); return; }
    // Ctrl + K：快捷指令条
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (S.cmd) closeCmd(true); else openCmd(); return; }
    // Ctrl + Z 撤销，Ctrl + Shift + Z / Ctrl + Y 重做。光标在输入框里时不管：那是系统自己的“撤销打字”
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[zZyY]$/.test(e.key)) {
      if (isTyping(e.target)) return;
      e.preventDefault();
      if (e.shiftKey || e.key === 'y' || e.key === 'Y') redo(); else undo();
      return;
    }
    if (e.key !== 'Escape') return;
    if (drag) { cancelDrag(); return; }
    if (S.ask) { cancelAsk(); return; }
    if (S.cmd) { closeCmd(true); return; }
    if (S.search) { closeSearch(true); return; }
    if (S.pop) { S.pop = null; render(); return; }
    if (S.panel) { closePanels(); return; }
    if (S.big) { onAct('big-close', document.body); return; }
    if (S.mode === 'cal') { S.mode = 'day'; render(); return; }
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  });

  // 记一笔：回车保存；打字时下面实时排出识别到的小胶囊（输入法组字时不动，组完再认）
  const qInput = $('quick-input');
  let qComp = false;
  let qTimer = null;
  const qLater = () => { clearTimeout(qTimer); qTimer = setTimeout(renderQuickChips, 80); };
  $('quick').addEventListener('submit', (e) => {
    e.preventDefault();
    if (qComp) return;
    clearTimeout(qTimer);
    submitQuick();
  });
  qInput.addEventListener('compositionstart', () => { qComp = true; });
  qInput.addEventListener('compositionend', () => { qComp = false; qLater(); });
  qInput.addEventListener('input', (e) => { if (!qComp && !e.isComposing) { if (!qInput.value.trim()) quickOff = {}; qLater(); } });
  qInput.addEventListener('blur', () => { qComp = false; });

  // 便签：一次连着写的算一步（光标离开便签才封口）；在便签里按 Ctrl + Z 是系统自己的撤销
  $('note').addEventListener('input', (e) => { record('便签', 'note', () => { S.note = e.target.value; }, true); save(); });
  $('note').addEventListener('blur', () => H.seal());

  // 搜索框：输入法组字时不搜（组完再搜），组字时的回车、Esc、方向键都不算
  const sInput = $('search-input');
  sInput.addEventListener('compositionstart', () => { composing = true; });
  sInput.addEventListener('compositionend', () => { composing = false; runSearch(); });
  sInput.addEventListener('input', (e) => { if (!e.isComposing && !composing) runSearch(); });
  sInput.addEventListener('blur', () => { composing = false; });
  sInput.addEventListener('keydown', (e) => {
    if (e.isComposing || composing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveHit(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter') { e.preventDefault(); openHit(searchIdx); }
  });

  // 详情里的输入框
  const field = (id, key, ev) => $(id).addEventListener(ev || 'input', (e) => {
    const it = selView();
    if (!it) return;
    if (key === 'date' && !e.target.value) return;
    if (change(it, { [key]: e.target.value }, e.target)) render();
  });
  // 打字的那几处（标题、地点、备注）：输入法组字时一个字都不写（拼音还没变成字），组完再写；
  // 写也不是每敲一下就写，稍等一下（typed 里的轻防抖），免得每个键都整体重画、iCloud 的日程每个键都重写一遍日历文本
  const typedField = (id, key) => {
    const el = $(id);
    let comp = false;
    const run = () => {
      const it = selView();
      if (!it || el.disabled) return;
      if ((it[key] || '') === el.value) return;
      if (change(it, { [key]: el.value }, el)) render();
    };
    el.addEventListener('compositionstart', () => { comp = true; });
    el.addEventListener('compositionend', () => { comp = false; typed(id, run); });
    el.addEventListener('input', (e) => { if (!comp && !e.isComposing) typed(id, run); });
    el.addEventListener('blur', () => { comp = false; flushFields(); });
  };
  typedField('p-title', 'title');
  field('p-end', 'end');
  // 改开始时间时整段一起挪，时长不变
  $('p-start').addEventListener('input', (e) => {
    const it = selView();
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
    if (change(it, p, e.target)) render();
  });
  field('p-due', 'due');
  typedField('p-place', 'place');
  typedField('p-notes', 'notes');
  field('p-date', 'date', 'change');
  field('p-remind', 'remind', 'change');

  $('p-subform').addEventListener('submit', (e) => {
    e.preventDefault();
    const it = selView();
    const input = $('p-sub');
    const value = input.value.trim();
    if (!it || !value) return;
    input.value = '';
    change(it, { subs: (it.subs || []).concat([{ id: uid('s'), text: value, done: false }]) }, input);
    renderSubs(selView(), null);
    render();
  });

  // 单行输入框里回车：保存并关掉详情
  ['p-title', 'p-place', 'p-date', 'p-start', 'p-end', 'p-due', 'p-until', 'p-rcount'].forEach((id) => $(id).addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    // 还没选改哪几次：回车先去选，不关详情
    flushFields();
    if (S.ask) { const b = $('scope').querySelector('button'); if (b) b.focus(); return; }
    if (id === 'p-rcount') e.target.dispatchEvent(new Event('change'));
    e.target.blur();
    closePanels();
  }));

  // 重复规则
  $('p-repeat').addEventListener('change', (e) => {
    const f = repeatForm();
    f.freq = e.target.value;
    if (f.freq !== 'WEEKLY') f.byday = [];
    applyRule(f);
  });
  $('p-rend').addEventListener('change', (e) => {
    const f = repeatForm();
    const it = find(S.sel);
    f.end = e.target.value;
    if (f.end === 'until' && !f.until) f.until = Recur.addDays((it && it.date) || S.date, 90);
    if (f.end === 'count' && !f.count) f.count = 10;
    applyRule(f);
  });
  $('p-until').addEventListener('change', (e) => {
    if (!e.target.value) return;
    const f = repeatForm();
    f.end = 'until';
    f.until = e.target.value;
    applyRule(f);
  });
  $('p-rcount').addEventListener('change', (e) => {
    const n1 = Math.floor(Number(e.target.value));
    if (!(n1 >= 1)) { const it = find(S.sel); if (it) fillRepeat(it); return; }
    const f = repeatForm();
    f.end = 'count';
    f.count = Math.min(999, n1);
    applyRule(f);
  });
  $('panel-body').addEventListener('scroll', () => { if (S.ask) renderScope(); });

  $('p-cal-pick').addEventListener('change', (e) => {
    const it = masterOf(find(S.sel));
    if (!it || it.remote) return;
    record('换日历', it.draft ? 'new:' + it.id : '', () => {
      if (e.target.value && canCloud(it)) it.cal = normCal(e.target.value);
      else delete it.cal;
    }, !!it.draft);
    save();
  });

  // 子任务的文字直接改（同样：组字时不写，写的时候轻防抖）
  let subComp = false;
  const subRun = (input) => () => {
    const it = selView();
    if (!input.isConnected || !it) return;
    const cur = (it.subs || []).find((x) => x.id === input.dataset.sub);
    if (!cur || cur.text === input.value) return;
    if (change(it, { subs: (it.subs || []).map((x) => (x.id === input.dataset.sub ? Object.assign({}, x, { text: input.value }) : x)) }, input)) render();
  };
  $('p-subs').addEventListener('compositionstart', () => { subComp = true; });
  $('p-subs').addEventListener('compositionend', (e) => { subComp = false; const input = e.target.closest('.sub-name'); if (input) typed('sub:' + input.dataset.sub, subRun(input)); });
  $('p-subs').addEventListener('input', (e) => {
    const input = e.target.closest('.sub-name');
    if (!input || subComp || e.isComposing) return;
    typed('sub:' + input.dataset.sub, subRun(input));
  });
  $('p-subs').addEventListener('focusout', () => { subComp = false; flushFields(); });
  $('p-subs').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && e.target.closest('.sub-name')) { e.preventDefault(); e.target.blur(); }
  });

  // 设置
  $('s-tint').addEventListener('input', (e) => {
    S.settings.tint = Number(e.target.value);
    $('s-tint-text').textContent = S.settings.tint + '%';
    applySettings();
    save();
  });
  $('s-target').addEventListener('change', (e) => { S.settings.sync.target = normCal(e.target.value); save(); });
  // 导入：选文件，或者把 .json / .ics 直接拖到小组件上
  $('s-file').addEventListener('change', (e) => readImport(e.target.files && e.target.files[0]));
  const hasFile = (e) => !!e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0;
  window.addEventListener('dragover', (e) => { if (hasFile(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; root.classList.add('dropping'); } });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) root.classList.remove('dropping'); });
  window.addEventListener('drop', (e) => {
    root.classList.remove('dropping');
    if (!hasFile(e)) return;
    e.preventDefault();
    readImport(e.dataTransfer.files[0]);
  });

  // Ctrl + K 指令条
  const cInput = $('cmd-input');
  let cComp = false;
  cInput.addEventListener('compositionstart', () => { cComp = true; });
  cInput.addEventListener('compositionend', () => { cComp = false; runCmdSearch(); });
  cInput.addEventListener('input', (e) => { if (!cComp && !e.isComposing) runCmdSearch(); });
  cInput.addEventListener('keydown', (e) => {
    if (e.isComposing || cComp || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!cmdHits.length) return;
      cmdIdx = (cmdIdx + (e.key === 'ArrowDown' ? 1 : cmdHits.length - 1)) % cmdHits.length;
      renderCmd();
      const el = $('cmd-' + cmdIdx);
      if (el) el.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdIdx); }
  });
  $('s-connect').addEventListener('submit', (e) => { e.preventDefault(); connect(); });

  // 入场动画播完就摘掉，否则它会压住后面的显隐过渡
  $('shell').addEventListener('animationend', (e) => { if (e.target === $('shell')) $('shell').classList.remove('rise'); });
  // 只认这几块自己的过渡结束；里面的按钮、开关每动一下也会冒泡上来，不用跟着报
  ['panel', 'settings', 'shell'].forEach((id) => $(id).addEventListener('transitionend', (e) => { if (e.target === e.currentTarget) sendRects(); }));
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
    // 从托盘退出：先把还没写盘的改动写完，再告诉外壳可以退了
    TAURI.event.listen('flush', async () => {
      try { await writeNow(); } finally { call('flush_done').catch(() => {}); }
    });
    // 又双击打开了一次：收起着的话展开，让人看到它
    TAURI.event.listen('second-instance', () => {
      setEdgeHidden(false);
      if (!S.compact) return;
      S.compact = '';
      render();
    });
    // 系统换了壁纸 / 换成了纯色：外壳发现后说一声，这边重读，不用重启
    TAURI.event.listen('wallpaper-changed', () => loadWallpaper());
    // 贴边自动收起：鼠标在屏幕边上停了一下 → 滑出来；移开了 → 没在忙就收回去
    TAURI.event.listen('edge-peek', () => setEdgeHidden(false));
    TAURI.event.listen('edge-leave', () => { if (S.settings.edge && !edgeBusy()) setEdgeHidden(true); });
    // Alt + W：临时叫到所有窗口前面（再按一次或点到别处放回去）
    TAURI.event.listen('summon', (e) => {
      root.classList.toggle('summoned', !!e.payload);
      if (e.payload) { setEdgeHidden(false); if (S.compact === 'capsule') { S.compact = ''; render(); } }
    });
    // 全局快捷键有没注册上的
    TAURI.event.listen('hotkeys', (e) => { hotkeysTaken = Array.isArray(e.payload) ? e.payload : []; if (S.panel === 'settings') fillSettings(); });
  }
}

// ---------- 启动 ----------

async function start() {
  if (!invoke) root.classList.add('preview');
  layout();
  await load();
  await dockWindow(true); // 外壳启动时已经按上次的角摆过了，这里拿到几何信息把界面对上
  lastScreen = screenSig();
  if (invoke) {
    // 数据目录里的 holidays.json 覆盖内置休班表；没有、读不出来、写坏了都当没这回事
    try { Lunar.setHolidays(await invoke('get_holidays')); } catch (err) { /* 用内置的 */ }
  }
  applySettings();
  rollOver();
  rebuildRemote();
  if (syncRemoteHol()) rebuildRemote();
  $('note').value = S.note;
  bind();
  render();
  loadWallpaper();
  if (invoke) {
    if (S.settings.top) call('set_layer', { top: true }).catch(() => {});
    // 开机自启以系统里实际的为准（在任务管理器的“启动”里被关掉的话，这里的开关也跟着是关的）
    call('get_autostart').then((on) => { if (typeof on === 'boolean' && on !== !!S.settings.autostart) { S.settings.autostart = on; save(); if (S.panel === 'settings') fillSettings(); } }).catch(() => {});
    call('hotkey_status').then((list) => { hotkeysTaken = Array.isArray(list) ? list : []; }).catch(() => {});
    if (S.settings.edge) call('set_edge', { on: true }).catch(() => {});
    pushPending();
    const cycle = async () => { await uploadPending(); await syncNow(false); pushPending(); };
    setTimeout(cycle, 2500);
    setInterval(cycle, 10 * 60 * 1000);
  }

  // 每 20 秒刷新一次“还剩多久”和提醒；过了零点换日、顺延待办。
  setInterval(() => {
    if (today() !== S.day) {
      if (S.date === S.day) S.date = today();
      S.nav = false;
      S.day = today();
      rollOver();
      rebuildRemote();
    }
    checkReminders();
    render();
    checkScreen();
  }, 20000);
  checkReminders();
}

start();
