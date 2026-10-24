<script setup lang="ts">
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { useWindowControls } from "@/composables/useWindowControls";
import { useThemeStore } from "@/stores/theme";
import { useUpdateStore } from "@/stores/update";
import { useMessageStore } from "@/stores/message";
import { useUserStore } from "@/stores/user";
import { useAudioRecognitionStore } from "@/stores/audioRecognition";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import IconSun from "~icons/lucide/sun";
import IconMoon from "~icons/lucide/moon";
import IconMonitor from "~icons/lucide/monitor";
import IconRefreshCw from "~icons/lucide/refresh-cw";
import IconTerminal from "~icons/lucide/terminal";
import IconSettings from "~icons/lucide/settings";
import IconScaling from "~icons/lucide/scaling";

const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const { show: showSettings } = useSettingsDialog();
const theme = useThemeStore();
const update = useUpdateStore();
const message = useMessageStore();
const user = useUserStore();
const audioRecognition = useAudioRecognitionStore();
const messageOpen = ref(false);
const messagePanelResizing = ref(false);
const messagePanelSize = reactive({
  width: message.panelSize.width,
  height: message.panelSize.height,
});
const { width: viewportWidth, height: viewportHeight } = useWindowSize();
const { isBorderless } = useWindowControls();

/** 打开听歌识曲页并在用户手势内开始捕获 */
const openAudioRecognition = (): void => {
  if (!audioRecognition.isActive) void audioRecognition.start();
  if (route.name !== "audio-recognition") void router.push({ name: "audio-recognition" });
};

type MessagePanelResizeAxis = "width" | "height" | "both";

const MIN_MESSAGE_PANEL_WIDTH = 400;
const MIN_MESSAGE_PANEL_HEIGHT = 460;
const MESSAGE_PANEL_VIEWPORT_GAP = 24;
const MESSAGE_PANEL_TOP_GAP = 96;
const MESSAGE_PANEL_KEYBOARD_STEP = 16;
const BACKGROUND_MESSAGE_POLL_INTERVAL_MS = 30 * 60 * 1000;

const messagePanelLimits = computed(() => {
  const maxWidth = Math.max(320, viewportWidth.value - MESSAGE_PANEL_VIEWPORT_GAP);
  const maxHeight = Math.max(320, viewportHeight.value - MESSAGE_PANEL_TOP_GAP);
  return {
    minWidth: Math.min(MIN_MESSAGE_PANEL_WIDTH, maxWidth),
    minHeight: Math.min(MIN_MESSAGE_PANEL_HEIGHT, maxHeight),
    maxWidth,
    maxHeight,
  };
});

const clampMessagePanelSize = (
  width: number,
  height: number,
): { width: number; height: number } => {
  const limits = messagePanelLimits.value;
  return {
    width: Math.min(limits.maxWidth, Math.max(limits.minWidth, width)),
    height: Math.min(limits.maxHeight, Math.max(limits.minHeight, height)),
  };
};

const messagePanelStyle = computed(() => {
  const size = clampMessagePanelSize(messagePanelSize.width, messagePanelSize.height);
  return { width: `${size.width}px`, height: `${size.height}px` };
});

let messagePanelResize:
  | {
      axis: MessagePanelResizeAxis;
      startX: number;
      startY: number;
      startWidth: number;
      startHeight: number;
    }
  | undefined;

/** 结束消息浮窗尺寸拖拽 */
const stopMessagePanelResize = (): void => {
  if (messagePanelResize) {
    message.setPanelSize(messagePanelSize.width, messagePanelSize.height);
  }
  messagePanelResize = undefined;
  messagePanelResizing.value = false;
  window.removeEventListener("pointermove", onMessagePanelResize);
  window.removeEventListener("pointerup", stopMessagePanelResize);
  window.removeEventListener("pointercancel", stopMessagePanelResize);
};

/** 根据指针位置更新消息浮窗尺寸 */
const onMessagePanelResize = (event: PointerEvent): void => {
  if (!messagePanelResize) return;
  const widthDelta = messagePanelResize.startX - event.clientX;
  const heightDelta = event.clientY - messagePanelResize.startY;
  const width =
    messagePanelResize.axis === "height"
      ? messagePanelResize.startWidth
      : messagePanelResize.startWidth + widthDelta;
  const height =
    messagePanelResize.axis === "width"
      ? messagePanelResize.startHeight
      : messagePanelResize.startHeight + heightDelta;
  const size = clampMessagePanelSize(width, height);
  messagePanelSize.width = size.width;
  messagePanelSize.height = size.height;
};

/** 开始从左边缘或下边缘拖拽消息浮窗尺寸 */
const startMessagePanelResize = (event: PointerEvent, axis: MessagePanelResizeAxis): void => {
  event.preventDefault();
  event.stopPropagation();
  const size = clampMessagePanelSize(messagePanelSize.width, messagePanelSize.height);
  messagePanelSize.width = size.width;
  messagePanelSize.height = size.height;
  messagePanelResizing.value = true;
  messagePanelResize = {
    axis,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: size.width,
    startHeight: size.height,
  };
  window.addEventListener("pointermove", onMessagePanelResize);
  window.addEventListener("pointerup", stopMessagePanelResize, { once: true });
  window.addEventListener("pointercancel", stopMessagePanelResize, { once: true });
};

/** 使用键盘微调消息浮窗尺寸 */
const resizeMessagePanelBy = (widthDelta: number, heightDelta: number): void => {
  const size = clampMessagePanelSize(
    messagePanelSize.width + widthDelta,
    messagePanelSize.height + heightDelta,
  );
  messagePanelSize.width = size.width;
  messagePanelSize.height = size.height;
  message.setPanelSize(size.width, size.height);
};

/** 界面缩放弹窗开关 */
const uiZoomOpen = ref(false);

const themeIcon = computed(() => {
  if (theme.mode === "light") return IconMoon;
  if (theme.mode === "dark") return IconMonitor;
  return IconSun;
});

const themeLabel = computed(() => {
  if (theme.mode === "light") return t("settings.themeMode.dark");
  if (theme.mode === "dark") return t("settings.themeMode.system");
  return t("settings.themeMode.light");
});

const menuItems = computed<DropdownMenuItem[]>(() => [
  {
    key: "theme",
    label: themeLabel.value,
    icon: themeIcon.value,
    disabled: theme.appearanceStyle === "image",
  },
  { key: "uiZoom", label: t("uiZoom.title"), icon: IconScaling },
  { key: "reload", label: t("nav.reload"), icon: IconRefreshCw, separator: true },
  { key: "devtools", label: t("nav.devtools"), icon: IconTerminal },
  { key: "settings", label: t("nav.globalSettings"), icon: IconSettings },
]);

const onMenuSelect = (key: string): void => {
  if (key === "theme") theme.cycleMode();
  else if (key === "reload") location.reload();
  else if (key === "devtools") window.api.system.toggleDevTools();
  else if (key === "uiZoom") uiZoomOpen.value = true;
  else if (key === "settings") showSettings();
};

watch(
  () => [message.panelSize.width, message.panelSize.height] as const,
  ([width, height]) => {
    if (messagePanelResizing.value) return;
    messagePanelSize.width = width;
    messagePanelSize.height = height;
  },
);

watch(
  () => user.profile?.userId,
  (userId) => {
    if (!userId) {
      messageOpen.value = false;
      message.clear();
      return;
    }
    void message.refreshUnread(userId).catch(() => undefined);
  },
  { immediate: true },
);

watch(
  () => message.requestedThread,
  (thread) => {
    if (thread) messageOpen.value = true;
  },
);

const documentVisibility = useDocumentVisibility();
const { pause: pauseBackgroundMessagePolling, resume: resumeBackgroundMessagePolling } =
  useIntervalFn(
    () => {
      const userId = user.profile?.userId;
      if (!userId || (messageOpen.value && documentVisibility.value === "visible")) {
        return;
      }
      void message.refreshUnread(userId).catch(() => undefined);
    },
    BACKGROUND_MESSAGE_POLL_INTERVAL_MS,
    { immediate: false },
  );

watch(
  [() => user.isLoggedIn, messageOpen, documentVisibility],
  ([loggedIn, open, visibility]) => {
    if (loggedIn && (!open || visibility !== "visible")) resumeBackgroundMessagePolling();
    else pauseBackgroundMessagePolling();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopMessagePanelResize();
  pauseBackgroundMessagePolling();
});
</script>

<template>
  <div class="flex items-center justify-between flex-1 h-full min-w-0 app-drag-region">
    <!-- 左侧 -->
    <div class="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
      <SButton
        class="app-no-drag shrink-0"
        variant="tertiary"
        circle
        :size="40"
        :icon-size="20"
        @click="router.back()"
      >
        <template #icon><IconLucideChevronLeft /></template>
      </SButton>
      <SButton
        class="app-no-drag shrink-0"
        variant="tertiary"
        circle
        :size="40"
        :icon-size="20"
        @click="router.forward()"
      >
        <template #icon><IconLucideChevronRight /></template>
      </SButton>
      <NavSearch />
      <SButton
        class="app-no-drag"
        :type="route.name === 'audio-recognition' ? 'primary' : 'default'"
        variant="tertiary"
        circle
        :size="40"
        :icon-size="20"
        :title="t('nav.audioRecognition')"
        :aria-label="t('nav.audioRecognition')"
        @click="openAudioRecognition"
      >
        <template #icon><IconLucideMicVocal /></template>
      </SButton>
      <SButton
        v-if="update.hasUpdate"
        class="app-no-drag shrink-0 lt-md:hidden"
        variant="tertiary"
        circle
        :size="40"
        :icon-size="20"
        :title="t('update.dialogTitle')"
        @click="update.openDialog()"
      >
        <template #icon><IconLucideCircleArrowUp /></template>
      </SButton>
    </div>
    <!-- 中间 -->
    <div class="flex-1 h-full min-w-4" />
    <!-- 右侧 -->
    <div class="flex items-center gap-2 sm:gap-3 shrink-0">
      <NavUser />
      <PopoverRoot v-if="user.isLoggedIn" v-model:open="messageOpen">
        <PopoverTrigger as-child>
          <SButton
            class="app-no-drag relative"
            :type="messageOpen ? 'primary' : 'default'"
            variant="tertiary"
            circle
            static
            :size="40"
            :title="t('messages.title')"
            :aria-label="t('messages.title')"
          >
            <template #icon><IconLucideBell /></template>
            <span
              v-if="message.totalUnread > 0"
              class="pointer-events-none absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 py-0.5 text-[9px] font-bold leading-none text-on-primary shadow-sm"
            >
              {{ message.totalUnread > 99 ? "99+" : message.totalUnread }}
            </span>
          </SButton>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            side="bottom"
            align="end"
            :side-offset="8"
            :avoid-collisions="true"
            :collision-padding="12"
            :style="messagePanelStyle"
            class="message-center-popover relative z-300 overflow-hidden rounded-xl bg-surface-bright text-sm text-on-surface shadow-lg data-[state=open]:animate-popover-in data-[state=closed]:animate-popover-out data-[state=closed]:pointer-events-none"
            @escape-key-down="messageOpen = false"
          >
            <MessageCenterDialog
              :open="messageOpen"
              :resizing="messagePanelResizing"
              @navigate="messageOpen = false"
            />
            <div
              role="separator"
              tabindex="0"
              aria-orientation="vertical"
              :title="t('messages.resizeWidth')"
              :aria-label="t('messages.resizeWidth')"
              class="absolute bottom-4 left-0 top-4 z-10 w-1.5 cursor-ew-resize touch-none transition-colors hover:bg-primary/25 focus-visible:bg-primary/30"
              @pointerdown="startMessagePanelResize($event, 'width')"
              @keydown.left.prevent="resizeMessagePanelBy(MESSAGE_PANEL_KEYBOARD_STEP, 0)"
              @keydown.right.prevent="resizeMessagePanelBy(-MESSAGE_PANEL_KEYBOARD_STEP, 0)"
            />
            <div
              role="separator"
              tabindex="0"
              aria-orientation="horizontal"
              :title="t('messages.resizeHeight')"
              :aria-label="t('messages.resizeHeight')"
              class="absolute bottom-0 left-4 right-4 z-10 h-1.5 cursor-ns-resize touch-none transition-colors hover:bg-primary/25 focus-visible:bg-primary/30"
              @pointerdown="startMessagePanelResize($event, 'height')"
              @keydown.up.prevent="resizeMessagePanelBy(0, -MESSAGE_PANEL_KEYBOARD_STEP)"
              @keydown.down.prevent="resizeMessagePanelBy(0, MESSAGE_PANEL_KEYBOARD_STEP)"
            />
            <div
              role="separator"
              tabindex="0"
              :title="t('messages.resizeBoth')"
              :aria-label="t('messages.resizeBoth')"
              class="absolute bottom-0 left-0 z-20 size-4 cursor-nesw-resize touch-none rounded-tr transition-colors hover:bg-primary/30 focus-visible:bg-primary/35"
              @pointerdown="startMessagePanelResize($event, 'both')"
              @keydown.left.prevent="resizeMessagePanelBy(MESSAGE_PANEL_KEYBOARD_STEP, 0)"
              @keydown.right.prevent="resizeMessagePanelBy(-MESSAGE_PANEL_KEYBOARD_STEP, 0)"
              @keydown.up.prevent="resizeMessagePanelBy(0, -MESSAGE_PANEL_KEYBOARD_STEP)"
              @keydown.down.prevent="resizeMessagePanelBy(0, MESSAGE_PANEL_KEYBOARD_STEP)"
            />
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
      <SDropdownMenu :items="menuItems" @select="onMenuSelect">
        <template #trigger>
          <SButton class="app-no-drag shrink-0" variant="tertiary" circle :size="40">
            <template #icon><IconLucideSettings /></template>
          </SButton>
        </template>
      </SDropdownMenu>
      <SDivider v-if="isBorderless" vertical />
      <WindowControls />
    </div>
    <UiZoomDialog v-model:open="uiZoomOpen" />
  </div>
</template>
