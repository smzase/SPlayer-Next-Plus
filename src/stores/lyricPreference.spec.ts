import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import { useLyricPreferenceStore } from "./lyricPreference";
import { useSettingsStore } from "./settings";

vi.mock("./settings", () => ({
  useSettingsStore: () => ({ lyric: { lyricSourcePreference: "netease" } }),
}));

const track: Track = { id: "123", source: "netease", title: "歌曲", artists: [], duration: 1000 };

describe("歌曲歌词固定设置", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("重建 store 后仍保留固定来源，歌曲元数据更新不影响身份", () => {
    useLyricPreferenceStore().setPinned(track, "qqmusic");
    setActivePinia(createPinia());
    const store = useLyricPreferenceStore();
    expect(store.getPinned({ ...track, title: "新标题" })).toBe("qqmusic");
    expect(store.getPreference(track)).toBe("qqmusic");
    expect(store.getPinned({ ...track, source: "qqmusic" })).toBeNull();
  });

  it("隔离不同服务器与媒体版本", () => {
    const streaming: Track = { ...track, source: "streaming", serverId: "a", serverRevision: 1 };
    const store = useLyricPreferenceStore();
    store.setPinned(streaming, "ttml");
    expect(store.getPinned({ ...streaming, serverId: "b" })).toBeNull();
    expect(store.getPinned({ ...streaming, serverRevision: 2 })).toBeNull();
  });

  it("固定时切换来源只修改本首歌，取消固定恢复全局值", () => {
    const store = useLyricPreferenceStore();
    store.setPinned(track, "qqmusic");
    store.select(track, "ttml");
    expect(store.getPinned(track)).toBe("ttml");
    expect(useSettingsStore().lyric.lyricSourcePreference).toBe("netease");
    store.setPinned(track, null);
    expect(store.getPreference(track)).toBe("netease");
  });

  it("临时 TTML 选择只作用于本首歌，切歌后清除", () => {
    const store = useLyricPreferenceStore();
    store.select(track, "ttml");
    expect(store.getPreference(track)).toBe("ttml");
    expect(store.getPreference({ ...track, id: "456" })).toBe("netease");
    store.clearTemporary();
    expect(store.getPreference(track)).toBe("netease");
  });
});
