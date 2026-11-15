// 跑全部测试：node tests/run.js（或 npm test）。
// 时区相关的期望值按上海时间写，这里把 TZ 设好再启动，Windows 上也不用手动设环境变量。
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(__dirname, f));
const r = spawnSync(process.execPath, ['--test'].concat(files), { stdio: 'inherit', env: Object.assign({}, process.env, { TZ: 'Asia/Shanghai' }) });
process.exit(r.status === null ? 1 : r.status);
