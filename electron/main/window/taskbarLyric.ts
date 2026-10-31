import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { loadNativeModule } from "@main/utils/nativeLoader";
import { broadcast, sendToMain, setWindowBroadcastVisibility } from "@main/utils/broadcast";
import { setTrayTaskbarLyric } from "@main/services/tray";
import { store } from "@main/store";
import { isAppQuitting } from "@main/utils/lifecycle";
import type { TaskbarLyricPosition } from "@shared/types/settings";
import type {
  JsRect,
  JsTaskbarLayout,
  RegistryWatcher,
  TaskbarCreatedWatcher,
  TaskbarService,
  TaskbarSurface,
  TrayWatcher,
  UiaWatcher,
} from "@splayer/taskbar-lyric";
import { taskbarLog } from "@main/utils/logger";
import { getLocale } from "@main/utils/i18n";
import type { TaskbarPlaybackSnapshot } from "@shared/types/taskbarLyric";
import type { TaskbarLyricLayoutEvent } from "@shared/types/window";

type TaskbarLyricNative = typeof import("@splayer/taskbar-lyric");

const REG_SUBKEY_EXPLORER_ADVANCED =
  "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";
const REG_SUBKEY_PERSONALIZE = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";

type AnchorSide = "left" | "right";

interface PickedSpace {
  rect: JsRect;
  anchor: AnchorSide;
}

let taskbarLyricWindow: BrowserWindow | null = null;
let taskbarQueueWindow: BrowserWindow | null = null;
let taskbarQueueReady = false;
let taskbarQueueShowRequested = false;
let taskbarQueueShown = false;
let taskbarQueueHideTimer: ReturnType<typeof setTimeout> | null = null;
let taskbarQueueMousePollTimer: ReturnType<typeof setInterval> | null = null;
let taskbarQueueMouseWasDown = false;
let nativeModule: TaskbarLyricNative | null = null;
let service: TaskbarService | null = null;
let surface: TaskbarSurface | null = null;
let advancedRegWatcher: RegistryWatcher | null = null;
let themeRegWatcher: RegistryWatcher | null = null;
let uiaWatcher: UiaWatcher | null = null;
let trayWatcher: TrayWatcher | null = null;
let taskbarCreatedWatcher: TaskbarCreatedWatcher | null = null;
let lastLayoutEvent: TaskbarLyricLayoutEvent | null = null;
let playbackSnapshot: TaskbarPlaybackSnapshot | null = null;

/** 封面区域光标轮询间隔 */
const CURSOR_POLL_MS = 150;
const DEFAULT_QUEUE_WINDOW_WIDTH = 340;
const DEFAULT_QUEUE_WINDOW_HEIGHT = 520;
const MIN_QUEUE_WINDOW_WIDTH = 280;
const MAX_QUEUE_WINDOW_WIDTH = 600;
const MIN_QUEUE_WINDOW_HEIGHT = 360;
const MAX_QUEUE_WINDOW_HEIGHT = 800;
const QUEUE_WINDOW_GAP = 8;
const QUEUE_EXIT_CONCEAL_MS = 180;
const QUEUE_MOUSE_POLL_MS = 50;
const CONTROL_BUTTON_COUNT = 5;
const CONTROL_BUTTON_GAP = 4;
const CONTROL_PADDING = 4;
let cursorPollTimer: NodeJS.Timeout | null = null;
let mouseIgnored = false;
let coverHovered = false;

/** 歌词与封面分离当前是否实际生效 */
const isTaskbarLyricSeparationActive = (): boolean => {
  const config = store.get("taskbarLyric");
  return config.separateCoverAndLyric && !config.pureLyricMode;
};

const resolveTaskbarQueueSize = (): { width: number; height: number } => {
  const config = store.get("taskbarLyric");
  const rawWidth = Number.isFinite(config.queueWidth)
    ? config.queueWidth
    : DEFAULT_QUEUE_WINDOW_WIDTH;
  const rawHeight = Number.isFinite(config.queueHeight)
    ? config.queueHeight
    : DEFAULT_QUEUE_WINDOW_HEIGHT;
  return {
    width: Math.round(Math.max(MIN_QUEUE_WINDOW_WIDTH, Math.min(MAX_QUEUE_WINDOW_WIDTH, rawWidth))),
    height: Math.round(
      Math.max(MIN_QUEUE_WINDOW_HEIGHT, Math.min(MAX_QUEUE_WINDOW_HEIGHT, rawHeight)),
    ),
  };
};

interface ActiveWindowRegion {
  x: number;
  y: number;
  maxWidth: number;
  height: number;
  anchor: AnchorSide;
}

let activeWindowRegion: ActiveWindowRegion | null = null;
let contentWidth: number | null = null;
let appliedShape: string | null = null;
let mainWindowVisible = true;
let visibleMainWindowAnchor: AnchorSide | null = null;
let visibleMainWindowMaxWidth: number | null = null;

/**
 * 同步主窗口是否显示在任务栏
 * @param visible - 主窗口是否可见
 */
export const setTaskbarLyricMainWindowVisible = (visible: boolean): void => {
  mainWindowVisible = visible;
};

/**
 * 将配置中的 DIP 宽度转换为 Windows 10 预留空间所需的物理像素
 * @returns - 主屏任务栏的歌词宽度
 */
const resolveLyricWidth = (): number => {
  const width = store.get("taskbarLyric.maxWidth");
  return Math.round(
    (typeof width === "number" && width > 0 ? width : 400) * screen.getPrimaryDisplay().scaleFactor,
  );
};

/** 独立窗口可正常调整合成表面尺寸，无需预分配超大透明窗口 */
const INITIAL_WIDTH = 400;
const INITIAL_HEIGHT = 60;

/**
 * 可显示的最小宽度（DIP）任务栏挤满 / 居中且两侧仅余几十像素时，强行塞会变成挤压的几个字符
 * 视觉很糟，直接隐藏窗口；空间回升后再 show
 */
const MIN_LYRIC_WIDTH_DIP = 120;

/** 获取任务栏歌词窗口实例（未创建或已销毁时返回 null） */
export const getTaskbarLyricWindow = (): BrowserWindow | null =>
  taskbarLyricWindow && !taskbarLyricWindow.isDestroyed() ? taskbarLyricWindow : null;

/** 获取任务栏紧凑播放列表窗口 */
export const getTaskbarQueueWindow = (): BrowserWindow | null =>
  taskbarQueueWindow && !taskbarQueueWindow.isDestroyed() ? taskbarQueueWindow : null;

/** 获取当前任务栏播放快照 */
export const getTaskbarPlaybackSnapshot = (): TaskbarPlaybackSnapshot =>
  playbackSnapshot ?? {
    items: [],
    currentTrackId: null,
    playMode: "repeat-list",
    playModeDisabled: true,
    dragRightClickAction: "cancel",
    locale: getLocale(),
    theme: {
      isDark: true,
      appearanceStyle: "solid",
      imageBackground: {
        src: "",
        blur: 0,
        dim: 0.4,
        scale: 1.2,
      },
      primary: "244 244 245",
      primaryContainer: "63 63 70",
      surface: "16 16 20",
      surfaceAlt: "39 39 42",
      surfacePanel: "24 24 28",
      surfaceBright: "72 72 78",
      onSurface: "244 244 245",
      onSurfaceVariant: "161 161 170",
      outline: "82 82 91",
      outlineVariant: "63 63 70",
    },
  };

/** 请求主渲染进程重新同步任务栏播放快照 */
export const requestTaskbarPlaybackSnapshot = (): void => {
  sendToMain("taskbarLyric:playbackRequest");
};

/**
 * 更新任务栏播放快照
 * @param snapshot - 主渲染进程生成的轻量播放状态
 */
export const updateTaskbarPlaybackSnapshot = (snapshot: TaskbarPlaybackSnapshot): void => {
  if (!getTaskbarLyricWindow() && !getTaskbarQueueWindow()) return;
  playbackSnapshot = snapshot;
  getTaskbarLyricWindow()?.webContents.send("taskbarLyric:playbackChange", snapshot);
  getTaskbarQueueWindow()?.webContents.send("taskbarLyric:playbackChange", snapshot);
};

/** 没有任务栏相关窗口时释放播放快照 */
const releasePlaybackSnapshot = (): void => {
  if (!getTaskbarLyricWindow() && !getTaskbarQueueWindow()) playbackSnapshot = null;
};

/**
 * 切换原生画布鼠标穿透，离屏 Chromium 窗口始终不接收桌面输入
 * @param ignore - 是否忽略鼠标事件
 */
const setMouseIgnore = (ignore: boolean): void => {
  const win = getTaskbarLyricWindow();
  if (!win || mouseIgnored === ignore) return;
  mouseIgnored = ignore;
  surface?.setMousePassthrough(ignore);
};

/** 向任务栏歌词渲染端同步封面悬停状态 */
const setCoverHovered = (hovered: boolean): void => {
  if (coverHovered === hovered) return;
  coverHovered = hovered;
  getTaskbarLyricWindow()?.webContents.send("taskbarLyric:coverHover", hovered);
};

/** 判断光标是否落在指定窗口矩形内 */
const isCursorInside = (bounds: Electron.Rectangle): boolean => {
  const cursor = screen.getCursorScreenPoint();
  return (
    cursor.x >= bounds.x &&
    cursor.x < bounds.x + bounds.width &&
    cursor.y >= bounds.y &&
    cursor.y < bounds.y + bounds.height
  );
};

/** 计算封面在屏幕坐标中的交互区域 */
const getCoverBounds = (): Electron.Rectangle | null => {
  const win = getTaskbarLyricWindow();
  if (!win || !lastLayoutEvent || !store.get("taskbarLyric.showCover")) return null;
  const bounds = win.getBounds();
  const size = Math.max(0, bounds.height - 8);
  const x = lastLayoutEvent.anchor === "right" ? bounds.x + bounds.width - 6 - size : bounds.x + 6;
  return { x, y: bounds.y + 4, width: size, height: size };
};

/** 计算封面和展开控制栏在屏幕坐标中的完整交互区域 */
const getExpandedInteractionBounds = (
  coverBounds: Electron.Rectangle,
): Electron.Rectangle | null => {
  const win = getTaskbarLyricWindow();
  if (!win || !lastLayoutEvent) return null;
  const winBounds = win.getBounds();
  const buttonSize = Math.max(0, winBounds.height - 16);
  const controlsWidth =
    CONTROL_BUTTON_COUNT * buttonSize +
    (CONTROL_BUTTON_COUNT - 1) * CONTROL_BUTTON_GAP +
    CONTROL_PADDING * 2;
  const rawX = lastLayoutEvent.anchor === "right" ? coverBounds.x - controlsWidth : coverBounds.x;
  const rawRight =
    lastLayoutEvent.anchor === "right"
      ? coverBounds.x + coverBounds.width
      : coverBounds.x + coverBounds.width + controlsWidth;
  const x = Math.max(winBounds.x, rawX);
  const right = Math.min(winBounds.x + winBounds.width, rawRight);
  if (right <= x) return null;
  return { x, y: coverBounds.y, width: right - x, height: coverBounds.height };
};

/** 计算播放列表按钮在屏幕坐标中的交互区域 */
const getQueueButtonBounds = (): Electron.Rectangle | null => {
  const win = getTaskbarLyricWindow();
  if (!win || !lastLayoutEvent) return null;
  const winBounds = win.getBounds();
  const coverBounds = getCoverBounds();
  const buttonSize = Math.max(0, winBounds.height - 16);
  const x =
    lastLayoutEvent.anchor === "right"
      ? (coverBounds?.x ?? winBounds.x + winBounds.width - 6) - CONTROL_PADDING - buttonSize
      : (coverBounds ? coverBounds.x + coverBounds.width : winBounds.x + 6) +
        CONTROL_PADDING +
        (CONTROL_BUTTON_COUNT - 1) * (buttonSize + CONTROL_BUTTON_GAP);
  return { x, y: winBounds.y + 8, width: buttonSize, height: buttonSize };
};

/** 分离模式光标轮询：穿透时进入封面需要由 OS 坐标主动恢复交互 */
const pollSeparatedCursor = (): void => {
  const win = getTaskbarLyricWindow();
  if (!win || !win.isVisible()) return;
  const coverBounds = getCoverBounds();
  if (!coverBounds) {
    setCoverHovered(false);
    setMouseIgnore(true);
    return;
  }
  const interactionBounds = coverHovered ? getExpandedInteractionBounds(coverBounds) : coverBounds;
  if (interactionBounds && isCursorInside(interactionBounds)) {
    setMouseIgnore(false);
    setCoverHovered(true);
    return;
  }
  setCoverHovered(false);
  setMouseIgnore(true);
};

/** 启动封面区域光标轮询 */
const startCursorPolling = (): void => {
  if (cursorPollTimer) return;
  pollSeparatedCursor();
  cursorPollTimer = setInterval(pollSeparatedCursor, CURSOR_POLL_MS);
};

/** 停止封面区域光标轮询 */
const stopCursorPolling = (): void => {
  if (cursorPollTimer) clearInterval(cursorPollTimer);
  cursorPollTimer = null;
};

/** 应用歌词与封面分离配置 */
export const applyTaskbarLyricSeparation = (): void => {
  const win = getTaskbarLyricWindow();
  if (!win) return;
  const config = store.get("taskbarLyric");
  if (config.pureLyricMode) {
    stopCursorPolling();
    setCoverHovered(false);
    destroyTaskbarQueueWindow();
    setMouseIgnore(true);
    return;
  }
  if (!isTaskbarLyricSeparationActive()) {
    stopCursorPolling();
    setCoverHovered(false);
    setMouseIgnore(false);
    return;
  }
  startCursorPolling();
  const coverBounds = getCoverBounds();
  const hovered = !!coverBounds && isCursorInside(coverBounds);
  setCoverHovered(hovered);
  setMouseIgnore(!hovered);
};

/**
 * 分离模式下由渲染端在离开封面与控制区时恢复穿透
 * @param ignore - 是否穿透鼠标事件
 */
export const applyTaskbarLyricMouseIgnore = (ignore: boolean): void => {
  const config = store.get("taskbarLyric");
  if (config.pureLyricMode) {
    setCoverHovered(false);
    setMouseIgnore(true);
    return;
  }
  if (!isTaskbarLyricSeparationActive()) {
    setMouseIgnore(false);
    return;
  }
  if (ignore) setCoverHovered(false);
  setMouseIgnore(ignore);
};

/** 按内容宽度裁剪窗口，仅在区域变化时更新原生命中区域 */
const applyContentShape = (): void => {
  const win = getTaskbarLyricWindow();
  const region = activeWindowRegion;
  if (!win || !region) return;
  const config = store.get("taskbarLyric");
  const adjustOccupiedSpace =
    config.autoMaxWidth && config.autoAdjustOccupiedSpace && !isTaskbarLyricSeparationActive();
  const shapeWidth = Math.min(
    region.maxWidth,
    Math.max(
      MIN_LYRIC_WIDTH_DIP,
      Math.round(adjustOccupiedSpace ? (contentWidth ?? region.maxWidth) : region.maxWidth),
    ),
  );
  const x = region.anchor === "right" ? region.maxWidth - shapeWidth : 0;
  const shape =
    shapeWidth >= region.maxWidth ? [] : [{ x, y: 0, width: shapeWidth, height: region.height }];
  const shapeKey = JSON.stringify(shape);
  if (shapeKey === appliedShape) return;
  const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor;
  const rect = shape[0];
  surface?.setShape(
    rect
      ? {
          x: Math.round(rect.x * scale),
          y: 0,
          width: Math.round(rect.width * scale),
          height: Math.round(rect.height * scale),
        }
      : null,
  );
  appliedShape = shapeKey;
};

/**
 * 接收渲染端测得的内容目标宽度
 * @param width - 内容宽度（DIP）
 */
export const updateTaskbarLyricContentWidth = (width: number): void => {
  if (!Number.isFinite(width) || width <= 0) return;
  contentWidth = width;
  applyContentShape();
};

/** 根据设置和任务栏对齐方式选择使用哪侧空间以及锚定方向 */
const pickSpace = (layout: JsTaskbarLayout): PickedSpace | null => {
  const position: TaskbarLyricPosition = store.get("taskbarLyric.position") ?? "auto";
  const { left, right } = layout.space;
  const isCentered = layout.extra.isCentered;

  if (position === "left" && left.width > 0) return { rect: left, anchor: "left" };
  if (position === "right" && right.width > 0) return { rect: right, anchor: "right" };

  if (position === "auto") {
    if (isCentered) {
      if (left.width >= right.width) return { rect: left, anchor: "left" };
      return { rect: right, anchor: "right" };
    }
    return right.width > 0 ? { rect: right, anchor: "right" } : { rect: left, anchor: "left" };
  }

  if (right.width > 0) return { rect: right, anchor: "right" };
  if (left.width > 0) return { rect: left, anchor: "left" };
  return null;
};

/** 首次布局成功后才显示窗口，避免初始位置闪现 */
let firstLayoutDone = false;

/**
 * 任务栏不可用时同时隐藏画布和离屏页面，暂停绘制与高频同步
 * @param win - 离屏歌词窗口
 */
const hideIfVisible = (win: BrowserWindow): void => {
  surface?.setVisible(false);
  win.webContents.stopPainting();
  if (win.isVisible()) win.hide();
  stopCursorPolling();
  destroyTaskbarQueueWindow();
};

/**
 * 将原生任务栏屏幕坐标转换为 DIP，并按可用空间显示或隐藏歌词
 * @param layout - 屏幕物理像素布局，空区域表示任务栏暂不可用
 */
const applyLayout = (layout: JsTaskbarLayout): void => {
  const win = getTaskbarLyricWindow();
  if (!win) return;

  let picked = pickSpace(layout);
  const position: TaskbarLyricPosition = store.get("taskbarLyric.position") ?? "auto";
  if (!mainWindowVisible && position === "auto" && visibleMainWindowAnchor) {
    const rect = layout.space[visibleMainWindowAnchor];
    if (rect.width > 0) {
      picked = { rect, anchor: visibleMainWindowAnchor };
    }
  }
  if (!picked) {
    hideIfVisible(win);
    return;
  }
  const { rect, anchor } = picked;
  if (rect.width <= 0 || rect.height <= 0) {
    hideIfVisible(win);
    return;
  }

  const dipRect = screen.screenToDipRect(null, rect);
  // 用户自定义左右边距（DIP）：从可用空间两侧扣除
  const leftMargin = store.get("taskbarLyric.leftMargin") ?? 0;
  const rightMargin = store.get("taskbarLyric.rightMargin") ?? 0;
  const availX = dipRect.x + leftMargin;
  const availY = dipRect.y;
  const availWidth = dipRect.width - leftMargin - rightMargin;
  const availHeight = dipRect.height;

  if (availWidth < MIN_LYRIC_WIDTH_DIP) {
    hideIfVisible(win);
    return;
  }

  const config = store.get("taskbarLyric");
  const useAvailableWidth = config.autoMaxWidth || isTaskbarLyricSeparationActive();
  const availableWindowWidth = useAvailableWidth
    ? availWidth
    : Math.min(config.maxWidth, availWidth);
  const windowWidth =
    !mainWindowVisible && visibleMainWindowAnchor === anchor && visibleMainWindowMaxWidth !== null
      ? Math.min(availableWindowWidth, visibleMainWindowMaxWidth)
      : availableWindowWidth;
  const windowX = anchor === "right" ? availX + availWidth - windowWidth : availX;

  if (mainWindowVisible) {
    visibleMainWindowAnchor = anchor;
    visibleMainWindowMaxWidth = windowWidth;
  }

  const previousRegion = activeWindowRegion;
  activeWindowRegion = {
    x: windowX,
    y: availY,
    maxWidth: windowWidth,
    height: availHeight,
    anchor,
  };
  // 非整数 DPI 下 getBounds 会取整，比较上次请求可避免相同布局反复调整窗口
  if (
    !previousRegion ||
    previousRegion.x !== windowX ||
    previousRegion.y !== availY ||
    previousRegion.maxWidth !== windowWidth ||
    previousRegion.height !== availHeight
  ) {
    win.setBounds({ x: windowX, y: availY, width: windowWidth, height: availHeight });
  }
  const actualBounds = win.getBounds();
  const scale = screen.getPrimaryDisplay().scaleFactor;
  const pixelWidth = Math.ceil(actualBounds.width * scale);
  surface?.setBounds({
    x:
      anchor === "right"
        ? Math.round(rect.x + rect.width - rightMargin * scale) - pixelWidth
        : Math.round(rect.x + leftMargin * scale),
    y: rect.y,
    width: pixelWidth,
    height: Math.ceil(actualBounds.height * scale),
  });
  applyContentShape();

  const layoutEvent: TaskbarLyricLayoutEvent = {
    isCentered: layout.extra.isCentered,
    systemType: layout.extra.systemType,
    isLight: layout.extra.isLight,
    anchor,
    maxWidth: windowWidth,
    height: availHeight,
  };
  lastLayoutEvent = layoutEvent;
  win.webContents.send("taskbarLyric:layout", layoutEvent);
  getTaskbarQueueWindow()?.webContents.send("taskbarLyric:layout", layoutEvent);
  const wasVisible = win.isVisible();
  if (!firstLayoutDone || !wasVisible) {
    firstLayoutDone = true;
    win.webContents.startPainting();
    win.showInactive();
    win.webContents.invalidate();
  }
  surface?.setVisible(true);
  if (!wasVisible) applyTaskbarLyricSeparation();
  positionTaskbarQueueWindow();
  if (!config.pureLyricMode) createTaskbarQueueWindow();
};

/** Watcher 回调——任何任务栏相关变化都回到这里重算布局 */
const onLayoutChange = (): void => {
  service?.update(resolveLyricWidth());
};

/** 安全创建原生 watcher，失败只 warn 不中断启动 */
const tryStart = <T>(name: string, factory: () => T): T | null => {
  try {
    return factory();
  } catch (error) {
    taskbarLog.warn(`${name} 启动失败`, error);
    return null;
  }
};

/** 启动布局相关的四个 watcher（UIA / Tray / 两个注册表） */
const startWatchers = (mod: TaskbarLyricNative): void => {
  advancedRegWatcher = tryStart(
    "RegistryWatcher(Advanced)",
    () => new mod.RegistryWatcher(REG_SUBKEY_EXPLORER_ADVANCED, onLayoutChange),
  );
  themeRegWatcher = tryStart(
    "RegistryWatcher(Personalize)",
    () => new mod.RegistryWatcher(REG_SUBKEY_PERSONALIZE, onLayoutChange),
  );
  uiaWatcher = tryStart("UiaWatcher", () => new mod.UiaWatcher(onLayoutChange));
  trayWatcher = tryStart("TrayWatcher", () => new mod.TrayWatcher(onLayoutChange));
};

/** 停止布局相关的四个 watcher（不包含 TaskbarCreatedWatcher） */
const stopLayoutWatchers = (): void => {
  advancedRegWatcher?.stop();
  advancedRegWatcher = null;
  themeRegWatcher?.stop();
  themeRegWatcher = null;
  uiaWatcher?.stop();
  uiaWatcher = null;
  trayWatcher?.stop();
  trayWatcher = null;
};

/** Explorer 重建后刷新监听和布局，独立歌词窗口继续复用 */
const onExplorerRestart = (): void => {
  const win = getTaskbarLyricWindow();
  if (!service || !win) return;
  taskbarLog.info("探测到 Explorer 重启，刷新任务栏监听与布局");
  hideIfVisible(win);
  stopLayoutWatchers();
  service?.reinit();
  if (nativeModule) startWatchers(nativeModule);
};

/** 根据任务栏位置和锚点摆放紧凑播放列表 */
const positionTaskbarQueueWindow = (): void => {
  const lyricWin = getTaskbarLyricWindow();
  const queueWin = getTaskbarQueueWindow();
  if (!lyricWin || !queueWin || !lastLayoutEvent) return;

  const lyricBounds = lyricWin.getBounds();
  const display = screen.getDisplayMatching(lyricBounds);
  const workArea = display.workArea;
  const configuredSize = resolveTaskbarQueueSize();
  const width = Math.min(
    configuredSize.width,
    Math.max(MIN_QUEUE_WINDOW_WIDTH, workArea.width - 16),
  );
  const height = Math.min(
    configuredSize.height,
    Math.max(MIN_QUEUE_WINDOW_HEIGHT, workArea.height - 16),
  );
  const alignedX =
    lastLayoutEvent.anchor === "right" ? lyricBounds.x + lyricBounds.width - width : lyricBounds.x;
  const x = Math.max(workArea.x + 8, Math.min(workArea.x + workArea.width - width - 8, alignedX));

  const taskbarBelow = lyricBounds.y >= workArea.y + workArea.height;
  const taskbarAbove = lyricBounds.y + lyricBounds.height <= workArea.y;
  const preferredY = taskbarAbove
    ? lyricBounds.y + lyricBounds.height + QUEUE_WINDOW_GAP
    : lyricBounds.y - height - QUEUE_WINDOW_GAP;
  const fallbackY = taskbarBelow ? workArea.y + workArea.height - height : workArea.y;
  const y = Math.max(
    workArea.y + 8,
    Math.min(workArea.y + workArea.height - height - 8, preferredY || fallbackY),
  );

  queueWin.setBounds({ x, y, width, height });
};

/** 根据当前设置重新摆放任务栏播放列表窗口 */
export const applyTaskbarQueueLayout = (): void => {
  positionTaskbarQueueWindow();
};

/** 清理播放列表退出动画的收尾任务 */
const clearTaskbarQueueHideTimer = (): void => {
  if (taskbarQueueHideTimer === null) return;
  clearTimeout(taskbarQueueHideTimer);
  taskbarQueueHideTimer = null;
};

/** 判断光标是否位于播放列表或其触发按钮内 */
const isCursorInsideTaskbarQueueInteraction = (): boolean => {
  const queueWin = getTaskbarQueueWindow();
  if (queueWin && isCursorInside(queueWin.getBounds())) return true;
  const queueButtonBounds = getQueueButtonBounds();
  return !!queueButtonBounds && isCursorInside(queueButtonBounds);
};

/** 停止播放列表外部点击轮询 */
const stopTaskbarQueueMousePolling = (): void => {
  if (taskbarQueueMousePollTimer === null) return;
  clearInterval(taskbarQueueMousePollTimer);
  taskbarQueueMousePollTimer = null;
  taskbarQueueMouseWasDown = false;
};

/** 全屏应用未派发 blur 时，通过 Win32 按键状态补充外部点击关闭 */
const pollTaskbarQueueMouse = (): void => {
  if (!taskbarQueueShown || !nativeModule) {
    stopTaskbarQueueMousePolling();
    return;
  }
  const mouseDown = nativeModule.isMouseButtonActive();
  const pressedOutside =
    mouseDown && !taskbarQueueMouseWasDown && !isCursorInsideTaskbarQueueInteraction();
  taskbarQueueMouseWasDown = mouseDown;
  if (pressedOutside) closeTaskbarQueueWindow();
};

/** 启动播放列表外部点击轮询 */
const startTaskbarQueueMousePolling = (): void => {
  if (taskbarQueueMousePollTimer !== null || !nativeModule) return;
  taskbarQueueMouseWasDown = nativeModule.isMouseButtonActive();
  taskbarQueueMousePollTimer = setInterval(pollTaskbarQueueMouse, QUEUE_MOUSE_POLL_MS);
};

/** 显示已完成预热的任务栏播放列表窗口 */
const showTaskbarQueueWindow = (): void => {
  const lyricWin = getTaskbarLyricWindow();
  const queueWin = getTaskbarQueueWindow();
  if (!lyricWin?.isVisible() || !queueWin || !taskbarQueueReady) return;
  clearTaskbarQueueHideTimer();
  positionTaskbarQueueWindow();
  taskbarQueueShown = true;
  setWindowBroadcastVisibility(queueWin, true);
  queueWin.setFocusable(true);
  queueWin.setOpacity(1);
  queueWin.setIgnoreMouseEvents(false);
  queueWin.webContents.send("taskbarLyric:queueVisibilityChange", true);
  queueWin.focus();
  startTaskbarQueueMousePolling();
  taskbarQueueShowRequested = false;
};

/** 创建任务栏紧凑播放列表窗口 */
const createTaskbarQueueWindow = (): BrowserWindow | null => {
  const lyricWin = getTaskbarLyricWindow();
  if (!lyricWin) return null;
  const existing = getTaskbarQueueWindow();
  if (existing) return existing;

  const queueSize = resolveTaskbarQueueSize();
  taskbarQueueWindow = createWindow({
    width: queueSize.width,
    height: queueSize.height,
    minWidth: 0,
    minHeight: 0,
    type: "toolbar",
    title: "Taskbar Queue",
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      disableDialogs: true,
      zoomFactor: 1,
    },
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    taskbarQueueWindow.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/windows/taskbar-lyric/index.html?view=queue`,
    );
  } else {
    taskbarQueueWindow.loadFile(join(__dirname, "../renderer/windows/taskbar-lyric/index.html"), {
      query: { view: "queue" },
    });
  }

  taskbarQueueWindow.once("ready-to-show", () => {
    const win = getTaskbarQueueWindow();
    if (!win) return;
    taskbarQueueReady = true;
    positionTaskbarQueueWindow();
    win.setAlwaysOnTop(true, "pop-up-menu");
    // 透明且穿透地保留 DWM 合成表面，避免每次打开时重建透明窗口而闪烁
    win.setOpacity(0);
    setWindowBroadcastVisibility(win, false);
    win.setIgnoreMouseEvents(true);
    win.setFocusable(false);
    win.showInactive();
    win.webContents.send("taskbarLyric:queueVisibilityChange", false);
    win.on("blur", () => {
      const queueButtonBounds = getQueueButtonBounds();
      if (queueButtonBounds && isCursorInside(queueButtonBounds)) return;
      closeTaskbarQueueWindow();
    });
    if (lastLayoutEvent) win.webContents.send("taskbarLyric:layout", lastLayoutEvent);
    win.webContents.send("taskbarLyric:playbackChange", getTaskbarPlaybackSnapshot());
    requestTaskbarPlaybackSnapshot();
    if (taskbarQueueShowRequested) showTaskbarQueueWindow();
  });

  taskbarQueueWindow.on("closed", () => {
    taskbarQueueWindow = null;
    taskbarQueueReady = false;
    taskbarQueueShowRequested = false;
    taskbarQueueShown = false;
    clearTaskbarQueueHideTimer();
    stopTaskbarQueueMousePolling();
    releasePlaybackSnapshot();
  });
  return taskbarQueueWindow;
};

/** 隐藏任务栏紧凑播放列表，保留已加载页面供下次立即显示 */
export const closeTaskbarQueueWindow = (): void => {
  taskbarQueueShowRequested = false;
  const win = getTaskbarQueueWindow();
  if (!win || !taskbarQueueShown) return;
  taskbarQueueShown = false;
  stopTaskbarQueueMousePolling();
  setWindowBroadcastVisibility(win, false);
  win.webContents.send("taskbarLyric:queueVisibilityChange", false);
  win.setIgnoreMouseEvents(true);
  win.setFocusable(false);
  clearTaskbarQueueHideTimer();
  taskbarQueueHideTimer = setTimeout(() => {
    taskbarQueueHideTimer = null;
    if (taskbarQueueShown || win.isDestroyed()) return;
    win.setOpacity(0);
  }, QUEUE_EXIT_CONCEAL_MS);
};

/** 销毁任务栏紧凑播放列表并释放预热资源 */
const destroyTaskbarQueueWindow = (): void => {
  taskbarQueueShowRequested = false;
  taskbarQueueReady = false;
  taskbarQueueShown = false;
  clearTaskbarQueueHideTimer();
  stopTaskbarQueueMousePolling();
  const win = getTaskbarQueueWindow();
  if (win) {
    setWindowBroadcastVisibility(win, false);
    win.setOpacity(0);
    win.close();
  }
};

/** 切换任务栏紧凑播放列表 */
export const toggleTaskbarQueueWindow = (): void => {
  if (store.get("taskbarLyric.pureLyricMode")) {
    destroyTaskbarQueueWindow();
    return;
  }
  const existing = getTaskbarQueueWindow();
  if (taskbarQueueShown) {
    closeTaskbarQueueWindow();
    return;
  }
  taskbarQueueShowRequested = true;
  const win = existing ?? createTaskbarQueueWindow();
  if (win && taskbarQueueReady) showTaskbarQueueWindow();
};

/**
 * 创建离屏歌词页面及可重建的原生任务栏画布
 * @returns - Windows 歌词窗口，模块不可用时返回 null
 */
export const createTaskbarLyricWindow = (): BrowserWindow | null => {
  if (process.platform !== "win32") {
    taskbarLog.warn("任务栏歌词仅支持 Windows");
    return null;
  }

  if (taskbarLyricWindow && !taskbarLyricWindow.isDestroyed()) {
    service?.update(resolveLyricWidth());
    requestTaskbarPlaybackSnapshot();
    return taskbarLyricWindow;
  }

  if (!nativeModule) {
    nativeModule = loadNativeModule<TaskbarLyricNative>("taskbar-lyric.node", "taskbar-lyric");
    if (!nativeModule) {
      taskbarLog.error("原生模块加载失败");
      return null;
    }
  }

  const currentService = new nativeModule.TaskbarService((layout) => {
    if (service === currentService) applyLayout(layout);
  });
  service = currentService;
  const currentSurface = new nativeModule.TaskbarSurface((event) => {
    const win = getTaskbarLyricWindow();
    if (!win || surface !== currentSurface || !win.isVisible()) return;
    const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor;
    const position = { x: Math.round(event.x / scale), y: Math.round(event.y / scale) };
    if (event.kind === "mouseWheel") {
      win.webContents.sendInputEvent({
        type: "mouseWheel",
        ...position,
        deltaY: event.deltaY,
        deltaX: 0,
      });
    } else if (event.kind === "mouseMove" || event.kind === "mouseLeave") {
      win.webContents.sendInputEvent({ type: event.kind, ...position });
    } else if (event.kind === "mouseDown" || event.kind === "mouseUp") {
      win.webContents.sendInputEvent({
        type: event.kind,
        ...position,
        button: event.button as "left" | "middle" | "right",
        clickCount: event.clickCount,
      });
    }
  });
  surface = currentSurface;

  taskbarLyricWindow = createWindow({
    width: INITIAL_WIDTH,
    height: INITIAL_HEIGHT,
    minWidth: 0,
    minHeight: 0,
    type: "toolbar",
    title: "Taskbar Lyric",
    focusable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      disableDialogs: true,
      zoomFactor: 1.0,
      offscreen: { deviceScaleFactor: screen.getPrimaryDisplay().scaleFactor },
    },
  });
  // BrowserWindow 仅维护页面可见性和绘制时钟，桌面上的画面由原生画布显示
  taskbarLyricWindow.setOpacity(0);
  taskbarLyricWindow.setIgnoreMouseEvents(true);
  taskbarLyricWindow.webContents.setFrameRate(screen.getPrimaryDisplay().displayFrequency);
  taskbarLyricWindow.webContents.on("paint", (_event, _dirty, image) => {
    if (surface !== currentSurface) return;
    const size = image.getSize();
    currentSurface.present(image.toBitmap(), size.width, size.height);
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    taskbarLyricWindow.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/windows/taskbar-lyric/index.html`,
    );
  } else {
    taskbarLyricWindow.loadFile(join(__dirname, "../renderer/windows/taskbar-lyric/index.html"));
  }

  taskbarLyricWindow.once("ready-to-show", () => {
    const win = taskbarLyricWindow;
    const svc = service;
    const mod = nativeModule;
    if (!win || !svc || !mod) return;

    taskbarLog.info("任务栏离屏页面已就绪");
    svc.update(resolveLyricWidth());
    applyTaskbarLyricSeparation();
    requestTaskbarPlaybackSnapshot();
    if (!store.get("taskbarLyric.pureLyricMode")) createTaskbarQueueWindow();
    startWatchers(mod);
    taskbarCreatedWatcher = tryStart(
      "TaskbarCreatedWatcher",
      () => new mod.TaskbarCreatedWatcher(onExplorerRestart),
    );
  });

  taskbarLyricWindow.on("closed", () => {
    destroyTaskbarQueueWindow();
    taskbarLyricWindow = null;
    firstLayoutDone = false;
    lastLayoutEvent = null;
    mouseIgnored = false;
    coverHovered = false;
    activeWindowRegion = null;
    contentWidth = null;
    appliedShape = null;
    visibleMainWindowAnchor = null;
    visibleMainWindowMaxWidth = null;
    cleanupWatchers();
    setTrayTaskbarLyric(false);
    broadcast("taskbarLyric:visibilityChange", false);
    if (!isAppQuitting()) {
      store.set("windowStates.taskbarLyric.visible", false);
    }
    releasePlaybackSnapshot();
  });

  setTrayTaskbarLyric(true);
  broadcast("taskbarLyric:visibilityChange", true);
  store.set("windowStates.taskbarLyric.visible", true);
  return taskbarLyricWindow;
};

/** 停止并清空所有 watcher 与 service */
const cleanupWatchers = (): void => {
  stopCursorPolling();
  stopLayoutWatchers();
  taskbarCreatedWatcher?.stop();
  taskbarCreatedWatcher = null;
  service?.stop();
  service = null;
  surface?.stop();
  surface = null;
};

/** 请求关闭任务栏歌词窗口，实际清理由 "closed" 事件统一处理 */
export const closeTaskbarLyricWindow = (): void => {
  if (taskbarLyricWindow && !taskbarLyricWindow.isDestroyed()) {
    taskbarLyricWindow.close();
  }
};

/** 切换任务栏歌词窗口显隐，返回切换后是否打开（非 Windows 平台或创建失败返回 false） */
export const toggleTaskbarLyricWindow = (): boolean => {
  if (taskbarLyricWindow && !taskbarLyricWindow.isDestroyed()) {
    closeTaskbarLyricWindow();
    return false;
  }
  return createTaskbarLyricWindow() !== null;
};

/** 触发一次布局重算（配置变更后调用） */
export const applyTaskbarLyricLayout = (): void => {
  service?.update(resolveLyricWidth());
};
