<script setup lang="ts">
import { FluidMorph } from "./FluidMorph";

const props = defineProps<{
  from: HTMLElement;
  to: HTMLElement;
  running: boolean;
  fps: number;
}>();
const emit = defineEmits<{ complete: []; fallback: [] }>();
const canvas = ref<HTMLCanvasElement>();
const incoming = props.to;
let morph: FluidMorph | undefined;

onMounted(() => {
  const from = props.from.querySelector("canvas");
  const to = props.to.querySelector("canvas");
  if (!props.running) {
    emit("complete");
    return;
  }
  if (!canvas.value || !from || !to) {
    emit("fallback");
    return;
  }
  incoming.style.transition = "none";
  incoming.style.opacity = "0";
  try {
    morph = new FluidMorph(
      canvas.value,
      from,
      to,
      props.fps,
      () => {
        incoming.style.opacity = "1";
      },
      () => emit("complete"),
      () => emit("fallback"),
    );
  } catch (error) {
    console.warn("[background] 流体形变初始化失败", error);
    emit("fallback");
  }
});

watch(
  () => props.running,
  (running) => {
    if (!running) emit("complete");
  },
);

onBeforeUnmount(() => {
  morph?.dispose();
  incoming.style.removeProperty("transition");
  incoming.style.removeProperty("opacity");
});
</script>

<template>
  <canvas ref="canvas" class="fluid-transition" aria-hidden="true" />
</template>

<style scoped>
.fluid-transition {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  z-index: -1;
  pointer-events: none;
}
</style>
