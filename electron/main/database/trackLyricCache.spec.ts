// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const state = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock("./index", () => ({
  getDb: () => ({
    prepare: (sql: string) => state.db!.prepare(sql),
    transaction: (run: () => void) => () => {
      state.db!.exec("BEGIN");
      try {
        run();
        state.db!.exec("COMMIT");
      } catch (error) {
        state.db!.exec("ROLLBACK");
        throw error;
      }
    },
  }),
}));
vi.mock("@main/utils/cacheRefresh", () => ({ isConfiguredCacheExpired: () => false }));
import { buildFingerprint } from "./lyricMatchCache";
import { clearTrackLyricCache } from "./trackLyricCache";

const track: Track = {
  id: "123",
  source: "netease",
  title: "当前歌曲",
  artists: [],
  duration: 1000,
};

describe("单曲歌词缓存清理", () => {
  beforeEach(() => {
    state.db = new DatabaseSync(":memory:");
    state.db.exec(`
      CREATE TABLE lyric_cache (platform TEXT, platform_id TEXT, data TEXT);
      CREATE TABLE lyric_ttml_cache (platform TEXT, id TEXT, source TEXT, content TEXT);
      CREATE TABLE lyric_match_cache (fingerprint TEXT, platform TEXT, platform_id TEXT, extra TEXT);
      INSERT INTO lyric_cache VALUES ('netease', '123', '{}'), ('netease', 'other', '{}'), ('qqmusic', '123', '{}');
      INSERT INTO lyric_ttml_cache VALUES ('netease', '123', 'first', 'old'), ('netease', '123', 'second', NULL), ('netease', 'other', 'first', 'keep');
    `);
  });
  afterEach(() => state.db?.close());

  it("删除本曲所有 TTML 源及普通缓存，保留其他歌曲和同 ID 的其他平台", () => {
    clearTrackLyricCache(track);
    expect(state.db!.prepare("SELECT platform, platform_id FROM lyric_cache").all()).toEqual([
      { platform: "netease", platform_id: "other" },
      { platform: "qqmusic", platform_id: "123" },
    ]);
    expect(state.db!.prepare("SELECT id FROM lyric_ttml_cache").all()).toEqual([{ id: "other" }]);
  });

  it("本地歌曲清理匹配结果，包括 QQ mid，保留其他歌曲映射", () => {
    const local: Track = { ...track, source: "local" };
    state
      .db!.prepare("INSERT INTO lyric_match_cache VALUES (?, 'qqmusic', '123', ?)")
      .run(buildFingerprint(local), JSON.stringify({ mid: "mid" }));
    state.db!.exec(`
      INSERT INTO lyric_match_cache VALUES ('other', 'qqmusic', 'other', NULL);
      INSERT INTO lyric_ttml_cache VALUES ('qqmusic', 'mid', 'first', 'old'), ('qqmusic', '123', 'second', NULL);
    `);
    clearTrackLyricCache(local);
    expect(
      state.db!.prepare("SELECT * FROM lyric_ttml_cache WHERE platform = 'qqmusic'").all(),
    ).toEqual([]);
    expect(state.db!.prepare("SELECT fingerprint FROM lyric_match_cache").all()).toEqual([
      { fingerprint: "other" },
    ]);
    expect(
      state
        .db!.prepare("SELECT * FROM lyric_cache WHERE platform = 'netease' AND platform_id = '123'")
        .all(),
    ).toHaveLength(1);
  });

  it("QQ 直取歌词缓存中的 mid 也会清理", () => {
    state
      .db!.prepare("UPDATE lyric_cache SET data = ? WHERE platform = 'qqmusic'")
      .run(JSON.stringify({ extra: { mid: "extra-mid" } }));
    state.db!.exec("INSERT INTO lyric_ttml_cache VALUES ('qqmusic', 'extra-mid', 'first', 'old')");
    clearTrackLyricCache({ ...track, source: "qqmusic", extId: "456" });
    expect(
      state.db!.prepare("SELECT * FROM lyric_ttml_cache WHERE platform = 'qqmusic'").all(),
    ).toEqual([]);
  });
});
