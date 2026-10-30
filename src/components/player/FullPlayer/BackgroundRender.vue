<script setup lang="ts">
import {
  type AbstractBaseRenderer,
  type BaseRenderer,
  BackgroundRender as CoreBackgroundRender,
  MeshGradientRenderer,
  IsolationRenderer,
  PixiRenderer,
} from "@applemusic-like-lyrics/core";
import type { PlayerBgRenderer } from "@/types/settings";
import { getFftFrame } from "@/services/playback";
import { acquireFft, releaseFft } from "@/services/fftCapture";
import { getBassPulse, toAmllLowFreqVolume } from "@/services/audioFeatures";
import { TitaniumRenderer } from "./background/titanium";

const RENDERER_MAP: Record<PlayerBgRenderer, new (canvas: HTMLCanvasElement) => BaseRenderer> = {
  mesh: MeshGradientRenderer,
  isolation: IsolationRenderer,
  pixi: PixiRenderer,
  titanium: TitaniumRenderer,
};

export interface BackgroundRenderProps {
  /** 专辑封面资源 URL */
  album?: string;
  /** 是否处于播放状态，默认为 true */
  playing?: boolean;
  /** 是否可见，隐藏时暂停渲染与 FFT */
  visible?: boolean;
  /** 形变期间持续提供实时帧，暂停播放时仍保持零流速 */
  transitioning?: boolean;
  /** 动画流动速度，默认为 2 */
  flowSpeed?: number;
  /** 是否有歌词，默认为 true */
  hasLyric?: boolean;
  /** 帧率，默认为 30 */
  fps?: number;
  /** 渲染缩放比例，默认为 0.5 */
  renderScale?: number;
  /** 是否随低频节拍脉动（默认 false，关闭则不采集 FFT） */
  enableBeat?: boolean;
  /** 渲染引擎标识，默认为 'mesh' */
  renderEngine?: PlayerBgRenderer;
  /** 自定义渲染器类（若指定则优先于 renderEngine） */
  renderer?: new (...args: ConstructorParameters<typeof BaseRenderer>) => BaseRenderer;
}

const props = withDefaults(defineProps<BackgroundRenderProps>(), {
  playing: true,
  visible: true,
  transitioning: false,
  flowSpeed: 2,
  hasLyric: true,
  fps: 30,
  renderScale: 0.5,
  enableBeat: false,
  renderEngine: "mesh",
});

const emit = defineEmits<{ ready: []; error: [error: unknown] }>();

const wrapperRef = ref<HTMLDivElement | null>(null);

// 外部渲染器实例引用
const bgRenderRef = shallowRef<AbstractBaseRenderer>();
let albumRequestId = 0;
let readyFrame = 0;
let readyPending = false;
let readyRemaining = 0;
let previousReadyTime: number | undefined;

/**
 * 等待可见帧完成初始化，Pixi 需先完成内部的纹理显现动画
 * @param time - 当前动画帧的时间戳
 */
const waitUntilReady = (time: number): void => {
  readyFrame = 0;
  if (!props.visible || !readyPending) return;
  if (previousReadyTime !== undefined) readyRemaining -= time - previousReadyTime;
  previousReadyTime = time;
  if (readyRemaining <= 0) {
    readyPending = false;
    emit("ready");
  } else {
    readyFrame = requestAnimationFrame(waitUntilReady);
  }
};

/** 加载当前封面，忽略过期任务并在首帧完成后通知父组件 */
const loadAlbum = async (): Promise<void> => {
  const renderer = bgRenderRef.value;
  if (!renderer) return;
  const requestId = ++albumRequestId;
  cancelAnimationFrame(readyFrame);
  readyFrame = 0;
  readyPending = false;
  previousReadyTime = undefined;
  try {
    await renderer.setAlbum(props.album ?? "", false);
    if (requestId !== albumRequestId || bgRenderRef.value !== renderer) return;
    // Pixi 加载纹理会重启 ticker，隐藏状态下需要再次暂停
    if (!props.visible) renderer.pause();
    readyPending = true;
    readyRemaining = props.renderEngine === "pixi" ? 1100 : 2000 / props.fps;
    if (props.visible) readyFrame = requestAnimationFrame(waitUntilReady);
  } catch (error) {
    if (requestId !== albumRequestId || bgRenderRef.value !== renderer) return;
    console.warn("[background] 背景封面加载失败", error);
    emit("error", error);
  }
};

/**
 * 统一同步更新属性状态到底层渲染器
 */
const updateRendererState = () => {
  const renderer = bgRenderRef.value;
  if (!renderer) return;

  renderer.setFPS(props.fps);
  renderer.setRenderScale(props.renderScale);
  renderer.setHasLyric(props.hasLyric);
  syncRendererMotion();
  void loadAlbum();
};

/**
 * 同步流体背景运动状态
 */
const syncRendererMotion = () => {
  const renderer = bgRenderRef.value;
  if (!renderer) return;

  if (!props.visible) {
    renderer.pause();
    cancelAnimationFrame(readyFrame);
    readyFrame = 0;
    previousReadyTime = undefined;
    return;
  }
  renderer.setStaticMode(!props.playing && !props.transitioning);
  renderer.setFlowSpeed(props.playing ? props.flowSpeed : 0);
  renderer.resume();
  if (readyPending && !readyFrame) readyFrame = requestAnimationFrame(waitUntilReady);
};

const BASS_ATTACK = 0.45;
const BASS_DECAY = 0.14;

// 低频平滑后脉冲
let smoothedPulse = 0;
let lastFftFrame: readonly [number[], number[]] = [[], []];

/**
 * 从最新 FFT 帧数据计算低频音量能量值 [0.0 - 1.0]
 */
const updateLowFreqVolume = () => {
  const data = getFftFrame();
  if (!data || data[0].length === 0) return;
  if (data === lastFftFrame) return;
  lastFftFrame = data;

  const pulse = getBassPulse(data);
  const smoothFactor = pulse > smoothedPulse ? BASS_ATTACK : BASS_DECAY;
  smoothedPulse = smoothedPulse + smoothFactor * (pulse - smoothedPulse);

  bgRenderRef.value?.setLowFreqVolume(
    props.renderEngine === "titanium" ? smoothedPulse : toAmllLowFreqVolume(smoothedPulse),
  );
};

const { resume: resumeFftLoop, pause: pauseFftLoop } = useRafFn(updateLowFreqVolume, {
  immediate: false,
});

// 本地持有标记，保证 acquire / release 严格配对
let fftAcquired = false;

/**
 * 开始捕获 FFT 频谱数据
 */
const startFftCapture = () => {
  if (!fftAcquired) {
    acquireFft();
    fftAcquired = true;
  }
  resumeFftLoop();
};

/**
 * 停止捕获 FFT 频谱数据
 */
const stopFftCapture = () => {
  pauseFftLoop();
  if (fftAcquired) {
    releaseFft();
    fftAcquired = false;
  }
};

/**
 * 按播放状态与跳动开关同步 FFT 采集
 */
const syncFftCapture = () => {
  if (
    props.visible &&
    props.playing &&
    props.enableBeat &&
    (props.renderEngine === "mesh" || props.renderEngine === "titanium")
  ) {
    startFftCapture();
  } else {
    stopFftCapture();
    if (!props.enableBeat) {
      smoothedPulse = 0;
      lastFftFrame = [[], []];
      bgRenderRef.value?.setLowFreqVolume(props.renderEngine === "titanium" ? 0 : 1);
    }
  }
};

/**
 * 解析自定义或设置中指定的渲染器
 * @returns 用于创建画布的渲染器类
 */
const getRendererClass = () => {
  if (props.renderer) return props.renderer;
  return RENDERER_MAP[props.renderEngine ?? "mesh"] ?? MeshGradientRenderer;
};

/**
 * 初始化底层渲染器并挂载至 DOM
 */
const initRenderer = () => {
  if (!wrapperRef.value) return;

  const RendererClass = getRendererClass();
  try {
    if (RendererClass === TitaniumRenderer && !TitaniumRenderer.isSupported()) {
      throw new Error("Titanium requires WebGL highp support");
    }
    bgRenderRef.value = CoreBackgroundRender.new(RendererClass);
  } catch (error) {
    console.warn("[background] 背景渲染器初始化失败", error);
    emit("error", error);
    return;
  }

  const el = bgRenderRef.value.getElement();
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.display = "block";
  wrapperRef.value.appendChild(el);

  updateRendererState();
  syncFftCapture();
};

/**
 * 释放渲染器资源并清空容器
 */
const destroyRenderer = () => {
  albumRequestId++;
  cancelAnimationFrame(readyFrame);
  readyFrame = 0;
  readyPending = false;
  previousReadyTime = undefined;
  stopFftCapture();

  const renderer = bgRenderRef.value;
  if (renderer) {
    renderer.pause();
    const el = renderer.getElement();
    el?.remove();
    renderer.dispose();
    bgRenderRef.value = undefined;
  }
};

onMounted(() => {
  initRenderer();
});

onBeforeUnmount(() => {
  destroyRenderer();
});

// 跨引擎过渡由父组件保留旧实例完成
watch(
  () => [props.renderEngine, props.renderer],
  () => {
    destroyRenderer();
    initRenderer();
  },
);

// 属性变化监听
watch(
  () => props.album,
  () => void loadAlbum(),
);

watch(
  () => [props.playing, props.visible, props.transitioning],
  () => {
    syncRendererMotion();
    syncFftCapture();
  },
);

watch(
  () => props.enableBeat,
  () => syncFftCapture(),
);

watch(
  () => props.fps,
  (val) => {
    bgRenderRef.value?.setFPS(val);
  },
);

watch(
  () => props.flowSpeed,
  (val) => {
    if (props.playing) bgRenderRef.value?.setFlowSpeed(val);
  },
);

watch(
  () => props.renderScale,
  (val) => {
    bgRenderRef.value?.setRenderScale(val);
  },
);

watch(
  () => props.hasLyric,
  (val) => {
    bgRenderRef.value?.setHasLyric(val);
  },
);

defineExpose({
  bgRender: bgRenderRef,
  wrapperEl: wrapperRef,
});
</script>

<template>
  <div ref="wrapperRef" class="background-render-wrapper" aria-hidden="true" />
</template>

<style scoped>
.background-render-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  z-index: 0;
  pointer-events: none;
}
</style>
