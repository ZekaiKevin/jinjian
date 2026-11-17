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

  // 一次扫完：“\\n”是反斜杠加 n，不能被当成换行
  function unesc(s) {
    return String(s || '').replace(/\\([nN,;\\])/g, (all, c) => (c === 'n' || c === 'N' ? '\n' : c));
  }

  function escText(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  }

  // “名字;参数=值:内容” 拆开；冒号和分号都要跳过引号里的。
  function parseLine(line) {
    let quoted = false;
    let cut = -1;
    const semis = [];
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === ';') semis.push(i);
      else if (!quoted && ch === ':') { cut = i; break; }
    }
    if (cut < 0) return null;
    const head = [];
    let from = 0;
    semis.forEach((i) => { head.push(line.slice(from, i)); from = i + 1; });
    head.push(line.slice(from, cut));
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

  // Outlook、Exchange 导出的日历用 Windows 的时区名，换成 IANA 名才能算偏移
  const WIN_TZ = {
    'China Standard Time': 'Asia/Shanghai', 'Taipei Standard Time': 'Asia/Taipei', 'Tokyo Standard Time': 'Asia/Tokyo',
    'Korea Standard Time': 'Asia/Seoul', 'Singapore Standard Time': 'Asia/Singapore', 'India Standard Time': 'Asia/Kolkata',
    'SE Asia Standard Time': 'Asia/Bangkok', 'W. Australia Standard Time': 'Australia/Perth', 'AUS Eastern Standard Time': 'Australia/Sydney',
    'New Zealand Standard Time': 'Pacific/Auckland', 'Arabian Standard Time': 'Asia/Dubai', 'Israel Standard Time': 'Asia/Jerusalem',
    'Russian Standard Time': 'Europe/Moscow', 'Turkey Standard Time': 'Europe/Istanbul', 'GMT Standard Time': 'Europe/London',
    'Greenwich Standard Time': 'Atlantic/Reykjavik', 'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest',
    'Central European Standard Time': 'Europe/Warsaw', 'Romance Standard Time': 'Europe/Paris', 'E. Europe Standard Time': 'Europe/Chisinau',
    'FLE Standard Time': 'Europe/Kiev', 'GTB Standard Time': 'Europe/Bucharest', 'South Africa Standard Time': 'Africa/Johannesburg',
    'Egypt Standard Time': 'Africa/Cairo', 'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago',
    'Mountain Standard Time': 'America/Denver', 'US Mountain Standard Time': 'America/Phoenix', 'Pacific Standard Time': 'America/Los_Angeles',
    'Alaskan Standard Time': 'America/Anchorage', 'Hawaiian Standard Time': 'Pacific/Honolulu', 'Atlantic Standard Time': 'America/Halifax',
    'Canada Central Standard Time': 'America/Regina', 'Mexico Standard Time': 'America/Mexico_City', 'SA Pacific Standard Time': 'America/Bogota',
    'E. South America Standard Time': 'America/Sao_Paulo', 'Argentina Standard Time': 'America/Argentina/Buenos_Aires', 'UTC': 'UTC',
  };
  const tzMemo = {};
  const ianaOf = (tz) => WIN_TZ[tz] || tz;
  // 这个时区名系统认不认识
  function tzKnown(tz) {
    const name = ianaOf(tz);
    if (!(name in tzMemo)) {
      try { new Intl.DateTimeFormat('en-US', { timeZone: name }); tzMemo[name] = true; } catch (err) { tzMemo[name] = false; }
    }
    return tzMemo[name];
  }

  // 某个时区在某一时刻比 UTC 快多少分钟。
  function tzOffsetMin(tz, utcMs) {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaOf(tz), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
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
    // 日历文件自己带的时区定义（只有标准时间、没有夏令时的那种）
    if (dt.offset !== undefined) return new Date(Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - dt.offset * 60000);
    if (dt.tz && tzKnown(dt.tz)) {
      const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
      const first = guess - tzOffsetMin(dt.tz, guess) * 60000;
      return new Date(guess - tzOffsetMin(dt.tz, first) * 60000);
    }
    // 不认识的时区名，当作本地时间
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
    // counted：规则里写了 COUNT。COUNT=0（或写坏了）是“一场都没有”，不能和“没写次数”混在一起
    const counted = map.COUNT !== undefined;
    const cnt = counted ? Math.floor(Number(map.COUNT)) : 0;
    const rule = { freq: map.FREQ.toUpperCase(), interval: Math.max(1, Number(map.INTERVAL || 1)), byday: [], bydayOrd: [], count: cnt > 0 ? cnt : 0, counted: counted, until: null, bymonthday: [], bymonth: [] };
    if (map.BYDAY) {
      map.BYDAY.split(',').forEach((x) => {
        const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x.trim().toUpperCase());
        if (!m || CODES[m[2]] === undefined) return;
        rule.byday.push(CODES[m[2]]);
        rule.bydayOrd.push({ ord: m[1] ? Number(m[1]) : 0, w: CODES[m[2]] });
      });
    }
    // 每月几号：可以写多个，负数从月底倒数（-1 是最后一天）
    if (map.BYMONTHDAY) rule.bymonthday = map.BYMONTHDAY.split(',').map(Number).filter((x) => x && Math.abs(x) <= 31);
    if (map.BYMONTH) rule.bymonth = map.BYMONTH.split(',').map(Number).filter((x) => x >= 1 && x <= 12).sort((a, b) => a - b);
    if (map.UNTIL) rule.until = parseDT({ value: map.UNTIL, params: {} });
    return rule;
  }

  // 日历文件里自带的时区定义：只记没有夏令时的（中国、印度这类），给系统不认识的时区名兜底
  function readZones(lines) {
    const zones = {};
    let cur = null;
    let sub = '';
    lines.forEach((raw) => {
      const line = raw.trim();
      const up = line.toUpperCase();
      if (up === 'BEGIN:VTIMEZONE') { cur = { id: '', std: null, dst: false }; return; }
      if (up === 'END:VTIMEZONE') { if (cur && cur.id) zones[cur.id] = cur; cur = null; return; }
      if (!cur) return;
      if (up === 'BEGIN:STANDARD') sub = 'std';
      else if (up === 'BEGIN:DAYLIGHT') { sub = 'dst'; cur.dst = true; } else if (up === 'END:STANDARD' || up === 'END:DAYLIGHT') sub = '';
      else if (up.indexOf('TZID:') === 0) cur.id = line.slice(5).trim();
      else if (up.indexOf('TZOFFSETTO:') === 0 && sub === 'std') {
        const m = /^([+-])(\d{2})(\d{2})/.exec(line.slice(11).trim());
        if (m) cur.std = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
      }
    });
    return zones;
  }

  // 把一份日历文本里的所有 VEVENT 读出来。
  function parse(text) {
    const lines = unfold(text).split('\n');
    const zones = readZones(lines);
    const events = [];
    let ev = null;
    let inAlarm = false;
    lines.forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      const up = line.toUpperCase();
      if (up === 'BEGIN:VEVENT') { ev = { uid: '', title: '', place: '', notes: '', start: null, end: null, duration: null, rrule: null, exdates: [], rid: null, alarm: null, status: '' }; return; }
      if (up === 'END:VEVENT') {
        if (ev && ev.start) {
          [ev.start, ev.end, ev.rid].concat(ev.exdates).forEach((dt) => {
            const z = dt && dt.tz && !tzKnown(dt.tz) ? zones[dt.tz] : null;
            if (z && !z.dst && z.std !== null) dt.offset = z.std;
          });
          events.push(ev);
        }
        ev = null;
        inAlarm = false;
        return;
      }
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
        case 'RRULE': ev.rrule = parseRRule(p.value); ev.rruleText = p.value.trim(); break;
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
      for (let i = 0; i < 5000; i += 1) {
        const ms = base + i * r.interval * DAY;
        if (r.byday.length && r.byday.indexOf(new Date(ms).getUTCDay()) < 0) continue; // “工作日每天”
        if (emit(ms) === false) return;
      }
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
    } else if (r.freq === 'MONTHLY' || r.freq === 'YEARLY') {
      // 每月（或每年的指定几个月）里挑日子：第几个周几（2TU、-1FR）、几号（可多个，-1 是最后一天），都没写就沿用开始那天
      const yearly = r.freq === 'YEARLY';
      const months = yearly ? (r.bymonth.length ? r.bymonth : [w0.m]) : null;
      for (let i = 0; i < 1200; i += 1) {
        const slots = [];
        if (yearly) months.forEach((mo) => slots.push([w0.y + i * r.interval, mo - 1]));
        else {
          const idx = (w0.y * 12 + (w0.m - 1)) + i * r.interval;
          if (!r.bymonth.length || r.bymonth.indexOf(idx % 12 + 1) >= 0) slots.push([Math.floor(idx / 12), idx % 12]);
        }
        for (let q = 0; q < slots.length; q += 1) {
          const y = slots[q][0];
          const mo = slots[q][1];
          const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
          const firstDow = new Date(Date.UTC(y, mo, 1)).getUTCDay();
          const picked = new Set();
          if (r.bydayOrd.length) {
            r.bydayOrd.forEach((b) => {
              const all = [];
              for (let d = 1 + ((b.w - firstDow + 7) % 7); d <= last; d += 7) all.push(d);
              if (b.ord > 0 && all[b.ord - 1]) picked.add(all[b.ord - 1]);
              else if (b.ord < 0 && all[all.length + b.ord]) picked.add(all[all.length + b.ord]);
              else if (b.ord === 0) all.forEach((d) => picked.add(d));
            });
          } else if (r.bymonthday.length) {
            r.bymonthday.forEach((n) => {
              const d = n > 0 ? n : last + 1 + n;
              if (d >= 1 && d <= last) picked.add(d);
            });
          } else if (w0.d <= last) picked.add(w0.d);
          const days = Array.from(picked).sort((x, z) => x - z);
          for (let k = 0; k < days.length; k += 1) {
            const ms = Date.UTC(y, mo, days[k]);
            if (ms < base) continue;
            if (emit(ms) === false) return;
          }
        }
      }
    } else {
      emit(base);
    }
  }

  function localKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function localTime(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  // 某一场原来的开始时间（RECURRENCE-ID 用的那个），写成和 key 一样的样子
  function ridKeyOf(rid) {
    const d = toDate(rid);
    return localKey(d).replace(/-/g, '') + (rid.allDay ? '' : localTime(d).replace(':', ''));
  }

  // rid：重复日程里这一场原来的开始时间（单独改过时间的那一场也是原来的），不重复的为 null
  function instance(src, startDt, dur, rid) {
    const start = toDate(startDt);
    const allDay = startDt.allDay;
    const end = new Date(start.getTime() + dur * 60000);
    const key = localKey(start).replace(/-/g, '') + (allDay ? '' : localTime(start).replace(':', ''));
    return {
      rid: rid || null,
      ridKey: rid ? ridKeyOf(rid) : key,
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
      key: key,
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

  // 规则最多排几场：没写 COUNT 是不限；写了就按写的算，COUNT=0 是一场都没有（不能写成 0 || Infinity）
  const maxOf = (r) => (r.counted || r.count ? Math.max(0, r.count || 0) : Infinity);
  const untilMs = (r) => (r.until ? toDate(r.until).getTime() + (r.until.allDay ? DAY - 1 : 0) : Infinity);

  // 把一个日历条目（可能带重复规则和单次改动）展开成 [from, to] 之间的具体场次。
  function expand(events, from, to) {
    const all = [];
    const fromMs = from.getTime();
    const toMs = to.getTime();
    const out = { push: (one) => pieces(one, one.dur).forEach((p) => { if (p.ms <= toMs && p.ms + DAY > fromMs) all.push(p); }) };
    const overrides = events.filter((e) => e.rid);
    const recurring = new Set(events.filter((e) => !e.rid && e.rrule).map((e) => e.uid));
    const used = new Set();
    // 单次改动：改过时间、地点的那一场，按它自己的时间算
    const showOverride = (o) => {
      used.add(o);
      if (o.status === 'CANCELLED') return;
      const d = durationMin(o);
      const changed = instance(o, o.start, d, o.rid);
      if (changed.ms + d * 60000 >= fromMs && changed.ms <= toMs) out.push(changed);
    };
    events.filter((e) => !e.rid).forEach((m) => {
      if (m.status === 'CANCELLED') return;
      const dur = durationMin(m);
      if (!m.rrule) {
        const one = instance(m, m.start, dur);
        if (one.ms + dur * 60000 >= fromMs && one.ms <= toMs) out.push(one);
        return;
      }
      const mine = overrides.filter((o) => o.uid === m.uid);
      const ov = new Map();
      mine.forEach((o) => ov.set(toDate(o.rid).getTime(), o));
      const ex = new Set(m.exdates.map((d) => toDate(d).getTime()));
      const until = untilMs(m.rrule);
      const max = maxOf(m.rrule);
      let count = 0;
      iterate(m, (wall) => {
        const dt = { allDay: m.start.allDay, utc: m.start.utc, tz: m.start.tz, offset: m.start.offset, wall: wall };
        const ms = toDate(dt).getTime();
        if (ms > until || count >= max || ms > toMs) return false;
        count += 1;
        if (ex.has(ms)) return true;
        if (ov.has(ms)) { showOverride(ov.get(ms)); return true; }
        if (ms + dur * 60000 >= fromMs) out.push(instance(m, dt, dur, dt));
        return true;
      });
      // 规则里已经排不出来的那一场（超出次数、日期对不上）：服务器上改过的，照样显示
      mine.forEach((o) => { if (!used.has(o) && toDate(o.rid).getTime() <= toMs) showOverride(o); });
    });
    // 只收到了某一次的改动，没有它所属的重复日程（被邀请参加其中一场）
    overrides.forEach((o) => { if (!used.has(o) && !recurring.has(o.uid)) showOverride(o); });
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

  const ymdOf = (x) => x.getFullYear() + pad(x.getMonth() + 1) + pad(x.getDate());
  const wallOf = (x) => ymdOf(x) + 'T' + pad(x.getHours()) + pad(x.getMinutes()) + pad(x.getSeconds());
  const tzParam = (tz) => ';TZID=' + (/[;:,]/.test(tz) ? '"' + tz + '"' : tz);

  // fields: { title, date, start, end, place, notes, allDay }；tz 给了就按“这个时区的本地时间”写（本机就在这个时区），否则写 UTC
  function timeLines(f, tz) {
    if (f.allDay) {
      const s = fromLocal(f.date, '00:00');
      const e = new Date(s.getTime());
      e.setDate(e.getDate() + 1);
      return ['DTSTART;VALUE=DATE:' + ymdOf(s), 'DTEND;VALUE=DATE:' + ymdOf(e)];
    }
    const s = fromLocal(f.date, f.start || '09:00');
    let e = fromLocal(f.date, f.end || '');
    if (!f.end || !e || e <= s) e = new Date(s.getTime() + 3600000);
    if (tz) return ['DTSTART' + tzParam(tz) + ':' + wallOf(s), 'DTEND' + tzParam(tz) + ':' + wallOf(e)];
    return ['DTSTART:' + fmtUTC(s), 'DTEND:' + fmtUTC(e)];
  }

  // keepTime：只换文字，不写开始结束时间（改重复日程“全部”时用）
  function bodyLines(f, opt) {
    const o = opt || {};
    const lines = ['DTSTAMP:' + fmtUTC(new Date())].concat(o.keepTime ? [] : timeLines(f, o.tz));
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
    return joinLines(lines);
  }

  // ---------- 按块改：一份日历文本里每个 VEVENT 的位置 ----------

  const linesOf = (text) => unfold(text).split('\n').filter((l) => l.length > 0);
  const joinLines = (lines) => lines.map(fold).join('\r\n') + '\r\n';

  // [{ begin, end, rid, uid }]：begin / end 是 BEGIN:VEVENT / END:VEVENT 的行号；rid 是 RECURRENCE-ID（没有为 null）
  function blocks(lines) {
    const zones = readZones(lines);
    const out = [];
    let cur = null;
    let depth = 0;
    lines.forEach((raw, i) => {
      const line = raw.trim();
      const up = line.toUpperCase();
      if (up === 'BEGIN:VEVENT') { cur = { begin: i, end: -1, rid: null, uid: '', start: null }; depth = 0; return; }
      if (!cur) return;
      if (up === 'END:VEVENT' && depth === 0) { cur.end = i; out.push(cur); cur = null; return; }
      if (up.indexOf('BEGIN:') === 0) { depth += 1; return; }
      if (up.indexOf('END:') === 0) { depth -= 1; return; }
      if (depth !== 0) return;
      const p = parseLine(line);
      if (!p) return;
      if (p.name === 'UID') cur.uid = p.value.trim();
      if (p.name === 'RECURRENCE-ID' || p.name === 'DTSTART') {
        const dt = parseDT(p);
        const z = dt && dt.tz && !tzKnown(dt.tz) ? zones[dt.tz] : null;
        if (z && !z.dst && z.std !== null) dt.offset = z.std;
        if (p.name === 'DTSTART') cur.start = dt; else cur.rid = dt;
      }
    });
    return out;
  }
  const masterOf = (bs) => bs.find((b) => !b.rid) || bs[0] || null;
  const sameMs = (a, b) => !!a && !!b && toDate(a).getTime() === toDate(b).getTime();

  // 一个日期时间按它自己的样子写出来（全天 / UTC / 带时区 / 浮动）
  function propDT(name, dt) {
    const w = dt.wall;
    const ymd = w.y + pad(w.m) + pad(w.d);
    if (dt.allDay) return name + ';VALUE=DATE:' + ymd;
    const t = 'T' + pad(w.h) + pad(w.mi) + pad(w.s);
    if (dt.utc) return name + ':' + ymd + t + 'Z';
    if (dt.tz) return name + tzParam(dt.tz) + ':' + ymd + t;
    return name + ':' + ymd + t;
  }

  // 改某一块里的标题、时间、地点、备注，其余原样保留；返回新的整份行
  // f.remind 不传就不碰原来的提醒（Apple 日历常有两条提醒，不能随手合成一条）；传了就整体替换。
  function patchBlock(lines, blk, f, opt) {
    const o = opt || {};
    const begin = blk.begin;
    const end = blk.end;
    const drop = o.keepTime ? /^(SUMMARY|LOCATION|DESCRIPTION|DTSTAMP|LAST-MODIFIED|SEQUENCE)([;:]|$)/i : /^(SUMMARY|LOCATION|DESCRIPTION|DTSTART|DTEND|DURATION|DTSTAMP|LAST-MODIFIED|SEQUENCE)([;:]|$)/i;
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
    const fresh = bodyLines(f, o).concat(['SEQUENCE:' + (seq + 1), 'LAST-MODIFIED:' + fmtUTC(new Date())]);
    return lines.slice(0, begin + 1).concat(fresh, kept, swapAlarm ? alarmLines(f.remind) : [], lines.slice(end));
  }

  // 改主事件（有单独改动的重复日程里，是没有 RECURRENCE-ID 的那一块）
  function patch(text, f) {
    const lines = linesOf(text);
    const m = masterOf(blocks(lines));
    if (!m) return text;
    return joinLines(patchBlock(lines, m, f));
  }

  // 一块里的 VALARM 原文
  function alarmsOf(lines, blk) {
    const out = [];
    let inAlarm = false;
    for (let i = blk.begin + 1; i < blk.end; i += 1) {
      const up = lines[i].trim().toUpperCase();
      if (up === 'BEGIN:VALARM') inAlarm = true;
      if (inAlarm) out.push(lines[i]);
      if (up === 'END:VALARM') inAlarm = false;
    }
    return out;
  }

  // ---------- 重复日程：改一场、删一场、截断、改全部 ----------

  // 仅此次：rid 是这一场原来的开始时间。已经有这一场的单独改动就改它，没有就新加一块（照抄主事件的提醒）
  function setOccurrence(text, rid, f) {
    const lines = linesOf(text);
    const bs = blocks(lines);
    const m = masterOf(bs);
    if (!m) return text;
    const own = bs.find((b) => b.rid && sameMs(b.rid, rid));
    if (own) return joinLines(patchBlock(lines, own, f));
    const alarms = f.remind !== undefined ? alarmLines(f.remind) : alarmsOf(lines, m);
    const block = ['BEGIN:VEVENT', 'UID:' + m.uid, propDT('RECURRENCE-ID', rid)].concat(bodyLines(f), ['SEQUENCE:0'], alarms, ['END:VEVENT']);
    const last = bs[bs.length - 1].end;
    return joinLines(lines.slice(0, last + 1).concat(block, lines.slice(last + 1)));
  }

  // 删仅此次：主事件加一条 EXDATE（写法和这一场原来的开始时间一样），这一场的单独改动一并删掉
  function exclude(text, rid) {
    const lines = linesOf(text);
    const bs = blocks(lines);
    const m = masterOf(bs);
    if (!m) return text;
    const gone = bs.filter((b) => b.rid && sameMs(b.rid, rid));
    const out = [];
    lines.forEach((l, i) => {
      if (gone.some((b) => i >= b.begin && i <= b.end)) return;
      if (i === m.end) out.push(propDT('EXDATE', rid));
      out.push(l);
    });
    return joinLines(out);
  }

  // 恢复被删掉的某一场：把主事件里对应的 EXDATE 拿掉（一行里写了好几个的只拿掉这一个）
  function include(text, rid) {
    const lines = linesOf(text);
    const bs = blocks(lines);
    const m = masterOf(bs);
    if (!m) return text;
    const zones = readZones(lines);
    const ms = toDate(rid).getTime();
    const out = [];
    lines.forEach((l, i) => {
      if (!(i > m.begin && i < m.end) || !/^EXDATE([;:]|$)/i.test(l.trim())) { out.push(l); return; }
      const p = parseLine(l.trim());
      if (!p) { out.push(l); return; }
      const kept = p.value.split(',').filter((v) => {
        const d = parseDT({ value: v, params: p.params });
        if (!d) return true;
        const z = d.tz && !tzKnown(d.tz) ? zones[d.tz] : null;
        if (z && !z.dst && z.std !== null) d.offset = z.std;
        return toDate(d).getTime() !== ms;
      });
      if (kept.length) out.push(l.trim().slice(0, l.trim().length - p.value.length) + kept.join(','));
    });
    return joinLines(out);
  }

  // rid 这一场之前，规则排出了几场：all 连被删掉的也算（改 COUNT 用），live 只算还在的（没被 EXDATE 排除、没被取消）。
  // 不能拿 DTSTART 和这一场比：开始那天不在规则里时（周三建的“每周一”），DTSTART 比第一场早，却一场都不算。
  function countBefore(text, rid) {
    const evs = parse(text);
    const m = evs.find((e) => !e.rid && e.rrule);
    if (!m) return { all: 0, live: 0 };
    const ms = toDate(rid).getTime();
    const ex = new Set(m.exdates.map((d) => toDate(d).getTime()));
    evs.forEach((e) => { if (e.rid && e.uid === m.uid && e.status === 'CANCELLED') ex.add(toDate(e.rid).getTime()); });
    const until = untilMs(m.rrule);
    const max = maxOf(m.rrule);
    let all = 0;
    let live = 0;
    iterate(m, (wall) => {
      const t = toDate({ allDay: m.start.allDay, utc: m.start.utc, tz: m.start.tz, offset: m.start.offset, wall: wall }).getTime();
      if (t >= ms || t > until || all >= max) return false;
      all += 1;
      if (!ex.has(t)) live += 1;
      return true;
    });
    return { all: all, live: live };
  }

  // 删此次及以后：规则到这一场之前为止（有次数的改次数，被删掉的场次也算数），这之后的单独改动删掉。
  // 这一场之前一场都排不出来时返回 null：调用方删掉整条，不能写出 COUNT=0 / 早于第一场的 UNTIL。
  function endBefore(text, rid) {
    const lines = linesOf(text);
    const bs = blocks(lines);
    const m = masterOf(bs);
    if (!m) return text;
    const ms = toDate(rid).getTime();
    const ev = parse(text).find((e) => !e.rid && e.rrule);
    if (!ev) return text;
    const n = countBefore(text, rid).all;
    if (n < 1) return null;
    let end;
    if (ev.rrule.count) {
      end = 'COUNT=' + n;
    } else if (ev.start.allDay) {
      end = 'UNTIL=' + ymdOf(new Date(ms - DAY));
    } else {
      end = 'UNTIL=' + fmtUTC(new Date(ms - 1000));
    }
    const out = [];
    lines.forEach((l, i) => {
      if (bs.some((b) => b.rid && toDate(b.rid).getTime() >= ms && i >= b.begin && i <= b.end)) return;
      if (i > m.begin && i < m.end && /^RRULE:/i.test(l.trim())) {
        const kept = l.trim().slice(6).split(';').filter((kv) => kv && !/^(UNTIL|COUNT)=/i.test(kv));
        out.push('RRULE:' + kept.concat([end]).join(';'));
        return;
      }
      out.push(l);
    });
    return joinLines(out);
  }

  // ---------- 重复日程：整组改时间（“全部”）/ 从某一场起另开一组（“此次及以后”） ----------

  const dayNoOf = (w) => Date.UTC(w.y, w.m - 1, w.d) / DAY;
  const localWall = (d) => ({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: 0 });
  // 某一时刻在这个系列自己的写法里是几点（UTC / 带时区 / 文件自带的时区定义 / 浮动）
  function wallIn(form, ms) {
    let off;
    if (form.utc) off = 0;
    else if (form.offset !== undefined) off = form.offset;
    else if (form.tz && tzKnown(form.tz)) off = tzOffsetMin(form.tz, ms);
    else off = -new Date(ms).getTimezoneOffset();
    const d = new Date(ms + off * 60000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
  // 墙上时间挪 n 天；hm 给了就把时刻换掉
  function moveWall(w, n, hm) {
    const d = new Date(Date.UTC(w.y, w.m - 1, w.d + n));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: hm ? hm[0] : w.h, mi: hm ? hm[1] : w.mi, s: hm ? 0 : w.s };
  }
  const wallPlusMin = (w, mins) => {
    const d = new Date(Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi + mins, w.s));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  };

  // 规则跟着整组挪 dDays 天：每周几跟着转；按“第几个周几 / 每月几号 / 指定月份”排的规则挪了天就不是原来的意思了，做不了（返回 null）。
  // until：把原来的结束时间换成新的写法；count：新的次数（不改传 0）。
  function moveRule(text, dDays, until, count) {
    const NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const out = [];
    let bad = false;
    text.split(';').filter(Boolean).forEach((kv) => {
      const eq = kv.indexOf('=');
      const name = kv.slice(0, eq).toUpperCase();
      const val = kv.slice(eq + 1);
      if (name === 'UNTIL') { const u = until ? until(parseDT({ value: val, params: {} })) : val; if (u) out.push('UNTIL=' + u); return; }
      if (name === 'COUNT') { out.push('COUNT=' + (count > 0 ? count : val)); return; }
      if (!dDays) { out.push(kv); return; }
      if (name === 'BYDAY') {
        const days = val.split(',').map((x) => /^([+-]?\d+)?([A-Za-z]{2})$/.exec(x.trim()));
        if (days.some((d) => !d || d[1] || NAMES.indexOf(d[2].toUpperCase()) < 0)) { bad = true; return; }
        out.push('BYDAY=' + days.map((d) => NAMES[(((NAMES.indexOf(d[2].toUpperCase()) + dDays) % 7) + 7) % 7]).join(','));
        return;
      }
      if (/^BY(MONTHDAY|MONTH|SETPOS|YEARDAY|WEEKNO)$/.test(name)) { bad = true; return; }
      out.push(kv);
    });
    return bad ? null : out.join(';');
  }

  // 核心：以 rid 这一场为准，把整组的时间改成 f（{ date, start, end, allDay }）。
  // opt.from：这一场现在显示的样子（{ date, start, end, allDay }），没变的那几样不动；
  // opt.tail：只留 rid 及以后的（“此次及以后”拆出来的新系列），opt.uid 是它的新 UID；
  // opt.tz：{ id, offsetMin }，全天改成有时间时按本机时区写。做不了返回 null。
  function retime(text, rid, f, opt) {
    const o = opt || {};
    let lines = linesOf(text);
    const bs = blocks(lines);
    const m = masterOf(bs);
    const evs = parse(text);
    const ev = evs.find((e) => !e.rid && e.rrule);
    if (!m || m.rid || !ev || !rid) return null;
    const from = o.from || {};
    const ridMs = toDate(rid).getTime();
    const wasAll = !!ev.start.allDay;
    const nowAll = !!f.allDay;
    const tgt = fromLocal(f.date, nowAll ? '00:00' : (f.start || '09:00'));
    const was = fromLocal(from.date || f.date, '00:00');
    if (!tgt || !was) return null;
    const dDays = Math.round(dayNoOf(localWall(tgt)) - dayNoOf(localWall(was)));
    const retimed = wasAll !== nowAll || (!nowAll && (f.start || '') !== (from.start || ''));
    const resized = retimed || (!nowAll && (f.end || '') !== (from.end || ''));
    const oldDur = durationMin(ev);
    let dur = oldDur;
    if (nowAll && !wasAll) dur = 1440;
    else if (!nowAll && resized) {
      const e = fromLocal(f.date, f.end || '');
      dur = f.end && e && e > tgt ? Math.round((e - tgt) / 60000) : 60;
    }
    let form;
    let conv;
    let hm = null;
    if (wasAll && nowAll) {
      form = { allDay: true, utc: false, tz: '' };
      conv = (x) => Object.assign({}, form, { wall: moveWall(Object.assign(localWall(toDate(x)), { h: 0, mi: 0 }), dDays) });
    } else if (!wasAll && nowAll) {
      form = { allDay: true, utc: false, tz: '' };
      conv = (x) => Object.assign({}, form, { wall: moveWall(Object.assign(localWall(toDate(x)), { h: 0, mi: 0 }), dDays) });
    } else if (wasAll) {
      if (!o.tz || !o.tz.id) return null;
      form = { allDay: false, utc: false, tz: o.tz.id };
      hm = [tgt.getHours(), tgt.getMinutes()];
      conv = (x) => Object.assign({}, form, { wall: moveWall(localWall(toDate(x)), dDays, hm) });
    } else {
      form = { allDay: false, utc: !!ev.start.utc, tz: ev.start.tz || '' };
      if (ev.start.offset !== undefined) form.offset = ev.start.offset;
      if (retimed) { const w = wallIn(form, tgt.getTime()); hm = [w.h, w.mi]; }
      conv = (x) => Object.assign({}, form, { wall: moveWall(wallIn(form, toDate(x).getTime()), dDays, hm) });
    }
    // 结束时间跟着挪：有时间的系列挪同样多的毫秒，全天的挪天数
    const w0 = ev.start.wall;
    const dMs = dDays * DAY + (hm && !wasAll ? ((hm[0] * 60 + hm[1]) - (w0.h * 60 + w0.mi)) * 60000 : 0);
    const until = (u) => {
      if (!u) return '';
      if (form.allDay) return ymdOf(new Date(toDate(u).getTime() + dDays * DAY));
      if (wasAll || u.allDay) {
        const d = new Date(toDate(u).getTime() + dDays * DAY);
        return u.allDay && !wasAll ? ymdOf(d) : fmtUTC(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59));
      }
      return fmtUTC(new Date(toDate(u).getTime() + dMs));
    };
    const before = o.tail ? countBefore(text, rid).all : 0;
    const rule = moveRule(ev.rruleText || '', dDays, until, o.tail && ev.rrule.count ? Math.max(1, ev.rrule.count - before) : 0);
    if (rule === null) return null;
    const stamp = (name, dt) => propDT(name, dt);
    const span = (start, mins) => (form.allDay
      ? [stamp('DTSTART', start), stamp('DTEND', Object.assign({}, start, { wall: moveWall(start.wall, Math.max(1, Math.round(mins / 1440))) }))]
      : [stamp('DTSTART', start), stamp('DTEND', Object.assign({}, start, { wall: wallPlusMin(start.wall, mins) }))]);
    const mStart = o.tail ? conv(rid) : conv(ev.start);
    const TIME = /^(DTSTART|DTEND|DURATION)([;:]|$)/i;
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const b = bs.find((x) => x.begin === i);
      if (!b) { out.push(lines[i]); i += 1; continue; }
      i = b.end + 1;
      const own = b.rid ? evs.find((e) => e.rid && sameMs(e.rid, b.rid)) : null;
      if (b !== m && (!b.rid || !own)) { lines.slice(b.begin, b.end + 1).forEach((l) => out.push(l)); continue; }
      if (b !== m && o.tail && toDate(b.rid).getTime() < ridMs) continue;
      // 这一场没单独改过时间（或者就是正在改的这一场）：时间跟着整组走；单独挪过的留着它自己的
      const follows = b !== m && (sameMs(b.rid, rid) ? (retimed || wasAll !== nowAll) : (toDate(own.start).getTime() === toDate(own.rid).getTime() && durationMin(own) === oldDur));
      const kept = [];
      let depth = 0;
      let seq = 0;
      for (let k = b.begin + 1; k < b.end; k += 1) {
        const l = lines[k];
        const up = l.trim().toUpperCase();
        if (up.indexOf('BEGIN:') === 0) depth += 1;
        if (depth === 0) {
          if (/^UID([;:]|$)/i.test(l) && o.tail) continue;
          if (/^RECURRENCE-ID([;:]|$)/i.test(l)) continue;
          if (b === m && /^(RRULE|EXDATE|DTSTAMP|LAST-MODIFIED|SEQUENCE)([;:]|$)/i.test(l)) { const q = /^SEQUENCE:(\d+)/i.exec(l); if (q) seq = Number(q[1]); continue; }
          if ((b === m || follows) && TIME.test(l)) continue;
        }
        kept.push(l);
        if (up.indexOf('END:') === 0) depth -= 1;
      }
      const head = ['BEGIN:VEVENT'];
      if (o.tail) head.push('UID:' + o.uid);
      if (b === m) {
        span(mStart, dur).forEach((l) => head.push(l));
        head.push('RRULE:' + rule);
        ev.exdates.forEach((d) => { if (!o.tail || toDate(d).getTime() >= ridMs) head.push(stamp('EXDATE', conv(d))); });
        head.push('DTSTAMP:' + fmtUTC(new Date()), 'SEQUENCE:' + (seq + 1), 'LAST-MODIFIED:' + fmtUTC(new Date()));
      } else {
        head.push(stamp('RECURRENCE-ID', conv(b.rid)));
        if (follows) span(conv(b.rid), dur).forEach((l) => head.push(l));
      }
      head.concat(kept, ['END:VEVENT']).forEach((l) => out.push(l));
    }
    lines = out;
    // 全天改成有时间：按本机时区写，文件里没有这个时区的定义就补一段（没有夏令时的才会走到这里）
    if (wasAll && !nowAll && !readZones(lines)[o.tz.id]) {
      const off = o.tz.offsetMin || 0;
      const hhmm = (off < 0 ? '-' : '+') + pad(Math.floor(Math.abs(off) / 60)) + pad(Math.abs(off) % 60);
      const at = lines.findIndex((l) => l.trim().toUpperCase() === 'BEGIN:VEVENT');
      lines = lines.slice(0, at).concat(['BEGIN:VTIMEZONE', 'TZID:' + o.tz.id, 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:' + hhmm, 'TZOFFSETTO:' + hhmm, 'END:STANDARD', 'END:VTIMEZONE'], lines.slice(at));
    }
    return joinLines(lines);
  }

  // 改“全部”的时间 / 日期 / 全天：整组一起挪，被删掉的那几场、单独改过的那几场都跟着对上。做不了返回 null。
  function shiftSeries(text, rid, f, opt) {
    return retime(text, rid, f, Object.assign({}, opt, { tail: false }));
  }

  // 改“此次及以后”：原系列到这一场之前为止（head），从这一场起另开一个新系列（tail，UID 是 opt.uid）。
  // f 里的标题、地点、备注（可选提醒）写进新系列。这一场之前一场都没有时返回 { whole: true }，调用方按“全部”改。做不了返回 null。
  function splitSeries(text, rid, f, opt) {
    const o = opt || {};
    const ev = parse(text).find((e) => !e.rid && e.rrule);
    if (!ev) return null;
    if (countBefore(text, rid).live < 1) return { whole: true, head: null, tail: null };
    const head = endBefore(text, rid);
    let tail = retime(text, rid, f, Object.assign({}, o, { tail: true }));
    if (!head || !tail) return null;
    const old = { title: ev.title, place: ev.place, notes: ev.notes };
    const tf = { title: f.title === undefined ? old.title : f.title, place: f.place === undefined ? old.place : f.place, notes: f.notes === undefined ? old.notes : f.notes };
    if (f.remind !== undefined) tf.remind = f.remind;
    if (tf.title !== old.title || tf.place !== old.place || tf.notes !== old.notes || f.remind !== undefined) tail = patchSeries(tail, tf, old);
    return { whole: false, head: head, tail: tail };
  }

  // 改全部（只改文字：标题、地点、备注，可选提醒；不碰时间、规则、例外）。
  // 单独改过的场次里，和原来的主事件一样的那几项跟着改，它自己改过的不动。old 是改之前主事件的这几项。
  function patchSeries(text, f, old) {
    const KEYS = [['title', 'SUMMARY'], ['place', 'LOCATION'], ['notes', 'DESCRIPTION']];
    let lines = linesOf(text);
    const evs = parse(text);
    const bs = blocks(lines);
    const m = masterOf(bs);
    if (!m) return text;
    // 从后往前改，前面块的行号不受影响
    const order = bs.slice().sort((a, b) => b.begin - a.begin);
    order.forEach((b) => {
      if (b === m) {
        lines = patchBlock(lines, b, { title: f.title, place: f.place, notes: f.notes, remind: f.remind }, { keepTime: true });
        return;
      }
      const e = evs.find((x) => x.rid && sameMs(x.rid, b.rid));
      if (!e) return;
      const cur = { title: e.title, place: e.place, notes: e.notes };
      let touched = false;
      KEYS.forEach((k) => {
        const was = (old && old[k[0]]) || '';
        const now = f[k[0]] || '';
        if (now !== was && (cur[k[0]] || '') === was) { cur[k[0]] = now; touched = true; }
      });
      if (touched) lines = patchBlock(lines, b, cur, { keepTime: true });
    });
    return joinLines(lines);
  }

  // 本机的重复日程整份写出来：主事件带 RRULE / EXDATE，单独改过的场次各一块（RECURRENCE-ID）。
  // s：{ title, place, notes, remind, allDay, date, start, end, rrule, exdates: [日期], overrides: [{ occ: 日期, f }], tz: { id, offsetMin } }
  function buildSeries(uid, s) {
    const tz = s.tz && s.tz.id ? s.tz : null;
    const at = (k) => {
      const d = fromLocal(k, s.allDay ? '00:00' : (s.start || '09:00'));
      return s.allDay ? ';VALUE=DATE:' + ymdOf(d) : (tz ? tzParam(tz.id) : '') + ':' + (tz ? wallOf(d) : fmtUTC(d));
    };
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jinjian//CN', 'CALSCALE:GREGORIAN'];
    if (tz) {
      const off = tz.offsetMin;
      const hhmm = (off < 0 ? '-' : '+') + pad(Math.floor(Math.abs(off) / 60)) + pad(Math.abs(off) % 60);
      lines.push('BEGIN:VTIMEZONE', 'TZID:' + tz.id, 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:' + hhmm, 'TZOFFSETTO:' + hhmm, 'END:STANDARD', 'END:VTIMEZONE');
    }
    lines.push('BEGIN:VEVENT', 'UID:' + uid);
    bodyLines(s, { tz: tz && tz.id }).forEach((l) => lines.push(l));
    lines.push('RRULE:' + s.rrule);
    (s.exdates || []).forEach((k) => lines.push('EXDATE' + at(k)));
    alarmLines(s.remind).forEach((l) => lines.push(l));
    lines.push('END:VEVENT');
    (s.overrides || []).forEach((o) => {
      lines.push('BEGIN:VEVENT', 'UID:' + uid, 'RECURRENCE-ID' + at(o.occ));
      bodyLines(o.f, { tz: tz && tz.id }).forEach((l) => lines.push(l));
      alarmLines(o.f.remind).forEach((l) => lines.push(l));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return joinLines(lines);
  }

  const api = {
    parse: parse, expand: expand, build: build, patch: patch, toDate: toDate, unfold: unfold, parseRRule: parseRRule,
    buildSeries: buildSeries, setOccurrence: setOccurrence, exclude: exclude, include: include, endBefore: endBefore, patchSeries: patchSeries,
    countBefore: countBefore, shiftSeries: shiftSeries, splitSeries: splitSeries,
    escText: escText, unesc: unesc, parseLine: parseLine, fold: fold, durationMin: durationMin,
  };
  global.ICS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
