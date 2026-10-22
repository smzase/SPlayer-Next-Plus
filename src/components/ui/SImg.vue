<script setup lang="ts">
import defaultFallback from "@/assets/images/song.jpg";

export interface SImgProps {
  /** 图片地址 */
  src?: string;
  /** 占位图地址 */
  fallback?: string;
  /** alt 文字 */
  alt?: string;
}

const props = withDefaults(defineProps<SImgProps>(), {
  fallback: defaultFallback,
  alt: "",
});

const emit = defineEmits<{
  load: [el: HTMLImageElement];
}>();

const isLoaded = ref(false);
const showFallback = ref(true);
const FADE_DURATION = 200;
let loadToken = 0;
let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

const clearFallbackTimer = (): void => {
  if (!fallbackTimer) return;
  clearTimeout(fallbackTimer);
  fallbackTimer = undefined;
};

const onLoad = async (e: Event): Promise<void> => {
  const target = e.target as HTMLImageElement;
  const token = loadToken;
  const source = props.src;
  try {
    await target.decode();
  } catch {
    // load 事件已确认资源可用，解码失败时仍交给浏览器正常绘制
  }
  if (token !== loadToken || source !== props.src || target.getAttribute("src") !== source) return;
  isLoaded.value = true;
  emit("load", target);
  clearFallbackTimer();
  fallbackTimer = setTimeout(() => {
    fallbackTimer = undefined;
    if (token === loadToken) showFallback.value = false;
  }, FADE_DURATION);
};

const onError = (): void => {
  clearFallbackTimer();
  isLoaded.value = false;
  showFallback.value = true;
};

watch(
  () => props.src,
  () => {
    loadToken += 1;
    clearFallbackTimer();
    isLoaded.value = false;
    showFallback.value = true;
  },
);

onBeforeUnmount(clearFallbackTimer);
</script>

<template>
  <div class="relative isolate overflow-hidden">
    <img
      v-if="showFallback"
      :src="fallback"
      :alt="alt"
      class="absolute z-0 h-full w-full object-cover"
    />
    <img
      v-if="src"
      data-cover-image
      :src="src"
      :alt="alt"
      class="absolute inset-0 z-1 h-full w-full object-cover transition-opacity duration-200"
      :class="isLoaded ? 'opacity-100' : 'opacity-0'"
      decoding="async"
      loading="lazy"
      @load="onLoad"
      @error="onError"
    />
  </div>
</template>
