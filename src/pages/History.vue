<script setup lang="ts">
import type { Album, PlaybackContext, Playlist, Track } from "@shared/types/player";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import type { CoverItem } from "@/types/artist";
import type { Podcast } from "@/types/podcast";
import type { NeteaseRecentKind } from "@/apis/history/netease";
import { useHistoryStore } from "@/stores/history";
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";
import { useResourceCardMenu, type ResourceCardType } from "@/composables/useResourceCardMenu";
import { navigateToAlbum, navigateToPlaylist, navigateToPodcast } from "@/utils/navigate";
import SongList from "@/components/list/SongList.vue";
import CoverList from "@/components/list/CoverList.vue";
import CoverBatchToolbar from "@/components/list/CoverBatchToolbar.vue";
import * as player from "@/core/player";
import IconLucideListChecks from "~icons/lucide/list-checks";

type HistoryTab = NeteaseRecentKind | "local";

const HISTORY_TABS: readonly HistoryTab[] = [
  "song",
  "voice",
  "playlist",
  "album",
  "podcast",
  "local",
];

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const history = useHistoryStore();
const user = useUserStore();
const songListRef = shallowRef<InstanceType<typeof SongList> | null>(null);
const searchQuery = ref("");

const activeTab = computed<HistoryTab>(() => {
  const tab = route.query.tab;
  return typeof tab === "string" && (HISTORY_TABS as readonly string[]).includes(tab)
    ? (tab as HistoryTab)
    : "song";
});

const tabs = computed(() => HISTORY_TABS.map((key) => ({ key, label: t(`history.tabs.${key}`) })));

const remoteKind = computed<NeteaseRecentKind | null>(() =>
  activeTab.value === "local" ? null : activeTab.value,
);

const localTracks = computed(() =>
  history.entries.filter((entry) => entry.track.source === "local").map((entry) => entry.track),
);

const currentTracks = computed<Track[]>(() => {
  if (activeTab.value === "song") return history.recentSongs.map((entry) => entry.item);
  if (activeTab.value === "voice") return history.recentVoices.map((entry) => entry.item);
  if (activeTab.value === "local") return localTracks.value;
  return [];
});

const currentResourceEntries = computed(() => {
  if (activeTab.value === "playlist") return history.recentPlaylists;
  if (activeTab.value === "album") return history.recentAlbums;
  if (activeTab.value === "podcast") return history.recentPodcasts;
  return [];
});

const toCoverItem = (item: Playlist | Album | Podcast): CoverItem => {
  if ("programCount" in item) {
    return {
      id: item.id,
      title: item.name,
      cover: item.cover,
      subtitle: item.creator ?? "",
      trackCount: item.programCount,
    };
  }
  return {
    id: item.id ?? "",
    title: item.name,
    cover: item.cover,
    subtitle: "owner" in item ? (item.owner ?? "") : "artist" in item ? (item.artist ?? "") : "",
    trackCount: item.trackCount ?? 0,
  };
};

const resourceItems = computed<CoverItem[]>(() =>
  currentResourceEntries.value.map((entry) => toCoverItem(entry.item)),
);
const resourceType = computed<ResourceCardType>(() => {
  if (activeTab.value === "playlist") return "playlist";
  if (activeTab.value === "album") return "album";
  return "radio";
});
const resourceMenu = useResourceCardMenu(resourceType);

const filteredResourceItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return resourceItems.value;
  return resourceItems.value.filter(
    (item) =>
      item.title.toLowerCase().includes(query) || item.subtitle?.toLowerCase().includes(query),
  );
});

const currentCount = computed(() =>
  currentTracks.value.length > 0 ? currentTracks.value.length : resourceItems.value.length,
);
const isTrackTab = computed(
  () => activeTab.value === "song" || activeTab.value === "voice" || activeTab.value === "local",
);
const canPlayAll = computed(() => isTrackTab.value && currentTracks.value.length > 0);
const playbackContext = computed<PlaybackContext>(() => ({
  originId: "history",
  originType: "page",
  originName: t("history.title"),
}));
const loading = computed(
  () =>
    remoteKind.value !== null &&
    history.remoteLoading === remoteKind.value &&
    !history.remoteLoaded[remoteKind.value],
);
const loadError = computed(() =>
  remoteKind.value === null ? "" : history.remoteErrors[remoteKind.value],
);

const resourceBatchActive = ref(false);
const resourceSelectedIds = ref<Set<string>>(new Set());
const resourceRemoveOpen = ref(false);
const resourceRemoving = ref(false);

const exitResourceBatch = (): void => {
  resourceBatchActive.value = false;
  resourceSelectedIds.value = new Set();
};

const onTabSwitch = (key: string): void => {
  searchQuery.value = "";
  exitResourceBatch();
  router.replace({ query: { ...route.query, tab: key } });
};

const loadActive = async (force = false): Promise<void> => {
  const kind = remoteKind.value;
  if (!kind || !user.isLoggedIn) return;
  try {
    await history.loadRemote(kind, force);
  } catch {
    // 错误状态由 store 保留并在当前页展示
  }
};

watch(
  [activeTab, () => user.isLoggedIn],
  () => {
    exitResourceBatch();
    void loadActive(true);
  },
  { immediate: true },
);

/** 从当前历史分类开始播放，并保留页面来源 */
const handlePlayAll = (): void => {
  if (currentTracks.value.length > 0) {
    void player.playFrom(currentTracks.value, { context: playbackContext.value });
  }
};

const resolveRemoteTrackIds = (tracks: Track[]): string[] => {
  const selected = new Set(tracks.map((track) => track.id));
  const entries = activeTab.value === "voice" ? history.recentVoices : history.recentSongs;
  return entries.filter((entry) => selected.has(entry.item.id)).map((entry) => entry.resourceId);
};

const handleTrackRemove = async (tracks: Track[]): Promise<void> => {
  if (activeTab.value === "local") {
    history.removeLocal(tracks);
    return;
  }
  const kind = remoteKind.value;
  if (!kind) return;
  await history.removeRemote(kind, resolveRemoteTrackIds(tracks));
};

const toggleResourceSelection = (item: CoverItem): void => {
  const next = new Set(resourceSelectedIds.value);
  if (next.has(item.id)) next.delete(item.id);
  else next.add(item.id);
  resourceSelectedIds.value = next;
};

const toggleAllResources = (): void => {
  const ids = filteredResourceItems.value.map((item) => item.id);
  const allSelected = ids.length > 0 && ids.every((id) => resourceSelectedIds.value.has(id));
  resourceSelectedIds.value = allSelected ? new Set() : new Set(ids);
};

const invertResourceSelection = (): void => {
  resourceSelectedIds.value = new Set(
    filteredResourceItems.value
      .filter((item) => !resourceSelectedIds.value.has(item.id))
      .map((item) => item.id),
  );
};

const requestResourceRemove = (): void => {
  if (resourceSelectedIds.value.size > 0) resourceRemoveOpen.value = true;
};

const confirmResourceRemove = async (): Promise<void> => {
  const kind = remoteKind.value;
  if (!kind || resourceRemoving.value) return;
  resourceRemoving.value = true;
  try {
    const selected = resourceSelectedIds.value;
    const resourceIds = currentResourceEntries.value
      .filter((entry) => selected.has(String(entry.item.id)))
      .map((entry) => entry.resourceId);
    await history.removeRemote(kind, resourceIds);
    resourceRemoveOpen.value = false;
    exitResourceBatch();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    resourceRemoving.value = false;
  }
};

const openResource = (item: CoverItem): void => {
  if (activeTab.value === "playlist") {
    navigateToPlaylist(item.id, { source: "netease", name: item.title });
  } else if (activeTab.value === "album") {
    navigateToAlbum(item.title, { source: "netease", albumId: item.id });
  } else if (activeTab.value === "podcast") {
    navigateToPodcast(item.id, item.title);
  }
};

const enterBatch = (): void => {
  if (isTrackTab.value) songListRef.value?.enterBatch();
  else {
    resourceBatchActive.value = true;
    resourceSelectedIds.value = new Set();
  }
};

const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  {
    key: "batchManage",
    label: t("songList.batch.manage"),
    icon: markRaw(IconLucideListChecks),
  },
]);

onMounted(() => {
  void history.load();
});
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="shrink-0 px-5 pb-2">
      <div class="mt-2 mb-4 flex items-baseline gap-4">
        <h1 class="text-3xl font-bold text-on-surface text-balance">{{ t("history.title") }}</h1>
        <span
          v-if="currentCount > 0"
          class="flex items-center gap-1 text-sm text-on-surface-variant/50"
        >
          <IconLucideHistory class="size-3.5" />
          {{ t("history.total", { count: currentCount }) }}
        </span>
      </div>
      <div class="flex items-center justify-between gap-4">
        <STabs :model-value="activeTab" :tabs="tabs" @update:model-value="onTabSwitch" />
        <div class="flex items-center gap-2">
          <SButton
            v-if="isTrackTab"
            type="primary"
            variant="secondary"
            round
            :disabled="!canPlayAll"
            @click="handlePlayAll"
          >
            <template #icon><IconLucidePlay /></template>
            {{ t("common.playAll") }}
          </SButton>
          <SDropdownMenu
            v-if="currentCount > 0"
            :items="moreMenuItems"
            align="end"
            @select="enterBatch"
          >
            <template #trigger>
              <SButton variant="secondary" circle>
                <template #icon><IconLucideEllipsis /></template>
              </SButton>
            </template>
          </SDropdownMenu>
          <SInput
            v-model="searchQuery"
            :placeholder="t('common.search')"
            clearable
            round
            class="w-36 focus-within:w-48"
            data-search-input
          >
            <template #prefix>
              <IconLucideSearch class="size-4 shrink-0 text-on-surface-variant/40" />
            </template>
          </SInput>
        </div>
      </div>
    </div>

    <div
      v-if="activeTab !== 'local' && !user.isLoggedIn"
      class="flex flex-1 items-center justify-center"
    >
      <div class="text-center text-on-surface-variant/50">
        <IconLucideHistory class="mx-auto mb-3 size-12 opacity-30" />
        <div class="text-sm">{{ t("history.loginRequired") }}</div>
      </div>
    </div>
    <div v-else-if="loading" class="flex flex-1 items-center justify-center">
      <SLoading class="size-9 text-primary/70" />
    </div>
    <div v-else-if="loadError" class="flex flex-1 items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <div class="mb-3 text-sm">{{ loadError }}</div>
        <SButton variant="secondary" round @click="loadActive(true)">
          {{ t("common.retry") }}
        </SButton>
      </div>
    </div>
    <div v-else-if="isTrackTab && currentTracks.length > 0" class="min-h-0 flex-1">
      <SongList
        :key="activeTab"
        ref="songListRef"
        :items="currentTracks"
        :search-query="searchQuery"
        :show-size="activeTab === 'local'"
        :show-favorite="activeTab !== 'voice'"
        :related-collection-type="activeTab === 'voice' ? 'radio' : 'album'"
        :source="activeTab === 'local' ? 'local' : 'netease'"
        :playback-context="playbackContext"
        :batch-remove="handleTrackRemove"
        :batch-remove-label="t('history.remove')"
        sort-key="history"
        enable-sort
      />
    </div>
    <div v-else-if="!isTrackTab && resourceItems.length > 0" class="flex min-h-0 flex-1 flex-col">
      <CoverBatchToolbar
        v-if="resourceBatchActive"
        :selected-count="resourceSelectedIds.size"
        :all-selected="
          filteredResourceItems.length > 0 &&
          filteredResourceItems.every((item) => resourceSelectedIds.has(item.id))
        "
        :indeterminate="
          resourceSelectedIds.size > 0 &&
          !filteredResourceItems.every((item) => resourceSelectedIds.has(item.id))
        "
        :remove-label="t('history.remove')"
        :download-label="t('resourceMenu.downloadAll')"
        :removing="resourceRemoving"
        :downloading="resourceMenu.downloading.value"
        :download-disabled="resourceMenu.downloadDisabled.value"
        @toggle-all="toggleAllResources"
        @invert="invertResourceSelection"
        @download="
          resourceMenu.downloadResources(
            filteredResourceItems.filter((item) => resourceSelectedIds.has(item.id)),
          )
        "
        @remove="requestResourceRemove"
        @exit="exitResourceBatch"
      />
      <div class="min-h-0 flex-1">
        <CoverList
          :items="filteredResourceItems"
          :padding-x="20"
          :padding-top="8"
          :selection-mode="resourceBatchActive"
          :selected-ids="resourceSelectedIds"
          shrink-on-sidebar-hover
          @click="openResource"
          @toggle-selection="toggleResourceSelection"
        />
      </div>
    </div>
    <div v-else class="flex flex-1 items-center justify-center">
      <div class="text-center text-on-surface-variant/50">
        <IconLucideHistory class="mx-auto mb-3 size-12 opacity-30" />
        <div class="text-sm">{{ t("history.empty") }}</div>
      </div>
    </div>

    <SDialog v-model:open="resourceRemoveOpen" :title="t('history.removeTitle')">
      {{ t("history.removeConfirm", { count: resourceSelectedIds.size }) }}
      <template #footer="{ close }">
        <SButton variant="secondary" :disabled="resourceRemoving" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton
          type="error"
          variant="secondary"
          :loading="resourceRemoving"
          @click="confirmResourceRemove"
        >
          {{ t("history.remove") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
