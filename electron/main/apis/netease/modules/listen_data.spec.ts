import { describe, expect, it, vi } from "vitest";
import type { Query } from "../core/option";
import type { RequestFn } from "../core/types";
import listenDataReport from "./listen_data_report";
import listenDataSongPlayRank from "./listen_data_song_play_rank";
import listenDataRealtimeReport from "./listen_data_realtime_report";

const createRequest = () =>
  vi.fn().mockResolvedValue({ status: 200, body: { code: 200 }, cookie: [] });

describe("网易云听歌统计接口", () => {
  it("传递报告周期和截止日期", async () => {
    const request = createRequest();

    await listenDataReport(
      { type: "month", endTime: 123 } satisfies Query,
      request as unknown as RequestFn,
    );

    expect(request).toHaveBeenCalledWith(
      "/api/content/activity/listen/data/report",
      { type: "month", endTime: 123 },
      expect.objectContaining({ crypto: "" }),
    );
  });

  it("请求本月实时聆听足迹", async () => {
    const request = createRequest();
    await listenDataRealtimeReport(
      { type: "month" } satisfies Query,
      request as unknown as RequestFn,
    );
    expect(request).toHaveBeenCalledWith(
      "/api/content/activity/listen/data/realtime/report",
      { type: "month" },
      expect.objectContaining({ crypto: "" }),
    );
  });

  it("按周期请求歌曲播放排行", async () => {
    const request = createRequest();

    await listenDataSongPlayRank(
      { type: "month" } satisfies Query,
      request as unknown as RequestFn,
    );

    expect(request).toHaveBeenCalledWith(
      "/api/content/activity/listen/data/song/play/rank",
      { type: "month", endTime: undefined },
      expect.objectContaining({ crypto: "" }),
    );
  });
});
