// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as DatabaseSync | null, expired: false }));
vi.mock("./index", () => ({ getDb: () => state.db }));
vi.mock("@main/utils/cacheRefresh", () => ({ isConfiguredCacheExpired: () => state.expired }));
import { getCachedTTML, setCachedTTML, clearLyricTtmlCache } from "./lyricTtmlCache";

describe("TTML 来源缓存隔离", () => {
  beforeEach(() => {
    state.expired = false;
    state.db = new DatabaseSync(":memory:");
    state.db.exec(`CREATE TABLE lyric_ttml_cache (
      platform TEXT NOT NULL, id TEXT NOT NULL, source TEXT NOT NULL,
      content TEXT, fetched_at INTEGER NOT NULL, PRIMARY KEY (platform, id, source)
    )`);
  });
  afterEach(() => state.db?.close());

  it("同一歌曲不同源的正负缓存互不覆盖", () => {
    setCachedTTML("netease", "1", "first", null);
    setCachedTTML("netease", "1", "second", "<tt>second</tt>");
    expect(getCachedTTML("netease", "1", "first")).toEqual({ content: null, fresh: true });
    expect(getCachedTTML("netease", "1", "second")).toEqual({
      content: "<tt>second</tt>",
      fresh: true,
    });
    expect(getCachedTTML("netease", "1", "third")).toBeNull();
    expect(getCachedTTML("qqmusic", "1", "second")).toBeNull();
  });

  it("过期保留旧内容供故障回退，主动清理移除所有源", () => {
    setCachedTTML("netease", "1", "first", "first");
    setCachedTTML("netease", "1", "second", "second");
    state.expired = true;
    expect(getCachedTTML("netease", "1", "first")).toEqual({ content: "first", fresh: false });
    state.expired = false;
    expect(getCachedTTML("netease", "1", "second")).toEqual({ content: "second", fresh: true });
    clearLyricTtmlCache();
    expect(getCachedTTML("netease", "1", "second")).toBeNull();
  });
});
