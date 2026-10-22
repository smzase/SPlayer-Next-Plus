import { describe, expect, it } from "vitest";
import { parseLyric } from "./parse";

describe("fork 歌词空时间标签兼容", () => {
  it.each(["[00:01.00]", "  [00:01][00:01.500]\t", "[00:01:000]\r"])(
    "忽略 %s，上一句延续到下一句有效歌词",
    (emptyLine) => {
      const result = parseLyric({ content: `[00:00.00]A\n${emptyLine}\n[00:02.00]B` });
      expect(result.lines).toHaveLength(2);
      expect(result.lines[0]).toMatchObject({ startTime: 0, endTime: 2000 });
      expect(result.lines[0].words[0].endTime).toBe(2000);
    },
  );

  it("保留整秒时间、元数据和翻译音译配对", () => {
    const result = parseLyric(
      {
        content: "[ti:歌曲]\n[00:01]原词\n[00:02]\n[00:03]下一句",
        translation: "[00:01]译文\n[00:02]\n[00:03]下一译文",
        romaji: "[00:01]romaji\n[00:02]\n[00:03]next",
      },
      { extractMetadata: true },
    );
    expect(result.metadata.title).toEqual(["歌曲"]);
    expect(result.lines[0]).toMatchObject({
      startTime: 1000,
      endTime: 3000,
      translatedLyric: "译文",
      romanLyric: "romaji",
    });
  });

  it("保留增强 LRC 显式逐字结束时间及间隔", () => {
    const result = parseLyric({
      content: "[00:01]<00:01>A<00:01.500>\n[00:02]\n[00:03]B",
      format: "lrc",
    });
    expect(result.lines[0].words[0]).toMatchObject({ startTime: 1000, endTime: 1500 });
  });

  it("TTML 仍按显式行结束时间解析", () => {
    const result = parseLyric({
      content:
        '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="2s">歌词</p></div></body></tt>',
      format: "ttml",
    });
    expect(result.lines[0]).toMatchObject({ startTime: 1000, endTime: 2000 });
  });

  it("只有空时间标签时没有可显示歌词", () => {
    expect(parseLyric({ content: "[00:01]\n[00:02]", format: "lrc" }).lines).toEqual([]);
  });
});
