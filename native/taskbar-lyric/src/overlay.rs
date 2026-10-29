use crate::{strategy::Rect, utils::find_taskbar_hwnd};
use windows::Win32::{
    Foundation::HWND,
    Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow},
    UI::WindowsAndMessaging::{GetWindowRect, GetWindowThreadProcessId, IsWindowVisible},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TaskbarSnapshot {
    pub hwnd: HWND,
    pub process_id: u32,
    pub rect: Rect,
    pub visible: bool,
}

impl TaskbarSnapshot {
    /**
     * 读取当前任务栏身份、屏幕位置及自动隐藏状态
     * @returns - Explorer 暂不可用时返回 None
     */
    pub fn capture() -> Option<Self> {
        let hwnd = find_taskbar_hwnd()?;
        unsafe {
            let mut process_id = 0;
            GetWindowThreadProcessId(hwnd, Some(&raw mut process_id));
            let mut rect = Default::default();
            GetWindowRect(hwnd, &raw mut rect).ok()?;
            let mut monitor = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(
                MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST),
                &raw mut monitor,
            )
            .as_bool()
            {
                return None;
            }
            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;
            // 自动隐藏时任务栏仍有可见样式，但主体已移出屏幕
            let on_screen = if width >= height {
                rect.top >= monitor.rcMonitor.top && rect.bottom <= monitor.rcMonitor.bottom
            } else {
                rect.left >= monitor.rcMonitor.left && rect.right <= monitor.rcMonitor.right
            };
            Some(Self {
                hwnd,
                process_id,
                rect: Rect {
                    x: rect.left,
                    y: rect.top,
                    width,
                    height,
                },
                visible: IsWindowVisible(hwnd).as_bool() && on_screen && width > 0 && height > 0,
            })
        }
    }
}
