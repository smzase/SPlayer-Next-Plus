/**
 * TTML 歌词缓存（来自 AMLL TTML DB）
 *
 * 正负缓存按平台、歌曲 ID 和源模板隔离，均遵循数据库缓存刷新周期
 *
 * - id：NCM 用 netease 数字 id；QM 用 mid
 * - content：TTML 文本，NULL 表示负缓存（DB 没有这首）
 * - 正负缓存均按数据库缓存刷新周期重新获取
 */

import { isConfiguredCacheExpired } from "@main/utils/cacheRefresh";
import { getDb } from "./index";

export type Platform = "netease" | "qqmusic";

/**
 * 读取指定来源的 TTML 缓存
 * @param platform - 歌词平台
 * @param id - 平台歌曲 ID
 * @param source - 来源模板
 * @returns 歌词文本、未命中记录 null，或无有效缓存时的 "miss"
 */
export const getCachedTTML = (
  platform: Platform,
  id: string,
  source: string,
): string | null | "miss" => {
  const row = getDb()
    .prepare(
      "SELECT content, fetched_at FROM lyric_ttml_cache WHERE platform = ? AND id = ? AND source = ?",
    )
    .get(platform, id, source) as { content: string | null; fetched_at: number } | undefined;
  if (!row) return "miss";
  if (isConfiguredCacheExpired(row.fetched_at, "database")) {
    getDb()
      .prepare("DELETE FROM lyric_ttml_cache WHERE platform = ? AND id = ? AND source = ?")
      .run(platform, id, source);
    return "miss";
  }
  return row.content;
};

/**
 * 写入指定来源的 TTML 缓存
 * @param platform - 歌词平台
 * @param id - 平台歌曲 ID
 * @param source - 来源模板
 * @param content - 歌词文本，null 表示该源未命中
 */
export const setCachedTTML = (
  platform: Platform,
  id: string,
  source: string,
  content: string | null,
): void => {
  getDb()
    .prepare(
      `INSERT INTO lyric_ttml_cache (platform, id, source, content, fetched_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(platform, id, source) DO UPDATE SET
         content = excluded.content,
         fetched_at = excluded.fetched_at`,
    )
    .run(platform, id, source, content, Date.now());
};

/** 清空全部 TTML 缓存 */
export const clearLyricTtmlCache = (): void => {
  getDb().prepare("DELETE FROM lyric_ttml_cache").run();
};
