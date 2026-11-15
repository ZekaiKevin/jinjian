// 模拟外壳和一个假的 iCloud，用来在浏览器里走通同步流程
(() => {
  const log = (window.__log = { dav: [], notify: [], rects: 0, calls: [] });
  // 测试用的开关：noEtag 上传成功但不回版本号；failPut 接下来几次上传返回 500；delay 每个请求慢多少毫秒
  const opts = (window.__davOpts = { noEtag: false, failPut: 0, delay: 0 });
  const listeners = (window.__listeners = {});
  let stored = window.__SEED || '';
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) - 28);
  const dayOf = (off) => { const d = new Date(monday.getTime()); d.setDate(d.getDate() + off); return ymd(d); };
  const weekly = (uid, title, off, hm, place) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:' + uid, 'DTSTART;TZID=Asia/Shanghai:' + dayOf(off) + 'T' + hm + '00',
    'DTEND;TZID=Asia/Shanghai:' + dayOf(off) + 'T' + pad(Number(hm.slice(0, 2)) + 1) + pad((Number(hm.slice(2)) + 30) % 60) + '00', 'RRULE:FREQ=WEEKLY', 'SUMMARY:' + title, place ? 'LOCATION:' + place : '',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT10M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  const table = { 0: [['基础西班牙语3', '1000'], ['马原', '1400'], ['经济外交', '1600'], ['数据经济学与机器学习', '1800'], ['机器学习与R语言实践', '1800']], 1: [['基础西班牙语3', '1000'], ['人工智能赋能社会研究', '1400'], ['经济学原理', '1800', '明商208']], 2: [['基础西班牙语3', '1800'], ['西班牙语听力', '1940']],
    3: [['匹克球', '1000'], ['习概', '1400'], ['市场营销与数据分析', '1400'], ['西班牙语语法', '1800'], ['品牌营销传播', '1940']], 4: [['西班牙语口语', '0800'], ['西班牙语阅读', '1000'], ['数字经济概论', '1400'], ['市场营销学原理', '1800']], 5: [['元宇宙导论', '1400']] };
  const CAL = 'https://p42-caldav.icloud.com.cn:443/123/calendars/';
  const server = {};
  Object.keys(table).forEach((off) => table[off].forEach((c, i) => { const uid = 'C' + off + '-' + i; server[CAL + 'school/' + uid + '.ics'] = { etag: '"e1"', ics: weekly(uid, c[0], Number(off), c[1], c[2]) }; }));
  const t = ymd(now);
  const hm = (delta) => { const d = new Date(now.getTime() + delta * 60000); return pad(d.getHours()) + pad(d.getMinutes()); };
  server[CAL + 'home/ONE.ics'] = { etag: '"h1"', ics: ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:ONE', 'DTSTART;TZID=Asia/Shanghai:' + t + 'T' + hm(-30) + '00', 'DTEND;TZID=Asia/Shanghai:' + t + 'T' + hm(40) + '00', 'SUMMARY:取体检报告', 'LOCATION:社区医院', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') };
  const ms = (parts) => '<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">' + parts + '</multistatus>';
  const x = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  function davMock(req) {
    const host = new URL(req.url).hostname;
    if (!['icloud.com', 'icloud.com.cn'].some(d => host === d || host.endsWith('.' + d))) throw new Error('只允许访问 iCloud（' + host + '）');
    log.dav.push({ method: req.method, url: req.url, headers: req.headers, hasPass: !!req.pass });
    const h = {}; req.headers.forEach((kv) => { h[kv[0].toLowerCase()] = kv[1]; });
    if (req.user !== 'me@icloud.com') return { status: 401, headers: [], body: '' };
    if (req.url === 'https://caldav.icloud.com/') return { status: 401, headers: [], body: '' };
    if (req.method === 'PROPFIND' && req.url === 'https://caldav.icloud.com.cn/') return { status: 207, headers: [], body: ms('<response><href>/</href><propstat><prop><current-user-principal><href>/123/principal/</href></current-user-principal></prop></propstat></response>') };
    if (req.method === 'PROPFIND' && req.url === 'https://caldav.icloud.com.cn/123/principal/') return { status: 301, headers: [['Location', 'https://p42-caldav.icloud.com.cn:443/123/principal/']], body: '' };
    if (req.method === 'PROPFIND' && req.url === 'https://p42-caldav.icloud.com.cn/123/principal/') return { status: 207, headers: [], body: ms('<response><href>/123/principal/</href><propstat><prop><c:calendar-home-set><href>https://p42-caldav.icloud.com.cn:443/123/calendars/</href></c:calendar-home-set></prop></propstat></response>') };
    if (req.method === 'PROPFIND' && req.url === 'https://p42-caldav.icloud.com.cn/123/calendars/') return { status: 207, headers: [], body: ms(
      '<response><href>/123/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop></propstat></response>'
      + '<response><href>/123/calendars/school/</href><propstat><prop><displayname>第三学期课表</displayname><resourcetype><collection/><c:calendar/></resourcetype><a:calendar-color>#FFCC00FF</a:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></prop></propstat></response>'
      + '<response><href>/123/calendars/home/</href><propstat><prop><displayname>个人</displayname><resourcetype><collection/><c:calendar/></resourcetype><a:calendar-color>#1BADF8FF</a:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></prop></propstat></response>'
      + '<response><href>/123/calendars/tasks/</href><propstat><prop><displayname>提醒</displayname><resourcetype><collection/><c:calendar/></resourcetype><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></prop></propstat></response>') };
    if (req.method === 'REPORT') {
      const base = req.url.replace('https://p42-caldav.icloud.com.cn/', 'https://p42-caldav.icloud.com.cn:443/');
      const parts = Object.keys(server).filter((k) => k.indexOf(base) === 0).map((k) => '<response><href>' + k.replace('https://p42-caldav.icloud.com.cn:443', '') + '</href><propstat><prop><getetag>' + x(server[k].etag) + '</getetag><c:calendar-data>' + x(server[k].ics) + '</c:calendar-data></prop></propstat></response>').join('');
      return { status: 207, headers: [], body: ms(parts) };
    }
    const key = req.url.replace('https://p42-caldav.icloud.com.cn/', 'https://p42-caldav.icloud.com.cn:443/');
    if (req.method === 'PROPFIND' && h.depth === '0') {
      if (!server[key]) return { status: 404, headers: [], body: '' };
      return { status: 207, headers: [], body: ms('<response><href>' + key.replace('https://p42-caldav.icloud.com.cn:443', '') + '</href><propstat><prop><getetag>' + x(server[key].etag) + '</getetag></prop><status>HTTP/1.1 200 OK</status></propstat></response>') };
    }
    if (req.method === 'PUT' && opts.failPut > 0) { opts.failPut -= 1; return { status: 500, headers: [], body: '' }; }
    if (req.method === 'PUT') {
      if (h['if-match'] && (!server[key] || server[key].etag !== h['if-match'])) return { status: 412, headers: [], body: '' };
      if (h['if-none-match'] && server[key]) return { status: 412, headers: [], body: '' };
      const created = !server[key];
      server[key] = { etag: '"p' + log.dav.length + '"', ics: req.body };
      return { status: created ? 201 : 204, headers: opts.noEtag ? [] : [['ETag', server[key].etag]], body: '' };
    }
    if (req.method === 'DELETE') { delete server[key]; return { status: 204, headers: [], body: '' }; }
    return { status: 404, headers: [], body: '' };
  }
  window.__server = server;
  window.__TAURI__ = {
    core: { invoke: async (cmd, args) => {
      log.calls.push(cmd);
      if (cmd === 'load_data') return stored;
      if (cmd === 'save_data') { stored = args.json; window.__stored = stored; return null; }
      if (cmd === 'wallpaper') { const r = await fetch(window.__WP); return await r.arrayBuffer(); }
      if (cmd === 'set_hit_rects') { log.rects = args.rects.length; return null; }
      if (cmd === 'dav') { if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay)); return davMock(args.req); }
      if (cmd === 'get_holidays') return window.__HOLIDAYS || '';
      if (cmd === 'notify') { log.notify.push(args); return null; }
      if (cmd === 'set_locked') { (listeners.locked || []).forEach((f) => f({ payload: args.locked })); return null; }
      return null;
    } },
    event: { listen: async (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); } },
  };
})();
