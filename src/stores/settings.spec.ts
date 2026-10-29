/* eslint-disable vue/one-component-per-file -- 每个持久化测试需要独立的应用实例 */
import { createApp } from "vue";
import { createPinia, setActivePinia } from "pinia";
import persistedState from "pinia-plugin-persistedstate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "./settings";
import { DEFAULT_SIDEBAR_NAV_GROUPS } from "@/types/settings";
import { SIDEBAR_NAV_META } from "@/components/layout/sidebarNav";
import type { DragRightClickAction } from "@shared/types/settings";

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

describe("拖拽右键设置", () => {
  it.each([
    { stored: {}, expected: "cancel" },
    { stored: { cancelDragOnRightClick: true }, expected: "cancel" },
    { stored: { cancelDragOnRightClick: false }, expected: "keep" },
    {
      stored: { dragRightClickAction: "cancel", cancelDragOnRightClick: false },
      expected: "cancel",
    },
    { stored: { dragRightClickAction: "keep" }, expected: "keep" },
    { stored: { dragRightClickAction: "commit" }, expected: "commit" },
  ])("迁移旧开关并保留三选一行为：$expected", ({ stored, expected }) => {
    localStorage.setItem("settings", JSON.stringify({ appearance: stored }));
    const pinia = createPinia();
    pinia.use(persistedState);
    createApp({}).use(pinia);
    setActivePinia(pinia);
    const settings = useSettingsStore();
    expect(settings.appearance.dragRightClickAction).toBe(expected);
    expect(settings.appearance).not.toHaveProperty("cancelDragOnRightClick");
    for (const action of ["cancel", "keep", "commit"] satisfies DragRightClickAction[]) {
      settings.appearance.dragRightClickAction = action;
      settings.$persist();
      const savedAppearance = JSON.parse(localStorage.getItem("settings")!).appearance;
      expect(savedAppearance.dragRightClickAction).toBe(action);
      expect(savedAppearance).not.toHaveProperty("cancelDragOnRightClick");
      settings.$hydrate();
      expect(settings.appearance.dragRightClickAction).toBe(action);
    }
    settings.$dispose();
  });
});

describe("fork 侧边栏入口迁移", () => {
  it("热更新时将旧主进程的单地址转换为来源列表", async () => {
    const legacy = "https://custom.example/%p/%s.ttml";
    Object.assign(window.api, {
      config: { getAll: vi.fn(async () => ({ lyric: { amllDbServer: legacy } })) },
    });
    setActivePinia(createPinia());
    const settings = useSettingsStore();
    await settings.syncSystem();
    expect(settings.system.lyric.amllDbServer).toEqual([
      legacy,
      "https://amll.mirror.dimeta.top/api/db/%p/%s.ttml",
    ]);
    settings.$dispose();
  });

  it("TTML 源在后端确认写入后才触发本地更新", async () => {
    let finish!: () => void;
    const set = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    Object.assign(window.api, { config: { set } });
    setActivePinia(createPinia());
    const settings = useSettingsStore();
    const previous = [...settings.system.lyric.amllDbServer];
    const next = ["https://changed.example/%p/%s.ttml"];
    const pending = settings.setSystem("lyric.amllDbServer", next);
    expect(settings.system.lyric.amllDbServer).toEqual(previous);
    finish();
    await pending;
    expect(settings.system.lyric.amllDbServer).toEqual(next);
    expect(set).toHaveBeenCalledWith("lyric.amllDbServer", next);
    settings.$dispose();
  });

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
