import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSystemConfig } from "@shared/defaults/settings";
import type { JsTaskbarLayout } from "@splayer/taskbar-lyric";

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  windows: [] as any[],
  layouts: [] as Array<(layout: JsTaskbarLayout) => void>,
  surfaces: [] as any[],
  restart: () => {},
  cursor: { x: -1, y: -1 },
  createWindow: vi.fn(),
  screenToDipRect: vi.fn((_window, rect) => rect),
}));

vi.mock("electron", () => ({
  BrowserWindow: class {},
  screen: {
    getPrimaryDisplay: () => ({ scaleFactor: 1.5, displayFrequency: 144 }),
    screenToDipRect: mocks.screenToDipRect,
    dipToScreenRect: (_window, rect) => rect,
    getCursorScreenPoint: () => mocks.cursor,
    getDisplayMatching: () => ({
      scaleFactor: 1.5,
      workArea: { x: 0, y: 0, width: 1920, height: 1032 },
    }),
  },
}));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));
vi.mock("./create", () => ({ createWindow: mocks.createWindow }));
vi.mock("@main/utils/nativeLoader", () => {
  class Watcher {
    stop = vi.fn();
  }
  return {
    loadNativeModule: () => ({
      TaskbarService: class extends Watcher {
        /**
         * 保存原生回调，以模拟异步布局和旧实例的迟到结果
         * @param callback - 接收任务栏布局的回调
         */
        constructor(callback: (layout: JsTaskbarLayout) => void) {
          super();
          mocks.layouts.push(callback);
        }
        update = vi.fn();
        reinit = vi.fn();
      },
      TaskbarSurface: class {
        setBounds = vi.fn();
        setShape = vi.fn();
        setMousePassthrough = vi.fn();
        setVisible = vi.fn();
        present = vi.fn();
        stop = vi.fn();
        /**
         * 保存原生输入接收器及画布调用
         * @param callback - 原生鼠标事件接收器
         */
        constructor(public callback: (event: unknown) => void) {
          mocks.surfaces.push(this);
        }
      },
      RegistryWatcher: Watcher,
      UiaWatcher: Watcher,
      TrayWatcher: Watcher,
      TaskbarCreatedWatcher: class extends Watcher {
        /**
         * 保存 Explorer 重建通知，测试恢复时复用窗口
         * @param callback - 任务栏重建回调
         */
        constructor(callback: () => void) {
          super();
          mocks.restart = callback;
        }
      },
      isMouseButtonActive: () => false,
    }),
  };
});
vi.mock("@main/utils/broadcast", () => ({
  broadcast: vi.fn(),
  sendToMain: vi.fn(),
  setWindowBroadcastVisibility: vi.fn(),
}));
vi.mock("@main/services/tray", () => ({ setTrayTaskbarLyric: vi.fn() }));
vi.mock("@main/utils/lifecycle", () => ({ isAppQuitting: () => false }));
vi.mock("@main/utils/logger", () => ({ taskbarLog: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("@main/utils/i18n", () => ({ getLocale: () => "zh-CN" }));
vi.mock("@main/store", () => ({
  store: {
    get: (key: string) =>
      key === "taskbarLyric" ? mocks.config : mocks.config[key.slice("taskbarLyric.".length)],
    set: vi.fn(),
  },
}));

/**
 * 构造左右均有空闲区域的物理像素任务栏布局
 * @returns - 与原生模块回调一致的测试数据
 */
const layout = (): JsTaskbarLayout => ({
  space: {
    left: { x: 0, y: 1032, width: 600, height: 48 },
    right: { x: 1000, y: 1032, width: 700, height: 48 },
  },
  extra: { isCentered: true, systemType: "win11", isLight: false },
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  mocks.config = { ...defaultSystemConfig.taskbarLyric };
  mocks.windows = [];
  mocks.layouts = [];
  mocks.surfaces = [];
  mocks.cursor = { x: -1, y: -1 };
  mocks.screenToDipRect.mockImplementation((_window, rect) => rect);
  mocks.createWindow.mockImplementation((options) => {
    let visible = false;
    let destroyed = false;
    let bounds = { x: 0, y: 0, width: options.width, height: options.height };
    const win = Object.assign(new EventEmitter(), {
      webContents: Object.assign(new EventEmitter(), {
        send: vi.fn(),
        sendInputEvent: vi.fn(),
        setFrameRate: vi.fn(),
        startPainting: vi.fn(),
        stopPainting: vi.fn(),
        invalidate: vi.fn(),
      }),
      loadFile: vi.fn(),
      isDestroyed: () => destroyed,
      isVisible: () => visible,
      getBounds: () => ({ ...bounds }),
      getNativeWindowHandle: () => {
        const handle = Buffer.alloc(8);
        handle.writeBigUInt64LE(123n);
        return handle;
      },
      setBounds: vi.fn((next) => {
        bounds = { ...next };
      }),
      setShape: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      setOpacity: vi.fn(),
      setFocusable: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      focus: vi.fn(),
      showInactive: vi.fn(() => {
        visible = true;
      }),
      hide: vi.fn(() => {
        visible = false;
      }),
      close: vi.fn(() => {
        destroyed = true;
        win.emit("closed");
      }),
    });
    mocks.windows.push(win);
    return win;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("任务栏独立歌词窗口", () => {
  it("将小任务栏实际 DIP 高度传给歌词与播放列表页面", async () => {
    mocks.screenToDipRect.mockReturnValue({ x: 0, y: 1050, width: 700, height: 24 });
    const api = await import("./taskbarLyric");
    api.createTaskbarLyricWindow();
    mocks.layouts[0](layout());
    expect(mocks.windows[0].webContents.send).toHaveBeenCalledWith(
      "taskbarLyric:layout",
      expect.objectContaining({ height: 24 }),
    );
  });

  it("普通模式保留完整交互区域，重复布局不重设边界或裁剪", async () => {
    const api = await import("./taskbarLyric");
    api.createTaskbarLyricWindow();
    const win = mocks.windows[0];
    win.emit("ready-to-show");
    mocks.layouts[0](layout());
    mocks.layouts[0](layout());
    expect(win.getBounds()).toEqual({ x: 1000, y: 1032, width: 700, height: 48 });
    expect(win.setBounds).toHaveBeenCalledTimes(1);
    expect(mocks.surfaces[0].setShape).toHaveBeenCalledExactlyOnceWith(null);
    expect(win.setOpacity).toHaveBeenCalledWith(0);
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledExactlyOnceWith(true);
    expect(win.webContents.setFrameRate).toHaveBeenCalledWith(144);
    expect(mocks.createWindow.mock.calls[0][0].webPreferences.offscreen).toEqual({
      deviceScaleFactor: 1.5,
    });
    expect(win.hide).not.toHaveBeenCalled();
    expect(win.showInactive).toHaveBeenCalledTimes(1);
    expect(mocks.createWindow.mock.calls[0][0]).toMatchObject({ focusable: false });
  });

  it("使用屏幕 DIP 转换结果，右侧内容裁剪与窗口原点一致", async () => {
    mocks.config.autoAdjustOccupiedSpace = true;
    mocks.screenToDipRect.mockReturnValue({ x: -800, y: 800, width: 700, height: 48 });
    const api = await import("./taskbarLyric");
    api.createTaskbarLyricWindow();
    mocks.layouts[0](layout());
    api.updateTaskbarLyricContentWidth(180);
    expect(mocks.windows[0].getBounds().x).toBe(-800);
    expect(mocks.surfaces[0].setShape).toHaveBeenLastCalledWith({
      x: 780,
      y: 0,
      width: 270,
      height: 72,
    });
    api.updateTaskbarLyricContentWidth(700);
    expect(mocks.surfaces[0].setShape).toHaveBeenLastCalledWith(null);
  });

  it("非整数缩放导致 getBounds 取整时，相同布局仍只应用一次", async () => {
    const api = await import("./taskbarLyric");
    api.createTaskbarLyricWindow();
    const win = mocks.windows[0];
    mocks.layouts[0](layout());
    win.getBounds = () => ({ x: 1000, y: 1032, width: 701, height: 48 });
    mocks.layouts[0](layout());
    expect(win.setBounds).toHaveBeenCalledTimes(1);
  });

  it("首次显示分离模式时即使用新的右侧封面区域", async () => {
    mocks.config.separateCoverAndLyric = true;
    mocks.cursor = { x: 1680, y: 1050 };
    const api = await import("./taskbarLyric");
    api.createTaskbarLyricWindow();
    const win = mocks.windows[0];
    win.emit("ready-to-show");
    mocks.layouts[0](layout());
    expect(win.webContents.send).toHaveBeenCalledWith("taskbarLyric:coverHover", true);
    expect(mocks.surfaces[0].setMousePassthrough).toHaveBeenLastCalledWith(false);
    mocks.cursor = { x: 1200, y: 1050 };
    vi.advanceTimersByTime(150);
    expect(mocks.surfaces[0].setMousePassthrough).toHaveBeenLastCalledWith(true);
    mocks.config.separateCoverAndLyric = false;
    api.applyTaskbarLyricSeparation();
    expect(mocks.surfaces[0].setMousePassthrough).toHaveBeenLastCalledWith(false);
  });

  it("纯歌词模式保持穿透，退出纯歌词模式恢复普通交互", async () => {
    const api = await import("./taskbarLyric");
    api.createTaskbarLyricWindow();
    mocks.layouts[0](layout());
    mocks.config.pureLyricMode = true;
    api.applyTaskbarLyricSeparation();
    expect(mocks.surfaces[0].setMousePassthrough).toHaveBeenLastCalledWith(true);
    expect(api.getTaskbarQueueWindow()).toBeNull();
    mocks.config.pureLyricMode = false;
    api.applyTaskbarLyricSeparation();
    expect(mocks.surfaces[0].setMousePassthrough).toHaveBeenLastCalledWith(false);
  });

  it("Explorer 重建后复用歌词窗口，已关闭实例的迟到回调被忽略", async () => {
    const api = await import("./taskbarLyric");
    api.createTaskbarLyricWindow();
    const win = mocks.windows[0];
    win.emit("ready-to-show");
    mocks.layouts[0](layout());
    mocks.restart();
    expect(win.isVisible()).toBe(false);
    expect(win.isDestroyed()).toBe(false);
    expect(mocks.surfaces[0].setVisible).toHaveBeenLastCalledWith(false);
    expect(win.webContents.stopPainting).toHaveBeenCalled();
    mocks.layouts[0](layout());
    expect(win.isVisible()).toBe(true);
    api.closeTaskbarLyricWindow();
    api.createTaskbarLyricWindow();
    const newWin = api.getTaskbarLyricWindow();
    mocks.layouts[0](layout());
    expect(newWin?.isVisible()).toBe(false);
    mocks.layouts[1](layout());
    expect(newWin?.isVisible()).toBe(true);
  });

  it("把原生物理坐标转换为页面坐标，隐藏时不转发输入", async () => {
    const api = await import("./taskbarLyric");
    api.createTaskbarLyricWindow();
    const win = mocks.windows[0];
    win.emit("ready-to-show");
    mocks.layouts[0](layout());
    const event = { kind: "mouseDown", x: 150, y: 30, button: "left", clickCount: 2 };
    mocks.surfaces[0].callback(event);
    expect(win.webContents.sendInputEvent).toHaveBeenCalledExactlyOnceWith({
      type: "mouseDown",
      x: 100,
      y: 20,
      button: "left",
      clickCount: 2,
    });
    mocks.restart();
    mocks.surfaces[0].callback(event);
    expect(win.webContents.sendInputEvent).toHaveBeenCalledTimes(1);
  });
});
