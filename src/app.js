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
    theme: 'dark', palette: 'indigo', tint: 50, blur: true, carry: true, lunar: true, hol: true, autostart: false, top: false,
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
  remote: { res: {}, at: 0 }, // iCloud 条目的本地缓存：res[地址] = { etag, ics, cal, dirty }
  // 只在运行时用的
  mode: 'day',      // 小组件里显示“某一天”还是“折叠日历”
  big: false,       // 是否展开成月视图
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
};
let R = [];           // 同步来的日程展开后的具体场次
let L = [];           // 本机重复条目展开后的场次（只展开画面上用得到的那些天），主条目本身不直接显示
let saveTimer = null;
const pushTimers = {};
const pushing = {};   // 正在上传的 iCloud 条目，避免同一条同时传两次
const retries = {};   // 上传失败了几次，决定隔多久再试
const retryTimers = {};

const plainItems = () => S.items.filter((it) => !Recur.isRepeating(it));
const allItems = () => plainItems().concat(L, R);
const masterOf = (it) => (it && it.masterId ? S.items.find((x) => x.id === it.masterId) || null : it);
const find = (id) => S.items.find((x) => x.id === id && !Recur.isRepeating(x)) || R.find((x) => x.id === id) || Recur.get(S.items, id) || null;

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
  ranges.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const merged = [];
  ranges.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r[0] <= Recur.addDays(last[1], 1)) { if (r[1] > last[1]) last[1] = r[1]; } else merged.push(r.slice());
  });
  const seen = {};
  L = [];
  merged.forEach((r) => Recur.expand(S.items, r[0], r[1]).forEach((o) => { if (!seen[o.id]) { seen[o.id] = true; L.push(o); } }));
}

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
    S.items = Recur.normalize(Array.isArray(d.items) ? d.items : []);
    S.items.forEach((it) => { delete it.uploading; });
    S.note = typeof d.note === 'string' ? d.note : '';
    S.extras = d.extras && typeof d.extras === 'object' ? d.extras : {};
    if (d.notified && d.notified.ids) S.notified = d.notified;
    if (d.settings) {
      const base = defaults();
      S.settings = Object.assign(base, d.settings, {
        sync: Object.assign(base.sync, d.settings.sync || {}),
        fold: Object.assign(base.fold, d.settings.fold || {}),
      });
    }
    if (d.remote && d.remote.res) S.remote = { res: d.remote.res, at: d.remote.at || 0 };
  } catch (err) {
    console.error('数据文件解析失败', err);
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
    remote: S.remote,
  });
  try {
    if (invoke) await invoke('save_data', { json: json });
    else localStorage.setItem('jinjian', json);
  } catch (err) {
    console.error('保存失败', err);
  }
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
          remind: o.remind === null || o.remind === undefined ? 'none' : String(o.remind), subs: extra.subs || [], parts: o.parts || 0, countdown: !!extra.countdown,
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

// 上传失败（断网、服务器出错）：隔 5 秒、30 秒、2 分钟、之后每 10 分钟再试
function retryPush(href) {
  const n = (retries[href] = (retries[href] || 0) + 1);
  clearTimeout(retryTimers[href]);
  retryTimers[href] = setTimeout(() => pushRes(href), [5, 30, 120, 600][Math.min(n, 4) - 1] * 1000);
}

// 所有改过还没传上去的，排队上传
function pushPending() {
  Object.keys(S.remote.res).forEach((h) => { if (S.remote.res[h].dirty && !pushing[h]) pushSoon(h); });
}

// 把本机改过的一条日程传回 iCloud。
async function pushRes(href) {
  const res = S.remote.res[href];
  const user = S.settings.sync.user;
  if (!res || !res.dirty || !user) return;
  if (pushing[href]) { pushing[href] = 'again'; return; }
  pushing[href] = true;
  clearTimeout(retryTimers[href]);
  const sent = res.ics;
  let failed = false;
  try {
    // 上一次上传后服务器没给新版本号（iCloud 有时不给）：先问一下现在是哪个版本。
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
    const cur = S.remote.res[href] || res;
    if (r.ok) {
      cur.etag = r.etag || '';
      cur.dirty = cur.ics !== sent; // 上传途中又改过，留着下一轮再传
      delete retries[href];
      setStatus('已保存到 iCloud');
      if (!r.etag && !cur.dirty) setTimeout(() => syncNow(false), 2000);
    } else if (r.status === 412) {
      cur.dirty = false;
      setStatus('iCloud 上有更新的版本，已重新同步');
      delete pushing[href];
      await syncNow(false);
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

// 本机新建、指定要存到 iCloud 的日程：等详情关掉后再上传。
async function uploadPending() {
  const sync = S.settings.sync;
  if (!sync.on || !sync.user) return;
  const list = S.items.filter((it) => it.kind === 'event' && it.cal && (it.title || '').trim() && it.id !== S.sel && !it.uploading && !Recur.isRepeating(it));
  if (!list.length) return;
  const sig = (x) => JSON.stringify([x.title, x.date, x.start, x.end, x.allDay, x.place, x.notes, x.remind]);
  for (const it of list) {
    it.uploading = true;
    const cal = it.cal;
    const id = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : uid('u')).toUpperCase();
    const href = cal + id + '.ics';
    const ics = ICS.build(id, it);
    const before = sig(it);
    try {
      const r = await dav.put(sync.user, href, ics, '', true);
      if (r.ok && (S.items.indexOf(it) < 0 || it.kind !== 'event' || it.cal !== cal)) {
        // 上传途中这一条被删了、改成了待办、或者换了日历：服务器上这份不该留着
        it.uploading = false;
        await dav.remove(sync.user, href, r.etag || '').catch(() => {});
      } else if (r.ok) {
        const res = { etag: r.etag || '', ics: ics, cal: it.cal };
        S.remote.res[href] = res;
        if (sig(it) !== before) {
          // 上传途中用户又改了这一条：把改动补上去
          res.ics = ICS.patch(ics, Object.assign({}, it));
          res.dirty = true;
          pushSoon(href);
        }
        const carry = {};
        if (it.subs && it.subs.length) carry.subs = it.subs;
        if (it.countdown) carry.countdown = true;
        if (Object.keys(carry).length) S.extras['r|' + href] = carry;
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

// scope 只对本机重复条目的某一场有用：'one' / 'future' / 'all'（完成状态、重点、倒数日、类型不看范围）
function updateItem(it, p, scope) {
  const rest = Object.assign({}, p);
  if (it.masterId) {
    const r = Recur.edit(S.items, it.id, rest, scope || 'one', () => uid(it.kind === 'event' ? 'e' : 't'));
    S.items = r.items;
    Object.assign(it, rest); // 手里这份也跟上，下次 find 会重新拼
    if (S.sel === it.id && r.sel !== it.id) {
      S.sel = r.sel;
      if (S.scopeMem) S.scopeMem.id = r.sel;
    }
    save();
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
  const v = Recur.parseVid(id);
  const it = S.items.find((x) => x.id === id) || (v ? S.items.find((x) => x.id === v.masterId) : null);
  if (!it || !it.draft) return;
  const empty = !(it.title || '').trim() && !(it.place || '').trim() && !(it.notes || '').trim() && !(it.subs && it.subs.length);
  if (empty) S.items = S.items.filter((x) => x !== it);
  else delete it.draft;
  save();
}

function setSel(id) {
  const prev = S.sel;
  S.sel = id;
  if (prev !== id) { S.ask = null; S.scopeMem = null; }
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

  let overdue = '';
  if (isToday && !S.settings.carry) {
    const n = plainItems().filter((x) => x.kind === 'todo' && !x.done && x.date < S.date).length;
    if (n) overdue = '<div class="overdue"><span class="grow">' + n + ' 项之前没做完</span><button type="button" class="pill mini tap" data-act="carry-now">移到今天</button></div>';
  }
  setHtml($('todos'), overdue + todos.map((t) => {
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
  } else if (S.mode === 'cal' && !S.search) {
    const bar = $('countdowns');
    h = Math.min(full, 156 + $('cal').offsetHeight + (bar.hidden ? 0 : bar.offsetHeight + 12)); // 12 是它和上下的间距
  }
  shell.style.width = w + 'px';
  shell.style.height = h + 'px';
  shell.classList.toggle('gone', S.compact === 'capsule');
  $('widget').classList.toggle('on', !S.big && !S.compact && !S.search);
  $('big').classList.toggle('on', S.big && !S.compact && !S.search);
  $('search').classList.toggle('on', S.search);
  $('search').setAttribute('aria-hidden', S.search ? 'false' : 'true');
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
  const W = panel.offsetWidth || 248;
  const h = panel.offsetHeight;
  const bigH = Math.min(640, parseFloat(getComputedStyle(root).getPropertyValue('--shell-h')) || 864); // 和 applyMode 里一致
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
  const top = Math.max(36, Math.min(24 + bigH - 12 - h, ay - 56));
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
  renderCompact(map, info);
  renderCountdowns();
  applyMode();
  renderPop(map);

  const detail = S.panel === 'detail' && !!S.sel;
  $('panel').classList.toggle('on', detail);
  $('panel').setAttribute('aria-hidden', detail ? 'false' : 'true');
  $('settings').classList.toggle('on', S.panel === 'settings');
  $('settings').setAttribute('aria-hidden', S.panel === 'settings' ? 'false' : 'true');
  if (detail) positionPanel();
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
  const rep = Recur.isRepeating(masterOf(it) || it);
  pick.hidden = !(!it.remote && !isTodo && sync.on && sync.cals.length) || rep;
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
  fillRepeat(it);
  renderSubs(it, null);
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
  $('p-local').hidden = !(own && f.freq && it.kind === 'event' && S.settings.sync.on);
}

// 详情里正在显示的样子：还在问范围时，把还没定下来的改动叠上去
function selView() {
  const it = find(S.sel);
  if (!it || !S.ask || S.ask.mode !== 'edit' || S.ask.id !== it.id) return it;
  return Object.assign({}, it, S.ask.patch);
}

// 详情里的改动都走这里：重复条目的某一场第一次改时先问范围，问完再写。写进去了返回 true。
function change(it, p, anchor) {
  if (it.masterId && !(S.scopeMem && S.scopeMem.id === it.id)) {
    if (S.ask && S.ask.mode === 'edit' && S.ask.id === it.id) Object.assign(S.ask.patch, p);
    else S.ask = { mode: 'edit', id: it.id, patch: Object.assign({}, p), anchor: anchor || null };
    renderScope();
    return false;
  }
  updateItem(it, p, it.masterId ? S.scopeMem.scope : undefined);
  return true;
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

function resolveAsk(scope) {
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

// 删重复条目的某一场；本机的都给 4 秒撤销
function deleteOcc(it, scope) {
  const m = masterOf(it);
  if (!m) return;
  const index = S.items.indexOf(m);
  const snap = JSON.parse(JSON.stringify(m));
  setSel(null);
  S.panel = '';
  S.items = Recur.remove(S.items, it.id, scope).items;
  save();
  showToast('已删除「' + (it.title || '未命名') + '」', '撤销', () => {
    const i = S.items.findIndex((x) => x.id === snap.id);
    if (i >= 0) S.items[i] = snap; else S.items.splice(Math.min(index, S.items.length), 0, snap);
    save();
    render();
  });
  render();
}

// 改重复规则：整个系列的事，不问范围
function applyRule(form) {
  const it = find(S.sel);
  if (!it || it.remote) return;
  const m = masterOf(it);
  const snap = m ? JSON.stringify(m) : '';
  const r = Recur.setRule(S.items, it.id, form);
  if (m && Recur.isRepeating(m) && !Recur.first(m)) {
    // 结束日期早于开始、次数让它一场都不剩：不接受，退回原样
    Object.keys(m).forEach((k) => delete m[k]);
    Object.assign(m, JSON.parse(snap));
    fillPanel(it);
    return;
  }
  if (m && m.lunar && m.cal) delete m.cal; // 农历重复传不上 iCloud
  if (r.sel !== S.sel) { S.sel = r.sel; S.scopeMem = null; S.ask = null; }
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

let wallRgb = null; // 小组件背后那块壁纸的平均颜色；读不到就是 null

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

function applyGlass() {
  const s = S.settings;
  const light = root.dataset.theme === 'light';
  const t = Math.max(0, Math.min(1, s.tint / 100));
  const drawn = s.blur && !root.classList.contains('no-wp'); // 玻璃里画着模糊的壁纸
  const glass = Math.min(1, t / 0.25);
  let veil = light ? 1 - Math.pow(1 - t, 1.5) : t;          // 浅色玻璃要实一些才干净
  if (s.blur && !drawn) veil = 1 - Math.pow(1 - veil, 2);   // 想要模糊却读不到壁纸：底色再实一些
  const covered = veil * glass;
  // 背后是清晰的桌面时（玻璃很透，或者没画模糊），给文字垫一圈晕
  const halo = drawn ? 1 - glass : Math.max(0, Math.min(1, (0.7 - covered) / 0.7));

  const wall = wallRgb || [96, 96, 104]; // 不知道壁纸什么样，按偏暗的灰算
  const veilRgb = (VEIL[root.dataset.palette] || VEIL.indigo)[light ? 1 : 0]; // 和 style.css 里各配色的 --bg 一致
  const boost = light && drawn ? 1.12 : 1;
  const lum = luminance(wall.map((c, i) => {
    const inner = Math.min(255, c * boost) * (1 - veil) + veilRgb[i] * veil;
    return c * (1 - glass) + inner * glass;
  }));
  const ink = (light ? lum >= 0.17 : lum > 0.26) ? 'dark' : 'light';
  root.dataset.ink = ink;
  // 设置和详情：玻璃越透，底色越往 --pop 靠；底色和文字深浅对不上时（浅色玻璃配浅色字）直接用 --pop
  const clash = light === (ink === 'light');
  const solidify = clash ? 1 : Math.max(0, Math.min(1, (0.45 - covered) / 0.45));
  root.style.setProperty('--solidify', solidify.toFixed(3));
  root.style.setProperty('--tint', veil.toFixed(3));
  root.style.setProperty('--glass', glass.toFixed(3));
  root.style.setProperty('--halo', halo.toFixed(3));
  root.classList.toggle('bare', halo > 0.02);
}

function applySettings() {
  const s = S.settings;
  const light = s.theme === 'light' || (s.theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  root.dataset.theme = light ? 'light' : 'dark';
  root.dataset.palette = s.palette === 'graphite' ? 'graphite' : 'indigo';
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
  Array.prototype.forEach.call($('s-palette').children, (b) => b.setAttribute('aria-pressed', b.dataset.v === (s.palette === 'graphite' ? 'graphite' : 'indigo') ? 'true' : 'false'));
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
  [pushTimers, retryTimers].forEach((t) => Object.keys(t).forEach((h) => { clearTimeout(t[h]); delete t[h]; }));
  Object.keys(retries).forEach((h) => delete retries[h]);
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
  if (!$('scope').hidden) add($('scope'));
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

// 量一下小组件背后（屏幕右上那一块）的壁纸平均是什么颜色，用来决定文字用浅色还是深色。
function sampleWall(img, sw, sh, scale) {
  try {
    const W = 64;
    const H = Math.max(1, Math.round((W * sh) / sw));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const cw = sw / scale;
    const ch = sh / scale;
    g.drawImage(img, (img.naturalWidth - cw) / 2, (img.naturalHeight - ch) / 2, cw, ch, 0, 0, W, H); // 和屏幕上一样的裁切
    const x0 = Math.max(0, Math.min(W - 1, Math.floor(W * (1 - 400 / sw))));
    const y1 = Math.max(1, Math.min(H, Math.ceil((H * 900) / sh)));
    const d = g.getImageData(x0, 0, W - x0, y1).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
    const n = d.length / 4;
    return n ? [sum[0] / n, sum[1] / n, sum[2] / n] : null;
  } catch (err) {
    return null; // 图片不让读像素（浏览器预览里的跨域图片）
  }
}

// 把壁纸按“填充”方式铺满屏幕，算出它相对屏幕的偏移，玻璃内部据此对位。
function showWallpaper(url, sw, sh, plain) {
  const img = new Image();
  const cors = !plain && !/^(blob|data):/.test(url);
  if (cors) img.crossOrigin = 'anonymous'; // 只有浏览器预览会走到这里
  img.onload = () => {
    const s = Math.max(sw / img.naturalWidth, sh / img.naturalHeight);
    root.style.setProperty('--wp', 'url("' + url + '")');
    root.style.setProperty('--wp-size', (img.naturalWidth * s) + 'px ' + (img.naturalHeight * s) + 'px');
    root.style.setProperty('--ox', ((img.naturalWidth * s - sw) / 2) + 'px');
    root.style.setProperty('--oy', ((img.naturalHeight * s - sh) / 2) + 'px');
    root.classList.remove('no-wp');
    wallRgb = sampleWall(img, sw, sh, s);
    applyGlass();
  };
  img.onerror = () => {
    if (cors) { showWallpaper(url, sw, sh, true); return; }
    root.classList.add('no-wp');
    wallRgb = null;
    applyGlass();
  };
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
      const key = 'due|' + it.id + '@' + it.due;
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
    const key = it.id + '@' + it.start + '@' + before;
    if (s === null || isNaN(before) || S.notified.ids[key]) return;
    if (n >= s - before && n <= s) {
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
    case 'add-event': S.settings.fold.ev = false; addItem('event', { date: S.date }, true); return;
    case 'add-todo': S.settings.fold.td = false; addItem('todo', { date: S.date }, true); return;
    case 'carry-now': {
      const t0 = today();
      plainItems().forEach((x) => { if (x.kind === 'todo' && !x.done && x.date < t0) x.date = t0; });
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
      if (S.panel === 'detail') { setSel(null); S.panel = ''; }
      replay($('events'), 'swap');
      replay($('todos'), 'swap');
      break;
    }
    case 'view': {
      const d = fromIso(S.date);
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
    case 'prev-month': shiftMonth(-1); break;
    case 'next-month': shiftMonth(1); break;
    case 'go-today': {
      const d = new Date();
      if (S.date !== today()) { replay($('events'), 'swap'); replay($('todos'), 'swap'); }
      S.date = today();
      S.nav = false;
      S.vm = { y: d.getFullYear(), m: d.getMonth() };
      S.pop = null;
      break;
    }
    case 'pick-day': S.date = date; S.mode = 'day'; S.nav = false; break;
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
      if (m.kind === 'event') {
        Object.assign(m, { kind: 'todo', due: m.allDay ? '' : (m.start || ''), done: false, star: false });
        delete m.cal;
      } else {
        const st = m.due || (cur.date === today() ? fromMin(Math.min(23 * 60, Math.ceil((nowMin() + 1) / 30) * 30)) : '09:00');
        Object.assign(m, { kind: 'event', start: st, end: fromMin(Math.min(23 * 60 + 59, toMin(st) + 60)), allDay: false, remind: m.remind && m.remind !== 'none' ? m.remind : '10' });
        const sync = S.settings.sync;
        if (sync.on && sync.target && !m.lunar) m.cal = sync.target;
      }
      // 只是换了类型、什么都没写，关掉时照样不留下“未命名”
      save();
      fillPanel(find(S.sel) || cur);
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
    case 'p-count':
      if (!cur) return;
      updateItem(cur, { countdown: !cur.countdown });
      t.setAttribute('aria-pressed', cur.countdown ? 'true' : 'false');
      break;
    case 'cd': jumpTo(id); return;
    case 'p-del': {
      if (!cur) return;
      if (cur.masterId) {
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
    case 'scope': resolveAsk(t.dataset.v); return;
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
  $('toast-btn').addEventListener('click', () => {
    const action = toastAction;
    hideToast();
    if (action) action();
  });

  // Esc 一层一层往回退：当天小窗口 → 详情/设置 → 月视图 → 折叠日历
  window.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    // Ctrl + F：只在小组件有焦点时生效，不注册系统级快捷键；顺便挡掉浏览器自己的查找条
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); openSearch(); return; }
    if (e.key !== 'Escape') return;
    if (S.ask) { cancelAsk(); return; }
    if (S.search) { closeSearch(true); return; }
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
    // “3点前交周报”是截止时间，记成待办；日程目前只能在一天之内，跨午夜的时间段记到当天 23:59
    if (q.time && !q.isDeadline) addItem('event', { title: q.title || text, date: date, start: q.time, end: q.endTime ? (q.endNextDay ? '23:59' : q.endTime) : '' }, false);
    else addItem('todo', { title: q.title || text, date: date, due: q.time || '' }, false);
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
  field('p-title', 'title');
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
  field('p-place', 'place');
  field('p-notes', 'notes');
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
    const it = find(S.sel);
    if (!it || it.remote) return;
    if (e.target.value) it.cal = e.target.value;
    else delete it.cal;
    save();
  });

  // 子任务的文字直接改
  $('p-subs').addEventListener('input', (e) => {
    const input = e.target.closest('.sub-name');
    const it = selView();
    if (!input || !it) return;
    if (change(it, { subs: (it.subs || []).map((x) => (x.id === input.dataset.sub ? Object.assign({}, x, { text: input.value }) : x)) }, input)) render();
  });
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
    // 从托盘退出：先把还没写盘的改动写完，再告诉外壳可以退了
    TAURI.event.listen('flush', async () => {
      try { await writeNow(); } finally { call('flush_done').catch(() => {}); }
    });
    // 又双击打开了一次：收起着的话展开，让人看到它
    TAURI.event.listen('second-instance', () => {
      if (!S.compact) return;
      S.compact = '';
      render();
    });
  }
}

// ---------- 启动 ----------

async function start() {
  if (!invoke) root.classList.add('preview');
  layout();
  await load();
  if (invoke) {
    // 数据目录里的 holidays.json 覆盖内置休班表；没有、读不出来、写坏了都当没这回事
    try { Lunar.setHolidays(await invoke('get_holidays')); } catch (err) { /* 用内置的 */ }
  }
  applySettings();
  rollOver();
  rebuildRemote();
  $('note').value = S.note;
  bind();
  render();
  loadWallpaper();
  if (invoke) {
    if (S.settings.top) call('set_layer', { top: true }).catch(() => {});
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
  }, 20000);
  checkReminders();
}

start();
