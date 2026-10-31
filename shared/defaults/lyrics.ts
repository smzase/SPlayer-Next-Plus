/** 官方 API 来源标识，平台查询参数由主进程补齐 */
export const OFFICIAL_AMLL_API = "https://api.amll.dev/v1/lyrics/get";

/** 默认 TTML 源，按顺序依次尝试 */
export const DEFAULT_AMLL_DB_SERVERS = [
  OFFICIAL_AMLL_API,
  "https://amll.mirror.dimeta.top/api/db/%p/%s.ttml",
] as const;
