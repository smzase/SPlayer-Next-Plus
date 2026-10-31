// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricMatchResult } from "@shared/types/lyrics";

const state = vi.hoisted(() => ({ db: null as DatabaseSync | null, expired: false }));
vi.mock("./index", () => ({ getDb: () => state.db }));
vi.mock("@main/utils/cacheRefresh", () => ({ isConfiguredCacheExpired: () => state.expired }));
import { withLyricCache, clearLyricCache } from "./lyricCache";

const oldLyric: LyricMatchResult = { platform: "netease", format: "lrc", content: "[00:01]旧歌词" };

describe("平台歌词缓存刷新与故障回退", () => {
  beforeEach(() => {
    state.expired = false;
    state.db = new DatabaseSync(":memory:");
    state.db.exec(`CREATE TABLE lyric_cache (
      platform TEXT NOT NULL, platform_id TEXT NOT NULL, data TEXT NOT NULL,
      fetched_at INTEGER NOT NULL, PRIMARY KEY (platform, platform_id)
    )`);
  });
  afterEach(() => state.db?.close());

  it("遵循用户缓存周期，过期后获取新歌词", async () => {
    await withLyricCache("netease", "1", async () => oldLyric);
    const fetcher = vi.fn(async () => ({ ...oldLyric, content: "[00:01]新歌词" }));
    expect(await withLyricCache("netease", "1", fetcher)).toEqual(oldLyric);
    expect(fetcher).not.toHaveBeenCalled();
    state.expired = true;
    expect((await withLyricCache("netease", "1", fetcher))?.content).toBe("[00:01]新歌词");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("请求失败保留旧缓存及其时间，主动清理后不再回退", async () => {
    await withLyricCache("netease", "1", async () => oldLyric);
    const before = state.db!.prepare("SELECT fetched_at FROM lyric_cache").get();
    state.expired = true;
    expect(await withLyricCache("netease", "1", async () => null)).toEqual(oldLyric);
    expect(state.db!.prepare("SELECT fetched_at FROM lyric_cache").get()).toEqual(before);
    clearLyricCache();
    expect(await withLyricCache("netease", "1", async () => null)).toBeNull();
  });
});
