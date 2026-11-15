// 今笺 Jinjian：本机日程 / 待办的重复。纯函数，浏览器和 Node 里都能用，单测在 tests/recur.test.js。
//
// 数据里只存一份主条目，新增的字段都是可选的（没有这些字段的旧条目就是不重复的）：
//   rrule      标准 RRULE 文本（不带“RRULE:”），如 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20270630'
//   lunar      true 表示“每年农历”：rrule 必须是 FREQ=YEARLY，按开始那天的农历月日落到每年
//   exdates    删掉的那几场：['YYYY-MM-DD', …]（原来那一场的日期）
//   overrides  单独改过的那几场：{ 'YYYY-MM-DD': { title, date, start, … 只放改过的字段 } }
//   doneDates  重复待办每一场的完成状态：{ 'YYYY-MM-DD': true }
// 公历的规则全部交给 ics.js 的 parseRRule / expand（每月最后一天、第几个周几这些都在那里测过），这里不再写第二套。
(function (global) {
  'use strict';

  const ICS = global.ICS || (typeof require === 'function' ? require('./ics.js') : null);
  const Lunar = global.Lunar || (typeof require === 'function' ? require('./lunar.js') : null);

  const DAY = 86400000;
  const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
  const CODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const MAPS = ['exdates', 'overrides', 'doneDates'];
  // 一个系列共有的属性：不分“仅此次 / 全部”，直接写主条目
  const SERIES = ['kind', 'countdown', 'star'];
  const pad = (n) => String(n).padStart(2, '0');

  // ---------- 日期 ----------
  const keyNo = (k) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof k === 'string' ? k : '');
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY : NaN;
  };
  const noKey = (n) => { const d = new Date(n * DAY); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  const isKey = (k) => !Number.isNaN(keyNo(k)) && noKey(keyNo(k)) === k;
  const addDays = (k, n) => noKey(keyNo(k) + n);
  const wday = (k) => new Date(keyNo(k) * DAY).getUTCDay();
  const parts = (k) => k.split('-').map(Number);
  const localKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const startOf = (k) => { const p = parts(k); return new Date(p[0], p[1] - 1, p[2]); };
  const endOf = (k) => { const p = parts(k); return new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999); };
  const allDayDt = (k) => { const p = parts(k); return { allDay: true, utc: false, tz: '', wall: { y: p[0], m: p[1], d: p[2], h: 0, mi: 0, s: 0 } }; };
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

  // ---------- 规则 ----------

  function rule(it) {
    if (!it || typeof it !== 'object' || typeof it.rrule !== 'string' || !isKey(it.date)) return null;
    const r = ICS.parseRRule(it.rrule);
    return r && FREQS.indexOf(r.freq) >= 0 ? r : null;
  }
  const isRepeating = (it) => !!rule(it);
  const lunarOn = (it, r) => it.lunar === true && !!r && r.freq === 'YEARLY';
  const untilKey = (r) => (r.until ? localKey(ICS.toDate(r.until)) : '');

  // 去掉 UNTIL / COUNT，再按需加上
  function withEnd(str, end) {
    const kept = str.split(';').filter((kv) => kv && !/^(UNTIL|COUNT)=/i.test(kv));
    if (end && end.count > 0) kept.push('COUNT=' + end.count);
    else if (end && end.until) kept.push('UNTIL=' + end.until.replace(/-/g, ''));
    return kept.join(';');
  }

  // 每年农历：按开始那天的农历月日（闰月的那年有闰月就用闰月），不够天数就落到月末
  function lunarRaw(m, r, from, to) {
    const p = parts(m.date);
    const base = Lunar.solarToLunar(p[0], p[1], p[2]);
    if (!base) return [];
    const until = untilKey(r) || '9999-12-31';
    const out = [];
    let count = 0;
    for (let ly = base.year; ly <= base.year + 300; ly += 1) {
      const s = Lunar.lunarToSolar(ly, base.month, base.day, base.leap);
      if (!s) break;
      const k = s.y + '-' + pad(s.m) + '-' + pad(s.d);
      if (k < m.date) continue;
      if (k > until || (r.count && count >= r.count) || k > to) break;
      count += 1;
      if (k >= from) out.push(k);
    }
    return out;
  }

  // [from, to] 里规则排出来的每一场（含被删掉的），按日期排好
  function raw(m, from, to) {
    const r = rule(m);
    if (!r || to < m.date || to < from) return [];
    if (lunarOn(m, r)) return lunarRaw(m, r, from, to);
    const ev = { uid: String(m.id), title: '', place: '', notes: '', start: allDayDt(m.date), end: null, duration: null, rrule: r, exdates: [], rid: null, alarm: null, status: '' };
    // 都按全天算：本机日程不跨天，这里只要日期；夏令时那天 24 小时的“全天”可能被拆成两段，只取第一段
    return ICS.expand([ev], startOf(from), endOf(to)).filter((o) => !o.part || o.part === 1).map((o) => o.date);
  }

  const exSet = (m) => { const s = {}; (Array.isArray(m.exdates) ? m.exdates : []).forEach((k) => { s[k] = true; }); return s; };
  const dates = (m, from, to) => { const ex = exSet(m); return raw(m, from, to).filter((k) => !ex[k]); };
  const isOcc = (m, k) => isKey(k) && dates(m, k, k).length === 1;

  // 第一场（没被删掉的）
  function firstOcc(m) {
    for (const h of [400, 4000, 40000]) {
      const d = dates(m, m.date, addDays(m.date, h));
      if (d.length) return d[0];
    }
    return null;
  }

  // ---------- 场次 ----------

  const vid = (id, occ) => id + '@' + occ;
  function parseVid(id) {
    const s = typeof id === 'string' ? id : '';
    const at = s.lastIndexOf('@');
    if (at <= 0 || !isKey(s.slice(at + 1))) return null;
    return { masterId: s.slice(0, at), occ: s.slice(at + 1) };
  }

  // 主条目 + 这一场改过的字段 = 这一场
  function occObj(m, occ) {
    const ov = (m.overrides && m.overrides[occ]) || {};
    const o = Object.assign({}, m, ov);
    MAPS.forEach((k) => delete o[k]);
    o.id = vid(m.id, occ);
    o.masterId = m.id;
    o.occ = occ;
    o.date = isKey(ov.date) ? ov.date : occ;
    if (m.kind === 'todo') o.done = !!(m.doneDates && m.doneDates[occ]);
    return o;
  }

  // 所有重复条目在 [from, to]（含两头，'YYYY-MM-DD'）里的场次。挪过日期的按挪到的那天算。
  function expand(items, from, to) {
    const out = [];
    (Array.isArray(items) ? items : []).forEach((m) => {
      if (!rule(m)) return;
      const ex = exSet(m);
      const ov = m.overrides || {};
      const seen = {};
      raw(m, from, to).forEach((k) => {
        seen[k] = true;
        if (ex[k]) return;
        const o = occObj(m, k);
        if (o.date >= from && o.date <= to) out.push(o);
      });
      // 从窗口外挪进来的那几场
      Object.keys(ov).forEach((k) => {
        const d = ov[k] && ov[k].date;
        if (seen[k] || ex[k] || !isKey(d) || d < from || d > to) return;
        if (isOcc(m, k)) out.push(occObj(m, k));
      });
    });
    return out;
  }

  // 按场次 id（主条目 id@原日期）取这一场；不存在、被删掉的返回 null
  function get(items, id) {
    const v = parseVid(id);
    if (!v) return null;
    const m = (Array.isArray(items) ? items : []).find((x) => x && x.id === v.masterId);
    if (!m || !rule(m) || !isOcc(m, v.occ)) return null;
    return occObj(m, v.occ);
  }

  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.start || '') < (b.start || '') ? -1 : 1);

  // 不早于 from 的下一场；skipDone 时跳过已做完的待办
  function next(m, from, skipDone) {
    if (!rule(m)) return null;
    for (const h of [400, 1500, 4000]) {
      const list = expand([m], addDays(from, -31), addDays(from, h)).filter((o) => o.date >= from && !(skipDone && o.done)).sort(byDate);
      if (list.length) return list[0];
    }
    return null;
  }

  // 离 today 最近的一场（前后都算）；早就结束的系列给最后一场
  function nearest(m, today) {
    if (!rule(m)) return null;
    const after = next(m, today, false);
    let before = expand([m], addDays(today, -400), addDays(today, -1)).sort(byDate).pop() || null;
    if (!before && !after && m.date < today) before = expand([m], m.date, addDays(today, -1)).sort(byDate).pop() || null;
    if (!before) return after;
    if (!after) return before;
    return keyNo(today) - keyNo(before.date) < keyNo(after.date) - keyNo(today) ? before : after;
  }

  // ---------- 改 ----------

  function setMap(m, key, obj) {
    const empty = Array.isArray(obj) ? !obj.length : !Object.keys(obj).length;
    if (empty) delete m[key]; else m[key] = obj;
  }

  // 例外表按日期分两半：早于 occ 的留下，其余交给 take（可以不给，就是扔掉）
  function splitMaps(m, occ, take) {
    if (Array.isArray(m.exdates)) {
      const late = m.exdates.filter((k) => k >= occ);
      setMap(m, 'exdates', m.exdates.filter((k) => k < occ));
      if (take) setMap(take, 'exdates', late);
    }
    ['overrides', 'doneDates'].forEach((key) => {
      if (!m[key]) return;
      const early = {};
      const late = {};
      Object.keys(m[key]).forEach((k) => { (k < occ ? early : late)[k] = m[key][k]; });
      setMap(m, key, early);
      if (take) setMap(take, key, late);
    });
  }

  // 整组挪 delta 天：开始日期、每周几、结束日期、例外表的日期都跟着挪
  function shift(m, delta) {
    m.date = addDays(m.date, delta);
    m.rrule = m.rrule.split(';').map((kv) => {
      const eq = kv.indexOf('=');
      const name = kv.slice(0, eq).toUpperCase();
      const val = kv.slice(eq + 1);
      if (name === 'BYDAY') {
        return 'BYDAY=' + val.split(',').map((x) => {
          const mm = /^([+-]?\d+)?([A-Za-z]{2})$/.exec(x.trim());
          const w = mm ? CODE.indexOf(mm[2].toUpperCase()) : -1;
          return w < 0 ? x : (mm[1] || '') + CODE[(((w + delta) % 7) + 7) % 7];
        }).join(',');
      }
      if (name === 'UNTIL' && /^\d{8}$/.test(val)) return 'UNTIL=' + addDays(val.slice(0, 4) + '-' + val.slice(4, 6) + '-' + val.slice(6), delta).replace(/-/g, '');
      return kv;
    }).join(';');
    if (Array.isArray(m.exdates)) m.exdates = m.exdates.map((k) => addDays(k, delta)).sort();
    ['overrides', 'doneDates'].forEach((key) => {
      if (!m[key]) return;
      const moved = {};
      Object.keys(m[key]).forEach((k) => {
        const v = m[key][k];
        if (key === 'overrides' && v && isKey(v.date)) v.date = addDays(v.date, delta);
        moved[addDays(k, delta)] = v;
      });
      m[key] = moved;
    });
  }

  // 改某一场。scope：'one' 仅此次 / 'future' 此次及以后 / 'all' 全部。
  // 完成状态只管这一场；类型、倒数日、重点是整个系列的。
  // newId()：拆分时给新系列的 id。返回 { items, sel }：sel 是改完后这一场的 id（可能换了）。
  function edit(items, id, patch, scope, newId) {
    const v = parseVid(id);
    const m = v ? items.find((x) => x && x.id === v.masterId && rule(x)) : null;
    if (!m) return { items: items, sel: id };
    const occ = v.occ;
    const p = Object.assign({}, patch);
    delete p.id;
    if ('done' in p) {
      const dd = Object.assign({}, m.doneDates);
      if (p.done) dd[occ] = true; else delete dd[occ];
      setMap(m, 'doneDates', dd);
      delete p.done;
    }
    SERIES.forEach((k) => { if (k in p) { m[k] = p[k]; delete p[k]; } });
    if (!Object.keys(p).length) return { items: items, sel: id };

    let sc = scope;
    if (sc === 'future') {
      const first = firstOcc(m);
      if (!first || occ <= first) sc = 'all';
    }
    if (sc === 'one') {
      const ov = Object.assign({}, m.overrides);
      const o = Object.assign({}, ov[occ], p);
      if (o.date === occ) delete o.date;
      Object.keys(o).forEach((k) => { if (k !== 'date' && same(o[k], m[k])) delete o[k]; });
      if (Object.keys(o).length) ov[occ] = o; else delete ov[occ];
      setMap(m, 'overrides', ov);
      return { items: items, sel: id };
    }
    if (sc === 'all') {
      let at = occ;
      if ('date' in p) {
        const delta = isKey(p.date) ? keyNo(p.date) - keyNo(occObj(m, occ).date) : 0;
        if (delta) { shift(m, delta); at = addDays(occ, delta); }
        delete p.date;
      }
      Object.assign(m, p);
      if (m.overrides && m.overrides[at]) {
        const o = Object.assign({}, m.overrides[at]);
        Object.keys(p).forEach((k) => delete o[k]);
        if ('date' in patch) delete o.date;
        const ov = Object.assign({}, m.overrides);
        if (Object.keys(o).length) ov[at] = o; else delete ov[at];
        setMap(m, 'overrides', ov);
      }
      return { items: items, sel: vid(m.id, at) };
    }
    // 此次及以后：原系列到前一天为止，从这一场起另开一个新系列
    const r = rule(m);
    const before = raw(m, m.date, addDays(occ, -1)).length; // 次数要连被删掉的那几场一起算
    const nm = JSON.parse(JSON.stringify(m));
    nm.id = typeof newId === 'function' ? newId() : String(newId);
    nm.date = occ;
    MAPS.forEach((k) => delete nm[k]);
    splitMaps(m, occ, nm);
    if (r.count) {
      m.rrule = withEnd(m.rrule, { count: before });
      nm.rrule = withEnd(nm.rrule, { count: r.count - before });
    } else {
      m.rrule = withEnd(m.rrule, { until: addDays(occ, -1) }); // 新系列沿用原来的结束日期
    }
    items.splice(items.indexOf(m) + 1, 0, nm);
    return edit(items, vid(nm.id, occ), p, 'all', newId);
  }

  // 删某一场：'one' 只删这一场 / 'future' 删这一场和以后的 / 'all' 整个系列。返回 { items }（新数组）
  function remove(items, id, scope) {
    const v = parseVid(id);
    const m = v ? items.find((x) => x && x.id === v.masterId && rule(x)) : null;
    if (!m) return { items: items };
    const occ = v.occ;
    const drop = () => ({ items: items.filter((x) => x !== m) });
    if (scope === 'all') return drop();
    const first = firstOcc(m);
    if (scope === 'future') {
      if (!first || occ <= first) return drop();
      const r = rule(m);
      m.rrule = r.count ? withEnd(m.rrule, { count: raw(m, m.date, addDays(occ, -1)).length }) : withEnd(m.rrule, { until: addDays(occ, -1) });
      splitMaps(m, occ, null);
      return { items: items };
    }
    const ex = (Array.isArray(m.exdates) ? m.exdates : []).filter((k) => k !== occ).concat([occ]).sort();
    m.exdates = ex;
    ['overrides', 'doneDates'].forEach((key) => {
      if (!m[key]) return;
      const o = Object.assign({}, m[key]);
      delete o[occ];
      setMap(m, key, o);
    });
    return firstOcc(m) ? { items: items } : drop();
  }

  // ---------- 详情里的表单 ----------

  // { freq: '' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'LUNAR', byday: [0..6], end: 'never' | 'until' | 'count', until, count }
  function toForm(it) {
    const r = rule(it);
    const f = { freq: '', byday: [], end: 'never', until: '', count: 0 };
    if (!r) return f;
    f.freq = lunarOn(it, r) ? 'LUNAR' : r.freq;
    if (r.freq === 'WEEKLY') f.byday = (r.byday.length ? Array.from(new Set(r.byday)) : [wday(it.date)]).sort((a, b) => a - b);
    if (r.count) { f.end = 'count'; f.count = r.count; } else if (r.until) { f.end = 'until'; f.until = untilKey(r); }
    return f;
  }

  function fromForm(f, date) {
    if (!f || !f.freq || (f.freq !== 'LUNAR' && FREQS.indexOf(f.freq) < 0)) return { rrule: '', lunar: false };
    const freq = f.freq === 'LUNAR' ? 'YEARLY' : f.freq;
    const out = ['FREQ=' + freq];
    if (freq === 'WEEKLY') {
      const list = Array.isArray(f.byday) ? f.byday.filter((d) => d >= 0 && d <= 6) : [];
      const days = Array.from(new Set(list.length || !isKey(date) ? list : [wday(date)])).sort((a, b) => a - b);
      if (days.length) out.push('BYDAY=' + days.map((d) => CODE[d]).join(','));
    }
    if (f.end === 'count' && Number(f.count) >= 1) out.push('COUNT=' + Math.min(999, Math.floor(Number(f.count))));
    else if (f.end === 'until' && isKey(f.until)) out.push('UNTIL=' + f.until.replace(/-/g, ''));
    return { rrule: out.join(';'), lunar: f.freq === 'LUNAR' };
  }

  // 设 / 改 / 取消重复规则（整个系列的事，不问范围）。id 可以是普通条目，也可以是某一场。返回 { sel }
  function setRule(items, id, form) {
    const v = parseVid(id);
    const mid = v && items.some((y) => y && y.id === v.masterId) ? v.masterId : id;
    const m = items.find((x) => x && x.id === mid);
    if (!m) return { sel: id };
    const occ = v && m.id === v.masterId ? v.occ : m.date;
    const was = rule(m);
    const next1 = fromForm(form, m.date);
    if (!next1.rrule) {
      if (!was) return { sel: id };
      // 取消重复：留下正在看的这一场
      const o = isOcc(m, occ) ? occObj(m, occ) : occObj(m, m.date);
      ['title', 'date', 'start', 'end', 'allDay', 'place', 'notes', 'remind', 'due', 'subs'].forEach((k) => { if (k in o) m[k] = o[k]; });
      if (m.kind === 'todo') m.done = !!o.done;
      ['rrule', 'lunar'].concat(MAPS).forEach((k) => delete m[k]);
      return { sel: m.id };
    }
    m.rrule = next1.rrule;
    if (next1.lunar) m.lunar = true; else delete m.lunar;
    if (!was && m.kind === 'todo' && m.done) {
      m.doneDates = Object.assign({}, m.doneDates, { [m.date]: true });
      m.done = false;
    }
    if (isOcc(m, occ)) return { sel: vid(m.id, occ) };
    const n1 = dates(m, occ, addDays(occ, 4000))[0] || firstOcc(m);
    return { sel: n1 ? vid(m.id, n1) : m.id };
  }

  // ---------- 传到 iCloud ----------

  // 本机的重复日程要写成日历文本时的样子（交给 ICS.buildSeries）。农历、待办、一场都没有的不传，返回 null。
  // tz：{ id: 'Asia/Shanghai', offsetMin: 480 }，本机所在的时区。
  // 开始日期取规则排出的第一场（RFC 5545 里开始那天一定算一场）；结束日期换成那天本机 23:59:59 的 UTC（全天的写日期）。
  function forUpload(m, tz) {
    const r = rule(m);
    if (!r || m.kind !== 'event' || lunarOn(m, r) || !firstOcc(m)) return null;
    let first = null;
    for (const h of [400, 4000, 40000]) { first = raw(m, m.date, addDays(m.date, h))[0]; if (first) break; }
    if (!first) return null;
    const allDay = !!m.allDay;
    const rr = m.rrule.split(';').filter(Boolean).map((kv) => {
      const mm = /^UNTIL=(\d{4})(\d{2})(\d{2})$/i.exec(kv);
      if (!mm || allDay) return kv;
      const e = new Date(Number(mm[1]), Number(mm[2]) - 1, Number(mm[3]), 23, 59, 59);
      return 'UNTIL=' + e.getUTCFullYear() + pad(e.getUTCMonth() + 1) + pad(e.getUTCDate()) + 'T' + pad(e.getUTCHours()) + pad(e.getUTCMinutes()) + pad(e.getUTCSeconds()) + 'Z';
    }).join(';');
    const pick = (o) => ({ title: o.title || '', date: o.date, start: o.start || '', end: o.end || '', allDay: !!o.allDay, place: o.place || '', notes: o.notes || '', remind: o.remind });
    const ex = exSet(m);
    const overrides = Object.keys(m.overrides || {}).sort().filter((k) => !ex[k] && isOcc(m, k)).map((k) => ({ occ: k, f: pick(occObj(m, k)) }));
    return Object.assign(pick(m), {
      date: first, rrule: rr,
      exdates: Object.keys(ex).filter((k) => k >= first).sort(),
      overrides: overrides,
      tz: tz,
    });
  }

  // ---------- 迁移 ----------

  // 读数据时调用：没有重复字段的旧条目一个字都不动；写坏了的重复字段丢掉。原地改，返回同一个数组。
  function normalize(items) {
    (Array.isArray(items) ? items : []).forEach((it) => {
      if (!it || typeof it !== 'object') return;
      const touched = ['rrule', 'lunar'].concat(MAPS).some((k) => k in it);
      if (!touched) return;
      if (!rule(it)) {
        ['rrule', 'lunar'].concat(MAPS).forEach((k) => delete it[k]);
        return;
      }
      if ('lunar' in it && it.lunar !== true) delete it.lunar;
      if ('exdates' in it) setMap(it, 'exdates', Array.isArray(it.exdates) ? Array.from(new Set(it.exdates.filter(isKey))).sort() : []);
      if ('overrides' in it) {
        const o = {};
        if (it.overrides && typeof it.overrides === 'object') Object.keys(it.overrides).forEach((k) => { const x = it.overrides[k]; if (isKey(k) && x && typeof x === 'object' && !Array.isArray(x)) o[k] = x; });
        setMap(it, 'overrides', o);
      }
      if ('doneDates' in it) {
        const o = {};
        if (it.doneDates && typeof it.doneDates === 'object') Object.keys(it.doneDates).forEach((k) => { if (isKey(k) && it.doneDates[k] === true) o[k] = true; });
        setMap(it, 'doneDates', o);
      }
    });
    return items;
  }

  const api = {
    isRepeating: isRepeating, expand: expand, get: get, next: next, nearest: nearest, first: firstOcc,
    edit: edit, remove: remove, setRule: setRule, toForm: toForm, fromForm: fromForm, normalize: normalize,
    vid: vid, parseVid: parseVid, addDays: addDays, forUpload: forUpload,
  };
  global.Recur = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
