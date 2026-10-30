<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import DEFAULT_COVER from "@/assets/images/song.jpg";
import type { PlayerBgRenderer, PlayerBgType } from "@/types/settings";
import FluidTransition from "./background/FluidTransition.vue";

/** 流体渲染器按需加载 */
const BackgroundRender = defineAsyncComponent(() => import("./BackgroundRender.vue"));

const props = defineProps<{
  /** 保持背景到面板退出动画结束 */
  visible: boolean;
  /** 允许初始化流体渲染器 */
  active: boolean;
}>();

const media = useMediaStore();
const settings = useSettingsStore();
const status = useStatusStore();

interface BackgroundLayer {
  id: number;
  type: PlayerBgType;
  renderer: PlayerBgRenderer;
  ready: boolean;
  failed?: boolean;
}

const documentVisibility = useDocumentVisibility();
const reducedMotion = usePreferredReducedMotion();
const canAnimate = computed(
  () => props.visible && status.isPlayerExpanded && documentVisibility.value === "visible",
);
const layers = shallowRef<BackgroundLayer[]>([]);
const layerElements = ref<HTMLElement[]>([]);
const fluidTransition = shallowRef<{ from: HTMLElement; to: HTMLElement }>();
let layerId = 0;
let fadeTimer: ReturnType<typeof setTimeout> | undefined;
let readyFrame = 0;
let disposed = false;
const desiredBackground = computed(() => ({
  type:
    settings.player.playerBgType === "animation" && !props.active
      ? ("blur" as const)
      : settings.player.playerBgType,
  renderer: settings.player.playerBgRenderer,
}));

/** 释放旧图层与临时流场，再处理过渡期间收到的最后一次切换 */
const finishTransition = (): void => {
  clearTimeout(fadeTimer);
  fadeTimer = undefined;
  fluidTransition.value = undefined;
  layers.value = layers.value.slice(-1);
  syncBackground();
};

/** 图形资源失效时恢复普通淡入，保持当前画面可用 */
const fallbackTransition = (): void => {
  const incoming = fluidTransition.value?.to;
  if (incoming) incoming.style.opacity = "0";
  fluidTransition.value = undefined;
  fadeTimer = setTimeout(finishTransition, 650);
};

/**
 * 首帧就绪后接续新背景，流体之间沿共享流场变形，旧画布保留到过渡结束
 * @param id - 已完成初始化的图层标识
 */
const revealLayer = (id: number): void => {
  const layer = layers.value.find((item) => item.id === id);
  if (!layer || layer.ready) return;
  const previous = layers.value[0];
  if (
    previous.type === "animation" &&
    layer.type === "animation" &&
    !previous.failed &&
    !layer.failed &&
    canAnimate.value &&
    reducedMotion.value !== "reduce"
  ) {
    const from = layerElements.value.find(
      (element) => element.dataset.layerId === String(previous.id),
    );
    const to = layerElements.value.find((element) => element.dataset.layerId === String(id));
    if (from && to) fluidTransition.value = { from, to };
  }
  layers.value = layers.value.map((item) => (item.id === id ? { ...item, ready: true } : item));
  if (layers.value.length > 1 && !fluidTransition.value) {
    fadeTimer = setTimeout(finishTransition, 650);
  }
};

/** 同步目标背景，连续切换时最多保留两个渲染图层 */
const syncBackground = (): void => {
  if (!props.visible) {
    clearTimeout(fadeTimer);
    cancelAnimationFrame(readyFrame);
    fluidTransition.value = undefined;
    layers.value = [];
    return;
  }
  if (layers.value.length > 1) return;
  const desired = desiredBackground.value;
  const current = layers.value[0];
  if (
    current?.type === desired.type &&
    (desired.type !== "animation" || current.renderer === desired.renderer)
  )
    return;
  if (!current && desired.type === "animation") {
    layers.value = [{ id: ++layerId, type: "blur", renderer: desired.renderer, ready: true }];
  }
  const next = { ...desired, id: ++layerId, ready: layers.value.length === 0 };
  layers.value = [...layers.value, next];
  if (next.type !== "animation" && !next.ready) {
    nextTick(() => {
      if (disposed || !props.visible) return;
      readyFrame = requestAnimationFrame(() => {
        readyFrame = requestAnimationFrame(() => revealLayer(next.id));
      });
    });
  }
};

/**
 * 通过静态封面完成失败的切换，避免黑屏或保留失效的画布
 * @param id - 初始化失败的图层标识
 */
const onRendererError = (id: number): void => {
  layers.value = layers.value.map((layer) =>
    layer.id === id ? { ...layer, failed: true } : layer,
  );
  revealLayer(id);
};

watch([desiredBackground, () => props.visible], syncBackground, { immediate: true });

// 流体背景播放态
const bgPlaying = computed(() => {
  if (!status.isPlayerExpanded) return false;
  if (!status.isPlaying && settings.player.playerBgFreezeOnPause) return false;
  return documentVisibility.value === "visible";
});

// 模糊模式：双缓冲层，切歌时交叉淡入淡出
const initialCover = media.track?.cover || DEFAULT_COVER;
const blurLayers = reactive([
  { src: initialCover, active: true },
  { src: "", active: false },
]);
let currentLayerIndex = 0;
let preloadImg: HTMLImageElement | null = null;
let switchToken = 0;

watch([() => media.track?.cover, () => status.isPlayerExpanded], ([newCover, expanded]) => {
  const targetCover = newCover || DEFAULT_COVER;
  // 相同不切换
  if (blurLayers[currentLayerIndex].src === targetCover) return;
  const token = ++switchToken;

  if (preloadImg) {
    preloadImg.src = "";
    preloadImg = null;
  }
  const nextIndex = currentLayerIndex === 0 ? 1 : 0;
  /**
   * 解码结束后替换封面缓冲层
   * @param src - 已解码的缩略图地址
   */
  const switchLayer = (src: string) => {
    if (token !== switchToken) return;
    preloadImg = null;
    // 收起时直接替换当前图层，避免下次展开残留旧封面
    if (!expanded) {
      blurLayers[currentLayerIndex].src = src;
      return;
    }
    blurLayers[nextIndex].src = src;
    nextTick(() => {
      if (token !== switchToken) return;
      requestAnimationFrame(() => {
        if (token !== switchToken) return;
        blurLayers[nextIndex].active = true;
        blurLayers[currentLayerIndex].active = false;
        currentLayerIndex = nextIndex;
      });
    });
  };
  const img = new Image();
  preloadImg = img;
  img.src = targetCover;
  img
    .decode()
    .then(() => switchLayer(targetCover))
    .catch(() => switchLayer(DEFAULT_COVER));
});

onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(fadeTimer);
  cancelAnimationFrame(readyFrame);
  switchToken++;
  if (preloadImg) {
    preloadImg.src = "";
    preloadImg = null;
  }
  blurLayers[0].src = "";
  blurLayers[1].src = "";
});
</script>

<template>
  <!-- 纯色背景 -->
  <div class="absolute inset-0 overflow-hidden -z-1 bg-solid-wrap">
    <div class="color bg-cover-base" />
  </div>
  <div
    v-for="layer in layers"
    :key="layer.id"
    ref="layerElements"
    :data-layer-id="layer.id"
    class="absolute inset-0 overflow-hidden -z-1 bg-layer"
    :class="{ ready: layer.ready }"
  >
    <div v-if="layer.type === 'solid'" class="absolute inset-0 bg-solid-wrap">
      <div class="color bg-cover-base" />
    </div>
    <div v-else-if="layer.type === 'blur' || layer.failed" class="absolute inset-0 bg-blur-wrap">
      <img
        v-for="(cover, index) in blurLayers"
        :key="index"
        :src="cover.src"
        :class="['bg-img', { active: cover.active }]"
        decoding="async"
        alt=""
      />
    </div>
    <BackgroundRender
      v-else
      :album="media.track?.cover || DEFAULT_COVER"
      :playing="bgPlaying"
      :visible="canAnimate"
      :transitioning="!!fluidTransition"
      :fps="settings.player.playerBgFps"
      :flow-speed="settings.player.playerBgFlowSpeed"
      :render-scale="settings.player.playerBgRenderScale"
      :has-lyric="media.parsedLyric.length > 0"
      :enable-beat="settings.player.playerBgBeat"
      :render-engine="layer.renderer"
      @ready="revealLayer(layer.id)"
      @error="onRendererError(layer.id)"
    />
  </div>
  <FluidTransition
    v-if="fluidTransition"
    :from="fluidTransition.from"
    :to="fluidTransition.to"
    :running="canAnimate && reducedMotion !== 'reduce'"
    :fps="settings.player.playerBgFps"
    @complete="finishTransition"
    @fallback="fallbackTransition"
  />
</template>

<style scoped>
/* 纯色模式 */
.bg-solid-wrap {
  background-color: rgb(20, 20, 28);
}

.bg-solid-wrap .color {
  width: 100%;
  height: 100%;
  transition: background-color 0.5s ease;
}

.bg-solid-wrap::after {
  content: "";
  position: absolute;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
}

/* 模糊模式 */
.bg-blur-wrap {
  background-color: rgb(20, 20, 28);
  display: flex;
  align-items: center;
  justify-content: center;
}

.bg-blur-wrap::after {
  content: "";
  position: absolute;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1;
}

.bg-blur-wrap .bg-img {
  position: absolute;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.5);
  filter: blur(45px) saturate(1.2);
  opacity: 0;
  transition: opacity 0.5s ease-in-out;
}

.bg-blur-wrap .bg-img.active {
  opacity: 1;
}

/* 纹理就绪后再显露流体画面 */
.bg-layer {
  opacity: 0;
  transition: opacity 0.6s ease;
}

.bg-layer.ready {
  opacity: 1;
}
</style>
