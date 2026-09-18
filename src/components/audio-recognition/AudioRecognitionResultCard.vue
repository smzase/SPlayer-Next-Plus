<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import type { AudioRecognitionResult } from "@/stores/audioRecognition";
import {
  defaultKeywords,
  defaultRegexes,
  normalizeLyricLines,
  parseLyric,
  pickLatestStartedIndex,
  stripLyricMetadata,
} from "lyric-kit";
import AudioRecognitionLyricText from "./AudioRecognitionLyricText.vue";
import { requestPlatformLyric } from "@/services/lyric/request";
import { getLineText } from "@shared/utils/lyrics";
import { formatTime } from "@/utils/time";
import { navigateToAlbum, navigateToArtist } from "@/utils/navigate";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { getCurrentTime as getPlayerCurrentTime } from "@/services/playback";

const props = defineProps<{
  result: AudioRecognitionResult;
  index: number;
  controlled: boolean;
  playing: boolean;
}>();

const emit = defineEmits<{
  play: [];
}>();

const { t } = useI18n();
const settings = useSettingsStore();
const status = useStatusStore();
const lyricLines = shallowRef<LyricLine[]>([]);
const lyricLoading = ref(false);
const timelineTime = ref<number | null>(null);
const activeIndex = ref(-1);
const currentTimeText = ref("");
const cardRef = shallowRef<HTMLElement | null>(null);
const cardInViewport = ref(false);
let loadToken = 0;
let timelineRafId = 0;
let lastTimelinePollAt = 0;
let lastAnchorRefreshAt = 0;
let lastDisplayedSecond = -1;

const TIMELINE_POLL_INTERVAL_MS = 50;
const ANCHOR_REFRESH_INTERVAL_MS = 1000;

const INSTRUMENTAL_PLACEHOLDERS = new Set([
  "纯音乐请欣赏",
  "此歌曲为没有填词的纯音乐请您欣赏",
  "純音樂請欣賞",
  "此歌曲為沒有填詞的純音樂請您欣賞",
]);

/** 获取歌词行的可见文本 */
const lineText = (line: LyricLine): string => getLineText(line).trim();

/** 判断网易云用于纯音乐的占位歌词 */
const isInstrumentalPlaceholder = (text: string): boolean =>
  INSTRUMENTAL_PLACEHOLDERS.has(text.replace(/[\s，,。.!！]/g, ""));

/** 将配对过的背景歌词恢复到内容自身的时间轴 */
const restoreContentTimeline = (line: LyricLine): LyricLine => {
  const firstTimedWord = line.words.find((word) => word.endTime > word.startTime);
  const lastTimedWord = line.words.findLast((word) => word.endTime > word.startTime);
  if (!firstTimedWord || !lastTimedWord) return line;
  if (line.startTime === firstTimedWord.startTime && line.endTime === lastTimedWord.endTime) {
    return line;
  }
  return {
    ...line,
    startTime: firstTimedWord.startTime,
    endTime: lastTimedWord.endTime,
  };
};

/** 为当前候选加载网易云歌词与翻译 */
const loadLyric = async (): Promise<void> => {
  const token = ++loadToken;
  lyricLines.value = [];
  if (props.result.startTime === null) return;

  lyricLoading.value = true;
  try {
    const lyric = await requestPlatformLyric("netease", props.result.track);
    if (token !== loadToken) return;
    if (!lyric) return;
    const parsed = parseLyric(
      {
        content: lyric.content,
        format: lyric.format,
        translation: lyric.translation,
        translationFormat: lyric.translationFormat,
        romaji: lyric.romaji,
        romajiFormat: lyric.romajiFormat,
      },
      {
        preferredLang: settings.locale,
        extractMetadata: true,
        cleanKangxi: true,
        detectBackground: settings.lyric.detectBackgroundLyrics,
      },
    );
    const lines = parsed.lines;
    normalizeLyricLines(lines);
    const mainLines = lines.filter((line) => !line.isBG && lineText(line).length > 0);
    const contentLines = stripLyricMetadata(mainLines, {
      keywords: [...defaultKeywords],
      regexPatterns: [...defaultRegexes],
    });
    const visibleMainLines = contentLines.filter(
      (line) => !isInstrumentalPlaceholder(lineText(line)),
    );
    const visibleMainSet = new Set(visibleMainLines);
    const visibleLines: Array<{ line: LyricLine; order: number }> = [];
    let includeAttachedBackground = false;
    for (const [order, line] of lines.entries()) {
      if (!line.isBG) {
        includeAttachedBackground = visibleMainSet.has(line);
        if (includeAttachedBackground) visibleLines.push({ line, order });
        continue;
      }
      if (
        includeAttachedBackground &&
        lineText(line).length > 0 &&
        !isInstrumentalPlaceholder(lineText(line))
      ) {
        visibleLines.push({ line, order });
      }
    }
    lyricLines.value = visibleLines
      .map(({ line, order }) => ({ line: restoreContentTimeline(line), order }))
      .sort((a, b) => a.line.startTime - b.line.startTime || a.order - b.order)
      .map(({ line }) => line);
  } catch {
    // 歌词预览失败不影响识曲候选本身
  } finally {
    if (token === loadToken) lyricLoading.value = false;
  }
};

watch(
  [() => props.result.track.id, () => settings.locale, () => settings.lyric.detectBackgroundLyrics],
  () => void loadLyric(),
  { immediate: true },
);

const timelineProgressing = computed(
  () =>
    cardInViewport.value &&
    !status.isPlayerExpanded &&
    (props.controlled ? status.isPlaying : props.result.positionAtResult !== null),
);
const timelineRate = computed(() => (props.controlled ? status.speed : 1));

/** 获取候选歌词当前的非响应式时间 */
const getTimelineCurrentTime = (): number | null => {
  if (props.controlled) return getPlayerCurrentTime();
  if (props.result.positionAtResult === null) return null;
  return Math.max(
    0,
    props.result.positionAtResult + Math.max(0, Date.now() - props.result.resultTimestamp),
  );
};

/** 仅在换行或时间显示变化时更新响应式状态 */
const syncTimeline = (forceAnchor = false): void => {
  const currentTime = getTimelineCurrentTime();
  if (currentTime === null) {
    timelineTime.value = null;
    activeIndex.value = -1;
    currentTimeText.value = "";
    lastDisplayedSecond = -1;
    return;
  }

  const nextActiveIndex = pickLatestStartedIndex(lyricLines.value, currentTime);
  const lineChanged = nextActiveIndex !== activeIndex.value;
  if (lineChanged) activeIndex.value = nextActiveIndex;

  const now = performance.now();
  if (forceAnchor || lineChanged || now - lastAnchorRefreshAt >= ANCHOR_REFRESH_INTERVAL_MS) {
    timelineTime.value = currentTime;
    lastAnchorRefreshAt = now;
  }

  const displayedSecond = Math.floor(currentTime / 1000);
  if (displayedSecond !== lastDisplayedSecond) {
    currentTimeText.value = formatTime(currentTime);
    lastDisplayedSecond = displayedSecond;
  }
};

const visibleLines = computed(() => {
  if (lyricLines.value.length === 0) return [];
  const center = Math.max(0, activeIndex.value);
  const start = Math.max(0, center - 2);
  const end = Math.min(lyricLines.value.length, center + 3);
  return lyricLines.value.slice(start, end).map((line, offset) => {
    const index = start + offset;
    return { line, index, distance: index - center };
  });
});

const matchedTime = computed(() =>
  props.result.startTime === null ? "" : formatTime(props.result.startTime),
);
const showLyricPanel = computed(() => lyricLoading.value || lyricLines.value.length > 0);

const stopTimeline = (): void => {
  if (timelineRafId === 0) return;
  cancelAnimationFrame(timelineRafId);
  timelineRafId = 0;
};

const tickTimeline = (timestamp: number): void => {
  timelineRafId = 0;
  if (
    document.hidden ||
    !cardInViewport.value ||
    status.isPlayerExpanded ||
    !showLyricPanel.value
  ) {
    return;
  }
  if (timestamp - lastTimelinePollAt >= TIMELINE_POLL_INTERVAL_MS) {
    lastTimelinePollAt = timestamp;
    syncTimeline();
  }
  timelineRafId = requestAnimationFrame(tickTimeline);
};

const startTimeline = (): void => {
  if (
    timelineRafId !== 0 ||
    document.hidden ||
    !cardInViewport.value ||
    status.isPlayerExpanded ||
    !showLyricPanel.value
  ) {
    return;
  }
  timelineRafId = requestAnimationFrame(tickTimeline);
};

const handleVisibilityChange = (): void => {
  if (document.hidden) {
    stopTimeline();
    return;
  }
  syncTimeline(true);
  startTimeline();
};

watch(showLyricPanel, (visible) => {
  if (!visible) {
    stopTimeline();
    return;
  }
  syncTimeline(true);
  startTimeline();
});

watch(
  [
    () => props.controlled,
    () => props.result.track.id,
    () => props.result.positionAtResult,
    () => props.result.resultTimestamp,
  ],
  () => {
    lastTimelinePollAt = 0;
    lastAnchorRefreshAt = 0;
    syncTimeline(true);
    startTimeline();
  },
);

watch([() => status.isPlaying, () => status.speed], () => {
  if (props.controlled) syncTimeline(true);
});

watch(
  () => status.isPlayerExpanded,
  (expanded) => {
    if (expanded) {
      stopTimeline();
      return;
    }
    syncTimeline(true);
    startTimeline();
  },
);

useIntersectionObserver(cardRef, ([entry]) => {
  const visible = entry?.isIntersecting ?? false;
  if (visible === cardInViewport.value) return;
  cardInViewport.value = visible;
  if (!visible) {
    stopTimeline();
    return;
  }
  syncTimeline(true);
  startTimeline();
});

onMounted(() => {
  document.addEventListener("visibilitychange", handleVisibilityChange);
  syncTimeline(true);
  startTimeline();
});

onBeforeUnmount(() => {
  loadToken += 1;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  stopTimeline();
});

/** 跳转至候选歌曲的歌手页 */
const goArtist = (index: number): void => {
  const artist = props.result.track.artists[index];
  if (!artist?.id) return;
  navigateToArtist(artist.name, { source: props.result.track.source, artistId: artist.id });
};

/** 跳转至候选歌曲的专辑页 */
const goAlbum = (): void => {
  const album = props.result.track.album;
  if (!album?.id) return;
  navigateToAlbum(album.name, { source: props.result.track.source, albumId: album.id });
};
</script>

<template>
  <article
    ref="cardRef"
    class="group overflow-hidden rounded-xl border-2 border-solid bg-surface-panel transition-[background-color,border-color] duration-200"
    :class="
      playing
        ? 'border-primary/40 bg-primary/10'
        : 'border-primary/12 hover:border-primary/25 hover:bg-on-surface/[0.025]'
    "
  >
    <div class="flex items-center gap-3 px-4 pt-3" :class="{ 'pb-3': !showLyricPanel }">
      <span
        class="w-6 shrink-0 text-center text-sm font-bold tabular-nums"
        :class="playing ? 'text-primary' : 'text-on-surface-variant/55'"
      >
        {{ index + 1 }}
      </span>
      <button
        type="button"
        class="relative grid size-14 shrink-0 cursor-pointer place-items-stretch overflow-hidden rounded-lg border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
        :title="t('audioRecognition.play')"
        :aria-label="t('audioRecognition.play')"
        @click="emit('play')"
      >
        <SImg :src="result.track.cover" class="size-full" />
        <span
          class="absolute inset-0 flex items-center justify-center bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100"
        >
          <IconLucidePlay class="size-5 fill-current" />
        </span>
      </button>

      <div class="min-w-0 flex-1">
        <div class="truncate text-base font-medium" :class="playing ? 'text-primary' : ''">
          {{ result.track.title }}
        </div>
        <div class="mt-1 flex min-w-0 items-center gap-1 text-sm text-on-surface-variant/65">
          <span class="min-w-0 truncate">
            <template
              v-for="(artist, artistIndex) in result.track.artists"
              :key="artist.id ?? artistIndex"
            >
              <button
                type="button"
                class="cursor-pointer border-0 bg-transparent p-0 text-left text-inherit transition-colors hover:text-on-surface disabled:cursor-default disabled:hover:text-inherit"
                :disabled="!artist.id"
                @click.stop="goArtist(artistIndex)"
              >
                {{ artist.name }}
              </button>
              <span v-if="artistIndex < result.track.artists.length - 1" class="mx-0.5 opacity-50">
                /
              </span>
            </template>
          </span>
          <span v-if="result.track.album?.name" class="shrink-0 opacity-35">·</span>
          <button
            v-if="result.track.album?.name"
            type="button"
            class="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-inherit transition-colors hover:text-on-surface disabled:cursor-default disabled:hover:text-inherit"
            :disabled="!result.track.album.id"
            @click.stop="goAlbum"
          >
            {{ result.track.album.name }}
          </button>
        </div>
      </div>

      <div
        v-if="result.startTime !== null"
        class="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"
      >
        <IconLucideScanLine class="size-3.5" />
        {{ t("audioRecognition.matchedAt", { time: matchedTime }) }}
      </div>
    </div>

    <div
      v-if="showLyricPanel"
      class="mx-4 mb-3 mt-2 overflow-hidden rounded-lg bg-on-surface/[0.035] px-4"
    >
      <div
        v-if="lyricLoading"
        class="flex h-30 items-center justify-center gap-2 text-sm text-on-surface-variant/50"
      >
        <IconLucideLoaderCircle class="size-4 animate-spin" />
        {{ t("audioRecognition.lyricLoading") }}
      </div>
      <div v-else class="relative h-30 overflow-hidden">
        <TransitionGroup name="recognition-lyric" move-class="recognition-lyric-no-move">
          <div
            v-for="item in visibleLines"
            :key="`${item.line.startTime}:${item.index}`"
            class="recognition-lyric-line absolute inset-x-0 top-1/2 text-center"
            :class="item.index === activeIndex ? 'text-on-surface' : 'text-on-surface-variant/30'"
            :style="{
              transform: 'translate3d(0, calc(-50% + ' + item.distance * 42 + 'px), 0)',
              opacity: item.index === activeIndex ? 1 : Math.abs(item.distance) === 1 ? 0.58 : 0.28,
            }"
          >
            <div class="flex min-w-0 items-center justify-center">
              <div class="recognition-main-wrap min-w-0 max-w-full text-center">
                <div
                  class="recognition-main-text"
                  :style="{
                    transform: item.index === activeIndex ? 'scale(1)' : 'scale(0.875)',
                  }"
                >
                  <AudioRecognitionLyricText
                    :line="item.line"
                    :current-time="item.index === activeIndex ? timelineTime : null"
                    :progressing="timelineProgressing"
                    :rate="timelineRate"
                    :word-by-word="item.index === activeIndex"
                  />
                </div>
                <div
                  v-if="item.line.translatedLyric"
                  class="recognition-translation mt-0.5 truncate text-xs"
                  :class="item.index === activeIndex ? 'opacity-55' : 'opacity-40'"
                >
                  {{ item.line.translatedLyric }}
                </div>
              </div>
            </div>
          </div>
        </TransitionGroup>
        <span class="absolute bottom-2 right-0 text-[11px] tabular-nums text-on-surface-variant/35">
          {{ currentTimeText }}
        </span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.recognition-lyric-line {
  transition:
    transform 520ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 380ms ease,
    color 380ms ease;
}

.recognition-lyric-no-move {
  transition: none !important;
}

.recognition-main-text {
  font-size: 1rem;
  font-weight: 500;
  line-height: 1.5rem;
  transform-origin: center;
  transition: transform 480ms cubic-bezier(0.4, 0, 0.2, 1);
}

.recognition-translation {
  transition: opacity 320ms ease;
}

.recognition-lyric-enter-active,
.recognition-lyric-leave-active {
  transition:
    opacity 300ms ease,
    translate 420ms cubic-bezier(0.22, 1, 0.36, 1),
    scale 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

.recognition-lyric-enter-from {
  opacity: 0 !important;
  translate: 0 0.35rem;
  scale: 0.98;
}

.recognition-lyric-leave-to {
  opacity: 0 !important;
  translate: 0 -0.35rem;
  scale: 0.98;
}
</style>
