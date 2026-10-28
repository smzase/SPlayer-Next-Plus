import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  query: vi.fn(),
  byId: vi.fn(),
  targets: vi.fn(),
  waitTTML: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("electron", () => ({
  dialog: {},
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      state.handlers.set(name, handler),
  },
}));
vi.mock("@main/apis/common/lyric/netease", () => ({
  getByQuery: state.query,
  getByPlatformId: state.byId,
}));
vi.mock("@main/apis/common/lyric/qqmusic", () => ({}));
vi.mock("@main/apis/common/lyric/kugou", () => ({}));
vi.mock("@main/apis/common/lyric/ttml", () => ({ waitForTrackTTML: state.waitTTML }));
vi.mock("@main/database/trackLyricCache", () => ({
  getTrackLyricCacheTargets: state.targets,
  clearTrackLyricCache: state.clear,
}));
vi.mock("@main/database/lyricMatchCache", () => ({}));
vi.mock("@main/services/localLyricRepo", () => ({}));
vi.mock("@main/store", () => ({ store: { get: vi.fn() } }));
vi.mock("@main/utils/logger", () => ({ coreLog: { warn: vi.fn() } }));
import { registerLyricsIpc } from "./lyrics";

const track: Track = { id: "1", source: "netease", title: "歌曲", artists: [], duration: 1000 };

describe("单曲缓存清理 IPC", () => {
  beforeEach(() => {
    state.targets.mockReset().mockReturnValue([{ platform: "netease", id: "1" }]);
    state.waitTTML.mockReset().mockResolvedValue(undefined);
    state.clear.mockReset();
    state.query.mockReset();
    state.byId.mockReset();
    registerLyricsIpc();
  });

  it("先等待同曲匹配请求，再收集新匹配 ID 并等待 TTML，最后删除", async () => {
    let finishQuery!: (value: null) => void;
    let finishTTML!: () => void;
    state.query.mockReturnValue(
      new Promise<null>((resolve) => {
        finishQuery = resolve;
      }),
    );
    state.waitTTML.mockReturnValue(
      new Promise<void>((resolve) => {
        finishTTML = resolve;
      }),
    );
    const matching = state.handlers.get("lyrics:matchByQuery")!(null, "netease", track);
    const clearing = state.handlers.get("lyrics:clearTrackCache")!(null, track);
    expect(state.clear).not.toHaveBeenCalled();
    expect(state.waitTTML).not.toHaveBeenCalled();
    const targets = [
      { platform: "netease", id: "1" },
      { platform: "qqmusic", id: "new-mid" },
    ];
    state.targets.mockReturnValue(targets);
    finishQuery(null);
    await matching;
    await vi.waitFor(() => expect(state.waitTTML).toHaveBeenCalledWith(targets));
    expect(state.clear).not.toHaveBeenCalled();
    finishTTML();
    await clearing;
    expect(state.clear).toHaveBeenCalledWith(track);
  });

  it("其他歌曲请求不阻塞本曲缓存清理", async () => {
    let finish!: (value: null) => void;
    state.byId.mockReturnValue(
      new Promise<null>((resolve) => {
        finish = resolve;
      }),
    );
    const other = state.handlers.get("lyrics:matchById")!(null, "netease", "other");
    await state.handlers.get("lyrics:clearTrackCache")!(null, track);
    expect(state.clear).toHaveBeenCalledWith(track);
    finish(null);
    await other;
  });
});
