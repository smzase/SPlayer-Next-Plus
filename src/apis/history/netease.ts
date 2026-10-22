import type { Album, Playlist, Track } from "@shared/types/player";
import type { NeteaseDjProgram, NeteaseDjRadio, NeteaseSong } from "@shared/types/platform/netease";
import type { Podcast } from "@/types/podcast";
import { netease as neteaseApi } from "@/apis/netease";
import { ensureOk, songToTrack, toAlbum, toPlaylist } from "@/utils/format/netease";
import { podcastProgramToTrack, toPodcast } from "@/utils/format/podcast";

export type NeteaseRecentKind = "song" | "voice" | "playlist" | "album" | "podcast";

export interface NeteaseRecentEntry<T> {
  resourceId: string;
  item: T;
  playedAt: number;
  device?: string;
}

interface RawRecentEntry {
  data?: any;
  playTime?: number;
  playtime?: number;
  resourceId?: number | string;
  multiTerminalInfo?: {
    os?: string;
  };
}

interface RawRecentResponse {
  code?: number;
  data?: {
    list?: RawRecentEntry[];
  };
  list?: RawRecentEntry[];
}

const readList = (body: RawRecentResponse): RawRecentEntry[] => {
  ensureOk(body);
  return body.data?.list ?? body.list ?? [];
};

const toEntry = <T>(
  raw: RawRecentEntry,
  resourceId: number | string | undefined,
  item: T,
): NeteaseRecentEntry<T> | null => {
  if (resourceId === undefined || resourceId === null || resourceId === "") return null;
  return {
    resourceId: String(resourceId),
    item,
    playedAt: Number(raw.playTime ?? raw.playtime ?? 0),
    device: raw.multiTerminalInfo?.os,
  };
};

const compact = <T>(items: Array<T | null>): T[] =>
  items.filter((item): item is T => item !== null);

/** 获取多端最近播放的单曲 */
export const fetchRecentSongs = async (): Promise<NeteaseRecentEntry<Track>[]> => {
  const body = await neteaseApi.recent_play<RawRecentResponse>({ kind: "song", limit: 300 });
  return compact(
    readList(body).map((raw) => {
      const value = raw.data?.song ?? raw.data?.songInfo ?? raw.data;
      if (!value?.id) return null;
      const song = value as NeteaseSong;
      return toEntry(raw, raw.resourceId ?? song.id, songToTrack(song));
    }),
  );
};

/** 获取多端最近播放的声音 */
export const fetchRecentVoices = async (): Promise<NeteaseRecentEntry<Track>[]> => {
  const body = await neteaseApi.recent_play<RawRecentResponse>({ kind: "voice", limit: 100 });
  return compact(
    readList(body).map((raw) => {
      const value =
        raw.data?.pubDJProgramData ??
        raw.data?.program ??
        raw.data?.voice ??
        raw.data?.voiceInfo ??
        raw.data;
      if (!value?.id && !value?.voiceId && !value?.mainTrackId) return null;
      const program = value as NeteaseDjProgram;
      const resourceId = raw.resourceId ?? program.id ?? program.voiceId ?? program.mainTrackId;
      const item = podcastProgramToTrack(program);
      const radioId = program.radio?.id;
      return toEntry(
        raw,
        resourceId,
        radioId === undefined
          ? item
          : {
              ...item,
              playbackSource: {
                ...item.playbackSource,
                id: String(radioId),
                type: "radio",
              },
            },
      );
    }),
  );
};

/** 获取多端最近播放的歌单 */
export const fetchRecentPlaylists = async (): Promise<NeteaseRecentEntry<Playlist>[]> => {
  const body = await neteaseApi.recent_play<RawRecentResponse>({ kind: "playlist", limit: 100 });
  return compact(
    readList(body).map((raw) => {
      const value = raw.data?.playlist ?? raw.data;
      if (!value?.id) return null;
      return toEntry(raw, raw.resourceId ?? value.id, toPlaylist(value));
    }),
  );
};

/** 获取多端最近播放的专辑 */
export const fetchRecentAlbums = async (): Promise<NeteaseRecentEntry<Album>[]> => {
  const body = await neteaseApi.recent_play<RawRecentResponse>({ kind: "album", limit: 100 });
  return compact(
    readList(body).map((raw) => {
      const value = raw.data?.album ?? raw.data;
      if (!value?.id) return null;
      return toEntry(raw, raw.resourceId ?? value.id, toAlbum(value));
    }),
  );
};

/** 获取多端最近播放的播客 */
export const fetchRecentPodcasts = async (): Promise<NeteaseRecentEntry<Podcast>[]> => {
  const body = await neteaseApi.recent_play<RawRecentResponse>({ kind: "podcast", limit: 100 });
  return compact(
    readList(body).map((raw) => {
      const value =
        raw.data?.radio ?? raw.data?.djRadio ?? raw.data?.voiceBook ?? raw.data?.audio ?? raw.data;
      if (!value?.id) return null;
      const podcast = toPodcast(value as NeteaseDjRadio);
      return toEntry(raw, raw.resourceId ?? podcast.id, podcast);
    }),
  );
};

const removeType: Record<NeteaseRecentKind, string> = {
  song: "SONG",
  voice: "VOICE",
  playlist: "PLAYLIST",
  album: "ALBUM",
  podcast: "VOICE_BOOK",
};

/**
 * 从多端最近播放中移除资源
 * @param kind - 最近播放资源类型
 * @param resourceIds - 要移除的资源 ID
 * @param currentEntries - 删除前的当前列表，用于携带服务端游标
 */
export const removeRecentEntries = async (
  kind: NeteaseRecentKind,
  resourceIds: string[],
  currentEntries: NeteaseRecentEntry<unknown>[],
): Promise<void> => {
  if (resourceIds.length === 0) return;
  const last = currentEntries.at(-1);
  ensureOk(
    await neteaseApi.recent_play_remove({
      resourceIds: JSON.stringify(resourceIds),
      type: removeType[kind],
      lastPlayTime: last?.playedAt,
      lastResourceId: last?.resourceId,
      timestamp: Date.now(),
    }),
  );
};
