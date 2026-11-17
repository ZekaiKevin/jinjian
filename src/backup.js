// 今笺 Jinjian：导出备份、导入备份 / .ics（0.9.0）。纯函数，浏览器和 Node 里都能用，单测在 tests/backup.test.js。
//
// 导入时守三条：
//   1. 备份里的 iCloud 镜像（remote）只当参考，不并进现在的缓存，更不会被传回 iCloud；
//   2. 导入的条目一律只存本机（去掉 cal），本来要“存到某个 iCloud 日历”的也不带过来；
//   3. 现在的 iCloud 缓存里已经有的那些（按 UID 认），直接跳过，不在本机再留一份。
// 先 read() 读成统一的样子，再 plan() 给出预览（新增 / 已有 / 冲突 / iCloud 里已有），最后 apply() 才真的写。
(function (global) {
  'use strict';

  const ICS = global.ICS || (typeof require === 'function' ? require('./ics.js') : null);
  const Recur = global.Recur || (typeof require === 'function' ? require('./recur.js') : null);

  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const timeOf = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const utc = (d) => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  const local = (date, time) => {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
    const t = /^(\d{1,2}):(\d{2})/.exec(time || '');
    return d ? new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), t ? Number(t[1]) : 0, t ? Number(t[2]) : 0, 0) : null;
  };
  const LOCAL_ONLY = ['cal', 'uploading', 'draft'];

  // ---------- 导出 ----------

  // 完整备份：本机的全部内容，加一份 iCloud 缓存的镜像（只为了离线时也能翻看，导入时不会用它去改 iCloud）
  function exportJson(state, meta) {
    const m = meta || {};
    return JSON.stringify({
      app: 'jinjian', kind: 'backup', format: 1, appVersion: m.version || '', exported: (m.now || new Date()).toISOString(),
      data: { items: state.items || [], note: state.note || '', extras: state.extras || {}, settings: state.settings || {} },
      remote: { res: (state.remote && state.remote.res) || {} },
    }, null, 1);
  }

  // 一份日历文本里某种块（VEVENT / VTIMEZONE）的原文，每块一个数组
  function blocksOf(text, name) {
    const out = [];
    let cur = null;
    ICS.unfold(text).split('\n').forEach((raw) => {
      const line = raw.replace(/\s+$/, '');
      if (!line) return;
      const up = line.toUpperCase();
      if (up === 'BEGIN:' + name) { cur = [line]; return; }
      if (!cur) return;
      cur.push(line);
      if (up === 'END:' + name) { out.push(cur); cur = null; }
    });
    return out;
  }

  const uidOf = (it) => it.uid || 'jinjian-' + it.id;

  function todoLines(it) {
    const lines = ['BEGIN:VTODO', 'UID:' + uidOf(it), 'DTSTAMP:' + utc(new Date()), 'SUMMARY:' + ICS.escText(it.title || '未命名')];
    const day = local(it.date, '00:00');
    if (day) lines.push('DTSTART;VALUE=DATE:' + keyOf(day).replace(/-/g, ''));
    const due = it.due ? local(it.date, it.due) : null;
    if (due) lines.push('DUE:' + utc(due)); else if (day) lines.push('DUE;VALUE=DATE:' + keyOf(day).replace(/-/g, ''));
    if (it.place) lines.push('LOCATION:' + ICS.escText(it.place));
    if (it.notes) lines.push('DESCRIPTION:' + ICS.escText(it.notes));
    if (Recur.isRepeating(it) && !it.lunar) lines.push('RRULE:' + it.rrule);
    lines.push('STATUS:' + (it.done ? 'COMPLETED' : 'NEEDS-ACTION'));
    if (it.star) lines.push('PRIORITY:1');
    lines.push('END:VTODO');
    return lines;
  }

  // 标准 .ics：本机的日程（重复的带 RRULE / EXDATE / RECURRENCE-ID）、待办（VTODO），再加 iCloud 缓存里的日程原样带上。
  // opt：{ tz: { id, offsetMin }（本机时区，没有夏令时才给）, mirror: [iCloud 条目的原文, …] }
  function exportIcs(items, opt) {
    const o = opt || {};
    const zones = {};
    const body = [];
    const takeZones = (text) => blocksOf(text, 'VTIMEZONE').forEach((b) => {
      const id = (b.find((l) => /^TZID:/i.test(l)) || '').slice(5).trim();
      if (id && !zones[id]) zones[id] = b;
    });
    (items || []).forEach((it) => {
      if (!it || it.draft) return;
      if (it.kind === 'todo') { todoLines(it).forEach((l) => body.push(l)); return; }
      const series = Recur.isRepeating(it) ? Recur.forUpload(it, o.tz || null) : null;
      const text = series ? ICS.buildSeries(uidOf(it), series) : ICS.build(uidOf(it), it);
      takeZones(text);
      blocksOf(text, 'VEVENT').forEach((b) => b.forEach((l) => body.push(l)));
    });
    (o.mirror || []).forEach((text) => {
      takeZones(text);
      blocksOf(text, 'VEVENT').forEach((b) => b.forEach((l) => body.push(l)));
    });
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jinjian//CN', 'CALSCALE:GREGORIAN'];
    Object.keys(zones).forEach((id) => zones[id].forEach((l) => lines.push(l)));
    return lines.concat(body, ['END:VCALENDAR']).map(ICS.fold).join('\r\n') + '\r\n';
  }

  // ---------- 读进来 ----------

  const remindOf = (alarm) => (alarm === null || alarm === undefined ? 'none' : String(alarm));

  // 一个 VEVENT（ics.js 读出来的）在本机该是什么样：日期、时间按本机时区；跨天的记到开始那天（本机日程不跨天）
  function eventFields(ev) {
    const one = ICS.expand([Object.assign({}, ev, { rrule: null, rid: null, exdates: [] })], new Date(-8e15), new Date(8e15))[0];
    if (!one) return null;
    const f = { title: ev.title || '', date: one.date, place: ev.place || '', notes: ev.notes || '', remind: remindOf(ev.alarm) };
    if (ev.start.allDay) Object.assign(f, { allDay: true, start: '', end: '' });
    else Object.assign(f, { start: one.start, end: one.parts ? '23:59' : one.end });
    return f;
  }

  // 规则换成本机的写法：结束日期只留日期；本机认不了的规则返回 ''
  function localRule(text, date) {
    const rr = String(text || '').split(';').filter(Boolean).map((kv) => {
      const m = /^UNTIL=(.+)$/i.exec(kv);
      if (!m) return kv;
      const dt = ICS.parseRRule('FREQ=DAILY;UNTIL=' + m[1]).until;
      return dt ? 'UNTIL=' + keyOf(ICS.toDate(dt)).replace(/-/g, '') : '';
    }).filter(Boolean).join(';');
    return Recur.isRepeating({ date: date, rrule: rr }) ? rr : '';
  }

  function todosOf(text) {
    return blocksOf(text, 'VTODO').map((b) => {
      const p = {};
      b.forEach((l) => { const x = ICS.parseLine(l); if (x && !(x.name in p)) p[x.name] = x; });
      const dt = (x) => {
        if (!x) return null;
        const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(x.value.trim());
        if (!m) return null;
        const allDay = m[4] === undefined;
        return { allDay: allDay, d: ICS.toDate({ allDay: allDay, utc: !!m[7], tz: x.params.TZID || '', wall: { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) } }) };
      };
      const due = dt(p.DUE);
      const start = dt(p.DTSTART);
      const day = (due && due.d) || (start && start.d) || new Date();
      const it = {
        kind: 'todo', uid: p.UID ? p.UID.value.trim() : '', title: p.SUMMARY ? ICS.unesc(p.SUMMARY.value) : '', date: keyOf(day),
        due: due && !due.allDay ? timeOf(due.d) : '', place: p.LOCATION ? ICS.unesc(p.LOCATION.value).replace(/\n/g, ' ') : '', notes: p.DESCRIPTION ? ICS.unesc(p.DESCRIPTION.value) : '',
        done: !!p.STATUS && p.STATUS.value.trim().toUpperCase() === 'COMPLETED', star: !!p.PRIORITY && Number(p.PRIORITY.value) === 1, subs: [],
      };
      const rr = p.RRULE ? localRule(p.RRULE.value, it.date) : '';
      if (rr) { it.rrule = rr; if (it.done) { it.doneDates = { [it.date]: true }; it.done = false; } }
      return it;
    });
  }

  // .ics → 本机条目（还没有 id）。重复日程带着规则、删掉的那几场、单独改过的那几场一起进来。
  function fromIcs(text) {
    const evs = ICS.parse(text);
    const out = [];
    const masters = evs.filter((e) => !e.rid);
    masters.forEach((ev) => {
      if (ev.status === 'CANCELLED') return;
      const f = eventFields(ev);
      if (!f) return;
      const it = Object.assign({ kind: 'event', uid: ev.uid || '', subs: [] }, f);
      const rr = ev.rrule ? localRule(ev.rruleText, it.date) : '';
      if (rr) {
        // 开始那天不在规则里（周三建的“每周一”）：从规则的第一场算起
        const first = Recur.first({ id: 'x', date: it.date, rrule: rr });
        if (!first) return;
        it.date = first;
        it.rrule = rr;
        const ex = ev.exdates.map((d) => keyOf(ICS.toDate(d)));
        const ov = {};
        evs.filter((e) => e.rid && e.uid === ev.uid).forEach((o) => {
          const occ = keyOf(ICS.toDate(o.rid));
          if (o.status === 'CANCELLED') { ex.push(occ); return; }
          const of = eventFields(o);
          if (!of) return;
          const d = {};
          ['title', 'start', 'end', 'allDay', 'place', 'notes'].forEach((k) => { if ((of[k] || '') !== (it[k] || '')) d[k] = of[k]; });
          if (of.date !== occ) d.date = of.date;
          if (Object.keys(d).length) ov[occ] = d;
        });
        if (ex.length) it.exdates = Array.from(new Set(ex)).sort();
        if (Object.keys(ov).length) it.overrides = ov;
      }
      out.push(it);
    });
    // 只有某一场、没有它所属的系列（被邀请参加其中一次）：当成一条普通日程
    const known = {};
    masters.forEach((e) => { known[e.uid] = true; });
    evs.filter((e) => e.rid && !known[e.uid] && e.status !== 'CANCELLED').forEach((o) => {
      const f = eventFields(o);
      if (f) out.push(Object.assign({ kind: 'event', uid: (o.uid || '') + '#' + keyOf(ICS.toDate(o.rid)), subs: [] }, f));
    });
    return out.concat(todosOf(text));
  }

  // 读一个文件的内容。返回 { ok, kind: 'json' | 'ics', items, note, extras, mirror（备份里 iCloud 镜像有几条）, error }
  function read(text) {
    const s = String(text || '').replace(/^﻿/, '');
    const bad = (error) => ({ ok: false, kind: '', items: [], note: '', extras: {}, mirror: 0, error: error });
    if (/^\s*\{/.test(s)) {
      let d = null;
      try { d = JSON.parse(s); } catch (err) { return bad('不是有效的备份文件'); }
      const data = d && d.app === 'jinjian' && d.data ? d.data : d; // 也认直接拿来的 data.json
      if (!data || !Array.isArray(data.items)) return bad('不是今笺的备份文件');
      const remote = (d && d.remote) || data.remote || {};
      const items = Recur.normalize(JSON.parse(JSON.stringify(data.items)).filter((it) => it && typeof it === 'object' && (it.kind === 'event' || it.kind === 'todo') && Recur.isKey(it.date)));
      return { ok: true, kind: 'json', items: items, note: typeof data.note === 'string' ? data.note : '', extras: data.extras && typeof data.extras === 'object' ? data.extras : {}, mirror: Object.keys(remote.res || {}).length, error: '' };
    }
    if (/BEGIN:VCALENDAR/i.test(s)) {
      let items = [];
      try { items = fromIcs(s); } catch (err) { return bad('这个 .ics 读不出来'); }
      return { ok: true, kind: 'ics', items: items, note: '', extras: {}, mirror: 0, error: '' };
    }
    return bad('只认今笺的备份（.json）和日历文件（.ics）');
  }

  // ---------- 预览 ----------

  // 内容一样不一样，不看 id 和只在本机有意义的标记
  function sig(it) {
    const c = {};
    Object.keys(it).sort().forEach((k) => {
      if (k === 'id' || k === 'uid' || k === 'holEx' || LOCAL_ONLY.indexOf(k) >= 0) return;
      const v = it[k];
      if (v === '' || v === false || v === null || v === undefined || (Array.isArray(v) && !v.length)) return;
      if (k === 'remind' && v === 'none') return;
      c[k] = v;
    });
    return JSON.stringify(c);
  }

  // 现在 iCloud 缓存里有哪些 UID
  function mirrorUids(res) {
    const out = {};
    Object.keys(res || {}).forEach((h) => {
      const m = /^UID:(.+)$/im.exec(ICS.unfold(res[h].ics || ''));
      if (m) out[m[1].trim()] = true;
    });
    return out;
  }

  // existing：现在本机的条目；incoming：read() 读出来的；uids：mirrorUids() 的结果。
  //   add     新的        dup    本机已经有一模一样的（跳过）
  //   clash   同一条（id 或 UID 一样）但内容不同，要问怎么办    mirror  iCloud 里已经有（跳过）
  function plan(existing, incoming, uids) {
    const have = {};
    const byId = {};
    const byUid = {};
    (existing || []).forEach((it) => { have[sig(it)] = true; byId[it.id] = it; if (it.uid) byUid[it.uid] = it; });
    const out = { add: [], dup: [], clash: [], mirror: [] };
    const seen = {};
    (incoming || []).forEach((it) => {
      const s = sig(it);
      if (it.uid && uids && uids[it.uid.split('#')[0]]) { out.mirror.push(it); return; }
      if (have[s] || seen[s]) { out.dup.push(it); return; }
      seen[s] = true;
      const cur = (it.id !== undefined && byId[it.id]) || (it.uid && byUid[it.uid]) || null;
      if (cur) out.clash.push({ inc: it, cur: cur }); else out.add.push(it);
    });
    return out;
  }

  // 真的写。clash：'both' 两份都留（导入的那份换新 id）/ 'replace' 用导入的换掉本机的 / 'skip' 不动。
  // newId(kind) 给新 id。导入的一律只存本机；子任务的 id 也换新的，免得和本机的撞。返回 { items, added, replaced }。
  function apply(existing, p, clash, newId) {
    const items = (existing || []).slice();
    const used = {};
    items.forEach((it) => { used[it.id] = true; });
    const prep = (src, keepId) => {
      const it = JSON.parse(JSON.stringify(src));
      LOCAL_ONLY.forEach((k) => delete it[k]);
      if (!keepId || it.id === undefined || used[it.id]) it.id = newId(it.kind);
      used[it.id] = true;
      if (Array.isArray(it.subs)) it.subs = it.subs.map((s) => Object.assign({}, s, { id: newId('sub') })); else it.subs = [];
      if (it.kind === 'todo') { it.done = !!it.done; it.star = !!it.star; if (!it.due) it.due = ''; } else if (!it.remind) it.remind = 'none';
      return it;
    };
    let added = 0;
    let replaced = 0;
    p.add.forEach((src) => { items.push(prep(src, true)); added += 1; });
    p.clash.forEach((c) => {
      if (clash === 'replace') {
        const i = items.indexOf(c.cur);
        const it = prep(c.inc, false);
        it.id = c.cur.id;
        if (i >= 0) items[i] = it; else items.push(it);
        replaced += 1;
      } else if (clash !== 'skip') { items.push(prep(c.inc, false)); added += 1; }
    });
    return { items: items, added: added, replaced: replaced };
  }

  // 便签：备份里的便签现在没有的那几行，接在后面
  function mergeNote(cur, inc) {
    const a = String(cur || '');
    const b = String(inc || '').trim();
    if (!b || a.indexOf(b) >= 0) return a;
    const have = {};
    a.split('\n').forEach((l) => { have[l.trim()] = true; });
    const fresh = b.split('\n').filter((l) => l.trim() && !have[l.trim()]);
    return fresh.length ? (a.replace(/\s+$/, '') ? a.replace(/\s+$/, '') + '\n' : '') + fresh.join('\n') : a;
  }

  const api = { exportJson: exportJson, exportIcs: exportIcs, read: read, fromIcs: fromIcs, plan: plan, apply: apply, mirrorUids: mirrorUids, mergeNote: mergeNote, sig: sig };
  global.Backup = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
