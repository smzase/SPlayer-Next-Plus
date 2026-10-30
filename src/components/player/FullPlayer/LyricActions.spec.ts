import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import { createI18n } from "vue-i18n";
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent, PopoverArrow } from "reka-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import zhCN from "@/i18n/locales/zh-CN.json";
import SButton from "@/components/ui/SButton.vue";
import SPopover from "@/components/ui/SPopover.vue";
import LyricActions from "./LyricActions.vue";

const { clearCache, success } = vi.hoisted(() => ({ clearCache: vi.fn(), success: vi.fn() }));
const media = reactive({ track: null as Track | null, parsedLyric: [] });
vi.mock("@/stores/media", () => ({ useMediaStore: () => media }));
vi.mock("@/stores/status", () => ({ useStatusStore: () => ({ lyricOffsetMs: 0 }) }));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({ player: { playerBgType: "blur", playerBgRenderer: "mesh" } }),
}));
vi.mock("@/settings/useSettingsDialog", () => ({ useSettingsDialog: () => ({ show: vi.fn() }) }));
vi.mock("@/services/lyric/loader", () => ({ clearCurrentLyricCache: clearCache }));
vi.mock("@/composables/useToast", () => ({
  toast: { success, warning: vi.fn(), error: vi.fn() },
}));

let wrapper: VueWrapper;
beforeEach(() => {
  media.track = {
    id: "same-id",
    source: "local",
    path: "first.mp3",
    title: "测试",
    artists: [],
    duration: 0,
  };
  clearCache.mockResolvedValue(undefined);
  vi.stubGlobal("api", { lyrics: { clearTrackCache: vi.fn() } });
  wrapper = mount(LyricActions, {
    attachTo: document.body,
    props: { immersive: false },
    global: {
      plugins: [createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": zhCN } })],
      components: {
        SButton,
        SPopover,
        PopoverRoot,
        PopoverTrigger,
        PopoverPortal,
        PopoverContent,
        PopoverArrow,
      },
      stubs: Object.fromEntries(
        [
          "SNumberInput",
          "CopyLyricsDialog",
          "IconLucideCopy",
          "IconLucidePlus",
          "IconLucideMinus",
          "IconLucideSettings2",
          "IconSpTitaniumBackground",
          "IconLucideTrash2",
          "IconLucideLoader2",
        ].map((name) => [name, true]),
      ),
    },
  });
});
afterEach(() => {
  wrapper.unmount();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/**
 * 打开真实弹层并返回确认区域，不执行缓存删除
 * @returns 已打开的确认菜单
 */
const openConfirmation = async (): Promise<HTMLElement> => {
  await wrapper.get(`button[aria-label="${zhCN.player.lyricCache.clear}"]`).trigger("click");
  await flushPromises();
  expect(clearCache).not.toHaveBeenCalled();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  return dialog!;
};

describe("歌词缓存防误触", () => {
  it("点击垃圾桶只弹出确认菜单，取消后不删除", async () => {
    const dialog = await openConfirmation();
    expect(dialog.textContent).toContain(zhCN.player.lyricCache.confirmHint);
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === zhCN.common.cancel)!
      .click();
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(clearCache).not.toHaveBeenCalled();
  });

  it("明确确认后仅清理一次并关闭菜单", async () => {
    const dialog = await openConfirmation();
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === zhCN.player.lyricCache.confirm)!
      .click();
    await flushPromises();
    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith(zhCN.player.lyricCache.cleared);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("切换到相同 ID 的另一首本地歌曲时关闭旧确认菜单", async () => {
    await openConfirmation();
    media.track = { ...media.track!, path: "second.mp3" };
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(clearCache).not.toHaveBeenCalled();
  });
});
