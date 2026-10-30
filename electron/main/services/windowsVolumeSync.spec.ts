import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioPlayer } from "@splayer/audio-engine";
import { volumeGainToPosition, volumePositionToGain } from "../../../src/utils/volume";

const mocks = vi.hoisted(() => {
  const state = {
    gain: 1,
    sessionVolume: 1,
    sessionAvailable: true,
    muted: false,
    isWin: true,
    configured: false,
    onCreated: null as ((player: AudioPlayer) => void) | null,
  };
  const player = {
    getVolume: vi.fn(() => state.gain),
    setVolume: vi.fn((volume: number) => {
      state.gain = volume;
    }),
    getWindowsSessionVolume: vi.fn(() =>
      state.sessionAvailable ? (state.muted ? 0 : state.sessionVolume) : null,
    ),
    setWindowsSessionVolume: vi.fn((volume: number) => {
      if (!state.sessionAvailable) return false;
      state.sessionVolume = Math.fround(volume);
      return true;
    }),
    setWindowsSessionMuted: vi.fn((muted: boolean) => {
      if (!state.sessionAvailable) return false;
      state.muted = muted;
      return true;
    }),
  };
  return { state, player, sendToMain: vi.fn(), wsBroadcast: vi.fn(), setMediaVolume: vi.fn() };
});

vi.mock("@main/services/engine", () => ({
  getPlayer: () => mocks.player,
  onPlayerCreated: (callback: (player: AudioPlayer) => void) => {
    mocks.state.onCreated = callback;
  },
}));
vi.mock("@main/services/media", () => ({ setVolume: mocks.setMediaVolume }));
vi.mock("@main/server/broadcast", () => ({ wsBroadcast: mocks.wsBroadcast }));
vi.mock("@main/utils/broadcast", () => ({ sendToMain: mocks.sendToMain }));
vi.mock("@main/store", () => ({ store: { get: () => mocks.state.configured } }));
vi.mock("@main/utils/config", () => ({
  /** 读取测试场景的平台标记 */
  get isWin() {
    return mocks.state.isWin;
  },
}));
vi.mock("@main/utils/logger", () => ({ playerLog: { error: vi.fn() } }));

let sync: typeof import("./windowsVolumeSync");
const percentages = [0, 1, 5, 10, 50, 55, 65, 75, 85, 95, 100];

/**
 * 模拟同步模式下界面提交的音量
 * @param position - 音量滑块位置
 * @returns 提交到主进程的增益
 */
const toGain = (position: number): number => volumePositionToGain(position, true);

/**
 * 模拟同步模式下主进程回传音量的显示
 * @param gain - 主进程回传的增益
 * @returns 音量滑块位置
 */
const toPosition = (gain: number): number => volumeGainToPosition(gain, true);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  Object.assign(mocks.state, {
    gain: 1,
    sessionVolume: 1,
    sessionAvailable: true,
    muted: false,
    isWin: true,
    configured: false,
    onCreated: null,
  });
  sync = await import("./windowsVolumeSync");
});

afterEach(() => {
  sync.disposeWindowsVolumeSync();
  vi.useRealTimers();
});

describe("Windows 音量合成器同步", () => {
  it.each(percentages)("播放器音量百分之 %i 写入相同的合成器百分比", (percent) => {
    sync.setWindowsVolumeSyncEnabled(true);
    const gain = toGain(percent / 100);
    sync.setPlayerVolume(gain);

    expect(mocks.state.sessionVolume).toBeCloseTo(percent / 100, 6);
    expect(mocks.state.gain).toBe(1);
    expect(sync.getPlayerVolume()).toBe(gain);
    expect(mocks.sendToMain).toHaveBeenLastCalledWith("player:event", {
      type: "volume",
      data: { volume: gain },
    });
    vi.clearAllMocks();
    vi.advanceTimersByTime(1500);
    expect(mocks.sendToMain).not.toHaveBeenCalled();
    expect(mocks.player.setWindowsSessionVolume).not.toHaveBeenCalled();
  });

  it.each(percentages)("合成器音量百分之 %i 还原为相同的播放器百分比", (percent) => {
    sync.setWindowsVolumeSyncEnabled(true);
    sync.setPlayerVolume(toGain(percent === 0 ? 1 : 0));
    mocks.state.sessionVolume = Math.fround(percent / 100);
    vi.clearAllMocks();
    vi.advanceTimersByTime(500);

    expect(toPosition(sync.getPlayerVolume())).toBeCloseTo(percent / 100, 6);
    expect(mocks.sendToMain).toHaveBeenLastCalledWith("player:event", {
      type: "volume",
      data: { volume: expect.closeTo(toGain(percent / 100), 6) },
    });
    expect(mocks.wsBroadcast).toHaveBeenCalledOnce();
    expect(mocks.setMediaVolume).toHaveBeenCalledOnce();
    expect(mocks.player.setWindowsSessionVolume).not.toHaveBeenCalled();
  });

  it("合成器低音量相邻档和静音也能同步，重复轮询不回写", () => {
    sync.setWindowsVolumeSyncEnabled(true);
    sync.setPlayerVolume(0);
    for (const percent of [1, 2, 1, 0]) {
      mocks.state.sessionVolume = percent / 100;
      vi.clearAllMocks();
      vi.advanceTimersByTime(500);
      expect(toPosition(sync.getPlayerVolume())).toBeCloseTo(percent / 100, 6);
      expect(mocks.sendToMain).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1000);
      expect(mocks.sendToMain).toHaveBeenCalledOnce();
    }
    mocks.state.sessionVolume = 0.5;
    vi.advanceTimersByTime(500);
    mocks.state.muted = true;
    vi.advanceTimersByTime(500);
    expect(sync.getPlayerVolume()).toBe(0);
    mocks.state.muted = false;
    vi.advanceTimersByTime(500);
    expect(toPosition(sync.getPlayerVolume())).toBe(0.5);
  });

  it("启动及快速切换同步开关保留实际增益", () => {
    mocks.state.gain = toGain(0.5);
    mocks.state.configured = true;
    sync.initWindowsVolumeSync();
    expect(mocks.state.sessionVolume).toBeCloseTo(0.5);

    mocks.state.sessionVolume = 0.75;
    sync.setWindowsVolumeSyncEnabled(false);
    expect(mocks.state.gain).toBeCloseTo(toGain(0.75));
    expect(mocks.state.sessionVolume).toBe(1);
    expect(toPosition(sync.getPlayerVolume())).toBe(0.75);

    sync.setWindowsVolumeSyncEnabled(true);
    vi.advanceTimersByTime(500);
    expect(mocks.state.sessionVolume).toBeCloseTo(0.75);
    expect(mocks.state.gain).toBe(1);
    expect(mocks.state.muted).toBe(false);

    sync.setWindowsVolumeSyncEnabled(false);
    vi.advanceTimersByTime(100);
    expect(mocks.state.muted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("会话未就绪时保留引擎增益，恢复后同步正确百分比", () => {
    mocks.state.sessionAvailable = false;
    sync.setWindowsVolumeSyncEnabled(true);
    const gain = toGain(0.55);
    sync.setPlayerVolume(gain);
    expect(mocks.state.gain).toBe(gain);
    mocks.state.sessionAvailable = true;
    vi.advanceTimersByTime(500);
    expect(mocks.state.sessionVolume).toBeCloseTo(0.55);
    expect(mocks.state.gain).toBe(1);
  });

  it("输出设备或播放器重建后恢复相同合成器百分比", () => {
    sync.initWindowsVolumeSync();
    sync.setWindowsVolumeSyncEnabled(true);
    sync.setPlayerVolume(toGain(0.65));
    mocks.state.sessionVolume = 1;
    sync.reapplyWindowsVolume();
    expect(mocks.state.sessionVolume).toBeCloseTo(0.65);
    mocks.state.sessionVolume = 1;
    mocks.state.onCreated!(mocks.player as unknown as AudioPlayer);
    expect(mocks.state.sessionVolume).toBeCloseTo(0.65);
    expect(mocks.state.gain).toBe(1);
  });

  it("关闭同步及非 Windows 平台保留上游音量曲线", () => {
    const gain = volumePositionToGain(0.5);
    sync.setPlayerVolume(gain);
    expect(mocks.state.gain).toBe(gain);
    expect(mocks.player.setWindowsSessionVolume).not.toHaveBeenCalled();
    mocks.state.isWin = false;
    sync.setWindowsVolumeSyncEnabled(true);
    sync.setPlayerVolume(gain);
    expect(mocks.state.gain).toBe(gain);
    expect(mocks.player.setWindowsSessionVolume).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
