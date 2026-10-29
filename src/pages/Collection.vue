<script setup lang="ts">
import type { PlaybackContext, Track, TrackSource } from "@shared/types/player";
import type { CollectionCommentTarget } from "@shared/types/comment";
import type { Collection, CollectionType } from "@/types/collection";
import type { SongListSortKey } from "@/types/list";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { loadCollection as loadCollectionService } from "@/services/collection";
import { fetchPodcastPrograms, searchPodcastPrograms } from "@/apis/podcast/netease";
import { useCollectionSubscribe } from "@/composables/collection/useCollectionSubscribe";
import { usePlaylistManage } from "@/composables/collection/usePlaylistManage";
import { useCopyText } from "@/composables/useCopyText";
import { toast } from "@/composables/useToast";
import { useStatusStore } from "@/stores/status";
import { usePlaylistStore } from "@/stores/playlist";
import { useUserStore } from "@/stores/user";
import { reorderVisibleIds } from "@shared/utils/reorder";
import { reorderPlaylistTracks } from "@/apis/playlist/netease";
import SongList from "@/components/list/SongList.vue";
import { formatTime } from "@/utils/time";
import { getCollectionShareUrl } from "@/utils/format/shareUrl";
import { coverTransitionActive, getCoverPreview } from "@/services/coverTransition";
import * as player from "@/core/player";
import IconLucidePencil from "~icons/lucide/pencil";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideListChecks from "~icons/lucide/list-checks";
import IconLucideListMusic from "~icons/lucide/list-music";
import IconLucideHourglass from "~icons/lucide/hourglass";
import IconLucideCalendar from "~icons/lucide/calendar";
import IconLucideUser from "~icons/lucide/user";
import IconLucideHardDrive from "~icons/lucide/hard-drive";
import IconLucideGlobe2 from "~icons/lucide/globe-2";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideRadio from "~icons/lucide/radio";
import IconLucideCloud from "~icons/lucide/cloud";
import IconLucideMessageCircle from "~icons/lucide/message-circle";
import IconLucideShare2 from "~icons/lucide/share-2";
import IconMoreHorizontal from "~icons/lucide/more-horizontal";
import IconCopy from "~icons/lucide/copy";
import IconMaterialSymbolsFavoriteRounded from "~icons/material-symbols/favorite-rounded";
import IconMaterialSymbolsFavoriteOutlineRounded from "~icons/material-symbols/favorite-outline-rounded";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const status = useStatusStore();
const { copy } = useCopyText();

const source = route.params.source as TrackSource;
const type = route.params.type as CollectionType;
const id = route.params.id as string;

/** 按合集类型隔离排序偏好 */
const sortKey = computed<SongListSortKey>(() => `collection.${type}`);

const collection = shallowRef<Collection | null>(null);
const preview = getCoverPreview(route.fullPath);
/** 首屏头部只复用轻量摘要，不将预览数据交给播放和歌单管理逻辑 */
const header = computed(() => collection.value ?? preview);
const coverSource = computed(() =>
  coverTransitionActive.value && preview ? preview.cover : (header.value?.cover ?? preview?.cover),
);
/** 正在加载 */
const loading = ref(false);
const reordering = ref(false);
const playlistStore = usePlaylistStore();
const userStore = useUserStore();

/**
 * 立即展示新顺序并同步歌单，失败时恢复本次变更
 * @param tracks - 拖拽后的全部可见歌曲
 */
const handleTracksReordered = async (tracks: Track[]): Promise<void> => {
  const before = collection.value;
  if (!before || loading.value || loadError.value || reordering.value || !manage.canReorder.value)
    return;
  reordering.value = true;
  try {
    const visibleIds = before.tracks.map((track) => track.id);
    const trackIds = reorderVisibleIds(
      before.trackIds ?? visibleIds,
      visibleIds,
      tracks.map((track) => track.id),
    );
    collection.value = { ...before, tracks, trackIds };
    if (before.source === "local") await playlistStore.reorderTracks(before.id, trackIds);
    else {
      await reorderPlaylistTracks(before.id, trackIds);
      if (before.id === userStore.likedPlaylistId) void userStore.ensureLikedPlaylist(true);
    }
  } catch (error) {
    if (collection.value?.tracks === tracks) {
      collection.value = { ...collection.value, tracks: before.tracks, trackIds: before.trackIds };
    }
    console.error("[collection] reorder tracks failed", error);
    toast.error(t("songList.reorder.failed"));
  } finally {
    reordering.value = false;
  }
};
const loadError = ref("");
const podcastHasMore = ref(false);
const podcastLoadingMore = ref(false);
const podcastSearchResults = shallowRef<Track[]>([]);
const podcastSearchLoading = ref(false);
const searchQuery = ref("");
let podcastSearchToken = 0;
/** 取消当次加载 */
let loadAbort: AbortController | null = null;

/** 折叠状态 */
const collapsed = ref(false);
const descriptionExpanded = ref(false);
const descriptionExpandable = ref(false);
const descriptionTextRef = shallowRef<HTMLElement | null>(null);
const descriptionButtonRef = shallowRef<HTMLButtonElement | null>(null);
const descriptionAnimating = ref(false);
let descriptionAnimations: Animation[] = [];
let descriptionAnimationId = 0;

/** 检查简介在单行状态下是否溢出 */
const measureDescription = (): void => {
  const element = descriptionTextRef.value;
  if (!element || descriptionExpanded.value) return;
  descriptionExpandable.value = element.scrollWidth > element.clientWidth + 1;
};

useResizeObserver(descriptionTextRef, measureDescription);

/** 取消简介动画并释放动画对象 */
const cancelDescriptionAnimations = (): void => {
  descriptionAnimationId += 1;
  descriptionAnimations.forEach((animation) => animation.cancel());
  descriptionAnimations = [];
  if (descriptionTextRef.value) descriptionTextRef.value.style.height = "";
  descriptionAnimating.value = false;
};

const toggleDescription = async (): Promise<void> => {
  const element = descriptionTextRef.value;
  if (!element || descriptionAnimating.value) return;
  const button = descriptionButtonRef.value;
  const animationId = ++descriptionAnimationId;
  descriptionAnimating.value = true;

  const outgoing = [
    element.animate(
      [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(2px)" },
      ],
      { duration: 100, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
    ),
  ];
  if (button) {
    outgoing.push(
      button.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 100,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "forwards",
      }),
    );
  }
  descriptionAnimations = outgoing;
  await Promise.allSettled(outgoing.map((animation) => animation.finished));
  if (animationId !== descriptionAnimationId) return;
  outgoing.forEach((animation) => animation.cancel());

  const startHeight = element.getBoundingClientRect().height;
  element.style.height = `${startHeight}px`;
  descriptionExpanded.value = !descriptionExpanded.value;
  await nextTick();
  if (animationId !== descriptionAnimationId) return;

  element.style.height = "";
  const endHeight = element.getBoundingClientRect().height;
  element.style.height = `${endHeight}px`;
  const incoming = [
    element.animate([{ height: `${startHeight}px` }, { height: `${endHeight}px` }], {
      duration: 300,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    }),
    element.animate(
      [
        { opacity: 0, transform: "translateY(2px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        duration: 200,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "both",
      },
    ),
  ];
  if (button) {
    incoming.push(
      button.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 200,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "both",
      }),
    );
  }
  descriptionAnimations = incoming;
  await Promise.allSettled(incoming.map((animation) => animation.finished));
  if (animationId !== descriptionAnimationId) return;

  descriptionAnimations.forEach((animation) => animation.cancel());
  descriptionAnimations = [];
  element.style.height = "";
  descriptionAnimating.value = false;
  if (!descriptionExpanded.value) measureDescription();
};

/** 滚动超过阈值折叠 */
const handleListScroll = (event: Event) => {
  const scrollTop = (event.target as HTMLElement).scrollTop;
  if (!collapsed.value && scrollTop > 10) {
    collapsed.value = true;
  } else if (collapsed.value && scrollTop === 0) {
    collapsed.value = false;
  }
};

/** 加载当前服务器的合集详情，并作废上一轮请求 */
const loadCollection = async (): Promise<void> => {
  collapsed.value = false;
  cancelDescriptionAnimations();
  descriptionExpanded.value = false;
  descriptionExpandable.value = false;
  loadError.value = "";
  podcastHasMore.value = false;
  podcastLoadingMore.value = false;
  podcastSearchToken += 1;
  podcastSearchResults.value = [];
  podcastSearchLoading.value = false;
  loadAbort?.abort();
  const myAbort = new AbortController();
  loadAbort = myAbort;
  loading.value = true;
  collection.value = null;

  try {
    await loadCollectionService(source, type, id, {
      serverId: typeof route.query.serverId === "string" ? route.query.serverId : undefined,
      fallbackName: typeof route.query.name === "string" ? route.query.name : undefined,
      signal: myAbort.signal,
      onUpdate: (next) => {
        if (myAbort.signal.aborted) return;
        collection.value = next;
        if (type === "radio") {
          podcastHasMore.value = Boolean(
            next && next.tracks.length < (next.trackCount ?? next.tracks.length),
          );
        }
        void nextTick(measureDescription);
      },
    });
  } catch {
    if (!myAbort.signal.aborted) loadError.value = t("collection.loadFailed");
  } finally {
    if (!myAbort.signal.aborted) loading.value = false;
  }
};

/** 触底加载下一页播客节目 */
const loadMorePodcastPrograms = async (): Promise<void> => {
  const current = collection.value;
  if (
    type !== "radio" ||
    !current ||
    searchQuery.value.trim() ||
    !podcastHasMore.value ||
    podcastLoadingMore.value
  ) {
    return;
  }
  podcastLoadingMore.value = true;
  try {
    const page = await fetchPodcastPrograms(decodeURIComponent(current.id), current.tracks.length);
    if (loadAbort?.signal.aborted || collection.value !== current) return;
    if (page.items.length === 0) {
      podcastHasMore.value = false;
      return;
    }
    const tracks = [...current.tracks, ...page.items];
    collection.value = {
      ...current,
      tracks,
      trackCount: page.total || current.trackCount,
    };
    podcastHasMore.value = page.hasMore;
  } catch {
    if (!loadAbort?.signal.aborted) toast.error(t("collection.loadFailed"));
  } finally {
    podcastLoadingMore.value = false;
  }
};

/** 使用网易云桌面端接口搜索指定播客内的声音 */
const runPodcastSearch = useDebounceFn(async (token: number, keyword: string): Promise<void> => {
  const current = collection.value;
  if (type !== "radio" || !current) return;

  try {
    const remote = await searchPodcastPrograms(decodeURIComponent(current.id), keyword);
    if (token !== podcastSearchToken || collection.value !== current) return;
    const seen = new Set(current.tracks.map((track) => track.extId ?? track.id));
    podcastSearchResults.value = [
      ...current.tracks,
      ...remote.filter((track) => {
        const key = track.extId ?? track.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    ];
  } catch {
    if (token === podcastSearchToken) podcastSearchResults.value = current.tracks;
  } finally {
    if (token === podcastSearchToken) podcastSearchLoading.value = false;
  }
}, 300);

watch(searchQuery, (value) => {
  const token = ++podcastSearchToken;
  const keyword = value.trim();
  if (type !== "radio" || !keyword) {
    podcastSearchLoading.value = false;
    podcastSearchResults.value = [];
    return;
  }
  podcastSearchResults.value = collection.value?.tracks ?? [];
  podcastSearchLoading.value = true;
  void runPodcastSearch(token, keyword);
});

/** 搜索时切换到当前播客的服务端搜索结果 */
const displayedTracks = computed(() => {
  const current = collection.value;
  if (!current) return [];
  if (type === "radio" && searchQuery.value.trim()) return podcastSearchResults.value;
  return current.tracks;
});

/**
 * 乐观过滤本地 tracks
 * @param removedIds - 已成功删除的曲目 ID 列表
 */
const handleTracksRemoved = (removedIds: string[]): void => {
  if (!collection.value || removedIds.length === 0) return;
  const removed = new Set(removedIds);
  const tracks = collection.value.tracks.filter((track) => !removed.has(track.id));
  collection.value = {
    ...collection.value,
    tracks,
    trackIds: collection.value.trackIds?.filter((trackId) => !removed.has(trackId)),
    trackCount: tracks.length,
  };
};

const typeLabel = computed(() => {
  const map: Record<CollectionType, string> = {
    album: t("collection.album"),
    playlist: t("collection.playlist"),
    radio: t("collection.radio"),
    cloud: t("cloud.title"),
  };
  return map[type] ?? "";
});

const scopeLabel = computed(() =>
  t(source === "local" ? "collection.scope.local" : "collection.scope.online"),
);

/** 总时长 */
const totalDuration = computed(() => {
  if (!collection.value) return "";
  const total = collection.value.tracks.reduce((sum, t) => sum + t.duration, 0);
  return total > 0 ? formatTime(total) : "";
});

/** 歌手文本 */
const artistText = computed(() => {
  if (!collection.value?.artists?.length) return "";
  return collection.value.artists.map((a) => a.name).join(" / ");
});

/** 创建者（歌单作者） */
const creatorText = computed(() => {
  if (collection.value?.artists?.length) return "";
  return collection.value?.creator ?? "";
});

/** 打开歌单或播客创建人的用户主页 */
const openCreator = (): void => {
  const creatorId = collection.value?.creatorId;
  if (creatorId) router.push({ name: "user-profile", params: { uid: creatorId } });
};

/** 更新时间文本 */
const updateTimeText = computed(() => {
  if (!collection.value?.updateTime) return "";
  return new Date(collection.value.updateTime).toLocaleDateString();
});

/** 集合内容数量 */
const contentCountText = computed(() => {
  const current = collection.value;
  if (!current) return "";
  const count = current.trackCount ?? current.tracks.length;
  return t(type === "radio" ? "common.totalVoices" : "common.totalSongs", { count });
});

const commentTarget = computed<CollectionCommentTarget | null>(() => {
  const current = collection.value;
  if (
    !current ||
    current.source !== "netease" ||
    (current.type !== "playlist" && current.type !== "album" && current.type !== "radio")
  ) {
    return null;
  }
  const commentId = current.type === "radio" ? current.tracks[0]?.extId : current.id;
  if (!commentId) return null;
  return {
    kind: current.type,
    id: commentId,
    title: current.title,
    source: current.source,
  };
});

const playbackContext = computed<PlaybackContext | undefined>(() => {
  const current = collection.value;
  if (!current || current.type === "cloud") return undefined;
  return {
    provider: current.source,
    originId: current.id,
    originType: current.type,
    originName: current.title,
  };
});

const shareUrl = computed(() => getCollectionShareUrl(collection.value));

const handleComments = (): void => {
  if (commentTarget.value) status.showCollectionComments(commentTarget.value);
};

const handlePlayAll = () => {
  if (!collection.value?.tracks.length) return;
  player.playFrom(collection.value.tracks, { context: playbackContext.value });
};

/** 歌曲列表引用 */
const songListRef = shallowRef<InstanceType<typeof SongList> | null>(null);

/** 收藏 / 取消收藏 */
const subscribe = useCollectionSubscribe(collection);

/** 歌单管理：编辑 + 删除 */
const manage = usePlaylistManage(collection, {
  onEdited: () => loadCollection(),
  onDeleted: () => {
    if (window.history.length > 1) router.back();
    else router.replace("/");
  },
});

/** 更多菜单 */
const editLabel = computed(() => t("collection.edit", { type: typeLabel.value }));

const moreMenuItems = computed<DropdownMenuItem[]>(() => {
  const list: DropdownMenuItem[] = [];
  if (shareUrl.value) {
    list.push({ key: "share", label: t("collection.share"), icon: IconLucideShare2 });
  }
  list.push({ key: "batchManage", label: t("songList.batch.manage"), icon: IconLucideListChecks });
  if (manage.canManage.value) {
    list.push({ key: "edit", label: editLabel.value, icon: IconLucidePencil });
    list.push({
      key: "delete",
      label: t("collection.delete", { type: typeLabel.value }),
      icon: IconLucideTrash2,
      separator: true,
    });
  }
  list.push({
    key: "more",
    label: t("collection.context.more"),
    icon: markRaw(IconMoreHorizontal),
    children: [
      {
        key: "copyTitle",
        label: t(`collection.context.${type}.copyTitle`),
        icon: markRaw(IconCopy),
      },
      {
        key: "copyId",
        label: t(`collection.context.${type}.copyId`),
        icon: markRaw(IconCopy),
        show: source !== "local",
      },
      {
        key: "copyUrl",
        label: t(`collection.context.${type}.copyUrl`),
        icon: markRaw(IconCopy),
        show: !!shareUrl.value,
      },
    ],
  });
  return list;
});

const handleMoreMenu = async (key: string): Promise<void> => {
  switch (key) {
    case "share":
      await copy(shareUrl.value);
      break;
    case "batchManage":
      songListRef.value?.enterBatch();
      break;
    case "edit":
      manage.openEdit();
      break;
    case "delete":
      manage.openDelete();
      break;
    case "copyTitle":
      await copy(collection.value?.title);
      break;
    case "copyId":
      await copy(collection.value?.id);
      break;
    case "copyUrl":
      await copy(shareUrl.value);
      break;
  }
};

watch(() => route.query.serverId, loadCollection, { immediate: true });

onBeforeUnmount(() => {
  loadAbort?.abort();
  podcastSearchToken += 1;
  cancelDescriptionAnimations();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 头部信息 -->
    <div v-if="header" class="shrink-0 px-5 pb-2">
      <div
        class="flex mt-2 transition-[gap,margin] duration-300"
        :class="collapsed ? 'gap-3' : 'gap-5'"
      >
        <!-- 封面 -->
        <DetailCover
          :src="coverSource"
          :fallback="preview?.cover"
          :alt="header.title"
          data-cover-hero
          class="rounded-xl shrink-0 transition-[width,height] duration-300"
          :class="collapsed ? 'size-20' : 'size-40'"
        />
        <!-- 信息 -->
        <div class="flex-1 flex flex-col min-w-0">
          <div
            class="flex flex-col transition-[gap] duration-300"
            :class="collapsed ? 'gap-0.5' : 'gap-2'"
          >
            <div class="flex min-w-0 items-center gap-3">
              <h1
                class="min-w-0 flex-1 font-bold text-on-surface truncate lh-normal transition-[font-size,line-height] duration-300"
                :class="collapsed ? 'text-xl' : 'text-3xl'"
              >
                {{ header.title }}
              </h1>
              <div
                class="flex shrink-0 items-center gap-1 text-primary"
                :aria-label="`${scopeLabel} · ${typeLabel}`"
              >
                <STooltip :content="scopeLabel">
                  <span class="inline-flex size-6 cursor-default items-center justify-center">
                    <IconLucideHardDrive v-if="source === 'local'" class="size-4" />
                    <IconLucideGlobe2 v-else class="size-4" />
                  </span>
                </STooltip>
                <SDivider vertical />
                <STooltip :content="typeLabel">
                  <span
                    class="inline-flex size-6 cursor-default items-center justify-center text-primary/65"
                  >
                    <IconLucideDisc3 v-if="type === 'album'" class="size-4" />
                    <IconLucideListMusic v-else-if="type === 'playlist'" class="size-4" />
                    <IconLucideRadio v-else-if="type === 'radio'" class="size-4" />
                    <IconLucideCloud v-else class="size-4" />
                  </span>
                </STooltip>
              </div>
            </div>
            <div
              class="grid transition-[grid-template-rows,opacity] duration-300"
              :class="collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'"
            >
              <div class="overflow-hidden flex flex-col gap-2">
                <!-- 歌手 -->
                <div v-if="artistText" class="text-sm text-on-surface-variant/70 truncate">
                  {{ artistText }}
                </div>
                <!-- 描述 -->
                <div class="relative min-w-0 mb-1 text-sm text-on-surface-variant/70">
                  <p
                    ref="descriptionTextRef"
                    class="min-w-0 overflow-hidden"
                    :class="
                      descriptionExpanded
                        ? 'whitespace-pre-line break-words pb-6'
                        : 'truncate pr-10'
                    "
                  >
                    {{ collection?.description || t("collection.noDescription") }}
                  </p>
                  <button
                    v-if="collection?.description && (descriptionExpandable || descriptionExpanded)"
                    ref="descriptionButtonRef"
                    type="button"
                    class="appearance-none absolute p-0 border-0 bg-transparent text-primary font-medium cursor-pointer transition-opacity duration-150 hover:opacity-70 disabled:pointer-events-none"
                    :class="descriptionExpanded ? 'right-0 bottom-0' : 'right-0 top-0'"
                    :disabled="descriptionAnimating"
                    @click="toggleDescription"
                  >
                    {{
                      t(
                        descriptionExpanded
                          ? "collection.collapseDescription"
                          : "collection.expandDescription",
                      )
                    }}
                  </button>
                </div>
                <div
                  class="flex items-center gap-3 text-sm leading-none text-on-surface-variant/50"
                >
                  <button
                    v-if="creatorText"
                    type="button"
                    class="flex min-w-0 items-center gap-1 border-0 bg-transparent p-0 text-inherit transition-colors"
                    :class="
                      collection?.creatorId ? 'cursor-pointer hover:text-primary' : 'cursor-default'
                    "
                    :disabled="!collection?.creatorId"
                    @click="openCreator"
                  >
                    <IconLucideUser class="shrink-0" />
                    <span class="truncate">{{ creatorText }}</span>
                  </button>
                  <span class="flex items-center gap-1 shrink-0">
                    <IconLucideListMusic class="shrink-0" />
                    {{ contentCountText }}
                  </span>
                  <span v-if="totalDuration" class="flex items-center gap-1 shrink-0">
                    <IconLucideHourglass class="shrink-0" />
                    {{ t("collection.totalDuration", { time: totalDuration }) }}
                  </span>
                  <span v-if="updateTimeText" class="flex items-center gap-1 shrink-0">
                    <IconLucideCalendar class="shrink-0" />
                    {{ updateTimeText }}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <!-- 操作栏 -->
          <div class="mt-auto pt-3 flex items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <SButton
                type="primary"
                variant="secondary"
                round
                :disabled="!collection?.tracks.length"
                @click="handlePlayAll"
              >
                <template #icon>
                  <IconLucidePlay />
                </template>
                {{ t("common.playAll") }}
              </SButton>
              <SButton
                v-if="subscribe.available.value"
                variant="secondary"
                round
                :disabled="subscribe.busy.value"
                @click="subscribe.toggle"
              >
                <template #icon>
                  <IconMaterialSymbolsFavoriteRounded v-if="subscribe.isSubscribed.value" />
                  <IconMaterialSymbolsFavoriteOutlineRounded v-else />
                </template>
                {{
                  t(
                    subscribe.isSubscribed.value
                      ? "collection.unsubscribe"
                      : "collection.subscribe",
                  )
                }}
              </SButton>
              <SButton v-if="commentTarget" variant="secondary" round @click="handleComments">
                <template #icon>
                  <IconLucideMessageCircle />
                </template>
                {{ t("comments.action") }}
              </SButton>
              <SDropdownMenu
                v-if="collection && moreMenuItems.length > 0"
                :items="moreMenuItems"
                align="start"
                @select="handleMoreMenu"
              >
                <template #trigger>
                  <SButton variant="secondary" circle>
                    <template #icon>
                      <IconLucideEllipsis />
                    </template>
                  </SButton>
                </template>
              </SDropdownMenu>
            </div>
            <SInput
              v-model="searchQuery"
              :placeholder="t('common.search')"
              clearable
              round
              class="w-40 focus-within:w-56"
              data-search-input
            >
              <template #prefix>
                <IconLucideSearch class="size-4 text-on-surface-variant/40 shrink-0" />
              </template>
            </SInput>
          </div>
        </div>
      </div>
    </div>
    <Transition name="fade" mode="out-in" :duration="150">
      <div
        v-if="collection && collection.tracks.length > 0"
        :key="collection.id"
        class="flex-1 min-h-0"
      >
        <SongList
          ref="songListRef"
          :items="displayedTracks"
          :search-query="searchQuery"
          :show-album="type !== 'album' && type !== 'radio'"
          :show-podcast-metadata="type === 'radio'"
          :show-favorite="type !== 'radio'"
          :show-size="source === 'local'"
          :source="source"
          :collection-type="type"
          :collection-id="id"
          :playback-context="playbackContext"
          :can-remove="manage.canManage.value && !reordering"
          :can-reorder="manage.canReorder.value && !loading && !loadError"
          :reordering="reordering"
          :has-more="type === 'radio' && !searchQuery.trim() && podcastHasMore"
          :loading-more="
            type === 'radio' && (searchQuery.trim() ? podcastSearchLoading : podcastLoadingMore)
          "
          :sort-key="sortKey"
          enable-sort
          @scroll="handleListScroll"
          @reach-bottom="loadMorePodcastPrograms"
          @change="handleTracksRemoved"
          @reorder="handleTracksReordered"
        />
      </div>
      <!-- 加载中 -->
      <div v-else-if="loading" key="loading" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="text-4xl text-primary/70 mb-4 mx-auto block" />
          <div class="text-sm">{{ t("common.loading") }}</div>
        </div>
      </div>
      <!-- 加载失败 -->
      <div v-else-if="loadError" key="error" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/60">
          <IconLucideTriangleAlert class="size-12 mx-auto mb-3 text-red-500/70" />
          <div class="text-sm mb-3">{{ loadError }}</div>
          <SButton variant="secondary" round @click="loadCollection">
            {{ t("common.retry") }}
          </SButton>
        </div>
      </div>
      <!-- 空状态 -->
      <div v-else-if="collection" key="empty" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideMusic class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">
            {{ t(type === "radio" ? "collection.emptyRadio" : "collection.empty") }}
          </div>
        </div>
      </div>
    </Transition>
    <!-- 编辑弹窗 -->
    <SDialog v-model:open="manage.editOpen.value" :title="editLabel" width="400px">
      <div class="flex flex-col gap-4">
        <SFormItem :label="t('collection.name', { type: typeLabel })">
          <SInput v-model="manage.editTitle.value" :disabled="manage.submitting.value" />
        </SFormItem>
        <SFormItem :label="t('collection.description', { type: typeLabel })">
          <SInput v-model="manage.editDescription.value" :disabled="manage.submitting.value" />
        </SFormItem>
      </div>
      <template #footer="{ close }">
        <SButton variant="secondary" :disabled="manage.submitting.value" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton
          type="primary"
          :disabled="!manage.editTitle.value.trim()"
          :loading="manage.submitting.value"
          @click="manage.saveEdit"
        >
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
    <!-- 删除确认 -->
    <SDialog
      v-model:open="manage.deleteOpen.value"
      :title="t('collection.delete', { type: typeLabel })"
    >
      <p class="text-sm text-on-surface-variant">
        {{ t("collection.deleteConfirm", { type: typeLabel, title: collection?.title ?? "" }) }}
      </p>
      <template #footer="{ close }">
        <SButton variant="secondary" :disabled="manage.deleting.value" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton type="error" :loading="manage.deleting.value" @click="manage.confirmDelete">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
