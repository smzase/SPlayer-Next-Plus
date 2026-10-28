/**
 * 当前歌曲歌词加载服务
 */

import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricFormat, LyricInput } from "lyric-kit";
import type { LyricData } from "@shared/types/lyrics";

import { isPlatform } from "@shared/types/platform";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { lyricPreferenceKey, useLyricPreferenceStore } from "@/stores/lyricPreference";
import { DEFAULT_LYRIC_FORMAT_ORDER } from "@/types/settings";
import {
  embeddedLyricFromDetail,
  isBetterFormat,
  isPluginLyricPreferred,
  resolveLocalRepoLyric,
  resolveOnlineByPreference,
  resolvePluginLyric,
  resolvePlatformLyric,
  resolveStreamingLyric,
  resolveStreamingByPreference,
  resolveTTMLOverlay,
  type LocalLyric,
  type OnlineResult,
  type ResolvedLyric,
} from "@/services/lyric/resolve";
import { consumePreloadedLyric, invalidatePreloadedLyric } from "@/services/lyric/preload";

/** 竞态 token */
let currentToken = 0;

/** 清理期间暂缓同曲加载，切歌不受影响 */
let clearingTrackKey: string | null = null;

/**
 * 清理当前歌曲的歌词缓存并重新加载，切歌后不回写原歌曲
 * @returns 清理完成后结束
 */
export const clearCurrentLyricCache = async (): Promise<void> => {
  const media = useMediaStore();
  const track = media.track;
  if (!track || clearingTrackKey !== null) return;
  const key = lyricPreferenceKey(track);
  clearingTrackKey = key;
  currentToken++;
  media.ttmlCandidate = null;
  invalidatePreloadedLyric();
  try {
    await window.api.lyrics.clearTrackCache(toRaw(track));
  } finally {
    clearingTrackKey = null;
    if (media.track && lyricPreferenceKey(media.track) === key) {
      await loadForTrack(media.detail);
    }
  }
};

/**
 * 从外部歌词列表中选出最优格式的索引
 * @param lyrics - 外部歌词列表
 * @param priority - 自定义格式优先级
 * @returns 最优格式的索引，无可用歌词时返回 -1
 */
const bestExternalIndex = (
  lyrics: { format: LyricFormat }[],
  priority?: readonly LyricFormat[],
): number => {
  if (lyrics.length === 0) return -1;
  const order = priority && priority.length > 0 ? priority : DEFAULT_LYRIC_FORMAT_ORDER;
  let bestIdx = 0;
  let bestPriority = order.length;
  for (let i = 0; i < lyrics.length; i++) {
    const p = order.indexOf(lyrics[i].format);
    const rank = p === -1 ? order.length : p;
    if (rank < bestPriority) {
      bestPriority = rank;
      bestIdx = i;
    }
  }
  return bestIdx;
};

/**
 * 读取本地歌词
 * @param detail - 歌曲详细信息
 */
const readLocal = async (
  detail: TrackDetail,
): Promise<{ source: NonNullable<LyricData>; content: string } | null> => {
  const order = useSettingsStore().lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const idx = bestExternalIndex(detail.externalLyrics, order);
  if (idx !== -1) {
    const ext = detail.externalLyrics[idx];
    const result = await window.api.player.readLyricFile(ext.path);
    if (!result.success || result.data == null) return null;
    return { source: { source: "external", format: ext.format }, content: result.data };
  }
  return embeddedLyricFromDetail(detail);
};

/**
 * 提交歌词
 * @param token - 竞态 token
 * @param source - 歌词源
 * @param input - 歌词内容
 */
const commit = (token: number, source: LyricData, input: LyricInput | null): void => {
  if (token !== currentToken) return;
  useMediaStore().setLyric(source, input);
};

/** 提交本地歌词 */
const commitLocal = (token: number, local: LocalLyric): void => {
  commit(token, local.source, { content: local.content });
};

/**
 * 提交歌词并返回解析是否有效
 * @param token - 竞态 token
 * @param source - 歌词源
 * @param input - 歌词内容
 */
const commitAndHasParsed = (
  token: number,
  source: NonNullable<LyricData>,
  input: LyricInput,
): boolean => {
  commit(token, source, input);
  if (token !== currentToken) return false;
  return useMediaStore().parsedLyric.length > 0;
};

/** 提交已解析歌词候选并返回是否有效 */
const commitResolvedAndHasParsed = (token: number, resolved: ResolvedLyric): boolean =>
  commitAndHasParsed(token, resolved.source, resolved.input);

/**
 * 尝试以更优格式提交歌词候选
 * 仅当候选格式优于当前展示格式（或当前无歌词）时写入，避免低优先级结果覆盖优质歌词；
 * 若写入后有效行为空但此前已有歌词，则自动恢复此前歌词
 * @param token - 竞态 token
 * @param source - 候选歌词源
 * @param input - 候选歌词内容
 * @returns 是否成功提交且有效展示
 */
const commitIfBetter = (
  token: number,
  source: NonNullable<LyricData>,
  input: LyricInput,
): boolean => {
  if (token !== currentToken) return false;
  const media = useMediaStore();
  const currentFormat = media.activeLyric?.format ?? null;
  if (currentFormat && !isBetterFormat(source.format, currentFormat)) {
    return false;
  }

  const prevSource = media.activeLyric;
  const prevInput = media.lyricContent;
  const prevParsed = media.parsedLyric;

  commit(token, source, input);

  if (media.parsedLyric.length > 0) {
    return true;
  }

  // 失败回滚
  if (prevSource && prevParsed.length > 0) {
    media.setLyric(prevSource, prevInput);
  }
  return false;
};

/** 当前 token 是否已触发过 TTML 拉取 */
let ttmlTriggeredToken = -1;

/**
 * 异步静默触发 TTML 覆盖并尝试升级
 * 非阻塞执行，不阻塞基础歌词展示与其它来源抢占
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param online - 在线歌词基础结果
 */
const tryApplyTTMLOverlay = (token: number, track: Track, online: OnlineResult): void => {
  if (token !== currentToken || ttmlTriggeredToken === token) return;
  ttmlTriggeredToken = token;
  resolveTTMLOverlay(track, online, true)
    .then((ttml) => {
      if (token !== currentToken || !ttml) return;
      if (!useMediaStore().rememberTTML(ttml)) return;
      if (useLyricPreferenceStore().getPreference(track) === "auto") {
        commitIfBetter(token, ttml.source, ttml.input);
      }
    })
    .catch((err) => {
      console.warn("[lyricLoader] tryApplyTTMLOverlay failed:", err);
    });
};

/**
 * 提交在线歌词
 * 若成功则在后台异步触发 TTML 升级，解析后为空时优先回退本地
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param online - 在线歌词结果
 * @param fallbackLocal - 本地回退歌词
 */
const applyOnline = (
  token: number,
  track: Track,
  online: OnlineResult,
  fallbackLocal: LocalLyric | null,
): void => {
  const media = useMediaStore();
  const current = media.activeLyric;
  const alreadyCommitted =
    current?.source === "online" &&
    current.platform === online.source.platform &&
    current.format === online.source.format;
  // 已经提交过在线歌词，检查是否需要回退本地或触发 TTML 覆盖
  if (alreadyCommitted) {
    if (media.parsedLyric.length === 0 && fallbackLocal) {
      commitLocal(token, fallbackLocal);
      return;
    }
    tryApplyTTMLOverlay(token, track, online);
    return;
  }
  // 尝试提交在线歌词
  const preference = useLyricPreferenceStore().getPreference(track);
  // 仅自动模式是智能选择，其余（含跟随自身）均为用户显式指令，来源权威高于格式优劣
  const isExplicit = preference !== "auto";
  // 自动模式下，若当前已展示更优歌词（如候选抢占或插件优选），不降级覆盖
  if (!isExplicit && current && !isBetterFormat(online.source.format, current.format)) {
    return;
  }
  // 尝试提交在线歌词，若失败则回退本地
  if (!commitAndHasParsed(token, online.source, online.input)) {
    if (fallbackLocal && media.parsedLyric.length === 0) {
      commitLocal(token, fallbackLocal);
    }
    return;
  }
  // 尝试触发 TTML 覆盖
  tryApplyTTMLOverlay(token, track, online);
};

/**
 * 本地 TTML 歌词库匹配：命中即以最高优先级提交，调用方据此跳过在线请求
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @returns 是否命中
 */
const tryLocalRepo = async (token: number, track: Track): Promise<boolean> => {
  if (useLyricPreferenceStore().getPreference(track) !== "auto") return false;
  const resolved = await resolveLocalRepoLyric(track);
  if (token !== currentToken) return false;
  return resolved ? commitResolvedAndHasParsed(token, resolved) : false;
};

/**
 * 插件兜底匹配歌词：内置平台都没歌词时，向声明 musicLyric 的插件源逐个兜底
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @returns 是否已提交有效歌词
 */
const tryPluginFallback = async (token: number, track: Track): Promise<boolean> => {
  if (isPluginLyricPreferred()) return false;
  const resolved = await resolvePluginLyric(track);
  if (token !== currentToken) return false;
  return resolved ? commitResolvedAndHasParsed(token, resolved) : false;
};

/**
 * 插件优先加载
 * 插件请求与正常流程并发发出，任意一方就绪且更优时立即抢占展示
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param run - 正常加载流程
 */
const withPluginPrefer = async (
  token: number,
  track: Track,
  run: () => Promise<void>,
): Promise<void> => {
  if (!isPluginLyricPreferred()) {
    await run();
    return;
  }
  const pluginTask = resolvePluginLyric(track).then((plugin) => {
    if (plugin && token === currentToken) {
      commitIfBetter(token, plugin.source, plugin.input);
    }
  });
  await run();
  await pluginTask;
};

/**
 * 流媒体歌词加载：按来源偏好解析，失败后使用插件和内嵌歌词兜底
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param detail - 歌曲详细信息
 */
const loadStreamingLyric = (
  token: number,
  track: Track,
  detail: TrackDetail | null,
): Promise<void> =>
  withPluginPrefer(token, track, async () => {
    const resolved = await resolveStreamingByPreference(track, () => token === currentToken);
    if (token !== currentToken) return;
    const embeddedFallback = embeddedLyricFromDetail(detail);
    if (resolved && commitIfBetter(token, resolved.source, resolved.input)) {
      if (resolved.source.source === "online") {
        tryApplyTTMLOverlay(token, track, {
          source: resolved.source as OnlineResult["source"],
          input: resolved.input,
        });
      }
      return;
    }
    if (token !== currentToken) return;
    if (await tryPluginFallback(token, track)) return;
    if (embeddedFallback) {
      commitIfBetter(token, embeddedFallback.source, { content: embeddedFallback.content });
    } else if (useMediaStore().parsedLyric.length === 0) {
      commit(token, null, null);
    }
  });

/**
 * 在线平台歌曲歌词加载
 * @param token - 竞态 token
 * @param track - 歌曲信息
 */
const loadPlatformLyric = (token: number, track: Track): Promise<void> =>
  withPluginPrefer(token, track, async () => {
    const online = await resolveOnlineByPreference(track, {
      hasLocal: false,
      localFormat: null,
      onCandidate: (result) => {
        if (commitIfBetter(token, result.source, result.input)) {
          tryApplyTTMLOverlay(token, track, result);
        }
      },
      shouldContinue: () => token === currentToken,
    });
    if (token !== currentToken) return;
    if (online) applyOnline(token, track, online, null);
    else if (useMediaStore().parsedLyric.length === 0 && !(await tryPluginFallback(token, track))) {
      commit(token, null, null);
    }
  });

/** 开启新一轮加载周期 */
export const beginLoad = (): number => {
  currentToken++;
  useMediaStore().resetLyricState();
  return currentToken;
};

/**
 * 查找当前歌曲的 TTML 候选，不改变正在展示的歌词
 * @param detail - 当前歌曲详情，加载期间可传 null 排除上一首的详情
 * @returns 可用的 TTML 歌词，未命中或已切歌时为 null
 */
export const discoverCurrentTTML = async (
  detail: TrackDetail | null = useMediaStore().lyricLoading ? null : useMediaStore().detail,
): Promise<ResolvedLyric | null> => {
  const media = useMediaStore();
  const track = media.track;
  if (!track) return null;
  if (clearingTrackKey === lyricPreferenceKey(track)) return null;
  if (media.ttmlCandidate) return media.ttmlCandidate;
  const token = currentToken;
  let resolved: ResolvedLyric | null = null;
  const external =
    track.source === "local"
      ? detail?.externalLyrics.find((lyric) => lyric.format === "ttml")
      : undefined;
  if (external) {
    const result = await window.api.player.readLyricFile(external.path);
    if (result.success && result.data) {
      resolved = {
        source: { source: "external", format: "ttml" },
        input: { content: result.data },
      };
    }
  }
  const embedded = track.source === "local" ? embeddedLyricFromDetail(detail) : null;
  if (!resolved && embedded?.source.format === "ttml") {
    resolved = { source: embedded.source, input: { content: embedded.content } };
  }
  resolved ??= await resolveLocalRepoLyric(track);
  if (token !== currentToken) return null;
  resolved ??= await resolveTTMLOverlay(
    track,
    { source: { source: "online", format: "lrc", platform: "netease" }, input: { content: "" } },
    true,
  );
  if (token !== currentToken) return null;
  return resolved && media.rememberTTML(resolved) ? resolved : null;
};

/**
 * 应用歌曲级来源，避免预载、插件或 TTML 覆盖固定选择
 * @param token - 当前加载周期
 * @param track - 歌曲信息
 * @param detail - 歌曲详情
 * @returns 是否已处理歌曲级选择
 */
const applySongPreference = async (
  token: number,
  track: Track,
  detail: TrackDetail | null,
): Promise<boolean> => {
  const preferences = useLyricPreferenceStore();
  const preference = preferences.getPreference(track);
  if (preference !== "ttml" && preferences.getPinned(track) === null) return false;
  if (preference === "auto") return false;
  let resolved: ResolvedLyric | null = null;
  if (preference === "ttml") {
    resolved = await discoverCurrentTTML(detail);
  } else if (isPlatform(preference)) {
    resolved = await resolvePlatformLyric(preference, track);
  } else if (isPlatform(track.source)) {
    resolved = await resolvePlatformLyric(track.source, track);
  } else if (track.source === "streaming") {
    resolved = await resolveStreamingLyric(track);
  } else if (track.source === "plugin") {
    resolved = await resolvePluginLyric(track);
  } else {
    const local = detail ? await readLocal(detail) : null;
    if (local) resolved = { source: local.source, input: { content: local.content } };
  }
  if (token !== currentToken) return true;
  commit(token, resolved?.source ?? null, resolved?.input ?? null);
  return true;
};

/**
 * 为当前 track 加载歌词
 * 歌曲级选择先于预载和全局偏好生效
 * @param detail - 歌曲详细信息
 */
export const loadForTrack = async (detail: TrackDetail | null): Promise<void> => {
  const token = beginLoad();
  try {
    const media = useMediaStore();
    const track = media.track;
    // 无 track
    if (!track) {
      commit(token, null, null);
      return;
    }
    if (clearingTrackKey === lyricPreferenceKey(track)) return;
    if (await applySongPreference(token, track, detail)) return;
    if (token !== currentToken) return;
    const preloaded =
      useLyricPreferenceStore().getPinned(track) === null
        ? await consumePreloadedLyric(track)
        : { hit: false as const };
    if (token !== currentToken) return;
    if (preloaded.hit) {
      if (commitIfBetter(token, preloaded.lyric.source, preloaded.lyric.input)) {
        if (preloaded.lyric.source.source === "online") {
          tryApplyTTMLOverlay(token, track, {
            source: preloaded.lyric.source as OnlineResult["source"],
            input: preloaded.lyric.input,
          });
        }
      }
    }
    // 本地 TTML 歌词库最高优先
    if (await tryLocalRepo(token, track)) return;
    if (token !== currentToken) return;
    if (track.source === "plugin") {
      const plugin = await resolvePluginLyric(track);
      if (token !== currentToken) return;
      if (plugin) commitIfBetter(token, plugin.source, plugin.input);
      else if (media.parsedLyric.length === 0) commit(token, null, null);
      return;
    }
    // 在线歌曲（任一在线平台）
    if (isPlatform(track.source)) {
      await loadPlatformLyric(token, track);
      return;
    }
    // 流媒体服务器
    if (track.source === "streaming") {
      await loadStreamingLyric(token, track, detail);
      return;
    }
    // 本地文件
    const local = detail ? await readLocal(detail) : null;
    if (token !== currentToken) return;
    // 本地立即显示
    if (local) commitLocal(token, local);
    // 本地文件存在但解析后空
    const hasUsableLocal = !!local && media.parsedLyric.length > 0;
    const localFormat = local?.source.format ?? null;

    await withPluginPrefer(token, track, async () => {
      // 按偏好获取歌词
      const online = await resolveOnlineByPreference(track, {
        hasLocal: hasUsableLocal,
        localFormat,
        onCandidate: (result) => {
          if (commitIfBetter(token, result.source, result.input)) {
            tryApplyTTMLOverlay(token, track, result);
          }
        },
        shouldContinue: () => token === currentToken,
      });
      if (token !== currentToken) return;
      // id 回查本地 TTML 库
      if (online && (await tryLocalRepo(token, track))) return;
      if (online) {
        applyOnline(token, track, online, local);
      } else if (
        !hasUsableLocal &&
        useMediaStore().parsedLyric.length === 0 &&
        !(await tryPluginFallback(token, track))
      ) {
        commit(token, null, null);
      }
    });
  } catch (err) {
    console.error("[lyricLoader] loadForTrack failed:", err);
    commit(token, null, null);
  }
};

/** 偏好变化时的刷新 */
const refreshPreference = async (): Promise<void> => {
  currentToken++;
  const token = currentToken;
  const media = useMediaStore();
  const track = media.track;
  if (!track) return;
  if (clearingTrackKey === lyricPreferenceKey(track)) return;
  if (await applySongPreference(token, track, media.detail)) return;
  if (token !== currentToken) return;
  // 本地 TTML 歌词库最高优先
  if (await tryLocalRepo(token, track)) return;
  if (token !== currentToken) return;
  if (track.source === "plugin") {
    const plugin = await resolvePluginLyric(track);
    if (token !== currentToken) return;
    if (plugin) commitIfBetter(token, plugin.source, plugin.input);
    else commit(token, null, null);
    return;
  }
  if (track.source === "streaming") {
    await loadStreamingLyric(token, track, media.detail);
    return;
  }
  // 在线歌曲（任一在线平台）
  if (isPlatform(track.source)) {
    await loadPlatformLyric(token, track);
    return;
  }
  // 本地歌曲
  const detail = media.detail;
  const local = detail ? await readLocal(detail) : null;
  if (token !== currentToken) return;
  const localFormat = local?.source.format ?? null;
  const showingOnline = media.activeLyric?.source === "online";

  await withPluginPrefer(token, track, async () => {
    /** 按偏好获取歌词 */
    const online = await resolveOnlineByPreference(track, {
      hasLocal: !!local,
      localFormat,
      onCandidate: (result) => {
        if (commitIfBetter(token, result.source, result.input)) {
          tryApplyTTMLOverlay(token, track, result);
        }
      },
      shouldContinue: () => token === currentToken,
    });
    if (token !== currentToken) return;
    if (online) {
      applyOnline(token, track, online, local);
      return;
    }
    // 目标是本地
    if (!showingOnline) return;
    if (local) commitLocal(token, local);
    else commit(token, null, null);
  });
};

/** 监听歌词偏好变化 */
export const watchLyricPreference = (): void => {
  const settings = useSettingsStore();
  const preferences = useLyricPreferenceStore();
  watch(
    () => [
      settings.lyric.lyricSourcePreference,
      settings.lyric.smartPreferOnline,
      settings.lyric.preferPluginLyric,
      settings.lyric.detectBackgroundLyrics,
      settings.system.lyric.enableOnlineTTMLLyric,
      settings.system.localLyric.enableLocalTTMLOverride,
      settings.system.localLyric.repoDir,
      preferences.revision,
      JSON.stringify(settings.system.lyric.amllDbServer),
    ],
    (values, previous) => {
      const media = useMediaStore();
      const track = media.track;
      if (values.at(-1) !== previous.at(-1)) {
        media.ttmlCandidate = null;
        void loadForTrack(media.detail);
        return;
      }
      if (
        track &&
        preferences.getPinned(track) !== null &&
        values.slice(1).every((value, index) => value === previous[index + 1])
      )
        return;
      refreshPreference().catch((error) => console.error("[lyricLoader] refresh failed:", error));
    },
  );
};
