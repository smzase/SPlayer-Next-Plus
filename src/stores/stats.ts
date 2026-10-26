import { defineStore } from "pinia";

/** 统计页面数据源 */
export type StatsSource = "local" | "netease";

/**
 * 管理统计页面的数据源切换
 * @returns 统计数据源状态
 */
export const useStatsStore = defineStore(
  "stats",
  () => {
    const source = ref<StatsSource>("local");

    /**
     * 切换统计数据源
     * @param next - 目标数据源
     */
    const setSource = (next: StatsSource): void => {
      source.value = next;
    };

    return { source, setSource };
  },
  { persist: true },
);
