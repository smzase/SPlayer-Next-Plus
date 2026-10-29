//! 在独立线程计算任务栏布局，Explorer 暂不可用时隐藏歌词并等待恢复

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

use crate::JsTaskbarLayout;
use crate::overlay::TaskbarSnapshot;
use crate::strategy::{
    AvailableSpace, LayoutParams, LegacyStrategy, TaskbarLayout, TaskbarStrategy, Win11Strategy,
};
use crate::utils::{ComApartmentGuard, get_windows_build_number};
use napi::{
    Status,
    bindgen_prelude::Function,
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue},
};
use napi_derive::napi;

type LayoutTsfn =
    ThreadsafeFunction<JsTaskbarLayout, UnknownReturnValue, JsTaskbarLayout, Status, false>;

const TASKBAR_POLL_INTERVAL: Duration = Duration::from_millis(200);
const RETRY_DELAYS_MS: &[u64] = &[50, 150, 300, 600, 1000];

enum TaskbarCommand {
    Update { width: i32 },
    Reinit,
    Stop,
}

#[derive(Default)]
struct PendingCommands {
    width: Option<i32>,
    update: bool,
    reinit: bool,
    stopped: bool,
}

impl PendingCommands {
    /// 合并布局请求，同时保留重建和停止信号，重试期间也使用同一入口
    /// @param command - JS 侧发来的服务命令
    fn apply(&mut self, command: TaskbarCommand) {
        match command {
            TaskbarCommand::Update { width } => {
                self.width = Some(width);
                self.update = true;
            }
            TaskbarCommand::Reinit => {
                self.reinit = true;
                self.update = true;
            }
            TaskbarCommand::Stop => self.stopped = true,
        }
    }
}

#[napi]
pub struct TaskbarService {
    sender: Sender<TaskbarCommand>,
}

#[napi]
impl TaskbarService {
    /// 启动任务栏布局线程
    /// @param callback - 接收屏幕物理像素布局的回调，空区域表示应隐藏歌词
    /// @returns - 任务栏布局服务
    #[napi(
        constructor,
        ts_args_type = "callback: (layout: JsTaskbarLayout) => void"
    )]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(callback: Function<JsTaskbarLayout, UnknownReturnValue>) -> napi::Result<Self> {
        let tsfn = callback
            .build_threadsafe_function::<JsTaskbarLayout>()
            .build_callback(|ctx| Ok(ctx.value))?;
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || worker_loop(&rx, &tsfn));
        Ok(Self { sender: tx })
    }

    /// 请求重新计算歌词布局
    /// @param lyric_width - Windows 10 需要预留的物理像素宽度
    #[napi]
    pub fn update(&self, lyric_width: i32) {
        let _ = self
            .sender
            .send(TaskbarCommand::Update { width: lyric_width });
    }

    /// 通知服务丢弃旧任务栏策略并重新扫描
    #[napi]
    pub fn reinit(&self) {
        let _ = self.sender.send(TaskbarCommand::Reinit);
    }

    /// 请求停止布局计算线程
    #[napi]
    pub fn stop(&mut self) {
        let _ = self.sender.send(TaskbarCommand::Stop);
    }
}

/// 统一处理命令、任务栏消失和布局重试，定时检测只查询 Win32 状态
/// @param rx - 服务命令队列
/// @param tsfn - 布局结果回调
fn worker_loop(rx: &Receiver<TaskbarCommand>, tsfn: &LayoutTsfn) {
    let Some(_com_guard) = ComApartmentGuard::try_init() else {
        return;
    };
    let mut pending = PendingCommands::default();
    let mut strategy: Option<Box<dyn TaskbarStrategy>> = None;
    let mut snapshot: Option<TaskbarSnapshot> = None;
    let mut visible_layout: Option<TaskbarLayout> = None;
    let mut next_poll = Instant::now();
    let mut retry_at: Option<Instant> = None;
    let mut retry_index = 0;

    loop {
        let deadline = retry_at.map_or(next_poll, |retry| retry.min(next_poll));
        match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(command) => pending.apply(command),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        while !pending.stopped {
            let Ok(command) = rx.try_recv() else { break };
            pending.apply(command);
        }
        if pending.stopped {
            break;
        }

        let now = Instant::now();
        if now >= next_poll || pending.reinit {
            let current = TaskbarSnapshot::capture();
            let identity = |value: Option<TaskbarSnapshot>| value.map(|s| (s.hwnd, s.process_id));
            if identity(current) != identity(snapshot) || pending.reinit {
                strategy = None;
                pending.update = true;
            }
            if identity(current) != identity(snapshot)
                && let Some(mut layout) = visible_layout.take()
            {
                layout.space = AvailableSpace::default();
                tsfn.call(layout.into(), ThreadsafeFunctionCallMode::NonBlocking);
            }
            if current != snapshot {
                pending.update = true;
            }
            snapshot = current;
            pending.reinit = false;
            next_poll = now + TASKBAR_POLL_INTERVAL;
        }

        if !snapshot.is_some_and(|s| s.visible) {
            if let Some(mut layout) = visible_layout.take() {
                layout.space = AvailableSpace::default();
                tsfn.call(layout.into(), ThreadsafeFunctionCallMode::NonBlocking);
            }
            retry_at = None;
            continue;
        }
        let Some(width) = pending.width else { continue };
        if !pending.update && !retry_at.is_some_and(|retry| now >= retry) {
            continue;
        }
        if pending.update {
            retry_index = 0;
        }
        pending.update = false;
        if strategy.is_none() {
            strategy = create_strategy();
        }
        let layout = strategy
            .as_mut()
            .and_then(|s| s.update_layout(LayoutParams { lyric_width: width }));
        if let Some(layout) = layout {
            visible_layout = Some(layout);
            tsfn.call(layout.into(), ThreadsafeFunctionCallMode::NonBlocking);
            retry_at = None;
        } else {
            // UIA 在任务栏交互期间可能暂不可读，保留同一任务栏的最近布局直到重试成功
            retry_at = Some(Instant::now() + Duration::from_millis(RETRY_DELAYS_MS[retry_index]));
            retry_index = (retry_index + 1).min(RETRY_DELAYS_MS.len() - 1);
        }
    }
    // 策略在 COM apartment 退出前释放，Windows 10 仅对仍有效的任务栏恢复尺寸
}

/// 按系统版本选择任务栏布局策略
/// @returns - 任务栏正在重建时返回 None，后续定时重试
fn create_strategy() -> Option<Box<dyn TaskbarStrategy>> {
    let (mut primary, mut secondary): (Box<dyn TaskbarStrategy>, Box<dyn TaskbarStrategy>) =
        if get_windows_build_number() >= 22000 {
            (
                Box::new(Win11Strategy::new()),
                Box::new(LegacyStrategy::new()),
            )
        } else {
            (
                Box::new(LegacyStrategy::new()),
                Box::new(Win11Strategy::new()),
            )
        };
    if primary.init() {
        return Some(primary);
    }
    if secondary.init() {
        return Some(secondary);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{PendingCommands, TaskbarCommand};

    /// 重试期间的重建请求不能被后续宽度更新吞掉
    #[test]
    fn reinit_survives_coalesced_updates() {
        let mut pending = PendingCommands::default();
        pending.apply(TaskbarCommand::Update { width: 400 });
        pending.update = false;
        pending.apply(TaskbarCommand::Reinit);
        pending.apply(TaskbarCommand::Update { width: 600 });
        assert!(pending.reinit && pending.update);
        assert_eq!(pending.width, Some(600));
    }

    /// 恢复期间关闭服务必须保留停止信号
    #[test]
    fn stop_survives_recovery_commands() {
        let mut pending = PendingCommands::default();
        pending.apply(TaskbarCommand::Reinit);
        pending.apply(TaskbarCommand::Stop);
        pending.apply(TaskbarCommand::Update { width: 500 });
        assert!(pending.stopped);
    }
}
