import { DEFAULT_AMLL_DB_SERVERS, OFFICIAL_AMLL_API } from "../defaults/lyrics";

/**
 * 校验官方 API 或含歌曲 ID 占位符的镜像模板
 * @param template - 地址模板
 * @returns 是否为有效 HTTP 或 HTTPS 模板
 */
export const isValidTtmlServer = (template: string): boolean => {
  if (template === OFFICIAL_AMLL_API) return true;
  if (!template.includes("%s")) return false;
  try {
    const url = new URL(template.replaceAll("%p", "ncm-lyrics").replaceAll("%s", "1"));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * 将旧单地址转换为来源列表，保留已有多源排序
 * @param value - 旧地址或多源列表
 * @returns 独立的来源数组，旧自定义地址优先于新增镜像
 */
export const normalizeTtmlServers = (value: string | readonly string[]): string[] => {
  if (typeof value !== "string") return [...value];
  const url = value.trim();
  return url ? [...new Set([url, DEFAULT_AMLL_DB_SERVERS[1]])] : [...DEFAULT_AMLL_DB_SERVERS];
};
