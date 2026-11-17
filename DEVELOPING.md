# 开发笔记

给接手的人（包括新开的对话）看：先读这一页，再读 README 的“目录”一节，就能接着改。

## 一句话

今笺是 Windows 上贴在桌面右上角的玻璃便笺（日程、待办、便签），Tauri 2（Rust 外壳）+ 原生 HTML/CSS/JS，没有前端框架，也没有构建步骤。个人自用，不做商业用途。推送到 `main` 后 GitHub Actions 在云端打包，安装包发在 Releases（tag 是 `build-N`）。

## 改界面时要守的规矩（都是使用者明确说过的）

- 界面上不放多余的解释文字（“AI 味”）；需要说明的地方用 `?` / 悬停提示。
- 液态玻璃风格；壁纸是 macOS Sierra 的山，小组件默认放右上角（0.8.1 起可以换角，默认不变）。
- 动画用贝塞尔曲线（`--curve`），展开后的视图不要回弹，只有勾选时可以有一点点弹。
- 月视图展开后约占屏幕宽的 1/2、高的 2/3；一周从周日开始。
- 日程气泡要紧凑；设置和详情面板在玻璃很透时也要留一层看得清的底。
- 新配色只能“加选项”，不能替换原来的（0.6.0 加石墨灰时就是这么做的）。
- 不做番茄钟；主窗口是透明窗口，不要给整个窗口套系统亚克力 / Mica。

## 怎么测

```
npm test                         # 日期识别、日历解析、农历、搜索、倒数日、重复、周视图、同步内核、撤销栈、冲突、备份、取色，纯 Node，几秒内跑完；CI 里先跑它
python3 tests/ui/ui17.py         # 界面测试，需要 Playwright（Python），不在 CI 里跑
python3 tests/rust_pure.py       # main.rs 的纯逻辑测试，只要有 rustc，不用装 Tauri（CI 里跑的是真正的 cargo test）
```

- `tests/run.js` 会把 `TZ` 设成 `Asia/Shanghai` 再启动 `node --test`（期望值按上海时间写）。
- `tests/ui/*.py` 用 Playwright 打开 `src/index.html`，`mock_cn.js` 假装成 Tauri 外壳和一个假的 iCloud。截图写到 `tests/ui/shots/`（不入库）。`ui3`–`ui8` 对应 0.3–0.6 各版本的改动，`ui9`（农历 / 休班）、`ui10`（Ctrl+F 搜索）、`ui11`（倒数日）是 0.7.0 的，`ui12`（本机重复）、`ui13`（重复和 iCloud）是 0.7.1 的，`ui14`（周视图和拖拽，用真实的鼠标按下 / 移动 / 松开）是 0.8.0 的，`ui15`（四角停靠、拖边改宽、壁纸对齐）是 0.8.1 的，`ui16`（下拉框选项的字色和底色对比度）是 0.8.2 的，`ui17`（撤销和 iCloud 回滚、周视图待办栏 / 互拖 / 翻周、矮屏和竖屏 150%、0% 透明、跟随壁纸、Ctrl+K、导入、节假日跳过）是 0.9.0 的，改到相关功能时一起跑。`ui17` 的壁纸是用 PIL 现画的（`wallpaper()`：几段横条），测三区测光、深浅字用。`ui14` 里的日期都按“跑测试那天所在的那一周”算（`D(i)` 是那一周的第 i 天），拖之前先用 `w.scroll(小时)` 把时间轴滚到固定位置。Playwright 不肯点 `aria-disabled` 的按钮，置灰的选项用 `pg.mouse.click(坐标)` 点。`tests/fixtures/data-0.7.0.json` 是一份 0.7.0 的数据文件，`recur.test.js` 和 `ui12` 用它确认旧数据原样读写。界面测试里的“今天”是跑测试那天，要固定日期的断言都用 `S.date = ...; render()` 跳到具体日子，别依赖今天。
- 界面测试用 `python3 -u` 跑、或者别把输出重定向到文件再中途杀掉：Python 的输出是缓冲的，被杀时最后几行会丢，看起来像是卡在了前面某一步。
- 修 bug 的习惯：先写一个在旧代码上会失败的测试，再改，再确认它变绿。
- Rust 部分：本地拉不到 crates、编不了 Tauri 时，`rustfmt` 查语法，`tests/rust_pure.py` 把 `main.rs` 里的纯函数和 `mod tests` 抠出来用 `rustc --test` 跑（`is_json` 用一个只认括号配平的替身，所以和 serde_json 有关的边界情况以 CI 为准）。碰 Tauri / Win32 的部分只能靠 CI 编译：`windows` 任务打包前先跑 `cargo test`。

## 发布

1. 改版本号三处：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`。
2. 更新 README 里对应的功能说明。
3. 推到 `main`，等 CI 的 `test` 和 `windows` 两个任务都绿，Releases 里出现新的 `build-N`。

## 关键机制（改相关代码前先看）

- **鼠标穿透**：前端把“有东西的区域”报给外壳（`set_hit_rects`），Rust 里 40 ms 一轮的线程决定是否 `set_ignore_cursor_events`。新增会弹出的东西，要记得把它的矩形也报上去。拖动时另有一个“保持可点击”的状态（`set_hit_hold`，0.8.0）：`Hit.hold` 记着最近一次报“按下”的时刻，这期间光标在窗口哪里都当作落在玻璃上（用户开了“鼠标穿透”时不管）；前端 `holdHit(true/false)` 在周视图里按下和松开（含 Esc、失焦、`pointercancel`）时各报一次，拖着时每 5 秒续一次，Rust 那边 30 秒没续就自己放开（`HOLD_MAX`），免得页面卡死后整块透明窗口一直挡着桌面。
- **停靠的角和窗口几何**（0.8.1）：窗口由外壳摆，`place()`（`main.rs`）：宽 `WINDOW_WIDTH`（928 逻辑像素 = 详情 380 + 16 + 小组件最宽 480 + 两侧 24 + 余量，工作区更窄就以工作区为准），高度占满工作区，贴工作区的左边（`tl` / `bl`）或右边（`tr` / `br`）。工作区直接问系统（`GetMonitorInfoW`，和 `desk.rs` 一样自己声明，不加依赖），问不到才退回窗口框架给的显示器范围。上下不用挪窗口，只是界面在窗口里靠哪头。启动时 Rust 自己从 `data.json` 读 `settings.corner` 先摆好再显示；界面起来后 `dockWindow(true)` 调 `set_corner` 拿回几何信息 `geo`（窗口 / 显示器 / 工作区，物理像素）。
  - 界面这边全靠 `html` 上的 `data-corner` 和几个 CSS 变量（`applyGeo()` 写）：`--dx` / `--dy` 是靠的那两条边（`right|left`、`top|bottom`），`--sx` 是往屏幕里面的方向，`--w` 是小组件宽度，`--ex` / `--ey` 是停靠那一侧窗口边到屏幕边的距离。`style.css` 前面写的都是“右上”，文件末尾 `[data-corner$="l"]` / `[data-corner^="b"]` 两组规则只把靠的那条边换过去（`right → left`、`top → bottom`），所以**新加绝对定位的东西时，靠边的属性要在那两组里各补一条**；`transform-origin` 一律写 `var(--dy) var(--dx)`，横向滑入写 `calc(… * var(--sx))`。
  - 玻璃里的壁纸：`.glass::before` 的 `background-position` 从停靠的那两条边量，`--r` / `--t` 是这块玻璃离那两条窗口边的距离（和以前一样的常数，详情 / 设置的是 `40px + --w`），再加 `--ex` / `--ey` 就是它在屏幕上的位置。换角、改宽都只是这几个变量变，不用重算壁纸。`ui15` 里按“壁纸居中铺满整块显示器”倒推每块玻璃里壁纸的原点，四个角 × 任务栏在上下左右 16 种都对到 0.6 像素以内（还有一条反例确认这个量法量得出错位）。
  - JS 里按角算位置的只有 `positionPanel()`（气泡）：外壳展开后的位置按角算，写位置时靠右用 `right`、靠左用 `left`、靠上用 `top`、靠下用 `bottom`（`placePanel`），和 CSS 里用的是同一组属性，过渡才连得上。提示条、小窗口、问范围的气泡都是相对别的元素算的，不用管角。
  - 换角：`onAct('corner')` → `dockWindow(false)`：先给 `html` 加 `docking`（整块藏起来、不走过渡），等外壳挪完、变量写好、画过一帧再显示；接着重读一次壁纸（文字深浅看的是小组件背后那一块，`sampleWall` 按角取样）。`checkScreen()` 在 20 秒一次的刷新里比一下 `screen` 的几个数，变了就重新摆。
  - 改宽：`#grip`（`#shell` 里靠屏幕内侧的一条，只在平常的小组件上有）→ `bindGrip()`，拖的时候 `html.resizing` 关掉过渡、`holdHit(true)`（往外拖宽时指针在玻璃外面），`setWidth()` 只改 `S.settings.width` 和变量。比默认窄时 `html.narrow` 把头上那排图标收紧，不然 320 宽时最右边的图标会被玻璃裁掉。`widthOf()` 把宽度夹在 320–480，窗口放不下“详情 + 小组件”时上限再降。
- **下拉框**（0.8.2）：`select` 的字色继承玻璃上的字色，但弹出来的选项列表是系统画的、不透明的，选项要自己给实色（`style.css` 开头 `select option`：浅色字 → `--deep` 底白字，深色字 → 白底 `--deep` 字）。Playwright 截图拍不到弹出列表，`ui16` 量的是每个 `<option>` 计算出来的字色和底色的对比度。新加下拉框不用再管，规则是全局的。
- **玻璃**：系统壁纸（`TranscodedWallpaper`）画在每块 `.glass::before` 里再模糊；`--glass`（0–1）、`--tint`、`--halo`、`--solidify` 都由 `applyGlass()` 算出来；文字深浅（`data-ink`）按壁纸颜色和玻璃覆盖度自动选。配色（`data-palette`）只换玻璃底色、投影和深色字的色调，`applyGlass()` 里的 `VEIL` 要和 `style.css` 里各配色的 `--bg` 保持一致。
  - 0.9.0 透明态（`--glass < 0.5`，字直接压在壁纸上）：`sampleWall()` 把小组件背后那一块分上、中、下三段各取平均（`wallZones`），**最暗的一段**亮度 ≥ `BARE_DARK_LUM`（0.42）才用深色字，常见风景 / 渐变一律白字。字的影子是 `0 1px 2px` + `0 2px 6px` 的黑影（乘 `--halo`），深色字只留 1px 的白边；不要再加大圈的白晕（0.8.x 的 6px / 12px 白雾就是“发脏”的原因）。`.bare #shell …` 那一大段把半透明的字色换成实色、小字加到 500；`.now` / `.note` / `.quick` / `.overdue` 的底色和边框乘 `--glass`。新加的小字、色块要么也进这段，要么也乘 `--glass`。
  - 壁纸的摆法：`wallpaper_info` 给 `style`（`fill` / `fit` / `stretch` / `center` / `tile`），`wallBox()` 按它算壁纸在屏幕上的位置；纯色桌面给 `solid` 和 `color`，`showSolid()` 按颜色算。外壳每 2 秒比一次“壁纸指纹”（`WallSig`：路径、摆法、背景色、转码文件的大小和修改时间），变了发 `wallpaper-changed`，界面重读；上一张的 blob 地址在新图载入后释放（`wallUrl`）。
  - 跟随壁纸（`palette: 'wall'`）：`Monet.scheme()` 从整张壁纸（64 像素宽的缩略图）取色：中位切分（按最长边的中点切）给初始中心，再跑几轮 K-Means；`mood()` 挑面积大又有彩度的那一组；`fromSeed()` 在 OKLCH 里只动明度求出对比度 ≥ 4.5 的强调色（深底 / 浅底各一套，`onDark` / `onLight`）和带一点主色的玻璃底色。`applyWallPalette()` 把它写在 `html` 的行内变量上（换别的配色时拿掉），快速记录窗口从 `localStorage['jinjian-wall']` 读同一套。日历自带的颜色上的字用 `--oc`（`color()` 按对比度选白或 `#1b1408`）。
- **Win+D**：`desk.rs`。Windows 11 24H2 及以后把小组件挂在桌面窗口名下；更早的系统发现被盖住就立刻提回来。
- **数据**：`%APPDATA%\com.zekaikevin.jinjian\data.json`；写盘是“临时文件 → 落盘 → 替换”（`write_atomic`），退出前先让页面把没存的写完（`flush` 事件 ↔ `flush_done` 命令）。启动时和意外重开前 `finish_pending()` 把停在“临时文件写好了、还没替换”的那一步做完（临时文件不是完整的 JSON 就扔掉）。
  - iCloud 缓存（0.9.0）单独是 `remote_cache.json`（`load_remote_cache` / `save_remote_cache`，同样原子写，坏了退回 `remote_cache.bak.json`，再不行就空着等同步）。写进文件的样子是 `Sync.pack()`：不带 `sent`（服务器上的原文，只在内存里）。旧版 `data.json` 里的 `remote` 在第一次启动时搬过去（`migrating`：先写缓存再写数据，数据里就没有它了）。平常先写数据再写缓存。
  - 敏感命令（`load_data` / `save_data` / 两个缓存命令 / `export_file` / `cred_set` / `cred_delete` / `dav` / `set_layer` / `set_autostart`）开头 `only_main(&window)`，快速记录窗口调不了。`tauri.conf.json` 里是严格的本地 CSP（脚本只认本地文件，图片多认 `blob:` / `data:`，网络只认 IPC）；所有页面没有内联脚本和内联事件，新加东西也别写。主窗口关了系统的文件拖放（`dragDropEnabled: false`），HTML 自己的 `drop` 事件才收得到，导入靠它。
- **iCloud**：`caldav.js` 负责对话，`ics.js` 负责日历文本；密码在 Windows 凭据管理器里（`dav` 里取密码放在 `spawn_blocking` 里）；`dav` 命令只允许访问 `icloud.com` / `icloud.com.cn` 及其子域名（`icloud_host`，整段域名比对，有测试）。上传带 `If-Match`，失败会按 5 秒 / 30 秒 / 2 分钟 / 10 分钟重试（`Sync.backoff`）。
  - 0.9.0 同步内核：拉取、上传改动、上传新建、删除全部排进 `Q = Sync.queue()`，一个做完再做下一个（`do*` 是干活的，只在队列里跑；`syncNow` / `pushRes` / `uploadPending` / `delSoon` 负责排队，同一个 key 还在排队时不排第二个，`uploadPending` 的防重入就是这个）。`S.syncing` 为真时 `syncNow(false)` 直接返回（和 0.8.x 一样，`ui7` 靠它关掉自动同步）。
  - 每个日历先 `dav.state()`（PROPFIND 问 `getctag` 和 `sync-token`），`Sync.decide()`：没变 `skip`；变了且有 token 就 `delta`（`sync-collection` 报告拿到变了 / 删了的地址，再 `calendar-multiget` 取原文，`Sync.mergeDelta`）；第一次、过了一天（时间窗口挪了）、手动“同步”、token 被拒（403 / 409 / 410 / 507）就 `full`（原来的时间范围查询，`Sync.mergeFull`）。上一次的 `{ ctag, token, win }` 记在 `S.remote.cals`。合并时本机改了没传的（`dirty`）一律留本机这份。
  - 删除：`dropRes()` 先把那一条从 `S.remote.res` 挪进 `S.remote.gone`，400 毫秒后才排队去删（`doDelete`）。这一小会儿里撤销（`putRes`）就当没删过；合并时 `gone` 里的不会被拉回来。412 时不删了、重拉。`moved[本机 id]` 记着本机日程传上去后变成了哪个地址，撤销“传上去之前”的改动时改的是 iCloud 上那一条。
- **撤销 / 重做**（0.9.0）：`src/undo.js`（栈，纯函数）+ `app.js` 里的 `record(label, key, fn, hold)`：进去前 `Undo.snap()`、出来后再拍一张，`Undo.diff()` 出这一步变了哪几条（本机条目、便签、附加内容，都是 JSON 文本，天然深拷贝），再加上这一步里 `touchRes()` 过的 iCloud 条目（`{ ics, cal }` 原文）。所有用户操作都包在 `record` 里（`updateItem`、`addItem`、`deleteItem`、`deleteOcc`、`applyRule`、换日历、换类型、移到今天、便签、导入、节假日开关）；同步、上传、顺延这些程序自己做的不包。**函数名别再叫 `act`**：`onAct` 里有同名局部变量，会把它遮住。
  - 同一个 `key` 连着来的并成一步（打字是 `edit:id:字段`，1.5 秒内；新建后是 `new:id` + `hold`，详情关掉 / 换条目时 `H.seal()` 封口）；并完回到原样的整步取消；空白草稿被清走时 `H.forget()` 把它从历史里抹掉。
  - 撤销时 iCloud 条目要还是这一步留下的样子才动（`sameIcs` 按解析后的内容比，服务器整理过换行不算改过），不然整步不做、提示“别处改过”。恢复用 `putRes()`：恢复成的原文和 `sent` 一样就不用传（撤回了那次防抖上传），否则标成待传、排队把原来那份传回去；在 `gone` 里还没删的直接拿回来。
  - 键盘：`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`，焦点在能打字的地方（`isTyping`）时不管，归系统。
- **冲突和空档**（0.9.0）：`src/slots.js`：`conflicts()` 按开始时间扫一遍、手里留着还没结束的，O(n log n + 重叠数)；`free` / `nextFree` / `postpone`。`dayBusy(date)` 给出一天里占时间的（排成时间块的待办也算）。日视图里撞了的 `.ev.clash`（悬停说和谁），“日程”标题旁 `#ev-free` 是今天下一个空档；详情里 `#p-clash` 说和谁撞、`#p-postpone` 顺延（走 `change()`，重复的照样问范围）；周视图里 `.wk-ev.clash` 右上角小记号；记一笔的小胶囊里也查。快速记录窗口看不到主窗口的数据，主窗口每次写盘时把今天起两个月的占用放进 `localStorage['jinjian-busy']`（`publishBusy`）。
- **导入 / 导出**（0.9.0）：`src/backup.js`。导出走 `export_file`（只认 `.json` / `.ics` / `.md` / `.txt`，文件名去掉目录和非法字符，同名加 `(2)`，写到“下载”）。导入先 `Backup.read()` → `plan()`（`add` / `dup` 内容一样跳过 / `clash` 同 id 或 UID 内容不同 / `mirror` iCloud 缓存里已有这个 UID）→ 设置里 `#s-import` 预览 → `apply()`。导入的一律去掉 `cal`、子任务换新 id；带着原 UID 的本机条目在 iCloud 缓存里有同 UID 时不显示（`shadowed()`），也不会被 `uploadPending` 传上去。
- **节假日跳过**（0.9.0）：本机系列 `skipHol: true`，`Recur.syncHol(items, Lunar.offDays())` 在 `rebuildLocal()` 开头按规则、开始日期、休班表算出落在放假日的那几场记进 `holEx`（和用户删的 `exdates` 分开；关掉开关整个拿掉；表里有哪几年就算哪几年），展开时和 `exdates` 一起跳过，传 iCloud 时一起写成 EXDATE。iCloud 系列的开关在 `S.extras['s|地址']`：`syncRemoteHol()` 把落在放假日的场次 `ICS.exclude` 掉并记下时刻（`holEx`，毫秒），关掉时 `ICS.include` 放回来。
- **农历 / 休班**：`lunar.js` 里的农历表是 B36（1900–2100，和 ICU 只有 9 个年份被刻意修正：1954、1955、1999、2012、2018、2027、2030、2057、2070，以这张表为准，`tests/lunar.test.js` 里逐年锁着）；24 节气是算出来的，不是查表。休班表 `BUILTIN` 目前是 2025–2027，每年国务院办公厅的放假通知出来后要补下一年（或者让使用者用数据目录里的 `holidays.json` 覆盖，启动时 `get_holidays` 命令读、`Lunar.setHolidays` 解析，写坏了会被忽略）。设置里 `lunar` 管农历文字，`hol` 管休 / 班角标，两个都在 `renderHeader` / `renderCal` / `renderBig` 里读。
- **搜索层**：`#search` 是 `#shell` 里和 `#widget`、`#big` 同级的一层（`S.search`），打开时先收详情 / 设置 / 小窗口、把迷你条展开，`S.searchBack` 记着打开前的状态，Esc 关掉时退回去；点结果跳转时不退回（`closeSearch(false)`）。输入法：组字时不搜，`compositionend` 才搜，Enter / Esc / 方向键在 `isComposing`、`keyCode 229` 或 `composing` 标志为真时一律不处理。iCloud 的重复日程每个系列只留离今天最近的一场（`search.js` 里按 `href` 去重）。
- **倒数日**：本机条目上的 `countdown: true`；iCloud 条目的标记存在 `S.extras[id].countdown`（和子任务一样只在本机，`updateItem` 的远程分支处理，`rebuildRemote` 复制回条目）。顶部 `#countdowns` 在 `#widget` 的 `<header>` 和 `.views` 之间，没有倒数日时是 `hidden`（不占位置、不写字）；折叠日历的卡片高度在 `applyMode` 里加上它的高度。
- **重复（本机）**：`src/recur.js`，纯函数。一个系列在 `S.items` 里只有一条主条目，多出的字段都是可选的：`rrule`（标准 RRULE 文本）、`lunar`（只认 `FREQ=YEARLY`）、`exdates`（删掉的那几次，按原日期）、`overrides`（单独改过的那几次，按原日期，只放改过的字段，挪了日期就是 `date`）、`doneDates`（重复待办每一次的完成）。公历规则全交给 `ics.js` 的 `parseRRule` / `expand`（按全天展开，只取日期），农历按 `lunar.js` 换算。画面上用的是场次：`render()` 开头 `rebuildLocal()` 把今天前 62 天到后 400 天、正在看的月份、正在看的那天展开到 `L`；场次的 id 是 `主条目id@原日期`，`find()` 找不到普通条目时用 `Recur.get` 现拼，所以窗口外的那一次也找得到。主条目本身不进 `byDate` / 列表（`plainItems()` 把它们滤掉）。
  - 详情里的改动都走 `change(it, patch, anchor)`：是系列里的一场、这一场还没选过范围，就把改动先放进 `S.ask`、弹 `#scope` 小气泡（在 `#panel` 里，矩形另报给 `set_hit_rects`）；选了以后 `updateItem(it, patch, scope)` → `Recur.edit`，选过的范围记在 `S.scopeMem`，同一场接着改不再问（“此次及以后”拆出新系列后，之后的改动算新系列的“全部”）。Esc、关详情、换条目都算没选，改动丢掉、详情按数据重填。完成状态、重点、倒数日、类型是整个系列的，不问。改重复规则本身（`applyRule` → `Recur.setRule`）也不问；结束日期早于开始、次数让它一场都不剩的，退回原样。
  - `rollOver`、“移到今天”、“之前没做完”都跳过重复的待办；搜索把展开过的场次和 `Recur.nearest` 一起交给 `search.js`，按 `masterId` 每个系列留一条；倒数日用 `Recur.next`（待办跳过已完成的那一次）。
- **重复（iCloud）**：iCloud 重复日程的场次 id 按“原来那一场”记（`ics.js` 展开时给每一场带上 `rid` / `ridKey`），单独改过时间 id 也不变；0.7.0 按改后时间记的那几场，`rebuildRemote` 会把附加内容挪到新 id 上。改：仅此次 → `ICS.setOccurrence`（已有那一块就改它，没有就新加一块、照抄主事件的提醒）；全部 → 文字走 `ICS.patchSeries`（单独改过的场次里和原来一样的那几项跟着改），时间 / 日期 / 全天走 `ICS.shiftSeries`（0.9.0）；此次及以后 → `ICS.splitSeries`（0.9.0）：原系列 `endBefore` 截断，从这一场起 `retime(…, { tail: true })` 另开一个新 UID 的系列（次数按剩下的算，之前的单独改动和 EXDATE 留在原系列，之后的跟过去）。`retime` 是核心：整组挪 n 天时 `BYDAY` 跟着转，按“第几个周几 / 每月几号 / 指定月份”排的挪天做不了（返回 null → `scopeOff` 置灰那一项）；单独改过时间的场次留着自己的时间，没改过的跟着整组走；`RECURRENCE-ID` / `EXDATE` 换成新的写法；全天改成有时间按本机时区写并补一段 `VTIMEZONE`（有夏令时的时区做不了）。整组改过时间以后每一场的 id 都变了，`rekeySeries()` 把子任务、倒数日挪到新 id 上。删：仅此次 → `ICS.exclude`，此次及以后 → `ICS.endBefore`（有次数的改次数，被删的场次也算），全部、或者这一场之前一场都不剩（`ICS.countBefore().live < 1`，**不能拿 DTSTART 比**：周三建的“每周一”DTSTART 比第一场早）→ 删整条；`endBefore` 在这一场之前排不出场次时返回 null，不写 `COUNT=0`，`expand` 也把 `COUNT=0` 当“一场都没有”（`rrule.counted`），0.8.2 的“删成无限重复”就是这两处。本机的重复日程选了日历后由 `uploadPending` 整份上传（`Recur.forUpload` → `ICS.buildSeries`）：开始时间写 `TZID=本机时区` 并带一段 `VTIMEZONE`，结束日期换成当天 23:59:59 的 UTC。不写 UTC 是因为早上 8 点前的“每周一”在 UTC 里是周日，BYDAY 按 UTC 算会落到周二（`recur-sync.test.js` 里锁着）。有夏令时的时区不传（`localTz()` 返回 null）；农历和待办不传，农历日程在详情里有“只存本机”的小图标。传上去后本机这条删掉，子任务和倒数日标记挂到下一场上。
- **周视图**（0.8.0）：`S.week` 为真时 `#big` 里显示 `#week`、藏起月视图的格子，外壳大小、展开动画都还是 `#big` 那一套（`applyMode` 没动）；看哪一周由 `S.date` 定（`Week.weekKeys`，周日起），切过去时落在哪天用 `Week.anchor`；“上 / 下一个”在周视图里是 `shiftWeek`。`S.week` 只在这次运行里记着，不写进设置。
  - 计算全在 `src/week.js`（纯函数，`tests/week.test.js`）：`layout` 把连着重叠的日程分成一簇、簇里贪心分栏、右边没人就向右撑；`minToY` / `yToMin` 一小时 48 像素（和 `style.css` 里 `.week-inner` 的 1152px、`.week-col` 的 48px 格线是同一个数，要改一起改）；`moveTimed` / `resizeEnd` / `createRange` / `moveDay` 算拖动的结果，`drop` 给出要写的字段和能不能写（跨天的 iCloud 日程是 `locked`）。太短的日程画成 30 分钟高（`MIN_VIS`），重叠和拖下边缘都按画出来的算。
  - 画：`renderWeek()`，三块（`#week-head` 列头、`#week-allday` 顶部一行、`#week-inner` 时间轴）都走 `setHtml`，内容没变不重写。全天、没写时间、跨天（`parts`）的日程和没写时间的待办进顶部一行；有时间的待办是 `.wk-mark`。三块都是 `overflow-y: scroll`（表头的滚动条画成透明），靠这个让七列上下对齐（试过表头用 `overflow: hidden` 加 `scrollbar-gutter: stable`，表头不留滚动条的位置，列会错开）。重画前后各量一次每一块的位置（`weekRects` / `weekFlip`），位置变了的从原处滑过去：取消、弹回、同一时段的几块重新排开，都是这一个动画。
  - 拖：`weekDown` / `weekMove` / `weekUp`（`#week` 上的 pointer 事件，按下时 `setPointerCapture`）。挪过 4 像素才算拖起来，没拖起来就是普通点击。拖的时候只改那一块自己的 `transform`（拖下边缘改 `height`，新建是一块 `.wk-ghost`），位置由 `week.js` 算出来的结果反推，所以看到的就是松手后的；**`drag` 不为空时 `renderWeek` 直接返回**（20 秒一次的刷新、同步完成都会调 `render`），记个 `stale`，松手后补画。松手时浏览器还会补一个 click，`swallowClick` 在 `#week` 的捕获阶段吞掉它。指针靠近时间轴上下边会自己滚（`weekAuto`）。
  - 松手后的改动走详情里那同一个 `change(it, patch)`：重复的某一场先选中它、开详情，`S.ask` 多带一个 `drag: true`；问范围期间 `viewOf()` 让这一块按还没定下来的改动画（停在松手的位置），选了才写，Esc / 点别处 / 再按下别的块都是 `cancelAsk()`，重画时滑回原位。置灰的选项用 `scopeOff()` 判断（`renderScope` 和这里共用）；`resolveAsk` 碰到置灰的按钮本来是什么都不做，带 `drag` 的会走 `rejectDrag`：弹出按钮上原有的那句提示（`tipPin` 让它在按钮消失后留两秒多）并 `cancelAsk()`。跨天的 iCloud 日程：弹回原位并打开详情，详情里本来就有那句“跨天日程，请在 Apple 日历里修改”。iCloud 的普通日程走 `updateItem` 的远程分支（`ICS.patch` → `pushSoon`），没有另写上传。
  - 详情气泡：`positionPanel` 在周视图里用 `weekAnchor()`（选中的那一块、它所在的列、可视范围），那一块滚出可视范围时气泡贴在边上；时间轴滚动时跟着重新摆。
  - 0.9.0：`#week` 里分成 `#week-main`（原来的三块）和 `#week-side`（待办栏，`S.side`，头上 `#big-side` 开关）。待办有 `due` 也有 `end` 就是时间块（`Week.spanOf`），画在时间轴上（`.wk-ev.todo`，左上角 `.wk-chk` 勾完成，按下它不算拖）；只有 `due` 的还是小标记，拖动只换天。拖动时 `weekHit()` 判断指针在时间轴 / 顶部一行 / 外面：顶部一行或待办栏的进到时间轴 12 像素以上 → `Week.toBlock`（虚线框 `ghost2` 标落点），时间轴上的（含小标记）到顶部一行 → `Week.toAllDay`，其余照旧。时间块按日程的规矩算：进 `week.js` 之前 `Week.asTimed()`（`due` 当 `start`），出来 `Week.fromTimed()` 换回去。指针停在左右边上 `EDGE_WAIT`（650 毫秒）→ `flipWeek()`：指针改由 `#week` 抓着（拖着的那一块马上要被重画换掉），翻周、重画，再把那一块塞回新一周的同一列接着拖；`drag.flip` 记翻了几周，松手时算进 `dDays`，取消时翻回去。`set_hit_hold` 全程不断（`holdHit` 只在按下 / 松手时动）。
- **只开一个实例**：`tauri-plugin-single-instance` 要最先注册；再次启动时让已开着的那个展开并通知。
- **高 DPI / 窄屏**（0.9.0）：`layout()` 的外壳高度不再有 480 的下限（只保留 240 兜底）；`style.css` 末尾 `@media (max-height: 540px)` 收紧一档。展开的月 / 周视图宽 `bigSize()[0]` = `min(768, 窗口宽 - 48)`（`--big-w`，`applyMode` / `positionPanel` 和 CSS 用同一个）；月视图每格放几条按格高算。详情 / 设置宽 `--panel-w`，小组件旁边连 260 都放不下时 `html.stacked` 让它们盖在小组件上。
- **输入法和输入框**（0.9.0）：详情里的标题、地点、备注、子任务和“记一笔”、指令条：`compositionstart` 到 `compositionend` 之间一个字都不写，写也稍等 90 毫秒（`typed()` 轻防抖，`flushFields()` 在回车、关详情、换条目、删除、撤销之前把压着的写掉）。“记一笔”的识别是 `parseQuick(text, now, quickOff)`，第三个参数关掉某一类（点掉的小胶囊）。
- **Ctrl+K**（0.9.0）：`#cmd` 是和 `#search` 同级的一层（`S.cmd`），`COMMANDS` 里每条一个名字、一串拼音关键词和要做的事；平时 `.layer` 不显示、不报命中区域。
- **贴边自动收起 / 临时置顶**（0.9.0）：设置 `edge` → `set_edge`。外壳的守护循环里 `at_edge()` 判断光标是否在停靠那条屏幕边上（工作区边、窗口高度范围内、3 像素宽），`Edge::step()` 做迟滞：收着时在边上停 220 毫秒发 `edge-peek`；出来后光标离开小组件 900 毫秒发 `edge-leave`，界面 `edgeBusy()`（在打字、组字、开着详情 / 气泡 / 搜索 / 指令条、在拖、提示条还在）就不收，外壳隔 2 秒再问。界面收起时 `html.edge-hidden`，只报 `#edge-bar` 的矩形，外壳在收着时整个穿透。`Alt+W` / 托盘 → `summon_main()`：临时置顶并抢焦点，再按或主窗口失焦（400 毫秒以后）放回 `apply_layer(top)`；`set_layer` 在临时置顶期间只记不动。守护循环在“开了鼠标穿透 + 贴在桌面 + 没在拖 + 没开贴边收起”时 400 毫秒一轮（`tick_ms`），其余 40 毫秒；`desk` 的唤醒不受影响。
- **其他外壳细节**（0.9.0）：全局快捷键注册失败的记在 `HOTKEYS_TAKEN`，`hotkey_status` / `hotkeys` 事件给设置页（`#s-keys`）。开机自启：`get_autostart` 看 `Run` 里有没有、`StartupApproved\Run` 里那条的第一个字节是不是奇数（任务管理器里禁用了），打开时把后者删掉。快速记录窗口出现在光标所在的那块屏的工作区正中（`desk::cursor_work`，挪两次：换到缩放不同的屏时大小会变）；它的失焦隐藏在前端有 220 毫秒宽限，外壳那边刚弹出 400 毫秒内的 `hide_capture(blur)` 不理。主窗口被系统销毁时 `recover()`：等手上的写盘 / iCloud 请求（`Busy` 计数，最多 2 秒）、`finish_pending`、等桌面回来（最多 10 秒）再重开。Win32 的声明都在 `desk.rs`（`main.rs` 里不再声明系统函数）。

## 还没在真机上验证的（只在模拟环境里测过）

Win+D 的行为、单实例的第二次启动、退出前保存、始终置顶切换、锁图标、系统通知。装上后如果哪个不对，先看这些。

0.9.0 **已实测**（这一版在 Linux 上做的，没有 Windows）：`npm test` 212 条全过；`tests/ui/ui3`–`ui17` 全过（641 条断言，其中 `ui17` 115 条；Chromium + 假外壳 + 假 iCloud，`ui17` 覆盖附件里点名的 150% 矮屏 / 竖屏、0% 透明、跟随壁纸、周视图跨周 / 待办拖拽、Ctrl+Z 和 iCloud 回滚）；`tests/rust_pure.py` 跑 `main.rs` 的 19 条 `#[test]` 全过；`main.rs` / `desk.rs` 过了 `rustfmt`。**Tauri 和 Win32 部分在这里编译不了，第一次编译要看 CI**（`cargo test` 和打包），编不过先看下面第 1 条。

0.9.0 **待 Windows 真机验证**：
1. 编译：`desk.rs` 新声明的 `SystemParametersInfoW` / `GetSysColor` / `RegGetValueW`（`advapi32`）/ `MonitorFromPoint` / `GetCursorPos`，`HKCU` 常量的符号扩展；`main.rs` 里 `tauri::async_runtime::spawn_blocking`、`emit_to("main", …)`、`app.path().download_dir()`、`WindowEvent::Focused`、命令参数里注入的 `tauri::WebviewWindow`。
2. 严格 CSP 下界面一切照常（壁纸的 `blob:` 地址、行内样式、IPC）；快速记录窗口调 `save_data` / `dav` 会被拒（`only_main`），它自己用的 `capture_submit` / `hide_capture` 照常。
3. 壁纸热更新：换一张图、换成纯色、换“契合度”、幻灯片放映，2 秒左右玻璃跟上；`wallpaper_info` 的 `style` 和真实摆法对不对（尤其“适应”“居中”），多显示器各一张壁纸时用的是哪张。
4. 0% 透明在真实 ClearType / 灰度抗锯齿下的观感（白字黑影是不是干净、500 字重会不会太粗），各种壁纸上深浅字的切换；“跟随壁纸”配出来的颜色在真机壁纸上好不好看。
5. 贴边自动收起：滑出 / 收回的手感，220 / 900 毫秒的迟滞合不合适；任务栏在同一侧时那条边能不能碰到；收着时窗口是不是完全穿透、不挡桌面图标；开着输入法、开着详情时不会被收走。
6. `Alt+W`：叫到最前面能不能真抢到焦点（Windows 的前台锁），点别处放回桌面层；和“显示桌面”、和“始终置顶”混用。
7. 开机自启：在任务管理器里禁用后设置里是不是显示关；在设置里打开后真能自启。
8. 快速记录窗口：多显示器、不同缩放下出现在光标那块屏的正中；刚弹出时不会一闪就没。
9. 资源管理器重启时 `recover()` 的等待：不丢数据、窗口回到对的位置。
10. 增量同步对真 iCloud：`getctag` / `sync-token` 拿不拿得到、`sync-collection` 的回复格式（尤其被删的那几条是 404 状态）、token 过期时回退全量；`calendar-multiget` 的地址写法。
11. iCloud 系列的“此次及以后”（新开一个 UID）和按“全部”改时间（`BYDAY` 跟着转、`RECURRENCE-ID` 换写法）传上去后，Apple 日历和 iPhone 上显示得对不对；节假日跳过写的 EXDATE 在 Apple 那边是不是也不显示。
12. 撤销回滚 iCloud：反向 PUT 带的 `If-Match` 在真服务器上对得上；手机上又改过时会提示“别处改过”。
13. 周视图：WebView2 里翻周时 `setPointerCapture` 从拖着的块换到 `#week` 会不会断；触控板上拖待办栏。
14. 1280×720 / 1366×768 配 150%、1080×1920 竖屏配 150% 的真实排版（模拟里是按 `GEO` 和视口算的）。
15. 导出写到“下载”文件夹（OneDrive 重定向过的“下载”）；把 .ics / .json 文件拖到小组件上导入（`dragDropEnabled: false` 以后 WebView2 自己的拖放）。

0.8.2：下拉框弹出列表的样子只量了计算出来的颜色（`ui16`），没在 WebView2 里亲眼看过；Windows 高对比度模式下系统会接管这些颜色，没试过。

0.8.1 新增的、只在模拟环境里测过（`ui15`：浏览器视口当窗口，`set_corner` 是假的，几何信息是测试给的）。这一版动的是窗口几何，下面每一条都要装到真机上看：
1. 启动：窗口按上次的角直接出现在对的那一侧，没有“先在右边闪一下再跳过去”；第一次装（没有 `corner`）还在右上，位置和 0.8.0 一样。
2. 四个角各选一次：小组件贴在工作区的角上，离屏幕边 / 任务栏边 24 像素，不被任务栏盖住；任务栏在下面、自动隐藏、挪到上面或左右（Windows 10）时都对。
3. 玻璃里的壁纸和真正的桌面壁纸对齐（看小组件边缘内外的图案是不是连着的）：四个角、改宽之后、任务栏在上 / 左时；125% / 150% 缩放下。
4. 换角那一下：整块先消失再出现，没有看到内容横穿屏幕或错位的残影；设置面板换到另一侧后还能接着点。
5. 鼠标穿透的命中区域：换角、改宽后，玻璃上点得到、玻璃外点得穿（尤其是原来那一侧现在应该完全穿透）；窗口从 820 加宽到 928 逻辑像素，多出来的那条透明区域不挡桌面图标。
6. Win+D：四个角各试一次，小组件留在桌面上（24H2 挂在桌面窗口名下的做法、老系统“发现后提回来”的做法，都只动前后顺序不动位置，代码上没冲突，但没在真机上和挪窗口一起试过）。
7. 两种层级：换角后“贴在桌面”仍在所有窗口下面、“始终置顶”仍在最上面；切换层级后位置不变。
8. 拖内侧的边改宽：跟手、不卡；往外拖时指针出了玻璃不会断（`set_hit_hold`）；松手后宽度记住，重启还在；320 和 480 两头的排版；双击恢复。
9. 展开月视图 / 周视图：靠左往右展开、靠下往上展开，动画从停靠的角长出来；气泡在对的一侧、不出玻璃。
10. 胶囊（贴边的小条）在左侧停靠时贴左边、圆角朝右；靠下时在离下边 120 像素处。
11. 改分辨率 / 缩放 / 任务栏位置后 20 秒内自己重新贴好（`checkScreen` 靠 WebView2 报的 `screen` 数值，真机上准不准没验证）。
12. 多显示器：窗口在哪块屏上就按哪块的工作区摆（`MonitorFromWindow` 取最近的一块），副屏和不同缩放的组合没测过。
13. `main.rs` 里新加的 `GetMonitorInfoW` 声明和结构体布局只用 rustfmt 查过语法，靠 CI 编译；数值对不对要看第 2、3 条。

0.8.0 新增的、只在模拟环境里测过（`ui14`，Chromium 里的真实鼠标事件和假的 iCloud）：`set_hit_hold`（Rust 本地没法编译，只用 rustfmt 查过语法，靠 CI 编译）在真机上是否真的让“拖出小组件范围”不变成穿透、松手后是否恢复穿透、30 秒兜底；WebView2 里指针拖出窗口后 `setPointerCapture` 是否还收得到移动和松手；周视图在真实 Windows 字体、125% / 150% 缩放下的排版（列头两行、时间轴刻度、窄块里的字、滚动条占位后七列是否对齐）；真机上拖动的跟手程度和松手后的滑动动画；拖 iCloud 日程后真 iCloud 收不收、Apple 日历里显示得对不对；空白处拖出新建后，真实输入法下标题框的输入；触摸屏 / 触控板上的拖动（只按鼠标测过）。

0.7.1 新增的、只在模拟环境里测过（`ui12` / `ui13` 和假的 iCloud）：传到真 iCloud 的重复日程（带 `VTIMEZONE`、`RECURRENCE-ID`、`EXDATE`）服务器收不收、Apple 日历和 iPhone 上显示得对不对；在今笺里改 / 删 Apple 日历建的每周课以后，Apple 那边显示得对不对；详情里新加的“重复 / 每周几 / 结束”几行和问范围的小气泡在真实 Windows 字体和缩放下的排版；WebView2 里原生的下拉框、日期框、数字框；真实输入法下打字时弹出气泡会不会打断组字。

0.7.0 新增的、同样只在模拟环境里测过：新界面（头部农历行、月历 / 月视图的农历和“休 / 班”角标、搜索层、倒数日条）在真实 Windows 字体和缩放下的排版；`holidays.json` 经 Tauri 命令 `get_holidays` 读取（Rust 本地没法编译，只用 rustfmt 查过语法，靠 CI 编译）；窗口里按 Ctrl+F 时 WebView2 自带的查找条是否被挡住；真实微软拼音 / 搜狗输入法下搜索框的组字行为。

## 路线

- 0.6.0：解析错误修复（截止词、小数小时、不存在的日期、十点零五、跨午夜）、测试入库并接 CI、石墨灰配色。
- 0.7.0：农历 / 24 节气 / 法定休班角标（`holidays.json` 可覆盖）；Ctrl+F 搜索；顶部倒数日条。
- 0.7.1：本机日程和待办的重复（每天 / 每周几 / 每月 / 每年 / 每年农历，结束日期或次数），改 / 删时问“仅此次 / 此次及以后 / 全部”；重复日程和 iCloud 互通（上传本机系列；iCloud 系列改一次、删一次、删以后、改全部的文字）。
- 0.8.0：展开日历里的周视图（月 / 周切换，七列加时间轴，重叠并排，“现在”线），拖拽排期（挪到别的天 / 时间、拖下边缘、空白处拖出新建、待办换天，15 分钟吸附）；拖动中鼠标出界不穿透（`set_hit_hold`）。
- 0.8.1：停靠在屏幕四个角（设置里选，按工作区避开任务栏）；拖内侧的边改宽（320–480，记住）；玻璃里的壁纸跟着新位置、新宽度对齐；展开的月 / 周视图和详情气泡跟着停靠的角翻转。
- 0.8.2：修下拉框弹出的选项白字白底、看不见（详情里的日历 / 重复 / 提醒，设置里的“新日程存到”）。
- 0.9.0（当前）：
  - 同步内核 2.0：修“此次及以后”把 iCloud 系列删成无限重复；iCloud 系列的“此次及以后”修改、按“全部”改时间 / 全天；iCloud 缓存拆成 `remote_cache.json`；ctag / sync-token 增量同步、服务端删除感知；拉取 / 上传 / 删除串行排队。
  - 事务级撤销 / 重做（含 iCloud 回滚）；时间冲突提示、今天下一个空档、顺延；重复日程“节假日跳过”；导出备份 / .ics、安全导入（预览、去重、冲突、和 iCloud 隔离）。
  - NLP 2.0：修 2026-11-20 / 2026/11/20 / 周末 / “2026年12月5号”残留年份 / 下午 12 点 / 晚上 1 点；一句话同时拆出重复、日期、起止时间、地点、标题，记一笔和快速记录下面排成可点掉的小胶囊、提示冲突。
  - 顺手修的老问题：矮屏（`max-height: 780px`，1080p 开 150%）里头上的农历被 `.day` 一起放大成 40px。
  - 桌面玻璃 2.0：0% 透明态的字不再发脏（三区测光、白字黑影、实色、字重、色块隐去）；“跟随壁纸”配色；对比度修补。周视图：待办栏拖进时间轴成时间块、全天 ↔ 时间轴、拖到边上翻周。矮屏 / 竖屏 150% 自适应；输入法保护；Ctrl+K 指令条。
  - 外壳：壁纸热更新、贴边自动收起、Alt+W 临时置顶、敏感命令只认主窗口、严格 CSP、导出到“下载”、开机自启认任务管理器、快速记录跟着光标所在的屏、全局快捷键冲突提示、守护循环降频、意外重开前先保住数据；`#[test]` 和 CI 里的 `cargo test`。
- 后面：托盘菜单里也能换角；撤销历史跨重启保留；按“第几个周几”排的 iCloud 系列整组挪天。

暂时没做、也没被要求做：多服务器 CalDAV / .ics 订阅、多页便签、Rust 拆模块、iCloud 提醒事项（VTODO）同步。真要做订阅时，再补访问地址的安全限制（现在 `dav` 只放行 iCloud，所以不需要）。
