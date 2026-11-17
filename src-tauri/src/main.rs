// 今笺 Jinjian：桌面玻璃日程小组件的程序外壳。
// 负责：把透明窗口贴在工作区的一侧（默认右边，可换角）、放在所有窗口之下、只让玻璃区域接收鼠标、
// 托盘菜单、全局快捷键、快速记录窗口、系统通知、开机自启、
// 本地数据读写、读取系统壁纸，以及替界面向 iCloud 发 CalDAV 请求。
// 0.9.0：壁纸换了自动通知界面、贴边自动收起、Alt+W 临时置顶、iCloud 缓存单独一个文件、
// 敏感命令只认主窗口、导出文件到“下载”。不依赖系统的纯计算都拆成了小函数，文件末尾有 #[test]。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desk;

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

/// 窗口的逻辑宽度：详情面板 380 + 间距 16 + 小组件最宽 480 + 两侧边距各 24，再留一点余量。
/// （展开的月视图 / 周视图是 768 + 边距，比它窄。）屏幕的工作区没这么宽时，以工作区为准。
const WINDOW_WIDTH: f64 = 928.0;
/// App 专用密码存在 Windows 凭据管理器里，用这个名字归类。
const CRED_SERVICE: &str = "Jinjian iCloud";
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
/// 用户从托盘点了“退出”。主窗口意外没了要自动重开，正常退出不算。
static QUITTING: AtomicBool = AtomicBool::new(false);
/// 退出前界面已经把数据写完了。
static FLUSHED: AtomicBool = AtomicBool::new(false);
/// “拖动中保持可点击”最多撑这么久。界面拖动时每隔几秒会重新报一次；
/// 万一页面卡死、没来得及报“松手了”，超过这个时间就自己放开，免得整块透明窗口一直挡着桌面。
const HOLD_MAX: Duration = Duration::from_secs(30);
/// 任务管理器“启动”页里的开 / 关记在这里（和 Run 里那一条同名）。
const APPROVED_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
const RUN_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
/// 贴边自动收起：光标离停靠的那条屏幕边多近算“在边上”（物理像素）。
const EDGE_BAND: f64 = 3.0;
/// 在边上停这么久才滑出来（防误触：鼠标只是路过屏幕边缘不算）。
const EDGE_PEEK_MS: u64 = 220;
/// 离开小组件这么久才叫界面收回去；界面正忙（在打字、开着气泡）没收的话，每隔一阵再问一次。
const EDGE_LEAVE_MS: u64 = 900;
const EDGE_ASK_MS: u64 = 2000;
/// 还在写盘 / 还在等 iCloud 应答的命令个数。主窗口意外没了、要重开进程之前，先等它们做完。
static BUSY: AtomicUsize = AtomicUsize::new(0);
/// 没注册上的全局快捷键（被别的程序占了），界面在设置里说一声。
static HOTKEYS_TAKEN: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// 快速记录窗口上次弹出来的时刻：刚弹出来那一下的“失焦”不算数。
static CAPTURE_AT: Mutex<Option<Instant>> = Mutex::new(None);

struct Busy;
impl Busy {
    fn new() -> Busy {
        BUSY.fetch_add(1, Ordering::SeqCst);
        Busy
    }
}
impl Drop for Busy {
    fn drop(&mut self) {
        BUSY.fetch_sub(1, Ordering::SeqCst);
    }
}

/// 界面上报的可点击区域（相对窗口左上角的物理像素），以及是否处于“鼠标穿透”。
#[derive(Default)]
struct Hit {
    rects: Vec<[f64; 4]>,
    locked: bool,
    /// 用户选了“始终置顶”：这时不挂在桌面上，也不需要管“显示桌面”。
    top: bool,
    /// 界面正在拖动东西（周视图里拖日程）：从按下报到松开。这期间鼠标离开玻璃区域也不穿透，
    /// 否则指针一出界面，窗口就把鼠标让给桌面，松手的事件再也收不到。记的是最近一次报“按下”的时刻。
    hold: Option<Instant>,
    /// 停靠在左边（tl / bl）还是右边：贴边自动收起要知道盯哪条屏幕边。
    left: bool,
    /// 设置里开了“贴边自动收起”。
    edge: bool,
    /// 界面现在是收起的（只露一条细线）。由界面报上来。
    edge_hidden: bool,
    /// Alt+W 临时置顶中；记的是开始的时刻（刚置顶那一下的“失焦”不算数）。
    summoned: Option<Instant>,
}

type Shared = Arc<Mutex<Hit>>;

// ---------- 本地数据 ----------

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn is_json(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).is_ok()
}

/// 只有主窗口能用的命令（存取数据、密码、网络请求、改窗口）：快速记录窗口只管把一句话交回来，别的都不该碰。
fn label_ok(label: &str) -> bool {
    label == "main"
}

fn only_main(window: &tauri::WebviewWindow) -> Result<(), String> {
    if label_ok(window.label()) {
        Ok(())
    } else {
        Err("这个命令只有主窗口能用".to_string())
    }
}

/// 读一个 JSON 文件。文件完好才拿它覆盖备份；文件坏了就改用备份，坏文件另存一份留着查（broken 给了才存）。
/// 都读不出来返回空串。
fn read_with_backup(dir: &Path, name: &str, backup: &str, broken: Option<&str>) -> String {
    let text = fs::read_to_string(dir.join(name)).unwrap_or_default();
    if is_json(&text) {
        let _ = fs::write(dir.join(backup), &text);
        return text;
    }
    if !text.is_empty() {
        if let Some(broken) = broken {
            let _ = fs::write(dir.join(broken), &text);
        }
    }
    match fs::read_to_string(dir.join(backup)) {
        Ok(saved) if is_json(&saved) => saved,
        _ => String::new(),
    }
}

/// 先写临时文件、确认真正落到磁盘上，再替换正式文件。
/// 这样写到一半断电，正式文件还是上一份完整的，不会变成半截或空文件。
fn write_atomic(dir: &Path, name: &str, text: &str) -> Result<(), String> {
    let tmp = dir.join(format!("{}.tmp", name));
    {
        let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    // 杀毒软件、索引服务偶尔会短暂占着文件，替换失败就稍等再试
    let target = dir.join(name);
    let mut error = String::new();
    for _ in 0..3 {
        match fs::rename(&tmp, &target) {
            Ok(()) => return Ok(()),
            Err(e) => {
                error = e.to_string();
                thread::sleep(Duration::from_millis(15));
            }
        }
    }
    Err(error)
}

/// 上次写盘停在了“临时文件写好了、还没替换”这一步（进程正好在这时没了）：临时文件是完整的 JSON 就把替换做完。
/// 返回做完了几个。
fn finish_pending(dir: &Path) -> usize {
    let mut done = 0;
    for name in ["data.json", "remote_cache.json"] {
        let tmp = dir.join(format!("{}.tmp", name));
        let text = match fs::read_to_string(&tmp) {
            Ok(text) => text,
            Err(_) => continue,
        };
        if !is_json(&text) {
            let _ = fs::remove_file(&tmp); // 写了一半的临时文件：没用了
            continue;
        }
        let newer = |p: &Path| fs::metadata(p).and_then(|m| m.modified()).ok();
        let target = dir.join(name);
        let stale = match (newer(&tmp), newer(&target)) {
            (Some(a), Some(b)) => a < b,
            _ => false,
        };
        if stale {
            let _ = fs::remove_file(&tmp);
        } else if fs::rename(&tmp, &target).is_ok() {
            done += 1;
        }
    }
    done
}

/// 读取数据文件。
#[tauri::command]
fn load_data(app: AppHandle, window: tauri::WebviewWindow) -> Result<String, String> {
    only_main(&window)?;
    let dir = data_dir(&app)?;
    Ok(read_with_backup(
        &dir,
        "data.json",
        "data.bak.json",
        Some("data.broken.json"),
    ))
}

/// iCloud 日程的本机缓存，和 data.json 分开存（0.9.0）：它大、变得勤，而且丢了也只是重新同步一次。
/// 读不出来就用上一份备份，再不行返回空串，界面会当作“还没同步过”。
#[tauri::command]
fn load_remote_cache(app: AppHandle, window: tauri::WebviewWindow) -> Result<String, String> {
    only_main(&window)?;
    let dir = data_dir(&app)?;
    Ok(read_with_backup(
        &dir,
        "remote_cache.json",
        "remote_cache.bak.json",
        None,
    ))
}

#[tauri::command]
fn save_remote_cache(
    app: AppHandle,
    window: tauri::WebviewWindow,
    json: String,
) -> Result<(), String> {
    only_main(&window)?;
    if !is_json(&json) {
        return Err("缓存内容不是合法的 JSON".to_string());
    }
    let _busy = Busy::new();
    write_atomic(&data_dir(&app)?, "remote_cache.json", &json)
}

/// 数据目录里的 holidays.json（法定休班表的补充 / 覆盖）。读不出来、太大就当没有；
/// 内容是不是合法、有没有 BOM 由前端的 Lunar.setHolidays 判断，坏了它会忽略。
#[tauri::command]
fn get_holidays(app: AppHandle) -> Result<String, String> {
    let dir = data_dir(&app)?;
    let text = fs::read_to_string(dir.join("holidays.json")).unwrap_or_default();
    Ok(if text.len() > 1_000_000 {
        String::new()
    } else {
        text
    })
}

/// 保存数据文件（原子写，见 write_atomic）。
/// 这是同步命令，在主线程上一个一个执行，两次保存不会同时写同一个临时文件。
#[tauri::command]
fn save_data(app: AppHandle, window: tauri::WebviewWindow, json: String) -> Result<(), String> {
    only_main(&window)?;
    let _busy = Busy::new();
    write_atomic(&data_dir(&app)?, "data.json", &json)
}

/// 导出的文件名：只留文件名本身（不带目录），去掉 Windows 不让用的字符，只认这几种后缀。
fn safe_name(name: &str) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let clean: String = base
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"|?*".contains(*c))
        .collect();
    let clean = clean.trim().trim_matches('.').to_string();
    let lower = clean.to_lowercase();
    let ok = [".json", ".ics", ".md", ".txt"]
        .iter()
        .any(|ext| lower.ends_with(ext) && lower.len() > ext.len());
    if ok && clean.chars().count() <= 120 {
        Some(clean)
    } else {
        None
    }
}

/// 同名文件已经有了就在后面加 (2)、(3)……，不覆盖别人的文件。
fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) => (&name[..i], &name[i..]),
        None => (name, ""),
    };
    for n in 2..1000 {
        let next = dir.join(format!("{} ({}){}", stem, n, ext));
        if !next.exists() {
            return next;
        }
    }
    first
}

/// 导出备份 / 日历 / 周报：写到“下载”文件夹，返回写到了哪。
#[tauri::command]
fn export_file(
    app: AppHandle,
    window: tauri::WebviewWindow,
    name: String,
    text: String,
) -> Result<String, String> {
    only_main(&window)?;
    let name = safe_name(&name).ok_or("文件名不对")?;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = free_path(&dir, &name);
    fs::write(&path, text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// 界面说：退出前要写的数据写完了。
#[tauri::command]
fn flush_done() {
    FLUSHED.store(true, Ordering::SeqCst);
}

/// 从托盘退出：先让界面把还没写盘的改动写完（最多等 1.5 秒），再真正退出。
fn quit_app(app: &AppHandle) {
    if QUITTING.swap(true, Ordering::SeqCst) {
        return; // 已经在退了
    }
    if app.get_webview_window("main").is_none() || app.emit_to("main", "flush", ()).is_err() {
        app.exit(0);
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        let until = Instant::now() + Duration::from_millis(1500);
        while !FLUSHED.load(Ordering::SeqCst) && Instant::now() < until {
            thread::sleep(Duration::from_millis(20));
        }
        app.exit(0);
    });
}

fn transcoded() -> Option<PathBuf> {
    let base = std::env::var("APPDATA").ok()?;
    Some(
        PathBuf::from(base)
            .join("Microsoft")
            .join("Windows")
            .join("Themes")
            .join("TranscodedWallpaper"),
    )
}

/// 读取 Windows 当前壁纸，界面用它在组件内部做玻璃模糊。
/// 先读系统转码后的那份（TranscodedWallpaper）；没有的话读系统记着的原图。
#[tauri::command]
fn wallpaper() -> Result<tauri::ipc::Response, String> {
    let first = transcoded().and_then(|p| fs::read(p).ok());
    let bytes = match first {
        Some(bytes) if !bytes.is_empty() => bytes,
        _ => {
            let path = desk::wallpaper_path();
            if path.is_empty() {
                return Err("没有壁纸图片".to_string());
            }
            fs::read(path).map_err(|e| e.to_string())?
        }
    };
    Ok(tauri::ipc::Response::new(bytes))
}

/// 注册表里的“契合度”换成界面认的说法。平铺、跨区界面按填充画。
fn wall_style(style: &str, tile: &str) -> &'static str {
    match (style.trim(), tile.trim()) {
        ("2", _) => "stretch",
        ("6", _) => "fit",
        ("0", "1") => "tile",
        ("0", _) => "center",
        _ => "fill",
    }
}

#[derive(Serialize)]
struct WallInfo {
    /// 桌面是纯色（没有壁纸图片）
    solid: bool,
    /// 桌面的背景色（纯色时就是它；有壁纸时是壁纸铺不到的地方露出来的颜色）
    color: [u8; 3],
    style: &'static str,
}

/// 桌面背景现在是什么：有没有壁纸图片、怎么摆的、背景色。
#[tauri::command]
fn wallpaper_info() -> WallInfo {
    let desktop = r"Control Panel\Desktop";
    let style = desk::reg_text(desktop, "WallpaperStyle").unwrap_or_default();
    let tile = desk::reg_text(desktop, "TileWallpaper").unwrap_or_default();
    WallInfo {
        solid: desk::wallpaper_path().is_empty(),
        color: desk::desktop_color(),
        style: wall_style(&style, &tile),
    }
}

/// 桌面背景的“指纹”：壁纸路径、摆法、背景色，加上转码文件的大小和修改时间。
/// 哪一样变了都说明用户换了壁纸（或者换成了纯色），后台循环发现后通知界面重读，不用重启。
#[derive(PartialEq, Clone, Default, Debug)]
struct WallSig {
    path: String,
    style: String,
    color: [u8; 3],
    size: u64,
    mtime: u128,
}

fn wall_sig() -> WallSig {
    let desktop = r"Control Panel\Desktop";
    let meta = transcoded().and_then(|p| fs::metadata(p).ok());
    WallSig {
        path: desk::wallpaper_path(),
        style: format!(
            "{}/{}",
            desk::reg_text(desktop, "WallpaperStyle").unwrap_or_default(),
            desk::reg_text(desktop, "TileWallpaper").unwrap_or_default()
        ),
        color: desk::desktop_color(),
        size: meta.as_ref().map_or(0, |m| m.len()),
        mtime: meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis()),
    }
}

// ---------- 窗口行为 ----------

/// 窗口摆好以后的几何信息，都是物理像素、[x, y, 宽, 高]。界面靠它把玻璃里的壁纸对到屏幕上。
#[derive(Serialize, Clone, Copy)]
struct Geo {
    /// 主窗口
    win: [i32; 4],
    /// 窗口所在的整块显示器（壁纸铺满的范围）
    mon: [i32; 4],
    /// 工作区：显示器去掉任务栏的部分
    work: [i32; 4],
    scale: f64,
}

/// 直接问系统要显示器的范围和工作区（任务栏在哪一边、多高，都体现在工作区里）。系统函数在 desk.rs 里。
fn system_rects(window: &tauri::WebviewWindow) -> Option<([i32; 4], [i32; 4])> {
    main_hwnd(window).and_then(desk::window_rects)
}

/// 窗口所在显示器的整块范围和工作区。系统那边问不到时，退回窗口框架给的显示器范围（当作没有任务栏）。
fn screen_rects(window: &tauri::WebviewWindow) -> Option<([i32; 4], [i32; 4])> {
    if let Some(found) = system_rects(window) {
        return Some(found);
    }
    let monitor = window.current_monitor().ok()??;
    let all = [
        monitor.position().x,
        monitor.position().y,
        monitor.size().width as i32,
        monitor.size().height as i32,
    ];
    Some((all, all))
}

/// 窗口该摆在哪（物理像素 [x, y, 宽, 高]）：宽 WINDOW_WIDTH（工作区更窄就以工作区为准），高度占满工作区，
/// 贴工作区的左边（tl / bl）或右边（tr / br，认不出来的也当右边）。
fn place_rect(work: [i32; 4], scale: f64, corner: &str) -> [i32; 4] {
    let width = ((WINDOW_WIDTH * scale).round() as i32).min(work[2]).max(1);
    let height = work[3].max(1);
    let x = if corner.ends_with('l') {
        work[0]
    } else {
        work[0] + work[2] - width
    };
    [x, work[1], width, height]
}

/// 把主窗口贴到工作区的左边或右边，高度占满工作区（避开任务栏）。
/// corner：tr 右上（默认）/ tl 左上 / br 右下 / bl 左下。上下只影响界面在窗口里靠哪头，窗口本身不用动。
fn place(window: &tauri::WebviewWindow, corner: &str) -> Result<Geo, String> {
    let (mon, work) = screen_rects(window).ok_or("读不到显示器信息")?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let [x, y, width, height] = place_rect(work, scale, corner);
    window
        .set_size(PhysicalSize::new(width as u32, height as u32))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(Geo {
        win: [x, y, width, height],
        mon,
        work,
        scale,
    })
}

/// 界面选了停靠的角（或者发现屏幕变了）：重新摆窗口，把几何信息交回去。
#[tauri::command]
fn set_corner(app: AppHandle, state: State<'_, Shared>, corner: String) -> Result<Geo, String> {
    let window = app.get_webview_window("main").ok_or("找不到主窗口")?;
    if let Ok(mut hit) = state.lock() {
        hit.left = corner.ends_with('l');
    }
    place(&window, &corner)
}

/// 上次选的停靠角，从数据文件里读（界面还没起来，先按它摆，免得窗口先在右边闪一下再跳到左边）。
fn saved_corner(app: &AppHandle) -> String {
    let text = data_dir(app)
        .ok()
        .and_then(|dir| fs::read_to_string(dir.join("data.json")).ok())
        .unwrap_or_default();
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|data| data["settings"]["corner"].as_str().map(str::to_string))
        .unwrap_or_else(|| "tr".to_string())
}

#[tauri::command]
fn set_hit_rects(state: State<'_, Shared>, rects: Vec<[f64; 4]>) {
    if let Ok(mut hit) = state.lock() {
        hit.rects = rects;
    }
}

/// 界面按下 / 松开拖动时调用。hold 为 true 期间，光标在窗口哪里都当作落在玻璃上。
#[tauri::command]
fn set_hit_hold(state: State<'_, Shared>, hold: bool) {
    if let Ok(mut hit) = state.lock() {
        hit.hold = if hold { Some(Instant::now()) } else { None };
    }
}

#[tauri::command]
fn set_locked(app: AppHandle, state: State<'_, Shared>, locked: bool) {
    if let Ok(mut hit) = state.lock() {
        hit.locked = locked;
    }
    let _ = app.emit("locked", locked);
}

fn toggle_lock(app: &AppHandle, shared: &Shared) {
    let locked = match shared.lock() {
        Ok(mut hit) => {
            hit.locked = !hit.locked;
            hit.locked
        }
        Err(_) => return,
    };
    let _ = app.emit("locked", locked);
}

// ---------- 贴边自动收起 ----------

/// 光标是不是停在小组件停靠的那条屏幕边上：横向离那条边不超过 band，纵向在窗口的高度范围里。
/// work 是工作区、win 是窗口，都是物理像素 [x, y, 宽, 高]。
fn at_edge(cursor: (f64, f64), work: [i32; 4], win: [i32; 4], left: bool, band: f64) -> bool {
    let (x, y) = cursor;
    let top = win[1] as f64;
    let bottom = (win[1] + win[3]) as f64;
    if y < top || y > bottom {
        return false;
    }
    if left {
        x <= work[0] as f64 + band
    } else {
        x >= (work[0] + work[2]) as f64 - 1.0 - band
    }
}

/// 贴边收起的状态机要外壳做什么。
#[derive(PartialEq, Debug, Clone, Copy)]
enum EdgeCmd {
    None,
    /// 叫界面滑出来
    Peek,
    /// 问界面“鼠标走开了，能收回去吗”
    Leave,
}

/// 贴边收起的迟滞：记着光标是从什么时候开始停在边上 / 离开小组件的。时间一律用毫秒数传进来，方便测试。
#[derive(Default)]
struct Edge {
    dwell: Option<u64>,
    away: Option<u64>,
    asked: Option<u64>,
}

impl Edge {
    /// 每一轮调用一次。hidden：界面现在是收起的；edge：光标在那条屏幕边上；inside：光标在小组件上（或者正在拖东西）。
    fn step(&mut self, now: u64, hidden: bool, edge: bool, inside: bool) -> EdgeCmd {
        if hidden {
            self.away = None;
            self.asked = None;
            if !edge {
                self.dwell = None;
                return EdgeCmd::None;
            }
            let since = *self.dwell.get_or_insert(now);
            if now.saturating_sub(since) >= EDGE_PEEK_MS {
                self.dwell = None;
                return EdgeCmd::Peek;
            }
            return EdgeCmd::None;
        }
        self.dwell = None;
        if inside || edge {
            self.away = None;
            self.asked = None;
            return EdgeCmd::None;
        }
        let since = *self.away.get_or_insert(now);
        if now.saturating_sub(since) < EDGE_LEAVE_MS {
            return EdgeCmd::None;
        }
        // 问过了界面没收（正忙）：隔一阵再问
        match self.asked {
            Some(at) if now.saturating_sub(at) < EDGE_ASK_MS => EdgeCmd::None,
            _ => {
                self.asked = Some(now);
                EdgeCmd::Leave
            }
        }
    }
}

/// 后台循环多久转一圈（毫秒）。平常 40；用户开了“鼠标穿透”、又是贴在桌面、没在拖东西、也没开贴边收起时，
/// 用不着盯光标了（窗口一直是穿透的），放慢到 400 省电。“显示桌面”有 desk 的通知叫醒，不靠这个间隔。
fn tick_ms(locked: bool, top: bool, holding: bool, edge: bool) -> u64 {
    if locked && !top && !holding && !edge {
        400
    } else {
        40
    }
}

#[tauri::command]
fn set_edge(state: State<'_, Shared>, on: bool) {
    if let Ok(mut hit) = state.lock() {
        hit.edge = on;
        if !on {
            hit.edge_hidden = false;
        }
    }
}

/// 界面报：现在是收起的 / 滑出来了。
#[tauri::command]
fn set_edge_hidden(state: State<'_, Shared>, hidden: bool) {
    if let Ok(mut hit) = state.lock() {
        hit.edge_hidden = hidden && hit.edge;
    }
}

// ---------- 临时置顶（Alt+W） ----------

/// 按用户选的层级把主窗口放回去：贴在桌面（所有窗口之下）或始终置顶。
/// 顺序有讲究：先撤掉旧的那个，再设新的。
/// 反过来的话，后撤掉的那一步会把窗口放回“普通窗口”，刚设的置顶 / 置底就白设了。
fn apply_layer(window: &tauri::WebviewWindow, top: bool) -> Result<(), String> {
    if top {
        window
            .set_always_on_bottom(false)
            .map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())
    } else {
        window.set_always_on_top(false).map_err(|e| e.to_string())?;
        window.set_always_on_bottom(true).map_err(|e| e.to_string())
    }
}

/// 临时把小组件叫到所有窗口前面；再叫一次（或者它失去焦点）放回原来的层。want：None 是切换。
fn summon_main(app: &AppHandle, shared: &Shared, want: Option<bool>) {
    let (on, top) = match shared.lock() {
        Ok(mut hit) => {
            let on = want.unwrap_or(hit.summoned.is_none());
            if on == hit.summoned.is_some() {
                return;
            }
            hit.summoned = if on { Some(Instant::now()) } else { None };
            (on, hit.top)
        }
        Err(_) => return,
    };
    if let Some(window) = app.get_webview_window("main") {
        if on {
            let _ = window.unminimize();
            let _ = apply_layer(&window, true);
            let _ = window.set_focus();
        } else {
            let _ = apply_layer(&window, top);
        }
    }
    let _ = app.emit_to("main", "summon", on);
}

#[tauri::command]
fn summon(app: AppHandle, state: State<'_, Shared>) {
    summon_main(&app, state.inner(), None);
}

/// 贴在桌面（所有窗口之下）还是始终置顶。
#[tauri::command]
fn set_layer(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Shared>,
    top: bool,
) -> Result<(), String> {
    only_main(&window)?;
    let window = app.get_webview_window("main").ok_or("找不到主窗口")?;
    let summoned = match state.lock() {
        Ok(mut hit) => {
            hit.top = top;
            hit.summoned.is_some()
        }
        Err(_) => false,
    };
    if summoned {
        return Ok(()); // 临时置顶中：先记着，放回去的时候按新选的层
    }
    apply_layer(&window, top)
}

/// 任务管理器“启动”页里那一条的状态：第一个字节是偶数（02 / 06）算开着，奇数（03 / 07）是被关掉了；没有这一条也算开着。
fn approved_on(first: Option<u8>) -> bool {
    first.map_or(true, |b| b % 2 == 0)
}

/// 开机自启现在是不是真的生效：Run 里有这一条，而且没在任务管理器里被关掉。
#[tauri::command]
fn get_autostart() -> bool {
    desk::reg_text(RUN_SUBKEY, "Jinjian").map_or(false, |v| !v.trim().is_empty())
        && approved_on(desk::reg_first_byte(APPROVED_KEY, "Jinjian"))
}

fn reg_run(args: &[&str]) -> Result<(), String> {
    let mut cmd = std::process::Command::new("reg");
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // 不弹黑色命令行窗口
    }
    cmd.status().map(|_| ()).map_err(|e| e.to_string())
}

/// 开机自启：在当前用户的“启动项”注册表里加 / 删一条。
/// 打开时顺手把任务管理器“启动”页里那条“已禁用”的记录清掉：
/// 不清的话 Run 里明明有这一条，系统却照着那条记录不启动，开关看着是开的、实际不生效。
#[tauri::command]
fn set_autostart(window: tauri::WebviewWindow, on: bool) -> Result<(), String> {
    only_main(&window)?;
    let approved = format!(r"HKCU\{}", APPROVED_KEY);
    if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let value = format!("\"{}\"", exe.display());
        reg_run(&[
            "add", RUN_KEY, "/v", "Jinjian", "/t", "REG_SZ", "/d", &value, "/f",
        ])?;
        let _ = reg_run(&["delete", &approved, "/v", "Jinjian", "/f"]);
        Ok(())
    } else {
        reg_run(&["delete", RUN_KEY, "/v", "Jinjian", "/f"])
    }
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

/// 主窗口的系统句柄，给“显示桌面”的处理用。
#[cfg(windows)]
fn main_hwnd(window: &tauri::WebviewWindow) -> Option<isize> {
    window.hwnd().ok().map(|h| h.0 as isize)
}

#[cfg(not(windows))]
fn main_hwnd(_window: &tauri::WebviewWindow) -> Option<isize> {
    None
}

// ---------- 快速记录窗口 ----------

/// 把 size 这么大的窗口放在 work（工作区，物理像素 [x, y, 宽, 高]）正中间，返回左上角。窗口比工作区大就贴着左上。
fn center_in(work: [i32; 4], size: (i32, i32)) -> (i32, i32) {
    (
        work[0] + ((work[2] - size.0) / 2).max(0),
        work[1] + ((work[3] - size.1) / 2).max(0),
    )
}

/// 弹出快速记录窗口：出现在光标所在的那块显示器正中间（多显示器时不用把头转回主屏）。
fn show_capture(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        match desk::cursor_work() {
            Some(work) => {
                // 挪到另一块缩放不一样的屏上以后窗口大小会变，再摆一次才是正中
                for _ in 0..2 {
                    if let Ok(size) = window.outer_size() {
                        let (x, y) = center_in(work, (size.width as i32, size.height as i32));
                        let _ = window.set_position(PhysicalPosition::new(x, y));
                    }
                }
            }
            None => {
                let _ = window.center();
            }
        }
        if let Ok(mut at) = CAPTURE_AT.lock() {
            *at = Some(Instant::now());
        }
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("capture-open", ());
    }
}

/// 收起快速记录窗口。blur 为真表示是“失去焦点”引起的：刚弹出来的 400 毫秒里不理它
/// （弹出的那一下系统有时会先把焦点给别的窗口再还回来，窗口会一闪就没）。
#[tauri::command]
fn hide_capture(app: AppHandle, blur: Option<bool>) {
    if blur.unwrap_or(false) {
        let fresh = CAPTURE_AT
            .lock()
            .ok()
            .and_then(|at| *at)
            .map_or(false, |t| t.elapsed() < Duration::from_millis(400));
        if fresh {
            return;
        }
    }
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.hide();
    }
}

/// 快速记录窗口保存时调用：把内容转给主窗口，然后收起自己。
#[tauri::command]
fn capture_submit(app: AppHandle, payload: String) {
    let _ = app.emit_to("main", "capture", payload);
    hide_capture(app, None);
}

/// 没注册上的全局快捷键（被别的程序占用了）。
#[tauri::command]
fn hotkey_status() -> Vec<String> {
    HOTKEYS_TAKEN.lock().map(|v| v.clone()).unwrap_or_default()
}

// ---------- iCloud ----------

#[tauri::command]
fn cred_set(window: tauri::WebviewWindow, user: String, pass: String) -> Result<(), String> {
    only_main(&window)?;
    keyring::Entry::new(CRED_SERVICE, &user)
        .and_then(|entry| entry.set_password(&pass))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cred_delete(window: tauri::WebviewWindow, user: String) -> Result<(), String> {
    only_main(&window)?;
    keyring::Entry::new(CRED_SERVICE, &user)
        .and_then(|entry| entry.delete_credential())
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct DavReq {
    method: String,
    url: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
    body: Option<String>,
    user: String,
    pass: Option<String>,
}

#[derive(Serialize)]
struct DavRes {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

/// 整个程序共用一个网络客户端，连接可以复用。
fn http() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .user_agent("Jinjian")
        .build()
        .map_err(|e| e.to_string())?;
    Ok(CLIENT.get_or_init(|| client))
}

/// 只放行 iCloud 的服务器：icloud.com 和它的子域名，以及中国大陆的 icloud.com.cn（云上贵州运营）。
/// 必须是整段域名对得上：“evilicloud.com”“icloud.com.evil.net”这种都不算。
fn icloud_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    ["icloud.com", "icloud.com.cn"]
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{}", d)))
}

/// 替界面发一个 CalDAV 请求。只允许发往 iCloud，密码默认从凭据管理器取。
/// 不自动跟随跳转（跳转时方法会被改成 GET），交给界面自己重发。
#[tauri::command]
async fn dav(window: tauri::WebviewWindow, req: DavReq) -> Result<DavRes, String> {
    only_main(&window)?;
    let _busy = Busy::new();
    let url = reqwest::Url::parse(&req.url).map_err(|e| e.to_string())?;
    let host = url.host_str().unwrap_or("").to_string();
    if url.scheme() != "https" || !icloud_host(&host) {
        return Err(format!("只允许访问 iCloud（{}）", host));
    }
    let pass = match req.pass {
        Some(p) if !p.is_empty() => p,
        _ => {
            // 凭据管理器是同步的系统调用，偶尔会卡一下（系统在解锁保管库）：放到阻塞线程池里，不占着异步运行时
            let user = req.user.clone();
            tauri::async_runtime::spawn_blocking(move || {
                keyring::Entry::new(CRED_SERVICE, &user).and_then(|entry| entry.get_password())
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|_| "auth".to_string())?
        }
    };
    let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut builder = http()?
        .request(method, url)
        .basic_auth(&req.user, Some(pass));
    for (name, value) in &req.headers {
        builder = builder.header(name.as_str(), value.as_str());
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }
    let res = builder.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let headers = res
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(DavRes {
        status,
        headers,
        body,
    })
}

/// 主窗口被系统销毁了（不是用户退出）：重开进程之前先把能保住的保住。
///   1. 等还在写盘、还在等 iCloud 应答的命令做完（最多 2 秒），不在它们写到一半时退出；
///   2. 上一次写盘要是停在“临时文件写好了、还没替换”，把替换做完；
///   3. 等桌面（资源管理器）回来（最多 10 秒）再重开：它正在重启的那几秒里重开，窗口会按没有任务栏的屏幕摆错位置，
///      也挂不回桌面名下。
/// 然后才重开。Tauri 重开前会先放掉“只能开一个”的锁，新进程不会把自己当成第二个而退出。
fn recover(app: AppHandle) {
    if QUITTING.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || {
        let until = Instant::now() + Duration::from_secs(2);
        while BUSY.load(Ordering::SeqCst) > 0 && Instant::now() < until {
            thread::sleep(Duration::from_millis(20));
        }
        if let Ok(dir) = data_dir(&app) {
            finish_pending(&dir);
        }
        let until = Instant::now() + Duration::from_secs(10);
        while !desk::shell_ready() && Instant::now() < until {
            thread::sleep(Duration::from_millis(200));
        }
        app.restart();
    });
}

// ---------- 启动 ----------

fn main() {
    let started = Instant::now();
    let shared: Shared = Arc::new(Mutex::new(Hit::default()));
    let for_thread = shared.clone();
    let for_tray = shared.clone();
    let for_keys = shared.clone();
    let for_events = shared.clone();

    tauri::Builder::default()
        // 只允许开一个今笺：两个同时开着会互相覆盖数据。
        // 再打开一次时，新开的那个直接退出，已经开着的这个把自己亮出来。必须第一个注册。
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
            }
            let _ = app.emit_to("main", "second-instance", ());
            let _ = app
                .notification()
                .builder()
                .title("今笺已经在运行")
                .body("它在桌面上；被窗口挡住时按 Win + D 就能看到。")
                .show();
        }))
        .plugin(tauri_plugin_notification::init())
        .manage(shared)
        .setup(move |app| {
            let window = app.get_webview_window("main").ok_or("找不到主窗口")?;

            // 上一次要是停在“临时文件写好了、还没替换”（进程被杀、断电），先把替换做完，再让界面去读
            if let Ok(dir) = data_dir(app.handle()) {
                finish_pending(&dir);
            }

            // 贴到工作区的一侧（默认右边），高度占满工作区。摆不成就留在系统给的位置，界面起来后还会再摆一次。
            let corner = saved_corner(app.handle());
            if let Ok(mut hit) = for_keys.lock() {
                hit.left = corner.ends_with('l');
            }
            let _ = place(&window, &corner);
            window.show()?;

            // 全局快捷键：Alt+Q 快速记录，Alt+L 开关鼠标穿透，Alt+W 临时置顶。
            // 被别的程序占用的记下来，界面在设置里说一声是哪几个。
            let key_q = Shortcut::new(Some(Modifiers::ALT), Code::KeyQ);
            let key_l = Shortcut::new(Some(Modifiers::ALT), Code::KeyL);
            let key_w = Shortcut::new(Some(Modifiers::ALT), Code::KeyW);
            let for_summon = for_keys.clone();
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, shortcut, event| {
                        if event.state() != ShortcutState::Pressed {
                            return;
                        }
                        if shortcut == &key_q {
                            show_capture(app);
                        } else if shortcut == &key_l {
                            toggle_lock(app, &for_keys);
                        } else if shortcut == &key_w {
                            summon_main(app, &for_summon, None);
                        }
                    })
                    .build(),
            )?;
            let mut taken: Vec<String> = Vec::new();
            for (key, name) in [(key_q, "Alt + Q"), (key_l, "Alt + L"), (key_w, "Alt + W")] {
                if app.global_shortcut().register(key).is_err() {
                    taken.push(name.to_string());
                }
            }
            if let Ok(mut list) = HOTKEYS_TAKEN.lock() {
                *list = taken.clone();
            }
            let _ = app.emit_to("main", "hotkeys", taken);

            // 托盘：穿透后界面点不到，可以从这里解除。
            let capture =
                MenuItem::with_id(app, "capture", "快速记录（Alt+Q）", true, None::<&str>)?;
            let toggle = MenuItem::with_id(
                app,
                "toggle_lock",
                "切换鼠标穿透（Alt+L）",
                true,
                None::<&str>,
            )?;
            let front = MenuItem::with_id(
                app,
                "summon",
                "临时置顶 / 放回（Alt+W）",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "退出今笺", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&capture, &toggle, &front, &quit])?;
            let mut tray = TrayIconBuilder::new().tooltip("今笺").menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            let for_tray_summon = for_tray.clone();
            tray.on_menu_event(move |app, event| match event.id.as_ref() {
                "quit" => quit_app(app),
                "capture" => show_capture(app),
                "toggle_lock" => toggle_lock(app, &for_tray),
                "summon" => summon_main(app, &for_tray_summon, None),
                _ => {}
            })
            .build(app)?;

            // 窗口比玻璃区域大，透明的地方要让鼠标落到桌面上：
            // 每 40 毫秒看一次光标在不在界面上报的区域里，据此开关“忽略鼠标”。
            // 同一个循环里顺便照看“显示桌面”（Win + D，细节见 desk.rs）、贴边自动收起、壁纸有没有换。
            // 桌面附近的窗口顺序一变，desk 会通过这条通道立刻叫醒循环，不用等到下一轮。
            let win = window.clone();
            let handle = app.handle().clone();
            let (wake_tx, wake_rx) = mpsc::channel::<()>();
            let wake_tx = Mutex::new(wake_tx);
            let desk = main_hwnd(&window).and_then(|hwnd| {
                desk::Desk::new(
                    hwnd,
                    Box::new(move || {
                        if let Ok(tx) = wake_tx.lock() {
                            let _ = tx.send(());
                        }
                    }),
                )
            });
            thread::spawn(move || {
                let begun = Instant::now();
                let mut tick = Duration::from_millis(40);
                let mut ignoring: Option<bool> = None;
                let mut raised = false;
                let mut edge = Edge::default();
                let mut checked = Instant::now();
                let mut wall = wall_sig();
                let mut work: Option<[i32; 4]> = None;
                loop {
                    // 没有 desk（或它没用上通道）时通道是断开的，老老实实睡一轮
                    if let Err(mpsc::RecvTimeoutError::Disconnected) = wake_rx.recv_timeout(tick) {
                        thread::sleep(tick);
                    }
                    while wake_rx.try_recv().is_ok() {}
                    if QUITTING.load(Ordering::SeqCst) {
                        break; // 正在退出 / 主窗口没了：别再碰它
                    }
                    let (rects, locked, top, holding, left, edge_on, edge_hidden) =
                        match for_thread.lock() {
                            Ok(hit) => (
                                hit.rects.clone(),
                                hit.locked,
                                hit.top || hit.summoned.is_some(),
                                hit.hold.map_or(false, |t| t.elapsed() < HOLD_MAX),
                                hit.left,
                                hit.edge,
                                hit.edge_hidden,
                            ),
                            Err(_) => continue,
                        };
                    tick = Duration::from_millis(tick_ms(locked, top, holding, edge_on));
                    if let Some(desk) = &desk {
                        if top {
                            desk.detach();
                            raised = false;
                        } else if desk.attach() {
                            // 挂在桌面窗口名下了：系统自己会让小组件跟着桌面走
                            if raised {
                                raised = false;
                                let _ = win.set_always_on_bottom(true);
                            }
                        } else if desk.shown() {
                            if !raised {
                                raised = true;
                                // 显示桌面期间先松开“永远置底”，否则一点小组件它又沉下去
                                let _ = win.set_always_on_bottom(false);
                            }
                            desk.raise();
                        } else if raised {
                            raised = false;
                            desk.lower();
                            let _ = win.set_always_on_bottom(true);
                        }
                    }
                    // 约每两秒一次的杂事：被别的程序最小化了（比如“全部最小化”）就自己恢复；
                    // 看一眼桌面背景换了没有；工作区（任务栏的位置）重新量一次
                    if checked.elapsed() >= Duration::from_secs(2) {
                        checked = Instant::now();
                        if win.is_minimized().unwrap_or(false) {
                            let _ = win.unminimize();
                        }
                        let now = wall_sig();
                        if now != wall {
                            wall = now;
                            let _ = handle.emit_to("main", "wallpaper-changed", ());
                        }
                        work = screen_rects(&win).map(|r| r.1);
                    }
                    let cursor = win.cursor_position().ok().map(|c| (c.x, c.y));
                    let origin = win.outer_position().ok();
                    let mut inside = false;
                    if !locked && holding {
                        // 正在拖动：不管光标在哪都保持可点击
                        inside = true;
                    } else if !locked {
                        if let (Some(cursor), Some(origin)) = (cursor, origin) {
                            let x = cursor.0 - origin.x as f64;
                            let y = cursor.1 - origin.y as f64;
                            inside = rects
                                .iter()
                                .any(|r| x >= r[0] && y >= r[1] && x <= r[2] && y <= r[3]);
                        }
                    }
                    // 贴边自动收起：收着的时候窗口整个穿透（那条细线只是给人看的），靠光标在屏幕边上停一下来叫它出来
                    if edge_on {
                        let size = win.outer_size().ok();
                        let near = match (
                            cursor,
                            origin,
                            size,
                            work.or_else(|| screen_rects(&win).map(|r| r.1)),
                        ) {
                            (Some(cursor), Some(origin), Some(size), Some(work)) => at_edge(
                                cursor,
                                work,
                                [origin.x, origin.y, size.width as i32, size.height as i32],
                                left,
                                EDGE_BAND,
                            ),
                            _ => false,
                        };
                        let now = begun.elapsed().as_millis() as u64;
                        match edge.step(now, edge_hidden, near, inside) {
                            EdgeCmd::Peek => {
                                let _ = handle.emit_to("main", "edge-peek", ());
                            }
                            EdgeCmd::Leave => {
                                let _ = handle.emit_to("main", "edge-leave", ());
                            }
                            EdgeCmd::None => {}
                        }
                        if edge_hidden {
                            inside = false;
                        }
                    }
                    let want = !inside;
                    if ignoring != Some(want) && win.set_ignore_cursor_events(want).is_ok() {
                        ignoring = Some(want);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(move |window, event| match event {
            // 小组件没有关闭按钮；Alt + F4 之类的关闭请求一律不理，退出走托盘菜单。
            // 快速记录窗口则是收起来，下次还要用。
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if window.label() != "main" {
                    let _ = window.hide();
                }
            }
            // 主窗口被系统销毁了（不是用户退出）：重开一个，免得只剩托盘图标。
            // 比如资源管理器重启时，挂在桌面名下的小组件会被连带销毁。
            // 刚启动就没了多半是别的问题，不反复重开。
            // 不是立刻重开：先等手上的写盘做完、等桌面回来，见 recover()。
            WindowEvent::Destroyed
                if window.label() == "main"
                    && !QUITTING.load(Ordering::SeqCst)
                    && started.elapsed() > Duration::from_secs(10) =>
            {
                recover(window.app_handle().clone());
            }
            // 临时置顶（Alt+W）时点到了别的窗口：放回原来的层。刚置顶那一下的失焦不算。
            WindowEvent::Focused(false) if window.label() == "main" => {
                let due = for_events
                    .lock()
                    .ok()
                    .and_then(|hit| hit.summoned)
                    .map_or(false, |t| t.elapsed() > Duration::from_millis(400));
                if due {
                    summon_main(window.app_handle(), &for_events, Some(false));
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            load_remote_cache,
            save_remote_cache,
            get_holidays,
            save_data,
            export_file,
            flush_done,
            wallpaper,
            wallpaper_info,
            set_hit_rects,
            set_hit_hold,
            set_corner,
            set_locked,
            set_layer,
            set_edge,
            set_edge_hidden,
            summon,
            set_autostart,
            get_autostart,
            notify,
            hide_capture,
            capture_submit,
            hotkey_status,
            cred_set,
            cred_delete,
            dav
        ])
        .run(tauri::generate_context!())
        .expect("今笺启动失败");
}

// ---------- 测试：不依赖系统、不依赖窗口的纯计算。CI 在打包前跑 cargo test ----------

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个测试一个自己的临时目录，测完删掉。
    struct Tmp(PathBuf);
    impl Tmp {
        fn new(name: &str) -> Tmp {
            let dir = std::env::temp_dir().join(format!(
                "jinjian-test-{}-{}-{:?}",
                name,
                std::process::id(),
                thread::current().id()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Tmp(dir)
        }
        fn read(&self, name: &str) -> String {
            fs::read_to_string(self.0.join(name)).unwrap_or_default()
        }
        fn write(&self, name: &str, text: &str) {
            fs::write(self.0.join(name), text).unwrap();
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn save_then_load_round_trip_keeps_a_backup() {
        let t = Tmp::new("roundtrip");
        write_atomic(&t.0, "data.json", r#"{"items":[1]}"#).unwrap();
        assert_eq!(t.read("data.json"), r#"{"items":[1]}"#);
        assert!(!t.0.join("data.json.tmp").exists(), "临时文件要被替换掉");
        let got = read_with_backup(&t.0, "data.json", "data.bak.json", Some("data.broken.json"));
        assert_eq!(got, r#"{"items":[1]}"#);
        assert_eq!(
            t.read("data.bak.json"),
            r#"{"items":[1]}"#,
            "读到完好的才覆盖备份"
        );
        // 再存一份新的：正式文件换了，备份还是上一次读到的那份
        write_atomic(&t.0, "data.json", r#"{"items":[1,2]}"#).unwrap();
        assert_eq!(t.read("data.json"), r#"{"items":[1,2]}"#);
        assert_eq!(t.read("data.bak.json"), r#"{"items":[1]}"#);
    }

    #[test]
    fn broken_data_falls_back_to_backup_and_is_kept_aside() {
        let t = Tmp::new("broken");
        t.write("data.bak.json", r#"{"items":["好的"]}"#);
        t.write("data.json", r#"{"items":["写了一半"#);
        let got = read_with_backup(&t.0, "data.json", "data.bak.json", Some("data.broken.json"));
        assert_eq!(got, r#"{"items":["好的"]}"#);
        assert_eq!(t.read("data.broken.json"), r#"{"items":["写了一半"#);
        assert_eq!(
            t.read("data.bak.json"),
            r#"{"items":["好的"]}"#,
            "坏文件不能盖掉备份"
        );
    }

    #[test]
    fn nothing_readable_gives_empty_string() {
        let t = Tmp::new("empty");
        assert_eq!(
            read_with_backup(&t.0, "data.json", "data.bak.json", Some("data.broken.json")),
            ""
        );
        assert!(!t.0.join("data.broken.json").exists(), "没有文件不算坏文件");
        t.write("data.json", "不是 JSON");
        t.write("data.bak.json", "也不是");
        assert_eq!(
            read_with_backup(&t.0, "data.json", "data.bak.json", Some("data.broken.json")),
            ""
        );
    }

    #[test]
    fn remote_cache_is_its_own_file_with_its_own_backup() {
        let t = Tmp::new("cache");
        write_atomic(&t.0, "data.json", r#"{"items":[]}"#).unwrap();
        write_atomic(&t.0, "remote_cache.json", r#"{"res":{"a":1}}"#).unwrap();
        assert_eq!(t.read("data.json"), r#"{"items":[]}"#, "缓存和数据互不相干");
        let got = read_with_backup(&t.0, "remote_cache.json", "remote_cache.bak.json", None);
        assert_eq!(got, r#"{"res":{"a":1}}"#);
        // 缓存写坏了：退回上一份；缓存不留“坏文件”的副本（丢了也只是重新同步一次）
        t.write("remote_cache.json", "{坏");
        let got = read_with_backup(&t.0, "remote_cache.json", "remote_cache.bak.json", None);
        assert_eq!(got, r#"{"res":{"a":1}}"#);
        assert!(!t.0.join("data.broken.json").exists());
        assert_eq!(t.read("data.json"), r#"{"items":[]}"#);
    }

    #[test]
    fn interrupted_write_is_finished_or_discarded() {
        let t = Tmp::new("pending");
        // 临时文件是完整的、正式文件还没有：把替换做完
        t.write("data.json.tmp", r#"{"items":["新"]}"#);
        // 缓存的临时文件只写了一半：扔掉，正式文件不动
        t.write("remote_cache.json", r#"{"res":{}}"#);
        t.write("remote_cache.json.tmp", r#"{"res":{"半"#);
        assert_eq!(finish_pending(&t.0), 1);
        assert_eq!(t.read("data.json"), r#"{"items":["新"]}"#);
        assert!(!t.0.join("data.json.tmp").exists());
        assert_eq!(t.read("remote_cache.json"), r#"{"res":{}}"#);
        assert!(!t.0.join("remote_cache.json.tmp").exists());
        assert_eq!(finish_pending(&t.0), 0, "没有要收尾的");
    }

    #[test]
    fn only_icloud_hosts_are_allowed() {
        for host in [
            "icloud.com",
            "caldav.icloud.com",
            "p42-caldav.icloud.com",
            "caldav.icloud.com.cn",
            "p221-caldav.icloud.com.cn",
            "CalDAV.iCloud.com",
            "caldav.icloud.com.",
        ] {
            assert!(icloud_host(host), "{} 应该放行", host);
        }
        for host in [
            "",
            "evilicloud.com",
            "icloud.com.evil.net",
            "icloud.com.cn.evil.net",
            "icloud.co",
            "xicloud.com.cn",
            "caldav.icloud.com@evil.net",
            "localhost",
            "127.0.0.1",
            "icloud.cn",
        ] {
            assert!(!icloud_host(host), "{} 不该放行", host);
        }
    }

    #[test]
    fn sensitive_commands_are_for_the_main_window_only() {
        assert!(label_ok("main"));
        assert!(!label_ok("capture"));
        assert!(!label_ok(""));
        assert!(!label_ok("main2"));
    }

    #[test]
    fn window_goes_to_the_chosen_side_of_the_work_area() {
        // 1920×1080，任务栏在下面 48 高，100% 缩放
        let work = [0, 0, 1920, 1032];
        assert_eq!(place_rect(work, 1.0, "tr"), [992, 0, 928, 1032]);
        assert_eq!(place_rect(work, 1.0, "br"), [992, 0, 928, 1032]);
        assert_eq!(place_rect(work, 1.0, "tl"), [0, 0, 928, 1032]);
        assert_eq!(place_rect(work, 1.0, "bl"), [0, 0, 928, 1032]);
        // 认不出来的角当右上
        assert_eq!(place_rect(work, 1.0, "??"), [992, 0, 928, 1032]);
        // 150% 缩放：窗口是 928 逻辑像素 = 1392 物理像素
        assert_eq!(place_rect(work, 1.5, "tr"), [528, 0, 1392, 1032]);
        // 任务栏在左边 72 宽、副屏在右边（原点不是 0）
        assert_eq!(
            place_rect([72, 0, 1848, 1080], 1.0, "tl"),
            [72, 0, 928, 1080]
        );
        assert_eq!(
            place_rect([1920, 40, 1280, 984], 1.0, "tr"),
            [2272, 40, 928, 984]
        );
    }

    #[test]
    fn narrow_screens_get_a_window_no_wider_than_the_work_area() {
        // 1080×1920 竖屏配 150%：工作区只有 1080 物理像素宽，窗口不能是 1392
        assert_eq!(
            place_rect([0, 0, 1080, 1848], 1.5, "tr"),
            [0, 0, 1080, 1848]
        );
        assert_eq!(
            place_rect([0, 0, 1080, 1848], 1.5, "tl"),
            [0, 0, 1080, 1848]
        );
        // 1280×720 配 150%
        assert_eq!(place_rect([0, 0, 1280, 648], 1.5, "br"), [0, 0, 1280, 648]);
        // 读到了离谱的工作区也不给出 0 或负数的大小
        assert_eq!(place_rect([0, 0, 0, 0], 1.0, "tr"), [-1, 0, 1, 1]);
    }

    #[test]
    fn edge_band_is_the_docked_screen_edge_within_the_window_height() {
        let work = [0, 0, 1920, 1032];
        let win = [992, 0, 928, 1032];
        // 靠右：光标在最右那几列像素上
        assert!(at_edge((1919.0, 500.0), work, win, false, EDGE_BAND));
        assert!(at_edge((1916.0, 0.0), work, win, false, EDGE_BAND));
        assert!(!at_edge((1900.0, 500.0), work, win, false, EDGE_BAND));
        assert!(
            !at_edge((0.0, 500.0), work, win, false, EDGE_BAND),
            "对面那条边不算"
        );
        assert!(
            !at_edge((1919.0, 1060.0), work, win, false, EDGE_BAND),
            "任务栏那一段不算"
        );
        // 靠左
        let win = [0, 0, 928, 1032];
        assert!(at_edge((0.0, 10.0), work, win, true, EDGE_BAND));
        assert!(at_edge((3.0, 10.0), work, win, true, EDGE_BAND));
        assert!(!at_edge((12.0, 10.0), work, win, true, EDGE_BAND));
        assert!(!at_edge((1919.0, 10.0), work, win, true, EDGE_BAND));
        // 任务栏在左边时，“边”是工作区的左边
        assert!(at_edge(
            (73.0, 10.0),
            [72, 0, 1848, 1080],
            [72, 0, 928, 1080],
            true,
            EDGE_BAND
        ));
    }

    #[test]
    fn hidden_widget_peeks_only_after_the_cursor_dwells_on_the_edge() {
        let mut e = Edge::default();
        assert_eq!(e.step(0, true, true, false), EdgeCmd::None);
        assert_eq!(e.step(100, true, true, false), EdgeCmd::None);
        // 中途离开过：重新计时（路过屏幕边缘不算）
        assert_eq!(e.step(150, true, false, false), EdgeCmd::None);
        assert_eq!(e.step(200, true, true, false), EdgeCmd::None);
        assert_eq!(e.step(300, true, true, false), EdgeCmd::None);
        assert_eq!(e.step(200 + EDGE_PEEK_MS, true, true, false), EdgeCmd::Peek);
        // 叫过一次就不连着叫
        assert_eq!(
            e.step(200 + EDGE_PEEK_MS + 40, true, true, false),
            EdgeCmd::None
        );
    }

    #[test]
    fn shown_widget_asks_to_hide_after_the_cursor_stays_away() {
        let mut e = Edge::default();
        // 光标在小组件上、在那条边上：都不算离开
        assert_eq!(e.step(0, false, false, true), EdgeCmd::None);
        assert_eq!(e.step(5000, false, true, false), EdgeCmd::None);
        // 离开了，但没到时间
        assert_eq!(e.step(6000, false, false, false), EdgeCmd::None);
        assert_eq!(
            e.step(6000 + EDGE_LEAVE_MS - 1, false, false, false),
            EdgeCmd::None
        );
        // 中途回来过：重新计时
        assert_eq!(e.step(6500, false, false, true), EdgeCmd::None);
        assert_eq!(e.step(7000, false, false, false), EdgeCmd::None);
        assert_eq!(
            e.step(7000 + EDGE_LEAVE_MS, false, false, false),
            EdgeCmd::Leave
        );
        // 界面正忙没收：不是每一轮都问，隔一阵再问
        assert_eq!(
            e.step(7000 + EDGE_LEAVE_MS + 40, false, false, false),
            EdgeCmd::None
        );
        assert_eq!(
            e.step(7000 + EDGE_LEAVE_MS + EDGE_ASK_MS, false, false, false),
            EdgeCmd::Leave
        );
        // 收起来以后，从头再来
        assert_eq!(e.step(20000, true, false, false), EdgeCmd::None);
        assert_eq!(e.step(20040, false, false, false), EdgeCmd::None);
    }

    #[test]
    fn guard_loop_slows_down_only_when_nothing_needs_the_cursor() {
        assert_eq!(tick_ms(false, false, false, false), 40);
        assert_eq!(
            tick_ms(true, false, false, false),
            400,
            "开了鼠标穿透、贴在桌面、没在拖：放慢"
        );
        assert_eq!(tick_ms(true, true, false, false), 40);
        assert_eq!(tick_ms(true, false, true, false), 40);
        assert_eq!(
            tick_ms(true, false, false, true),
            40,
            "贴边收起要一直盯着光标"
        );
    }

    #[test]
    fn task_manager_startup_toggle_is_respected() {
        assert!(approved_on(None), "任务管理器里没有这一条：算开着");
        assert!(approved_on(Some(0x02)));
        assert!(approved_on(Some(0x06)));
        assert!(!approved_on(Some(0x03)));
        assert!(!approved_on(Some(0x07)));
    }

    #[test]
    fn wallpaper_fit_names() {
        assert_eq!(wall_style("10", "0"), "fill");
        assert_eq!(wall_style("6", "0"), "fit");
        assert_eq!(wall_style("2", "0"), "stretch");
        assert_eq!(wall_style("0", "0"), "center");
        assert_eq!(wall_style("0", "1"), "tile");
        assert_eq!(wall_style("22", "0"), "fill");
        assert_eq!(wall_style("", ""), "fill");
        assert_eq!(wall_style(" 6 ", ""), "fit");
    }

    #[test]
    fn wallpaper_change_is_noticed_by_any_part_of_the_signature() {
        let a = WallSig {
            path: r"C:\a.jpg".to_string(),
            style: "10/0".to_string(),
            color: [0, 0, 0],
            size: 100,
            mtime: 1,
        };
        assert_eq!(a, a.clone());
        assert_ne!(
            a,
            WallSig {
                mtime: 2,
                ..a.clone()
            },
            "同一个路径、文件换了内容"
        );
        assert_ne!(
            a,
            WallSig {
                size: 101,
                ..a.clone()
            }
        );
        assert_ne!(
            a,
            WallSig {
                path: String::new(),
                ..a.clone()
            },
            "换成了纯色"
        );
        assert_ne!(
            a,
            WallSig {
                color: [0, 99, 177],
                ..a.clone()
            },
            "纯色换了一个颜色"
        );
        assert_ne!(
            a,
            WallSig {
                style: "6/0".to_string(),
                ..a.clone()
            },
            "换了摆法"
        );
    }

    #[test]
    fn export_names_are_sanitised() {
        assert_eq!(
            safe_name("今笺备份-2026-11-16-1200.json").as_deref(),
            Some("今笺备份-2026-11-16-1200.json")
        );
        assert_eq!(safe_name("今笺.ics").as_deref(), Some("今笺.ics"));
        assert_eq!(safe_name("周报.md").as_deref(), Some("周报.md"));
        // 不能带着目录往别处写
        assert_eq!(
            safe_name(r"..\..\Startup\x.json").as_deref(),
            Some("x.json")
        );
        assert_eq!(safe_name("../../etc/x.json").as_deref(), Some("x.json"));
        assert_eq!(safe_name(r"C:\Windows\a.ics").as_deref(), Some("a.ics"));
        // 别的后缀、没有名字的不给写
        assert_eq!(safe_name("run.exe"), None);
        assert_eq!(safe_name("a.json.bat"), None);
        assert_eq!(safe_name(".json"), None);
        assert_eq!(safe_name(""), None);
        assert_eq!(safe_name("a<b>:c|d?.json").as_deref(), Some("abcd.json"));
    }

    #[test]
    fn export_never_overwrites_an_existing_file() {
        let t = Tmp::new("export");
        assert_eq!(free_path(&t.0, "a.json"), t.0.join("a.json"));
        t.write("a.json", "1");
        assert_eq!(free_path(&t.0, "a.json"), t.0.join("a (2).json"));
        t.write("a (2).json", "2");
        assert_eq!(free_path(&t.0, "a.json"), t.0.join("a (3).json"));
    }

    #[test]
    fn capture_window_is_centred_on_the_cursor_monitor() {
        assert_eq!(center_in([0, 0, 1920, 1032], (680, 320)), (620, 356));
        // 副屏在右边、原点不是 0
        assert_eq!(center_in([1920, 40, 1280, 984], (680, 320)), (2220, 372));
        // 窗口比工作区还大：贴着左上，不跑到屏幕外面
        assert_eq!(center_in([100, 50, 600, 300], (1020, 480)), (100, 50));
    }
}
