import { coreLog } from "@main/utils/logger";
import { store } from "@main/store";
import { isValidTtmlServer } from "@shared/utils/ttmlServer";
import type { LyricCacheTarget } from "@main/database/trackLyricCache";
import {
  getCachedTTML,
  setCachedTTML,
  type Platform as TtmlPlatform,
} from "@main/database/lyricTtmlCache";

const TIMEOUT_MS = 8000;

/** 请求完成即释放，预热与播放请求复用同一来源的进行中请求 */
const inflight = new Map<string, Promise<string | null>>();

/** 仅保留进行中的完整回退流程，结束后释放 */
const pending = new Set<{
  platform: TtmlPlatform;
  ids: readonly string[];
  promise: Promise<string | null>;
}>();

/**
 * 从单个源获取歌词并维护独立缓存
 * @param platform - 歌词平台
 * @param id - 歌曲 ID
 * @param template - 来源地址模板
 * @returns 歌词内容，未命中或请求失败时为 null
 */
const doFetch = async (
  platform: TtmlPlatform,
  id: string,
  template: string,
): Promise<string | null> => {
  const cached = getCachedTTML(platform, id, template);
  if (cached !== "miss") return cached;
  const path = platform === "netease" ? "ncm-lyrics" : "qq-lyrics";
  const url = template.replaceAll("%p", path).replaceAll("%s", encodeURIComponent(id));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 200) {
      const content = await res.text();
      if (!content.trim()) return null;
      setCachedTTML(platform, id, template, content);
      return content;
    }
    if (res.status === 404) {
      setCachedTTML(platform, id, template, null);
      return null;
    }
    // 临时故障不写负缓存，后续请求仍可重试此源
    coreLog.warn(`[ttml] ${platform}:${id} HTTP ${res.status}`);
    return null;
  } catch (err) {
    coreLog.warn(`[ttml] ${platform}:${id} fetch failed:`, err);
    return null;
  }
};

/**
 * 合并同一来源、平台和歌曲 ID 的并发请求
 * @param platform - 歌词平台
 * @param id - 歌曲 ID
 * @param template - 来源地址模板
 * @returns 共享的歌词请求
 */
const fetchOne = (platform: TtmlPlatform, id: string, template: string): Promise<string | null> => {
  const key = JSON.stringify([template, platform, id]);
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = doFetch(platform, id, template).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
};

/**
 * 按来源优先级依次尝试各候选 ID，命中即停止
 * @param platform - 歌词平台
 * @param ids - 按优先级排列的歌曲 ID 或 QQ 音乐 mid
 * @returns 首个命中的歌词，全部失败时为 null
 */
export const fetchTTML = (
  platform: TtmlPlatform,
  ids: readonly string[],
): Promise<string | null> => {
  if (!store.get("lyric.enableOnlineTTMLLyric")) return Promise.resolve(null);
  const templates = [...store.get("lyric.amllDbServer")];
  const promise = (async () => {
    for (const template of templates) {
      if (!isValidTtmlServer(template)) continue;
      for (const id of ids) {
        if (!id) continue;
        const result = await fetchOne(platform, id, template);
        if (result) return result;
      }
    }
    return null;
  })();
  const request = { platform, ids, promise };
  pending.add(request);
  return promise.finally(() => pending.delete(request));
};

/**
 * 清缓存前等待关联的 TTML 预热与多源回退完成，避免晚到结果重新写入
 * @param targets - 歌曲关联的平台缓存键
 */
export const waitForTrackTTML = async (targets: readonly LyricCacheTarget[]): Promise<void> => {
  const requests = [...pending].filter((request) =>
    targets.some(
      (target) => target.platform === request.platform && request.ids.includes(target.id),
    ),
  );
  await Promise.allSettled(requests.map((request) => request.promise));
};

/**
 * 在平台 ID 确定后预热歌词，播放时复用进行中的请求
 * @param platform - 歌词平台
 * @param ids - 候选歌曲 ID
 */
export const prefetchTTML = (platform: TtmlPlatform, ids: readonly string[]): void => {
  void fetchTTML(platform, ids);
};
