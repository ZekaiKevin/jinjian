// 今笺：从“明天下午2点到4点 开会”这样的一句话里拆出日期、时间段和标题。
// 只认写出来的日期；只写了时间没写日期时 date 为空，由调用方决定落在哪天。
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

  // 换算成分钟；“晚上12点”记成 23:59，“上午12点”是 0 点
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
      if (h === 12) return 23 * 60 + 59;
      if ((p === '夜里' || p === '夜间') && h < 6) { /* 夜里两点就是凌晨两点 */ } else if (h < 12) h += 12;
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

  function parseQuick(raw, base) {
    const now = base ? new Date(base.getTime()) : new Date();
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let s = ' ' + String(raw || '').trim() + ' ';
    let date = null;
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

    // 相对时间：“30分钟后”“半小时后”“1.5小时后”“一个半小时后”“3天后”
    let m = /(\d+|[一二两三四五六七八九十])\s*个半\s*(小时|钟头)\s*(?:以后|之后|后)/.exec(s);
    let n = NaN;
    let unit = '';
    if (m) { n = numWord(m[1]) + 0.5; unit = '小时'; } else {
      m = /(\d+(?:\.\d+)?|半|[一二两三四五六七八九十]{1,3})\s*个?\s*(分钟|小时|钟头|天)\s*(?:以后|之后|后)/.exec(s);
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

    if (!date) {
      m = /(大后天|后天|明天|今天|今晚|明晚|今早|明早)/.exec(s);
      if (m) {
        const add = { '今天': 0, '今晚': 0, '今早': 0, '明天': 1, '明晚': 1, '明早': 1, '后天': 2, '大后天': 3 }[m[1]];
        date = new Date(day0.getTime());
        date.setDate(date.getDate() + add);
        evening = m[1] === '今晚' || m[1] === '明晚';
        cut(m, true);
      }
    }
    if (!date) {
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
    if (!date) {
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
    if (!date && !badDate) {
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

    if (!time) {
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

    const title = s.replace(/\s{2,}/g, ' ').replace(/^[\s，,、。:：]+|[\s，,、。:：]+$/g, '');
    return {
      title: title,
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
