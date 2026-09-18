<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import type { LocaleCode, TaskbarLyricSettings } from "@shared/types/settings";
import type { TaskbarPlaybackSnapshot, TaskbarPlayMode } from "@shared/types/taskbarLyric";
import DEFAULT_COVER from "@/assets/images/song.jpg";
import IconSkipBack from "~icons/lucide/skip-back";
import IconSkipForward from "~icons/lucide/skip-forward";
import IconPlay from "~icons/lucide/play";
import IconPause from "~icons/lucide/pause";
import IconRepeat from "~icons/lucide/repeat";
import IconRepeatOne from "~icons/lucide/repeat-1";
import IconShuffle from "~icons/lucide/shuffle";
import IconListMusic from "~icons/lucide/list-music";
import IconPlayOrder from "~icons/sp/play-order";
import TaskbarLyricLine from "./components/TaskbarLyricLine.vue";
import { hasRealWordTiming } from "@shared/utils/lyricSync";
import { pickLatestStartedIndex, pickPrimaryIndex } from "lyric-kit";
import {
  getNowPlayingCurrentMs,
  useNowPlayingSync,
} from "@windows/shared/composables/useNowPlayingSync";
import { formatArtists } from "@shared/utils/track";
import { getLineText } from "@shared/utils/lyrics";

const config = reactive<TaskbarLyricSettings>({
  position: "auto",
  autoMaxWidth: true,
  autoAdjustOccupiedSpace: false,
  maxWidth: 400,
  queueWidth: 340,
  queueHeight: 520,
  leftMargin: 0,
  rightMargin: 0,
  colorMode: "taskbar",
  showBackground: false,
  doubleLine: true,
  showTranslation: true,
  showBackgroundLyric: true,
  showCover: true,
  pureLyricMode: false,
  separateCoverAndLyric: false,
  wordByWord: true,
  autoGenerateWordByWord: true,
  fontSize: 14,
  fontWeight: 400,
  translationFontWeight: 400,
  fontFamily: "",
});

const anchor = ref<"left" | "right">("left");
const taskbarIsLight = ref(false);
const isHovered = ref(false);
const coverHovered = ref(false);
const playMode = ref<TaskbarPlayMode>("repeat-list");
const playModeDisabled = ref(true);
const locale = ref<LocaleCode>("zh-CN");
const maxLayoutWidth = ref(400);
const mainContentWidth = ref(0);
const mainExitContentWidth = ref(0);
const backgroundContentWidth = ref(0);
const dividerContentWidth = ref(0);
const wrapperRef = ref<HTMLElement | null>(null);
const backgroundGroupRef = ref<HTMLElement | null>(null);
let hoverLeaveTimer: number | null = null;
let widthReportRaf = 0;
let lastReportedWidth = 0;
let backgroundMoveAnimation: Animation | null = null;

/** 给字体亚像素取整和逐字渐变预留空间，避免临界宽度误触发滚动 */
const LYRIC_WIDTH_GUARD = 8;

/** 按歌词行动画结束后的字号换算文字宽度，避免副行升为主行时低估空间 */
const measureTargetTextWidth = (element: HTMLElement): number => {
  const line = element.closest<HTMLElement>(".lyric-line, .background-lyric-line");
  const naturalWidth = element.offsetWidth;
  if (!line) return naturalWidth;

  const currentFontSize = Number.parseFloat(getComputedStyle(line).fontSize);
  const targetFontSize =
    line.dataset.role === "secondary" ? config.fontSize * 0.82 : config.fontSize;
  if (!Number.isFinite(currentFontSize) || currentFontSize <= 0) return naturalWidth;
  return naturalWidth * (targetFontSize / currentFontSize);
};

/**
 * 上报任务栏歌词窗口宽度，背景横移动画期间暂缓收窄窗口
 * @param targetWidth - 目标窗口宽度
 * @param deferShrink - 是否等待背景横移动画结束后再收窄
 */
const setReportedContentWidth = (targetWidth: number, deferShrink: boolean): void => {
  if (targetWidth < lastReportedWidth && (deferShrink || backgroundMoveAnimation)) return;
  if (targetWidth === lastReportedWidth) return;
  lastReportedWidth = targetWidth;
  window.api.taskbarLyric.setContentWidth(targetWidth);
};

/** 测量当前内容的自然宽度，不受已经收窄的窗口反向限制 */
const reportContentWidth = (): void => {
  widthReportRaf = 0;
  const wrapper = wrapperRef.value;
  if (!wrapper) return;

  const wrapperStyle = getComputedStyle(wrapper);
  const horizontalPadding =
    Number.parseFloat(wrapperStyle.paddingLeft) + Number.parseFloat(wrapperStyle.paddingRight);
  const coverWidth = config.showCover
    ? (wrapper.querySelector<HTMLElement>(".cover-wrapper")?.offsetWidth ?? 0)
    : 0;
  const lyricStage = wrapper.querySelector<HTMLElement>(".lyric-stage");
  const lyricArea = wrapper.querySelector<HTMLElement>(".lyric-area");
  const currentMainViewportWidth = lyricArea?.getBoundingClientRect().width ?? 0;
  const lyricStyle = lyricStage ? getComputedStyle(lyricStage) : null;
  const lyricMargins = lyricStyle
    ? Number.parseFloat(lyricStyle.marginLeft) + Number.parseFloat(lyricStyle.marginRight)
    : 0;
  const renderedMainTextElements = Array.from(
    wrapper.querySelectorAll<HTMLElement>(".main-lyric-column .lyric-line .scroll-content"),
  );
  const renderedBackgroundTextElements = Array.from(
    wrapper.querySelectorAll<HTMLElement>(".background-lyric-column .lyric-line .scroll-content"),
  );
  const nextMainTextElements = renderedMainTextElements.filter(
    (element) => !element.closest(".line-leave-active"),
  );
  const hasLeavingMainLine = renderedMainTextElements.some((element) =>
    element.closest(".line-leave-active"),
  );
  const targetMainTextElements =
    nextMainTextElements.length > 0 ? nextMainTextElements : renderedMainTextElements;
  const mainTextWidth = Math.max(0, ...targetMainTextElements.map(measureTargetTextWidth));
  const renderedMainTextWidth = Math.max(
    0,
    ...renderedMainTextElements.map(measureTargetTextWidth),
  );
  const renderedBackgroundTextWidth = Math.max(
    0,
    ...renderedBackgroundTextElements.map(measureTargetTextWidth),
  );
  const divider = wrapper.querySelector<HTMLElement>(".background-divider");
  const dividerStyle = divider ? getComputedStyle(divider) : null;
  const dividerWidth =
    divider && dividerStyle
      ? divider.offsetWidth +
        Number.parseFloat(dividerStyle.marginLeft) +
        Number.parseFloat(dividerStyle.marginRight)
      : 0;
  const widthGuard = LYRIC_WIDTH_GUARD / 2;
  const nextMainContentWidth = mainTextWidth > 0 ? mainTextWidth + widthGuard : 0;
  const backgroundWillMove =
    !!backgroundGroupRef.value?.querySelector(".lyric-line") &&
    Math.abs(nextMainContentWidth - mainContentWidth.value) >= 0.5;
  const shouldDeferWindowShrink = hasLeavingMainLine || backgroundWillMove;
  mainExitContentWidth.value = hasLeavingMainLine
    ? Math.max(mainExitContentWidth.value, currentMainViewportWidth)
    : 0;
  mainContentWidth.value = nextMainContentWidth;
  backgroundContentWidth.value =
    renderedBackgroundTextElements.length > 0 ? renderedBackgroundTextWidth + widthGuard : 0;
  dividerContentWidth.value = renderedBackgroundTextElements.length > 0 ? dividerWidth : 0;
  if (isHovered.value) {
    const targetWidth = Math.ceil(maxLayoutWidth.value);
    setReportedContentWidth(targetWidth, shouldDeferWindowShrink);
    return;
  }
  const naturalTextWidth =
    renderedMainTextWidth + renderedBackgroundTextWidth + dividerContentWidth.value;
  const fixedWidth = horizontalPadding + coverWidth + lyricMargins;
  const availableTextWidth = Math.max(0, maxLayoutWidth.value - fixedWidth);
  const preferredTextWidth = naturalTextWidth + LYRIC_WIDTH_GUARD;
  const textWidth = Math.min(preferredTextWidth, availableTextWidth);
  const targetWidth = Math.ceil(Math.min(maxLayoutWidth.value, fixedWidth + textWidth));
  setReportedContentWidth(targetWidth, shouldDeferWindowShrink);
};

const scheduleContentWidthReport = (): void => {
  if (widthReportRaf) return;
  widthReportRaf = requestAnimationFrame(reportContentWidth);
};

/**
 * 主歌词宽度变化时，以靠近主歌词的边缘为基准平滑移动背景歌词
 */
const animateBackgroundMove = async (): Promise<void> => {
  const group = backgroundGroupRef.value;
  if (!group?.querySelector(".lyric-line")) return;

  const beforeRect = group.getBoundingClientRect();
  const beforeEdge = anchor.value === "right" ? beforeRect.right : beforeRect.left;
  backgroundMoveAnimation?.cancel();
  backgroundMoveAnimation = null;
  await nextTick();

  const currentGroup = backgroundGroupRef.value;
  if (!currentGroup?.querySelector(".lyric-line")) {
    scheduleContentWidthReport();
    return;
  }
  const currentRect = currentGroup.getBoundingClientRect();
  const currentEdge = anchor.value === "right" ? currentRect.right : currentRect.left;
  const deltaX = beforeEdge - currentEdge;
  if (Math.abs(deltaX) < 0.5) {
    scheduleContentWidthReport();
    return;
  }

  const animation = currentGroup.animate(
    [{ transform: "translateX(" + deltaX + "px)" }, { transform: "translateX(0)" }],
    {
      duration: 400,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      fill: "both",
    },
  );
  backgroundMoveAnimation = animation;
  animation.addEventListener(
    "finish",
    () => {
      if (backgroundMoveAnimation !== animation) return;
      animation.cancel();
      backgroundMoveAnimation = null;
      scheduleContentWidthReport();
    },
    { once: true },
  );
};

const setContentHovered = (hovered: boolean): void => {
  if (hoverLeaveTimer !== null) {
    window.clearTimeout(hoverLeaveTimer);
    hoverLeaveTimer = null;
  }
  if (config.pureLyricMode) {
    isHovered.value = false;
    nextTick(scheduleContentWidthReport);
    return;
  }
  if (hovered) {
    isHovered.value = true;
    nextTick(scheduleContentWidthReport);
    return;
  }
  hoverLeaveTimer = window.setTimeout(() => {
    hoverLeaveTimer = null;
    isHovered.value = false;
    nextTick(scheduleContentWidthReport);
  }, 40);
};

const pickTaskbarPrimaryIndex = (lines: LyricLine[], time: number): number =>
  config.showBackgroundLyric ? pickLatestStartedIndex(lines, time) : pickPrimaryIndex(lines, time);

const { track, lyric, backgroundLyric, primaryIndex, backgroundIndex, playing } = useNowPlayingSync(
  {
    pickIndex: pickTaskbarPrimaryIndex,
    logTag: "taskbar-lyric",
    includeBackground: true,
  },
);

const currentLine = computed<LyricLine | null>(() => {
  const idx = primaryIndex.value;
  if (idx < 0) return null;
  return lyric.value[idx] ?? null;
});

const hasLyric = computed(() => lyric.value.length > 0 && primaryIndex.value >= 0);
const currentBackgroundLine = computed<LyricLine | null>(() => {
  if (!config.showBackgroundLyric || backgroundIndex.value < 0) return null;
  return backgroundLyric.value[backgroundIndex.value] ?? null;
});
const backgroundText = computed(
  () =>
    currentBackgroundLine.value?.words
      .map((word) => word.word)
      .join("")
      .trim() ?? "",
);
const hasBackgroundLyric = computed(
  () => currentBackgroundLine.value !== null && backgroundText.value.length > 0,
);
const separationEnabled = computed(() => config.separateCoverAndLyric && !config.pureLyricMode);
const controlsVisible = computed(() =>
  config.pureLyricMode
    ? false
    : separationEnabled.value
      ? config.showCover && coverHovered.value
      : isHovered.value,
);
const songInfoVisible = computed(() => !config.pureLyricMode && controlsVisible.value);

const titleText = computed<string>(() => track.value?.title ?? "SPlayer Next Plus");
const artistsText = computed<string>(() => formatArtists(track.value?.artists) || "未知艺术家");

const effectiveTheme = computed<"light" | "dark">(() => {
  if (config.colorMode === "light") return "light";
  if (config.colorMode === "dark") return "dark";
  if (config.colorMode === "taskbarInverse") return taskbarIsLight.value ? "dark" : "light";
  return taskbarIsLight.value ? "light" : "dark";
});

interface RenderItem {
  key: string;
  role: "primary" | "secondary";
  kind: "lyric" | "translation" | "meta";
  text: string;
  line?: LyricLine;
}

const items = computed<RenderItem[]>(() => {
  if (hasLyric.value) {
    const idx = primaryIndex.value;
    const line = currentLine.value!;
    const list: RenderItem[] = [
      {
        key: `line-${idx}`,
        role: "primary",
        kind: "lyric",
        text: getLineText(line),
        line,
      },
    ];
    if (config.doubleLine) {
      const translation = config.showTranslation ? line.translatedLyric : "";
      if (translation) {
        list.push({
          key: `translation-${idx}`,
          role: "secondary",
          kind: "translation",
          text: translation,
        });
      } else {
        const next = lyric.value[idx + 1];
        if (next) {
          list.push({
            key: `line-${idx + 1}`,
            role: "secondary",
            kind: "lyric",
            text: getLineText(next),
            line: next,
          });
        }
      }
    }
    return list;
  }

  const list: RenderItem[] = [
    { key: "meta-title", role: "primary", kind: "meta", text: titleText.value },
  ];
  if (config.doubleLine) {
    list.push({
      key: "meta-artist",
      role: "secondary",
      kind: "meta",
      text: artistsText.value,
    });
  }
  return list;
});

const backgroundItems = computed<RenderItem[]>(() => {
  if (!hasBackgroundLyric.value) return [];
  const line = currentBackgroundLine.value!;
  const idx = backgroundIndex.value;
  const list: RenderItem[] = [
    {
      key: "background-line-" + idx,
      role: "primary",
      kind: "lyric",
      text: backgroundText.value,
      line,
    },
  ];
  if (config.doubleLine && config.showTranslation && line.translatedLyric) {
    list.push({
      key: "background-translation-" + idx,
      role: "secondary",
      kind: "translation",
      text: line.translatedLyric,
    });
  }
  return list;
});

const shouldRenderLineWordByWord = (line?: LyricLine): boolean =>
  !!line && config.wordByWord && (config.autoGenerateWordByWord || hasRealWordTiming(line));

const shouldRenderWordByWord = (item: RenderItem): boolean => shouldRenderLineWordByWord(item.line);

const lyricLayoutStyle = computed(() => ({
  "--tbl-main-content-width": mainContentWidth.value + "px",
  "--tbl-main-exit-content-width": mainExitContentWidth.value + "px",
  "--tbl-background-content-width": backgroundContentWidth.value + "px",
  "--tbl-divider-content-width": dividerContentWidth.value + "px",
}));

const rootStyle = computed(() => ({
  "--tbl-font-size": `${config.fontSize}px`,
  "--tbl-font-weight": config.fontWeight,
  "--tbl-translation-font-weight": config.translationFontWeight,
  fontWeight: config.fontWeight,
  fontFamily: config.fontFamily || undefined,
}));

const controlLabels: Record<
  LocaleCode,
  {
    prev: string;
    next: string;
    play: string;
    pause: string;
    queue: string;
    modes: Record<TaskbarPlayMode, string>;
  }
> = {
  "zh-CN": {
    prev: "上一首",
    next: "下一首",
    play: "播放",
    pause: "暂停",
    queue: "播放列表",
    modes: {
      "repeat-list": "列表循环",
      "repeat-one": "单曲循环",
      shuffle: "随机播放",
      sequential: "顺序播放",
    },
  },
  "en-US": {
    prev: "Previous",
    next: "Next",
    play: "Play",
    pause: "Pause",
    queue: "Queue",
    modes: {
      "repeat-list": "Repeat All",
      "repeat-one": "Repeat One",
      shuffle: "Shuffle",
      sequential: "Sequential",
    },
  },
};

const labels = computed(() => controlLabels[locale.value]);
const playModeIcon = computed(() => {
  switch (playMode.value) {
    case "repeat-one":
      return IconRepeatOne;
    case "shuffle":
      return IconShuffle;
    case "sequential":
      return IconPlayOrder;
    case "repeat-list":
      return IconRepeat;
  }
  return IconRepeat;
});

const applyPlaybackSnapshot = (snapshot: TaskbarPlaybackSnapshot): void => {
  playMode.value = snapshot.playMode;
  playModeDisabled.value = snapshot.playModeDisabled;
  locale.value = snapshot.locale;
};

const handlePrev = (): void => window.api.player.dispatch("prev");
const handleNext = (): void => window.api.player.dispatch("next");
const handleTogglePlay = (): void => window.api.player.dispatch(playing.value ? "pause" : "play");
const handleCyclePlayMode = (): void => window.api.taskbarLyric.cyclePlayMode();
const handleToggleQueue = (): void => window.api.taskbarLyric.toggleQueue();
const handleFocusMain = (): void => {
  if (config.pureLyricMode) return;
  window.api.system.focusMainWindow().catch(() => {});
};

const handleContainerDoubleClick = (): void => {
  if (!config.pureLyricMode && !separationEnabled.value) handleFocusMain();
};

const unsubscribers: Array<() => void> = [];

onMounted(async () => {
  try {
    const saved = (await window.api.config.get("taskbarLyric")) as TaskbarLyricSettings | null;
    if (saved) Object.assign(config, saved);
    await nextTick();
    scheduleContentWidthReport();
  } catch (error) {
    console.error("[taskbar-lyric] load config failed", error);
  }

  unsubscribers.push(
    window.api.taskbarLyric.onLayout((data) => {
      anchor.value = data.anchor;
      taskbarIsLight.value = data.isLight;
      maxLayoutWidth.value = data.maxWidth;
      nextTick(scheduleContentWidthReport);
    }),
    window.api.taskbarLyric.onConfigChange((next) => {
      Object.assign(config, next);
      if (!next.separateCoverAndLyric || !next.showCover || next.pureLyricMode) {
        coverHovered.value = false;
      }
      if (next.pureLyricMode) isHovered.value = false;
      nextTick(scheduleContentWidthReport);
    }),
    window.api.taskbarLyric.onCoverHover((hovered) => {
      if (separationEnabled.value && config.showCover) coverHovered.value = hovered;
    }),
    window.api.taskbarLyric.onPlaybackChange(applyPlaybackSnapshot),
  );

  try {
    applyPlaybackSnapshot(await window.api.taskbarLyric.requestPlayback());
  } catch (error) {
    console.error("[taskbar-lyric] request playback failed", error);
  }
});

watch(items, () => nextTick(scheduleContentWidthReport));
watch(backgroundItems, () => nextTick(scheduleContentWidthReport));
watch(mainContentWidth, () => void animateBackgroundMove(), { flush: "pre" });
watch(
  () => config.showBackgroundLyric,
  () => {
    primaryIndex.value = pickTaskbarPrimaryIndex(lyric.value, getNowPlayingCurrentMs());
    nextTick(scheduleContentWidthReport);
  },
);
watch(
  () => [
    config.showCover,
    config.doubleLine,
    config.showBackgroundLyric,
    config.fontSize,
    config.fontWeight,
    config.translationFontWeight,
    config.fontFamily,
  ],
  () => nextTick(scheduleContentWidthReport),
);

onBeforeUnmount(() => {
  if (widthReportRaf) cancelAnimationFrame(widthReportRaf);
  backgroundMoveAnimation?.cancel();
  backgroundMoveAnimation = null;
  if (hoverLeaveTimer !== null) {
    window.clearTimeout(hoverLeaveTimer);
    hoverLeaveTimer = null;
  }
  for (const off of unsubscribers) off();
});
</script>

<template>
  <div
    ref="wrapperRef"
    class="wrapper"
    :data-align="anchor"
    @mouseenter="setContentHovered(true)"
    @mouseleave="setContentHovered(false)"
  >
    <div
      class="taskbar-lyric-container"
      :class="{
        'is-separated': separationEnabled,
        'is-pure': config.pureLyricMode,
        'has-cover': config.showCover,
        'shows-background': config.showBackground,
        'show-controls': controlsVisible,
        'show-song-info': songInfoVisible,
      }"
      :data-theme="effectiveTheme"
      :data-align="anchor"
      :style="rootStyle"
      @dblclick="handleContainerDoubleClick"
    >
      <div
        class="interactive-zone"
        :class="{ 'show-controls': controlsVisible }"
        @dblclick.stop="handleFocusMain"
      >
        <div v-if="config.showCover" class="cover-wrapper">
          <img
            class="cover"
            :src="track?.cover || DEFAULT_COVER"
            alt=""
            draggable="false"
            decoding="async"
            @error="($event.target as HTMLImageElement).src = DEFAULT_COVER"
          />
        </div>

        <div v-if="!config.pureLyricMode" class="controls-wrapper">
          <div class="controls-inner">
            <button
              class="control-btn"
              type="button"
              :title="labels.prev"
              :aria-label="labels.prev"
              @click.stop="handlePrev"
              @dblclick.stop
            >
              <IconSkipBack class="control-icon" />
            </button>
            <button
              class="control-btn"
              type="button"
              :title="playing ? labels.pause : labels.play"
              :aria-label="playing ? labels.pause : labels.play"
              @click.stop="handleTogglePlay"
              @dblclick.stop
            >
              <component :is="playing ? IconPause : IconPlay" class="control-icon" />
            </button>
            <button
              class="control-btn"
              type="button"
              :title="labels.next"
              :aria-label="labels.next"
              @click.stop="handleNext"
              @dblclick.stop
            >
              <IconSkipForward class="control-icon" />
            </button>
            <button
              class="control-btn"
              type="button"
              :title="labels.modes[playMode]"
              :aria-label="labels.modes[playMode]"
              :disabled="playModeDisabled"
              @click.stop="handleCyclePlayMode"
              @dblclick.stop
            >
              <component :is="playModeIcon" class="control-icon" />
            </button>
            <button
              class="control-btn"
              type="button"
              :title="labels.queue"
              :aria-label="labels.queue"
              @click.stop="handleToggleQueue"
              @dblclick.stop
            >
              <IconListMusic class="control-icon" />
            </button>
          </div>
        </div>
      </div>

      <div class="lyric-stage">
        <div class="lyric-layout" :style="lyricLayoutStyle">
          <div class="lyric-area">
            <TransitionGroup
              tag="div"
              name="line"
              class="lyric-column main-lyric-column"
              @after-leave="scheduleContentWidthReport"
            >
              <div
                v-for="item in items"
                :key="item.key"
                class="lyric-line"
                :data-role="item.role"
                :data-kind="item.kind"
              >
                <TaskbarLyricLine
                  :line="item.line"
                  :text="item.text"
                  :word-by-word="shouldRenderWordByWord(item)"
                  :anchor="anchor"
                  :layout-width="mainContentWidth"
                />
              </div>
            </TransitionGroup>
          </div>

          <div
            ref="backgroundGroupRef"
            class="background-lyric-group"
            :class="{ 'has-background': backgroundItems.length > 0 }"
          >
            <div class="background-divider" aria-hidden="true" />
            <div class="background-lyric-area">
              <TransitionGroup
                tag="div"
                name="line"
                class="lyric-column background-lyric-column"
                @after-leave="scheduleContentWidthReport"
              >
                <div
                  v-for="item in backgroundItems"
                  :key="item.key"
                  class="lyric-line background-lyric-line"
                  :data-role="item.role"
                  :data-kind="item.kind"
                >
                  <TaskbarLyricLine
                    :line="item.line"
                    :text="item.text"
                    :word-by-word="shouldRenderWordByWord(item)"
                    :anchor="anchor"
                    :layout-width="backgroundContentWidth"
                  />
                </div>
              </TransitionGroup>
            </div>
          </div>
        </div>

        <div class="song-info">
          <div class="song-title">
            {{ titleText }}
          </div>
          <div v-if="config.doubleLine" class="song-artist">
            {{ artistsText }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.wrapper {
  width: 100vw;
  height: 100vh;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  pointer-events: auto;
}
.wrapper[data-align="right"] {
  justify-content: flex-end;
}
.taskbar-lyric-container {
  --tbl-text-primary: #ffffff;
  --tbl-text-secondary: rgba(255, 255, 255, 0.5);
  --tbl-hover-bg: rgba(255, 255, 255, 0.12);
  --tbl-played: var(--tbl-text-primary);
  --tbl-unplayed: var(--tbl-text-secondary);
  --tbl-control-size: clamp(16px, calc((100vw - 44px) / 5), calc(100vh - 16px));
  position: relative;
  width: 100%;
  height: calc(100% - 8px);
  display: flex;
  align-items: center;
  border-radius: 8px;
  background: transparent;
  overflow: hidden;
  pointer-events: none;
  color: var(--tbl-text-primary);
  transition: background 0.3s;
}
.taskbar-lyric-container.has-cover {
  --tbl-control-size: clamp(16px, calc((100vw - 100vh - 36px) / 5), calc(100vh - 16px));
}
.taskbar-lyric-container.is-pure {
  pointer-events: none;
}
.taskbar-lyric-container[data-align="right"] {
  flex-direction: row-reverse;
}
.taskbar-lyric-container[data-theme="light"] {
  --tbl-text-primary: #1a1a1a;
  --tbl-text-secondary: rgba(0, 0, 0, 0.62);
  --tbl-hover-bg: rgba(0, 0, 0, 0.08);
}
.taskbar-lyric-container.shows-background.show-controls:not(.is-separated) {
  background: var(--tbl-hover-bg);
}
.interactive-zone {
  flex: 0 0 auto;
  align-self: stretch;
  display: flex;
  min-width: 0;
  border-radius: 8px;
  overflow: hidden;
  transition: background 0.3s;
}
.taskbar-lyric-container[data-align="right"] .interactive-zone {
  flex-direction: row-reverse;
}
.taskbar-lyric-container.is-separated .interactive-zone.show-controls {
  background: var(--tbl-hover-bg);
}
.cover-wrapper {
  flex: 0 0 auto;
  height: 100%;
  aspect-ratio: 1 / 1;
  padding: 4px;
  overflow: hidden;
  cursor: default;
  pointer-events: auto;
}
.cover {
  width: 100%;
  height: 100%;
  border-radius: 6px;
  object-fit: cover;
  user-select: none;
  pointer-events: none;
  display: block;
}
.controls-wrapper {
  flex: 0 0 auto;
  align-self: stretch;
  display: flex;
  max-width: 0;
  overflow: hidden;
  pointer-events: none;
  transition: max-width 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}
.controls-inner {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  opacity: 0;
  transition: opacity 0.25s ease;
}
.interactive-zone.show-controls .controls-wrapper {
  max-width: calc(5 * var(--tbl-control-size) + 24px);
  pointer-events: auto;
}
.interactive-zone.show-controls .controls-inner {
  opacity: 1;
  transition-delay: 0.1s;
}
.control-btn {
  flex: 0 0 auto;
  width: var(--tbl-control-size);
  height: var(--tbl-control-size);
  border-radius: 6px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--tbl-text-primary) 24%, transparent);
  color: var(--tbl-text-primary);
  cursor: pointer;
  transition:
    background 0.3s,
    opacity 0.2s,
    transform 0.3s;
}
.control-btn:hover {
  background: color-mix(in srgb, var(--tbl-text-primary) 16%, transparent);
}
.control-btn:active {
  transform: scale(0.9);
}
.control-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.control-icon {
  width: 14px;
  height: 14px;
}
.lyric-stage {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0 4px;
  position: relative;
  height: 100%;
  overflow: hidden;
}
.taskbar-lyric-container.is-separated .lyric-stage {
  pointer-events: none;
}
.lyric-layout {
  position: absolute;
  inset: 0 auto 0 0;
  width: min(
    100%,
    calc(
      var(--tbl-main-content-width) + var(--tbl-background-content-width) +
        var(--tbl-divider-content-width)
    )
  );
  display: flex;
  align-items: stretch;
  overflow: visible;
}
.taskbar-lyric-container[data-align="right"] .lyric-layout {
  inset: 0 0 0 auto;
  flex-direction: row-reverse;
}
.lyric-area {
  flex: 0 1 var(--tbl-main-content-width);
  width: var(--tbl-main-content-width);
  min-width: 0;
  position: relative;
  height: 100%;
  overflow: visible;
  z-index: 1;
}
.lyric-column {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-evenly;
  opacity: 1;
  transition: opacity 0.18s ease;
}
.main-lyric-column {
  right: auto;
  width: max(100%, var(--tbl-main-exit-content-width));
}
.taskbar-lyric-container[data-align="right"] .main-lyric-column {
  left: auto;
  right: 0;
}
.taskbar-lyric-container[data-align="right"] .lyric-column {
  align-items: flex-end;
}
.taskbar-lyric-container.show-song-info .lyric-column {
  opacity: 0;
  pointer-events: none;
}
.background-lyric-group {
  flex: 0 1 calc(var(--tbl-background-content-width) + var(--tbl-divider-content-width));
  width: calc(var(--tbl-background-content-width) + var(--tbl-divider-content-width));
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  overflow: hidden;
}
.taskbar-lyric-container[data-align="right"] .background-lyric-group {
  flex-direction: row-reverse;
}
.background-divider {
  width: 1px;
  height: 54%;
  flex: 0 0 auto;
  margin: 0 8px;
  border-radius: 1px;
  background: currentColor;
  opacity: 0;
  transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.background-lyric-group.has-background .background-divider {
  opacity: 0.28;
}
.taskbar-lyric-container.show-song-info .background-divider {
  opacity: 0;
}
.background-lyric-area {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  position: relative;
  overflow: hidden;
}
.lyric-line {
  width: 100%;
  transform-origin: left center;
  font-weight: var(--tbl-font-weight);
  transition:
    font-size 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    color 0.3s ease;
}
.taskbar-lyric-container[data-align="right"] .lyric-line {
  transform-origin: right center;
}
.lyric-line[data-role="primary"] {
  font-size: var(--tbl-font-size);
  color: var(--tbl-text-primary);
}
.lyric-line[data-role="secondary"] {
  font-size: calc(var(--tbl-font-size) * 0.82);
  color: var(--tbl-text-secondary);
}
.lyric-line[data-kind="translation"] {
  font-weight: var(--tbl-translation-font-weight);
}
.line-move,
.line-enter-active,
.line-leave-active {
  transition:
    transform 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    font-size 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    color 0.3s ease;
}
.line-leave-active {
  position: absolute;
  left: 0;
  right: 0;
}
.line-enter-from {
  opacity: 0;
  transform: translateY(100%);
}
.line-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}
.song-info {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-evenly;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
}
.taskbar-lyric-container[data-align="right"] .song-info {
  align-items: flex-end;
}
.taskbar-lyric-container.show-song-info .song-info {
  opacity: 1;
  transition-delay: 0.08s;
}
.song-title,
.song-artist {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  pointer-events: auto;
}
.song-title {
  width: fit-content;
  font-size: var(--tbl-font-size);
  color: var(--tbl-text-primary);
}
.song-artist {
  width: fit-content;
  font-size: calc(var(--tbl-font-size) * 0.82);
  color: var(--tbl-text-secondary);
}
</style>
