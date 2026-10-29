use windows::{
    Win32::{
        Foundation::{HWND, RECT},
        UI::WindowsAndMessaging::{
            FindWindowExW, GA_ROOT, GetAncestor, GetParent, GetWindowRect, SWP_ASYNCWINDOWPOS,
            SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPos,
        },
    },
    core::{PCWSTR, w},
};

use crate::{
    GAP,
    strategy::{
        AvailableSpace, ExtraLayoutInfo, LayoutParams, Rect, SystemType, TaskbarLayout,
        TaskbarStrategy,
    },
    utils::{find_taskbar_hwnd, read_system_uses_light_theme},
};

#[allow(clippy::struct_field_names)]
pub struct LegacyStrategy {
    h_taskbar: HWND,
    h_rebar: HWND,
    h_tasklist: HWND,
}

impl LegacyStrategy {
    pub fn new() -> Self {
        Self {
            h_taskbar: HWND::default(),
            h_rebar: HWND::default(),
            h_tasklist: HWND::default(),
        }
    }

    /**
     * 异步调整任务列表尺寸，避免等待 Explorer 的窗口过程
     * @param x - 父窗口内的横坐标
     * @param y - 父窗口内的纵坐标
     * @param width - 目标宽度
     * @param height - 目标高度
     * @returns - Win32 调整请求结果
     */
    fn resize_tasklist(
        &self,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> windows::core::Result<()> {
        unsafe {
            SetWindowPos(
                self.h_tasklist,
                None,
                x,
                y,
                width,
                height,
                SWP_NOACTIVATE | SWP_NOZORDER | SWP_ASYNCWINDOWPOS,
            )
        }
    }

    unsafe fn find_child_window(
        parent: HWND,
        class_name: PCWSTR,
        fallback: Option<PCWSTR>,
    ) -> HWND {
        let hwnd =
            unsafe { FindWindowExW(Some(parent), None, class_name, None).unwrap_or_default() };
        if hwnd.0.is_null()
            && let Some(fb) = fallback
        {
            return unsafe { FindWindowExW(Some(parent), None, fb, None).unwrap_or_default() };
        }
        hwnd
    }
}

impl TaskbarStrategy for LegacyStrategy {
    fn init(&mut self) -> bool {
        if let Some(hwnd) = find_taskbar_hwnd() {
            self.h_taskbar = hwnd;
            debug!("找到 Shell_TrayWnd");
        } else {
            return false;
        }

        unsafe {
            self.h_rebar =
                Self::find_child_window(self.h_taskbar, w!("ReBarWindow32"), Some(w!("WorkerW")));

            if self.h_rebar.0.is_null() {
                error!("未能找到 ReBarWindow32");
                return false;
            }

            self.h_tasklist = Self::find_child_window(
                self.h_rebar,
                w!("MSTaskSwWClass"),
                Some(w!("MSTaskListWClass")),
            );

            if self.h_tasklist.0.is_null() {
                error!("未能找到 MSTaskSwWClass/MSTaskListWClass");
                return false;
            }
        }

        debug!("Win10 策略初始化成功");
        true
    }

    /**
     * 为 Windows 10 保留歌词区域并返回屏幕物理像素坐标
     * @param params - 歌词所需宽度
     * @returns - 任务栏句柄失效或尺寸不可读时返回 None
     */
    fn update_layout(&mut self, params: LayoutParams) -> Option<TaskbarLayout> {
        if find_taskbar_hwnd() != Some(self.h_taskbar)
            || unsafe { GetAncestor(self.h_rebar, GA_ROOT) } != self.h_taskbar
            || unsafe { GetParent(self.h_tasklist) }.ok() != Some(self.h_rebar)
        {
            return None;
        }

        unsafe {
            let mut rc_rebar = RECT::default();
            GetWindowRect(self.h_rebar, &raw mut rc_rebar).ok()?;

            let mut rc_tasklist = RECT::default();
            GetWindowRect(self.h_tasklist, &raw mut rc_tasklist).ok()?;

            let rebar_w = rc_rebar.right - rc_rebar.left;
            let rebar_h = rc_rebar.bottom - rc_rebar.top;
            let is_vertical = rebar_h > rebar_w;

            let (bx, by, bw, bh) = if is_vertical {
                let offset_y = rc_tasklist.top - rc_rebar.top;
                let new_tasklist_h = rebar_h - offset_y - params.lyric_width - GAP;
                if new_tasklist_h < 0 {
                    // 空间不够时恢复 tasklist 原高度并返回 0 高——不能强压按钮区，会挤成一条线
                    self.resize_tasklist(0, offset_y, rebar_w, rebar_h - offset_y)
                        .ok()?;
                    (0, 0, 0, 0)
                } else {
                    self.resize_tasklist(0, offset_y, rebar_w, new_tasklist_h)
                        .ok()?;
                    (
                        rc_rebar.left,
                        rc_rebar.top + offset_y + new_tasklist_h + GAP,
                        rebar_w,
                        params.lyric_width,
                    )
                }
            } else {
                let offset_x = rc_tasklist.left - rc_rebar.left;
                let new_tasklist_w = rebar_w - offset_x - params.lyric_width - GAP;
                if new_tasklist_w < 0 {
                    self.resize_tasklist(offset_x, 0, rebar_w - offset_x, rebar_h)
                        .ok()?;
                    (0, 0, 0, 0)
                } else {
                    self.resize_tasklist(offset_x, 0, new_tasklist_w, rebar_h)
                        .ok()?;
                    (
                        rc_rebar.left + offset_x + new_tasklist_w + GAP,
                        rc_rebar.top,
                        params.lyric_width,
                        rebar_h,
                    )
                }
            };

            trace!("Win10 布局计算完成");

            let lyric_space = Rect {
                x: bx,
                y: by,
                width: bw,
                height: bh,
            };

            Some(TaskbarLayout {
                space: AvailableSpace {
                    left: Rect::default(),
                    right: lyric_space,
                },
                extra: ExtraLayoutInfo {
                    system_type: SystemType::Win10,
                    is_centered: false,
                    is_light: read_system_uses_light_theme(),
                },
            })
        }
    }

    /** 仅在任务栏和原有子窗口仍匹配时恢复任务列表尺寸 */
    fn restore(&self) {
        if find_taskbar_hwnd() != Some(self.h_taskbar)
            || unsafe { GetAncestor(self.h_rebar, GA_ROOT) } != self.h_taskbar
            || unsafe { GetParent(self.h_tasklist) }.ok() != Some(self.h_rebar)
        {
            return;
        }

        unsafe {
            let mut rc_rebar = RECT::default();
            if GetWindowRect(self.h_rebar, &raw mut rc_rebar).is_err() {
                return;
            }

            let mut rc_tasklist = RECT::default();
            if GetWindowRect(self.h_tasklist, &raw mut rc_tasklist).is_err() {
                return;
            }

            let rebar_w = rc_rebar.right - rc_rebar.left;
            let rebar_h = rc_rebar.bottom - rc_rebar.top;
            let is_vertical = rebar_h > rebar_w;

            if is_vertical {
                let offset_y = rc_tasklist.top - rc_rebar.top;
                let original_height = rebar_h - offset_y;
                let _ = self.resize_tasklist(0, offset_y, rebar_w, original_height);
            } else {
                let offset_x = rc_tasklist.left - rc_rebar.left;
                let original_width = rebar_w - offset_x;
                let _ = self.resize_tasklist(offset_x, 0, original_width, rebar_h);
            }
        }
    }
}

impl Drop for LegacyStrategy {
    fn drop(&mut self) {
        self.restore();
    }
}
