import { createWebOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/**
 * 更新自建歌单内的歌曲顺序
 * @param query - 歌单 ID 和 JSON 编码的完整歌曲 ID 列表
 * @param request - 统一请求入口
 * @returns 服务端排序结果
 */
const songOrderUpdate: NeteaseModule = (query, request) =>
  request(
    "/api/playlist/manipulate/tracks",
    {
      pid: query.pid,
      trackIds: query.ids,
      op: "update",
    },
    createWebOption(query),
  );

export default songOrderUpdate;
