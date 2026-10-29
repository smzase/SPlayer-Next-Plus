<script setup lang="ts">
import type { TaskbarLyricSettings } from "@shared/types/settings";
import type { TaskbarPlaybackSnapshot, TaskbarQueueItem } from "@shared/types/taskbarLyric";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";
import SVirtualList from "@/components/ui/SVirtualList.vue";
import DragSortPreview from "@/components/list/DragSortPreview.vue";
import { useDragSort } from "@/composables/useDragSort";
import { moveItemsToGap } from "@shared/utils/reorder";
import DEFAULT_COVER from "@/assets/images/song.jpg";
import IconListMusic from "~icons/lucide/list-music";
import IconLocate from "~icons/lucide/locate";
import IconTrash2 from "~icons/lucide/trash-2";
import IconX from "~icons/lucide/x";

const snapshot = shallowRef<TaskbarPlaybackSnapshot>({
  items: [],
  currentTrackId: null,
  playMode: "repeat-list",
  playModeDisabled: true,
  dragRightClickAction: "cancel",
  locale: "zh-CN",
  theme: {
    isDark: true,
    appearanceStyle: "solid",
    imageBackground: {
      src: "",
      blur: 0,
      dim: 0.4,
      scale: 1.2,
    },
    primary: "244 244 245",
    primaryContainer: "63 63 70",
    surface: "16 16 20",
    surfaceAlt: "39 39 42",
    surfacePanel: "24 24 28",
    surfaceBright: "72 72 78",
    onSurface: "244 244 245",
    onSurfaceVariant: "161 161 170",
    outline: "82 82 91",
    outlineVariant: "63 63 70",
  },
});
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
const listRef = shallowRef<SVirtualListExposed | null>(null);
const unsubscribers: Array<() => void> = [];
const queueVisible = ref(false);

const effectiveTheme = computed<"light" | "dark">(() =>
  snapshot.value.theme.isDark ? "dark" : "light",
);

const queueStyle = computed(() => {
  const palette = snapshot.value.theme;
  return {
    "--queue-primary": palette.primary,
    "--queue-primary-container": palette.primaryContainer,
    "--queue-surface": palette.surface,
    "--queue-surface-alt": palette.surfaceAlt,
    "--queue-surface-panel": palette.surfacePanel,
    "--queue-surface-bright": palette.surfaceBright,
    "--queue-on-surface": palette.onSurface,
    "--queue-on-surface-variant": palette.onSurfaceVariant,
    "--queue-outline": palette.outline,
    "--queue-outline-variant": palette.outlineVariant,
    fontFamily: config.fontFamily || undefined,
  };
});

const effectiveAppearance = computed(() => snapshot.value.theme.appearanceStyle);
const backgroundImage = computed(() => snapshot.value.theme.imageBackground);
const backgroundVisible = computed(
  () => effectiveAppearance.value === "image" && !!backgroundImage.value.src,
);
const backgroundImageStyle = computed<Record<string, string>>(() => ({
  filter: backgroundImage.value.blur > 0 ? `blur(${backgroundImage.value.blur}px)` : "none",
  transform: `scale(${backgroundImage.value.scale})`,
}));
const backgroundDimStyle = computed(() => ({
  opacity: backgroundImage.value.dim,
}));

const items = computed(() => snapshot.value.items);
const clearConfirmOpen = ref(false);
const {
  isDragging,
  draggedIndex,
  dropIndicator,
  dragLabelData,
  dragLabelPosition,
  handlePointerDown,
  suppressClick,
  cancelDrag,
} = useDragSort({
  virtualListRef: listRef,
  itemCount: computed(() => items.value.length),
  enabled: computed(() => queueVisible.value && !clearConfirmOpen.value),
  rightClickAction: computed(() => snapshot.value.dragRightClickAction),
  triggerMode: "longpress",
  onReorder: (from, to, gap) => {
    const trackId = items.value[from].id;
    const next = moveItemsToGap(items.value, [from], gap);
    snapshot.value = { ...snapshot.value, items: next };
    window.api.taskbarLyric.moveTrack(trackId, next[to + 1]?.id ?? null);
  },
});
const currentIndex = computed(() =>
  items.value.findIndex((item) => item.id === snapshot.value.currentTrackId),
);
const isChinese = computed(() => snapshot.value.locale === "zh-CN");
const title = computed(() => (isChinese.value ? "播放列表" : "Queue"));
const total = computed(() =>
  isChinese.value ? `${items.value.length} 首歌曲` : `${items.value.length} songs`,
);
const emptyText = computed(() => (isChinese.value ? "播放列表为空" : "Queue is empty"));
const locateTitle = computed(() => (isChinese.value ? "跳转到正在播放" : "Go to current track"));
const clearTitle = computed(() => (isChinese.value ? "清空播放列表" : "Clear queue"));
const closeTitle = computed(() => (isChinese.value ? "关闭播放列表" : "Close queue"));
const removeTitle = computed(() => (isChinese.value ? "从播放列表移除" : "Remove from queue"));
const clearConfirmTitle = computed(() =>
  isChinese.value ? "确认清空播放列表？" : "Clear the entire queue?",
);
const clearConfirmText = computed(() =>
  isChinese.value ? "此操作不可撤销。" : "This action cannot be undone.",
);
const cancelText = computed(() => (isChinese.value ? "取消" : "Cancel"));
const confirmText = computed(() => (isChinese.value ? "确认" : "Confirm"));
/**
 * 应用主窗口队列快照，歌曲变化时取消尚未提交的拖动
 * @param next - 最新播放与主题信息
 */
const applySnapshot = (next: TaskbarPlaybackSnapshot): void => {
  if (
    next.items.length !== items.value.length ||
    next.items.some((item, index) => item.id !== items.value[index]?.id)
  ) {
    cancelDrag();
  }
  snapshot.value = next;
};

const playItem = (item: TaskbarQueueItem): void => {
  window.api.taskbarLyric.playTrack(item.id);
  window.api.taskbarLyric.closeQueue();
};

const scrollToCurrent = (): void => {
  if (currentIndex.value >= 0) listRef.value?.scrollToIndex(currentIndex.value);
};

const removeItem = (index: number): void => {
  window.api.taskbarLyric.removeTrack(index);
};

const clearQueue = (): void => {
  window.api.taskbarLyric.clearQueue();
  clearConfirmOpen.value = false;
};

const closeQueue = (): void => {
  window.api.taskbarLyric.closeQueue();
};

watch(
  () => snapshot.value.currentTrackId,
  () => nextTick(scrollToCurrent),
);

const handleKeyDown = (event: KeyboardEvent): void => {
  if (event.key !== "Escape") return;
  if (clearConfirmOpen.value) {
    clearConfirmOpen.value = false;
    return;
  }
  closeQueue();
};

onMounted(async () => {
  unsubscribers.push(
    window.api.taskbarLyric.onPlaybackChange(applySnapshot),
    window.api.taskbarLyric.onConfigChange((next) => Object.assign(config, next)),
    window.api.taskbarLyric.onQueueVisibilityChange((visible) => {
      queueVisible.value = visible;
    }),
  );
  try {
    const saved = (await window.api.config.get("taskbarLyric")) as TaskbarLyricSettings | null;
    if (saved) Object.assign(config, saved);
  } catch (error) {
    console.error("[taskbar-queue] load config failed", error);
  }
  try {
    applySnapshot(await window.api.taskbarLyric.requestPlayback());
  } catch (error) {
    console.error("[taskbar-queue] request playback failed", error);
  }
  window.addEventListener("keydown", handleKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeyDown);
  for (const off of unsubscribers) off();
});
</script>

<template>
  <div
    class="queue-root"
    :class="{ 'is-visible': queueVisible }"
    :data-theme="effectiveTheme"
    :data-appearance="effectiveAppearance"
    :style="queueStyle"
    :aria-hidden="!queueVisible"
    @click.capture="suppressClick"
    @dblclick.capture="suppressClick"
    @contextmenu.capture="suppressClick"
    @dragstart.prevent
  >
    <div v-if="backgroundVisible" class="queue-background" aria-hidden="true">
      <img
        :src="backgroundImage.src"
        class="queue-background-image"
        :style="backgroundImageStyle"
        alt=""
        draggable="false"
        decoding="async"
      />
      <div class="queue-background-dim" :style="backgroundDimStyle" />
    </div>
    <section class="queue-panel">
      <header class="queue-header">
        <div class="queue-heading">
          <IconListMusic class="queue-header-icon" />
          <div class="queue-heading-text">
            <strong>{{ title }}</strong>
            <span>{{ total }}</span>
          </div>
        </div>
        <div class="queue-actions">
          <button
            class="queue-action-button"
            type="button"
            :disabled="items.length === 0"
            :title="locateTitle"
            :aria-label="locateTitle"
            @click="scrollToCurrent"
          >
            <IconLocate />
          </button>
          <button
            class="queue-action-button"
            type="button"
            :disabled="items.length === 0"
            :title="clearTitle"
            :aria-label="clearTitle"
            @click="clearConfirmOpen = true"
          >
            <IconTrash2 />
          </button>
          <button
            class="queue-action-button"
            type="button"
            :title="closeTitle"
            :aria-label="closeTitle"
            @click="closeQueue"
          >
            <IconX />
          </button>
        </div>
      </header>

      <div v-if="items.length > 0" class="queue-list">
        <SVirtualList
          ref="listRef"
          :items="items"
          :item-height="58"
          item-fixed
          height="100%"
          hide-scrollbar
          :default-scroll-index="Math.max(0, currentIndex)"
          :get-item-key="(item: TaskbarQueueItem) => item.id"
        >
          <template #default="{ item, index }: { item: TaskbarQueueItem; index: number }">
            <div
              class="queue-item"
              :class="{
                'is-current': item.id === snapshot.currentTrackId,
                'is-dragging': isDragging && draggedIndex === index,
              }"
              role="button"
              tabindex="0"
              @mousedown="handlePointerDown($event, index, item)"
              @touchstart.passive="handlePointerDown($event, index, item)"
              @click="playItem(item)"
              @keydown.enter.prevent="playItem(item)"
            >
              <span
                v-if="isDragging && dropIndicator.index === index"
                class="queue-drop-indicator"
                :class="dropIndicator.position === 'top' ? 'is-top' : 'is-bottom'"
              />
              <img
                class="queue-cover"
                :src="item.cover || DEFAULT_COVER"
                alt=""
                draggable="false"
                decoding="async"
                @error="($event.target as HTMLImageElement).src = DEFAULT_COVER"
              />
              <span class="queue-item-copy">
                <span class="queue-item-title">{{ item.title }}</span>
                <span class="queue-item-artist">
                  {{ item.artists || (isChinese ? "未知艺术家" : "Unknown artist") }}
                </span>
              </span>
              <button
                class="queue-item-remove"
                type="button"
                :title="removeTitle"
                :aria-label="removeTitle"
                @click.stop="removeItem(index)"
              >
                <IconX />
              </button>
            </div>
          </template>
        </SVirtualList>
      </div>

      <div v-else class="queue-empty">
        <IconListMusic class="queue-empty-icon" />
        <span>{{ emptyText }}</span>
      </div>
    </section>
    <DragSortPreview
      v-if="isDragging && dragLabelData"
      :track="dragLabelData"
      :position="dragLabelPosition"
      compact
      :style="{
        '--drag-preview-surface': snapshot.theme.surfaceBright,
        '--drag-preview-text': snapshot.theme.onSurface,
      }"
    />
    <div v-if="clearConfirmOpen" class="queue-confirm-overlay">
      <div class="queue-confirm" role="dialog" aria-modal="true" :aria-label="clearConfirmTitle">
        <strong>{{ clearConfirmTitle }}</strong>
        <span>{{ clearConfirmText }}</span>
        <div class="queue-confirm-actions">
          <button type="button" @click="clearConfirmOpen = false">{{ cancelText }}</button>
          <button type="button" class="is-danger" @click="clearQueue">{{ confirmText }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.queue-item.is-dragging {
  opacity: 0.3;
}
.queue-drop-indicator {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 999px;
  background: rgb(var(--queue-primary));
  pointer-events: none;
  z-index: 1;
}
.queue-drop-indicator.is-top {
  top: -2px;
}
.queue-drop-indicator.is-bottom {
  bottom: -2px;
}
.queue-root {
  position: relative;
  width: 100vw;
  height: 100vh;
  padding: 8px;
  color: rgb(var(--queue-on-surface));
  opacity: 0;
  transform: translateY(6px);
  pointer-events: none;
  transition:
    opacity 150ms ease-in,
    transform 150ms ease-in;
}
.queue-root.is-visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
  transition-duration: 200ms;
  transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
}
.queue-background {
  position: absolute;
  inset: 8px;
  overflow: hidden;
  border-radius: 8px;
  pointer-events: none;
}
.queue-background-image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
.queue-background-dim {
  position: absolute;
  inset: 0;
  background: #000;
}
.queue-panel {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgb(var(--queue-on-surface) / 0.08);
  border-radius: 8px;
  background: rgb(var(--queue-surface-bright));
}
.queue-root[data-appearance="image"] .queue-panel {
  background: rgb(var(--queue-surface-bright) / 0.55);
  backdrop-filter: blur(18px) saturate(1.2);
}
.queue-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 58px;
  padding: 0 14px;
  border-bottom: 1px solid rgb(var(--queue-on-surface) / 0.08);
}
.queue-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 auto;
  min-width: 0;
}
.queue-header-icon {
  width: 18px;
  height: 18px;
  opacity: 0.78;
}
.queue-heading-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}
.queue-heading-text strong {
  font-size: 14px;
  line-height: 1.2;
  font-weight: 600;
}
.queue-heading-text span {
  color: rgb(var(--queue-on-surface-variant) / 0.72);
  font-size: 11px;
  line-height: 1.2;
}
.queue-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
.queue-action-button,
.queue-item-remove {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  color: rgb(var(--queue-on-surface));
  background: transparent;
  cursor: pointer;
  transition:
    color 0.16s ease,
    background 0.16s ease,
    opacity 0.16s ease;
}
.queue-action-button:hover,
.queue-item-remove:hover {
  background: rgb(var(--queue-on-surface) / 0.08);
}
.queue-action-button:active,
.queue-item-remove:active {
  background: rgb(var(--queue-on-surface) / 0.14);
}
.queue-action-button:disabled {
  opacity: 0.3;
  cursor: default;
}
.queue-action-button svg,
.queue-item-remove svg {
  width: 15px;
  height: 15px;
}
.queue-list {
  flex: 1 1 auto;
  min-height: 0;
  padding: 6px 4px;
}
.queue-item {
  position: relative;
  width: 100%;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    opacity 0.15s ease;
}
.queue-item:hover {
  background: rgb(var(--queue-on-surface) / 0.08);
}
.queue-item:active {
  background: rgb(var(--queue-on-surface) / 0.14);
}
.queue-item.is-current {
  color: rgb(var(--queue-primary));
  background: rgb(var(--queue-primary) / 0.15);
}
.queue-item.is-current .queue-item-artist {
  color: rgb(var(--queue-primary) / 0.7);
}
.queue-cover {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border-radius: 5px;
  object-fit: cover;
  box-shadow: 0 0 0 1px rgb(var(--queue-outline-variant) / 0.5);
}
.queue-item-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.queue-item-title,
.queue-item-artist {
  display: block;
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.queue-item-title {
  font-size: 12px;
  line-height: 1.2;
  font-weight: 500;
}
.queue-item-artist {
  color: rgb(var(--queue-on-surface-variant) / 0.72);
  font-size: 11px;
  line-height: 1.2;
}
.queue-item-remove {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  opacity: 0;
}
.queue-item:hover .queue-item-remove,
.queue-item:focus-within .queue-item-remove {
  opacity: 1;
}
.queue-item:focus-visible {
  outline: 1px solid rgb(var(--queue-primary) / 0.72);
  outline-offset: -1px;
}
.queue-confirm-overlay {
  position: absolute;
  z-index: 2;
  inset: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  border-radius: 8px;
  background: rgb(var(--queue-surface) / 0.82);
}
.queue-confirm {
  width: min(280px, 100%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px;
  border: 1px solid rgb(var(--queue-outline-variant) / 0.8);
  border-radius: 10px;
  color: rgb(var(--queue-on-surface));
  background: rgb(var(--queue-surface-panel));
}
.queue-confirm strong {
  font-size: 14px;
}
.queue-confirm > span {
  color: rgb(var(--queue-on-surface-variant));
  font-size: 12px;
}
.queue-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.queue-confirm-actions button {
  min-width: 64px;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 15px;
  color: rgb(var(--queue-on-surface));
  background: rgb(var(--queue-surface-alt));
  cursor: pointer;
}
.queue-confirm-actions button:hover {
  background: rgb(var(--queue-surface-bright));
}
.queue-confirm-actions .is-danger {
  color: #fff;
  background: #c62828;
}
@media (hover: none) {
  .queue-item-remove {
    opacity: 1;
  }
}
.queue-empty {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgb(var(--queue-on-surface-variant) / 0.56);
  font-size: 12px;
}
.queue-empty-icon {
  width: 30px;
  height: 30px;
  opacity: 0.6;
}
@media (prefers-reduced-motion: reduce) {
  .queue-root,
  .queue-root.is-visible {
    transition-duration: 0.01ms;
  }
}
</style>
