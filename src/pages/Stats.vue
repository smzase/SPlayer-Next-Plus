<script setup lang="ts">
defineOptions({ name: "Stats" });

import type {
  CloudListeningCharts,
  CloudStatsPeriod,
  DailyPlayStats,
  HourlyPlayStats,
  LibraryStats,
  TopAlbum,
  TopArtist,
  TopTrack,
} from "@shared/types/stats";
import { useFloatingPlayerBar } from "@/composables/useFloatingPlayerBar";
import { useStatsStore } from "@/stores/stats";
import { useUserStore } from "@/stores/user";
import {
  fetchNeteaseListeningCharts,
  fetchNeteaseStatsRank,
  type NeteaseStatsRank,
} from "@/apis/stats/netease";

type RankId = "songs" | "albums" | "artists";

const { t } = useI18n();
const { isFloatingBar } = useFloatingPlayerBar();
const statsStore = useStatsStore();
const userStore = useUserStore();
const needsLogin = computed(() => statsStore.source === "netease" && !userStore.profile?.userId);
const libraryStats = ref<LibraryStats | null>(null);
const daily = ref<DailyPlayStats[]>([]);
const hourly = ref<HourlyPlayStats[]>([]);
const cloudCharts = shallowRef<CloudListeningCharts>();
const topSongs = shallowRef<TopTrack[]>([]);
const topAlbums = shallowRef<TopAlbum[]>([]);
const topArtists = shallowRef<TopArtist[]>([]);
const loading = ref(false);
const chartsLoading = ref(false);
const loadError = ref(false);
const cloudPeriods = reactive<Record<RankId, CloudStatsPeriod>>({
  songs: "week",
  albums: "week",
  artists: "week",
});
const cloudPeriodLoading = reactive<Partial<Record<RankId, boolean>>>({});
const rankErrors = reactive<Partial<Record<RankId, boolean>>>({});
// 每轮加载最多保存三个周期，切换账号或来源后整体释放
let rankCache = new Map<CloudStatsPeriod, Promise<NeteaseStatsRank>>();
let requestId = 0;
const chartError = computed(
  () => loadError.value || Object.values(cloudCharts.value?.errors ?? {}).some(Boolean),
);

/**
 * 清空指定榜单，防止新周期显示旧数据
 * @param id - 榜单标识
 */
const clearRank = (id: RankId): void => {
  if (id === "songs") topSongs.value = [];
  if (id === "albums") topAlbums.value = [];
  if (id === "artists") topArtists.value = [];
};

/**
 * 请求榜单并校验账号、来源与所选周期
 * @param id - 榜单标识
 * @param period - 排行周期
 * @returns 当前请求处理完成
 */
const loadCloudRank = async (id: RankId, period: CloudStatsPeriod): Promise<void> => {
  const uid = userStore.profile?.userId;
  if (statsStore.source !== "netease" || !uid) return;
  const generation = requestId;
  const cache = rankCache;
  clearRank(id);
  rankErrors[id] = false;
  cloudPeriodLoading[id] = true;
  let pending = cache.get(period);
  if (!pending) {
    pending = fetchNeteaseStatsRank(uid, period);
    cache.set(period, pending);
  }
  try {
    const result = await pending;
    if (generation !== requestId || cloudPeriods[id] !== period) return;
    if (id === "songs") topSongs.value = result.songs;
    if (id === "albums") topAlbums.value = result.albums;
    if (id === "artists") topArtists.value = result.artists;
  } catch {
    if (cache.get(period) === pending) cache.delete(period);
    if (generation === requestId && cloudPeriods[id] === period) rankErrors[id] = true;
  } finally {
    if (generation === requestId && cloudPeriods[id] === period) cloudPeriodLoading[id] = false;
  }
};

/**
 * 切换独立榜单的周期
 * @param id - 榜单标识
 * @param period - 排行周期
 */
const changeCloudPeriod = (id: RankId, period: CloudStatsPeriod): void => {
  if (cloudPeriods[id] === period) return;
  cloudPeriods[id] = period;
  void loadCloudRank(id, period);
};

/**
 * 加载当前来源，旧请求不得覆盖新来源或账号的数据
 * @returns 当前数据源请求完成
 */
const loadStats = async (): Promise<void> => {
  const generation = ++requestId;
  rankCache = new Map();
  libraryStats.value = null;
  daily.value = [];
  hourly.value = [];
  cloudCharts.value = undefined;
  loadError.value = false;
  loading.value = false;
  chartsLoading.value = false;
  for (const id of ["songs", "albums", "artists"] as const) {
    clearRank(id);
    rankErrors[id] = false;
    cloudPeriodLoading[id] = false;
  }
  if (needsLogin.value) return;
  chartsLoading.value = true;
  if (statsStore.source === "netease") {
    for (const id of ["songs", "albums", "artists"] as const)
      void loadCloudRank(id, cloudPeriods[id]);
    try {
      const charts = await fetchNeteaseListeningCharts();
      if (generation === requestId) cloudCharts.value = charts;
    } catch {
      if (generation === requestId) loadError.value = true;
    } finally {
      if (generation === requestId) chartsLoading.value = false;
    }
    return;
  }
  loading.value = true;
  try {
    const [library, history, hourlyHistory, songs, albums, artists] = await Promise.all([
      window.api.stats.getLibraryStats(),
      window.api.stats.getPlayHistoryDaily(90),
      window.api.stats.getPlayHistoryHourly(),
      window.api.stats.getTopTracks(10),
      window.api.stats.getTopAlbums(10),
      window.api.stats.getTopArtists(10),
    ]);
    if (generation !== requestId) return;
    libraryStats.value = library;
    daily.value = history;
    hourly.value = hourlyHistory;
    topSongs.value = songs;
    topAlbums.value = albums;
    topArtists.value = artists;
  } catch {
    if (generation === requestId) loadError.value = true;
  } finally {
    if (generation === requestId) {
      loading.value = false;
      chartsLoading.value = false;
    }
  }
};

watch([() => statsStore.source, () => userStore.profile?.userId], () => void loadStats(), {
  immediate: true,
  flush: "sync",
});
onBeforeUnmount(() => {
  requestId++;
  rankCache.clear();
});
</script>

<template>
  <div
    class="h-full min-h-0"
    :class="
      statsStore.source === 'netease'
        ? 'overflow-hidden'
        : 'overflow-y-auto [scrollbar-gutter:stable]'
    "
  >
    <div
      class="mx-auto flex max-w-[1400px] flex-col gap-5 px-5 pt-2"
      :class="[
        statsStore.source === 'netease' && 'h-full min-h-0',
        isFloatingBar ? 'pb-28' : statsStore.source === 'netease' ? 'pb-5' : 'pb-10',
      ]"
    >
      <StatsOverview v-if="statsStore.source === 'local'" :stats="libraryStats" />
      <SCard v-if="needsLogin" radius="xl" class="py-12 text-center text-on-surface-variant">
        {{ t("stats.cloudNoLogin") }}
      </SCard>
      <template v-else>
        <div
          v-if="chartError"
          role="alert"
          class="flex shrink-0 items-center justify-between gap-3 text-sm text-on-surface-variant"
        >
          <span>{{ t("stats.loadFailed") }}</span>
          <SButton size="small" variant="tertiary" @click="loadStats">
            {{ t("common.retry") }}
          </SButton>
        </div>
        <StatsHeatmap
          class="shrink-0"
          :daily="daily"
          :hourly="hourly"
          :stats="libraryStats"
          :loading="chartsLoading"
          :cloud="statsStore.source === 'netease'"
          :cloud-charts="cloudCharts"
        />
        <StatsTopList
          :songs="topSongs"
          :albums="topAlbums"
          :artists="topArtists"
          :loading="loading"
          :cloud="statsStore.source === 'netease'"
          :periods="cloudPeriods"
          :period-loading="cloudPeriodLoading"
          :period-errors="rankErrors"
          @period-change="changeCloudPeriod"
          @retry="(id) => loadCloudRank(id, cloudPeriods[id])"
        />
      </template>
    </div>
  </div>
</template>
