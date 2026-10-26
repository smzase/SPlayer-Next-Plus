import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/**
 * 获取本周或本月已更新的每日收听时长
 * @param query - 报告周期
 * @param request - 公共请求入口
 * @returns 网易云实时报告响应
 */
const listenDataRealtimeReport: NeteaseModule = (query, request) =>
  request(
    "/api/content/activity/listen/data/realtime/report",
    { type: query.type ?? "week" },
    createOption(query),
  );

export default listenDataRealtimeReport;
