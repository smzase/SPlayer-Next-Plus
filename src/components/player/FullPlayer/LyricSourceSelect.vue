<script setup lang="ts">
import type { PopoverAnchorProps } from "reka-ui";
import { useMediaStore } from "@/stores/media";
import { useLyricPreferenceStore, type SongLyricPreference } from "@/stores/lyricPreference";
import { discoverCurrentTTML } from "@/services/lyric/loader";
import { toast } from "@/composables/useToast";

const { t } = useI18n();
const media = useMediaStore();
const preferences = useLyricPreferenceStore();
const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const anchor = shallowRef<PopoverAnchorProps["reference"]>();
const pinned = computed(() => (media.track ? preferences.getPinned(media.track) : null));
const selected = computed(() => (media.track ? preferences.getPreference(media.track) : "auto"));
const lyricLabel = computed(() => media.activeLyric?.format.toUpperCase() ?? "NO-LRC");
const options = computed<SongLyricPreference[]>(() => [
  "auto",
  "qqmusic",
  "kugou",
  "netease",
  ...(media.ttmlCandidate || selected.value === "ttml" ? ["ttml" as const] : []),
  "self",
]);

watch(open, (value) => {
  if (value && trigger.value) {
    // 弹层打开期间使用原始锚点，图钉改变按钮宽度时不重新居中
    const rect = trigger.value.getBoundingClientRect();
    anchor.value = {
      contextElement: trigger.value,
      getBoundingClientRect: () => rect,
    };
  } else {
    anchor.value = undefined;
  }
  if (value) {
    discoverCurrentTTML().catch((error) =>
      console.warn("[lyricSource] TTML discovery failed:", error),
    );
  }
});

/**
 * 选择来源或切换该来源的固定状态
 * @param preference - 目标来源
 * @param pin - 是否点击图钉
 */
const selectSource = (preference: SongLyricPreference, pin = false): void => {
  if (!media.track) return;
  try {
    if (pin) {
      preferences.setPinned(media.track, pinned.value === preference ? null : preference);
    } else {
      preferences.select(media.track, preference);
      open.value = false;
    }
  } catch (error) {
    console.error("[lyricSource] 保存固定来源失败:", error);
    toast.error(t("settings.lyricSourcePreference.saveFailed"));
  }
};
</script>

<template>
  <SPopover v-model:open="open" side="top" :side-offset="8" cover content-class="!p-1 !rounded-lg">
    <template #anchor>
      <PopoverAnchor :reference="anchor ?? trigger" class="hidden" />
    </template>
    <template #trigger>
      <button
        ref="trigger"
        type="button"
        class="inline-flex items-center justify-center gap-1 leading-none px-1.5 py-1.2 rounded-md border border-solid border-cover/30 bg-transparent text-inherit cursor-pointer transition-colors hover:border-cover/60 focus-visible:outline-cover"
        :title="
          pinned !== null
            ? t('settings.lyricSourcePreference.pinned')
            : t('settings.lyricSourcePreference.label')
        "
        :aria-label="t('settings.lyricSourcePreference.label')"
      >
        <IconLucidePin
          v-if="pinned !== null"
          class="size-3 rotate-45 text-cover"
          aria-hidden="true"
        />
        {{ lyricLabel }}
      </button>
    </template>
    <div class="min-w-30" role="group" :aria-label="t('settings.lyricSourcePreference.label')">
      <div
        v-for="option in options"
        :key="option"
        class="flex h-8 items-center rounded-md transition-colors duration-200 hover:bg-white/10"
        :class="selected === option ? 'text-cover' : 'text-cover/80'"
      >
        <button
          type="button"
          class="flex items-center justify-center w-6 h-full shrink-0 rounded-md border-none bg-transparent text-cover leading-5 cursor-pointer focus-visible:outline-cover"
          :title="
            t(
              pinned === option
                ? 'settings.lyricSourcePreference.unpin'
                : 'settings.lyricSourcePreference.pin',
              { source: t(`settings.lyricSourcePreference.${option}`) },
            )
          "
          :aria-label="
            t(
              pinned === option
                ? 'settings.lyricSourcePreference.unpin'
                : 'settings.lyricSourcePreference.pin',
              { source: t(`settings.lyricSourcePreference.${option}`) },
            )
          "
          :aria-pressed="pinned === option"
          @click="selectSource(option, true)"
        >
          <IconLucidePin
            class="block size-3.5 shrink-0 rotate-45 translate-y-px transition-opacity duration-200"
            :class="pinned === option ? 'opacity-100' : 'opacity-25'"
          />
        </button>
        <button
          type="button"
          class="flex flex-1 items-center gap-2 h-full pl-0.5 pr-2 rounded-md border-none bg-transparent text-inherit text-left leading-5 cursor-pointer focus-visible:outline-cover"
          :aria-pressed="selected === option"
          @click="selectSource(option)"
        >
          <span class="flex-1 whitespace-nowrap">
            {{ t(`settings.lyricSourcePreference.${option}`) }}
          </span>
          <IconLucideCheck
            class="block size-3.5 shrink-0"
            :class="selected === option ? 'opacity-100' : 'opacity-0'"
          />
        </button>
      </div>
    </div>
  </SPopover>
</template>
