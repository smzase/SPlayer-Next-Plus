<script setup lang="ts">
import type { Track } from "@shared/types/player";
import AudioRecognitionResultCard from "@/components/audio-recognition/AudioRecognitionResultCard.vue";
import { useAudioRecognitionStore, type AudioRecognitionResult } from "@/stores/audioRecognition";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useDownload } from "@/composables/useDownload";
import { usePlaylistPicker } from "@/composables/usePlaylistPicker";
import { useTrackMenu } from "@/composables/useTrackMenu";
import * as player from "@/core/player";

const { t } = useI18n();
const recognition = useAudioRecognitionStore();
const media = useMediaStore();
const settings = useSettingsStore();
const { phase, failure, error, elapsedMs, results, isActive } = storeToRefs(recognition);
const locallyControlledResultId = ref<string | null>(null);
const contextTrack = shallowRef<Track>();

const remainingSeconds = computed(() => Math.max(0, Math.ceil((16_000 - elapsedMs.value) / 1000)));
const statusText = computed(() => {
  if (phase.value === "requesting") return t("audioRecognition.requesting");
  if (phase.value === "recording") {
    return t("audioRecognition.listening", { seconds: remainingSeconds.value });
  }
  if (phase.value === "matching") return t("audioRecognition.matching");
  if (phase.value === "empty") return t("audioRecognition.empty");
  if (phase.value === "error") {
    const key = failure.value || "capture";
    return t(`audioRecognition.error.${key}`);
  }
  return t("audioRecognition.hint");
});

/** 按当前单曲播放列表设置播放识曲候选 */
const playResult = (result: AudioRecognitionResult, index: number): void => {
  locallyControlledResultId.value = result.track.id;
  if (media.track?.source === result.track.source && media.track.id === result.track.id) {
    void player.togglePlay();
    return;
  }
  if (settings.player.singleTrackQueueMode === "replace") {
    void player.playFrom(
      results.value.map((item) => item.track),
      { startIndex: index },
    );
    return;
  }
  void player.playNow(result.track);
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
    const index = results.value.findIndex(
      (result) => result.track.source === track.source && result.track.id === track.id,
    );
    const result = results.value[index];
    if (result) playResult(result, index);
  },
  onAddToPlaylist: (track) => openPicker([track]),
  onDownload: (track, quality) => void enqueueDownload(track, { quality }),
});

/** 阻止在识曲结果卡片外呼出上一首歌曲的菜单 */
const onResultsContextMenu = (event: MouseEvent): void => {
  const target = event.target as HTMLElement | null;
  if (target?.closest("[data-audio-recognition-result]")) return;
  event.preventDefault();
  event.stopPropagation();
};

watch(results, () => {
  locallyControlledResultId.value = null;
});

onMounted(() => {
  if (phase.value === "idle" && results.value.length === 0) void recognition.start();
});

onBeforeUnmount(() => {
  if (isActive.value) recognition.stop();
});
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex shrink-0 items-center justify-between gap-4 px-6 pb-3 pt-2">
      <div class="min-w-0">
        <h1 class="text-3xl font-bold text-on-surface">{{ t("audioRecognition.title") }}</h1>
        <p class="mt-1 text-sm text-on-surface-variant/55">
          {{ t("audioRecognition.subtitle") }}
        </p>
      </div>
      <SButton v-if="results.length > 0" variant="secondary" round @click="recognition.start()">
        <template #icon><IconLucideRefreshCw /></template>
        {{ t("audioRecognition.again") }}
      </SButton>
    </div>

    <div
      v-if="results.length > 0"
      class="flex min-h-0 flex-1 flex-col"
      @contextmenu.capture="onResultsContextMenu"
    >
      <div class="flex shrink-0 items-start gap-2 px-6 pb-3 text-sm text-on-surface-variant/60">
        <IconLucideBadgeCheck class="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <div>{{ t("audioRecognition.resultCount", { count: results.length }) }}</div>
          <div class="mt-0.5 text-xs text-on-surface-variant/40">
            {{ t("audioRecognition.lyricSyncHint") }}
          </div>
        </div>
      </div>
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

        <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <div class="space-y-3">
            <div
              v-for="(result, index) in results"
              :key="result.track.id"
              data-audio-recognition-result
              @contextmenu="contextTrack = result.track"
            >
              <AudioRecognitionResultCard
                :result="result"
                :index="index"
                :controlled="
                  locallyControlledResultId === result.track.id &&
                  media.track?.source === result.track.source &&
                  media.track.id === result.track.id
                "
                :playing="
                  media.track?.source === result.track.source && media.track.id === result.track.id
                "
                @play="playResult(result, index)"
              />
            </div>
          </div>
        </div>
      </SContextMenu>
    </div>

    <div v-else class="flex min-h-0 flex-1 items-center justify-center px-6 pb-16">
      <div class="flex max-w-md flex-col items-center text-center">
        <div class="relative flex size-72 items-center justify-center" aria-hidden="true">
          <span
            class="recognition-wave absolute size-28 rounded-full border border-solid border-primary/35"
            :class="{ 'recognition-wave-active': isActive }"
          />
          <span
            class="recognition-wave recognition-wave-delay-one absolute size-28 rounded-full border border-solid border-primary/35"
            :class="{ 'recognition-wave-active': isActive }"
          />
          <span
            class="recognition-wave recognition-wave-delay-two absolute size-28 rounded-full border border-solid border-primary/35"
            :class="{ 'recognition-wave-active': isActive }"
          />
          <div
            class="relative z-1 flex size-28 items-center justify-center rounded-full bg-primary text-on-primary shadow-xl transition-transform duration-300"
            :class="isActive ? 'scale-105' : ''"
          >
            <IconLucideMicVocal v-if="phase !== 'empty' && phase !== 'error'" class="size-12" />
            <IconLucideCircleHelp v-else class="size-12" />
          </div>
        </div>

        <p class="mt-3 text-base font-medium text-on-surface">{{ statusText }}</p>
        <p v-if="phase === 'idle'" class="mt-1 text-sm text-on-surface-variant/50">
          {{ t("audioRecognition.scope") }}
        </p>
        <p
          v-if="phase === 'error' && error"
          class="mt-2 max-w-sm break-all text-xs text-on-surface-variant/40"
        >
          {{ error }}
        </p>

        <SButton v-if="isActive" class="mt-5" variant="secondary" round @click="recognition.stop()">
          <template #icon><IconLucideSquare /></template>
          {{ t("audioRecognition.stop") }}
        </SButton>
        <SButton
          v-else
          class="mt-5"
          type="primary"
          variant="secondary"
          round
          @click="recognition.start()"
        >
          <template #icon><IconLucideMicVocal /></template>
          {{ phase === "idle" ? t("audioRecognition.start") : t("audioRecognition.retry") }}
        </SButton>
      </div>
    </div>

    <PlaylistPickerDialog v-model:open="pickerOpen" :mode="pickerMode" :tracks="pickerTracks" />
  </div>
</template>

<style scoped>
.recognition-wave {
  opacity: 0;
  transform: scale(0.88);
}

.recognition-wave-active {
  animation: recognition-wave 2.4s cubic-bezier(0.2, 0.55, 0.25, 1) infinite;
}

.recognition-wave-delay-one {
  animation-delay: 0.8s;
}

.recognition-wave-delay-two {
  animation-delay: 1.6s;
}

@keyframes recognition-wave {
  0% {
    opacity: 0;
    transform: scale(0.88);
  }
  12% {
    opacity: 0.6;
  }
  100% {
    opacity: 0;
    transform: scale(2.5);
  }
}

@media (prefers-reduced-motion: reduce) {
  .recognition-wave-active {
    animation: none;
  }
}
</style>
