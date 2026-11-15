// 今笺 Jinjian：顶部倒数日条挑哪几条、怎么说。纯函数，浏览器和 Node 里都能用，单测在 tests/countdown.test.js。
(function (global) {
  'use strict';

  const dayNo = (key) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof key === 'string' ? key : '');
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : NaN;
  };

  // 从 from 到 to 隔几天（按日历天算，to 在后面是正数）
  const days = (from, to) => dayNo(to) - dayNo(from);

  // items：本机和 iCloud 的日程、待办；设了 countdown 的才算。
  // 返回最近的 max 条（日期不早于今天、没完成），每条带着“距 X 还有 N 天”的三段话。
  function pick(items, today, max) {
    const limit = max === undefined ? 3 : max;
    const out = [];
    (Array.isArray(items) ? items : []).forEach((it, index) => {
      if (!it || typeof it !== 'object' || !it.countdown || it.done) return;
      const n = days(today, it.date);
      if (!(n >= 0)) return; // 日期写坏了（NaN）和已经过去的都不要
      const title = typeof it.title === 'string' && it.title.trim() ? it.title : '未命名';
      const lead = n === 0 ? '' : '距 ';
      const tail = n === 0 ? ' 今天' : ' 还有 ' + n + ' 天';
      out.push({
        id: it.id, kind: it.kind, title: title, date: it.date, days: n, lead: lead, tail: tail, label: lead + title + tail,
        _start: typeof it.start === 'string' && it.start ? it.start : '99:99', _index: index,
      });
    });
    out.sort((a, b) => (a.days - b.days)
      || (a._start < b._start ? -1 : a._start > b._start ? 1 : 0)
      || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)
      || (a._index - b._index));
    return out.slice(0, Math.max(0, limit)).map((x) => { delete x._start; delete x._index; return x; });
  }

  const api = { days: days, pick: pick };
  global.Countdown = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
