# 开发笔记

给接手的人（包括新开的对话）看：先读这一页，再读 README 的“目录”一节，就能接着改。

## 一句话

今笺是 Windows 上贴在桌面右上角的玻璃便笺（日程、待办、便签），Tauri 2（Rust 外壳）+ 原生 HTML/CSS/JS，没有前端框架，也没有构建步骤。个人自用，不做商业用途。推送到 `main` 后 GitHub Actions 在云端打包，安装包发在 Releases（tag 是 `build-N`）。

## 改界面时要守的规矩（都是使用者明确说过的）

- 界面上不放多余的解释文字（“AI 味”）；需要说明的地方用 `?` / 悬停提示。
- 液态玻璃风格；壁纸是 macOS Sierra 的山，小组件放右上角。
- 动画用贝塞尔曲线（`--curve`），展开后的视图不要回弹，只有勾选时可以有一点点弹。
- 月视图展开后约占屏幕宽的 1/2、高的 2/3；一周从周日开始。
- 日程气泡要紧凑；设置和详情面板在玻璃很透时也要留一层看得清的底。
- 新配色只能“加选项”，不能替换原来的（0.6.0 加石墨灰时就是这么做的）。
- 不做番茄钟；主窗口是透明窗口，不要给整个窗口套系统亚克力 / Mica。

## 怎么测

```
npm test                         # 日期识别 + 日历解析，纯 Node，1 秒内跑完；CI 里先跑它
python3 tests/ui/ui8.py          # 界面测试，需要 Playwright（Python），不在 CI 里跑
```

- `tests/run.js` 会把 `TZ` 设成 `Asia/Shanghai` 再启动 `node --test`（期望值按上海时间写）。
- `tests/ui/*.py` 用 Playwright 打开 `src/index.html`，`mock_cn.js` 假装成 Tauri 外壳和一个假的 iCloud。截图写到 `tests/ui/shots/`（不入库）。`ui3`–`ui8` 对应 0.3–0.6 各版本的改动，改到相关功能时一起跑。
- 修 bug 的习惯：先写一个在旧代码上会失败的测试，再改，再确认它变绿。
- Rust 部分本地只能 `rustfmt` 查语法，真正编译要看 CI。

## 发布

1. 改版本号三处：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`。
2. 更新 README 里对应的功能说明。
3. 推到 `main`，等 CI 的 `test` 和 `windows` 两个任务都绿，Releases 里出现新的 `build-N`。

## 关键机制（改相关代码前先看）

- **鼠标穿透**：前端把“有东西的区域”报给外壳（`set_hit_rects`），Rust 里 40 ms 一轮的线程决定是否 `set_ignore_cursor_events`。新增会弹出的东西，要记得把它的矩形也报上去。
- **玻璃**：系统壁纸（`TranscodedWallpaper`）画在每块 `.glass::before` 里再模糊；`--glass`（0–1）、`--tint`、`--halo`、`--solidify` 都由 `applyGlass()` 算出来；文字深浅（`data-ink`）按壁纸平均色和玻璃覆盖度自动选。配色（`data-palette`）只换玻璃底色、投影和深色字的色调，`applyGlass()` 里的 `VEIL` 要和 `style.css` 里各配色的 `--bg` 保持一致。
- **Win+D**：`desk.rs`。Windows 11 24H2 及以后把小组件挂在桌面窗口名下；更早的系统发现被盖住就立刻提回来。
- **数据**：`%APPDATA%\com.zekaikevin.jinjian\data.json`；写盘是“临时文件 → 落盘 → 替换”，退出前先让页面把没存的写完（`flush` 事件 ↔ `flush_done` 命令）。
- **iCloud**：`caldav.js` 负责对话，`ics.js` 负责日历文本；密码在 Windows 凭据管理器里；`dav` 命令只允许访问 `icloud.com` / `icloud.com.cn`。上传带 `If-Match`，失败会按 5 秒 / 30 秒 / 2 分钟 / 10 分钟重试。
- **只开一个实例**：`tauri-plugin-single-instance` 要最先注册；再次启动时让已开着的那个展开并通知。

## 还没在真机上验证的（只在模拟环境里测过）

Win+D 的行为、单实例的第二次启动、退出前保存、始终置顶切换、锁图标、系统通知。装上后如果哪个不对，先看这些。

## 路线

- 0.6.0（当前）：解析错误修复（截止词、小数小时、不存在的日期、十点零五、跨午夜）、测试入库并接 CI、石墨灰配色。
- 0.7.0：农历 / 24 节气 / 法定休班角标；本机日程和待办的重复；Ctrl+F 全局搜索；顶部倒数日条。
- 0.8.0：可拖拽排期的周视图；桌面四角停靠 + 拖边改宽。

暂时没做、也没被要求做：多服务器 CalDAV / .ics 订阅、壁纸模式、多页便签、导出、Rust 拆模块。真要做订阅时，再补访问地址的安全限制（现在 `dav` 只放行 iCloud，所以不需要）。
