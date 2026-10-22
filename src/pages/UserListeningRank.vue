<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { UserListeningRankPeriod } from "@/apis/user-profile/netease";
import { fetchUserListeningRank } from "@/apis/user-profile/netease";
import { useUserStore } from "@/stores/user";
import SongList from "@/components/list/SongList.vue";
import * as player from "@/core/player";

const { t } = useI18n();
const route = useRoute();
const user = useUserStore();
const period = ref<UserListeningRankPeriod>("week");
const weekTracks = shallowRef<Track[]>([]);
const allTracks = shallowRef<Track[]>([]);
const weekLoaded = ref(false);
const allLoaded = ref(false);
const loading = ref(false);
const error = ref("");
let requestToken = 0;

const uid = computed(() => Number(route.params.uid) || 0);
const own = computed(() => uid.value === user.profile?.userId);
const tabs = computed(() => [
  { key: "week", label: t("userProfile.listening.week") },
  { key: "all", label: t("userProfile.listening.all") },
]);
const currentTracks = computed(() =>
  period.value === "week" ? weekTracks.value : allTracks.value,
);
const currentLoaded = computed(() =>
  period.value === "week" ? weekLoaded.value : allLoaded.value,
);

/** 获取当前时间范围的听歌排行 */
const load = async (force = false): Promise<void> => {
  if (!own.value || !uid.value || (currentLoaded.value && !force)) return;
  const selectedPeriod = period.value;
  const token = ++requestToken;
  loading.value = true;
  error.value = "";
  try {
    const tracks = await fetchUserListeningRank(uid.value, selectedPeriod);
    if (token !== requestToken) return;
    if (selectedPeriod === "week") {
      weekTracks.value = tracks;
      weekLoaded.value = true;
    } else {
      allTracks.value = tracks;
      allLoaded.value = true;
    }
  } catch (cause) {
    if (token === requestToken) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    if (token === requestToken) loading.value = false;
  }
};

watch(period, () => void load());

watch(
  () => [uid.value, user.profile?.userId] as const,
  () => {
    requestToken += 1;
    weekTracks.value = [];
    allTracks.value = [];
    weekLoaded.value = false;
    allLoaded.value = false;
    error.value = "";
    void load();
  },
  { immediate: true },
);

const playAll = (): void => {
  if (currentTracks.value.length) player.playFrom(currentTracks.value);
};
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="shrink-0 px-5 pb-2">
      <div class="mb-4 mt-2 flex items-baseline gap-4">
        <h1 class="text-balance text-3xl font-bold text-on-surface">
          {{ t("userProfile.listening.title") }}
        </h1>
        <span
          v-if="currentTracks.length"
          class="flex items-center gap-1 text-sm text-on-surface-variant/50"
        >
          <IconLucideMusic class="size-3.5" />
          {{ t("common.totalSongs", { count: currentTracks.length }) }}
        </span>
      </div>
      <div class="flex items-center justify-between gap-4">
        <STabs v-model="period" :tabs="tabs" type="bar" size="large" />
        <SButton
          type="primary"
          variant="secondary"
          round
          :disabled="currentTracks.length === 0"
          @click="playAll"
        >
          <template #icon><IconLucidePlay /></template>
          {{ t("common.playAll") }}
        </SButton>
      </div>
    </div>

    <div v-if="!own" class="flex flex-1 items-center justify-center">
      <div class="text-sm text-on-surface-variant/55">
        {{ t("userProfile.listening.ownOnly") }}
      </div>
    </div>
    <div v-else-if="loading && !currentLoaded" class="flex flex-1 items-center justify-center">
      <SLoading />
    </div>
    <div
      v-else-if="error"
      class="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-on-surface-variant"
    >
      <IconLucideTriangleAlert class="size-12 opacity-35" />
      <span>{{ t("userProfile.listening.loadFailed") }}</span>
      <SButton variant="secondary" @click="load(true)">{{ t("common.retry") }}</SButton>
    </div>
    <div v-else-if="currentTracks.length" class="min-h-0 flex-1">
      <SongList
        :items="currentTracks"
        source="netease"
        :show-album="false"
        :show-duration="false"
        show-play-count
      />
    </div>
    <div v-else class="flex flex-1 items-center justify-center">
      <div class="text-center text-on-surface-variant/45">
        <IconLucideHistory class="mx-auto mb-3 size-12 opacity-30" />
        <div class="text-sm">{{ t("userProfile.listening.empty") }}</div>
      </div>
    </div>
  </div>
</template>
