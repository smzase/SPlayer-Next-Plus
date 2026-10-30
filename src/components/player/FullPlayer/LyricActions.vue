<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { lyricPreferenceKey } from "@/stores/lyricPreference";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { formatSignedSec } from "@/utils/time";
import { clearCurrentLyricCache } from "@/services/lyric/loader";
import { toast } from "@/composables/useToast";

defineProps<{
  /** 是否处于沉浸模式 */
  immersive: boolean;
}>();

const { t } = useI18n();
const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();
const titaniumActive = computed(
  () =>
    settings.player.playerBgType === "animation" && settings.player.playerBgRenderer === "titanium",
);
const settingsDialog = useSettingsDialog();

/** 歌词偏移步长（ms） */
const LYRIC_OFFSET_STEP = 500;

/** 偏移弹层是否打开；打开期间按钮组保持可见 */
const offsetPopoverOpen = ref(false);

const hasTrack = computed(() => !!media.track);

/** 当前是否有可复制的歌词 */
const hasLyric = computed(() => media.parsedLyric.length > 0);

/** 复制歌词弹窗是否打开 */
const copyDialogOpen = ref(false);

/** 当前曲目偏移（ms） */
const songOffset = computed(() => status.lyricOffsetMs);

/** 写入偏移 */
const writeOffset = (offsetMs: number): void => {
  const id = media.track?.id;
  if (!id) return;
  window.api.nowPlaying.setLyricOffset(id, offsetMs);
};

/** 弹层里直接编辑（ms） */
const offsetInputMs = computed<number | null>({
  get: () => songOffset.value,
  set: (val) => writeOffset(val ?? 0),
});

const advanceLyric = (): void => writeOffset(songOffset.value + LYRIC_OFFSET_STEP);
const delayLyric = (): void => writeOffset(songOffset.value - LYRIC_OFFSET_STEP);
const resetLyricOffset = (): void => writeOffset(0);

const clearingCache = ref(false);
const cachePopoverOpen = ref(false);

watch(
  () => (media.track ? lyricPreferenceKey(media.track) : null),
  () => {
    cachePopoverOpen.value = false;
  },
);

/** 清理当前歌曲歌词缓存，并反馈清理结果 */
const clearLyricCache = async (): Promise<void> => {
  if (clearingCache.value || !media.track) return;
  cachePopoverOpen.value = false;
  if (typeof window.api.lyrics.clearTrackCache !== "function") {
    toast.warning(t("player.lyricCache.restartRequired"));
    return;
  }
  clearingCache.value = true;
  try {
    await clearCurrentLyricCache();
    toast.success(t("player.lyricCache.cleared"));
  } catch (error) {
    console.error("[lyricCache] 清理失败:", error);
    if (
      error instanceof Error &&
      error.message.includes("No handler registered for 'lyrics:clearTrackCache'")
    ) {
      toast.warning(t("player.lyricCache.restartRequired"));
    } else {
      toast.error(t("player.lyricCache.failed"));
    }
  } finally {
    clearingCache.value = false;
  }
};
</script>

<template>
  <div
    class="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 transition-opacity duration-300"
    :class="
      immersive
        ? 'opacity-0 pointer-events-none'
        : offsetPopoverOpen || cachePopoverOpen
          ? 'opacity-100 pointer-events-auto'
          : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
    "
  >
    <SButton
      type="cover"
      variant="ghost"
      circle
      :size="40"
      :disabled="!hasLyric"
      @click="copyDialogOpen = true"
    >
      <template #icon><IconLucideCopy /></template>
    </SButton>
    <div class="h-px w-6 bg-cover/25 my-1" />
    <SButton
      type="cover"
      variant="ghost"
      circle
      :size="40"
      :disabled="!hasTrack"
      @click="advanceLyric"
    >
      <template #icon><IconLucidePlus /></template>
    </SButton>
    <SPopover v-model:open="offsetPopoverOpen" trigger="click" side="left" :side-offset="8" cover>
      <template #trigger>
        <div
          class="inline-flex items-center justify-center gap-0.5 h-6 w-10 rounded-md cursor-pointer border border-solid border-cover/30 bg-cover/8 hover:bg-cover/15 transition-colors tabular-nums"
          :class="!hasTrack ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''"
        >
          <span class="text-xs font-medium text-cover">
            {{ formatSignedSec(songOffset) }}
          </span>
          <span class="text-[10px] text-cover/60">s</span>
        </div>
      </template>
      <div class="flex flex-col gap-2 w-44">
        <h4 class="m-0 text-sm font-medium leading-tight text-cover">
          {{ t("player.lyricOffset.title") }}
        </h4>
        <p class="m-0 text-xs text-cover/60">{{ t("player.lyricOffset.hint") }}</p>
        <SNumberInput
          v-model="offsetInputMs"
          :step="100"
          size="small"
          unit="ms"
          placeholder="0"
          cover
        />
        <SButton
          type="cover"
          variant="secondary"
          size="tiny"
          :disabled="songOffset === 0"
          @click="resetLyricOffset"
        >
          {{ t("common.reset") }}
        </SButton>
      </div>
    </SPopover>
    <SButton
      type="cover"
      variant="ghost"
      circle
      :size="40"
      :disabled="!hasTrack"
      @click="delayLyric"
    >
      <template #icon><IconLucideMinus /></template>
    </SButton>
    <div class="h-px w-6 bg-cover/25 my-1" />
    <SButton type="cover" variant="ghost" circle :size="40" @click="settingsDialog.show('lyric')">
      <template #icon><IconLucideSettings2 /></template>
    </SButton>
    <SButton
      type="cover"
      :variant="titaniumActive ? 'secondary' : 'ghost'"
      circle
      :size="40"
      :aria-pressed="titaniumActive"
      :title="t(titaniumActive ? 'player.titanium.restore' : 'player.titanium.enable')"
      :aria-label="t(titaniumActive ? 'player.titanium.restore' : 'player.titanium.enable')"
      @click="settings.toggleTitaniumBackground"
    >
      <template #icon><IconSpTitaniumBackground /></template>
    </SButton>
    <SPopover v-model:open="cachePopoverOpen" trigger="click" side="left" :side-offset="8" cover>
      <template #trigger>
        <SButton
          type="cover"
          variant="ghost"
          circle
          :size="40"
          :disabled="!hasTrack"
          :loading="clearingCache"
          :title="t('player.lyricCache.clear')"
          :aria-label="t('player.lyricCache.clear')"
        >
          <template #icon><IconLucideTrash2 /></template>
        </SButton>
      </template>
      <div class="flex flex-col gap-3 w-56">
        <h4 class="m-0 text-sm font-medium text-cover">{{ t("player.lyricCache.clear") }}</h4>
        <p class="m-0 text-xs text-cover/70">{{ t("player.lyricCache.confirmHint") }}</p>
        <div class="flex justify-end gap-2">
          <SButton type="cover" variant="ghost" size="small" @click="cachePopoverOpen = false">
            {{ t("common.cancel") }}
          </SButton>
          <SButton
            type="cover"
            variant="secondary"
            size="small"
            :disabled="!hasTrack"
            :loading="clearingCache"
            @click="clearLyricCache"
          >
            {{ t("player.lyricCache.confirm") }}
          </SButton>
        </div>
      </div>
    </SPopover>
    <CopyLyricsDialog v-model:open="copyDialogOpen" />
  </div>
</template>
