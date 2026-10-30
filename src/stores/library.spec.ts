import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@shared/types/errors";
import type { Track } from "@shared/types/player";

const cache = vi.hoisted(() => ({ setItem: vi.fn().mockResolvedValue(undefined) }));
vi.mock("localforage", () => ({ default: { createInstance: () => cache } }));
import { useLibraryStore } from "./library";

/**
 * 创建排序测试用的本地歌曲
 * @param id - 歌曲 ID
 * @returns 轻量歌曲信息
 */
const track = (id: string): Track => ({
  id,
  title: id,
  source: "local",
  artists: [],
  duration: 1000,
});

describe("本地喜欢歌曲排序", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    cache.setItem.mockReset().mockResolvedValue(undefined);
  });

  it("保存完整顺序，保留暂时不在音乐库中的喜欢 ID 和红心状态", async () => {
    const store = useLibraryStore();
    store.tracks = [track("a"), track("b"), track("c")];
    store.likedOrderedIds = ["a", "missing", "b", "c"];
    store.likedIdSet = new Set(store.likedOrderedIds);
    const saving = store.reorderLikedTracks(["c", "a", "b"]);
    expect(store.likedOrderedIds).toEqual(["c", "missing", "a", "b"]);
    expect(store.likedReordering).toBe(true);
    await saving;
    expect(cache.setItem).toHaveBeenCalledWith("liked-ids", ["c", "missing", "a", "b"]);
    expect([...store.likedIdSet]).toEqual(["a", "missing", "b", "c"]);
    expect(store.likedReordering).toBe(false);
  });

  it("存储失败恢复原顺序", async () => {
    const store = useLibraryStore();
    store.tracks = [track("a"), track("b")];
    store.likedOrderedIds = ["a", "b"];
    cache.setItem.mockRejectedValueOnce(new Error("write failed"));
    await expect(store.reorderLikedTracks(["b", "a"])).rejects.toThrow("write failed");
    expect(store.likedOrderedIds).toEqual(["a", "b"]);
    expect(store.likedReordering).toBe(false);
  });

  it.each([["a"], ["a", "a"], ["a", "x"]])("拒绝无效顺序 %j", async (...ids) => {
    const store = useLibraryStore();
    store.tracks = [track("a"), track("b")];
    store.likedOrderedIds = ["a", "b"];
    await expect(store.reorderLikedTracks(ids)).rejects.toThrow("歌单内容已变化");
    expect(store.likedOrderedIds).toEqual(["a", "b"]);
    expect(cache.setItem).not.toHaveBeenCalled();
  });
});

const mocks = vi.hoisted(() => ({
  addScanDir: vi.fn(),
  removeScanDir: vi.fn(),
}));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  Object.assign(window, {
    api: {
      library: {
        addScanDir: mocks.addScanDir,
        removeScanDir: mocks.removeScanDir,
      },
    },
  });
});

describe("曲库扫描目录", () => {
  it("添加成功时同步到本地列表且不触发移除", async () => {
    mocks.addScanDir.mockResolvedValue({ success: true, data: "C:/music" });
    const { useLibraryStore } = await import("./library");
    const store = useLibraryStore();
    const res = await store.addScanDir();
    expect(res.success).toBe(true);
    expect(store.scanDirs).toContain("C:/music");
    expect(mocks.removeScanDir).not.toHaveBeenCalled();
  });

  it("嵌套目录被主进程拒绝时列表不变且不调用移除", async () => {
    mocks.addScanDir.mockResolvedValue({
      success: false,
      error: ErrorCode.SCAN_DIR_NESTED,
    });
    const { useLibraryStore } = await import("./library");
    const store = useLibraryStore();
    store.scanDirs = ["C:/music"];
    const res = await store.addScanDir();
    expect(res.success).toBe(false);
    expect(res.error).toBe(ErrorCode.SCAN_DIR_NESTED);
    expect(store.scanDirs).toEqual(["C:/music"]);
    expect(mocks.removeScanDir).not.toHaveBeenCalled();
  });
});
