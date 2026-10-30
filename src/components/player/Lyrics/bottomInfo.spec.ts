import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricLine } from "lyric-kit";
import { useSettingsStore } from "@/stores/settings";
import AMLLLyrics from "./AMLLLyrics.vue";
import DefaultLyrics from "./DefaultLyrics.vue";
import LyricCredit from "./LyricCredit.vue";

vi.mock("@/stores/settings", async () => {
  const { reactive } = await import("vue");
  const settings = reactive({
    lyric: {
      bottomInfo: "none",
      useAMSpring: false,
      amllVerticalSpringMass: 1,
      amllVerticalSpringDamping: 15,
      amllVerticalSpringStiffness: 100,
      amllVerticalSpringSoft: false,
      amllScaleSpringMass: 1,
      amllScaleSpringDamping: 20,
      amllScaleSpringStiffness: 100,
      amllScaleSpringSoft: false,
      amllCleanUnintentionalOverlaps: false,
      amllTryAdvanceStartTime: false,
      amllSyncMainAndBackgroundLines: false,
      amllNormalizeSpaces: false,
      amllResetLineTimestamps: false,
    },
  });
  return { useSettingsStore: () => settings };
});

vi.mock("@/stores/media", () => ({
  useMediaStore: () => ({ lyricAuthors: ["smzase"], lyricSongwriters: [] }),
}));
vi.mock("@/stores/status", () => ({ useStatusStore: () => ({ lyricOffsetMs: 0 }) }));
vi.mock("@/services/playback", () => ({ getCurrentTime: () => 0 }));

const lines: LyricLine[] = [
  {
    startTime: 1000,
    endTime: 2000,
    words: [{ word: "最后一行", startTime: 1000, endTime: 2000 }],
    translatedLyric: "",
    romanLyric: "",
    isBG: false,
    isDuet: false,
  },
];

describe("歌词底部信息与曲尾滚动", () => {
  const frames = new Map<number, FrameRequestCallback>();
  const observers = new Map<
    ResizeObserver,
    { callback: ResizeObserverCallback; targets: Set<Element> }
  >();
  let frameId = 0;
  let timestamp = 0;

  beforeEach(() => {
    useSettingsStore().lyric.bottomInfo = "none";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("ResizeObserver", function (callback: ResizeObserverCallback) {
      const targets = new Set<Element>();
      const observer: ResizeObserver = {
        observe: (target) => targets.add(target),
        unobserve: (target) => targets.delete(target),
        disconnect: () => observers.delete(observer),
      };
      observers.set(observer, { callback, targets });
      return observer;
    });
  });

  afterEach(() => {
    frames.clear();
    observers.clear();
    vi.unstubAllGlobals();
  });

  /** 等待 Vue 挂载、原生内容观察器与歌词渲染帧完成 */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
      await nextTick();
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (const [observer, { callback, targets }] of observers) {
        callback(
          [...targets].map((target) => {
            const height = target.classList.contains("amll-lyric-player") ? 400 : 40;
            const size = [{ inlineSize: 600, blockSize: height }];
            return {
              target,
              contentRect: new DOMRect(0, 0, 600, height),
              borderBoxSize: size,
              contentBoxSize: size,
              devicePixelContentBoxSize: size,
            };
          }),
          observer,
        );
      }
      const pending = [...frames.values()];
      frames.clear();
      timestamp += 16;
      for (const callback of pending) callback(timestamp);
    }
  };

  it.each([
    ["AMLL", AMLLLyrics],
    ["默认", DefaultLyrics],
  ] as const)("%s 引擎关闭底部信息时不留下占位节点，切换设置立即生效", async (_name, component) => {
    const wrapper = mount(component, {
      props: { lyricLines: lines, initialTime: 1500 },
      global: { components: { LyricCredit }, mocks: { $t: (key: string) => key } },
    });
    try {
      await settle();
      const bottom = wrapper.get(".lp-credit").element;
      expect(bottom.childNodes).toHaveLength(0);
      useSettingsStore().lyric.bottomInfo = "authors";
      await settle();
      expect(bottom.textContent).toContain("@smzase");
      useSettingsStore().lyric.bottomInfo = "none";
      await settle();
      expect(bottom.childNodes).toHaveLength(0);
    } finally {
      wrapper.unmount();
    }
  });

  it("AMLL 最后一行结束后保持滚动位置，启用底部信息后才向上移", async () => {
    const wrapper = mount(AMLLLyrics, {
      props: { lyricLines: lines, initialTime: 1500, playing: true },
      global: { components: { LyricCredit }, mocks: { $t: (key: string) => key } },
    });
    try {
      await settle();
      const player = wrapper.vm.lyricPlayer!;
      const group = player.currentLyricGroups[0];
      const before = group.posY.getCurrentPosition();
      wrapper.vm.setCurrentTime(2001);
      await settle();
      expect(group.posY.getCurrentPosition()).toBe(before);
      expect(player.getCurrentTime()).toBe(2001);

      useSettingsStore().lyric.bottomInfo = "authors";
      await settle();
      expect(group.posY.getCurrentPosition()).toBeLessThan(before);

      useSettingsStore().lyric.bottomInfo = "none";
      await settle();
      expect(group.posY.getCurrentPosition()).toBe(before);
      wrapper.vm.setCurrentTime(8000, true);
      await settle();
      expect(group.posY.getCurrentPosition()).toBe(before);
    } finally {
      wrapper.unmount();
    }
  });
});
