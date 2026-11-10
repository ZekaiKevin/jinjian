// 今笺 Jinjian：桌面玻璃日程小组件的程序外壳。
// 负责：把透明窗口贴在屏幕右上角、放在所有窗口之下、
// 只让玻璃区域接收鼠标、托盘菜单、本地数据读写、读取系统壁纸。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State,
};

/// 窗口的逻辑宽度：小组件 372 + 详情面板 380 + 边距。
const WINDOW_WIDTH: f64 = 820.0;

/// 界面上报的可点击区域（相对窗口左上角的物理像素），以及是否处于“鼠标穿透”。
#[derive(Default)]
struct Hit {
    rects: Vec<[f64; 4]>,
    locked: bool,
}

type Shared = Arc<Mutex<Hit>>;

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 读取数据文件；每次启动读取时顺手留一份上一次的备份。
#[tauri::command]
fn load_data(app: AppHandle) -> Result<String, String> {
    let dir = data_dir(&app)?;
    let file = dir.join("data.json");
    if !file.exists() {
        return Ok(String::new());
    }
    let text = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let _ = fs::write(dir.join("data.bak.json"), &text);
    Ok(text)
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

fn main() {
    let shared: Shared = Arc::new(Mutex::new(Hit::default()));
    let for_thread = shared.clone();
    let for_tray = shared.clone();

    tauri::Builder::default()
        .manage(shared)
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .ok_or("找不到主窗口")?;

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

            // 托盘：穿透后界面点不到，只能从这里解除。
            let toggle = MenuItem::with_id(app, "toggle_lock", "切换鼠标穿透", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出今笺", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &quit])?;
            let mut tray = TrayIconBuilder::new().tooltip("今笺").menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(move |app, event| match event.id.as_ref() {
                "quit" => app.exit(0),
                "toggle_lock" => {
                    let locked = match for_tray.lock() {
                        Ok(mut hit) => {
                            hit.locked = !hit.locked;
                            hit.locked
                        }
                        Err(_) => return,
                    };
                    let _ = app.emit("locked", locked);
                }
                _ => {}
            })
            .build(app)?;

            // 窗口比玻璃区域大，透明的地方要让鼠标落到桌面上：
            // 每 40 毫秒看一次光标在不在界面上报的区域里，据此开关“忽略鼠标”。
            let win = window.clone();
            thread::spawn(move || {
                let mut ignoring: Option<bool> = None;
                loop {
                    thread::sleep(Duration::from_millis(40));
                    let (rects, locked) = match for_thread.lock() {
                        Ok(hit) => (hit.rects.clone(), hit.locked),
                        Err(_) => continue,
                    };
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
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            wallpaper,
            set_hit_rects,
            set_locked
        ])
        .run(tauri::generate_context!())
        .expect("今笺启动失败");
}
