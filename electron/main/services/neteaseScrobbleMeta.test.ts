import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Track } from "../../../shared/types/player";
import { toNeteaseScrobbleTrack } from "../../../shared/utils/neteaseScrobble";
const track: Track = {
  id: "123",
  source: "netease",
  title: "测试歌曲",
  artists: [{ name: "测试" }],
  duration: 180000,
};
describe("播放日志的轻量资源与来源信息", () => {
  it("歌曲保留资源标识、播放来源和引擎时长", () => {
    assert.deepEqual(toNeteaseScrobbleTrack(track, undefined, 236200), {
      id: "123",
      sourceId: "123",
      sourceType: "song",
      resourceType: "song",
      title: "测试歌曲",
      durationSec: 236,
    });
  });
  it("播客声音使用节目资源标识和类型", () => {
    assert.deepEqual(toNeteaseScrobbleTrack({ ...track, extId: "3081133072" }, undefined, 10000), {
      id: "3081133072",
      sourceId: "3081133072",
      sourceType: "radio",
      resourceType: "dj",
      title: "测试歌曲",
      durationSec: 10,
    });
  });
  it("保留歌单来源但不把专辑元信息误作播放来源", () => {
    const result = toNeteaseScrobbleTrack(
      track,
      { provider: "netease", originType: "playlist", originId: "456" },
      180000,
    );
    assert.equal(result?.sourceId, "456");
    assert.equal(result?.sourceType, "list");
    assert.equal(result?.ncbl, undefined);
    assert.equal(toNeteaseScrobbleTrack(track, undefined, 180000)?.sourceId, "123");
  });
  it("NCBL 保留曲目来源和音质，播客使用电台来源", () => {
    const context = { provider: "netease", originType: "playlist", originId: "456" } as const;
    assert.deepEqual(toNeteaseScrobbleTrack(track, context, 180000, "ncbl")?.ncbl, {
      sourceid: "456",
      sourceType: "list",
      artist: "测试",
      bitrate: 320,
      level: "higher",
      fee: 0,
    });
    const voice = { ...track, extId: "789", album: { id: "321", name: "播客" } };
    const result = toNeteaseScrobbleTrack(voice, undefined, 10000, "ncbl");
    assert.equal(result?.id, "789");
    assert.equal(result?.ncbl?.sourceid, "321");
    assert.equal(result?.ncbl?.sourceType, "radio");
  });
  it("无效标识和其他来源不进入平台日志", () => {
    assert.equal(toNeteaseScrobbleTrack(null, undefined, 180000), null);
    for (const id of ["0", "wrong", ""])
      assert.equal(toNeteaseScrobbleTrack({ ...track, id }, undefined, 180000), null);
    for (const source of ["local", "qqmusic", "kugou"] as const)
      assert.equal(toNeteaseScrobbleTrack({ ...track, source }, undefined, 180000), null);
  });
});
