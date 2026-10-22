import { describe, expect, it } from "vitest";
import type { Track } from "@shared/types/player";
import { toNeteaseScrobbleTrack } from "@shared/utils/neteaseScrobble";

const track: Track = {
  id: "123",
  source: "netease",
  title: "测试歌曲",
  artists: [{ name: "歌手" }],
  album: { id: "999", name: "不应作为来源的专辑" },
  duration: 180000,
  fee: 1,
};

describe("网易云听歌打卡元数据", () => {
  it("没有播放上下文时以歌曲自身作为来源", () => {
    expect(toNeteaseScrobbleTrack(track, undefined, 180000)).toMatchObject({
      id: "123",
      sourceId: "123",
      sourceType: "song",
      resourceType: "song",
    });
  });

  it.each([
    ["list", "456"],
    ["album", "999"],
    ["artist", "789"],
  ] as const)("保留 %s 播放来源", (sourceType, sourceId) => {
    expect(
      toNeteaseScrobbleTrack(
        { ...track, playbackSource: { id: sourceId, type: sourceType } },
        undefined,
        180000,
      ),
    ).toMatchObject({
      id: "123",
      sourceId,
      sourceType,
      resourceType: "song",
    });
  });

  it("播客声音使用节目 ID 和播客来源", () => {
    expect(
      toNeteaseScrobbleTrack(
        {
          ...track,
          id: "2725832901",
          extId: "3081133072",
          album: { id: "9988", name: "测试播客" },
          playbackSource: { id: "9988", type: "radio", categoryId: 7 },
        },
        undefined,
        180000,
      ),
    ).toMatchObject({
      id: "3081133072",
      sourceId: "9988",
      sourceType: "radio",
      resourceType: "dj",
      categoryId: 7,
    });
  });

  it("搜索结果中的声音从专辑字段恢复播客来源", () => {
    expect(
      toNeteaseScrobbleTrack(
        {
          ...track,
          id: "2725832901",
          extId: "3081133072",
          album: { id: "9988", name: "测试播客" },
          playbackSource: undefined,
        },
        undefined,
        180000,
      ),
    ).toMatchObject({
      id: "3081133072",
      sourceId: "9988",
      sourceType: "radio",
      resourceType: "dj",
    });
  });

  it("无效来源 ID 回退到歌曲来源", () => {
    expect(
      toNeteaseScrobbleTrack(
        { ...track, playbackSource: { id: "playlist:test", type: "list" } },
        undefined,
        180000,
      ),
    ).toMatchObject({
      sourceId: "123",
      sourceType: "song",
    });
  });
});
