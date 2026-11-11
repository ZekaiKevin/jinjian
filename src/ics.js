// 今笺：iCalendar 文本的解析、重复规则展开、生成与修改。
// 纯函数，不碰界面，方便单独测试。
(function (global) {
  'use strict';

  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  function unfold(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  }

  function unesc(s) {
    return String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  }

  function escText(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  }

  // “名字;参数=值:内容” 拆开；冒号要跳过引号里的。
  function parseLine(line) {
    let quoted = false;
    let cut = -1;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') quoted = !quoted;
      else if (ch === ':' && !quoted) { cut = i; break; }
    }
    if (cut < 0) return null;
    const head = line.slice(0, cut).split(';');
    const params = {};
    head.slice(1).forEach((p) => {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
    });
    return { name: head[0].toUpperCase(), params: params, value: line.slice(cut + 1) };
  }

  // 日期时间：全天（只有日期）、UTC（结尾 Z）、带时区、或“浮动”的本地时间。
  function parseDT(prop) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(prop.value.trim());
    if (!m) return null;
    const allDay = m[4] === undefined;
    return {
      allDay: allDay,
      utc: !!m[7],
      tz: prop.params.TZID || '',
      wall: { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), h: allDay ? 0 : Number(m[4]), mi: allDay ? 0 : Number(m[5]), s: allDay ? 0 : Number(m[6] || 0) },
    };
  }

  // 某个时区在某一时刻比 UTC 快多少分钟。
  function tzOffsetMin(tz, utcMs) {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = {};
    f.formatToParts(new Date(utcMs)).forEach((x) => { p[x.type] = x.value; });
    const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
    return (asUtc - utcMs) / 60000;
  }

  function toDate(dt) {
    const w = dt.wall;
    if (dt.allDay) return new Date(w.y, w.m - 1, w.d);
    if (dt.utc) return new Date(Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s));
    if (dt.tz) {
      try {
        const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
        const first = guess - tzOffsetMin(dt.tz, guess) * 60000;
        return new Date(guess - tzOffsetMin(dt.tz, first) * 60000);
      } catch (err) {
        // 不认识的时区名，当作本地时间
      }
    }
    return new Date(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  }

  function parseDuration(v) {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
    if (!m) return null;
    const mins = Number(m[2] || 0) * 10080 + Number(m[3] || 0) * 1440 + Number(m[4] || 0) * 60 + Number(m[5] || 0) + Math.round(Number(m[6] || 0) / 60);
    return m[1] === '-' ? -mins : mins;
  }

  function parseRRule(v) {
    const map = {};
    String(v || '').split(';').forEach((kv) => {
      const eq = kv.indexOf('=');
      if (eq > 0) map[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
    });
    if (!map.FREQ) return null;
    const rule = { freq: map.FREQ.toUpperCase(), interval: Math.max(1, Number(map.INTERVAL || 1)), byday: [], bydayOrd: [], count: map.COUNT ? Number(map.COUNT) : 0, until: null, bymonthday: 0 };
    if (map.BYDAY) {
      map.BYDAY.split(',').forEach((x) => {
        const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x.trim().toUpperCase());
        if (!m || CODES[m[2]] === undefined) return;
        rule.byday.push(CODES[m[2]]);
        rule.bydayOrd.push({ ord: m[1] ? Number(m[1]) : 0, w: CODES[m[2]] });
      });
    }
    if (map.BYMONTHDAY) rule.bymonthday = Number(map.BYMONTHDAY.split(',')[0]) || 0;
    if (map.UNTIL) rule.until = parseDT({ value: map.UNTIL, params: {} });
    return rule;
  }

  // 把一份日历文本里的所有 VEVENT 读出来。
  function parse(text) {
    const lines = unfold(text).split('\n');
    const events = [];
    let ev = null;
    let inAlarm = false;
    lines.forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      const up = line.toUpperCase();
      if (up === 'BEGIN:VEVENT') { ev = { uid: '', title: '', place: '', notes: '', start: null, end: null, duration: null, rrule: null, exdates: [], rid: null, alarm: null, status: '' }; return; }
      if (up === 'END:VEVENT') { if (ev && ev.start) events.push(ev); ev = null; inAlarm = false; return; }
      if (!ev) return;
      if (up === 'BEGIN:VALARM') { inAlarm = true; return; }
      if (up === 'END:VALARM') { inAlarm = false; return; }
      const p = parseLine(line);
      if (!p) return;
      if (inAlarm) {
        if (p.name === 'TRIGGER' && ev.alarm === null) {
          const d = parseDuration(p.value);
          if (d !== null && d <= 0) ev.alarm = d === 0 ? 0 : -d;
        }
        return;
      }
      switch (p.name) {
        case 'UID': ev.uid = p.value.trim(); break;
        case 'SUMMARY': ev.title = unesc(p.value); break;
        case 'LOCATION': ev.place = unesc(p.value).replace(/\n/g, ' '); break;
        case 'DESCRIPTION': ev.notes = unesc(p.value); break;
        case 'STATUS': ev.status = p.value.trim().toUpperCase(); break;
        case 'DTSTART': ev.start = parseDT(p); break;
        case 'DTEND': ev.end = parseDT(p); break;
        case 'DURATION': ev.duration = parseDuration(p.value); break;
        case 'RRULE': ev.rrule = parseRRule(p.value); break;
        case 'RECURRENCE-ID': ev.rid = parseDT(p); break;
        case 'EXDATE':
          p.value.split(',').forEach((v) => {
            const d = parseDT({ value: v, params: p.params });
            if (d) ev.exdates.push(d);
          });
          break;
        default: break;
      }
    });
    return events;
  }

  function durationMin(e) {
    if (e.end) return Math.max(0, Math.round((toDate(e.end) - toDate(e.start)) / 60000));
    if (e.duration !== null && e.duration > 0) return e.duration;
    return e.start.allDay ? 1440 : 60;
  }

  // 按重复规则逐个给出日期；cb 返回 false 就停。
  function iterate(master, cb) {
    const r = master.rrule;
    const w0 = master.start.wall;
    const base = Date.UTC(w0.y, w0.m - 1, w0.d);
    const emit = (ms) => {
      const d = new Date(ms);
      return cb({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: w0.h, mi: w0.mi, s: w0.s });
    };
    if (r.freq === 'DAILY') {
      for (let i = 0; i < 5000; i += 1) if (emit(base + i * r.interval * DAY) === false) return;
    } else if (r.freq === 'WEEKLY') {
      const baseDow = new Date(base).getUTCDay();
      const days = (r.byday.length ? r.byday.slice() : [baseDow]).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      const weekStart = base - ((baseDow + 6) % 7) * DAY;
      for (let w = 0; w < 1500; w += 1) {
        const ws = weekStart + w * r.interval * 7 * DAY;
        for (let k = 0; k < days.length; k += 1) {
          const ms = ws + ((days[k] + 6) % 7) * DAY;
          if (ms < base) continue;
          if (emit(ms) === false) return;
        }
      }
    } else if (r.freq === 'MONTHLY' && r.bydayOrd.length) {
      // 每月按“第几个周几”：2TU 是第二个周二，-1FR 是最后一个周五，不带数字就是每个
      for (let i = 0; i < 1200; i += 1) {
        const idx = (w0.y * 12 + (w0.m - 1)) + i * r.interval;
        const y = Math.floor(idx / 12);
        const mo = idx % 12;
        const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
        const firstDow = new Date(Date.UTC(y, mo, 1)).getUTCDay();
        const picked = new Set();
        r.bydayOrd.forEach((b) => {
          const all = [];
          for (let d = 1 + ((b.w - firstDow + 7) % 7); d <= last; d += 7) all.push(d);
          if (b.ord > 0 && all[b.ord - 1]) picked.add(all[b.ord - 1]);
          else if (b.ord < 0 && all[all.length + b.ord]) picked.add(all[all.length + b.ord]);
          else if (b.ord === 0) all.forEach((d) => picked.add(d));
        });
        const days = Array.from(picked).sort((a, b) => a - b);
        for (let k = 0; k < days.length; k += 1) {
          const ms = Date.UTC(y, mo, days[k]);
          if (ms < base) continue;
          if (emit(ms) === false) return;
        }
      }
    } else if (r.freq === 'MONTHLY' || r.freq === 'YEARLY') {
      const step = r.freq === 'YEARLY' ? 12 * r.interval : r.interval;
      const day = r.bymonthday > 0 ? r.bymonthday : w0.d;
      for (let i = 0; i < 1200; i += 1) {
        const idx = (w0.y * 12 + (w0.m - 1)) + i * step;
        const y = Math.floor(idx / 12);
        const m = idx % 12;
        const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        if (day > last) continue;
        if (emit(Date.UTC(y, m, day)) === false) return;
      }
    } else {
      emit(base);
    }
  }

  function localKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function localTime(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function instance(src, startDt, dur) {
    const start = toDate(startDt);
    const allDay = startDt.allDay;
    const end = new Date(start.getTime() + dur * 60000);
    return {
      dur: dur,
      uid: src.uid,
      title: src.title,
      place: src.place,
      notes: src.notes,
      remind: src.alarm,
      allDay: allDay,
      date: localKey(start),
      start: allDay ? '' : localTime(start),
      end: allDay ? '' : localTime(end),
      key: localKey(start).replace(/-/g, '') + (allDay ? '' : localTime(start).replace(':', '')),
      ms: start.getTime(),
    };
  }

  // 跨过午夜的日程按天拆开，每天一段：第一天从开始到 23:59，中间几天算全天，最后一天从 0 点到结束。
  function pieces(one, dur) {
    const start = new Date(one.ms);
    const end = new Date(one.ms + Math.max(dur, 1) * 60000 - 1);
    const d0 = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const d1 = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const n = Math.round((d1 - d0) / DAY) + 1;
    if (n <= 1) return [one];
    const out = [];
    for (let i = 0; i < n && i < 366; i += 1) {
      const day = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i);
      const p = Object.assign({}, one, { date: localKey(day), part: i + 1, parts: n, key: one.key + '-' + (i + 1), ms: i ? day.getTime() : one.ms });
      if (!one.allDay) {
        const first = i === 0;
        const lastPiece = i === n - 1;
        if (!first && !lastPiece) Object.assign(p, { allDay: true, start: '', end: '' });
        else Object.assign(p, { start: first ? one.start : '00:00', end: lastPiece ? localTime(new Date(one.ms + dur * 60000)) : '23:59' });
      }
      out.push(p);
    }
    return out;
  }

  // 把一个日历条目（可能带重复规则和单次改动）展开成 [from, to] 之间的具体场次。
  function expand(events, from, to) {
    const all = [];
    const fromMs = from.getTime();
    const toMs = to.getTime();
    const out = { push: (one) => pieces(one, one.dur).forEach((p) => { if (p.ms <= toMs && p.ms + DAY > fromMs) all.push(p); }) };
    const overrides = events.filter((e) => e.rid);
    events.filter((e) => !e.rid).forEach((m) => {
      if (m.status === 'CANCELLED') return;
      const dur = durationMin(m);
      if (!m.rrule) {
        const one = instance(m, m.start, dur);
        if (one.ms + dur * 60000 >= fromMs && one.ms <= toMs) out.push(one);
        return;
      }
      const ov = new Map();
      overrides.filter((o) => o.uid === m.uid).forEach((o) => ov.set(toDate(o.rid).getTime(), o));
      const ex = new Set(m.exdates.map((d) => toDate(d).getTime()));
      const until = m.rrule.until ? toDate(m.rrule.until).getTime() + (m.rrule.until.allDay ? DAY - 1 : 0) : Infinity;
      const max = m.rrule.count || Infinity;
      let count = 0;
      iterate(m, (wall) => {
        const dt = { allDay: m.start.allDay, utc: m.start.utc, tz: m.start.tz, wall: wall };
        const ms = toDate(dt).getTime();
        if (ms > until || count >= max || ms > toMs) return false;
        count += 1;
        if (ex.has(ms)) return true;
        if (ov.has(ms)) {
          const o = ov.get(ms);
          if (o.status !== 'CANCELLED') {
            const changed = instance(o, o.start, durationMin(o));
            if (changed.ms + dur * 60000 >= fromMs && changed.ms <= toMs) out.push(changed);
          }
          return true;
        }
        if (ms + dur * 60000 >= fromMs) out.push(instance(m, dt, dur));
        return true;
      });
    });
    return all;
  }

  // ---------- 生成与修改 ----------

  function fmtUTC(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }

  // 一行不超过 75 个字节，超了折行（中文一个字三个字节，所以按字节数算）。
  function fold(line) {
    const enc = new TextEncoder();
    let out = '';
    let cur = '';
    let bytes = 0;
    for (const ch of line) {
      const n = enc.encode(ch).length;
      if (bytes + n > 73) { out += cur + '\r\n '; cur = ''; bytes = 1; }
      cur += ch;
      bytes += n;
    }
    return out + cur;
  }

  function fromLocal(date, time) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const t = /^(\d{1,2}):(\d{2})/.exec(time || '');
    if (!d) return null;
    return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), t ? Number(t[1]) : 0, t ? Number(t[2]) : 0, 0);
  }

  // fields: { title, date, start, end, place, notes, allDay }
  function timeLines(f) {
    if (f.allDay) {
      const s = fromLocal(f.date, '00:00');
      const e = new Date(s.getTime());
      e.setDate(e.getDate() + 1);
      const ymd = (x) => x.getFullYear() + pad(x.getMonth() + 1) + pad(x.getDate());
      return ['DTSTART;VALUE=DATE:' + ymd(s), 'DTEND;VALUE=DATE:' + ymd(e)];
    }
    const s = fromLocal(f.date, f.start || '09:00');
    let e = fromLocal(f.date, f.end || '');
    if (!f.end || !e || e <= s) e = new Date(s.getTime() + 3600000);
    return ['DTSTART:' + fmtUTC(s), 'DTEND:' + fmtUTC(e)];
  }

  function bodyLines(f) {
    const lines = ['DTSTAMP:' + fmtUTC(new Date())].concat(timeLines(f));
    lines.push('SUMMARY:' + escText(f.title || '未命名'));
    if (f.place) lines.push('LOCATION:' + escText(f.place));
    if (f.notes) lines.push('DESCRIPTION:' + escText(f.notes));
    return lines;
  }

  // 提醒：'none' 或空就不写；0 是到点提醒
  function alarmLines(remind) {
    if (remind === undefined || remind === null || remind === '' || remind === 'none') return [];
    const mins = Number(remind);
    if (isNaN(mins) || mins < 0) return [];
    return ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:' + (mins === 0 ? 'PT0S' : '-PT' + mins + 'M'), 'END:VALARM'];
  }

  function build(uid, f) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jinjian//CN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', 'UID:' + uid]
      .concat(bodyLines(f), alarmLines(f.remind))
      .concat(['END:VEVENT', 'END:VCALENDAR']);
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  // 只改第一个主事件里的标题、时间、地点、备注，其余原样保留。
  // f.remind 不传就不碰原来的提醒（Apple 日历常有两条提醒，不能随手合成一条）；传了就整体替换。
  function patch(text, f) {
    const lines = unfold(text).split('\n').filter((l) => l.length > 0);
    const begin = lines.findIndex((l) => l.trim().toUpperCase() === 'BEGIN:VEVENT');
    if (begin < 0) return text;
    let end = -1;
    for (let i = begin + 1; i < lines.length; i += 1) {
      if (lines[i].trim().toUpperCase() === 'END:VEVENT') { end = i; break; }
    }
    if (end < 0) return text;
    const drop = /^(SUMMARY|LOCATION|DESCRIPTION|DTSTART|DTEND|DURATION|DTSTAMP|LAST-MODIFIED|SEQUENCE)([;:]|$)/i;
    const swapAlarm = f.remind !== undefined;
    let seq = 0;
    let nested = 0;
    let inAlarm = false;
    const kept = [];
    for (let i = begin + 1; i < end; i += 1) {
      const up = lines[i].trim().toUpperCase();
      if (swapAlarm && up === 'BEGIN:VALARM') inAlarm = true;
      if (inAlarm) {
        if (up === 'END:VALARM') inAlarm = false;
        continue;
      }
      if (up.indexOf('BEGIN:') === 0) nested += 1;
      if (nested === 0 && drop.test(lines[i])) {
        const m = /^SEQUENCE:(\d+)/i.exec(lines[i]);
        if (m) seq = Number(m[1]);
        continue;
      }
      kept.push(lines[i]);
      if (up.indexOf('END:') === 0) nested -= 1;
    }
    const fresh = bodyLines(f).concat(['SEQUENCE:' + (seq + 1), 'LAST-MODIFIED:' + fmtUTC(new Date())]);
    const all = lines.slice(0, begin + 1).concat(fresh, kept, swapAlarm ? alarmLines(f.remind) : [], lines.slice(end));
    return all.map(fold).join('\r\n') + '\r\n';
  }

  const api = { parse: parse, expand: expand, build: build, patch: patch, toDate: toDate, unfold: unfold };
  global.ICS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
