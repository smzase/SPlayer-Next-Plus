import { detectFormat, parseLyric as parseWithKit } from "lyric-kit";
import type { LyricInput, LyricResult, ParseOptions } from "lyric-kit";

/**
 * 统一解析歌词，延续 fork 忽略纯时间标签行且不提前截断上一行的行为
 * @param input - 主歌词与可选翻译、音译
 * @param options - 上游解析选项
 * @returns 保留逐字边界、背景歌词和元数据的解析结果
 */
export const parseLyric = (input: LyricInput, options: ParseOptions = {}): LyricResult => {
  const normalized = { ...input };
  for (const [contentKey, formatKey] of [
    ["content", "format"],
    ["translation", "translationFormat"],
    ["romaji", "romajiFormat"],
  ] as const) {
    const content = input[contentKey];
    if (!content) continue;
    const format = input[formatKey] ?? (contentKey === "content" ? options.format : undefined);
    if ((format ?? detectFormat(content)) !== "lrc") continue;
    normalized[contentKey] = content.replace(
      /^[\t ]*(?:\[\d+:\d+(?:[.:]\d{1,3})?\][\t ]*)+\r?$/gm,
      "",
    );
  }
  return parseWithKit(normalized, options);
};
