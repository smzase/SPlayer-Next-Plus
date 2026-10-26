import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const api = vi.hoisted(() => ({
  report: vi.fn(),
  realtime: vi.fn(),
  monthly: vi.fn(),
  details: vi.fn(),
  userRank: vi.fn(),
}));
vi.mock("@/apis/netease", () => ({
  netease: {
    listen_data_report: api.report,
    listen_data_realtime_report: api.realtime,
    listen_data_song_play_rank: api.monthly,
    song_detail: api.details,
  },
}));
vi.mock("@/apis/user-profile/netease", () => ({ fetchUserListeningRank: api.userRank }));
import { fetchNeteaseListeningCharts, fetchNeteaseStatsRank } from "./netease";

const now = new Date("2026-10-26T08:00:00Z");
const startTime = Date.parse("2026-09-01T00:00:00+08:00");
const endTime = Date.parse("2026-09-30T00:00:00+08:00");

beforeEach(() => {
  vi.resetAllMocks();
  api.report.mockResolvedValue({ code: 200, data: {} });
  api.realtime.mockResolvedValue({ code: 200, data: {} });
});

describe("网易云统计真实报告结构", () => {
  it("读取 songItems 并补齐专辑，保留月榜播放次数与实际月份", async () => {
    api.monthly.mockResolvedValue({
      code: 200,
      data: {
        startTime,
        endTime,
        songItems: [
          {
            songId: 1,
            songName: "月榜歌曲",
            picUrl: "https://example.com/cover",
            artists: [{ artistId: 2, artistName: "歌手" }],
            playCount: 98,
          },
          { songId: 3, songName: "已下架歌曲", artists: [], playCount: 72 },
        ],
      },
    });
    api.details.mockResolvedValue({
      code: 200,
      songs: [
        {
          id: 1,
          name: "月榜歌曲",
          ar: [{ id: 2, name: "歌手" }],
          al: { id: 4, name: "专辑", picUrl: "https://example.com/cover" },
          dt: 180000,
        },
      ],
    });
    const rank = await fetchNeteaseStatsRank(42, "month");
    expect(api.monthly).toHaveBeenCalledWith({ type: "month" });
    expect(api.details).toHaveBeenCalledWith({ ids: "1,3" });
    expect(rank.songs.map((item) => [item.track.id, item.playCount])).toEqual([
      ["1", 98],
      ["3", 72],
    ]);
    expect(rank.songs[1].track.title).toBe("已下架歌曲");
    expect(rank.albums[0]).toMatchObject({ track: { album: { id: "4" } }, playCount: 98 });
    expect(rank.period).toEqual({ startTime, endTime });
  });

  it("月榜未发布时保持为空，不猜测嵌套数组中的歌曲", async () => {
    api.monthly.mockResolvedValue({
      code: 200,
      data: { unrelated: [{ id: 1, name: "无关数据" }] },
    });
    expect((await fetchNeteaseStatsRank(42, "month")).songs).toEqual([]);
    expect(api.details).not.toHaveBeenCalled();
  });

  it("足迹使用历史加实时分钟数，时段为六段，曲风百分比不重新归一化", async () => {
    api.report.mockImplementation(async ({ endTime: requestedEnd }: { endTime?: number }) =>
      requestedEnd
        ? {
            code: 200,
            data: {
              listenTimeDistributionBlock: {
                durationDetails: [
                  { period: "2026-08-01", duration: 12, reachLimit: false },
                  { period: "2026-07-01", duration: 99 },
                ],
              },
            },
          }
        : {
            code: 200,
            data: {
              startTime,
              endTime,
              listenTimeDistributionBlock: {
                durationDetails: [{ period: "2026-09-01", duration: 92, reachLimit: false }],
              },
              listenTimeBlock: {
                circleTimePeriodDurations: [
                  { period: "deep_night", duration: 0 },
                  { period: "morning", duration: 214 },
                ],
              },
              topStyleBlock: {
                sections: [
                  { genreName: "二次元", percent: "85" },
                  { genreName: "流行", percent: "10" },
                  { genreName: "电子", percent: "2.5" },
                  { genreName: "其他", percent: "1" },
                ],
              },
              otherArray: [{ hour: 0, count: 900 }],
            },
          },
    );
    api.realtime.mockResolvedValue({
      code: 200,
      data: {
        listenTimeDistributionBlock: {
          durationDetails: [
            { period: "2026-10-26", duration: 123, reachLimit: true },
            { period: "2026-10-27", duration: 10 },
          ],
        },
      },
    });
    const charts = await fetchNeteaseListeningCharts(now);
    expect(charts.daily).toEqual([
      { day: "2026-08-01", durationMs: 720000, reachLimit: false },
      { day: "2026-09-01", durationMs: 5520000, reachLimit: false },
      { day: "2026-10-26", durationMs: 7380000, reachLimit: true },
    ]);
    expect(charts.timeBands).toEqual([
      { period: "morning", durationMs: 12840000 },
      { period: "deep_night", durationMs: 0 },
    ]);
    expect(charts.genres.map((item) => item.percent)).toEqual([85, 10, 2.5]);
    expect(charts.genrePeriod).toEqual({ startTime, endTime });
    expect(charts.errors).toEqual({ daily: false, timeBands: false, genres: false });
  });

  it("报告请求失败时保留实时足迹并报告错误，不填充虚假的零值", async () => {
    api.report.mockRejectedValue(new Error("offline"));
    api.realtime.mockResolvedValue({
      code: 200,
      data: {
        listenTimeDistributionBlock: {
          durationDetails: [{ period: "2026-10-26", duration: 0, reachLimit: false }],
        },
      },
    });
    const charts = await fetchNeteaseListeningCharts(now);
    expect(charts.daily).toEqual([{ day: "2026-10-26", durationMs: 0, reachLimit: false }]);
    expect(charts.timeBands).toEqual([]);
    expect(charts.genres).toEqual([]);
    expect(charts.errors).toEqual({ daily: true, timeBands: true, genres: true });
  });

  it("周榜和总榜使用用户排行，按真实歌曲汇总专辑与歌手", async () => {
    const track: Track = {
      id: "1",
      source: "netease",
      title: "歌曲",
      artists: [{ id: "2", name: "歌手" }],
      album: { id: "3", name: "专辑" },
      duration: 1000,
    };
    api.userRank.mockResolvedValue([
      { ...track, playCount: 10 },
      { ...track, id: "4", playCount: 5 },
    ]);
    const rank = await fetchNeteaseStatsRank(42, "all");
    expect(api.userRank).toHaveBeenCalledWith(42, "all");
    expect(rank.albums[0].playCount).toBe(15);
    expect(rank.artists[0].playCount).toBe(15);
    expect(api.report).not.toHaveBeenCalled();
  });
});
