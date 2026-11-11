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

    async function put(user, href, ics, etag) {
      const r = await req('PUT', href, {
        user: user, type: 'text/calendar; charset=utf-8', body: ics,
        headers: [etag ? ['If-Match', etag] : ['If-None-Match', '*']],
      });
      return { ok: r.status >= 200 && r.status < 300, status: r.status, etag: r.headers.etag || '', url: r.url };
    }

    async function remove(user, href, etag) {
      const r = await req('DELETE', href, { user: user, headers: etag ? [['If-Match', etag]] : [] });
      return { ok: (r.status >= 200 && r.status < 300) || r.status === 404, status: r.status };
    }

    return { discover: discover, fetchCalendar: fetchCalendar, put: put, remove: remove };
  }

  global.CalDav = { create: create };
})(window);
