// 今笺：按 Win + D（显示桌面）时让小组件留在桌面上。
//
// “显示桌面”时，资源管理器会把“放桌面图标的那个窗口”提到所有普通窗口之上，
// 贴在最底层的小组件就被它盖住了。Windows 没有“显示桌面时保留我”的开关。
//
// 两套做法，按系统版本选：
//
// 一、Windows 11 24H2 及以后：把小组件“挂”在桌面窗口（Progman）名下。
//    系统保证被挂的窗口永远排在它的主人上面，所以桌面被提上来时小组件不会被盖住，
//    全程不用我们自己去挪窗口，也就没有“先消失再冒出来”的闪动。
//    配合窗口框架里一直开着的“永远置底”，点小组件也不会把它带到别的窗口上面。
//    资源管理器重启后主人没了，循环里发现后会重新挂一次。
//
// 二、更早的系统（或者挂不上时）：和 Rainmeter 的“在桌面上”一样，自己发现、自己提。
//    1. 发现：放一个看不见的“哨兵”窗口，永远待在最底层。
//       平时图标窗口在哨兵下面；显示桌面时图标窗口跑到了哨兵上面。
//    2. 应对：显示桌面期间，把小组件插到“最靠后的那个置顶窗口”正下方
//       （在桌面图标之上、任务栏之下）；结束后放回最底层。
//    为了反应够快，前台窗口一变、哨兵一被系统挪动，就立刻叫醒后台循环检查，
//    不用等下一次定时检查。
//
// 直接声明用到的几个系统函数，不引入额外依赖。句柄一律按 isize 传。

#![allow(non_snake_case, dead_code)]

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::ptr::null;
    use std::sync::atomic::{AtomicIsize, Ordering};
    use std::sync::OnceLock;

    const HWND_TOP: isize = 0;
    const HWND_BOTTOM: isize = 1;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_NOOWNERZORDER: u32 = 0x0200;
    const SWP_NOSENDCHANGING: u32 = 0x0400;
    /// 只改前后顺序、不激活、不发“即将改变位置”的通知
    /// （这样窗口框架里“永远置底”的拦截不会把我们的调整改回去）。
    const ZPOS: u32 = SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER | SWP_NOACTIVATE | SWP_NOSENDCHANGING;
    const GW_HWNDNEXT: u32 = 2;
    const GW_OWNER: u32 = 4;
    /// 窗口的“主人”存在这个位置（名字里带 PARENT，实际是 owner）。
    const GWLP_HWNDPARENT: i32 = -8;
    const EVENT_SYSTEM_FOREGROUND: u32 = 0x0003;
    const WINEVENT_OUTOFCONTEXT: u32 = 0;
    /// “速览桌面”（鼠标停在任务栏最右端）时不要把这个窗口变成透明轮廓。
    const DWMWA_EXCLUDED_FROM_PEEK: u32 = 12;
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOPMOST: u32 = 0x0000_0008;
    const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
    const WS_POPUP: u32 = 0x8000_0000;
    const WS_DISABLED: u32 = 0x0800_0000;
    const WM_WINDOWPOSCHANGING: u32 = 0x0046;

    #[repr(C)]
    struct WndClassW {
        style: u32,
        wnd_proc: Option<unsafe extern "system" fn(isize, u32, usize, isize) -> isize>,
        cls_extra: i32,
        wnd_extra: i32,
        instance: isize,
        icon: isize,
        cursor: isize,
        background: isize,
        menu_name: *const u16,
        class_name: *const u16,
    }

    #[repr(C)]
    struct WindowPos {
        hwnd: isize,
        insert_after: isize,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        flags: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetShellWindow() -> isize;
        fn FindWindowExW(parent: isize, after: isize, class: *const u16, title: *const u16) -> isize;
        fn IsWindowVisible(hwnd: isize) -> i32;
        fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
        fn GetTopWindow(hwnd: isize) -> isize;
        fn GetWindow(hwnd: isize, cmd: u32) -> isize;
        fn GetWindowLongW(hwnd: isize, index: i32) -> i32;
        fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        fn RegisterClassW(class: *const WndClassW) -> u16;
        fn CreateWindowExW(
            ex_style: u32,
            class: *const u16,
            title: *const u16,
            style: u32,
            x: i32,
            y: i32,
            w: i32,
            h: i32,
            parent: isize,
            menu: isize,
            instance: isize,
            param: *const c_void,
        ) -> isize;
        fn DefWindowProcW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
        #[cfg(target_pointer_width = "64")]
        fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
        #[cfg(target_pointer_width = "32")]
        #[link_name = "SetWindowLongW"]
        fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
        fn SetWinEventHook(
            event_min: u32,
            event_max: u32,
            module: isize,
            callback: Option<unsafe extern "system" fn(isize, u32, isize, i32, i32, u32, u32)>,
            process: u32,
            thread: u32,
            flags: u32,
        ) -> isize;
    }

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(hwnd: isize, attribute: u32, value: *const c_void, size: u32) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(name: *const u16) -> isize;
        fn GetProcAddress(module: isize, name: *const u8) -> isize;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 叫醒后台循环的办法，由调用方给。系统回调里只做这一件事，不碰界面框架。
    static WAKE: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

    fn wake() {
        if let Some(call) = WAKE.get() {
            call();
        }
    }

    /// 哨兵窗口：拒绝一切不是我们自己发起的前后顺序变化，老实待在最底层。
    /// 系统想挪它，说明桌面附近的顺序在变，顺手叫醒循环看一眼。
    unsafe extern "system" fn sentinel_proc(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize {
        if msg == WM_WINDOWPOSCHANGING && lparam != 0 {
            let pos = lparam as *mut WindowPos;
            if (*pos).flags & SWP_NOZORDER == 0 {
                wake();
            }
            (*pos).flags |= SWP_NOZORDER;
            return 0;
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    /// 前台窗口变了（按 Win + D、点开别的窗口都会触发）。
    unsafe extern "system" fn on_foreground(_hook: isize, _event: u32, _hwnd: isize, _object: i32, _child: i32, _thread: u32, _time: u32) {
        wake();
    }

    pub struct Desk {
        sentinel: isize,
        ours: isize,
        class: Vec<u16>,
        defview: Vec<u16>,
        workerw: Vec<u16>,
        /// Windows 11 24H2 起，桌面图标一直放在外壳窗口（Progman）里，显示桌面时被提上来的就是它。
        modern: bool,
        /// 小组件现在挂在哪个桌面窗口名下；0 表示没挂。
        adopted: AtomicIsize,
        /// 试过但挂不上的那个桌面窗口，不再反复去试。
        refused: AtomicIsize,
    }

    impl Desk {
        /// 必须在主线程调用：哨兵窗口的消息和“前台窗口变了”的通知都靠主线程的消息循环送达。
        /// `on_change` 会在桌面附近的窗口顺序可能变化时被调用，用来叫醒后台循环。
        pub fn new(ours: isize, on_change: Box<dyn Fn() + Send + Sync>) -> Option<Desk> {
            let _ = WAKE.set(on_change);
            let class = wide("JinjianDesktopSentinel");
            let sentinel = unsafe {
                let instance = GetModuleHandleW(null());
                let wc = WndClassW {
                    style: 0,
                    wnd_proc: Some(sentinel_proc),
                    cls_extra: 0,
                    wnd_extra: 0,
                    instance,
                    icon: 0,
                    cursor: 0,
                    background: 0,
                    menu_name: null(),
                    class_name: class.as_ptr(),
                };
                if RegisterClassW(&wc) == 0 {
                    return None;
                }
                // 从不显示、禁用、工具窗口：看不见、点不到、不进 Alt+Tab，但在前后顺序里有位置。
                let hwnd = CreateWindowExW(
                    WS_EX_TOOLWINDOW,
                    class.as_ptr(),
                    class.as_ptr(),
                    WS_POPUP | WS_DISABLED,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    instance,
                    null(),
                );
                if hwnd == 0 {
                    return None;
                }
                SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, ZPOS);
                // 装不上也没关系，后台循环本来就会定时检查
                SetWinEventHook(
                    EVENT_SYSTEM_FOREGROUND,
                    EVENT_SYSTEM_FOREGROUND,
                    0,
                    Some(on_foreground),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT,
                );
                let yes: i32 = 1;
                DwmSetWindowAttribute(ours, DWMWA_EXCLUDED_FROM_PEEK, &yes as *const i32 as *const c_void, 4);
                hwnd
            };
            let modern = unsafe {
                let user32 = wide("user32");
                let module = GetModuleHandleW(user32.as_ptr());
                // 这个导出函数从 24H2 才有，用它判断系统版本
                module != 0 && GetProcAddress(module, b"GetCurrentMonitorTopologyId\0".as_ptr()) != 0
            };
            Some(Desk {
                sentinel,
                ours,
                class,
                defview: wide("SHELLDLL_DefView"),
                workerw: wide("WorkerW"),
                modern,
                adopted: AtomicIsize::new(0),
                refused: AtomicIsize::new(0),
            })
        }

        /// 24H2 及以后：确保小组件挂在桌面窗口名下。挂着就返回 true，
        /// 这时系统自己会让它跟着桌面走，不需要再管“显示桌面”。
        /// 可以反复调用；资源管理器重启、桌面窗口换了一个时会重新挂。
        pub fn attach(&self) -> bool {
            if !self.modern {
                return false;
            }
            unsafe {
                let shell = GetShellWindow();
                if shell == 0 || FindWindowExW(shell, 0, self.defview.as_ptr(), null()) == 0 {
                    return false; // 资源管理器不在，或者不是 24H2 的布局
                }
                if GetWindow(self.ours, GW_OWNER) == shell {
                    return true;
                }
                if self.refused.load(Ordering::Relaxed) == shell {
                    return false;
                }
                SetWindowLongPtrW(self.ours, GWLP_HWNDPARENT, shell);
                if GetWindow(self.ours, GW_OWNER) != shell {
                    self.refused.store(shell, Ordering::Relaxed);
                    return false;
                }
                self.adopted.store(shell, Ordering::Relaxed);
                // 重新排一次位置：放到最底层，系统会把它摆在主人（桌面）的正上方
                SetWindowPos(self.ours, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                true
            }
        }

        /// 用户选了“始终置顶”：不再挂在桌面名下。只解除我们自己挂的。
        pub fn detach(&self) {
            let mine = self.adopted.swap(0, Ordering::Relaxed);
            if mine == 0 {
                return;
            }
            unsafe {
                if GetWindow(self.ours, GW_OWNER) == mine {
                    SetWindowLongPtrW(self.ours, GWLP_HWNDPARENT, 0);
                }
            }
        }

        /// 显示桌面结束：立刻放回最底层，不等窗口框架那边慢半拍。
        pub fn lower(&self) {
            unsafe {
                SetWindowPos(self.ours, HWND_BOTTOM, 0, 0, 0, 0, ZPOS);
            }
        }

        /// 放桌面图标的顶层窗口；找不到就是 0。
        fn host(&self) -> isize {
            unsafe {
                let shell = GetShellWindow();
                if shell == 0 {
                    return 0; // 资源管理器不在（或正在重启）
                }
                if FindWindowExW(shell, 0, self.defview.as_ptr(), null()) != 0 {
                    return if self.modern { shell } else { 0 };
                }
                // 24H2 之前：显示桌面时图标会搬进一个顶层的 WorkerW
                let mut shell_pid = 0u32;
                GetWindowThreadProcessId(shell, &mut shell_pid);
                let mut worker = 0isize;
                for _ in 0..512 {
                    worker = FindWindowExW(0, worker, self.workerw.as_ptr(), null());
                    if worker == 0 {
                        return 0;
                    }
                    let mut pid = 0u32;
                    GetWindowThreadProcessId(worker, &mut pid);
                    if pid == shell_pid
                        && IsWindowVisible(worker) != 0
                        && FindWindowExW(worker, 0, self.defview.as_ptr(), null()) != 0
                    {
                        return worker;
                    }
                }
                0
            }
        }

        /// 现在是不是“显示桌面”状态：图标窗口跑到了哨兵上面。
        pub fn shown(&self) -> bool {
            let host = self.host();
            if host == 0 {
                return false;
            }
            unsafe {
                // 从图标窗口往下找哨兵，找得到说明哨兵在它下面
                IsWindowVisible(host) != 0 && FindWindowExW(0, host, self.class.as_ptr(), null()) != 0
            }
        }

        /// 把小组件提到桌面图标之上、任务栏之下。已经在上面就什么都不做。
        pub fn raise(&self) {
            let host = self.host();
            if host == 0 {
                return;
            }
            unsafe {
                let mut anchors: Vec<isize> = Vec::new();
                let mut cur = GetTopWindow(0);
                let mut guard = 0;
                while cur != 0 && cur != host && guard < 10_000 {
                    if cur == self.ours {
                        return;
                    }
                    if ((GetWindowLongW(cur, GWL_EXSTYLE) as u32) & WS_EX_TOPMOST) != 0 {
                        anchors.push(cur);
                    }
                    cur = GetWindow(cur, GW_HWNDNEXT);
                    guard += 1;
                }
                if cur != host {
                    return; // 没走到图标窗口，这次的顺序不完整，下次再说
                }
                // 插到最靠后的置顶窗口正下方；不行就依次往前试
                for anchor in anchors.iter().rev() {
                    if SetWindowPos(self.ours, *anchor, 0, 0, 0, 0, ZPOS) != 0 {
                        return;
                    }
                }
                SetWindowPos(self.ours, HWND_TOP, 0, 0, 0, 0, ZPOS);
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub struct Desk;

    impl Desk {
        pub fn new(_ours: isize, _on_change: Box<dyn Fn() + Send + Sync>) -> Option<Desk> {
            None
        }
        pub fn attach(&self) -> bool {
            false
        }
        pub fn detach(&self) {}
        pub fn shown(&self) -> bool {
            false
        }
        pub fn raise(&self) {}
        pub fn lower(&self) {}
    }
}

pub use imp::Desk;
