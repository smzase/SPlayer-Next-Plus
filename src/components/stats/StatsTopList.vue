<script setup lang="ts">
import type { Component } from "vue";
import type { Track } from "@shared/types/player";
import type { CloudStatsPeriod, TopAlbum, TopArtist, TopTrack } from "@shared/types/stats";
import * as player from "@/core/player";
import { navigateToAlbum, navigateToArtist } from "@/utils/navigate";
import StatsRankRow, { type RankItem } from "./StatsRankRow.vue";
import { useLibraryStore } from "@/stores/library";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideUser from "~icons/lucide/user";
import { useTrackMenu } from "@/composables/useTrackMenu";
import { useFavorite } from "@/composables/useFavorite";
import { usePlaylistPicker } from "@/composables/usePlaylistPicker";
import { useDownload } from "@/composables/useDownload";
import type { QualityLevel } from "@/utils/quality";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";
import IconLucideArrowUp from "~icons/lucide/arrow-up";

interface RankSection {
  id: "songs" | "albums" | "artists";
  title: string;
  icon: Component;
  circle: boolean;
  items: RankItem[];
  onClick: (item: RankItem) => void;
}

type RankId = RankSection["id"];

const props = defineProps<{
  /** 最常听的歌曲 */
  songs: TopTrack[];
  /** 最常听的专辑 */
  albums: TopAlbum[];
  /** 最常听的歌手 */
  artists: TopArtist[];
  /** 数据是否仍在加载 */
  loading: boolean;
  /** 是否展示网易云排行周期 */
  cloud?: boolean;
  /** 各榜单当前周期 */
  periods?: Partial<Record<RankId, CloudStatsPeriod>>;
  /** 各榜单周期加载状态 */
  periodLoading?: Partial<Record<RankId, boolean>>;
  /** 各榜单请求错误 */
  periodErrors?: Partial<Record<RankId, boolean>>;
}>();

const emit = defineEmits<{
  periodChange: [id: RankId, period: CloudStatsPeriod];
  retry: [id: RankId];
}>();

const { t, locale } = useI18n();
const libraryStore = useLibraryStore();
const contextTrack = shallowRef<Track | null>(null);
const listRefs: Partial<Record<RankId, SVirtualListExposed>> = {};
const scrolled = reactive<Record<RankId, boolean>>({ songs: false, albums: false, artists: false });
const { isLiked, toggle: toggleFavorite } = useFavorite();
const periodOptions = computed(() => [
  { key: "week" as const, label: t("stats.periodWeek") },
  { key: "month" as const, label: t("stats.periodMonth") },
  { key: "all" as const, label: t("stats.periodAll") },
]);
const {
  open: pickerOpen,
  tracks: pickerTracks,
  mode: pickerMode,
  openPicker,
} = usePlaylistPicker();
const { enqueue: enqueueDownload } = useDownload();
const { items: contextItems, handleSelect: handleContextSelect } = useTrackMenu(contextTrack, {
  canRemove: false,
  onAddToPlaylist: (track) => openPicker([track]),
  onAddToLiked: (track) => {
    if (!isLiked(track)) void toggleFavorite(track);
  },
  onDownload: (track, quality?: QualityLevel) => void enqueueDownload(track, { quality }),
});

/**
 * 设置右键菜单歌曲
 * @param track - 当前曲目
 */
const setContextTrack = (track: Track): void => {
  contextTrack.value = track;
};

/**
 * 仅允许云端歌曲和专辑行打开歌曲菜单
 * @param event - 右键事件
 * @param id - 榜单标识
 */
const guardContextMenu = (event: MouseEvent, id: RankId): void => {
  if (
    !props.cloud ||
    id === "artists" ||
    !(event.target as HTMLElement).closest("[data-stats-track]")
  ) {
    event.preventDefault();
  }
};

/** 歌曲榜：保留 track 供点击播放 */
const songItems = computed<RankItem[]>(() =>
  props.songs.map((item) => ({
    cover: item.track.cover,
    title: item.track.title,
    subtitle: item.track.artists.map((artist) => artist.name).join(" / "),
    plays: item.playCount,
    track: item.track,
  })),
);

/** 专辑榜 */
const albumItems = computed<RankItem[]>(() =>
  props.albums.map((item) => ({
    cover: item.track.album?.cover ?? item.track.cover,
    title: item.track.album?.name ?? "",
    subtitle: item.track.artists.map((artist) => artist.name).join(" / "),
    plays: item.playCount,
    track: item.track,
  })),
);

/** 歌手榜 */
const artistItems = computed<RankItem[]>(() =>
  props.artists.map((item) => ({
    cover:
      item.track.source === "local"
        ? (libraryStore.getArtistAvatar(item.artist.name) ?? item.artist.avatar ?? item.track.cover)
        : (item.artist.avatar ?? item.track.cover),
    title: item.artist.name,
    plays: item.playCount,
    track: item.track,
    artistId: item.artist.id,
  })),
);

/** 三类榜单配置 */
const sections = computed<RankSection[]>(() => [
  {
    id: "songs",
    title: t("stats.topSongs"),
    icon: IconLucideMusic,
    circle: false,
    items: songItems.value,
    onClick: (item) => playSong(item.track),
  },
  {
    id: "albums",
    title: t("stats.topAlbums"),
    icon: IconLucideDisc3,
    circle: false,
    items: albumItems.value,
    onClick: (item) =>
      navigateToAlbum(item.title, {
        source: item.track.source,
        serverId: item.track.serverId,
        albumId: item.track.album?.id,
      }),
  },
  {
    id: "artists",
    title: t("stats.topArtists"),
    icon: IconLucideUser,
    circle: true,
    items: artistItems.value,
    onClick: (item) =>
      navigateToArtist(item.title, {
        source: item.track.source,
        serverId: item.track.serverId,
        artistId: item.artistId,
      }),
  },
]);

/**
 * 立即播放榜单歌曲
 * @param track - 曲目
 */
const playSong = (track: Track): void => {
  void player.playNow(track);
};

/**
 * 保存各榜单的滚动实例
 * @param id - 榜单标识
 * @param instance - 虚拟列表实例
 */
const setListRef = (id: RankId, instance: unknown): void => {
  if (instance) {
    if (listRefs[id] === instance) return;
    listRefs[id] = instance as SVirtualListExposed;
    scrolled[id] = (listRefs[id].scrollRef?.scrollTop ?? 0) > 0;
  } else {
    delete listRefs[id];
    scrolled[id] = false;
  }
};

/**
 * 记录对应榜单是否离开顶部
 * @param id - 榜单标识
 * @param event - 列表滚动事件
 */
const onListScroll = (id: RankId, event: Event): void => {
  scrolled[id] = (event.target as HTMLElement).scrollTop > 0;
};

/**
 * 返回当前榜单顶部
 * @param id - 榜单标识
 */
const scrollToTop = (id: RankId): void => {
  listRefs[id]?.scrollTo(0, "smooth");
};

/**
 * 使用原有分段组件切换周期并重置对应列表
 * @param id - 榜单标识
 * @param period - 目标周期
 */
const changePeriod = (id: RankId, period: string): void => {
  if (props.periods?.[id] === period) return;
  listRefs[id]?.scrollTo(0);
  scrolled[id] = false;
  emit("periodChange", id, period as CloudStatsPeriod);
};
</script>

<template>
  <div
    class="grid gap-5"
    :class="
      cloud
        ? 'min-h-0 flex-1 grid-cols-3 grid-rows-[minmax(0,1fr)]'
        : 'grid-cols-1 items-start md:grid-cols-2 xl:grid-cols-3'
    "
  >
    <SContextMenu
      v-for="section in sections"
      :key="section.id"
      :items="contextItems"
      @select="handleContextSelect"
    >
      <SCard
        radius="xl"
        size="small"
        class="min-w-0 overflow-hidden [&>div:first-child]:py-3 [&>div:last-child]:pb-3"
        :class="
          cloud &&
          'flex min-h-0 flex-col [&>div:first-child]:shrink-0 [&>div:last-child]:min-h-0 [&>div:last-child]:flex-1'
        "
        @contextmenu.capture="guardContextMenu($event, section.id)"
      >
        <template #header>
          <div class="flex min-w-0 flex-wrap items-center gap-3">
            <div
              class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary"
            >
              <component :is="section.icon" class="size-5" />
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="truncate text-base font-semibold text-on-surface">
                {{ section.title }}
              </h3>
              <p class="text-xs font-semibold text-on-surface-variant/45">
                TOP {{ loading ? "--" : section.items.length }}
              </p>
            </div>
            <div
              v-if="cloud"
              class="stats-period-tabs ml-auto shrink-0"
              :class="locale === 'zh-CN' ? 'w-[108px]' : 'w-[144px]'"
            >
              <STabs
                :model-value="periods?.[section.id] ?? 'week'"
                :tabs="periodOptions"
                type="segment"
                size="small"
                round
                @update:model-value="changePeriod(section.id, $event)"
              />
            </div>
          </div>
        </template>

        <div
          v-if="loading || periodLoading?.[section.id]"
          class="flex items-center justify-center"
          :class="cloud ? 'h-full min-h-0' : 'min-h-56'"
        >
          <SLoading class="size-6 text-primary/60" />
        </div>

        <div
          v-else-if="periodErrors?.[section.id]"
          role="alert"
          class="flex flex-col items-center justify-center gap-3 text-sm text-on-surface-variant/60"
          :class="cloud ? 'h-full min-h-0' : 'min-h-56'"
        >
          <span>{{ t("stats.chartFailed") }}</span>
          <SButton size="small" variant="tertiary" @click="emit('retry', section.id)">
            {{ t("common.retry") }}
          </SButton>
        </div>
        <div v-else-if="section.items.length > 0" :class="cloud && 'h-full min-h-0'">
          <div v-if="cloud" class="relative h-full min-h-0">
            <SVirtualList
              :key="periods?.[section.id] ?? 'week'"
              :ref="(instance) => setListRef(section.id, instance)"
              :items="section.items"
              height="100%"
              :item-height="56"
              :buffer-size="2"
              :padding-bottom="64"
              hide-scrollbar
              @scroll="onListScroll(section.id, $event)"
            >
              <template #default="{ item, index }">
                <div :class="index === 0 ? (section.items.length > 1 ? 'h-28' : 'h-26') : 'h-14'">
                  <StatsRankRow
                    :item="item"
                    :index="index"
                    :circle="section.circle"
                    @click="section.onClick(item)"
                    @contextmenu="setContextTrack(item.track)"
                  />
                </div>
              </template>
            </SVirtualList>
            <Transition name="fade">
              <div
                v-if="scrolled[section.id]"
                class="absolute inset-x-0 bottom-3 z-10 flex justify-center pointer-events-none"
              >
                <div
                  class="pointer-events-auto rounded-full bg-surface-panel backdrop-blur-2xl backdrop-saturate-150 shadow-lg border border-solid border-primary/10"
                >
                  <STooltip :content="t('messages.backToTop')">
                    <SButton
                      circle
                      :size="40"
                      type="primary"
                      variant="bordered"
                      :aria-label="t('messages.backToTop')"
                      @click="scrollToTop(section.id)"
                    >
                      <template #icon><IconLucideArrowUp class="size-4.5" /></template>
                    </SButton>
                  </STooltip>
                </div>
              </div>
            </Transition>
          </div>
          <template v-else>
            <StatsRankRow
              v-for="(item, index) in section.items.slice(0, 10)"
              :key="index"
              :item="item"
              :index="index"
              :circle="section.circle"
              :class="index === 0 && section.items.length > 1 ? 'mb-2' : ''"
              @click="section.onClick(item)"
            />
          </template>
        </div>
        <div
          v-else
          class="flex flex-col items-center justify-center gap-2 rounded-2xl bg-on-surface/3 text-on-surface-variant/40"
          :class="cloud ? 'h-full min-h-0' : 'min-h-56'"
        >
          <component :is="section.icon" class="size-7" />
          <span class="text-sm">{{ t(cloud ? "stats.notReported" : "stats.noData") }}</span>
        </div>
      </SCard>
    </SContextMenu>
  </div>
  <PlaylistPickerDialog v-model:open="pickerOpen" :mode="pickerMode" :tracks="pickerTracks" />
</template>

<style scoped>
.stats-period-tabs :deep([role="tab"]) {
  min-width: 0;
  padding-inline: 4px;
}
</style>
