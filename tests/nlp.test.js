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

// ---------- 0.9.0：NLP 2.0 ----------

test('0.8.2 认不出来的日期：2026-11-20、2026/11/20、周末、带年份的“2026年12月5号”', () => {
  assert.deepEqual(q('2026-11-20 交报告'), ['交报告', '2026-11-20', '', '']);
  assert.deepEqual(q('2026/11/20 交报告'), ['交报告', '2026-11-20', '', '']);
  assert.deepEqual(q('2026.11.20 交报告'), ['交报告', '2026-11-20', '', '']);
  assert.deepEqual(q('交报告 2026-1-5'), ['交报告', '2026-01-05', '', '']);
  assert.deepEqual(q('2026年12月5号 考试'), ['考试', '2026-12-05', '', '']);
  assert.deepEqual(q('2027年1月3日下午2点 答辩'), ['答辩', '2027-01-03', '14:00', '']);
  assert.deepEqual(q('周末 大扫除'), ['大扫除', '2026-11-14', '', '']);
  assert.deepEqual(q('这周末 大扫除'), ['大扫除', '2026-11-14', '', '']);
  assert.deepEqual(q('下周末 爬山'), ['爬山', '2026-11-21', '', '']);
  // 今天就是周末：周六、周日说“周末”都是今天
  assert.equal(parseQuick('周末 大扫除', new Date(2026, 10, 14, 9, 0)).date, '2026-11-14');
  assert.equal(parseQuick('周末 大扫除', new Date(2026, 10, 15, 9, 0)).date, '2026-11-15');
  // “周日 周末复盘”里的日期是周日，“周末”是标题
  assert.deepEqual(q('周日 周末复盘'), ['周末复盘', '2026-11-15', '', '']);
  // 写全了的日期后面跟时间段，不会被当成时间
  assert.deepEqual(q('2026-11-20 14:00-15:30 评审'), ['评审', '2026-11-20', '14:00', '15:30']);
});

test('写全了却不存在的日期：不当日期，也不退回去认后半截', () => {
  ['2026-02-30 聚餐', '2026年2月30号 聚餐', '2026/13/01 聚餐'].forEach((s) => assert.deepEqual(q(s), [s, '', '', ''], s));
  // 版本号、电话这类带横线的数字不是日期
  ['装 3.11.2 的包', '打 010-12345678 问问'].forEach((s) => assert.deepEqual(q(s), [s, '', '', ''], s));
});

test('toMinutes：下午 12 点是正午，晚上 1 点是后半夜', () => {
  assert.deepEqual(q('下午12点 吃饭'), ['吃饭', '', '12:00', '']);
  assert.deepEqual(q('下午12点半 吃饭'), ['吃饭', '', '12:30', '']);
  assert.deepEqual(q('晚上1点 看球'), ['看球', '', '01:00', '']);
  assert.deepEqual(q('晚上4点 看球'), ['看球', '', '04:00', '']);
  // 没变的：晚上 12 点记成 23:59，晚上 8 点是 20 点，下午 1 点是 13 点，中午 12 点是 12 点
  assert.deepEqual(q('晚上12点 跨年'), ['跨年', '', '23:59', '']);
  assert.deepEqual(q('晚上8点 聚餐'), ['聚餐', '', '20:00', '']);
  assert.deepEqual(q('下午1点 开会'), ['开会', '', '13:00', '']);
  assert.deepEqual(q('中午12点 吃饭'), ['吃饭', '', '12:00', '']);
});

const full = (s, off) => { const r = parseQuick(s, base, off); return [r.title, r.date, r.time, r.endTime, r.rrule, r.repeatLabel, r.place]; };

test('一句话同时拆出重复、日期、起止时间、地点、标题', () => {
  assert.deepEqual(full('每周二四 18:00-19:30 立德407 机器学习'), ['机器学习', '2026-11-10', '18:00', '19:30', 'FREQ=WEEKLY;BYDAY=TU,TH', '每周二、四', '立德407']);
  assert.deepEqual(full('每周一、三、五 早上7点 晨跑'), ['晨跑', '2026-11-11', '07:00', '', 'FREQ=WEEKLY;BYDAY=MO,WE,FR', '每周一、三、五', '']);
  assert.deepEqual(full('每周二和周四 下午3点 在图书馆 自习'), ['自习', '2026-11-10', '15:00', '', 'FREQ=WEEKLY;BYDAY=TU,TH', '每周二、四', '图书馆']);
  assert.deepEqual(full('每天早上8点 吃药'), ['吃药', '2026-11-10', '08:00', '', 'FREQ=DAILY', '每天', '']);
  assert.deepEqual(full('每个工作日 9点 站会'), ['站会', '2026-11-10', '09:00', '', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '工作日', '']);
  assert.deepEqual(full('每周末 大扫除'), ['大扫除', '2026-11-14', '', '', 'FREQ=WEEKLY;BYDAY=SA,SU', '每周末', '']);
  assert.deepEqual(full('每月15号 交房租'), ['交房租', '2026-11-15', '', '', 'FREQ=MONTHLY', '每月15日', '']);
  assert.deepEqual(full('每年5月20日 纪念日'), ['纪念日', '2027-05-20', '', '', 'FREQ=YEARLY', '每年5月20日', '']);
  assert.deepEqual(full('2026.11.20 14:00-15:30 明商208 答辩'), ['答辩', '2026-11-20', '14:00', '15:30', '', '', '明商208']);
  // 另写了日期的以写的为准
  assert.deepEqual(full('每周二四 11月17日 18:00 课'), ['课', '2026-11-17', '18:00', '', 'FREQ=WEEKLY;BYDAY=TU,TH', '每周二、四', '']);
  // “每周”没说周几：日期留空，调用方按当前看的那天算
  assert.deepEqual(full('每周 例会'), ['例会', '', '', '', 'FREQ=WEEKLY', '每周', '']);
});

test('容易认错的：“每周二四点”的四是四点；“在线会议”“高数”不是地点', () => {
  assert.deepEqual(full('每周二四点 开会'), ['开会', '2026-11-10', '16:00', '', 'FREQ=WEEKLY;BYDAY=TU', '每周二', '']);
  assert.deepEqual(full('明天下午2点 在线会议'), ['在线会议', '2026-11-11', '14:00', '', '', '', '']);
  assert.deepEqual(full('立德407'), ['立德407', '', '', '', '', '', '']);           // 只有一个词：它就是标题
  assert.deepEqual(full('复习高数 第3章'), ['复习高数 第3章', '', '', '', '', '', '']);
  assert.equal(parseQuick('每周五前 交周报', base).isDeadline, true);
  assert.equal(parseQuick('每周五前 交周报', base).title, '交周报');
});

test('关掉某一类识别：那一段原样留在标题里（点掉预览里的小胶囊）', () => {
  const s = '每周二四 18:00-19:30 立德407 机器学习';
  assert.deepEqual(full(s, { repeat: true }), ['每周二四 机器学习', '', '18:00', '19:30', '', '', '立德407']);
  assert.deepEqual(full(s, { time: true }), ['18:00-19:30 机器学习', '2026-11-10', '', '', 'FREQ=WEEKLY;BYDAY=TU,TH', '每周二、四', '立德407']);
  assert.deepEqual(full(s, { place: true }), ['立德407 机器学习', '2026-11-10', '18:00', '19:30', 'FREQ=WEEKLY;BYDAY=TU,TH', '每周二、四', '']);
  assert.deepEqual(full(s, { date: true }), ['机器学习', '', '18:00', '19:30', 'FREQ=WEEKLY;BYDAY=TU,TH', '每周二、四', '立德407']);
  assert.deepEqual(full('明天下午3点 开会', { date: true }), ['明天 开会', '', '15:00', '', '', '', '']);
  assert.deepEqual(full('30分钟后 喝水', { time: true }), ['30分钟后 喝水', '', '', '', '', '', '']);
  // 老的调用方式（不传第三个参数）不受影响
  assert.deepEqual(q('明天下午2点到4点 开会'), ['开会', '2026-11-11', '14:00', '16:00']);
});
