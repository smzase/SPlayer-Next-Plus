import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h } from "vue";
import { createI18n } from "vue-i18n";
import SettingsItem from "@/components/settings/SettingsItem.vue";
import localCacheCategory from "./localCache";

const mocks = vi.hoisted(() => ({
  enabled: true,
  player: { preloadNextTrack: true, transitionMode: "crossfade" },
  confirm: vi.fn(),
}));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    player: mocks.player,
    system: { cache: { songCache: { enabled: mocks.enabled } } },
  }),
}));
vi.mock("@/composables/useDialog", () => ({ dialog: { confirm: mocks.confirm } }));
vi.mock("@/settings/useSettingModel", () => ({
  useSettingModel: () =>
    computed({
      get: () => mocks.enabled,
      set: (value: boolean) => {
        mocks.enabled = value;
      },
    }),
}));
vi.mock("@/components/settings/custom/FileCacheManager.vue", () => ({ default: {} }));
vi.mock("@/components/settings/custom/DbCacheManager.vue", () => ({ default: {} }));
vi.mock("~icons/lucide/hard-drive", () => ({ default: {} }));

const item = localCacheCategory
  .sections!.flatMap((section) => section.items)
  .find((item) => item.key === "enableSongCache")!;

/**
 * 通过真实设置组件触发缓存开关和确认流程
 * @param enabled - 用户选择的缓存状态
 */
const toggleCache = async (enabled: boolean): Promise<void> => {
  const wrapper = mount(SettingsItem, {
    props: { item },
    global: {
      plugins: [
        createI18n({ legacy: false, locale: "zh-CN", missingWarn: false, fallbackWarn: false }),
      ],
      stubs: {
        SSwitch: defineComponent({
          emits: ["update:modelValue"],
          setup:
            (_props, { emit }) =>
            () =>
              h("button", { onClick: () => emit("update:modelValue", enabled) }, "切换缓存"),
        }),
        SSlider: true,
      },
    },
  });
  await wrapper.get("button").trigger("click");
  await flushPromises();
  wrapper.unmount();
};

describe("歌曲缓存与预载、播放过渡联动", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.player = { preloadNextTrack: true, transitionMode: "crossfade" };
    mocks.confirm.mockResolvedValue(true);
  });

  it.each([false, true])("关闭缓存的确认结果为 %s 时保留或更新依赖设置", async (confirmed) => {
    mocks.confirm.mockResolvedValue(confirmed);
    await toggleCache(false);
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.enabled).toBe(!confirmed);
    expect(mocks.player).toEqual({
      preloadNextTrack: !confirmed,
      transitionMode: confirmed ? "none" : "crossfade",
    });
  });

  it.each([
    { preload: true, mode: "none", expectedMode: "none", needsConfirm: true },
    { preload: false, mode: "crossfade", expectedMode: "none", needsConfirm: true },
    { preload: true, mode: "automix", expectedMode: "none", needsConfirm: true },
    { preload: false, mode: "automix", expectedMode: "none", needsConfirm: true },
    { preload: false, mode: "none", expectedMode: "none", needsConfirm: false },
  ])("预载为 $preload 且过渡为 $mode 时仅关闭依赖缓存的功能", async (scenario) => {
    mocks.player = { preloadNextTrack: scenario.preload, transitionMode: scenario.mode };
    await toggleCache(false);
    expect(mocks.confirm).toHaveBeenCalledTimes(scenario.needsConfirm ? 1 : 0);
    expect(mocks.enabled).toBe(false);
    expect(mocks.player).toEqual({
      preloadNextTrack: false,
      transitionMode: scenario.expectedMode,
    });
  });

  it("开启缓存不会关闭已有的预载和交叉过渡", async () => {
    mocks.enabled = false;
    await toggleCache(true);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.enabled).toBe(true);
    expect(mocks.player).toEqual({ preloadNextTrack: true, transitionMode: "crossfade" });
  });
});
