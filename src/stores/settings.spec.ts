import { createApp } from "vue";
import { createPinia, setActivePinia } from "pinia";
import persistedState from "pinia-plugin-persistedstate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "./settings";
import { DEFAULT_SIDEBAR_NAV_GROUPS } from "@/types/settings";
import { SIDEBAR_NAV_META } from "@/components/layout/sidebarNav";

beforeEach(() => {
  vi.stubGlobal("api", {
    desktopLyric: { onConfigChange: () => vi.fn() },
    dynamicIsland: { onConfigChange: () => vi.fn() },
    window: {
      onDesktopLyricVisibilityChange: () => vi.fn(),
      onDynamicIslandVisibilityChange: () => vi.fn(),
      onTaskbarLyricVisibilityChange: () => vi.fn(),
      isDesktopLyricOpen: async () => false,
      isDynamicIslandOpen: async () => false,
      isTaskbarLyricOpen: async () => false,
    },
  });
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("fork 侧边栏入口迁移", () => {
  it("默认导航包含关注和我的播客，并保持原有入口顺序", () => {
    const keys = DEFAULT_SIDEBAR_NAV_GROUPS.flatMap((group) => group.keys);
    expect(keys[keys.indexOf("/") + 1]).toBe("/follow");
    expect(keys[keys.indexOf("/cloud") - 1]).toBe("/podcasts");
    expect(SIDEBAR_NAV_META["/follow"].labelKey).toBe("nav.follow");
    expect(SIDEBAR_NAV_META["/podcasts"].labelKey).toBe("nav.podcasts");
  });

  it("已有自定义分组自动补回 fork 入口，保留原有顺序和悬停展开设置", () => {
    localStorage.setItem(
      "settings",
      JSON.stringify({
        appearance: {
          sidebarNavGroups: [{ name: "自定义", showName: true, keys: ["/", "/cloud", "/library"] }],
          sidebarHoverExpand: true,
        },
      }),
    );
    const pinia = createPinia();
    pinia.use(persistedState);
    createApp({}).use(pinia);
    setActivePinia(pinia);
    const settings = useSettingsStore();
    const keys = settings.appearance.sidebarNavGroups.flatMap((group) => group.keys);
    expect(keys.slice(0, 3)).toEqual(["/", "/cloud", "/library"]);
    expect(keys.filter((key) => key === "/follow")).toHaveLength(1);
    expect(keys.filter((key) => key === "/podcasts")).toHaveLength(1);
    expect(settings.appearance.sidebarNavGroups[0].name).toBe("自定义");
    expect(settings.appearance.sidebarHoverExpand).toBe(true);
    settings.$dispose();
  });
});
