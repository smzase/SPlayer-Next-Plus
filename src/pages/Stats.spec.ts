import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, defineStore } from "pinia";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import type { CloudListeningCharts } from "@shared/types/stats";
import type { NeteaseStatsRank } from "@/apis/stats/netease";
import messages from "@/i18n/locales/zh-CN.json";

const api = vi.hoisted(() => ({ rank: vi.fn(), charts: vi.fn() }));
vi.mock("@/apis/stats/netease", () => ({
  fetchNeteaseStatsRank: api.rank,
  fetchNeteaseListeningCharts: api.charts,
}));
vi.mock("@/composables/useFloatingPlayerBar", () => ({
  useFloatingPlayerBar: () => ({ isFloatingBar: false }),
}));
vi.mock("@/stores/user", () => ({
  useUserStore: defineStore("stats-user-test", {
    state: () => ({ profile: { userId: 1 } as { userId: number } | null }),
  }),
}));
import { useUserStore } from "@/stores/user";
import { useStatsStore } from "@/stores/stats";
import Stats from "./Stats.vue";

/**
 * 创建可控的异步响应，模拟跨来源和周期的乱序请求
 * @returns 请求及完成函数
 */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
};

/**
 * 创建指定歌曲的测试榜单
 * @param id - 测试歌曲标识
 * @returns 三类榜单
 */
const rank = (id: string): NeteaseStatsRank => {
  const track: Track = { id, source: "netease", title: id, artists: [], duration: 1000 };
  return { songs: [{ track, playCount: 1 }], albums: [], artists: [] };
};
const charts: CloudListeningCharts = {
  daily: [],
  timeBands: [],
  genres: [],
  errors: { daily: false, timeBands: false, genres: false },
};

/**
 * 装配统计页并暴露来源和账号，隔离真实 IPC 与播放状态
 * @param source - 初始数据源
 * @returns 页面与状态
 */
const setup = (source: "local" | "netease" = "netease") => {
  const pinia = createPinia();
  const stats = useStatsStore(pinia);
  stats.setSource(source);
  const user = useUserStore(pinia);
  const wrapper = mount(Stats, {
    global: {
      plugins: [
        pinia,
        createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": messages } }),
      ],
      stubs: {
        StatsOverview: true,
        StatsHeatmap: {
          name: "StatsHeatmap",
          props: ["cloud", "cloudCharts"],
          template: "<div />",
        },
        StatsTopList: {
          name: "StatsTopList",
          props: ["songs", "albums", "artists", "periods", "periodLoading", "periodErrors"],
          template: "<div />",
        },
        SCard: { template: "<div><slot /></div>" },
        SButton: { template: "<button><slot /></button>" },
      },
    },
  });
  return { wrapper, stats, user };
};

beforeEach(() => {
  vi.resetAllMocks();
  api.rank.mockResolvedValue(rank("cloud"));
  api.charts.mockResolvedValue(charts);
  Object.assign(window, {
    api: {
      stats: {
        getLibraryStats: vi.fn().mockResolvedValue(null),
        getPlayHistoryDaily: vi.fn().mockResolvedValue([]),
        getPlayHistoryHourly: vi.fn().mockResolvedValue([]),
        getTopTracks: vi.fn().mockResolvedValue(rank("local").songs),
        getTopAlbums: vi.fn().mockResolvedValue([]),
        getTopArtists: vi.fn().mockResolvedValue([]),
      },
    },
  });
});

describe("统计来源与周期的异步隔离", () => {
  it("三个周榜共用一次请求，切换单卡周期不重取图表", async () => {
    const { wrapper } = setup();
    await flushPromises();
    expect(api.rank).toHaveBeenCalledTimes(1);
    const list = wrapper.findComponent({ name: "StatsTopList" });
    list.vm.$emit("periodChange", "songs", "month");
    await flushPromises();
    expect(api.rank).toHaveBeenCalledTimes(2);
    expect(api.charts).toHaveBeenCalledTimes(1);
    expect(list.props("periods")).toEqual({ songs: "month", albums: "week", artists: "week" });
    wrapper.unmount();
  });

  it("切回本地后，晚到的云端榜单和图表不得覆盖本地", async () => {
    const pendingRank = deferred<NeteaseStatsRank>();
    const pendingCharts = deferred<CloudListeningCharts>();
    api.rank.mockReturnValue(pendingRank.promise);
    api.charts.mockReturnValue(pendingCharts.promise);
    const { wrapper, stats } = setup();
    stats.setSource("local");
    await flushPromises();
    pendingRank.resolve(rank("stale-cloud"));
    pendingCharts.resolve(charts);
    await flushPromises();
    expect(wrapper.findComponent({ name: "StatsTopList" }).props("songs")[0].track.id).toBe(
      "local",
    );
    expect(wrapper.findComponent({ name: "StatsHeatmap" }).props("cloudCharts")).toBeUndefined();
    wrapper.unmount();
  });

  it("晚到的本地响应不得覆盖新云端数据", async () => {
    const pendingLocal = deferred<NeteaseStatsRank["songs"]>();
    vi.mocked(window.api.stats.getTopTracks).mockReturnValue(pendingLocal.promise);
    const { wrapper, stats } = setup("local");
    stats.setSource("netease");
    await flushPromises();
    pendingLocal.resolve(rank("stale-local").songs);
    await flushPromises();
    expect(wrapper.findComponent({ name: "StatsTopList" }).props("songs")[0].track.id).toBe(
      "cloud",
    );
    wrapper.unmount();
  });

  it("账号切换和退出立即清空旧数据，旧账号响应失效", async () => {
    const first = deferred<NeteaseStatsRank>();
    api.rank.mockReturnValueOnce(first.promise).mockResolvedValue(rank("second-account"));
    const { wrapper, user } = setup();
    user.profile = { userId: 2 } as typeof user.profile;
    await flushPromises();
    first.resolve(rank("first-account"));
    await flushPromises();
    expect(wrapper.findComponent({ name: "StatsTopList" }).props("songs")[0].track.id).toBe(
      "second-account",
    );
    user.profile = null;
    await nextTick();
    expect(wrapper.text()).toContain(messages.stats.cloudNoLogin);
    expect(wrapper.findComponent({ name: "StatsTopList" }).exists()).toBe(false);
    wrapper.unmount();
  });

  it("周期乱序响应不覆盖当前选择，已完成的周期可重用", async () => {
    const month = deferred<NeteaseStatsRank>();
    api.rank.mockImplementation((_uid: number, period: string) =>
      period === "month" ? month.promise : Promise.resolve(rank(period)),
    );
    const { wrapper } = setup();
    await flushPromises();
    const list = wrapper.findComponent({ name: "StatsTopList" });
    list.vm.$emit("periodChange", "songs", "month");
    list.vm.$emit("periodChange", "songs", "all");
    await flushPromises();
    month.resolve(rank("stale-month"));
    await flushPromises();
    expect(list.props("songs")[0].track.id).toBe("all");
    list.vm.$emit("periodChange", "songs", "month");
    await flushPromises();
    // 已缓存成功的月份可直接重用
    expect(list.props("songs")[0].track.id).toBe("stale-month");
    wrapper.unmount();
  });

  it("失败的榜单显示错误且能重新请求", async () => {
    api.rank.mockRejectedValueOnce(new Error("offline"));
    const { wrapper } = setup();
    await flushPromises();
    const list = wrapper.findComponent({ name: "StatsTopList" });
    expect(list.props("periodErrors").songs).toBe(true);
    expect(list.props("songs")).toEqual([]);
    list.vm.$emit("retry", "songs");
    await flushPromises();
    expect(list.props("periodErrors").songs).toBe(false);
    expect(list.props("songs")[0].track.id).toBe("cloud");
    wrapper.unmount();
  });
});
