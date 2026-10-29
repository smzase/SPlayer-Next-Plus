import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
