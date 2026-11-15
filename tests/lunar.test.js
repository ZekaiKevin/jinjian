// 农历、24 节气、法定休班。
// 参照来源：
//   农历：B36 表（1900-01-31 ~ 2101-01-28）；与 ICU 只有 9 处刻意修正的差别（见下面“修正”一组）。
//   节气时刻：2026 年取自台湾中央气象署《曆象表》，2027 年取自日本国立天文台《暦要項》（日本时间减 1 小时）。
//   休班：国务院办公厅关于 2025、2026、2027 年部分节假日安排的通知（新华网转载全文）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Lunar = require('../src/lunar.js');

const ymd = (iso) => iso.split('-').map(Number);
const lunarOf = (iso) => { const l = Lunar.solarToLunar(...ymd(iso)); return l && [l.year, l.leap ? '闰' : '', l.monthName.replace('闰', ''), l.dayName].join(''); };
const dayNo = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 864e5);
const isoOf = (n) => new Date(n * 864e5).toISOString().slice(0, 10);

// ---------- 农历 ----------

test('范围：1900-01-31（正月初一）到 2101-01-28 共 73412 天，前后各一天都不在表里', () => {
  assert.equal(lunarOf('1900-01-31'), '1900正月初一');
  assert.equal(lunarOf('2101-01-28'), '2100腊月廿九');
  assert.equal(Lunar.solarToLunar(1900, 1, 30), null);
  assert.equal(Lunar.solarToLunar(2101, 1, 29), null);
  let n = 0;
  for (let d = dayNo(1900, 1, 31); d <= dayNo(2101, 1, 28); d += 1) {
    const [y, m, dd] = ymd(isoOf(d));
    assert.ok(Lunar.solarToLunar(y, m, dd), isoOf(d));
    n += 1;
  }
  assert.equal(n, 73412);
});

test('国务院通知里写明的农历日期', () => {
  // 2025 春节：1月28日（农历除夕）至2月4日（农历正月初七）
  assert.equal(lunarOf('2025-01-28'), '2024腊月廿九');
  assert.equal(lunarOf('2025-02-04'), '2025正月初七');
  // 2026 春节：2月15日（农历腊月二十八）至23日（农历正月初七）
  assert.equal(lunarOf('2026-02-15'), '2025腊月廿八');
  assert.equal(lunarOf('2026-02-23'), '2026正月初七');
  // 2027 春节：2月5日（农历除夕）至13日（农历正月初八）
  assert.equal(lunarOf('2027-02-05'), '2026腊月廿九');
  assert.equal(lunarOf('2027-02-13'), '2027正月初八');
});

test('历年春节', () => {
  const cny = { 2020: '01-25', 2021: '02-12', 2022: '02-01', 2023: '01-22', 2024: '02-10', 2025: '01-29', 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03' };
  Object.keys(cny).forEach((y) => assert.equal(lunarOf(y + '-' + cny[y]), y + '正月初一', y));
});

test('闰月', () => {
  assert.equal(lunarOf('2020-05-23'), '2020闰四月初一');
  assert.equal(lunarOf('2023-03-22'), '2023闰二月初一');
  assert.equal(lunarOf('2025-07-25'), '2025闰六月初一');
  assert.equal(lunarOf('2033-12-22'), '2033闰冬月初一');
  assert.equal(Lunar.solarToLunar(2025, 7, 25).monthName, '闰六月');
  assert.equal(Lunar.solarToLunar(2025, 7, 25).text, '闰六月初一');
});

test('修正：和 ICU 不一样的 9 处，以 B36 表为准', () => {
  const fixed = [
    ['1954-02-03', '1954正月初一'],
    ['1955-02-22', '1955二月初一'],
    ['1999-01-17', '1998腊月初一'],
    ['2012-08-17', '2012七月初一'],
    ['2018-11-07', '2018九月三十'],
    ['2018-11-08', '2018十月初一'],
    ['2027-02-06', '2027正月初一'],
    ['2030-02-02', '2029腊月三十'],
    ['2030-02-03', '2030正月初一'],
    ['2057-09-28', '2057九月初一'],
    ['2070-03-12', '2070二月初一'],
  ];
  fixed.forEach(([iso, want]) => assert.equal(lunarOf(iso), want, iso));
});

test('和 ICU 逐日对比：不一样的月份只能是上面那 9 处', { skip: typeof Intl === 'undefined' || !/chinese/.test(Intl.DateTimeFormat.supportedLocalesOf(['en-u-ca-chinese']).join()) }, () => {
  const fmt = new Intl.DateTimeFormat('en-u-ca-chinese-nu-latn', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' });
  // 9 处修正涉及的“月初”（公历日期）：差别只会出现在这些月里
  const fixedMonthStarts = ['1954-02-03', '1955-02-22', '1999-01-17', '2012-08-17', '2018-11-08', '2027-02-06', '2030-02-03', '2057-09-28', '2070-03-12'];
  const bad = [];
  for (let d = dayNo(1900, 1, 31); d <= dayNo(2100, 12, 31); d += 1) {
    const iso = isoOf(d);
    const mine = Lunar.solarToLunar(...ymd(iso));
    const p = {};
    fmt.formatToParts(new Date(iso + 'T12:00:00+08:00')).forEach((x) => { p[x.type] = x.value; });
    const icuMonth = String(p.month);
    const myMonth = mine.month + (mine.leap ? 'bis' : '');
    if (icuMonth !== myMonth || Number(p.day) !== mine.day) bad.push(iso);
  }
  // 每处修正只让相邻的一个月（最多 30 天）对不上，且总共不超过 9 个月
  const months = new Set();
  bad.forEach((iso) => {
    const start = fixedMonthStarts.map(ymdIso => dayNo(...ymd(ymdIso))).filter((s) => Math.abs(s - dayNo(...ymd(iso))) <= 30);
    assert.ok(start.length > 0, '意外的差别：' + iso);
    months.add(start[0]);
  });
  assert.ok(months.size <= 9);
});

test('公历 → 农历 → 公历，逐日往返', () => {
  for (let d = dayNo(1900, 1, 31); d <= dayNo(2101, 1, 28); d += 1) {
    const [y, m, dd] = ymd(isoOf(d));
    const l = Lunar.solarToLunar(y, m, dd);
    const back = Lunar.lunarToSolar(l.year, l.month, l.day, l.leap);
    assert.deepEqual(back, { y: y, m: m, d: dd }, isoOf(d));
  }
});

test('农历 → 公历：月份不够长就落到月末；没有这个闰月就用平月', () => {
  // 2025 年腊月只有 29 天，“腊月三十”落到廿九，也就是 2026-02-16
  assert.deepEqual(Lunar.lunarToSolar(2025, 12, 30, false), { y: 2026, m: 2, d: 16 });
  // 2024 年没有闰四月
  assert.deepEqual(Lunar.lunarToSolar(2024, 4, 15, true), Lunar.lunarToSolar(2024, 4, 15, false));
  assert.deepEqual(Lunar.lunarToSolar(2025, 6, 1, true), { y: 2025, m: 7, d: 25 });
  assert.equal(Lunar.lunarToSolar(1899, 1, 1, false), null);
  assert.equal(Lunar.lunarToSolar(2101, 1, 1, false), null);
  assert.equal(Lunar.lunarToSolar(2024, 13, 1, false), null);
});

test('名字：月名、日名', () => {
  const names = (iso) => { const l = Lunar.solarToLunar(...ymd(iso)); return [l.monthName, l.dayName]; };
  assert.deepEqual(names('2027-02-06'), ['正月', '初一']);
  assert.deepEqual(names('2026-09-25'), ['八月', '十五']);
  assert.deepEqual(names('2026-09-30'), ['八月', '二十']);
  assert.deepEqual(names('2026-10-01'), ['八月', '廿一']);
  assert.deepEqual(names('2026-11-01'), ['九月', '廿三']);
  assert.deepEqual(names('2026-12-19'), ['冬月', '十一']);
  assert.deepEqual(names('2027-02-05'), ['腊月', '廿九']);
  assert.deepEqual(names('2030-02-02'), ['腊月', '三十']);
});

// ---------- 24 节气 ----------

// [月, 日, 时, 分]，北京时间
const T2026 = [[1, 5, 16, 23], [1, 20, 9, 45], [2, 4, 4, 2], [2, 18, 23, 52], [3, 5, 21, 59], [3, 20, 22, 46], [4, 5, 2, 40], [4, 20, 9, 39], [5, 5, 19, 49], [5, 21, 8, 37], [6, 5, 23, 48], [6, 21, 16, 25],
  [7, 7, 9, 57], [7, 23, 3, 13], [8, 7, 19, 43], [8, 23, 10, 19], [9, 7, 22, 41], [9, 23, 8, 5], [10, 8, 14, 29], [10, 23, 17, 38], [11, 7, 17, 52], [11, 22, 15, 23], [12, 7, 10, 53], [12, 22, 4, 50]];
const T2027 = [[1, 5, 22, 10], [1, 20, 15, 30], [2, 4, 9, 46], [2, 19, 5, 33], [3, 6, 3, 40], [3, 21, 4, 25], [4, 5, 8, 17], [4, 20, 15, 18], [5, 6, 1, 25], [5, 21, 14, 18], [6, 6, 5, 26], [6, 21, 22, 11],
  [7, 7, 15, 37], [7, 23, 9, 5], [8, 8, 1, 27], [8, 23, 16, 14], [9, 8, 4, 28], [9, 23, 14, 2], [10, 8, 20, 17], [10, 23, 23, 33], [11, 7, 23, 39], [11, 22, 21, 16], [12, 7, 16, 38], [12, 22, 10, 42]];
const NAMES = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];

[[2026, T2026], [2027, T2027]].forEach(([year, ref]) => {
  test(year + ' 年 24 节气：日期一天不差，时刻误差不超过 2 分钟', () => {
    const terms = Lunar.termsOfYear(year);
    assert.equal(terms.length, 24);
    ref.forEach((r, i) => {
      const t = terms[i];
      assert.equal(t.name, NAMES[i]);
      assert.deepEqual([t.month, t.day], [r[0], r[1]], year + NAMES[i]);
      const diff = (t.hour * 60 + t.minute) - (r[2] * 60 + r[3]);
      assert.ok(Math.abs(diff) <= 2, year + NAMES[i] + ' 差 ' + diff + ' 分钟');
      assert.equal(Lunar.solarTerm(year, r[0], r[1]), NAMES[i]);
    });
  });
});

test('节气：靠近子夜的几个（2027 霜降 23:33、立冬 23:39）归到当天', () => {
  assert.equal(Lunar.solarTerm(2027, 10, 23), '霜降');
  assert.equal(Lunar.solarTerm(2027, 10, 24), '');
  assert.equal(Lunar.solarTerm(2027, 11, 7), '立冬');
  assert.equal(Lunar.solarTerm(2027, 11, 8), '');
  assert.equal(Lunar.solarTerm(2026, 6, 5), '芒种'); // 23:48
});

test('节气：1900–2100 每年 24 个，顺序对、间隔对，二分二至不跑出常见范围', () => {
  const inRange = (t, m, d0, d1) => t.month === m && t.day >= d0 && t.day <= d1;
  for (let y = 1900; y <= 2100; y += 1) {
    const ts = Lunar.termsOfYear(y);
    assert.equal(ts.length, 24, String(y));
    let prev = null;
    ts.forEach((t, i) => {
      assert.equal(t.name, NAMES[i]);
      const at = Date.UTC(y, t.month - 1, t.day, t.hour, t.minute);
      if (prev !== null) {
        const gap = (at - prev) / 864e5;
        assert.ok(gap > 14.3 && gap < 16.6, y + t.name + ' 间隔 ' + gap);
      }
      prev = at;
    });
    assert.ok(inRange(ts[2], 2, 3, 5), y + ' 立春');
    assert.ok(inRange(ts[5], 3, 19, 22), y + ' 春分');
    assert.ok(inRange(ts[11], 6, 20, 22), y + ' 夏至');
    assert.ok(inRange(ts[17], 9, 22, 24), y + ' 秋分');
    assert.ok(inRange(ts[23], 12, 21, 23), y + ' 冬至');
  }
});

test('节气：一年里只有 24 天有节气，平常的日子没有', () => {
  let n = 0;
  for (let d = dayNo(2026, 1, 1); d <= dayNo(2026, 12, 31); d += 1) if (Lunar.solarTerm(...ymd(isoOf(d)))) n += 1;
  assert.equal(n, 24);
  assert.equal(Lunar.solarTerm(2026, 3, 10), '');
});

// ---------- 节日 ----------

test('节日：农历节日、公历节日、除夕', () => {
  const f = (iso) => Lunar.festival(...ymd(iso));
  assert.equal(f('2027-02-06'), '春节');
  assert.equal(f('2027-02-05'), '除夕');
  assert.equal(f('2026-02-16'), '除夕');
  assert.equal(f('2030-02-02'), '除夕'); // 腊月三十
  assert.equal(f('2027-02-20'), '元宵');
  assert.equal(f('2026-06-19'), '端午');
  assert.equal(f('2025-05-31'), '端午');
  assert.equal(f('2026-08-19'), '七夕');
  assert.equal(f('2026-09-25'), '中秋');
  assert.equal(f('2027-09-15'), '中秋');
  assert.equal(f('2026-10-18'), '重阳');
  assert.equal(f('2026-01-01'), '元旦');
  assert.equal(f('2026-05-01'), '劳动节');
  assert.equal(f('2026-10-01'), '国庆节');
  assert.equal(f('2026-03-10'), '');
  // 闰月里的初五不是端午
  assert.equal(Lunar.solarToLunar(2025, 7, 29).text, '闰六月初五');
  assert.equal(f('2025-07-29'), '');
});

test('显示用的一小段：节日 > 节气 > 初一的月名 > 日名', () => {
  const sub = (iso) => Lunar.info(...ymd(iso)).sub;
  const kind = (iso) => Lunar.info(...ymd(iso)).kind;
  assert.equal(sub('2027-02-06'), '春节');
  assert.equal(kind('2027-02-06'), 'festival');
  assert.equal(sub('2026-11-22'), '小雪'); // 十月十四，有节气没节日
  assert.equal(kind('2026-11-22'), 'term');
  assert.equal(sub('2026-04-05'), '清明');
  assert.equal(sub('2026-12-09'), '冬月'); // 冬月初一
  assert.equal(kind('2026-12-09'), 'month');
  assert.equal(sub('2025-07-25'), '闰六月');
  assert.equal(sub('2026-11-10'), '初二'); // 十月初二
  assert.equal(kind('2026-11-10'), 'day');
  assert.equal(sub('2026-10-01'), '国庆节');
});

test('显示用的整段：header 里用的“十月初六”', () => {
  assert.equal(Lunar.info(2026, 11, 14).lunar, '十月初六');
  assert.equal(Lunar.info(2025, 7, 25).lunar, '闰六月初一');
  assert.equal(Lunar.info(1899, 12, 31).lunar, '');
  assert.equal(Lunar.info(2101, 1, 29).lunar, '');
  // 超出农历表的年份：仍然给节气、公历节日，不报错
  assert.equal(Lunar.info(2101, 1, 1).sub, '元旦');
});

// ---------- 法定节假日与调休 ----------

// [名称, 起, 止, 通知里写的天数]
const OFF = {
  2025: [['元旦', '2025-01-01', '2025-01-01', 1], ['春节', '2025-01-28', '2025-02-04', 8], ['清明节', '2025-04-04', '2025-04-06', 3], ['劳动节', '2025-05-01', '2025-05-05', 5], ['端午节', '2025-05-31', '2025-06-02', 3], ['国庆节、中秋节', '2025-10-01', '2025-10-08', 8]],
  2026: [['元旦', '2026-01-01', '2026-01-03', 3], ['春节', '2026-02-15', '2026-02-23', 9], ['清明节', '2026-04-04', '2026-04-06', 3], ['劳动节', '2026-05-01', '2026-05-05', 5], ['端午节', '2026-06-19', '2026-06-21', 3], ['中秋节', '2026-09-25', '2026-09-27', 3], ['国庆节', '2026-10-01', '2026-10-07', 7]],
  2027: [['元旦', '2027-01-01', '2027-01-03', 3], ['春节', '2027-02-05', '2027-02-13', 9], ['清明节', '2027-04-03', '2027-04-05', 3], ['劳动节', '2027-05-01', '2027-05-05', 5], ['端午节', '2027-06-09', '2027-06-09', 1], ['中秋节', '2027-09-15', '2027-09-15', 1], ['国庆节', '2027-10-01', '2027-10-07', 7]],
};
const WORK = {
  2025: ['2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11'],
  2026: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10'],
  2027: ['2027-01-31', '2027-02-14', '2027-05-08', '2027-09-26', '2027-10-09'],
};

Object.keys(OFF).forEach((year) => {
  test(year + ' 年休班表和国务院通知一致', () => {
    Lunar.setHolidays(null);
    const want = {};
    OFF[year].forEach(([name, from, to, days]) => {
      assert.equal(dayNo(...ymd(to)) - dayNo(...ymd(from)) + 1, days, name + ' 天数');
      for (let d = dayNo(...ymd(from)); d <= dayNo(...ymd(to)); d += 1) want[isoOf(d)] = 'off';
    });
    WORK[year].forEach((iso) => { want[iso] = 'work'; });
    // 整年扫一遍：表里写了的才有角标，没写的都没有
    for (let d = dayNo(Number(year), 1, 1); d <= dayNo(Number(year), 12, 31); d += 1) {
      const iso = isoOf(d);
      assert.equal(Lunar.holiday(...ymd(iso)), want[iso] || '', iso);
    }
    // 补班的都是周末，放假里没有写错成非工作日的“班”
    WORK[year].forEach((iso) => { const w = new Date(iso + 'T00:00:00Z').getUTCDay(); assert.ok(w === 0 || w === 6, iso); });
  });
});

test('休班表以外的年份没有角标', () => {
  Lunar.setHolidays(null);
  assert.equal(Lunar.holiday(2024, 10, 1), '');
  assert.equal(Lunar.holiday(2028, 1, 1), '');
});

test('holidays.json 覆盖：写了的日期优先，坏内容不报错', () => {
  Lunar.setHolidays(null);
  assert.equal(Lunar.holiday(2028, 1, 1), '');
  // 补充 2028 年，并改一天
  const n = Lunar.setHolidays('{"off":["2028-01-01","2028-01-26..2028-02-01"],"work":["2028-01-22","2026-10-01"]}');
  assert.equal(n, 10);
  assert.equal(Lunar.holiday(2028, 1, 1), 'off');
  assert.equal(Lunar.holiday(2028, 1, 29), 'off');
  assert.equal(Lunar.holiday(2028, 2, 2), '');
  assert.equal(Lunar.holiday(2028, 1, 22), 'work');
  assert.equal(Lunar.holiday(2026, 10, 1), 'work');   // 压过内置的“休”
  assert.equal(Lunar.holiday(2026, 10, 2), 'off');    // 没提到的仍用内置
  // 带 BOM 的文件（记事本另存为 UTF-8 时会有）
  assert.equal(Lunar.setHolidays('﻿{"off":["2029-01-01"]}'), 1);
  assert.equal(Lunar.holiday(2029, 1, 1), 'off');
  assert.equal(Lunar.holiday(2028, 1, 1), '');        // 每次是整份替换，不累加
  // 坏内容：不报错、当作没有
  assert.equal(Lunar.setHolidays('{坏的'), 0);
  assert.equal(Lunar.setHolidays('[1,2]'), 0);
  assert.equal(Lunar.setHolidays({ off: ['不是日期', '2030-02-30', 5, '2030-03-01..2030-01-01'], work: 'x' }), 0);
  // 范围太长（手滑）直接忽略
  assert.equal(Lunar.setHolidays({ off: ['2030-01-01..2031-12-31'] }), 0);
  assert.equal(Lunar.holiday(2026, 10, 1), 'off');
  Lunar.setHolidays(null);
});

test('info 里带休班标记', () => {
  Lunar.setHolidays(null);
  assert.equal(Lunar.info(2026, 2, 14).hol, 'work');
  assert.equal(Lunar.info(2026, 2, 17).hol, 'off');
  assert.equal(Lunar.info(2026, 3, 10).hol, '');
});
