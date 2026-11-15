// 随手记的一句话解析：日期、时间段、标题的拆分。
// 基准时间固定为 2026-11-10（周二）14:48，下面的期望值都按它算。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuick } = require('../src/nlp.js');

const base = new Date(2026, 10, 10, 14, 48);
const q = (s, b) => { const r = parseQuick(s, b || base); return [r.title, r.date, r.time, r.endTime]; };

test('常见说法', () => {
  const cases = [
    ['明天下午3点 给导师发复盘初稿', ['给导师发复盘初稿', '2026-11-11', '15:00', '']],
    ['周五晚上8点半 朋友聚餐', ['朋友聚餐', '2026-11-13', '20:30', '']],
    ['下周三 10:30 组会', ['组会', '2026-11-18', '10:30', '']],
    ['周二交作业', ['交作业', '2026-11-10', '', '']],
    ['12月3号 考试', ['考试', '2026-12-03', '', '']],
    ['今晚7点 健身', ['健身', '2026-11-10', '19:00', '']],
    ['给猫买粮', ['给猫买粮', '', '', '']],
    ['18点 开会', ['开会', '', '18:00', '']],
    ['15号交房租', ['交房租', '2026-11-15', '', '']],
    ['3号 交房租', ['交房租', '2026-12-03', '', '']],
    ['这周日 大扫除', ['大扫除', '2026-11-15', '', '']],
    ['本周一 补交', ['补交', '2026-11-09', '', '']],
    ['下个周一 例会', ['例会', '2026-11-16', '', '']],
    ['明天上午十点十五 体检', ['体检', '2026-11-11', '10:15', '']],
    ['两点 开会', ['开会', '', '14:00', '']],
    ['中午1点 吃饭', ['吃饭', '', '13:00', '']],
    ['凌晨12点 跨年', ['跨年', '', '00:00', '']],
    ['夜里2点 起来看球', ['起来看球', '', '02:00', '']],
    ['3点一刻 喝茶', ['喝茶', '', '15:15', '']],
    ['02:30 起床看比赛', ['起床看比赛', '', '02:30', '']],
    ['6点 起床', ['起床', '', '06:00', '']],
  ];
  cases.forEach(([s, want]) => assert.deepEqual(q(s), want, s));
});

test('不是日期、不是时间的“号”“点”', () => {
  ['买5号电池', '去3号楼拿快递', '地铁5号线换乘', '有一点小事', '提两点意见', '第3号楼 看房', '买5号南孚电池']
    .forEach((s) => assert.deepEqual(q(s), [s, '', '', ''], s));
});

test('时间段', () => {
  assert.deepEqual(q('9点半至11点 上课'), ['上课', '', '09:30', '11:00']);
  assert.deepEqual(q('11点到1点 午休'), ['午休', '', '11:00', '13:00']);
  assert.deepEqual(q('明天下午2点到4点 开会'), ['开会', '2026-11-11', '14:00', '16:00']);
  assert.deepEqual(q('14:00-15:30 需求评审'), ['需求评审', '', '14:00', '15:30']);
});

test('相对时间', () => {
  assert.deepEqual(q('30分钟后 喝水'), ['喝水', '2026-11-10', '15:18', '']);
  assert.deepEqual(q('半小时后 出门'), ['出门', '2026-11-10', '15:18', '']);
  assert.deepEqual(q('2个小时后 回电话'), ['回电话', '2026-11-10', '16:48', '']);
  assert.deepEqual(q('3天后 交论文'), ['交论文', '2026-11-13', '', '']);
});

test('小数和“一个半”小时', () => {
  assert.deepEqual(q('1.5小时后 开会'), ['开会', '2026-11-10', '16:18', '']);
  assert.deepEqual(q('一个半小时后 开会'), ['开会', '2026-11-10', '16:18', '']);
  assert.deepEqual(q('2个半小时后 开会'), ['开会', '2026-11-10', '17:18', '']);
  assert.deepEqual(q('0.5小时后 开会'), ['开会', '2026-11-10', '15:18', '']);
});

test('截止词：“前”“之前”“截止”不留在标题里，并标记为截止', () => {
  const t = parseQuick('下午3点前 交周报', base);
  assert.deepEqual([t.title, t.date, t.time, t.isDeadline], ['交周报', '', '15:00', true]);
  const d = parseQuick('交房租 25号前', base);
  assert.deepEqual([d.title, d.date, d.isDeadline], ['交房租', '2026-11-25', true]);
  assert.deepEqual(q('周五之前 交报告'), ['交报告', '2026-11-13', '', '']);
  assert.equal(parseQuick('周五之前 交报告', base).isDeadline, true);
  assert.equal(parseQuick('明天截止 提交申请', base).title, '提交申请');
  assert.equal(parseQuick('3点前交周报', base).title, '交周报');
  // 没写截止词就不是截止
  assert.equal(parseQuick('下午3点 开会', base).isDeadline, false);
});

test('“前”是别的词的开头时不当截止词', () => {
  assert.equal(parseQuick('下午3点前往机场', base).title, '前往机场');
  assert.equal(parseQuick('下午3点前往机场', base).isDeadline, false);
  assert.equal(parseQuick('周五前台报到', base).title, '前台报到');
});

test('不存在的日期不会悄悄滚到下个月', () => {
  ['13月40号 聚餐', '2月30号 聚餐', '4月31号 聚餐'].forEach((s) => assert.deepEqual(q(s), [s, '', '', ''], s));
  // 2 月 29 号往后找最近的闰年
  assert.equal(parseQuick('2月29号 生日', base).date, '2028-02-29');
  // 只写“31号”，这个月没有就找下一个有 31 号的月
  assert.equal(parseQuick('31号 交报表', new Date(2026, 10, 10)).date, '2026-12-31');
  assert.equal(parseQuick('31号 交报表', new Date(2026, 3, 10)).date, '2026-05-31');
});

test('中文数字：十点零五、十点五十', () => {
  assert.deepEqual(q('十点零五 吃药'), ['吃药', '', '10:05', '']);
  assert.deepEqual(q('晚上十点零五分 吃药'), ['吃药', '', '22:05', '']);
  assert.deepEqual(q('九点五十 开会'), ['开会', '', '09:50', '']);
});

test('跨午夜的时间段', () => {
  const a = parseQuick('晚上11点到凌晨1点 赶稿', base);
  assert.deepEqual([a.title, a.time, a.endTime, a.endNextDay], ['赶稿', '23:00', '01:00', true]);
  const b = parseQuick('晚上11点到1点 赶稿', base);
  assert.deepEqual([b.time, b.endTime, b.endNextDay], ['23:00', '01:00', true]);
  const c = parseQuick('22:00-02:00 值班', base);
  assert.deepEqual([c.time, c.endTime, c.endNextDay], ['22:00', '02:00', true]);
  // 同一天里的不算跨午夜
  assert.equal(parseQuick('明天下午2点到4点 开会', base).endNextDay, false);
});
