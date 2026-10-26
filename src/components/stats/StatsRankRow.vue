<script setup lang="ts">
import type { Track } from "@shared/types/player";
import { formatCompact } from "@/utils/format";

/** 榜单内的歌曲、专辑或歌手 */
export interface RankItem {
  cover?: string;
  title: string;
  subtitle?: string;
  plays: number;
  track: Track;
  artistId?: string;
}

defineProps<{ item: RankItem; index: number; circle: boolean }>();
const { t, locale } = useI18n();
</script>

<template>
  <div
    v-if="index === 0"
    data-stats-track
    class="grid h-26 w-full cursor-pointer grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 rounded-2xl bg-primary/8 p-3 text-left transition-colors duration-200 hover:bg-primary/11"
  >
    <SImg
      :src="item.cover"
      :alt="item.title"
      class="size-20 ring-1 ring-inset ring-black/10 dark:ring-white/10"
      :class="circle ? 'rounded-full' : 'rounded-xl'"
    />
    <div class="relative h-20 min-w-0">
      <div class="flex h-full min-w-0 flex-col justify-between py-1.5">
        <div class="min-w-0 pr-12">
          <div class="truncate text-base font-semibold leading-tight text-on-surface">
            {{ item.title }}
          </div>
          <div
            v-if="item.subtitle"
            class="mt-1 truncate text-xs leading-none text-on-surface-variant/60"
          >
            {{ item.subtitle }}
          </div>
        </div>
        <div class="flex items-baseline gap-1 tabular-nums">
          <span class="text-3xl font-bold leading-none text-on-surface">
            {{ formatCompact(item.plays, locale) }}
          </span>
          <span class="text-[11px] font-medium text-on-surface-variant/55">
            {{ t("stats.playsUnit") }}
          </span>
        </div>
      </div>
      <span class="absolute right-0 top-1 text-xs font-bold tracking-wider text-primary">
        TOP 1
      </span>
    </div>
  </div>
  <div
    v-else
    data-stats-track
    class="group grid h-14 w-full cursor-pointer grid-cols-[1.25rem_2.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl p-1.5 text-left transition-colors duration-200 hover:bg-on-surface/6"
  >
    <span
      class="text-center text-xs font-bold text-on-surface-variant/45 tabular-nums transition-colors duration-200 group-hover:text-primary"
    >
      {{ String(index + 1).padStart(2, "0") }}
    </span>
    <SImg
      :src="item.cover"
      :alt="item.title"
      class="size-11 ring-1 ring-inset ring-black/10 dark:ring-white/10"
      :class="circle ? 'rounded-full' : 'rounded-lg'"
    />
    <div class="min-w-0">
      <div class="truncate text-sm font-medium text-on-surface">{{ item.title }}</div>
      <div v-if="item.subtitle" class="mt-0.5 truncate text-xs text-on-surface-variant/50">
        {{ item.subtitle }}
      </div>
    </div>
    <div class="ml-2 shrink-0 text-right tabular-nums">
      <div class="text-xl font-bold leading-none text-on-surface">
        {{ formatCompact(item.plays, locale) }}
      </div>
      <div class="text-[10px] text-on-surface-variant/45">{{ t("stats.playsUnit") }}</div>
    </div>
  </div>
</template>
