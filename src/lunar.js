// 今笺：农历、24 节气、法定节假日与调休。纯函数，不碰界面，Node 里也能直接测。
//
// 农历：1900-01-31（正月初一）到 2101-01-28 的 B36 表，每年一项：
//   bit 16        闰月是不是 30 天
//   bit 15 ~ 4    正月到腊月，哪些月是 30 天（bit 15 是正月）
//   bit 3 ~ 0     闰哪个月（0 就是没有闰月）
// 表和国际通用的 ICU 只有 9 处不同（子夜前后合朔的月份），那 9 处以这张表为准：
//   1954-02-03 春节、1955-02-22 二月初一、1999-01-17 腊月初一、2012-08-17 七月初一、2018-11-08 十月初一、
//   2027-02-06 春节、2030-02-03 春节、2057-09-28 九月初一、2070-03-12 二月初一。
//
// 节气：太阳视黄经 = Meeus《Astronomical Algorithms》第 25 章的椭圆轨道部分 + 第 27 章表 27.C 的 24 项摄动，
//   牛顿迭代求太阳到达每个整 15° 的时刻，再换成北京时间（UTC+8）取日期。
//   对 2026、2027 年共 48 个官方时刻验证过，误差不超过 1 分钟。
(function (global) {
  'use strict';

  const B36 = 'ezc,esg,wog,gr9,15k0,16xc,1yl0,h40,ukw,gya,esg,wqe,wk0,15jk,2k45,zsw,16e8,26jn,tkg,1t2v,ei8,wj4,2dh2,l00,lkw,2ces,8kg,tio,gdu,ei8,k12,1600,1aa8,1zmd,hxs,8kg,257n,t0g,2i8n,13rk,1600,2ld2,ztc,h40,2bas,7gw,t00,15ma,xg0,ztj,lgg,ztc,1v11,fc0,wq8,1sab,gc0,xig,1a34,l28,yhy,xu8,ew0,xr8,wog,g9s,1bvn,16xc,i1j,h40,tsg,fdh,es0,wk0,161g,15jk,1654,zsw,102o,284m,tkg,ek0,xh0,wj4,z96,l00,lkw,2csn,xuo,tio,et1,ei8,jw0,n1f,1aa8,l7c,hxc,xuo,tsl,t0g,13s0,16xg,1600,174g,n6a,h40,xx3,7gw,t00,141h,xg0,zog,10v8,y8g,gyh,exs,wq8,1unq,gc0,xf4,nys,l28,y8g,i1e,ew0,wyu,wkg,15k0,1aat,1640,hwg,nfn,tsg,et7,es0,wk0,2jsm,15jk,163k,17ph,zvk,h5c,gxe,ek0,won,wj4,xn4,2dsl,lk0,yao,1tgj,t4g,em0,ei8,jw0,1z8m,1aa8,l28,2bic,xr4,t0g,15nn,13s0,1653,1600,174g,ifp,h40,wy8,gyc,gcw,xiw,xg0,zog,102u,y8g,gww,xwk,wq8,gc0,z8z,ks0,mrb,l28,y8g,1tg5,ew0,wog,gro,15cw,1a3s,163k,176o,1zmu,h5c,esg,xjo,w5s,15cg,1bv6,163k';
  const FIRST_YEAR = 1900;
  const MONTH_CH = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
  const DIGIT = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

  // 天数编号：只管公历日期，和时区无关
  const dayNo = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 864e5);
  const fromDayNo = (n) => { const t = new Date(n * 864e5); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };

  const DAY0 = dayNo(1900, 1, 31);
  const YEARS = [];
  let total = 0;
  B36.split(',').forEach((s, i) => {
    const v = parseInt(s, 36);
    const leap = v & 15;
    const months = [];
    let off = 0;
    for (let m = 1; m <= 12; m += 1) {
      const len = (v >> (16 - m)) & 1 ? 30 : 29;
      months.push({ m: m, leap: false, len: len, off: off });
      off += len;
      if (leap === m) {
        const l2 = (v >> 16) & 1 ? 30 : 29;
        months.push({ m: m, leap: true, len: l2, off: off });
        off += l2;
      }
    }
    YEARS.push({ year: FIRST_YEAR + i, start: total, days: off, months: months, leapMonth: leap });
    total += off;
  });

  function monthName(m, leap) { return (leap ? '闰' : '') + MONTH_CH[m - 1] + '月'; }

  function dayName(d) {
    if (d === 10) return '初十';
    if (d === 20) return '二十';
    if (d === 30) return '三十';
    if (d < 10) return '初' + DIGIT[d];
    if (d < 20) return '十' + DIGIT[d - 10];
    return '廿' + DIGIT[d - 20];
  }

  // 公历 → 农历；不在表里返回 null
  function solarToLunar(y, m, d) {
    const n = dayNo(y, m, d) - DAY0;
    if (!(n >= 0 && n < total)) return null;
    let lo = 0;
    let hi = YEARS.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (YEARS[mid].start <= n) lo = mid; else hi = mid - 1;
    }
    const yr = YEARS[lo];
    const inYear = n - yr.start;
    let k = yr.months.length - 1;
    while (yr.months[k].off > inYear) k -= 1;
    const mo = yr.months[k];
    const day = inYear - mo.off + 1;
    return {
      year: yr.year, month: mo.m, day: day, leap: mo.leap, monthLen: mo.len,
      monthName: monthName(mo.m, mo.leap), dayName: dayName(day), text: monthName(mo.m, mo.leap) + dayName(day),
    };
  }

  // 农历 → 公历。这个月不够 ld 天就落到月末；要的闰月这一年没有，就用平月；不在表里返回 null
  function lunarToSolar(ly, lm, ld, leap) {
    const yr = YEARS[ly - FIRST_YEAR];
    if (!yr || !(lm >= 1 && lm <= 12) || !(ld >= 1)) return null;
    let mo = null;
    for (let i = 0; i < yr.months.length; i += 1) {
      const x = yr.months[i];
      if (x.m === lm && x.leap === !!leap) mo = x;
    }
    if (!mo) mo = yr.months.find((x) => x.m === lm && !x.leap);
    const day = Math.min(ld, mo.len);
    return fromDayNo(DAY0 + yr.start + mo.off + day - 1);
  }

  // ---------- 节气 ----------

  const TERM_NAMES = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];
  const RAD = Math.PI / 180;
  const norm360 = (x) => ((x % 360) + 360) % 360;

  // Meeus 表 27.C：[振幅, 相位°, 频率°/世纪]，太阳黄经的周期摄动（含章动的主项）
  const PERIODIC = [[485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186], [182, 27.85, 445267.112], [156, 73.14, 45036.886], [136, 171.52, 22518.443],
    [77, 222.54, 65928.934], [74, 296.72, 3034.906], [70, 243.58, 9037.513], [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
    [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417], [18, 155.12, 67555.328], [17, 288.79, 4562.452], [16, 198.04, 62894.029],
    [14, 199.76, 31436.921], [12, 95.39, 14577.848], [12, 287.11, 31931.756], [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074]];

  // 地球时和世界时的差（秒），Espenak & Meeus 的分段多项式
  function deltaT(y) {
    let t;
    if (y < 1920) { t = y - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t * t * t - 0.000197 * t * t * t * t; }
    if (y < 1941) { t = y - 1920; return 21.2 + 0.84493 * t - 0.0761 * t * t + 0.0020936 * t * t * t; }
    if (y < 1961) { t = y - 1950; return 29.07 + 0.407 * t - (t * t) / 233 + (t * t * t) / 2547; }
    if (y < 1986) { t = y - 1975; return 45.45 + 1.067 * t - (t * t) / 260 - (t * t * t) / 718; }
    if (y < 2005) { t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t * t * t + 0.000651814 * Math.pow(t, 4) + 0.00002373599 * Math.pow(t, 5); }
    if (y < 2050) { t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; }
    t = (y - 1820) / 100;
    return -20 + 32 * t * t - 0.5628 * (2150 - y);
  }

  // 太阳视黄经（度），jde 是儒略历书日
  function sunLongitude(jde) {
    const T = (jde - 2451545) / 36525;
    const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * RAD;
    const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
    let s = 0;
    for (let i = 0; i < PERIODIC.length; i += 1) s += PERIODIC[i][0] * Math.cos((PERIODIC[i][1] + PERIODIC[i][2] * T) * RAD);
    // 表 27.C 里只有章动的主项（Ω），2L 和 2L′ 的小项另外补上
    const Lm = (218.3165 + 481267.8813 * T) * RAD;
    const nutSmall = (-1.32 * Math.sin(2 * L0 * RAD) - 0.23 * Math.sin(2 * Lm)) / 3600;
    const om = (125.04 - 1934.136 * T) * RAD;
    return norm360(L0 + C - 0.00569 - 0.0000098565 * s + nutSmall + (0.21 * Math.sin(2 * om)) / 3600);
  }

  const jdOf = (y, m, d) => {
    let yy = y;
    let mm = m;
    if (mm <= 2) { yy -= 1; mm += 12; }
    const a = Math.floor(yy / 100);
    return Math.floor(365.25 * (yy + 4716)) + Math.floor(30.6001 * (mm + 1)) + d + (2 - a + Math.floor(a / 4)) - 1524.5;
  };

  // 第 i 个节气（0 = 小寒）的时刻，UTC 毫秒
  function termInstant(year, i) {
    const lam = (285 + 15 * i) % 360;
    let jde = jdOf(year, 3, 20.5) + ((i < 5 ? lam - 360 : lam) / 360) * 365.2422;
    for (let n = 0; n < 12; n += 1) {
      const diff = norm360(lam - sunLongitude(jde) + 180) - 180;
      jde += diff / 0.9856473;
      if (Math.abs(diff) < 1e-9) break;
    }
    return (jde - deltaT(year + 0.5) / 86400 - 2440587.5) * 864e5;
  }

  const termCache = {};
  // 某年 24 个节气，北京时间；按先后排，第一个是小寒
  function termsOfYear(year) {
    if (termCache[year]) return termCache[year];
    const out = TERM_NAMES.map((name, i) => {
      const at = termInstant(year, i);
      const t = new Date(at + 8 * 3600e3);
      return { name: name, month: t.getUTCMonth() + 1, day: t.getUTCDate(), hour: t.getUTCHours(), minute: t.getUTCMinutes(), at: at };
    });
    termCache[year] = out;
    termCache[year].byDay = {};
    out.forEach((t) => { termCache[year].byDay[t.month * 100 + t.day] = t.name; });
    return out;
  }

  function solarTerm(y, m, d) {
    return termsOfYear(y).byDay[m * 100 + d] || '';
  }

  // ---------- 节日 ----------

  const SOLAR_FEST = { 101: '元旦', 501: '劳动节', 1001: '国庆节' };
  const LUNAR_FEST = { 101: '春节', 115: '元宵', 505: '端午', 707: '七夕', 815: '中秋', 909: '重阳' };

  function festival(y, m, d) {
    const l = solarToLunar(y, m, d);
    if (l && !l.leap) {
      if (l.month === 12 && l.day === l.monthLen) return '除夕';
      const f = LUNAR_FEST[l.month * 100 + l.day];
      if (f) return f;
    }
    return SOLAR_FEST[m * 100 + d] || '';
  }

  // ---------- 法定休班 ----------
  // 来源：国务院办公厅关于 2025、2026、2027 年部分节假日安排的通知。
  // off 是放假（含调休连休的周末），work 是周末补班。写“起..止”表示连续几天。
  const BUILTIN = {
    off: [
      '2025-01-01', '2025-01-28..2025-02-04', '2025-04-04..2025-04-06', '2025-05-01..2025-05-05', '2025-05-31..2025-06-02', '2025-10-01..2025-10-08',
      '2026-01-01..2026-01-03', '2026-02-15..2026-02-23', '2026-04-04..2026-04-06', '2026-05-01..2026-05-05', '2026-06-19..2026-06-21', '2026-09-25..2026-09-27', '2026-10-01..2026-10-07',
      '2027-01-01..2027-01-03', '2027-02-05..2027-02-13', '2027-04-03..2027-04-05', '2027-05-01..2027-05-05', '2027-06-09', '2027-09-15', '2027-10-01..2027-10-07',
    ],
    work: [
      '2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11',
      '2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10',
      '2027-01-31', '2027-02-14', '2027-05-08', '2027-09-26', '2027-10-09',
    ],
  };
  const MAX_RANGE = 31;
  const ENTRY = /^(\d{4})-(\d{2})-(\d{2})(?:\.\.(\d{4})-(\d{2})-(\d{2}))?$/;

  // “2026-10-01” 或 “2026-10-01..2026-10-07” → [dayNo, ...]；写错了返回空数组
  function parseEntry(text) {
    const m = typeof text === 'string' ? ENTRY.exec(text.trim()) : null;
    if (!m) return [];
    const ok = (y, mo, d) => { const t = new Date(Date.UTC(y, mo - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d; };
    const a = [Number(m[1]), Number(m[2]), Number(m[3])];
    const b = m[4] ? [Number(m[4]), Number(m[5]), Number(m[6])] : a;
    if (!ok(a[0], a[1], a[2]) || !ok(b[0], b[1], b[2])) return [];
    const from = dayNo(a[0], a[1], a[2]);
    const to = dayNo(b[0], b[1], b[2]);
    if (to < from || to - from + 1 > MAX_RANGE) return [];
    const out = [];
    for (let n = from; n <= to; n += 1) out.push(n);
    return out;
  }

  function buildTable(data) {
    const table = new Map();
    let count = 0;
    ['off', 'work'].forEach((kind) => {
      const list = data && Array.isArray(data[kind]) ? data[kind] : [];
      list.forEach((entry) => parseEntry(entry).forEach((n) => { table.set(n, kind); count += 1; }));
    });
    return { table: table, count: count };
  }

  const builtin = buildTable(BUILTIN).table;
  let extra = new Map();

  // 用 holidays.json 的内容补充或改写休班日期（整份替换，不累加）。
  // 格式：{ "off": ["2028-01-01", "2028-01-26..2028-02-02"], "work": ["2028-01-22"] }
  // 传 null 就是清掉。返回收下了几天；坏内容当作没有，不报错。
  function setHolidays(data) {
    extra = new Map();
    if (data === null || data === undefined) return 0;
    let obj = data;
    if (typeof data === 'string') {
      try { obj = JSON.parse(data.replace(/^﻿/, '')); } catch (err) { return 0; }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 0;
    const built = buildTable(obj);
    extra = built.table;
    return built.count;
  }

  // 'off' 放假，'work' 补班，'' 平常
  function holiday(y, m, d) {
    const n = dayNo(y, m, d);
    return extra.get(n) || builtin.get(n) || '';
  }

  // 表里所有放假的日子（内置的加上 holidays.json 的，后者优先），'YYYY-MM-DD'，按先后排。
  // “遇法定节假日自动跳过”的重复日程按它算要跳过哪几场。
  function offDays() {
    const all = new Map(builtin);
    extra.forEach((v, k) => all.set(k, v));
    const out = [];
    all.forEach((v, n) => {
      if (v !== 'off') return;
      const d = new Date(n * 864e5);
      out.push(d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'));
    });
    return out.sort();
  }

  // ---------- 界面用 ----------

  // sub 是格子里那一小段字：节日 > 节气 > 初一显示月名 > 农历日
  function info(y, m, d) {
    const l = solarToLunar(y, m, d);
    const fest = festival(y, m, d);
    const term = solarTerm(y, m, d);
    let sub = '';
    let kind = '';
    if (fest) { sub = fest; kind = 'festival'; }
    else if (term) { sub = term; kind = 'term'; }
    else if (l && l.day === 1) { sub = l.monthName; kind = 'month'; }
    else if (l) { sub = l.dayName; kind = 'day'; }
    return { lunar: l ? l.text : '', sub: sub, kind: kind, festival: fest, term: term, hol: holiday(y, m, d) };
  }

  const api = {
    solarToLunar: solarToLunar,
    lunarToSolar: lunarToSolar,
    termsOfYear: termsOfYear,
    solarTerm: solarTerm,
    festival: festival,
    holiday: holiday,
    setHolidays: setHolidays,
    offDays: offDays,
    info: info,
  };
  global.Lunar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
