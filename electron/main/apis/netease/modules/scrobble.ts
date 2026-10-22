import { createOption } from "../core/option";
import { CLIENT_LOG_DOMAIN } from "../core/config";
import type { NeteaseModule } from "../core/types";

/**
 * 保留桌面日志的来源归类，按实际开始和结束时机分别提交
 * @param query - 资源、来源、日志动作和实际收听秒数
 * @param request - 公共请求层
 * @returns 服务端原始日志响应
 */
const scrobble: NeteaseModule = async (query, request) => {
  const id = String(query.id || "");
  if (!/^[1-9]\d*$/.test(id))
    return { status: 400, body: { code: 400, msg: "缺少有效的资源 ID" }, cookie: [] };
  const action = query.action ?? "play";
  if (action !== "startPlay" && action !== "play")
    return { status: 400, body: { code: 400, msg: "播放日志动作无效" }, cookie: [] };
  const time = Number(query.time);
  if (action === "play" && (!Number.isFinite(time) || time <= 0))
    return { status: 400, body: { code: 400, msg: "缺少有效的播放时长" }, cookie: [] };

  const resourceType = query.resourceType === "dj" ? "dj" : "song";
  const sourceType = typeof query.sourceType === "string" ? query.sourceType : "song";
  const source =
    resourceType === "dj" || sourceType === "radio"
      ? "djradio"
      : sourceType === "song"
        ? "track"
        : sourceType;
  const sourceId = String(query.sourceid || query.sourceId || id);
  const categoryId = Number(query.categoryId);
  const json = {
    id,
    type: resourceType,
    mainsite: "1",
    mainsiteWeb: "1",
    content: `id=${sourceId}`,
    sourceId,
    source,
    sourcetype: source,
    ...(resourceType === "dj" && Number.isFinite(categoryId) ? { categoryId } : {}),
    ...(action === "play" ? { time, wifi: 0, download: 0, end: "playend" } : {}),
  };
  const rawCookie = query.cookie;
  const cookie =
    typeof rawCookie === "string"
      ? rawCookie.includes("os=")
        ? rawCookie.replace(/os=[^;]+/g, "os=osx")
        : `${rawCookie}; os=osx`
      : { ...rawCookie, os: "osx" };
  return request(
    "/api/feedback/weblog",
    { logs: JSON.stringify([{ action: action === "startPlay" ? "startplay" : "play", json }]) },
    { ...createOption({ ...query, cookie }, "eapi"), domain: CLIENT_LOG_DOMAIN },
  );
};
export default scrobble;
