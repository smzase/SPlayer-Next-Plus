<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import artistFallback from "@/assets/images/artist.jpg";
import { captureCover } from "@/services/coverTransition";

export interface CoverCardProps {
  /** 卡片数据 */
  item: CoverItem;
  /** 类型：default / artist */
  type?: "default" | "artist";
  /** 封面圆角 class */
  rounded?: string;
  /** 封面占位图 */
  fallback?: string;
}

const props = withDefaults(defineProps<CoverCardProps>(), {
  type: "default",
  rounded: "rounded-xl",
});

const emit = defineEmits<{ click: [] }>();
/** 稳定的封面标识：页面重新挂载后仍能匹配，不能用组件实例 ID */
const coverKey = computed(() => `${props.type}:${props.item.id}`);

/** 记录封面后分发点击，由实际目标路由决定是否启用共享过渡 */
const handleClick = (): void => {
  captureCover(props.item, coverKey.value);
  emit("click");
};

const coverRounded = computed(() => (props.type === "artist" ? "rounded-full" : props.rounded));
const actualFallback = computed(() => (props.type === "artist" ? artistFallback : props.fallback));
</script>

<template>
  <div
    class="cursor-pointer group rounded-xl transition-colors duration-300"
    :class="type !== 'artist' ? 'hover:bg-primary/10' : ''"
    @click="handleClick"
  >
    <!-- 封面 -->
    <div class="relative overflow-hidden group-hover:will-change-transform" :class="coverRounded">
      <div
        v-if="item.coverVariant === 'listening-rank'"
        class="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-primary/50 via-primary/24 to-on-surface/10 transition-[transform,filter] duration-300 ease-out group-hover:scale-108 group-hover:brightness-95"
      >
        <img
          v-if="item.cover"
          :src="item.cover"
          alt=""
          decoding="async"
          class="pointer-events-none absolute -inset-[8%] h-[116%] w-[116%] scale-110 object-cover opacity-40 blur-[12px]"
          referrerpolicy="no-referrer"
        />
        <div class="absolute inset-0 bg-primary/6" />
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="flex h-[46%] w-[40%] items-end justify-between">
            <span class="h-[70%] w-[18%] rounded-full bg-on-primary/90 shadow-sm" />
            <span class="h-full w-[18%] rounded-full bg-on-primary/90 shadow-sm" />
            <span class="h-[52%] w-[18%] rounded-full bg-on-primary/90 shadow-sm" />
          </div>
        </div>
      </div>
      <SImg
        v-else
        :data-cover-key="coverKey"
        :src="item.cover"
        :fallback="actualFallback"
        :alt="item.title"
        class="cover-card-image w-full aspect-square transition-[transform,filter] duration-300 ease-out group-hover:scale-108 group-hover:brightness-80"
        :class="coverRounded"
      />
      <!-- 播放按钮 -->
      <div
        v-if="item.coverVariant !== 'listening-rank'"
        data-cover-action
        class="absolute size-9 flex items-center justify-center rounded-full opacity-0 transition-[opacity,transform] duration-300 group-hover:opacity-100"
        :class="
          type === 'artist'
            ? 'inset-0 m-auto'
            : 'right-2 bottom-2 bg-white/50 translate-y-1.5 group-hover:translate-y-0'
        "
      >
        <IconLucidePlay v-if="type !== 'artist'" class="size-4.5 text-white" />
        <IconLucideUser v-else class="size-8 text-white" />
      </div>
    </div>
    <!-- 信息 -->
    <div
      class="flex flex-col gap-0.5 px-2.5 py-2.5"
      :class="type === 'artist' ? 'items-center' : ''"
    >
      <div
        class="text-sm text-on-surface line-clamp-2 leading-snug text-pretty"
        :class="type === 'artist' ? 'text-center w-full' : ''"
      >
        {{ item.title }}
      </div>
      <div
        v-if="item.subtitle"
        class="text-xs text-on-surface-variant/50 truncate"
        :class="type === 'artist' ? 'text-center w-full' : ''"
      >
        {{ item.subtitle }}
      </div>
    </div>
  </div>
</template>

<style scoped>
[data-cover-shared] {
  transform: none !important;
  filter: none !important;
  transition: none;
}

[data-cover-shared] + [data-cover-action] {
  opacity: 0 !important;
  transition: none;
}
</style>
