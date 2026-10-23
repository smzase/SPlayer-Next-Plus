import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { flushPromises } from "@vue/test-utils";
import { GitHubProvider } from "electron-updater/out/providers/GitHubProvider";

const mocks = vi.hoisted(() => ({
  channel: "stable",
  autoCheck: true,
  packaged: true,
  dev: false,
  mac: false,
  portable: false,
  appx: false,
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  feed: vi.fn(),
  send: vi.fn(),
  open: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return mocks.packaged;
    },
    getVersion: () => "1.2.0-nightly.900",
  },
  shell: { openExternal: mocks.open },
}));
vi.mock("@main/utils/config", () => ({
  get isDev() {
    return mocks.dev;
  },
  get isMac() {
    return mocks.mac;
  },
  get isPortable() {
    return mocks.portable;
  },
  get isAppX() {
    return mocks.appx;
  },
}));
vi.mock("@main/store", () => ({
  store: { get: (key: string) => (key === "update.channel" ? mocks.channel : mocks.autoCheck) },
}));
vi.mock("@main/utils/broadcast", () => ({ sendToMain: mocks.send }));
vi.mock("@main/utils/logger", () => ({ updaterLog: { error: vi.fn() } }));
vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: Object.assign(new EventEmitter(), {
      checkForUpdates: mocks.check,
      downloadUpdate: mocks.download,
      quitAndInstall: mocks.install,
      setFeedURL: mocks.feed,
    }),
  },
  CancellationToken: class {
    cancel = mocks.cancel;
  },
}));

const info = {
  version: "1.3.0",
  releaseDate: "2026-09-30",
  releaseNotes: "notes",
  files: [{ url: "app-x64.exe", size: 10, sha512: "hash" }],
};
const available = { isUpdateAvailable: true, updateInfo: info };
const none = { isUpdateAvailable: false, updateInfo: info };

/** 显式控制底层任务的完成顺序，覆盖 IPC 与原生下载的交错。 */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;

describe.each(["win32", "linux"])("统一更新任务（%s）", (platform) => {
  beforeEach(() => {
    // 显式模拟安装平台，避免普通 Node 环境误入 Electron 安装包检测
    Object.defineProperty(process, "platform", { ...platformDescriptor, value: platform });
    vi.stubEnv("APPIMAGE", platform === "linux" ? "/opt/SPlayer.AppImage" : undefined);
    vi.resetModules();
    vi.clearAllMocks();
    Object.assign(mocks, {
      channel: "stable",
      autoCheck: true,
      packaged: true,
      dev: false,
      mac: false,
      portable: false,
      appx: false,
    });
    mocks.check.mockReset().mockResolvedValue(available);
    mocks.download.mockReset().mockResolvedValue([]);
    mocks.install.mockReset();
  });
  afterEach(async () => {
    try {
      (await import("./updater")).disposeUpdater();
    } finally {
      Object.defineProperty(process, "platform", platformDescriptor);
      vi.unstubAllEnvs();
    }
  });

  it("固定检查 fork Latest，下载完成后不自动退出安装", async () => {
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    await flushPromises();
    const updater = (await import("electron-updater")).default.autoUpdater;
    expect(updater.channel).toBe("latest");
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.allowPrerelease).toBe(false);
    expect(mocks.feed).toHaveBeenCalledWith({
      provider: "github",
      owner: "smzase",
      repo: "SPlayer-Next-Plus",
    });
    service.downloadUpdate();
    await flushPromises();
    expect(service.getUpdateState().phase).toBe("downloaded");
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it("真实 GitHub 解析器通过 Latest 清单发现 beta 版本并跳过 Nightly", async () => {
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    await flushPromises();
    const updater = (await import("electron-updater")).default.autoUpdater;
    const basePath = "/smzase/SPlayer-Next-Plus/releases";
    const tag = "v1.3.0-beta.1";
    const manifest = platform === "linux" ? "latest-linux.yml" : "latest.yml";
    vi.stubEnv("TEST_UPDATER_ARCH", "x64");
    const request = vi.fn(async (options: { hostname: string; path: string }) => {
      expect(options.hostname).toBe("github.com");
      if (options.path === `${basePath}.atom`) {
        return `<feed>${["nightly", tag]
          .map(
            (version) =>
              `<entry><title>${version}</title><link href="https://github.com${basePath}/tag/${version}"/><content>notes</content></entry>`,
          )
          .join("")}</feed>`;
      }
      if (options.path === `${basePath}/latest`) return JSON.stringify({ tag_name: tag });
      expect(options.path).toBe(`${basePath}/download/${tag}/${manifest}`);
      return JSON.stringify({ ...info, version: "1.3.0-beta.1" });
    });
    const provider = new GitHubProvider(mocks.feed.mock.lastCall![0], updater, {
      platform: platform as "win32" | "linux",
      isUseMultipleRangeRequest: false,
      executor: { request } as unknown as ConstructorParameters<
        typeof GitHubProvider
      >[2]["executor"],
    });
    const result = await provider.getLatestVersion();
    expect(result.version).toBe("1.3.0-beta.1");
    expect(result.tag).toBe(tag);
    expect(request).toHaveBeenCalledTimes(3);
    expect(provider.resolveFiles(result)[0].url.href).toBe(
      `https://github.com${basePath}/download/${tag}/app-x64.exe`,
    );
  });

  it("销毁后丢弃迟到的下载进度和成功结果", async () => {
    const pending = deferred<string[]>();
    mocks.download.mockReturnValueOnce(pending.promise);
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    await flushPromises();
    service.downloadUpdate();
    service.disposeUpdater();
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.feed).toHaveBeenCalledTimes(1);
    service.downloadUpdate();
    service.quitAndInstall();
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.install).not.toHaveBeenCalled();
    const updater = (await import("electron-updater")).default.autoUpdater;
    updater.emit("download-progress", {
      percent: 99,
      total: 100,
      delta: 99,
      transferred: 99,
      bytesPerSecond: 99,
    });
    updater.emit("update-downloaded", {
      ...info,
      path: "old.exe",
      sha512: "hash",
      downloadedFile: "old.exe",
    });
    expect(service.getUpdateState().percent).toBe(0);
    pending.resolve(["old.exe"]);
    await flushPromises();
    expect(mocks.feed).toHaveBeenCalledTimes(1);
    expect(service.getUpdateState().phase).toBe("downloading");
  });

  it.each(["stable", "beta", "alpha", "nightly"])(
    "旧配置 %s 不影响 fork Latest 和 beta 版本链接",
    async (channel) => {
      mocks.channel = channel;
      mocks.check.mockResolvedValueOnce({
        ...available,
        updateInfo: { ...info, version: "1.3.0-beta.1" },
      });
      const service = await import("./updater");
      service.initUpdater();
      service.openDownloadPage();
      expect(mocks.open).toHaveBeenLastCalledWith(
        "https://github.com/smzase/SPlayer-Next-Plus/releases/latest",
      );
      service.checkForUpdates(true);
      await flushPromises();
      const updater = (await import("electron-updater")).default.autoUpdater;
      expect(updater.channel).toBe("latest");
      expect(updater.allowPrerelease).toBe(false);
      expect(service.getUpdateState().meta?.version).toBe("1.3.0-beta.1");
      service.openDownloadPage();
      expect(mocks.open).toHaveBeenLastCalledWith(
        "https://github.com/smzase/SPlayer-Next-Plus/releases/tag/v1.3.0-beta.1",
      );
    },
  );

  it("下载失败后手动检查刷新目标，自动检查不干扰错误状态", async () => {
    mocks.download.mockRejectedValueOnce(new Error("old nightly removed"));
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    await flushPromises();
    service.downloadUpdate();
    await flushPromises();
    service.checkForUpdates(false);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    mocks.check.mockResolvedValueOnce({ ...available, updateInfo: { ...info, version: "1.4.0" } });
    service.checkForUpdates(true);
    expect(service.getUpdateState()).toMatchObject({ phase: "checking", meta: null });
    await flushPromises();
    expect(service.getUpdateState()).toMatchObject({
      phase: "available",
      meta: { version: "1.4.0" },
    });
  });

  it("下载失败与安装失败保留对应的重试目标", async () => {
    mocks.download.mockRejectedValueOnce(new Error("network"));
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    await flushPromises();
    service.downloadUpdate();
    await flushPromises();
    expect(service.getUpdateState()).toMatchObject({
      phase: "error",
      error: { source: "download" },
      meta: { version: "1.3.0" },
    });
    service.checkForUpdates(false);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    service.downloadUpdate();
    await flushPromises();
    mocks.install.mockImplementationOnce(() => {
      throw new Error("installer");
    });
    service.quitAndInstall();
    expect(service.getUpdateState()).toMatchObject({
      phase: "error",
      error: { source: "install" },
    });
    service.quitAndInstall();
    expect(mocks.install).toHaveBeenCalledTimes(2);
  });

  it("下载及检查去重，手动加入自动检查仍能收到结果提示", async () => {
    const pending = deferred<typeof none>();
    mocks.check.mockReturnValueOnce(pending.promise);
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(false);
    service.checkForUpdates(true);
    service.downloadUpdate();
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.download).not.toHaveBeenCalled();
    pending.resolve(none);
    await flushPromises();
    expect(mocks.send).toHaveBeenLastCalledWith(
      "update:event",
      expect.objectContaining({ notification: "upToDate", manual: true }),
    );
  });

  it.each(["dev", "mac", "portable"] as const)("%s 环境只能检查和打开外部下载", async (flag) => {
    mocks[flag] = true;
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    await flushPromises();
    service.downloadUpdate();
    service.quitAndInstall();
    expect(service.getUpdateState().mode).toBe("external");
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it("商店版不检查 GitHub，直接打开商店", async () => {
    mocks.appx = true;
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    service.openDownloadPage();
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.open).toHaveBeenCalledWith("ms-windows-store://updates");
  });

  it("销毁时取消下载，迟到错误不会重新检查或产生未处理 error", async () => {
    const pending = deferred<string[]>();
    mocks.download.mockReturnValueOnce(pending.promise);
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    await flushPromises();
    service.downloadUpdate();
    service.disposeUpdater();
    const updater = (await import("electron-updater")).default.autoUpdater;
    expect(() => updater.emit("error", new Error("cancelled"))).not.toThrow();
    pending.reject(new Error("cancelled"));
    await flushPromises();
    expect(updater.listenerCount("error")).toBe(0);
    expect(mocks.check).toHaveBeenCalledOnce();
  });
});
