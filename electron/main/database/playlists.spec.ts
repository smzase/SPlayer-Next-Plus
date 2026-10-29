// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock("@main/database", () => ({
  getDb: () => ({
    prepare: (sql: string) => state.db!.prepare(sql),
    transaction: (run: () => unknown) => () => {
      state.db!.exec("BEGIN");
      try {
        const result = run();
        state.db!.exec("COMMIT");
        return result;
      } catch (error) {
        state.db!.exec("ROLLBACK");
        throw error;
      }
    },
  }),
}));
vi.mock("@main/database/queries", () => ({ getTracksByIds: vi.fn() }));
import { reorderPlaylistTracks } from "./playlists";

/** @returns 当前歌单的持久化顺序和添加时间 */
const storedTracks = () =>
  state
    .db!.prepare(
      "SELECT track_id, added_at FROM playlist_tracks WHERE playlist_id = 'p' ORDER BY position",
    )
    .all();

describe("本地歌单顺序持久化", () => {
  beforeEach(() => {
    state.db = new DatabaseSync(":memory:");
    state.db.exec(`
      CREATE TABLE playlists (id TEXT PRIMARY KEY, type TEXT, title TEXT, description TEXT, cover TEXT, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE playlist_tracks (playlist_id TEXT, track_id TEXT, position INTEGER, added_at INTEGER, PRIMARY KEY(playlist_id, track_id));
      INSERT INTO playlists VALUES ('p', 'local', '歌单', NULL, NULL, 1, 1);
      INSERT INTO playlist_tracks VALUES ('p', 'a', 0, 10), ('p', 'b', 1, 20), ('p', 'c', 2, 30);
    `);
  });
  afterEach(() => state.db!.close());

  it("保存完整顺序且保留添加时间和歌曲数量", () => {
    const result = reorderPlaylistTracks("p", ["c", "a", "b"]);
    expect(storedTracks()).toEqual([
      { track_id: "c", added_at: 30 },
      { track_id: "a", added_at: 10 },
      { track_id: "b", added_at: 20 },
    ]);
    expect(result.trackCount).toBe(3);
    expect(result.updateTime).toBeGreaterThan(1);
  });

  it.each([
    ["a", "b"],
    ["a", "b", "b"],
    ["a", "b", "x"],
    ["a", "b", "c", "d"],
  ])("拒绝过期或无效顺序 %j", (...ids) => {
    const before = storedTracks();
    expect(() => reorderPlaylistTracks("p", ids)).toThrow("歌单内容已变化");
    expect(storedTracks()).toEqual(before);
  });

  it("中途写入失败时回滚此前位置和更新时间", () => {
    state.db!.exec(
      "CREATE TRIGGER fail_reorder BEFORE UPDATE ON playlist_tracks WHEN NEW.track_id = 'b' BEGIN SELECT RAISE(ABORT, 'write failed'); END",
    );
    const before = storedTracks();
    expect(() => reorderPlaylistTracks("p", ["c", "b", "a"])).toThrow("write failed");
    expect(storedTracks()).toEqual(before);
    expect(state.db!.prepare("SELECT updated_at FROM playlists").get()).toEqual({ updated_at: 1 });
  });

  it("拒绝不存在的歌单", () => {
    expect(() => reorderPlaylistTracks("missing", [])).toThrow("歌单不存在");
  });
});
