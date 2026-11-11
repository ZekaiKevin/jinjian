// 今笺：按 Win + D（显示桌面）时让小组件留在桌面上。
//
// “显示桌面”并不是把窗口最小化，而是资源管理器把“放桌面图标的那个窗口”
// 提到所有普通窗口之上，于是贴在最底层的小组件被它盖住。
// Windows 没有“显示桌面时保留我”的开关，只能自己发现这个状态再把窗口提上来。
// 做法和 Rainmeter 的“在桌面上”一致：
//   1. 发现：放一个看不见的“哨兵”窗口，永远待在最底层。
//      平时图标窗口在哨兵下面；显示桌面时图标窗口跑到了哨兵上面。
//   2. 应对：显示桌面期间，把小组件插到“最靠后的那个置顶窗口”正下方
//      （在桌面图标之上、任务栏之下），它仍然是普通窗口。
//      结束后由调用方把它放回最底层。
//
// 直接声明用到的几个系统函数，不引入额外依赖。句柄一律按 isize 传。

#![allow(non_snake_case, dead_code)]

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::ptr::null;

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
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(name: *const u16) -> isize;
        fn GetProcAddress(module: isize, name: *const u8) -> isize;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 哨兵窗口：拒绝一切不是我们自己发起的前后顺序变化，老实待在最底层。
    unsafe extern "system" fn sentinel_proc(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize {
        if msg == WM_WINDOWPOSCHANGING && lparam != 0 {
            let pos = lparam as *mut WindowPos;
            (*pos).flags |= SWP_NOZORDER;
            return 0;
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    pub struct Desk {
        sentinel: isize,
        ours: isize,
        class: Vec<u16>,
        defview: Vec<u16>,
        workerw: Vec<u16>,
        /// Windows 11 24H2 起，桌面图标一直放在外壳窗口（Progman）里，显示桌面时被提上来的就是它。
        modern: bool,
    }

    impl Desk {
        /// 必须在主线程调用：哨兵窗口的消息靠主线程的消息循环处理。
        pub fn new(ours: isize) -> Option<Desk> {
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
            })
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

        /// 把小组件提到桌面图标之上、任务栏之下。已经在上面就什么都不做。在主线程调用。
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
        pub fn new(_ours: isize) -> Option<Desk> {
            None
        }
        pub fn shown(&self) -> bool {
            false
        }
        pub fn raise(&self) {}
    }
}

pub use imp::Desk;
