import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/**
 * 获取网易云听歌足迹报告
 * @param query - 报告周期与可选结束时间
 * @param request - 公共请求入口
 * @returns 网易云原始报告响应
 */
const listenDataReport: NeteaseModule = (query, request) =>
  request(
    "/api/content/activity/listen/data/report",
    { type: query.type ?? "week", endTime: query.endTime },
    createOption(query),
  );

export default listenDataReport;
