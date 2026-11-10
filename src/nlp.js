// 今笺：从“明天下午3点 交报告”这样的一句话里拆出日期、时间和标题。
(function (global) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const WEEK = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };

  function parseQuick(raw, base) {
    const now = base ? new Date(base.getTime()) : new Date();
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let s = String(raw || '').trim();
    let date = null;
    let time = '';
    let evening = false;

    let m = /(大后天|后天|明天|今天|今晚|明晚)/.exec(s);
    if (m) {
      const add = { '今天': 0, '今晚': 0, '明天': 1, '明晚': 1, '后天': 2, '大后天': 3 }[m[1]];
      date = new Date(day0.getTime());
      date.setDate(date.getDate() + add);
      evening = m[1] === '今晚' || m[1] === '明晚';
      s = s.replace(m[1], '');
    }
    if (!date) {
      m = /(下)?(?:周|星期|礼拜)([一二三四五六日天])/.exec(s);
      if (m) {
        const want = WEEK[m[2]];
        date = new Date(day0.getTime());
        let diff = (want - date.getDay() + 7) % 7;
        if (m[1]) {
          // “下周三”：下一个自然周里的周三（周一为一周的开始）
          const toMonday = (8 - date.getDay()) % 7 || 7;
          diff = toMonday + ((want + 6) % 7);
        }
        date.setDate(date.getDate() + diff);
        s = s.replace(m[0], '');
      }
    }
    if (!date) {
      m = /(\d{1,2})月(\d{1,2})[日号]?/.exec(s);
      if (m) {
        date = new Date(day0.getFullYear(), Number(m[1]) - 1, Number(m[2]));
        if (date < day0) date.setFullYear(date.getFullYear() + 1);
        s = s.replace(m[0], '');
      }
    }
    if (!date) {
      m = /(\d{1,2})[日号]/.exec(s);
      if (m) {
        date = new Date(day0.getFullYear(), day0.getMonth(), Number(m[1]));
        if (date < day0) date.setMonth(date.getMonth() + 1);
        s = s.replace(m[0], '');
      }
    }

    m = /(上午|早上|中午|下午|晚上)?\s*(\d{1,2})\s*[点时:：]\s*(半|\d{1,2})?\s*分?/.exec(s);
    if (m) {
      let h = Number(m[2]);
      const mi = m[3] === '半' ? 30 : (m[3] ? Number(m[3]) : 0);
      const pm = m[1] === '下午' || m[1] === '晚上' || evening;
      if (pm && h < 12) h += 12;
      if (m[1] === '中午' && h < 11) h += 12;
      if (h < 24 && mi < 60) {
        time = pad(h) + ':' + pad(mi);
        s = s.replace(m[0], '');
      }
    }

    const title = s.replace(/^[\s，,、。]+|[\s，,、。]+$/g, '');
    const hasWhen = !!date || !!time;
    return { title: title, date: date ? iso(date) : (time ? iso(day0) : ''), time: time, hasWhen: hasWhen };
  }

  global.parseQuick = parseQuick;
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseQuick: parseQuick };
})(typeof window !== 'undefined' ? window : globalThis);
