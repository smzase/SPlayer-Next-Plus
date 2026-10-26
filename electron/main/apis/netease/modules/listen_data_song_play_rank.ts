import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/**
 * 获取网易云听歌歌曲排行
 * @param query - 排行周期与可选结束时间
 * @param request - 公共请求入口
 * @returns 网易云原始歌曲排行响应
 */
const listenDataSongPlayRank: NeteaseModule = (query, request) =>
  request(
    "/api/content/activity/listen/data/song/play/rank",
    { type: query.type ?? "month", endTime: query.endTime },
    createOption(query),
  );

export default listenDataSongPlayRank;
