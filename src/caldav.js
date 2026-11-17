// 今笺：和 iCloud 日历（CalDAV）打交道。
// 真正的网络请求由外壳发出（浏览器里发不了 PROPFIND / REPORT），这里只负责拼请求、读应答。
(function (global) {
  'use strict';

  // 先试国际版；账号密码不被认，再试中国大陆版（云上贵州）。
  const ROOTS = ['https://caldav.icloud.com/', 'https://caldav.icloud.com.cn/'];
  const CALDAV_NS = 'urn:ietf:params:xml:ns:caldav';

  const first = (el, name) => el.getElementsByTagNameNS('*', name)[0] || null;
  const text = (el, name) => { const n = el ? first(el, name) : null; return n ? n.textContent.trim() : ''; };
  const xml = (body) => new DOMParser().parseFromString(body, 'application/xml');

  function fail(res) {
    const err = new Error(res.status === 401 ? 'auth' : 'HTTP ' + res.status);
    err.status = res.status;
    return err;
  }

  // 发一个请求；iCloud 会把人引到具体的分区服务器，这里自己跟着跳。
  async function request(send, method, url, opt) {
    let target = url;
    for (let hop = 0; hop < 5; hop += 1) {
      const headers = [['Content-Type', opt.type || 'application/xml; charset=utf-8']].concat(opt.headers || []);
      const res = await send({ method: method, url: target, headers: headers, body: opt.body == null ? null : opt.body, user: opt.user, pass: opt.pass || null });
      const h = {};
      (res.headers || []).forEach((kv) => { h[String(kv[0]).toLowerCase()] = kv[1]; });
      if ([301, 302, 307, 308].indexOf(res.status) >= 0 && h.location) {
        target = new URL(h.location, target).href;
        continue;
      }
      return { status: res.status, headers: h, body: res.body || '', url: target };
    }
    throw new Error('重定向次数过多');
  }

  function create(send) {
    const req = (method, url, opt) => request(send, method, url, opt);

    // 找出这个账号下所有能放日程的日历。
    async function discover(user, pass) {
      let r = null;
      for (const root of ROOTS) {
        r = await req('PROPFIND', root, {
          user: user, pass: pass, headers: [['Depth', '0']],
          body: '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
        });
        if (r.status !== 401) break;
      }
      if (r.status >= 400) throw fail(r);
      const principalHref = text(first(xml(r.body), 'current-user-principal'), 'href');
      if (!principalHref) throw new Error('没有找到账号信息');
      const principal = new URL(principalHref, r.url).href;

      r = await req('PROPFIND', principal, {
        user: user, pass: pass, headers: [['Depth', '0']],
        body: '<d:propfind xmlns:d="DAV:" xmlns:c="' + CALDAV_NS + '"><d:prop><c:calendar-home-set/></d:prop></d:propfind>',
      });
      if (r.status >= 400) throw fail(r);
      const homeHref = text(first(xml(r.body), 'calendar-home-set'), 'href');
      if (!homeHref) throw new Error('没有找到日历目录');
      const home = new URL(homeHref, r.url).href;

      r = await req('PROPFIND', home, {
        user: user, pass: pass, headers: [['Depth', '1']],
        body: '<d:propfind xmlns:d="DAV:" xmlns:c="' + CALDAV_NS + '" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:displayname/><d:resourcetype/><a:calendar-color/><c:supported-calendar-component-set/></d:prop></d:propfind>',
      });
      if (r.status >= 400) throw fail(r);
      const out = [];
      Array.from(xml(r.body).getElementsByTagNameNS('*', 'response')).forEach((resp) => {
        const type = first(resp, 'resourcetype');
        if (!type || type.getElementsByTagNameNS(CALDAV_NS, 'calendar').length === 0) return;
        const comps = Array.from(resp.getElementsByTagNameNS('*', 'comp')).map((c) => c.getAttribute('name'));
        if (comps.length && comps.indexOf('VEVENT') < 0) return;
        const href = text(resp, 'href');
        if (!href) return;
        out.push({
          href: new URL(href, r.url).href,
          name: text(resp, 'displayname') || '日历',
          color: (text(resp, 'calendar-color') || '').slice(0, 7),
        });
      });
      return out;
    }

    // 拉取一个日历在时间段内的所有条目（重复日程拿到的是带规则的原件）。
    async function fetchCalendar(user, calHref, from, to) {
      const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const r = await req('REPORT', calHref, {
        user: user, headers: [['Depth', '1']],
        body: '<c:calendar-query xmlns:d="DAV:" xmlns:c="' + CALDAV_NS + '"><d:prop><d:getetag/><c:calendar-data/></d:prop>'
          + '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">'
          + '<c:time-range start="' + stamp(from) + '" end="' + stamp(to) + '"/>'
          + '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>',
      });
      if (r.status >= 400) throw fail(r);
      const out = [];
      Array.from(xml(r.body).getElementsByTagNameNS('*', 'response')).forEach((resp) => {
        const href = text(resp, 'href');
        const data = text(resp, 'calendar-data');
        if (!href || !data) return;
        out.push({ href: new URL(href, r.url).href, etag: text(resp, 'getetag'), ics: data });
      });
      return out;
    }

    // ---------- 增量同步（0.9.0） ----------

    // 日历现在的“版本”：ctag 一变就说明里面有东西动过；token 用来只问“从上次到现在变了哪些”。
    // 服务器不支持（或这次没问到）就都是空的，调用方会老老实实整个重拉。
    async function state(user, calHref) {
      const r = await req('PROPFIND', calHref, {
        user: user, headers: [['Depth', '0']],
        body: '<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/"><d:prop><cs:getctag/><d:sync-token/></d:prop></d:propfind>',
      });
      if (r.status >= 300) return { ctag: '', token: '' };
      const doc = xml(r.body).documentElement;
      return { ctag: text(doc, 'getctag'), token: text(doc, 'sync-token') };
    }

    // 从 token 那一刻到现在变了哪些：changed 是新增 / 改过的地址，removed 是服务器上已经没了的。
    // token 过期、服务器不认（403 / 409 / 410 之类）时 ok 为 false，调用方清掉 token 整个重拉。
    async function changes(user, calHref, token) {
      const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const r = await req('REPORT', calHref, {
        user: user, headers: [['Depth', '1']],
        body: '<d:sync-collection xmlns:d="DAV:"><d:sync-token>' + esc(token) + '</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>',
      });
      if (r.status !== 207) return { ok: false, status: r.status, token: '', changed: [], removed: [] };
      const doc = xml(r.body);
      const self = new URL(calHref).pathname.replace(/\/+$/, '');
      const out = { ok: true, status: 207, token: '', changed: [], removed: [] };
      Array.from(doc.getElementsByTagNameNS('*', 'response')).forEach((resp) => {
        const href = text(resp, 'href');
        if (!href) return;
        const abs = new URL(href, r.url).href;
        if (new URL(abs).pathname.replace(/\/+$/, '') === self) return; // 日历自己
        // 直接挂在 response 下面的 status（不是 propstat 里的）说的是这个地址本身：404 就是删掉了
        const own = Array.from(resp.children).find((c) => c.localName === 'status');
        const code = own ? Number((/\s(\d{3})\s?/.exec(own.textContent) || [])[1]) : 0;
        if (code === 404 || code === 410) out.removed.push(abs);
        else if (code === 507) out.ok = false; // 结果被截断了：这一轮不作数
        else out.changed.push({ href: abs, etag: text(resp, 'getetag') });
      });
      const tok = Array.from(doc.documentElement.children).find((c) => c.localName === 'sync-token');
      out.token = tok ? tok.textContent.trim() : '';
      return out;
    }

    // 按地址取几条的原文（增量同步里只取变了的那几条），一次最多 50 条
    async function multiget(user, calHref, hrefs) {
      const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const out = [];
      for (let i = 0; i < hrefs.length; i += 50) {
        const part = hrefs.slice(i, i + 50);
        const r = await req('REPORT', calHref, {
          user: user, headers: [['Depth', '1']],
          body: '<c:calendar-multiget xmlns:d="DAV:" xmlns:c="' + CALDAV_NS + '"><d:prop><d:getetag/><c:calendar-data/></d:prop>'
            + part.map((h) => '<d:href>' + esc(new URL(h).pathname) + '</d:href>').join('') + '</c:calendar-multiget>',
        });
        if (r.status >= 400) throw fail(r);
        Array.from(xml(r.body).getElementsByTagNameNS('*', 'response')).forEach((resp) => {
          const href = text(resp, 'href');
          const data = text(resp, 'calendar-data');
          if (href && data) out.push({ href: new URL(href, r.url).href, etag: text(resp, 'getetag'), ics: data });
        });
      }
      return out;
    }

    // 查一条日程在服务器上现在的版本号。不存在时 status 是 404。
    async function etagOf(user, href) {
      const r = await req('PROPFIND', href, {
        user: user, headers: [['Depth', '0']],
        body: '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>',
      });
      return { status: r.status, etag: r.status < 300 ? text(xml(r.body).documentElement, 'getetag') : '' };
    }

    // 上传一条日程。
    //   etag 有值：只在服务器上还是这个版本时才覆盖（别处改过就返回 412）
    //   isNew：新建，服务器上已经有同名的就返回 412
    //   都没有：直接覆盖（只在实在拿不到版本号时用）
    async function put(user, href, ics, etag, isNew) {
      const cond = etag ? [['If-Match', etag]] : isNew ? [['If-None-Match', '*']] : [];
      const r = await req('PUT', href, {
        user: user, type: 'text/calendar; charset=utf-8', body: ics,
        headers: cond,
      });
      return { ok: r.status >= 200 && r.status < 300, status: r.status, etag: r.headers.etag || '', url: r.url };
    }

    async function remove(user, href, etag) {
      const r = await req('DELETE', href, { user: user, headers: etag ? [['If-Match', etag]] : [] });
      return { ok: (r.status >= 200 && r.status < 300) || r.status === 404, status: r.status };
    }

    return { discover: discover, fetchCalendar: fetchCalendar, state: state, changes: changes, multiget: multiget, etagOf: etagOf, put: put, remove: remove };
  }

  global.CalDav = { create: create };
})(window);
