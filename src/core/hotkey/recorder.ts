/**
 * 录入态键序捕获 composable
 *
 * 用法：
 * ```ts
 * const { current, isRecording, start, cancel } = useHotkeyRecorder({
 *   onConfirm: (accel) => { ... },
 * });
 * ```
 *
 * - start()：进入录入态，监听 keydown
 * - 仅 modifier 单按：累积显示，不结束
 * - 非 modifier 键 + modifier：形成完整 binding，调 onConfirm
 * - 失焦：自动取消
 */

import { canUseAsStandaloneGlobalKey, eventToAccelerator } from "@shared/utils/accelerator";

interface UseHotkeyRecorderOptions {
  /** 平台（用于显示 + accelerator 反推） */
  isMac: boolean;
  /** 是否需要至少一个 modifier（global 录入设 true，避免单键被全局占用）。可传函数以按当前录入目标动态切换 */
  requireModifier?: boolean | (() => boolean);
  /** 录入完成回调 */
  onConfirm: (accelerator: string) => void;
  /** 取消回调（Esc / 失焦） */
  onCancel?: () => void;
  /** 清除回调（Backspace） */
  onClear?: () => void;
  /** 录入状态变化 */
  onRecordingChange?: (recording: boolean) => void;
}

/** 录入态当前显示文案（实时反馈用户已按下的 modifier） */
const buildLivePreview = (event: KeyboardEvent, isMac: boolean): string => {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push(isMac ? "⌃" : "Ctrl");
  if (event.metaKey) parts.push(isMac ? "⌘" : "Win");
  if (event.altKey) parts.push(isMac ? "⌥" : "Alt");
  if (event.shiftKey) parts.push(isMac ? "⇧" : "Shift");
  return isMac ? parts.join("") : parts.join(" + ");
};

/**
 * 捕获快捷键并在录入期间通知系统暂停全局绑定
 * @param options - 平台、录入限制及状态回调
 * @returns 录入状态及开始、取消操作
 */
export const useHotkeyRecorder = (options: UseHotkeyRecorderOptions) => {
  const {
    isMac,
    requireModifier = false,
    onConfirm,
    onCancel,
    onClear,
    onRecordingChange,
  } = options;

  const isRecording = ref(false);
  const current = ref<string>("");

  /**
   * 识别有效组合键并完成、清除或取消录入
   * @param event - 当前键盘事件
   */
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!isRecording.value) return;
    event.preventDefault();
    event.stopPropagation();

    // Backspace 清除当前 binding
    if (event.code === "Backspace") {
      isRecording.value = false;
      current.value = "";
      cleanup();
      onClear?.();
      return;
    }

    // Esc（无修饰键）取消录入，带修饰键时仍作为可绑定按键
    if (
      event.code === "Escape" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      isRecording.value = false;
      current.value = "";
      cleanup();
      onCancel?.();
      return;
    }

    // 实时显示
    current.value = buildLivePreview(event, isMac);

    const accel = eventToAccelerator(event, isMac);
    if (!accel) {
      // 仅按了 modifier，等下一个非 modifier 键
      return;
    }

    // 全局快捷键默认需要修饰键，方向键和小键盘按键可独立注册
    const needsModifier =
      typeof requireModifier === "function" ? requireModifier() : requireModifier;
    if (
      needsModifier &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      !canUseAsStandaloneGlobalKey(event.code)
    ) {
      // 只允许带 modifier 的组合；单键拒绝
      return;
    }

    // 完整组合达成
    isRecording.value = false;
    cleanup();
    onConfirm(accel);
  };

  const handleBlur = (): void => {
    if (isRecording.value) cancel();
  };

  /** 移除录入监听并恢复全局快捷键 */
  const cleanup = (): void => {
    window.removeEventListener("keydown", handleKeyDown, { capture: true });
    window.removeEventListener("blur", handleBlur);
    onRecordingChange?.(false);
  };

  /** 开始捕获按键并暂停全局快捷键 */
  const start = (): void => {
    if (isRecording.value) return;
    isRecording.value = true;
    current.value = "";
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("blur", handleBlur);
    onRecordingChange?.(true);
  };

  const cancel = (): void => {
    if (!isRecording.value) return;
    isRecording.value = false;
    current.value = "";
    cleanup();
    onCancel?.();
  };

  return {
    isRecording,
    current,
    start,
    cancel,
  };
};
