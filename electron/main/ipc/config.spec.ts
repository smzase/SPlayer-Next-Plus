import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  phase: "idle",
  set: vi.fn(),
  clear: vi.fn(),
  replaceAll: vi.fn(),
}));
vi.mock("electron", () => ({
  dialog: {},
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(name, handler),
  },
}));
vi.mock("@main/store", () => ({
  store: { set: mocks.set, clear: mocks.clear, replaceAll: mocks.replaceAll },
}));
vi.mock("@main/services/updater", () => ({
  getUpdateState: () => ({ phase: mocks.phase }),
}));
vi.mock("@main/utils/logger", () => ({ systemLog: {} }));
vi.mock("@main/utils/powerBlocker", () => ({ refreshPowerBlocker: vi.fn() }));
vi.mock("@main/utils/config", () => ({ isWin: true }));
vi.mock("@main/utils/broadcast", () => ({}));
vi.mock("@main/services/media", () => ({}));
vi.mock("@main/services/lastfm", () => ({}));
vi.mock("@main/services/engine", () => ({}));
vi.mock("@main/window", () => ({}));
vi.mock("@main/server", () => ({}));
vi.mock("@main/services/mcp/http", () => ({}));
vi.mock("@main/services/orpheus", () => ({}));
vi.mock("@main/services/thumbnail", () => ({}));

import { registerConfigIpc } from "./config";

describe("更新配置入口", () => {
  beforeEach(() => {
    mocks.phase = "idle";
    mocks.handlers.clear();
    registerConfigIpc();
  });

  it.each([
    ["config:reset", [], "clear"],
    ["config:replaceAll", [null, { update: { channel: "beta" } }], "replaceAll"],
  ] as const)("%s 安装启动中拒绝改动", (channel, args, method) => {
    const invoke = mocks.handlers.get(channel)!;
    invoke(...args);
    expect(mocks[method]).toHaveBeenCalledOnce();
    mocks.phase = "installing";
    expect(() => invoke(...args)).toThrow("安装启动中");
    expect(mocks[method]).toHaveBeenCalledOnce();
  });

  it("仍允许设置自动检查更新", () => {
    mocks.handlers.get("config:set")!(null, "update.autoCheck", false);
    expect(mocks.set).toHaveBeenCalledWith("update.autoCheck", false);
  });
});
