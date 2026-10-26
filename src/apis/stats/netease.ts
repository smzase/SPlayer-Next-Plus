import type { Track } from "@shared/types/player";
import type { NeteaseSong } from "@shared/types/platform/netease";
import type {
  CloudDailyListening,
  CloudListeningCharts,
  CloudReportPeriod,
  CloudStatsPeriod,
  CloudTimeBand,
  TopAlbum,
  TopArtist,
  TopTrack,
} from "@shared/types/stats";
import { netease } from "@/apis/netease";
import { fetchUserListeningRank } from "@/apis/user-profile/netease";
import { ensureOk, songToTrack, withPicSize } from "@/utils/format/netease";

interface ReportData {
  startTime?: number;
  endTime?: number;
  listenTimeDistributionBlock?: {
    durationDetails?: { period: string; duration: number; reachLimit: boolean }[];
  } | null;
  listenTimeBlock?: {
    circleTimePeriodDurations?: { period: CloudTimeBand; duration: number }[];
  } | null;
  topStyleBlock?: {
    sections?: { genreName: string; percent: string }[];
  } | null;
}

interface ReportResponse {
  code: number;
  data: ReportData;
}

interface MonthRankResponse {
  code: number;
  data: {
    startTime?: number;
    endTime?: number;
    songItems?: {
      songId: number;
      songName: string;
      picUrl: string;
      artists: { artistId: number; artistName: string }[];
      playCount: number;
    }[];
  };
}

export interface NeteaseStatsRank {
  songs: TopTrack[];
  albums: TopAlbum[];
  artists: TopArtist[];
  period?: CloudReportPeriod;
}

/**
 * 按返回的歌曲汇总专辑与歌手，范围仅限歌曲榜
 * @param songs - 云端歌曲排行
 * @returns 歌曲、专辑与歌手排行
 */
const aggregateRanks = (songs: TopTrack[]): NeteaseStatsRank => {
  const albums = new Map<string, TopAlbum>();
  const artists = new Map<string, TopArtist>();
  for (const item of songs) {
    const album = item.track.album;
    if (album?.id) {
      const current = albums.get(album.id);
      if (current) current.playCount += item.playCount;
      else albums.set(album.id, { track: item.track, playCount: item.playCount });
    }
    for (const artist of item.track.artists) {
      const key = artist.id ?? artist.name;
      const current = artists.get(key);
      if (current) current.playCount += item.playCount;
      else artists.set(key, { artist, track: item.track, playCount: item.playCount });
    }
  }
  return {
    songs,
    albums: [...albums.values()].sort((a, b) => b.playCount - a.playCount),
    artists: [...artists.values()].sort((a, b) => b.playCount - a.playCount),
  };
};

/**
 * 获取指定周期的歌曲榜，补齐月榜缺失的专辑与播放元数据
 * @param uid - 当前登录用户 ID
 * @param period - 排行周期
 * @returns 云端排行及实际报告周期
 */
export const fetchNeteaseStatsRank = async (
  uid: number,
  period: CloudStatsPeriod,
): Promise<NeteaseStatsRank> => {
  if (period !== "month") {
    const tracks = await fetchUserListeningRank(uid, period);
    return aggregateRanks(tracks.map(({ playCount, ...track }) => ({ track, playCount })));
  }
  const body = ensureOk(
    await netease.listen_data_song_play_rank<MonthRankResponse>({ type: "month" }),
  );
  const items = body.data.songItems ?? [];
  const tracks = new Map<string, Track>();
  if (items.length) {
    const detail = ensureOk(
      await netease.song_detail<{ code: number; songs: NeteaseSong[] }>({
        ids: items.map((item) => item.songId).join(","),
      }),
    );
    for (const song of detail.songs) tracks.set(String(song.id), songToTrack(song));
  }
  const songs = items.map((item): TopTrack => ({
    playCount: item.playCount,
    // 已下架歌曲可能没有详情，保留月榜中的真实名称与播放次数
    track: tracks.get(String(item.songId)) ?? {
      id: String(item.songId),
      source: "netease",
      title: item.songName,
      artists: item.artists.map((artist) => ({
        id: String(artist.artistId),
        name: artist.artistName,
      })),
      duration: 0,
      cover: withPicSize(item.picUrl),
    },
  }));
  return {
    ...aggregateRanks(songs),
    period:
      body.data.startTime && body.data.endTime
        ? { startTime: body.data.startTime, endTime: body.data.endTime }
        : undefined,
  };
};

/**
 * 获取近 90 天足迹及最近已发布月报的时段和曲风
 * @param now - 查询时点，按网易云使用的北京时间确定月份
 * @returns 时长图表、报告周期与各部分请求状态
 */
export const fetchNeteaseListeningCharts = async (
  now = new Date(),
): Promise<CloudListeningCharts> => {
  const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const firstDay = new Date(chinaNow);
  firstDay.setUTCDate(firstDay.getUTCDate() - 89);
  const firstKey = firstDay.toISOString().slice(0, 10);
  const lastKey = chinaNow.toISOString().slice(0, 10);
  const historyEnds = [2, 3]
    .map(
      (offset) =>
        Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth() - offset + 1, 0) -
        8 * 60 * 60 * 1000,
    )
    .filter(
      (endTime) => new Date(endTime + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) >= firstKey,
    );
  const [realtime, monthly, ...history] = await Promise.allSettled([
    netease.listen_data_realtime_report<ReportResponse>({ type: "month" }).then(ensureOk),
    netease.listen_data_report<ReportResponse>({ type: "month" }).then(ensureOk),
    ...historyEnds.map((endTime) =>
      netease.listen_data_report<ReportResponse>({ type: "month", endTime }).then(ensureOk),
    ),
  ]);
  const daily = new Map<string, CloudDailyListening>();
  for (const result of [...history, monthly, realtime]) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value.data.listenTimeDistributionBlock?.durationDetails ?? []) {
      if (item.period < firstKey || item.period > lastKey) continue;
      daily.set(item.period, {
        day: item.period,
        durationMs: item.duration * 60_000,
        reachLimit: item.reachLimit,
      });
    }
  }
  const report = monthly.status === "fulfilled" ? monthly.value.data : undefined;
  const reportPeriod =
    report?.startTime && report.endTime
      ? { startTime: report.startTime, endTime: report.endTime }
      : undefined;
  const bands: CloudTimeBand[] = [
    "early_morning",
    "morning",
    "noon",
    "afternoon",
    "night",
    "deep_night",
  ];
  return {
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    timeBands: bands.flatMap((period) => {
      const item = report?.listenTimeBlock?.circleTimePeriodDurations?.find(
        (entry) => entry.period === period,
      );
      return item ? [{ period, durationMs: item.duration * 60_000 }] : [];
    }),
    genres: (report?.topStyleBlock?.sections ?? []).slice(0, 3).map((item) => ({
      name: item.genreName,
      percent: Number(item.percent),
    })),
    timePeriod: report?.listenTimeBlock ? reportPeriod : undefined,
    genrePeriod: report?.topStyleBlock ? reportPeriod : undefined,
    errors: {
      daily: [realtime, monthly, ...history].some((result) => result.status === "rejected"),
      timeBands: monthly.status === "rejected",
      genres: monthly.status === "rejected",
    },
  };
};
