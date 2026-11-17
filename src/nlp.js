// 今笺：从“明天下午2点到4点 开会”这样的一句话里拆出日期、时间段和标题。
// 只认写出来的日期；只写了时间没写日期时 date 为空，由调用方决定落在哪天。
// 0.9.0 起一句话里还能同时拆出重复（“每周二四”）和地点（“立德407”）：
//   parseQuick('每周二四 18:00-19:30 立德407 机器学习') → 每周二、四 / 最近的那一场 / 18:00–19:30 / 立德407 / 机器学习
// 第三个参数 off 用来关掉某一类识别（{ repeat, date, time, place } 里为 true 的不认，那一段留在标题里），
// 界面上点掉预览里的小胶囊就是这么做的。
(function (global) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const WEEK = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
  const PERIOD = '上午|早上|早晨|凌晨|中午|下午|傍晚|晚上|夜里|夜间';
  const PM = /^(下午|傍晚|晚上|夜里|夜间)$/;
  const AM = /^(上午|早上|早晨|凌晨)$/;
  // “5号电池”“3号楼”里的“号”不是日期
  const NOUN_AFTER = /^[楼线床房门口机球位柜车厅馆字码桌座院栋单元电池板店铺窗台游]/;
  const BOUNDARY_AFTER = /^(\s|$|[，,、。；;:：!！?？]|上午|早上|早晨|凌晨|中午|下午|傍晚|晚上|夜里|前|之前|以前|截止|\d)/;

  const CN = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };

  // 零到五十九的中文数字
  function cnNum(t) {
    if (!t) return NaN;
    if (t === '十') return 10;
    const i = t.indexOf('十');
    if (i < 0) {
      if (t.length === 1) return t in CN ? CN[t] : NaN;
      // “零五”“〇五”：十点零五分里的分钟
      if (t.length === 2 && (t[0] === '零' || t[0] === '〇') && t[1] in CN && CN[t[1]] > 0) return CN[t[1]];
      return NaN;
    }
    const tens = i === 0 ? 1 : CN[t[0]];
    const ones = i === t.length - 1 ? 0 : CN[t[i + 1]];
    return tens === undefined || ones === undefined ? NaN : tens * 10 + ones;
  }

  function numWord(t) {
    if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
    if (t === '半') return 0.5;
    return cnNum(t);
  }

  // “下午三点半” → “下午3点半”。没有时段词时，“一点”“两点”太容易是普通词（“有一点”），只在后面紧跟空白或连接词时才转。
  function normalizeCnTime(s) {
    const re = new RegExp('(' + PERIOD + ')?\\s*([零〇一二两三四五六七八九十]{1,3})\\s*(点|时)(?:\\s*(半|一刻|三刻|[零〇一二三四五六七八九十]{1,3})\\s*分?)?', 'g');
    return s.replace(re, (all, period, hour, unit, minute, offset, whole) => {
      const h = cnNum(hour);
      if (isNaN(h) || h > 24) return all;
      const after = whole.slice(offset + all.length);
      const risky = /^(一|二|两)$/.test(hour) && !period;
      if (risky && !/^(\s|$|到|至|-|~|～|—|–|[，,])/.test(after)) return all;
      let tail = '';
      if (minute === '半' || minute === '一刻' || minute === '三刻') tail = minute;
      else if (minute) {
        const m = cnNum(minute);
        if (isNaN(m) || m > 59) return all;
        tail = pad(m) + '分';
      }
      return (period || '') + h + '点' + tail;
    });
  }

  // 一个时间点：可带时段词，“3点”“3点半”“3点15”“15:30”
  const T = '(' + PERIOD + ')?\\s*(?<![\\d.])(\\d{1,2})\\s*(?:[:：](\\d{2})|[点时](?:\\s*(半|一刻|三刻|\\d{1,2})(?!\\s*[号日月])\\s*分?)?)';
  const RANGE = new RegExp(T + '\\s*(?:到|至|-|~|～|－|—|–)\\s*' + T);
  const SINGLE = new RegExp(T);

  // 换算成分钟；“晚上12点”记成 23:59，“上午12点”是 0 点，“下午12点”是正午；“晚上1点”到“晚上4点”是后半夜，不加 12
  function toMinutes(period, hRaw, colon, tail, evening, literal) {
    let h = Number(hRaw);
    let m = 0;
    if (colon !== undefined) m = Number(colon);
    else if (tail === '半') m = 30;
    else if (tail === '一刻') m = 15;
    else if (tail === '三刻') m = 45;
    else if (tail) m = Number(tail);
    if (h > 24 || m > 59) return null;
    const p = period || (evening ? '晚上' : '');
    if (AM.test(p) && h === 12) h = 0;
    else if (!literal && !p && h >= 1 && h <= 5 && colon === undefined) h += 12; // 没写时段的“3点开会”几乎都是下午
    else if (p === '中午' && h >= 1 && h <= 3) h += 12;
    else if (PM.test(p)) {
      const night = p === '晚上' || p === '夜里' || p === '夜间';
      if (h === 12) return night ? 23 * 60 + 59 : 12 * 60 + m; // 下午 / 傍晚 12 点就是 12 点
      if ((p === '夜里' || p === '夜间') && h < 6) { /* 夜里两点就是凌晨两点 */ } else if (p === '晚上' && h < 5) { /* 晚上一点也是后半夜 */ } else if (h < 12) h += 12;
    }
    if (h === 24) return 23 * 60 + 59;
    return h * 60 + m;
  }

  const hm = (mins) => pad(Math.floor(mins / 60)) + ':' + pad(mins % 60);

  // “25号前”“下午3点前”“周五之前”“月底截止”：时间后面跟着的截止词，要连同它一起拿掉
  const DEADLINE = /^\s*(?:之前|以前|前(?![台往进后面方年夜任天列程置景线锋途言奏者排辈期世身])|截止|截至)/;

  const validYMD = (y, mo, d) => {
    const t = new Date(y, mo - 1, d);
    return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d;
  };

  const WD = '一二三四五六日天';
  const CODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const WNAME = '日一二三四五六';
  // “每周二四”“每周一、三、五”“每周二和周四”：周几可以连写、可以用顿号 / 和隔开
  const EVERY_WEEK = new RegExp('每(?:个)?(?:周|星期|礼拜)(末|(?:[' + WD + '](?:(?:[、,，和及与]\\s*(?:周|星期|礼拜)?|(?:周|星期|礼拜))?[' + WD + '])*)?)');
  // 教室、会议室这类“名字 + 门牌号”：立德407、明商208、A301、教三-205
  const ROOM = /^[\u4e00-\u9fa5A-Za-z]{1,6}[-－]?\d{2,4}[A-Za-z室]?$/;

  function parseQuick(raw, base, off) {
    const now = base ? new Date(base.getTime()) : new Date();
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const no = off || {};
    let s = ' ' + String(raw || '').trim() + ' ';
    let date = null;
    let rrule = '';
    let repeatLabel = '';
    let place = '';
    let time = '';
    let endTime = '';
    let endNextDay = false;
    let isDeadline = false;
    let evening = false;
    let badDate = false; // 写了“2月30号”这种不存在的日期：不当日期处理，也不退回去只认“30号”
    // 拿掉匹配到的这一段；withDeadline 为真时，紧跟着的“前/之前/截止”一起拿掉并记下来
    const cut = (m, withDeadline) => {
      let len = m[0].length;
      if (withDeadline) {
        const d = DEADLINE.exec(s.slice(m.index + len));
        if (d) { len += d[0].length; isDeadline = true; }
      }
      s = s.slice(0, m.index) + ' ' + s.slice(m.index + len);
    };

    let m = null;
    // 重复：“每天”“每个工作日”“每周二四”“每周末”“每月15号”“每年5月20日”。没另写日期时，日期落在最近的那一场。
    let held = ''; // 关掉了“重复”的识别：那几个字原样留在标题里，也不让后面的“周二”把它拆开
    {
      const nearest = (days) => {
        const d = new Date(day0.getTime());
        d.setDate(d.getDate() + Math.min.apply(null, days.map((w) => (w - day0.getDay() + 7) % 7)));
        return d;
      };
      let auto = null;
      if ((m = /每(?:个)?工作日|工作日每天/.exec(s))) {
        rrule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
        repeatLabel = '工作日';
        auto = nearest([1, 2, 3, 4, 5]);
      } else if ((m = /每天|每日/.exec(s))) {
        rrule = 'FREQ=DAILY';
        repeatLabel = '每天';
        auto = new Date(day0.getTime());
      } else if ((m = EVERY_WEEK.exec(s))) {
        let list = m[1] || '';
        // “每周二四点开会”里的“四”是四点，不是周四
        if (list !== '末' && list.length > 1 && /^\s*[点时]/.test(s.slice(m.index + m[0].length))) {
          list = list.slice(0, -1);
          m = { 0: m[0].slice(0, -1), index: m.index };
        }
        const days = list === '末' ? [6, 0] : Array.from(new Set(list.split('').filter((c) => c in WEEK).map((c) => WEEK[c])));
        const order = days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
        rrule = 'FREQ=WEEKLY' + (order.length ? ';BYDAY=' + order.map((w) => CODE[w]).join(',') : '');
        repeatLabel = list === '末' ? '每周末' : '每周' + order.map((w) => WNAME.charAt(w)).join('、');
        if (order.length) auto = nearest(order);
      } else if ((m = /每(?:个)?月(?:(\d{1,2})[日号])?/.exec(s))) {
        const dd = m[1] ? Number(m[1]) : 0;
        if (!m[1] || (dd >= 1 && dd <= 31)) {
          rrule = 'FREQ=MONTHLY';
          repeatLabel = '每月' + (dd ? dd + '日' : '');
          for (let i = 0; dd && i < 13 && !auto; i += 1) {
            const y = day0.getFullYear() + Math.floor((day0.getMonth() + i) / 12);
            const mo = (day0.getMonth() + i) % 12 + 1;
            if (validYMD(y, mo, dd) && new Date(y, mo - 1, dd) >= day0) auto = new Date(y, mo - 1, dd);
          }
        } else m = null;
      } else if ((m = /每年(?:(\d{1,2})月(\d{1,2})[日号]?)?/.exec(s))) {
        const mo = m[1] ? Number(m[1]) : 0;
        const dd = m[2] ? Number(m[2]) : 0;
        rrule = 'FREQ=YEARLY';
        repeatLabel = '每年' + (mo ? mo + '月' + dd + '日' : '');
        for (let y = day0.getFullYear(); mo && y <= day0.getFullYear() + 4 && !auto; y += 1) {
          if (validYMD(y, mo, dd) && new Date(y, mo - 1, dd) >= day0) auto = new Date(y, mo - 1, dd);
        }
        if (mo && !auto) { rrule = ''; repeatLabel = ''; m = null; }
      }
      if (m && rrule && no.repeat) {
        held = m[0];
        s = s.slice(0, m.index) + '\uE000' + s.slice(m.index + m[0].length);
        rrule = '';
        repeatLabel = '';
      } else if (m && rrule) {
        cut(m, true);
        // 句子里另写了日期（“每周二四 11月17日”这种）以写的为准，这里先记着，后面没认出日期再用
        date = no.date ? null : auto;
      }
    }
    const autoDate = date;
    if (rrule) date = null;

    // 相对时间：“30分钟后”“半小时后”“1.5小时后”“一个半小时后”“3天后”
    m = no.date || no.time ? null : /(\d+|[一二两三四五六七八九十])\s*个半\s*(小时|钟头)\s*(?:以后|之后|后)/.exec(s);
    let n = NaN;
    let unit = '';
    if (m) { n = numWord(m[1]) + 0.5; unit = '小时'; } else if (!no.date) {
      m = /(\d+(?:\.\d+)?|半|[一二两三四五六七八九十]{1,3})\s*个?\s*(分钟|小时|钟头|天)\s*(?:以后|之后|后)/.exec(s);
      if (m && no.time && m[2] !== '天') m = null;
      if (m) { n = numWord(m[1]); unit = m[2]; }
    }
    if (m && !isNaN(n) && n > 0) {
      if (unit === '天') {
        date = new Date(day0.getTime());
        date.setDate(date.getDate() + Math.round(n));
      } else {
        const mins = unit === '分钟' ? n : n * 60;
        const at = new Date(now.getTime() + Math.round(mins) * 60000);
        date = new Date(at.getFullYear(), at.getMonth(), at.getDate());
        time = hm(at.getHours() * 60 + at.getMinutes());
      }
      cut(m, false);
    }

    if (!date && !no.date) {
      m = /(大后天|后天|明天|今天|今晚|明晚|今早|明早)/.exec(s);
      if (m) {
        const add = { '今天': 0, '今晚': 0, '今早': 0, '明天': 1, '明晚': 1, '明早': 1, '后天': 2, '大后天': 3 }[m[1]];
        date = new Date(day0.getTime());
        date.setDate(date.getDate() + add);
        evening = m[1] === '今晚' || m[1] === '明晚';
        cut(m, true);
      }
    }
    // 写全了年月日的：2026-11-20、2026/11/20、2026.11.20、2026年12月5号。要排在“12月5号”前面，不然“2026年”会剩在标题里
    if (!date && !no.date && !badDate) {
      m = /(?<![\d.\-/])(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?![\d\-/]|\.\d)/.exec(s) || /(?<!\d)(\d{4})年(\d{1,2})月(\d{1,2})[日号]?/.exec(s);
      if (m) {
        const y = Number(m[1]);
        const mo = Number(m[m.length - 2]);
        const dd = Number(m[m.length - 1]);
        if (validYMD(y, mo, dd)) { date = new Date(y, mo - 1, dd); cut(m, true); } else badDate = true;
      }
    }
    if (!date && !no.date) {
      m = /(这个|下个|本|这|下)?(?:周|星期|礼拜)([一二三四五六日天])/.exec(s);
      if (m) {
        const want = WEEK[m[2]];
        const dow = day0.getDay();
        date = new Date(day0.getTime());
        if (!m[1]) {
          date.setDate(date.getDate() + (want - dow + 7) % 7); // 最近的那个（含今天）
        } else {
          // 一周从周一算起
          const monday = date.getDate() - ((dow + 6) % 7) + (m[1].charAt(0) === '下' ? 7 : 0);
          date.setDate(monday + ((want + 6) % 7));
        }
        cut(m, true);
      }
    }
    // “周末”“这周末”“下周末”：那一周的周六（今天已经是周末就是今天）
    if (!date && !no.date) {
      m = /(这个|下个|本|这|下)?(?:周|星期|礼拜)末/.exec(s);
      if (m) {
        const dow = day0.getDay();
        date = new Date(day0.getTime());
        if (m[1] && m[1].charAt(0) === '下') date.setDate(date.getDate() - ((dow + 6) % 7) + 7 + 5);
        else if (dow !== 0 && dow !== 6) date.setDate(date.getDate() + (6 - dow));
        cut(m, true);
      }
    }
    if (!date && !no.date && !badDate) {
      m = /(\d{1,2})月(\d{1,2})[日号]?/.exec(s);
      if (m) {
        // 不存在的日期（13月40号、2月30号）不能让它悄悄滚到下个月；2月29号往后找最近的闰年
        const mo = Number(m[1]);
        const dd = Number(m[2]);
        for (let y = day0.getFullYear(); y <= day0.getFullYear() + 4 && !date; y += 1) {
          if (validYMD(y, mo, dd) && new Date(y, mo - 1, dd) >= day0) date = new Date(y, mo - 1, dd);
        }
        if (date) cut(m, true); else badDate = true;
      }
    }
    if (!date && !badDate && !no.date) {
      const re = /(?<![\d第])(\d{1,2})[日号]/g;
      while ((m = re.exec(s))) {
        const d = Number(m[1]);
        if (d < 1 || d > 31) continue;
        const after = s.slice(m.index + m[0].length).replace(/^ $/, '');
        const atStart = !s.slice(0, m.index).trim();
        if (BOUNDARY_AFTER.test(after) || (atStart && !NOUN_AFTER.test(after))) {
          // 今天之后最近的、真有这一天的那个月（31号不会落到只有 30 天的月）
          for (let i = 0; i < 13 && !date; i += 1) {
            const y = day0.getFullYear() + Math.floor((day0.getMonth() + i) / 12);
            const mo = (day0.getMonth() + i) % 12 + 1;
            if (validYMD(y, mo, d) && new Date(y, mo - 1, d) >= day0) date = new Date(y, mo - 1, d);
          }
          if (date) { cut(m, true); break; }
        }
      }
    }

    if (!date && autoDate) date = autoDate;

    if (!time && !no.time) {
      s = normalizeCnTime(s);
      m = RANGE.exec(s);
      if (m) {
        const a = toMinutes(m[1], m[2], m[3], m[4], evening);
        let b = toMinutes(m[5], m[6], m[7], m[8], evening && !m[5]);
        if (a !== null && b !== null) {
          let next = false;
          if (b <= a) {
            // 结束时间没写时段：优先往后找一个比开始晚的（“11点到1点”是 11 点到 13 点）；
            // 找不到再按字面理解成第二天凌晨（“晚上11点到1点”）
            const lit = m[5] ? null : toMinutes(null, m[6], m[7], m[8], false, true);
            const alt = lit === null ? [] : [lit, lit + 720].filter((x) => x > a && x <= 23 * 60 + 59);
            if (alt.length) b = alt[0];
            else if (b < a || (lit !== null && lit < a)) { next = true; if (lit !== null) b = lit; }
            else b = null; // 开始和结束一样，当没写结束
          }
          time = hm(a);
          if (b !== null) { endTime = hm(b); endNextDay = next; }
          cut(m, true);
        }
      } else {
        m = SINGLE.exec(s);
        if (m) {
          const a = toMinutes(m[1], m[2], m[3], m[4], evening);
          if (a !== null) {
            time = hm(a);
            cut(m, true);
          }
        }
      }
    }

    // 地点：“在 / @ + 一个词”，或者单独的一个“名字 + 门牌号”（立德407）。拿掉它以后标题不能空，空了就不算地点
    if (!no.place) {
      const words = s.trim().split(/\s+/).filter(Boolean);
      let at = -1;
      let name = '';
      words.forEach((w, i) => {
        if (at >= 0) return;
        const x = /^(?:在|@|＠)(.{2,12})$/.exec(w);
        if (x && !/^(线|家|此|这|那|于|职|场|乎|意|即|外面|里面)/.test(x[1])) { at = i; name = x[1]; } else if (ROOM.test(w)) { at = i; name = w; }
      });
      if (at >= 0 && words.length > 1) {
        place = name;
        words.splice(at, 1);
        s = ' ' + words.join(' ') + ' ';
      }
    }

    const title = s.replace('\uE000', held).replace(/\s{2,}/g, ' ').replace(/^[\s，,、。:：]+|[\s，,、。:：]+$/g, '');
    return {
      title: title,
      rrule: rrule,
      repeatLabel: repeatLabel,
      place: place,
      date: date ? iso(date) : '',
      time: time,
      endTime: endTime,
      endNextDay: endNextDay,
      isDeadline: isDeadline,
      hasDate: !!date,
      hasTime: !!time,
      hasWhen: !!date || !!time,
    };
  }

  global.parseQuick = parseQuick;
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseQuick: parseQuick };
})(typeof window !== 'undefined' ? window : globalThis);
