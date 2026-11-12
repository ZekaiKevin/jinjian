// 今笺 Jinjian：桌面玻璃日程小组件的程序外壳。
// 负责：把透明窗口贴在屏幕右上角、放在所有窗口之下、只让玻璃区域接收鼠标、
// 托盘菜单、全局快捷键、快速记录窗口、系统通知、开机自启、
// 本地数据读写、读取系统壁纸，以及替界面向 iCloud 发 CalDAV 请求。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desk;

use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
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

/// 窗口的逻辑宽度：展开的月视图 768 + 两侧边距。
const WINDOW_WIDTH: f64 = 820.0;
/// App 专用密码存在 Windows 凭据管理器里，用这个名字归类。
const CRED_SERVICE: &str = "Jinjian iCloud";
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
/// 用户从托盘点了“退出”。主窗口意外没了要自动重开，正常退出不算。
static QUITTING: AtomicBool = AtomicBool::new(false);

/// 界面上报的可点击区域（相对窗口左上角的物理像素），以及是否处于“鼠标穿透”。
#[derive(Default)]
struct Hit {
    rects: Vec<[f64; 4]>,
    locked: bool,
    /// 用户选了“始终置顶”：这时不挂在桌面上，也不需要管“显示桌面”。
    top: bool,
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

/// 读取数据文件。文件完好才拿它覆盖备份；文件坏了就改用备份，坏文件另存一份留着查。
#[tauri::command]
fn load_data(app: AppHandle) -> Result<String, String> {
    let dir = data_dir(&app)?;
    let file = dir.join("data.json");
    let backup = dir.join("data.bak.json");
    let text = fs::read_to_string(&file).unwrap_or_default();
    if is_json(&text) {
        let _ = fs::write(&backup, &text);
        return Ok(text);
    }
    if !text.is_empty() {
        let _ = fs::write(dir.join("data.broken.json"), &text);
    }
    match fs::read_to_string(&backup) {
        Ok(saved) if is_json(&saved) => Ok(saved),
        _ => Ok(String::new()),
    }
}

/// 先写临时文件再替换，避免写到一半断电把数据写坏。
#[tauri::command]
fn save_data(app: AppHandle, json: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let tmp = dir.join("data.json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("data.json")).map_err(|e| e.to_string())
}

/// 读取 Windows 当前壁纸（系统转码后的那份），界面用它在组件内部做玻璃模糊。
#[tauri::command]
fn wallpaper() -> Result<tauri::ipc::Response, String> {
    let base = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    let path = PathBuf::from(base)
        .join("Microsoft")
        .join("Windows")
        .join("Themes")
        .join("TranscodedWallpaper");
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ---------- 窗口行为 ----------

#[tauri::command]
fn set_hit_rects(state: State<'_, Shared>, rects: Vec<[f64; 4]>) {
    if let Ok(mut hit) = state.lock() {
        hit.rects = rects;
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

/// 贴在桌面（所有窗口之下）还是始终置顶。
#[tauri::command]
fn set_layer(app: AppHandle, state: State<'_, Shared>, top: bool) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("找不到主窗口")?;
    if let Ok(mut hit) = state.lock() {
        hit.top = top;
    }
    // 顺序有讲究：先撤掉旧的那个，再设新的。
    // 反过来的话，后撤掉的那一步会把窗口放回“普通窗口”，刚设的置顶 / 置底就白设了。
    if top {
        window.set_always_on_bottom(false).map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())
    } else {
        window.set_always_on_top(false).map_err(|e| e.to_string())?;
        window.set_always_on_bottom(true).map_err(|e| e.to_string())
    }
}

/// 开机自启：在当前用户的“启动项”注册表里加 / 删一条。
#[tauri::command]
fn set_autostart(on: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new("reg");
    if on {
        let value = format!("\"{}\"", exe.display());
        cmd.args(["add", RUN_KEY, "/v", "Jinjian", "/t", "REG_SZ", "/d"])
            .arg(value)
            .arg("/f");
    } else {
        cmd.args(["delete", RUN_KEY, "/v", "Jinjian", "/f"]);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // 不弹黑色命令行窗口
    }
    cmd.status().map(|_| ()).map_err(|e| e.to_string())
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

fn show_capture(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("capture-open", ());
    }
}

#[tauri::command]
fn hide_capture(app: AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.hide();
    }
}

/// 快速记录窗口保存时调用：把内容转给主窗口，然后收起自己。
#[tauri::command]
fn capture_submit(app: AppHandle, payload: String) {
    let _ = app.emit("capture", payload);
    hide_capture(app);
}

// ---------- iCloud ----------

#[tauri::command]
fn cred_set(user: String, pass: String) -> Result<(), String> {
    keyring::Entry::new(CRED_SERVICE, &user)
        .and_then(|entry| entry.set_password(&pass))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cred_delete(user: String) -> Result<(), String> {
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

/// 替界面发一个 CalDAV 请求。只允许发往 iCloud，密码默认从凭据管理器取。
/// 不自动跟随跳转（跳转时方法会被改成 GET），交给界面自己重发。
#[tauri::command]
async fn dav(req: DavReq) -> Result<DavRes, String> {
    let url = reqwest::Url::parse(&req.url).map_err(|e| e.to_string())?;
    let host = url.host_str().unwrap_or("");
    // 中国大陆的 Apple ID 由云上贵州运营，服务器在 icloud.com.cn
    let allowed = ["icloud.com", "icloud.com.cn"]
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{}", d)));
    if url.scheme() != "https" || !allowed {
        return Err(format!("只允许访问 iCloud（{}）", host));
    }
    let pass = match req.pass {
        Some(p) if !p.is_empty() => p,
        _ => keyring::Entry::new(CRED_SERVICE, &req.user)
            .and_then(|entry| entry.get_password())
            .map_err(|_| "auth".to_string())?,
    };
    let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut builder = http()?.request(method, url).basic_auth(&req.user, Some(pass));
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
    Ok(DavRes { status, headers, body })
}

// ---------- 启动 ----------

fn main() {
    let started = Instant::now();
    let shared: Shared = Arc::new(Mutex::new(Hit::default()));
    let for_thread = shared.clone();
    let for_tray = shared.clone();
    let for_keys = shared.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(shared)
        .setup(move |app| {
            let window = app.get_webview_window("main").ok_or("找不到主窗口")?;

            // 贴到当前显示器的右上角，高度占满整块屏幕。
            if let Some(monitor) = window.current_monitor()? {
                let size = *monitor.size();
                let pos = *monitor.position();
                let scale = window.scale_factor()?;
                let width = (WINDOW_WIDTH * scale).round() as u32;
                window.set_size(PhysicalSize::new(width, size.height))?;
                window.set_position(PhysicalPosition::new(
                    pos.x + size.width as i32 - width as i32,
                    pos.y,
                ))?;
            }
            window.show()?;

            // 全局快捷键：Alt+Q 快速记录，Alt+L 开关鼠标穿透。被别的程序占用就算了。
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, shortcut, event| {
                        if event.state() != ShortcutState::Pressed {
                            return;
                        }
                        if shortcut == &Shortcut::new(Some(Modifiers::ALT), Code::KeyQ) {
                            show_capture(app);
                        } else if shortcut == &Shortcut::new(Some(Modifiers::ALT), Code::KeyL) {
                            toggle_lock(app, &for_keys);
                        }
                    })
                    .build(),
            )?;
            let _ = app
                .global_shortcut()
                .register(Shortcut::new(Some(Modifiers::ALT), Code::KeyQ));
            let _ = app
                .global_shortcut()
                .register(Shortcut::new(Some(Modifiers::ALT), Code::KeyL));

            // 托盘：穿透后界面点不到，可以从这里解除。
            let capture = MenuItem::with_id(app, "capture", "快速记录（Alt+Q）", true, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle_lock", "切换鼠标穿透（Alt+L）", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出今笺", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&capture, &toggle, &quit])?;
            let mut tray = TrayIconBuilder::new().tooltip("今笺").menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(move |app, event| match event.id.as_ref() {
                "quit" => {
                    QUITTING.store(true, Ordering::SeqCst);
                    app.exit(0);
                }
                "capture" => show_capture(app),
                "toggle_lock" => toggle_lock(app, &for_tray),
                _ => {}
            })
            .build(app)?;

            // 窗口比玻璃区域大，透明的地方要让鼠标落到桌面上：
            // 每 40 毫秒看一次光标在不在界面上报的区域里，据此开关“忽略鼠标”。
            // 同一个循环里顺便照看“显示桌面”（Win + D），细节见 desk.rs。
            // 桌面附近的窗口顺序一变，desk 会通过这条通道立刻叫醒循环，不用等到下一个 40 毫秒。
            let win = window.clone();
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
                let tick = Duration::from_millis(40);
                let mut ignoring: Option<bool> = None;
                let mut raised = false;
                let mut rounds = 0u32;
                loop {
                    // 没有 desk（或它没用上通道）时通道是断开的，老老实实睡 40 毫秒
                    if let Err(mpsc::RecvTimeoutError::Disconnected) = wake_rx.recv_timeout(tick) {
                        thread::sleep(tick);
                    }
                    while wake_rx.try_recv().is_ok() {}
                    let (rects, locked, top) = match for_thread.lock() {
                        Ok(hit) => (hit.rects.clone(), hit.locked, hit.top),
                        Err(_) => continue,
                    };
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
                    // 约每秒一次：万一被别的程序最小化了（比如“全部最小化”），自己恢复
                    rounds = rounds.wrapping_add(1);
                    if rounds % 25 == 0 && win.is_minimized().unwrap_or(false) {
                        let _ = win.unminimize();
                    }
                    let mut inside = false;
                    if !locked {
                        if let (Ok(cursor), Ok(origin)) = (win.cursor_position(), win.outer_position()) {
                            let x = cursor.x - origin.x as f64;
                            let y = cursor.y - origin.y as f64;
                            inside = rects
                                .iter()
                                .any(|r| x >= r[0] && y >= r[1] && x <= r[2] && y <= r[3]);
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
            // 刚启动就没了多半是别的问题，不反复重开。
            WindowEvent::Destroyed
                if window.label() == "main"
                    && !QUITTING.load(Ordering::SeqCst)
                    && started.elapsed() > Duration::from_secs(10) =>
            {
                window.app_handle().restart();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            wallpaper,
            set_hit_rects,
            set_locked,
            set_layer,
            set_autostart,
            notify,
            hide_capture,
            capture_submit,
            cred_set,
            cred_delete,
            dav
        ])
        .run(tauri::generate_context!())
        .expect("今笺启动失败");
}
