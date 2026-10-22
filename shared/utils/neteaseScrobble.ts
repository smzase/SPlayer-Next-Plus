import type { PlaybackContext, Track, TrackFee } from "../types/player";
import type { NeteaseScrobbleMode } from "../types/settings";

type NeteaseScrobbleSourceType = "song" | "list" | "album" | "artist" | "radio";

export interface NeteaseScrobbleTrack {
  id: string;
  sourceId: string;
  sourceType: NeteaseScrobbleSourceType;
  resourceType: "song" | "dj";
  categoryId?: number;
  title: string;
  durationSec: number;
  ncbl?: {
    sourceid: string;
    sourceType: NeteaseScrobbleSourceType;
    artist: string;
    bitrate: number;
    level: string;
    fee: TrackFee;
  };
}

/**
 * 提取播放来源，两个协议共用资源归类，NCBL 额外保留音质信息
 * @param track - 当前播放曲目
 * @param context - 播放来源上下文
 * @param durationMs - 引擎确认后的时长
 * @param mode - 上报协议，默认为原版桌面日志
 * @returns 平台资源的轻量日志信息，其余来源返回 null
 */
export const toNeteaseScrobbleTrack = (
  track: Track | null,
  context: PlaybackContext | undefined,
  durationMs: number,
  mode: NeteaseScrobbleMode = "legacy",
): NeteaseScrobbleTrack | null => {
  if (!track || track.source !== "netease" || !/^[1-9]\d*$/.test(track.id)) return null;
  const voiceId = track.extId && /^[1-9]\d*$/.test(track.extId) ? track.extId : undefined;
  const neteaseContext =
    context?.provider === "netease" && context.originType !== "page" ? context : undefined;
  const contextId = neteaseContext?.originId ?? track.playbackSource?.id;
  const sourceId = contextId && /^[1-9]\d*$/.test(contextId) ? contextId : undefined;
  const radioId = track.album?.id;
  let sourceType: NeteaseScrobbleSourceType = "song";
  if (voiceId) sourceType = "radio";
  else if (sourceId) {
    const origin = neteaseContext?.originType;
    if (origin === "playlist") sourceType = "list";
    else if (origin === "album" || origin === "artist" || origin === "radio") sourceType = origin;
    else if (!neteaseContext) sourceType = track.playbackSource?.type ?? "song";
  }
  const meta: NeteaseScrobbleTrack = {
    id: voiceId ?? track.id,
    sourceId:
      (voiceId ? (radioId && /^[1-9]\d*$/.test(radioId) ? radioId : sourceId) : sourceId) ??
      voiceId ??
      track.id,
    sourceType,
    resourceType: voiceId ? "dj" : "song",
    ...(voiceId && track.playbackSource?.categoryId !== undefined
      ? { categoryId: track.playbackSource.categoryId }
      : {}),
    title: track.title,
    durationSec: Math.round(durationMs / 1000),
  };
  if (mode !== "ncbl") return meta;

  const bitrate = track.quality?.bitRate ?? 320;
  return {
    ...meta,
    ncbl: {
      sourceid: meta.sourceId,
      sourceType,
      artist: track.artists.map((artist) => artist.name).join(" / "),
      bitrate: bitrate > 10000 ? Math.round(bitrate / 1000) : Math.round(bitrate),
      level:
        track.quality?.codec?.toLowerCase() === "flac"
          ? "lossless"
          : bitrate >= 320000
            ? "exhigh"
            : "higher",
      fee: track.fee ?? 0,
    },
  };
};
