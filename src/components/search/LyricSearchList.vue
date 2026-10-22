<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { LyricSearchItem } from "@/types/search";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { useDownload } from "@/composables/useDownload";
import { useFavorite } from "@/composables/useFavorite";
import { usePlaylistPicker } from "@/composables/usePlaylistPicker";
import { useTrackMenu } from "@/composables/useTrackMenu";
import { useCopyText } from "@/composables/useCopyText";
import { formatTime } from "@/utils/time";
import { navigateToAlbum, navigateToArtist } from "@/utils/navigate";
import * as player from "@/core/player";
import IconFavorite from "~icons/material-symbols/favorite-rounded";
import IconFavoriteOutline from "~icons/material-symbols/favorite-outline-rounded";

interface DisplayLyricSearchItem extends LyricSearchItem {
  lyricText: string;
  expandable: boolean;
  expanded: boolean;
}

const props = defineProps<{
  items: LyricSearchItem[];
  hasMore: boolean;
  loadingMore: boolean;
}>();

const emit = defineEmits<{
  reachBottom: [];
}>();

const { t } = useI18n();
const media = useMediaStore();
const settings = useSettingsStore();
const status = useStatusStore();
const fav = useFavorite();
const { copy } = useCopyText();
const tracks = computed(() => props.items.map(({ track }) => track));
const expandedTrackIds = ref<ReadonlySet<string>>(new Set());
const contextTrack = shallowRef<Track>();

const lyricItems = computed<DisplayLyricSearchItem[]>(() =>
  props.items.map((item) => {
    const lyricText = item.lyrics.join("\n");
    const lineCount = lyricText.split(/\r?\n/).filter((line) => line.trim()).length;
    const expandable = lineCount > 3;
    return {
      ...item,
      lyricText,
      expandable,
      expanded: expandable && expandedTrackIds.value.has(item.track.id),
    };
  }),
);

watch(
  () => props.items.map(({ track }) => track.id),
  (trackIds) => {
    const retained = new Set(trackIds);
    const next = new Set([...expandedTrackIds.value].filter((id) => retained.has(id)));
    if (next.size !== expandedTrackIds.value.size) expandedTrackIds.value = next;
  },
);

/** 按单曲播放列表行为设置播放歌词搜索结果 */
const playTrack = (index: number): void => {
  const track = props.items[index]?.track;
  if (!track) return;
  if (settings.player.singleTrackQueueMode === "replace") {
    void player.playFrom(tracks.value, { startIndex: index });
    return;
  }
  void player.playNow(track);
};

/** 展开或收起指定歌曲的歌词 */
const toggleExpanded = (trackId: string): void => {
  const next = new Set(expandedTrackIds.value);
  if (next.has(trackId)) next.delete(trackId);
  else next.add(trackId);
  expandedTrackIds.value = next;
};

const {
  open: pickerOpen,
  tracks: pickerTracks,
  mode: pickerMode,
  openPicker,
} = usePlaylistPicker();
const { enqueue: enqueueDownload } = useDownload();
const { items: contextMenuItems, handleSelect: onContextMenu } = useTrackMenu(contextTrack, {
  onPlay: (track) => {
    const index = props.items.findIndex((item) => item.track.id === track.id);
    if (index >= 0) playTrack(index);
  },
  onAddToPlaylist: (track) => openPicker([track]),
  onDownload: (track, quality) => void enqueueDownload(track, { quality }),
});

/** 阻止在歌曲卡片外呼出上一首歌曲的菜单 */
const onListContextMenu = (event: MouseEvent): void => {
  const target = event.target as HTMLElement | null;
  if (target?.closest("[data-lyric-search-item]")) return;
  event.preventDefault();
  event.stopPropagation();
};
</script>

<template>
  <div class="relative h-full" @contextmenu.capture="onListContextMenu">
    <SContextMenu :items="contextMenuItems" @select="onContextMenu">
      <template #header>
        <div v-if="contextTrack" class="flex items-center gap-1.5 px-1 py-1">
          <SImg :src="contextTrack.cover" class="size-9 shrink-0 rounded-md" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-xs font-medium">{{ contextTrack.title }}</div>
            <div class="truncate text-[11px] text-on-surface-variant/60">
              {{ contextTrack.artists.map((artist) => artist.name).join(" / ") }}
            </div>
          </div>
        </div>
      </template>

      <SVirtualList
        :items="lyricItems"
        :item-height="148"
        :padding-top="8"
        :padding-bottom="80"
        :get-item-key="(item: DisplayLyricSearchItem) => item.track.id"
        height="100%"
        @reach-bottom="emit('reachBottom')"
      >
        <template #default="{ item, index }: { item: DisplayLyricSearchItem; index: number }">
          <div class="px-5 pb-3">
            <div
              data-lyric-search-item
              class="group flex min-h-34 cursor-pointer items-start gap-3 rounded-xl border-2 border-solid px-4 py-3 transition-[background-color,border-color] duration-200"
              :class="
                media.track?.id === item.track.id
                  ? 'border-primary/40 bg-primary/16'
                  : 'border-primary/12 bg-surface-panel hover:border-primary/30 hover:bg-on-surface/8'
              "
              @dblclick="playTrack(index)"
              @contextmenu="contextTrack = item.track"
            >
              <button
                type="button"
                class="relative mt-0.5 size-12 shrink-0 cursor-pointer overflow-hidden rounded-lg border-0 bg-on-surface/8 p-0"
                :title="t('resourceMenu.play')"
                @click.stop="
                  media.track?.id === item.track.id ? player.togglePlay() : playTrack(index)
                "
              >
                <SImg :src="item.track.cover" class="size-full" />
                <span
                  class="absolute inset-0 flex items-center justify-center bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <IconLucidePause
                    v-if="media.track?.id === item.track.id && status.isPlaying"
                    class="size-5"
                  />
                  <IconLucidePlay v-else class="size-5" />
                </span>
              </button>

              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-start justify-between gap-3">
                  <div class="flex min-w-0 flex-1 items-baseline gap-2">
                    <span
                      class="max-w-[42%] shrink-0 truncate text-sm font-semibold"
                      :class="
                        media.track?.id === item.track.id ? 'text-primary' : 'text-on-surface'
                      "
                    >
                      {{ item.track.title }}
                    </span>
                    <span class="truncate text-xs text-on-surface-variant/55">
                      <template
                        v-for="(artist, artistIndex) in item.track.artists"
                        :key="artist.id"
                      >
                        <button
                          type="button"
                          class="cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-primary"
                          @click.stop="
                            navigateToArtist(artist.name, {
                              source: item.track.source,
                              artistId: artist.id,
                            })
                          "
                        >
                          {{ artist.name }}
                        </button>
                        <span v-if="artistIndex < item.track.artists.length - 1">/</span>
                      </template>
                      <span v-if="item.track.album?.name">·</span>
                      <button
                        v-if="item.track.album?.name"
                        type="button"
                        class="cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-primary"
                        @click.stop="
                          navigateToAlbum(item.track.album.name, {
                            source: item.track.source,
                            albumId: item.track.album.id,
                          })
                        "
                      >
                        {{ item.track.album.name }}
                      </button>
                    </span>
                  </div>

                  <div
                    class="flex shrink-0 items-center gap-1 text-on-surface-variant/55"
                    @dblclick.stop
                  >
                    <SButton
                      type="primary"
                      variant="text"
                      circle
                      :size="28"
                      :icon-size="19"
                      :title="
                        t(
                          fav.isLiked(item.track)
                            ? 'search.lyricActions.removeFromLiked'
                            : 'search.lyricActions.addToLiked',
                        )
                      "
                      @click.stop="fav.toggle(item.track)"
                    >
                      <template #icon>
                        <SIconSwap :active="fav.isLiked(item.track)">
                          <template #on><IconFavorite /></template>
                          <template #off><IconFavoriteOutline /></template>
                        </SIconSwap>
                      </template>
                    </SButton>
                    <span
                      class="w-12 text-right text-xs tabular-nums"
                      :title="t('songList.duration')"
                    >
                      {{ formatTime(item.track.duration) }}
                    </span>
                  </div>
                </div>

                <div
                  class="mt-1.5 whitespace-pre-line text-sm leading-5 text-on-surface-variant/75"
                  :class="item.expanded ? '' : 'line-clamp-3'"
                >
                  {{ item.lyricText }}
                </div>

                <div class="mt-1 flex min-h-7 items-center justify-end gap-1" @dblclick.stop>
                  <SButton
                    v-if="item.expandable"
                    variant="text"
                    size="small"
                    @click.stop="toggleExpanded(item.track.id)"
                  >
                    <template #icon>
                      <IconLucideChevronUp v-if="item.expanded" class="size-3.5" />
                      <IconLucideChevronDown v-else class="size-3.5" />
                    </template>
                    {{
                      t(
                        item.expanded
                          ? "search.lyricActions.collapse"
                          : "search.lyricActions.expand",
                      )
                    }}
                  </SButton>
                  <SButton variant="text" size="small" @click.stop="copy(item.lyricText)">
                    <template #icon><IconLucideCopy class="size-3.5" /></template>
                    {{ t("search.lyricActions.copy") }}
                  </SButton>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template #footer>
          <div
            v-if="loadingMore"
            class="flex items-center justify-center gap-2 py-4 text-xs text-on-surface-variant/45"
          >
            <SLoading />
            {{ t("common.loading") }}
          </div>
        </template>
      </SVirtualList>
    </SContextMenu>

    <PlaylistPickerDialog v-model:open="pickerOpen" :mode="pickerMode" :tracks="pickerTracks" />
  </div>
</template>
