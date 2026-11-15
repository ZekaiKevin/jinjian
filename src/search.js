// 今笺 Jinjian：Ctrl+F 搜索的纯函数部分（切词、匹配、排序、片段、高亮）。
// 不碰界面，浏览器和 Node 里都能用，单测在 tests/search.test.js。
(function (global) {
  'use strict';

  const MAX_TOKENS = 8;
  const SNIP_WIDTH = 30;
  const SNIP_LEAD = 10;
  const FIELDS = [['place', '地点'], ['notes', '备注']];

  const str = (v) => (typeof v === 'string' ? v : '');

  // 全角转半角、转小写，但每个字符折叠后长度不变，这样命中的下标可以直接用在原文上。
  function fold(s) {
    let out = '';
    for (const ch of String(s == null ? '' : s)) {
      let f = ch.normalize('NFKC').toLowerCase();
      if (f.length !== ch.length) f = ch.toLowerCase();
      out += f.length === ch.length ? f : ch;
    }
    return out;
  }

  function tokens(query) {
    const seen = {};
    const out = [];
    fold(str(query)).split(/\s+/).forEach((t) => {
      if (t && !seen[t] && out.length < MAX_TOKENS) { seen[t] = true; out.push(t); }
    });
    return out;
  }

  // 每个词在文本里第一次出现的位置；找不到就是 -1
  const firsts = (folded, toks) => toks.map((t) => folded.indexOf(t));

  // 把文本按命中切成段：[{ t, m }]，m 为 true 的是命中的部分
  function segments(text, toks) {
    const raw = str(text);
    if (!raw) return [];
    const f = fold(raw);
    const marks = [];
    (toks || []).forEach((t) => {
      if (!t) return;
      for (let i = f.indexOf(t); i >= 0; i = f.indexOf(t, i + t.length)) marks.push([i, i + t.length]);
    });
    marks.sort((a, b) => a[0] - b[0]);
    const merged = [];
    marks.forEach((m) => {
      const last = merged[merged.length - 1];
      if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
      else merged.push([m[0], m[1]]);
    });
    const out = [];
    let at = 0;
    merged.forEach((m) => {
      if (m[0] > at) out.push({ t: raw.slice(at, m[0]), m: false });
      out.push({ t: raw.slice(m[0], m[1]), m: true });
      at = m[1];
    });
    if (at < raw.length) out.push({ t: raw.slice(at), m: false });
    return out;
  }

  // 一小段单行文字：以第一个命中为中心，前后不够就用省略号
  function snippet(text, toks) {
    const one = str(text).replace(/\s+/g, ' ').trim();
    const f = fold(one);
    const hits = firsts(f, toks).filter((i) => i >= 0);
    const pos = hits.length ? Math.min.apply(null, hits) : 0;
    const start = Math.max(0, pos - SNIP_LEAD);
    const body = one.slice(start, start + SNIP_WIDTH);
    return (start > 0 ? '…' : '') + body + (start + SNIP_WIDTH < one.length ? '…' : '');
  }

  const dayNo = (key) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(key));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : NaN;
  };

  // items：本机和 iCloud 的日程、待办；note：便签；today：'YYYY-MM-DD'。
  // 返回 { items, total, note }。词与词之间是“且”，可以分散在标题、地点、备注、子任务里。
  function run(opts) {
    const o = opts || {};
    const toks = tokens(o.query);
    const limit = o.limit > 0 ? o.limit : 100;
    const res = { items: [], total: 0, note: null };
    if (!toks.length) return res;

    const base = dayNo(o.today);
    const found = [];
    (Array.isArray(o.items) ? o.items : []).forEach((it, index) => {
      if (!it || typeof it !== 'object') return;
      const title = fold(str(it.title));
      const others = FIELDS.map((f) => ({ key: f[0], text: str(it[f[0]]) }));
      (Array.isArray(it.subs) ? it.subs : []).forEach((s) => others.push({ key: 'subs', text: str(s && s.text) }));
      const folded = others.map((x) => fold(x.text));
      const all = [title].concat(folded);
      if (!toks.every((t) => all.some((h) => h.indexOf(t) >= 0))) return;

      const inTitle = toks.every((t) => title.indexOf(t) >= 0);
      let field = '';
      let snip = '';
      if (!inTitle) {
        const k = folded.findIndex((h) => toks.some((t) => h.indexOf(t) >= 0));
        if (k >= 0) { field = others[k].key; snip = snippet(others[k].text, toks); }
      }
      const dist = Math.abs(dayNo(it.date) - base);
      found.push({
        inTitle: inTitle, dist: Number.isNaN(dist) ? Infinity : dist, index: index,
        series: it.recurring || it.parts ? 'S|' + str(it.href) : '',
        hit: {
          id: it.id, kind: it.kind, title: str(it.title), date: str(it.date), start: str(it.start), end: str(it.end), allDay: !!it.allDay,
          due: str(it.due), done: !!it.done, star: !!it.star, place: str(it.place), color: str(it.color), remote: !!it.remote,
          field: field, snippet: snip,
        },
      });
    });

    found.sort((a, b) => (Number(b.inTitle) - Number(a.inTitle))
      || (a.dist - b.dist)
      || (a.hit.date < b.hit.date ? -1 : a.hit.date > b.hit.date ? 1 : 0)
      || (a.hit.start < b.hit.start ? -1 : a.hit.start > b.hit.start ? 1 : 0)
      || (a.index - b.index));

    // 每周的课、跨天的日程是同一件事的很多场，只留排在最前（离今天最近）的那一场
    const seen = {};
    const unique = found.filter((f) => {
      if (!f.series) return true;
      if (seen[f.series]) return false;
      seen[f.series] = true;
      return true;
    });
    res.total = unique.length;
    res.items = unique.slice(0, limit).map((f) => f.hit);

    const note = str(o.note);
    if (note) {
      const f = fold(note);
      const at = firsts(f, toks);
      if (at.every((i) => i >= 0)) {
        const pos = at[0];
        const lineStart = note.lastIndexOf('\n', pos - 1) + 1;
        const lineEnd = note.indexOf('\n', pos);
        res.note = { pos: pos, len: toks[0].length, snippet: snippet(note.slice(lineStart, lineEnd < 0 ? note.length : lineEnd), toks) };
      }
    }
    return res;
  }

  const api = { fold: fold, tokens: tokens, segments: segments, run: run };
  global.Search = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
