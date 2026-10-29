<script setup lang="ts">
import type { DragSortPreviewData } from "@/composables/useDragSort";
import SImg from "@/components/ui/SImg.vue";

defineProps<{
  /** 当前拖动歌曲的轻量信息 */
  track: DragSortPreviewData;
  /** 指针在窗口内的位置 */
  position: { top: number; left: number };
  /** 批量拖动的选中数量文案 */
  selectionLabel?: string;
  /** 播放列表使用紧凑浮层 */
  compact?: boolean;
}>();
</script>

<template>
  <div
    class="drag-preview fixed z-9999 flex items-center shadow-lg pointer-events-none select-none"
    :class="compact ? 'is-compact gap-2 p-1.5 rounded-lg' : 'gap-2.5 p-2 rounded-xl'"
    :style="{
      top: `clamp(8px, ${position.top + 12}px, calc(100vh - ${compact ? 56 : 72}px))`,
      left: `clamp(8px, ${position.left + 12}px, calc(100vw - ${compact ? 228 : 288}px))`,
    }"
    aria-hidden="true"
  >
    <SImg :src="track.cover" class="shrink-0 rounded-md" :class="compact ? 'size-8' : 'size-11'" />
    <div class="flex-1 min-w-0">
      <div class="font-medium truncate" :class="compact ? 'text-xs' : 'text-sm'">
        {{ track.title }}
      </div>
      <div class="opacity-60 truncate mt-0.5" :class="compact ? 'text-[11px]' : 'text-xs'">
        {{ track.artists }}
      </div>
    </div>
    <span v-if="selectionLabel" class="shrink-0 text-xs opacity-70">{{ selectionLabel }}</span>
  </div>
</template>

<style scoped>
.drag-preview {
  width: 280px;
  max-width: calc(100vw - 16px);
  box-sizing: border-box;
  background: rgb(var(--drag-preview-surface, var(--s-surface-bright)));
  color: rgb(var(--drag-preview-text, var(--s-on-surface)));
}
.drag-preview.is-compact {
  width: 220px;
}
</style>
