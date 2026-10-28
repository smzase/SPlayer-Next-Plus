import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import LyricCredit from "./LyricCredit.vue";

vi.mock("@/stores/media", async () => {
  const { reactive } = await import("vue");
  const media = reactive({ lyricAuthors: ["smzase"], lyricSongwriters: ["歌曲创作者"] });
  return { useMediaStore: () => media };
});

vi.mock("@/stores/settings", async () => {
  const { reactive } = await import("vue");
  const settings = reactive({ lyric: { bottomInfo: "none" } });
  return { useSettingsStore: () => settings };
});

describe("歌词底部信息", () => {
  beforeEach(() => {
    useMediaStore().lyricAuthors = ["smzase"];
    useMediaStore().lyricSongwriters = ["歌曲创作者"];
    useSettingsStore().lyric.bottomInfo = "none";
  });

  it("即时切换显示模式，优先项缺失时回退，只显示模式不回退", async () => {
    const settings = useSettingsStore();
    const media = useMediaStore();
    const wrapper = mount(LyricCredit, { global: { mocks: { $t: (key: string) => key } } });
    expect(wrapper.find("div").exists()).toBe(false);

    settings.lyric.bottomInfo = "preferAuthors";
    await nextTick();
    expect(wrapper.text()).toContain("@smzase");
    expect(wrapper.text()).not.toContain("歌曲创作者");

    media.lyricAuthors = [];
    await nextTick();
    expect(wrapper.text()).toContain("歌曲创作者");
    expect(wrapper.find(".cursor-pointer").exists()).toBe(false);

    settings.lyric.bottomInfo = "authors";
    await nextTick();
    expect(wrapper.find("div").exists()).toBe(false);

    media.lyricAuthors = ["smzase"];
    settings.lyric.bottomInfo = "preferSongwriters";
    await nextTick();
    expect(wrapper.text()).toContain("歌曲创作者");
    expect(wrapper.text()).not.toContain("@smzase");

    media.lyricSongwriters = [];
    await nextTick();
    expect(wrapper.text()).toContain("@smzase");

    settings.lyric.bottomInfo = "songwriters";
    await nextTick();
    expect(wrapper.find("div").exists()).toBe(false);
    wrapper.unmount();
  });
});
