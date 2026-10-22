import type { Track } from "@shared/types/player";
import type { NeteaseSong } from "@shared/types/platform/netease";
import { netease as neteaseApi } from "@/apis/netease";
import { songsByIds } from "@/apis/song/netease";
import { songToTrack } from "@/utils/format/netease";

interface AudioMatchItem {
  song?: NeteaseSong;
  startTime?: number;
}

interface AudioMatchBody {
  code?: number;
  data?: {
    result?: AudioMatchItem[];
  };
  result?: AudioMatchItem[];
}

/** 听歌识曲候选及其在歌曲中的匹配位置 */
export interface AudioRecognitionMatch {
  track: Track;
  /** 录音片段起点在候选歌曲中的位置（毫秒） */
  startTime: number | null;
}

/**
 * 向网易云 PC 识曲接口提交一个音频指纹
 * @param audioFP - Base64 音频指纹
 * @param duration - 指纹时长（秒）
 * @param times - 当前识别序号
 * @param sessionId - 同一轮识别会话 ID
 * @returns 去重并补全详情后的歌曲
 */
export const matchAudioFingerprint = async (
  audioFP: string,
  duration: number,
  times: number,
  sessionId: string,
): Promise<AudioRecognitionMatch[]> => {
  const body: AudioMatchBody = await neteaseApi.audio_match({
    audioFP,
    duration,
    times,
    sessionId,
  });
  const matches: AudioMatchItem[] = body.data?.result ?? body.result ?? [];
  const matchById = new Map<string, AudioMatchItem>();
  for (const match of matches) {
    if (!match.song) continue;
    const id = String(match.song.id);
    if (!matchById.has(id)) matchById.set(id, match);
  }
  const ids = [...matchById.keys()];
  if (ids.length === 0) return [];

  let details: Track[] = [];
  try {
    details = await songsByIds(ids);
  } catch {
    // 识曲响应已包含基础歌曲信息，详情补全失败不阻塞结果展示
  }
  const detailById = new Map<string, Track>();
  details.forEach((track) => detailById.set(track.id, track));
  return ids.map((id) => {
    const match = matchById.get(id)!;
    const startTime = match.startTime;
    return {
      track: detailById.get(id) ?? songToTrack(match.song!),
      startTime:
        typeof startTime === "number" && Number.isFinite(startTime) ? Math.max(0, startTime) : null,
    };
  });
};
