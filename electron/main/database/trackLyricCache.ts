import type { Track } from "@shared/types/player";
import { isPlatform, type Platform } from "@shared/types/platform";
import { buildFingerprint } from "./lyricMatchCache";
import { getDb } from "./index";

export interface LyricCacheTarget {
  platform: Platform;
  id: string;
}

/**
 * 收集歌曲自身及跨平台匹配的缓存键，包括 QQ 音乐 mid 和过期映射
 * @param track - 待清理的歌曲
 * @returns 此歌曲关联的平台缓存键
 */
export const getTrackLyricCacheTargets = (track: Track): LyricCacheTarget[] => {
  const targets: LyricCacheTarget[] = [];
  if (isPlatform(track.source)) {
    targets.push({ platform: track.source, id: track.id });
    if (track.extId) targets.push({ platform: track.source, id: track.extId });
  }
  const mappings = getDb()
    .prepare(
      `SELECT platform, platform_id AS id,
      json_extract(CASE WHEN json_valid(extra) THEN extra ELSE NULL END, '$.mid') AS mid
     FROM lyric_match_cache WHERE fingerprint = ?`,
    )
    .all(buildFingerprint(track)) as (LyricCacheTarget & { mid: string | null })[];
  for (const mapping of mappings) {
    targets.push({ platform: mapping.platform, id: mapping.id });
    if (mapping.platform === "qqmusic" && mapping.mid) {
      targets.push({ platform: "qqmusic", id: mapping.mid });
    }
  }
  const qqIds = targets.filter((target) => target.platform === "qqmusic");
  for (const target of qqIds) {
    const row = getDb()
      .prepare(
        `SELECT json_extract(CASE WHEN json_valid(data) THEN data ELSE NULL END, '$.extra.mid') AS mid
       FROM lyric_cache WHERE platform = 'qqmusic' AND platform_id = ?`,
      )
      .get(target.id) as { mid: string | null } | undefined;
    if (row?.mid) targets.push({ platform: "qqmusic", id: row.mid });
  }
  return targets;
};

/**
 * 原子删除单曲普通歌词、各来源 TTML 和匹配记录
 * @param track - 待清理的歌曲
 */
export const clearTrackLyricCache = (track: Track): void => {
  const db = getDb();
  db.transaction(() => {
    const targets = getTrackLyricCacheTargets(track);
    const removeLyric = db.prepare(
      "DELETE FROM lyric_cache WHERE platform = ? AND platform_id = ?",
    );
    const removeTTML = db.prepare("DELETE FROM lyric_ttml_cache WHERE platform = ? AND id = ?");
    for (const { platform, id } of targets) {
      removeLyric.run(platform, id);
      removeTTML.run(platform, id);
    }
    db.prepare("DELETE FROM lyric_match_cache WHERE fingerprint = ?").run(buildFingerprint(track));
  })();
};
