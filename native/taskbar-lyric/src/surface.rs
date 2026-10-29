//! 仅把可重建的原生画布挂到任务栏，Chromium 窗口始终独立

use crate::{
    JsRect,
    strategy::Rect,
    utils::{ensure_thread_message_queue, find_taskbar_hwnd},
};
use anyhow::{Result, anyhow};
use napi::{
    Status,
    bindgen_prelude::{Buffer, Function},
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue},
};
use napi_derive::napi;
use std::{
    cell::RefCell,
    ffi::c_void,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread,
};
use windows::{
    Win32::{
        Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM},
        Graphics::Gdi::{
            AC_SRC_ALPHA, AC_SRC_OVER, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BLENDFUNCTION,
            CreateCompatibleDC, CreateDIBSection, CreateRectRgn, DIB_RGB_COLORS, DeleteDC,
            DeleteObject, GetDC, HBITMAP, HDC, HGDIOBJ, MapWindowPoints, ReleaseDC, SelectObject,
            SetWindowRgn,
        },
        System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentThreadId},
        UI::{
            Controls::WM_MOUSELEAVE,
            HiDpi::{DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetThreadDpiAwarenessContext},
            Input::KeyboardAndMouse::{TME_LEAVE, TRACKMOUSEEVENT, TrackMouseEvent},
            WindowsAndMessaging::{
                CS_DBLCLKS, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW,
                GWL_EXSTYLE, GetMessageW, GetParent, GetWindowLongPtrW, HWND_TOP, IsWindow,
                MA_NOACTIVATE, MSG, PostThreadMessageW, RegisterClassW, SW_HIDE, SWP_NOACTIVATE,
                SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SetWindowLongPtrW, SetWindowPos,
                ShowWindow, ULW_ALPHA, UpdateLayeredWindow, WM_APP, WM_ERASEBKGND,
                WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP,
                WM_MOUSEACTIVATE, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_NCDESTROY, WM_QUIT,
                WM_RBUTTONDOWN, WM_RBUTTONUP, WNDCLASSW, WS_CHILD, WS_EX_LAYERED, WS_EX_NOACTIVATE,
                WS_EX_NOPARENTNOTIFY, WS_EX_TRANSPARENT,
            },
        },
    },
    core::w,
};

const UPDATE_SURFACE: u32 = WM_APP + 1;
const SURFACE_CLASS: windows::core::PCWSTR = w!("SPlayerTaskbarSurface");
type PointerCallback = ThreadsafeFunction<
    JsTaskbarPointerEvent,
    UnknownReturnValue,
    JsTaskbarPointerEvent,
    Status,
    false,
    false,
    32,
>;

#[napi(object)]
pub struct JsTaskbarPointerEvent {
    pub kind: String,
    pub x: i32,
    pub y: i32,
    pub button: String,
    pub click_count: i32,
    pub delta_y: i32,
}

#[derive(Default)]
struct SurfaceData {
    bounds: Rect,
    shape: Option<Rect>,
    visible: bool,
    ignore_mouse: bool,
    pixels: Vec<u8>,
    width: i32,
    height: i32,
    generation: u64,
}

struct SharedSurface {
    data: Mutex<SurfaceData>,
    hwnd: AtomicUsize,
    queued: AtomicBool,
    stopped: AtomicBool,
    taskbar: Box<dyn Fn() -> Option<HWND> + Send + Sync>,
}

type PointerSink = Arc<dyn Fn(JsTaskbarPointerEvent) + Send + Sync>;
thread_local! {
    static CURRENT_SURFACE: RefCell<Option<(Arc<SharedSurface>, PointerSink)>> = const { RefCell::new(None) };
    static CLICK_COUNT: std::cell::Cell<i32> = const { std::cell::Cell::new(1) };
}

#[napi]
pub struct TaskbarSurface {
    shared: Arc<SharedSurface>,
    thread_id: u32,
}

#[napi]
impl TaskbarSurface {
    /// 创建独立消息线程上的任务栏画布，鼠标事件交回离屏页面
    /// @param callback - 接收画布物理像素坐标中的鼠标事件
    /// @returns - 可独立重建的任务栏画布
    #[napi(
        constructor,
        ts_args_type = "callback: (event: JsTaskbarPointerEvent) => void"
    )]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        callback: Function<JsTaskbarPointerEvent, UnknownReturnValue>,
    ) -> napi::Result<Self> {
        let callback: PointerCallback = callback
            .build_threadsafe_function::<JsTaskbarPointerEvent>()
            .max_queue_size::<32>()
            .build_callback(|ctx| Ok(ctx.value))?;
        Self::start(
            Box::new(move |event| {
                let mode = if event.kind == "mouseMove" {
                    ThreadsafeFunctionCallMode::NonBlocking
                } else {
                    ThreadsafeFunctionCallMode::Blocking
                };
                callback.call(event, mode);
            }),
            Box::new(find_taskbar_hwnd),
        )
        .map_err(|error| napi::Error::from_reason(error.to_string()))
    }

    /// 更新原生画布的屏幕位置和大小
    /// @param bounds - 屏幕物理像素矩形
    #[napi]
    pub fn set_bounds(&self, bounds: JsRect) {
        if let Ok(mut data) = self.shared.data.lock() {
            data.bounds = Rect {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
            };
        }
        self.notify();
    }

    /// 裁剪画布的显示和鼠标区域
    /// @param shape - 相对画布的物理像素矩形，null 恢复完整区域
    #[napi]
    pub fn set_shape(&self, shape: Option<JsRect>) {
        if let Ok(mut data) = self.shared.data.lock() {
            data.shape = shape.map(|r| Rect {
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
            });
        }
        self.notify();
    }

    /// 切换画布鼠标穿透，不修改 Chromium 的窗口样式
    /// @param ignore - 是否让鼠标穿透到任务栏
    #[napi]
    pub fn set_mouse_passthrough(&self, ignore: bool) {
        if let Ok(mut data) = self.shared.data.lock() {
            data.ignore_mouse = ignore;
        }
        self.notify();
    }

    /// 显示或隐藏原生画布
    /// @param visible - 当前布局是否允许显示
    #[napi]
    pub fn set_visible(&self, visible: bool) {
        if let Ok(mut data) = self.shared.data.lock() {
            data.visible = visible;
        }
        self.notify();
    }

    /// 提交最新的预乘 BGRA 帧，仅保留一帧并合并尚未处理的绘制通知
    /// @param pixels - Electron 离屏绘制生成的位图
    /// @param width - 位图物理像素宽度
    /// @param height - 位图物理像素高度
    #[napi]
    pub fn present(&self, pixels: Buffer, width: i32, height: i32) {
        let Some(len) = usize::try_from(width).ok().and_then(|w| {
            usize::try_from(height)
                .ok()
                .and_then(|h| w.checked_mul(h)?.checked_mul(4))
        }) else {
            return;
        };
        if width <= 0 || height <= 0 || pixels.len() != len {
            return;
        }
        if let Ok(mut data) = self.shared.data.lock() {
            data.pixels.clear();
            data.pixels.extend_from_slice(&pixels);
            data.width = width;
            data.height = height;
            data.generation = data.generation.wrapping_add(1);
        }
        self.notify();
    }

    /// 立即停用回调，再由所属线程销毁画布和 GDI 资源
    #[napi]
    pub fn stop(&self) {
        if !self.shared.stopped.swap(true, Ordering::AcqRel) {
            let _ = unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) };
        }
    }
}

impl TaskbarSurface {
    /// 启动不依赖 Chromium 窗口生命周期的原生绘制线程
    /// @param pointer - 鼠标事件接收器
    /// @param taskbar - 查询当前任务栏身份，测试可使用隔离窗口
    /// @returns - 已就绪的画布控制器
    fn start(
        pointer: Box<dyn Fn(JsTaskbarPointerEvent) + Send + Sync>,
        taskbar: Box<dyn Fn() -> Option<HWND> + Send + Sync>,
    ) -> Result<Self> {
        let shared = Arc::new(SharedSurface {
            data: Mutex::new(SurfaceData::default()),
            hwnd: AtomicUsize::new(0),
            queued: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            taskbar,
        });
        let worker = Arc::clone(&shared);
        let (tx, rx) = std::sync::mpsc::channel();
        thread::spawn(move || unsafe {
            let _ = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            ensure_thread_message_queue();
            // JS 回调仅由线程持有，退出后释放，避免回调与 NAPI 实例形成引用环
            CURRENT_SURFACE
                .with(|slot| *slot.borrow_mut() = Some((Arc::clone(&worker), Arc::from(pointer))));
            let class = WNDCLASSW {
                style: CS_DBLCLKS,
                lpfnWndProc: Some(surface_proc),
                hInstance: GetModuleHandleW(None).unwrap_or_default().into(),
                lpszClassName: SURFACE_CLASS,
                ..Default::default()
            };
            // 类名在进程内复用，关闭画布时只释放实例
            RegisterClassW(&class);
            let _ = tx.send(GetCurrentThreadId());
            let mut canvas = Canvas::default();
            let mut msg = MSG::default();
            while GetMessageW(&raw mut msg, None, 0, 0).0 > 0 {
                if msg.message == UPDATE_SURFACE && msg.hwnd.0.is_null() {
                    worker.queued.store(false, Ordering::Release);
                    if !worker.stopped.load(Ordering::Acquire) {
                        canvas.update(&worker);
                    }
                } else {
                    DispatchMessageW(&raw const msg);
                }
            }
            let hwnd = HWND(worker.hwnd.swap(0, Ordering::AcqRel) as *mut c_void);
            if IsWindow(Some(hwnd)).as_bool() {
                let _ = DestroyWindow(hwnd);
            }
            CURRENT_SURFACE.with(|slot| *slot.borrow_mut() = None);
        });
        Ok(Self {
            shared,
            thread_id: rx.recv().map_err(|_| anyhow!("任务栏画布线程未就绪"))?,
        })
    }

    /// 合并高频帧和配置变化，避免消息队列积压
    fn notify(&self) {
        if !self.shared.stopped.load(Ordering::Acquire)
            && !self.shared.queued.swap(true, Ordering::AcqRel)
        {
            let _ =
                unsafe { PostThreadMessageW(self.thread_id, UPDATE_SURFACE, WPARAM(0), LPARAM(0)) };
        }
    }
}

impl Drop for TaskbarSurface {
    /// 释放画布实例
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Default)]
struct Canvas {
    dc: HDC,
    bitmap: HBITMAP,
    previous_bitmap: HGDIOBJ,
    bits: *mut c_void,
    size: (i32, i32),
    generation: u64,
    bounds: Option<Rect>,
    shape: Option<Option<Rect>>,
    ignored: Option<bool>,
    visible: bool,
}

impl Canvas {
    /// 按最新状态重建和绘制画布，显示时放到任务栏背景子窗口上方
    /// @param shared - 有界共享帧和窗口状态
    fn update(&mut self, shared: &SharedSurface) {
        let Ok(data) = shared.data.lock() else { return };
        let mut hwnd = HWND(shared.hwnd.load(Ordering::Acquire) as *mut c_void);
        unsafe {
            if !data.visible {
                if self.visible && IsWindow(Some(hwnd)).as_bool() {
                    let _ = ShowWindow(hwnd, SW_HIDE);
                }
                self.visible = false;
                return;
            }
            let Some(taskbar) = (shared.taskbar)() else {
                return;
            };
            if data.bounds.width <= 0 || data.bounds.height <= 0 {
                return;
            }
            // 等对应尺寸的新帧就绪后一起移动和绘制，避免在新位置显示旧宽度的画面
            if data.width != data.bounds.width || data.height != data.bounds.height {
                return;
            }
            if !IsWindow(Some(hwnd)).as_bool() || GetParent(hwnd).ok() != Some(taskbar) {
                if IsWindow(Some(hwnd)).as_bool() {
                    let _ = DestroyWindow(hwnd);
                }
                let created = CreateWindowExW(
                    WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_NOPARENTNOTIFY,
                    SURFACE_CLASS,
                    w!("SPlayer Taskbar Surface"),
                    WS_CHILD,
                    0,
                    0,
                    data.bounds.width,
                    data.bounds.height,
                    Some(taskbar),
                    None,
                    Some(GetModuleHandleW(None).unwrap_or_default().into()),
                    None,
                );
                let created = match created {
                    Ok(hwnd) => hwnd,
                    Err(_) => return,
                };
                hwnd = created;
                shared.hwnd.store(hwnd.0 as usize, Ordering::Release);
                self.bounds = None;
                self.shape = None;
                self.ignored = None;
                self.visible = false;
                self.generation = 0;
            }
            if self.ignored != Some(data.ignore_mouse) {
                let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                SetWindowLongPtrW(
                    hwnd,
                    GWL_EXSTYLE,
                    if data.ignore_mouse {
                        style | WS_EX_TRANSPARENT.0 as isize
                    } else {
                        style & !(WS_EX_TRANSPARENT.0 as isize)
                    },
                );
                self.ignored = Some(data.ignore_mouse);
            }
            if self.shape != Some(data.shape) {
                let region = data
                    .shape
                    .map(|r| CreateRectRgn(r.x, r.y, r.x + r.width, r.y + r.height));
                if SetWindowRgn(hwnd, region, true) != 0 {
                    self.shape = Some(data.shape);
                } else if let Some(region) = region {
                    let _ = DeleteObject(region.into());
                }
            }
            if (data.generation != self.generation || self.bounds != Some(data.bounds))
                && !data.pixels.is_empty()
                && self.draw(hwnd, &data).is_ok()
            {
                self.generation = data.generation;
                self.bounds = Some(data.bounds);
            }
            if !self.visible && self.generation > 0 {
                // 新建子窗口默认排在底部，任务栏背景变实后会遮住画面并截获点击
                self.visible = SetWindowPos(
                    hwnd,
                    Some(HWND_TOP),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                )
                .is_ok();
            }
        }
    }

    /// 复用 DIB 缓冲绘制透明画面，尺寸变化时才重新分配 GDI 对象
    /// @param hwnd - 当前原生画布窗口
    /// @param data - 最新预乘 BGRA 位图
    /// @returns - Windows 绘制结果
    fn draw(&mut self, hwnd: HWND, data: &SurfaceData) -> windows::core::Result<()> {
        unsafe {
            if self.size != (data.width, data.height) {
                self.release_bitmap();
                self.dc = CreateCompatibleDC(None);
                let info = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: data.width,
                        biHeight: -data.height,
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                self.bitmap = CreateDIBSection(
                    Some(self.dc),
                    &info,
                    DIB_RGB_COLORS,
                    &raw mut self.bits,
                    None,
                    0,
                )?;
                self.previous_bitmap = SelectObject(self.dc, self.bitmap.into());
                self.size = (data.width, data.height);
            }
            let target = std::slice::from_raw_parts_mut(self.bits.cast::<u8>(), data.pixels.len());
            target.copy_from_slice(&data.pixels);
            // 极低透明底色保留空白处的鼠标命中，穿透模式由窗口样式统一控制
            for pixel in target.chunks_exact_mut(4) {
                if pixel[3] == 0 {
                    pixel[3] = 1;
                }
            }
            let screen = GetDC(None);
            let mut origin = [POINT {
                x: data.bounds.x,
                y: data.bounds.y,
            }];
            MapWindowPoints(None, GetParent(hwnd).ok(), &mut origin);
            let result = UpdateLayeredWindow(
                hwnd,
                Some(screen),
                Some(&origin[0]),
                Some(&SIZE {
                    cx: data.width,
                    cy: data.height,
                }),
                Some(self.dc),
                Some(&POINT::default()),
                COLORREF(0),
                Some(&BLENDFUNCTION {
                    BlendOp: AC_SRC_OVER as u8,
                    BlendFlags: 0,
                    SourceConstantAlpha: 255,
                    AlphaFormat: AC_SRC_ALPHA as u8,
                }),
                ULW_ALPHA,
            );
            ReleaseDC(None, screen);
            result
        }
    }

    /// 释放当前位图和内存 DC
    fn release_bitmap(&mut self) {
        unsafe {
            if !self.dc.0.is_null() {
                SelectObject(self.dc, self.previous_bitmap);
                let _ = DeleteObject(self.bitmap.into());
                let _ = DeleteDC(self.dc);
            }
        }
        self.dc = HDC::default();
        self.bitmap = HBITMAP::default();
        self.bits = std::ptr::null_mut();
        self.size = (0, 0);
    }
}

impl Drop for Canvas {
    /// 在线程退出时释放 GDI 资源
    fn drop(&mut self) {
        self.release_bitmap();
    }
}

/// 处理独立原生画布的输入与销毁，Explorer 销毁它不会进入 Chromium 窗口过程
/// @param hwnd - 原生画布句柄
/// @param message - Windows 消息
/// @param wparam - 按键或滚轮状态
/// @param lparam - 鼠标物理像素坐标
/// @returns - Windows 消息处理结果
unsafe extern "system" fn surface_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_MOUSEACTIVATE {
        return LRESULT(MA_NOACTIVATE as isize);
    }
    if message == WM_ERASEBKGND {
        return LRESULT(1);
    }
    let shared = CURRENT_SURFACE.with(|slot| slot.borrow().clone());
    if let Some((shared, pointer)) = shared {
        if message == WM_NCDESTROY {
            let _ = shared.hwnd.compare_exchange(
                hwnd.0 as usize,
                0,
                Ordering::AcqRel,
                Ordering::Acquire,
            );
        } else if !shared.stopped.load(Ordering::Acquire) {
            let kind = match message {
                WM_MOUSEMOVE => "mouseMove",
                WM_MOUSELEAVE => "mouseLeave",
                WM_MOUSEWHEEL => "mouseWheel",
                WM_LBUTTONDOWN | WM_LBUTTONDBLCLK | WM_RBUTTONDOWN | WM_MBUTTONDOWN => "mouseDown",
                WM_LBUTTONUP | WM_RBUTTONUP | WM_MBUTTONUP => "mouseUp",
                _ => "",
            };
            if !kind.is_empty() {
                let mut point = [POINT {
                    x: (lparam.0 & 0xffff) as i16 as i32,
                    y: ((lparam.0 >> 16) & 0xffff) as i16 as i32,
                }];
                if message == WM_MOUSEWHEEL {
                    unsafe {
                        MapWindowPoints(None, Some(hwnd), &mut point);
                    }
                }
                if message == WM_MOUSEMOVE {
                    let mut tracking = TRACKMOUSEEVENT {
                        cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                        dwFlags: TME_LEAVE,
                        hwndTrack: hwnd,
                        dwHoverTime: 0,
                    };
                    let _ = unsafe { TrackMouseEvent(&raw mut tracking) };
                }
                if kind == "mouseDown" {
                    CLICK_COUNT.set(if message == WM_LBUTTONDBLCLK { 2 } else { 1 });
                }
                pointer(JsTaskbarPointerEvent {
                    kind: kind.to_string(),
                    x: point[0].x,
                    y: point[0].y,
                    button: match message {
                        WM_RBUTTONDOWN | WM_RBUTTONUP => "right",
                        WM_MBUTTONDOWN | WM_MBUTTONUP => "middle",
                        _ => "left",
                    }
                    .to_string(),
                    click_count: CLICK_COUNT.get(),
                    delta_y: if message == WM_MOUSEWHEEL {
                        ((wparam.0 >> 16) & 0xffff) as i16 as i32
                    } else {
                        0
                    },
                });
                return LRESULT(0);
            }
        }
    }
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        os::windows::process::CommandExt,
        process::{Child, Command, Stdio},
        time::{Duration, Instant},
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetTopWindow, PostMessageW, WM_CLOSE, WS_EX_TOOLWINDOW, WS_POPUP, WS_VISIBLE,
    };

    struct ForeignTaskbar {
        child: Child,
        hwnd: usize,
        _output: std::io::Lines<BufReader<std::process::ChildStdout>>,
    }

    impl ForeignTaskbar {
        /// 启动独立进程中的模拟任务栏，不触碰真实 Explorer
        /// @returns - 模拟任务栏及其子进程
        fn start() -> Self {
            let mut child = Command::new(std::env::current_exe().unwrap())
                .env("SPLAYER_SURFACE_FIXTURE", "1")
                .args([
                    "--ignored",
                    "--exact",
                    "surface::tests::foreign_taskbar_fixture",
                    "--nocapture",
                ])
                .creation_flags(0x08000000)
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            let mut output = BufReader::new(child.stdout.take().unwrap()).lines();
            let hwnd = output
                .by_ref()
                .map(Result::unwrap)
                .find_map(|line| line.strip_prefix("fixture-hwnd=")?.parse().ok())
                .unwrap();
            Self {
                child,
                hwnd,
                _output: output,
            }
        }
    }

    impl Drop for ForeignTaskbar {
        /// 回收测试进程，断言失败时也不遗留后台窗口
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }

    /// 等待窗口线程处理状态，超时则报告失败
    /// @param condition - 原生状态是否已到达预期
    fn wait_until(condition: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while !condition() {
            assert!(Instant::now() < deadline, "原生画布状态更新超时");
            thread::sleep(Duration::from_millis(5));
        }
    }

    /// 子进程承载可被正常销毁或强制结束的任务栏替身
    #[test]
    #[ignore]
    fn foreign_taskbar_fixture() {
        if std::env::var_os("SPLAYER_SURFACE_FIXTURE").is_none() {
            return;
        }
        unsafe {
            let _ = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            let hwnd = CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("SPlayer surface fixture"),
                WS_POPUP | WS_VISIBLE,
                -30000,
                -30000,
                100,
                100,
                None,
                None,
                None,
                None,
            )
            .unwrap();
            // 模拟覆盖任务栏的背景子窗口，创建画布后必须处于它上方
            CreateWindowExW(
                Default::default(),
                w!("STATIC"),
                w!("Taskbar background"),
                WS_CHILD | WS_VISIBLE,
                0,
                0,
                100,
                100,
                Some(hwnd),
                None,
                None,
                None,
            )
            .unwrap();
            println!("fixture-hwnd={}", hwnd.0 as usize);
            std::io::stdout().flush().unwrap();
            let mut msg = MSG::default();
            while GetMessageW(&raw mut msg, None, 0, 0).0 > 0 {
                if msg.message == WM_CLOSE {
                    DestroyWindow(hwnd).unwrap();
                    break;
                }
                DispatchMessageW(&raw const msg);
            }
        }
    }

    /// 外部父窗口销毁后只重建原生画布，绘制线程和帧缓冲仍可复用
    #[test]
    fn surface_recovers_after_foreign_parent_exit() {
        unsafe {
            let _ = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        }
        let target = Arc::new(AtomicUsize::new(0));
        let lookup = Arc::clone(&target);
        let surface = TaskbarSurface::start(
            Box::new(|_| {}),
            Box::new(move || {
                let hwnd = lookup.load(Ordering::Acquire);
                (hwnd != 0).then_some(HWND(hwnd as *mut c_void))
            }),
        )
        .unwrap();
        surface.set_bounds(JsRect {
            x: -30000,
            y: -30000,
            width: 40,
            height: 40,
        });
        surface.present(vec![255u8; 40 * 40 * 4].into(), 40, 40);
        for (index, graceful) in [true, false, true, false].into_iter().enumerate() {
            let mut shell = ForeignTaskbar::start();
            target.store(shell.hwnd, Ordering::Release);
            surface.set_visible(true);
            wait_until(|| surface.shared.hwnd.load(Ordering::Acquire) != 0);
            let hwnd = HWND(surface.shared.hwnd.load(Ordering::Acquire) as *mut c_void);
            assert_eq!(unsafe { GetParent(hwnd) }.unwrap().0 as usize, shell.hwnd);
            wait_until(|| {
                unsafe { windows::Win32::UI::WindowsAndMessaging::IsWindowVisible(hwnd) }.as_bool()
            });
            assert_eq!(
                unsafe { GetTopWindow(Some(HWND(shell.hwnd as *mut c_void))) }.unwrap(),
                hwnd,
                "画布必须位于任务栏背景上方，否则不透明背景会遮挡并截获点击"
            );
            if index == 0 {
                let mut before = windows::Win32::Foundation::RECT::default();
                unsafe {
                    windows::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &raw mut before)
                        .unwrap();
                }
                assert_eq!(
                    (before.left, before.top, before.right, before.bottom),
                    (-30000, -30000, -29960, -29960)
                );
                surface.set_bounds(JsRect {
                    x: -30020,
                    y: -30000,
                    width: 60,
                    height: 40,
                });
                wait_until(|| !surface.shared.queued.load(Ordering::Acquire));
                let mut pending = windows::Win32::Foundation::RECT::default();
                unsafe {
                    windows::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &raw mut pending)
                        .unwrap();
                }
                assert_eq!(pending, before, "新帧尚未就绪时不能移动旧画面");
                surface.present(vec![255u8; 60 * 40 * 4].into(), 60, 40);
                wait_until(|| {
                    let mut updated = windows::Win32::Foundation::RECT::default();
                    unsafe {
                        windows::Win32::UI::WindowsAndMessaging::GetWindowRect(
                            hwnd,
                            &raw mut updated,
                        )
                        .unwrap();
                    }
                    updated.left == -30020 && updated.right == -29960
                });
            }
            if graceful {
                unsafe {
                    PostMessageW(
                        Some(HWND(shell.hwnd as *mut c_void)),
                        WM_CLOSE,
                        WPARAM(0),
                        LPARAM(0),
                    )
                    .unwrap();
                }
            } else {
                shell.child.kill().unwrap();
            }
            shell.child.wait().unwrap();
            target.store(0, Ordering::Release);
            wait_until(|| !unsafe { IsWindow(Some(hwnd)) }.as_bool());
            wait_until(|| surface.shared.hwnd.load(Ordering::Acquire) == 0);
        }
        surface.stop();
        surface.stop();
    }

    /// 高频提交仅保留最新帧，尺寸不匹配的输入不会覆盖有效画面
    #[test]
    fn pending_frames_are_bounded_and_validated() {
        let surface = TaskbarSurface::start(Box::new(|_| {}), Box::new(|| None)).unwrap();
        for value in 0u8..100 {
            surface.present(vec![value; 80 * 40 * 4].into(), 80, 40);
        }
        surface.present(vec![0; 4].into(), 80, 40);
        let data = surface.shared.data.lock().unwrap();
        assert_eq!(data.pixels.len(), 80 * 40 * 4);
        assert!(data.pixels.iter().all(|v| *v == 99));
        assert_eq!(data.generation, 100);
    }

    /// 停止后释放线程持有的回调，即使 JS 侧画布实例尚未被回收
    #[test]
    fn stop_releases_pointer_callback() {
        let owner = Arc::new(());
        let weak = Arc::downgrade(&owner);
        let surface = TaskbarSurface::start(
            Box::new(move |_| {
                let _ = &owner;
            }),
            Box::new(|| None),
        )
        .unwrap();
        surface.stop();
        wait_until(|| weak.upgrade().is_none());
        assert!(surface.shared.stopped.load(Ordering::Acquire));
    }

    /// 鼠标消息经过真实画布窗口过程转发，保留有符号坐标和双击次数
    #[test]
    fn surface_forwards_pointer_events() {
        unsafe {
            let _ = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        }
        let shell = ForeignTaskbar::start();
        let parent = shell.hwnd;
        let (tx, rx) = std::sync::mpsc::channel();
        let surface = TaskbarSurface::start(
            Box::new(move |event| {
                let _ = tx.send(event);
            }),
            Box::new(move || Some(HWND(parent as *mut c_void))),
        )
        .unwrap();
        surface.set_bounds(JsRect {
            x: -30000,
            y: -30000,
            width: 40,
            height: 40,
        });
        surface.present(vec![255u8; 40 * 40 * 4].into(), 40, 40);
        surface.set_visible(true);
        wait_until(|| surface.shared.hwnd.load(Ordering::Acquire) != 0);
        let hwnd = HWND(surface.shared.hwnd.load(Ordering::Acquire) as *mut c_void);
        for (message, kind, count) in [
            (WM_LBUTTONDOWN, "mouseDown", 1),
            (WM_LBUTTONUP, "mouseUp", 1),
            (WM_LBUTTONDBLCLK, "mouseDown", 2),
            (WM_LBUTTONUP, "mouseUp", 2),
        ] {
            unsafe {
                PostMessageW(Some(hwnd), message, WPARAM(0), LPARAM((12 << 16) | 0xfffe)).unwrap();
            }
            let event = rx.recv_timeout(Duration::from_secs(3)).unwrap();
            assert_eq!(
                (event.kind.as_str(), event.x, event.y, event.click_count),
                (kind, -2, 12, count)
            );
            assert_eq!(event.button, "left");
        }
        surface.stop();
    }
}
