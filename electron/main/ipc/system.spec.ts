import { beforeEach, describe, expect, it, vi } from "vitest";
import { pathToFileURL } from "node:url";
import type { Track } from "@shared/types/player";

const mocks = vi.hoisted(() => ({
  handle: vi.fn<(channel: string, handler: (...args: unknown[]) => unknown) => void>(),
  clipboardWrite: vi.fn(),
  createFromBuffer: vi.fn(),
  stat: vi.fn(),
  lookupDownloadedFile: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {},
  clipboard: { write: mocks.clipboardWrite },
  ClipboardItem: vi.fn(function (data) {
    return { data };
  }),
  dialog: {},
  ipcMain: { handle: mocks.handle, on: vi.fn() },
  nativeImage: { createFromBuffer: mocks.createFromBuffer },
  shell: {},
}));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(), stat: mocks.stat, writeFile: vi.fn() }));
vi.mock("font-list", () => ({ getFonts: vi.fn() }));
vi.mock("@main/utils/i18n", () => ({ setLocale: vi.fn() }));
vi.mock("@main/utils/logger", () => ({ systemLog: { debug: vi.fn(), error: mocks.logError } }));
vi.mock("@main/services/tray", () => ({ refreshTray: vi.fn() }));
vi.mock("@main/services/thumbar", () => ({ getThumbar: vi.fn() }));
vi.mock("@main/window", () => ({ getMainWindow: vi.fn(), focusMainWindow: vi.fn() }));
vi.mock("@main/utils/fetchBytes", () => ({ fetchBytes: vi.fn() }));
vi.mock("@main/utils/paths", () => ({ logsDir: "logs" }));
vi.mock("@main/services/orpheus", () => ({ consumePendingOrpheusUrl: vi.fn() }));
vi.mock("@main/services/externalFile", () => ({ consumePendingAudioFiles: vi.fn() }));
vi.mock("@main/utils/proxy", () => ({ testNetworkProxy: vi.fn() }));
vi.mock("@main/store", () => ({ store: {} }));
vi.mock("@main/services/downloadManager", () => ({
  lookupDownloadedFile: mocks.lookupDownloadedFile,
}));

import { registerSystemIpc } from "./system";

/**
 * 取得已注册的系统处理器以验证剪贴板请求结果
 * @param channel - IPC 通道
 * @returns 对应的处理器
 */
const getHandler = (channel: string) =>
  mocks.handle.mock.calls.find(([name]) => name === channel)![1];

const localTrack: Track = {
  id: "local-track",
  source: "local",
  path: "D:\\Music\\歌曲 #1.flac",
  title: "歌曲 #1",
  artists: [{ name: "测试歌手" }],
  duration: 180000,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.stat.mockResolvedValue({ isFile: () => true, size: 100 });
  mocks.clipboardWrite.mockResolvedValue(undefined);
  mocks.createFromBuffer.mockReturnValue({ isEmpty: () => false, toPNG: () => Buffer.from("png") });
  registerSystemIpc();
});

describe("系统剪贴板 IPC", () => {
  it("本地歌曲以编码后的文件引用复制到剪贴板", async () => {
    expect(await getHandler("system:copyTrackFile")({}, localTrack)).toBe(true);
    expect(mocks.clipboardWrite.mock.calls[0][0][0].data).toEqual({
      "text/uri-list": `${pathToFileURL(localTrack.path!).href}\r\n`,
    });
  });

  it("CUE 歌曲复制实际音频文件，在线歌曲复制已完成的下载", async () => {
    const cueAudioPath = "D:\\Music\\专辑.flac";
    expect(await getHandler("system:copyTrackFile")({}, { ...localTrack, cueAudioPath })).toBe(
      true,
    );
    expect(mocks.stat).toHaveBeenCalledWith(cueAudioPath);

    const onlineTrack: Track = { ...localTrack, source: "netease", id: "1", path: undefined };
    mocks.lookupDownloadedFile.mockResolvedValue(localTrack.path);
    expect(await getHandler("system:copyTrackFile")({}, onlineTrack)).toBe(true);
    expect(mocks.lookupDownloadedFile).toHaveBeenCalledWith(onlineTrack);
    expect(mocks.clipboardWrite.mock.calls[1][0][0].data).toEqual({
      "text/uri-list": `${pathToFileURL(localTrack.path!).href}\r\n`,
    });
  });

  it("未完成下载和空文件不会覆盖剪贴板", async () => {
    mocks.lookupDownloadedFile.mockResolvedValue(null);
    expect(await getHandler("system:copyTrackFile")({}, { source: "netease" })).toBe(false);
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 0 });
    expect(await getHandler("system:copyTrackFile")({}, localTrack)).toBe(false);
    expect(mocks.clipboardWrite).not.toHaveBeenCalled();
  });

  it("文件复制在系统写入完成前不会报告成功", async () => {
    let finishWrite!: () => void;
    let completed = false;
    mocks.clipboardWrite.mockReturnValue(
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
    );
    const result = Promise.resolve(getHandler("system:copyTrackFile")({}, localTrack));
    void result.then(() => {
      completed = true;
    });
    await vi.waitFor(() => expect(mocks.clipboardWrite).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    finishWrite();
    expect(await result).toBe(true);
  });

  it("系统拒绝文件复制时返回失败并记录错误", async () => {
    const error = new Error("clipboard unavailable");
    mocks.clipboardWrite.mockRejectedValue(error);
    expect(await getHandler("system:copyTrackFile")({}, localTrack)).toBe(false);
    expect(mocks.logError).toHaveBeenCalledWith("复制歌曲文件失败", error);
  });

  it("有效图片写入 PNG 数据，损坏图片不会覆盖剪贴板", async () => {
    const data = new ArrayBuffer(3);
    expect(await getHandler("system:copyImage")({}, data)).toEqual({ success: true });
    const png = mocks.clipboardWrite.mock.calls[0][0][0].data["image/png"];
    expect(png.type).toBe("image/png");
    expect(await png.text()).toBe("png");

    mocks.createFromBuffer.mockReturnValue({ isEmpty: () => true });
    expect(await getHandler("system:copyImage")({}, data)).toEqual({
      success: false,
      error: "invalid image",
    });
    expect(mocks.clipboardWrite).toHaveBeenCalledOnce();
  });

  it("系统拒绝图片复制时返回失败", async () => {
    mocks.clipboardWrite.mockRejectedValue(new Error("clipboard unavailable"));
    expect(await getHandler("system:copyImage")({}, new ArrayBuffer(3))).toEqual({
      success: false,
      error: "Error: clipboard unavailable",
    });
  });
});
