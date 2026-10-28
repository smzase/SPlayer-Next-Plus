import type { Track } from "@shared/types/player";
import type { LyricSourcePreference } from "@/types/settings";
import { useSettingsStore } from "@/stores/settings";

export type SongLyricPreference = LyricSourcePreference | "ttml";

/**
 * 生成歌词固定设置的歌曲身份，隔离平台、插件及服务器版本
 * @param track - 歌曲信息
 * @returns 持久化键
 */
export const lyricPreferenceKey = (track: Track): string =>
  `lyric-pin:${JSON.stringify([
    track.source,
    track.serverId ?? "",
    track.serverRevision ?? "",
    track.originalId ?? track.id,
    track.source === "local" ? track.path : "",
    track.plugin?.pluginId ?? "",
    track.plugin?.source ?? "",
  ])}`;

export const useLyricPreferenceStore = defineStore("lyricPreference", () => {
  const revision = ref(0);
  // 只保留当前歌曲的临时选择，固定记录按歌曲从磁盘读取
  const temporaryTTMLKey = ref<string | null>(null);

  /**
   * 读取歌曲固定来源
   * @param track - 歌曲信息
   * @returns 固定来源，未固定时为 null
   */
  const getPinned = (track: Track): SongLyricPreference | null => {
    void revision.value;
    const value = localStorage.getItem(lyricPreferenceKey(track));
    return value === "auto" ||
      value === "self" ||
      value === "netease" ||
      value === "qqmusic" ||
      value === "kugou" ||
      value === "ttml"
      ? value
      : null;
  };

  /**
   * 获取歌曲实际使用的来源偏好
   * @param track - 歌曲信息
   * @returns 歌曲固定值、临时 TTML 选择或全局偏好
   */
  const getPreference = (track: Track): SongLyricPreference =>
    getPinned(track) ??
    (temporaryTTMLKey.value === lyricPreferenceKey(track)
      ? "ttml"
      : useSettingsStore().lyric.lyricSourcePreference);

  /**
   * 保存或取消歌曲的固定来源
   * @param track - 歌曲信息
   * @param preference - 固定来源，null 表示恢复全局偏好
   */
  const setPinned = (track: Track, preference: SongLyricPreference | null): void => {
    const key = lyricPreferenceKey(track);
    if (preference === null) localStorage.removeItem(key);
    else localStorage.setItem(key, preference);
    temporaryTTMLKey.value = null;
    revision.value++;
  };

  /**
   * 切换来源，已固定歌曲只更新自身的记录
   * @param track - 歌曲信息
   * @param preference - 选中的来源
   */
  const select = (track: Track, preference: SongLyricPreference): void => {
    if (getPinned(track) !== null) {
      setPinned(track, preference);
      return;
    }
    temporaryTTMLKey.value = preference === "ttml" ? lyricPreferenceKey(track) : null;
    if (preference !== "ttml") useSettingsStore().lyric.lyricSourcePreference = preference;
    revision.value++;
  };

  /** 清除上一首歌的临时 TTML 选择 */
  const clearTemporary = (): void => {
    temporaryTTMLKey.value = null;
  };

  return { revision, getPinned, getPreference, setPinned, select, clearTemporary };
});
