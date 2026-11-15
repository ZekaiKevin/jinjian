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
npm test                         # 日期识别、日历解析、农历、搜索、倒数日、重复、周视图的计算，纯 Node，几秒内跑完；CI 里先跑它
python3 tests/ui/ui12.py         # 界面测试，需要 Playwright（Python），不在 CI 里跑
```

- `tests/run.js` 会把 `TZ` 设成 `Asia/Shanghai` 再启动 `node --test`（期望值按上海时间写）。
- `tests/ui/*.py` 用 Playwright 打开 `src/index.html`，`mock_cn.js` 假装成 Tauri 外壳和一个假的 iCloud。截图写到 `tests/ui/shots/`（不入库）。`ui3`–`ui8` 对应 0.3–0.6 各版本的改动，`ui9`（农历 / 休班）、`ui10`（Ctrl+F 搜索）、`ui11`（倒数日）是 0.7.0 的，`ui12`（本机重复）、`ui13`（重复和 iCloud）是 0.7.1 的，`ui14`（周视图和拖拽，用真实的鼠标按下 / 移动 / 松开）是 0.8.0 的，改到相关功能时一起跑。`ui14` 里的日期都按“跑测试那天所在的那一周”算（`D(i)` 是那一周的第 i 天），拖之前先用 `w.scroll(小时)` 把时间轴滚到固定位置。Playwright 不肯点 `aria-disabled` 的按钮，置灰的选项用 `pg.mouse.click(坐标)` 点。`tests/fixtures/data-0.7.0.json` 是一份 0.7.0 的数据文件，`recur.test.js` 和 `ui12` 用它确认旧数据原样读写。界面测试里的“今天”是跑测试那天，要固定日期的断言都用 `S.date = ...; render()` 跳到具体日子，别依赖今天。
- 修 bug 的习惯：先写一个在旧代码上会失败的测试，再改，再确认它变绿。
- Rust 部分本地只能 `rustfmt` 查语法，真正编译要看 CI。

## 发布

1. 改版本号三处：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`。
2. 更新 README 里对应的功能说明。
3. 推到 `main`，等 CI 的 `test` 和 `windows` 两个任务都绿，Releases 里出现新的 `build-N`。

## 关键机制（改相关代码前先看）

- **鼠标穿透**：前端把“有东西的区域”报给外壳（`set_hit_rects`），Rust 里 40 ms 一轮的线程决定是否 `set_ignore_cursor_events`。新增会弹出的东西，要记得把它的矩形也报上去。拖动时另有一个“保持可点击”的状态（`set_hit_hold`，0.8.0）：`Hit.hold` 记着最近一次报“按下”的时刻，这期间光标在窗口哪里都当作落在玻璃上（用户开了“鼠标穿透”时不管）；前端 `holdHit(true/false)` 在周视图里按下和松开（含 Esc、失焦、`pointercancel`）时各报一次，拖着时每 5 秒续一次，Rust 那边 30 秒没续就自己放开（`HOLD_MAX`），免得页面卡死后整块透明窗口一直挡着桌面。
- **玻璃**：系统壁纸（`TranscodedWallpaper`）画在每块 `.glass::before` 里再模糊；`--glass`（0–1）、`--tint`、`--halo`、`--solidify` 都由 `applyGlass()` 算出来；文字深浅（`data-ink`）按壁纸平均色和玻璃覆盖度自动选。配色（`data-palette`）只换玻璃底色、投影和深色字的色调，`applyGlass()` 里的 `VEIL` 要和 `style.css` 里各配色的 `--bg` 保持一致。
- **Win+D**：`desk.rs`。Windows 11 24H2 及以后把小组件挂在桌面窗口名下；更早的系统发现被盖住就立刻提回来。
- **数据**：`%APPDATA%\com.zekaikevin.jinjian\data.json`；写盘是“临时文件 → 落盘 → 替换”，退出前先让页面把没存的写完（`flush` 事件 ↔ `flush_done` 命令）。
- **iCloud**：`caldav.js` 负责对话，`ics.js` 负责日历文本；密码在 Windows 凭据管理器里；`dav` 命令只允许访问 `icloud.com` / `icloud.com.cn`。上传带 `If-Match`，失败会按 5 秒 / 30 秒 / 2 分钟 / 10 分钟重试。
- **农历 / 休班**：`lunar.js` 里的农历表是 B36（1900–2100，和 ICU 只有 9 个年份被刻意修正：1954、1955、1999、2012、2018、2027、2030、2057、2070，以这张表为准，`tests/lunar.test.js` 里逐年锁着）；24 节气是算出来的，不是查表。休班表 `BUILTIN` 目前是 2025–2027，每年国务院办公厅的放假通知出来后要补下一年（或者让使用者用数据目录里的 `holidays.json` 覆盖，启动时 `get_holidays` 命令读、`Lunar.setHolidays` 解析，写坏了会被忽略）。设置里 `lunar` 管农历文字，`hol` 管休 / 班角标，两个都在 `renderHeader` / `renderCal` / `renderBig` 里读。
- **搜索层**：`#search` 是 `#shell` 里和 `#widget`、`#big` 同级的一层（`S.search`），打开时先收详情 / 设置 / 小窗口、把迷你条展开，`S.searchBack` 记着打开前的状态，Esc 关掉时退回去；点结果跳转时不退回（`closeSearch(false)`）。输入法：组字时不搜，`compositionend` 才搜，Enter / Esc / 方向键在 `isComposing`、`keyCode 229` 或 `composing` 标志为真时一律不处理。iCloud 的重复日程每个系列只留离今天最近的一场（`search.js` 里按 `href` 去重）。
- **倒数日**：本机条目上的 `countdown: true`；iCloud 条目的标记存在 `S.extras[id].countdown`（和子任务一样只在本机，`updateItem` 的远程分支处理，`rebuildRemote` 复制回条目）。顶部 `#countdowns` 在 `#widget` 的 `<header>` 和 `.views` 之间，没有倒数日时是 `hidden`（不占位置、不写字）；折叠日历的卡片高度在 `applyMode` 里加上它的高度。
- **重复（本机）**：`src/recur.js`，纯函数。一个系列在 `S.items` 里只有一条主条目，多出的字段都是可选的：`rrule`（标准 RRULE 文本）、`lunar`（只认 `FREQ=YEARLY`）、`exdates`（删掉的那几次，按原日期）、`overrides`（单独改过的那几次，按原日期，只放改过的字段，挪了日期就是 `date`）、`doneDates`（重复待办每一次的完成）。公历规则全交给 `ics.js` 的 `parseRRule` / `expand`（按全天展开，只取日期），农历按 `lunar.js` 换算。画面上用的是场次：`render()` 开头 `rebuildLocal()` 把今天前 62 天到后 400 天、正在看的月份、正在看的那天展开到 `L`；场次的 id 是 `主条目id@原日期`，`find()` 找不到普通条目时用 `Recur.get` 现拼，所以窗口外的那一次也找得到。主条目本身不进 `byDate` / 列表（`plainItems()` 把它们滤掉）。
  - 详情里的改动都走 `change(it, patch, anchor)`：是系列里的一场、这一场还没选过范围，就把改动先放进 `S.ask`、弹 `#scope` 小气泡（在 `#panel` 里，矩形另报给 `set_hit_rects`）；选了以后 `updateItem(it, patch, scope)` → `Recur.edit`，选过的范围记在 `S.scopeMem`，同一场接着改不再问（“此次及以后”拆出新系列后，之后的改动算新系列的“全部”）。Esc、关详情、换条目都算没选，改动丢掉、详情按数据重填。完成状态、重点、倒数日、类型是整个系列的，不问。改重复规则本身（`applyRule` → `Recur.setRule`）也不问；结束日期早于开始、次数让它一场都不剩的，退回原样。
  - `rollOver`、“移到今天”、“之前没做完”都跳过重复的待办；搜索把展开过的场次和 `Recur.nearest` 一起交给 `search.js`，按 `masterId` 每个系列留一条；倒数日用 `Recur.next`（待办跳过已完成的那一次）。
- **重复（iCloud）**：iCloud 重复日程的场次 id 按“原来那一场”记（`ics.js` 展开时给每一场带上 `rid` / `ridKey`），单独改过时间 id 也不变；0.7.0 按改后时间记的那几场，`rebuildRemote` 会把附加内容挪到新 id 上。改：仅此次 → `ICS.setOccurrence`（已有那一块就改它，没有就新加一块、照抄主事件的提醒）；全部 → `ICS.patchSeries`，只改标题、地点、备注、提醒，单独改过的场次里和原来一样的那几项跟着改。删：仅此次 → `ICS.exclude`（EXDATE 的写法跟着这一场原来的开始时间），此次及以后 → `ICS.endBefore`（有次数的改次数，被删的场次也算），全部或从第一场删以后 → 删整条。“此次及以后”的修改、按“全部”改时间 / 日期没做，气泡里置灰（`aria-disabled`，悬停提示），选过“全部”后再改时间会重新问。本机的重复日程选了日历后由 `uploadPending` 整份上传（`Recur.forUpload` → `ICS.buildSeries`）：开始时间写 `TZID=本机时区` 并带一段 `VTIMEZONE`，结束日期换成当天 23:59:59 的 UTC。不写 UTC 是因为早上 8 点前的“每周一”在 UTC 里是周日，BYDAY 按 UTC 算会落到周二（`recur-sync.test.js` 里锁着）。有夏令时的时区不传（`localTz()` 返回 null）；农历和待办不传，农历日程在详情里有“只存本机”的小图标。传上去后本机这条删掉，子任务和倒数日标记挂到下一场上。
- **周视图**（0.8.0）：`S.week` 为真时 `#big` 里显示 `#week`、藏起月视图的格子，外壳大小、展开动画都还是 `#big` 那一套（`applyMode` 没动）；看哪一周由 `S.date` 定（`Week.weekKeys`，周日起），切过去时落在哪天用 `Week.anchor`；“上 / 下一个”在周视图里是 `shiftWeek`。`S.week` 只在这次运行里记着，不写进设置。
  - 计算全在 `src/week.js`（纯函数，`tests/week.test.js`）：`layout` 把连着重叠的日程分成一簇、簇里贪心分栏、右边没人就向右撑；`minToY` / `yToMin` 一小时 48 像素（和 `style.css` 里 `.week-inner` 的 1152px、`.week-col` 的 48px 格线是同一个数，要改一起改）；`moveTimed` / `resizeEnd` / `createRange` / `moveDay` 算拖动的结果，`drop` 给出要写的字段和能不能写（跨天的 iCloud 日程是 `locked`）。太短的日程画成 30 分钟高（`MIN_VIS`），重叠和拖下边缘都按画出来的算。
  - 画：`renderWeek()`，三块（`#week-head` 列头、`#week-allday` 顶部一行、`#week-inner` 时间轴）都走 `setHtml`，内容没变不重写。全天、没写时间、跨天（`parts`）的日程和没写时间的待办进顶部一行；有时间的待办是 `.wk-mark`。三块都是 `overflow-y: scroll`（表头的滚动条画成透明），靠这个让七列上下对齐（试过表头用 `overflow: hidden` 加 `scrollbar-gutter: stable`，表头不留滚动条的位置，列会错开）。重画前后各量一次每一块的位置（`weekRects` / `weekFlip`），位置变了的从原处滑过去：取消、弹回、同一时段的几块重新排开，都是这一个动画。
  - 拖：`weekDown` / `weekMove` / `weekUp`（`#week` 上的 pointer 事件，按下时 `setPointerCapture`）。挪过 4 像素才算拖起来，没拖起来就是普通点击。拖的时候只改那一块自己的 `transform`（拖下边缘改 `height`，新建是一块 `.wk-ghost`），位置由 `week.js` 算出来的结果反推，所以看到的就是松手后的；**`drag` 不为空时 `renderWeek` 直接返回**（20 秒一次的刷新、同步完成都会调 `render`），记个 `stale`，松手后补画。松手时浏览器还会补一个 click，`swallowClick` 在 `#week` 的捕获阶段吞掉它。指针靠近时间轴上下边会自己滚（`weekAuto`）。
  - 松手后的改动走详情里那同一个 `change(it, patch)`：重复的某一场先选中它、开详情，`S.ask` 多带一个 `drag: true`；问范围期间 `viewOf()` 让这一块按还没定下来的改动画（停在松手的位置），选了才写，Esc / 点别处 / 再按下别的块都是 `cancelAsk()`，重画时滑回原位。置灰的选项用 `scopeOff()` 判断（`renderScope` 和这里共用）；`resolveAsk` 碰到置灰的按钮本来是什么都不做，带 `drag` 的会走 `rejectDrag`：弹出按钮上原有的那句提示（`tipPin` 让它在按钮消失后留两秒多）并 `cancelAsk()`。跨天的 iCloud 日程：弹回原位并打开详情，详情里本来就有那句“跨天日程，请在 Apple 日历里修改”。iCloud 的普通日程走 `updateItem` 的远程分支（`ICS.patch` → `pushSoon`），没有另写上传。
  - 详情气泡：`positionPanel` 在周视图里用 `weekAnchor()`（选中的那一块、它所在的列、可视范围），那一块滚出可视范围时气泡贴在边上；时间轴滚动时跟着重新摆。
- **只开一个实例**：`tauri-plugin-single-instance` 要最先注册；再次启动时让已开着的那个展开并通知。

## 还没在真机上验证的（只在模拟环境里测过）

Win+D 的行为、单实例的第二次启动、退出前保存、始终置顶切换、锁图标、系统通知。装上后如果哪个不对，先看这些。

0.8.0 新增的、只在模拟环境里测过（`ui14`，Chromium 里的真实鼠标事件和假的 iCloud）：`set_hit_hold`（Rust 本地没法编译，只用 rustfmt 查过语法，靠 CI 编译）在真机上是否真的让“拖出小组件范围”不变成穿透、松手后是否恢复穿透、30 秒兜底；WebView2 里指针拖出窗口后 `setPointerCapture` 是否还收得到移动和松手；周视图在真实 Windows 字体、125% / 150% 缩放下的排版（列头两行、时间轴刻度、窄块里的字、滚动条占位后七列是否对齐）；真机上拖动的跟手程度和松手后的滑动动画；拖 iCloud 日程后真 iCloud 收不收、Apple 日历里显示得对不对；空白处拖出新建后，真实输入法下标题框的输入；触摸屏 / 触控板上的拖动（只按鼠标测过）。

0.7.1 新增的、只在模拟环境里测过（`ui12` / `ui13` 和假的 iCloud）：传到真 iCloud 的重复日程（带 `VTIMEZONE`、`RECURRENCE-ID`、`EXDATE`）服务器收不收、Apple 日历和 iPhone 上显示得对不对；在今笺里改 / 删 Apple 日历建的每周课以后，Apple 那边显示得对不对；详情里新加的“重复 / 每周几 / 结束”几行和问范围的小气泡在真实 Windows 字体和缩放下的排版；WebView2 里原生的下拉框、日期框、数字框；真实输入法下打字时弹出气泡会不会打断组字。

0.7.0 新增的、同样只在模拟环境里测过：新界面（头部农历行、月历 / 月视图的农历和“休 / 班”角标、搜索层、倒数日条）在真实 Windows 字体和缩放下的排版；`holidays.json` 经 Tauri 命令 `get_holidays` 读取（Rust 本地没法编译，只用 rustfmt 查过语法，靠 CI 编译）；窗口里按 Ctrl+F 时 WebView2 自带的查找条是否被挡住；真实微软拼音 / 搜狗输入法下搜索框的组字行为。

## 路线

- 0.6.0：解析错误修复（截止词、小数小时、不存在的日期、十点零五、跨午夜）、测试入库并接 CI、石墨灰配色。
- 0.7.0：农历 / 24 节气 / 法定休班角标（`holidays.json` 可覆盖）；Ctrl+F 搜索；顶部倒数日条。
- 0.7.1：本机日程和待办的重复（每天 / 每周几 / 每月 / 每年 / 每年农历，结束日期或次数），改 / 删时问“仅此次 / 此次及以后 / 全部”；重复日程和 iCloud 互通（上传本机系列；iCloud 系列改一次、删一次、删以后、改全部的文字）。
- 0.8.0（当前）：展开日历里的周视图（月 / 周切换，七列加时间轴，重叠并排，“现在”线），拖拽排期（挪到别的天 / 时间、拖下边缘、空白处拖出新建、待办换天，15 分钟吸附）；拖动中鼠标出界不穿透（`set_hit_hold`）。
- 后面：桌面四角停靠 + 拖边改宽；周视图里跨周拖动、有时间和全天之间互相转换；iCloud 系列的“此次及以后”修改和按“全部”改时间（现在置灰，要在 Apple 日历里做）。

暂时没做、也没被要求做：多服务器 CalDAV / .ics 订阅、壁纸模式、多页便签、导出、Rust 拆模块、iCloud 提醒事项（VTODO）同步。真要做订阅时，再补访问地址的安全限制（现在 `dav` 只放行 iCloud，所以不需要）。
