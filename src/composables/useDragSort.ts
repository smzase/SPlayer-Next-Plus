import { onDeactivated, onUnmounted, reactive, ref, shallowRef, watch } from "vue";
import type { ComputedRef, Ref } from "vue";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";
import type { Artist } from "@shared/types/player";
import type { DragRightClickAction } from "@shared/types/settings";

export interface DragSortPreviewData {
  title: string;
  cover?: string;
  artists: string;
}

export interface DragSortOptions {
  /** 虚拟列表组件 */
  virtualListRef: Ref<SVirtualListExposed | null>;
  /** 列表项总数 */
  itemCount: ComputedRef<number>;
  /** 单曲目标索引及原列表中的插入间隙 */
  onReorder: (fromIndex: number, toIndex: number, gapIndex: number, indices: number[]) => void;
  /** 激活时取得一起移动的索引 */
  getDragIndices?: (index: number) => number[];
  /** 当前是否允许拖动 */
  enabled?: ComputedRef<boolean>;
  /** 拖拽时的右键行为，默认取消排序 */
  rightClickAction?: ComputedRef<DragRightClickAction>;
  /** 手柄立即触发，行内容需同时满足长按与位移阈值 */
  triggerMode?: "handle" | "longpress";
}

/**
 * 为虚拟列表提供鼠标拖动、触摸长按排序、插入提示和边缘滚动
 * @param options - 列表引用、排序回调和触发条件
 * @returns 拖拽状态及行事件处理器
 */
export const useDragSort = (options: DragSortOptions) => {
  const { virtualListRef, itemCount } = options;
  const isDragging = ref(false);
  const draggedIndex = ref(-1);
  const draggedIndices = shallowRef<number[]>([]);
  const dropIndicator = reactive({ index: -1, position: "none" });
  const dragLabelData = shallowRef<DragSortPreviewData | null>(null);
  const dragLabelPosition = reactive({ top: 0, left: 0 });
  let gapIndex = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scrollFrame: number | undefined;
  let lastScrollTime: number | undefined;
  let scrollRemainder = 0;
  let startX = 0;
  let startY = 0;
  let holdReady = false;
  let suppressUntil = 0;
  let moved = false;
  let awaitingRelease = false;

  /** 固定激活时的批量范围，并按指针当前位置显示插入提示 */
  const activateDrag = (): void => {
    clearTimeout(timer);
    timer = undefined;
    isDragging.value = true;
    draggedIndices.value = options.getDragIndices?.(draggedIndex.value) ?? [draggedIndex.value];
    gapIndex = draggedIndex.value;
    moved = Math.hypot(dragLabelPosition.left - startX, dragLabelPosition.top - startY) > 5;
    window.getSelection()?.removeAllRanges();
    updateTarget();
    if (moved && scrollFrame === undefined) scrollFrame = requestAnimationFrame(scrollStep);
  };

  /** 根据真实滚动位置更新插入间隙，表头和内边距由虚拟列表处理 */
  const updateTarget = (): void => {
    const list = virtualListRef.value;
    const rect = list?.scrollRef?.getBoundingClientRect();
    if (!list || !rect) return;
    const offset = dragLabelPosition.top - rect.top + list.scrollRef!.scrollTop;
    const info = list.getDropInfoByOffset(offset);
    gapIndex = info.index + (info.position === "bottom" ? 1 : 0);
    if (offset <= list.getItemTop(0)) gapIndex = 0;
    if (offset >= list.getItemTop(itemCount.value)) gapIndex = itemCount.value;
    dropIndicator.index = Math.min(gapIndex, itemCount.value - 1);
    dropIndicator.position = gapIndex === itemCount.value ? "bottom" : "top";
  };

  /**
   * 越靠近或超出列表边缘滚动越快，按实际时间计算以兼容不同刷新率
   * @param timestamp - 当前动画帧时间
   */
  const scrollStep = (timestamp: number): void => {
    scrollFrame = undefined;
    const list = virtualListRef.value;
    const rect = list?.scrollRef?.getBoundingClientRect();
    if (!isDragging.value || !list || !rect) return;
    const y = dragLabelPosition.top;
    const edge = 32;
    const direction =
      y < rect.top + edge && y < startY - 5 ? -1 : y > rect.bottom - edge && y > startY + 5 ? 1 : 0;
    if (!direction) {
      lastScrollTime = undefined;
      scrollRemainder = 0;
      return;
    }
    const distance = direction < 0 ? y - rect.top : rect.bottom - y;
    const pressure = Math.min(1, Math.max(0, (edge - distance) / edge));
    const outsideDistance = Math.max(0, -distance);
    // 边缘附近保留精细移动，在窗口有限的拖动空间内即可达到最高速度
    const speed = 240 * pressure ** 2 + 1560 * Math.min(outsideDistance / 96, 1);
    const elapsed = lastScrollTime === undefined ? 0 : Math.min(timestamp - lastScrollTime, 32);
    lastScrollTime = timestamp;
    const delta = scrollRemainder + (direction * speed * elapsed) / 1000;
    const amount = Math.trunc(delta);
    scrollRemainder = delta - amount;
    if (!amount) {
      scrollFrame = requestAnimationFrame(scrollStep);
      return;
    }
    const scroller = list.scrollRef!;
    const before = scroller.scrollTop;
    list.scrollTo(
      Math.max(0, Math.min(before + amount, scroller.scrollHeight - scroller.clientHeight)),
      "auto",
    );
    updateTarget();
    if (scroller.scrollTop !== before) scrollFrame = requestAnimationFrame(scrollStep);
    else {
      lastScrollTime = undefined;
      scrollRemainder = 0;
    }
  };

  /**
   * 同时满足按住时长和位移阈值后拖动，触摸长按前保留滚动手势
   * @param event - 鼠标或触摸移动事件
   */
  const handleMove = (event: MouseEvent | TouchEvent): void => {
    if (awaitingRelease) return;
    const point = "touches" in event ? event.touches[0] : event;
    if (!point) return;
    dragLabelPosition.left = point.clientX;
    dragLabelPosition.top = point.clientY;
    if (!isDragging.value) {
      if (Math.hypot(point.clientX - startX, point.clientY - startY) <= 5) return;
      if (!holdReady) {
        if ("touches" in event) cleanupDragState();
        return;
      }
      activateDrag();
    }
    if (event.cancelable) event.preventDefault();
    moved ||= Math.hypot(point.clientX - startX, point.clientY - startY) > 3;
    updateTarget();
    if (scrollFrame === undefined) scrollFrame = requestAnimationFrame(scrollStep);
  };

  /**
   * 结束拖拽并按需提交排序，提前结束时继续拦截未释放的按键
   * @param commit - 是否提交当前位置的排序
   * @param waitForRelease - 是否仍需等待按键释放，防止重复提交或误点击
   */
  const finishDrag = (commit: boolean, waitForRelease: boolean): void => {
    const from = draggedIndex.value;
    const gap = gapIndex;
    const active = isDragging.value;
    const indices = draggedIndices.value;
    const shouldMove = moved;
    const to = gap > from ? gap - 1 : gap;
    if (waitForRelease) {
      awaitingRelease = true;
      resetDragFeedback();
    } else {
      cleanupDragState();
    }
    if (commit && active && shouldMove && gap >= 0 && (indices.length > 1 || from !== to)) {
      options.onReorder(from, to, gap, indices);
    }
  };

  /**
   * 左键或触摸松开时提交排序，提前结束后只等待所有鼠标按键释放
   * @param event - 鼠标或触摸结束事件
   */
  const handleEnd = (event: MouseEvent | TouchEvent): void => {
    if ("button" in event && (awaitingRelease ? event.buttons !== 0 : event.button !== 0)) return;
    finishDrag(true, false);
  };

  /**
   * 拖拽中拦截右键，按设置取消、保持拖拽或立即提交排序
   * @param event - 鼠标按下事件
   */
  const handleRightClick = (event: MouseEvent): void => {
    if (event.button !== 2 || !isDragging.value) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = options.rightClickAction?.value ?? "cancel";
    if (action === "keep") return;
    finishDrag(action === "commit", true);
  };

  /**
   * 取消拖拽并拦截尚未松开的鼠标手势，阻止 Escape 同时关闭弹层
   * @param event - 键盘事件
   */
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finishDrag(false, true);
  };

  /** 隐藏窗口时停止长按计时和动画 */
  const handleVisibility = (): void => {
    if (document.hidden) cleanupDragState();
  };

  /** 停止计时、动画和浮层，提前结束后继续等待鼠标松开 */
  const resetDragFeedback = (): void => {
    clearTimeout(timer);
    timer = undefined;
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
    lastScrollTime = undefined;
    scrollRemainder = 0;
    isDragging.value = false;
    draggedIndex.value = -1;
    draggedIndices.value = [];
    gapIndex = -1;
    holdReady = false;
    moved = false;
    dropIndicator.index = -1;
    dropIndicator.position = "none";
    dragLabelData.value = null;
  };

  /** 结束本次手势并移除全部临时监听 */
  const cleanupDragState = (): void => {
    if (isDragging.value || awaitingRelease) suppressUntil = Date.now() + 400;
    resetDragFeedback();
    awaitingRelease = false;
    window.removeEventListener("mousedown", handleRightClick, true);
    window.removeEventListener("contextmenu", suppressClick, true);
    window.removeEventListener("mousemove", handleMove);
    window.removeEventListener("touchmove", handleMove);
    window.removeEventListener("mouseup", handleEnd, true);
    window.removeEventListener("touchend", handleEnd);
    window.removeEventListener("touchcancel", cleanupDragState);
    window.removeEventListener("blur", cleanupDragState);
    window.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("visibilitychange", handleVisibility);
  };

  /** 列表变化时取消拖拽，保留右键提交或取消后尚未结束的按键拦截 */
  const cancelDrag = (): void => {
    if (isDragging.value || awaitingRelease) finishDrag(false, true);
    else cleanupDragState();
  };

  /**
   * 在捕获阶段拦截拖拽生成的点击和双击
   * @param event - 点击或上下文菜单事件
   */
  const suppressClick = (event: Event): void => {
    if (!isDragging.value && !awaitingRelease && Date.now() >= suppressUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  /**
   * 等待长按与移动共同触发拖动，跳过行内按钮和链接
   * @param event - 行按下事件
   * @param index - 行索引
   * @param track - 浮层所需的歌曲名、缩略封面和歌手
   */
  const handlePointerDown = (
    event: MouseEvent | TouchEvent,
    index: number,
    track: { title: string; cover?: string; artists: Artist[] | string },
  ): void => {
    if (awaitingRelease) return;
    if (options.enabled?.value === false || itemCount.value < 2) return;
    if ("button" in event && event.button !== 0) return;
    if ("touches" in event && event.touches.length !== 1) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, [role='checkbox'], [data-no-drag]")) return;
    cleanupDragState();
    suppressUntil = 0;
    const point = "touches" in event ? event.touches[0] : event;
    startX = point.clientX;
    startY = point.clientY;
    dragLabelPosition.left = startX;
    dragLabelPosition.top = startY;
    draggedIndex.value = index;
    dragLabelData.value = {
      title: track.title,
      cover: track.cover,
      artists:
        typeof track.artists === "string"
          ? track.artists
          : track.artists.map((artist) => artist.name).join(" / "),
    };
    if (options.triggerMode === "longpress") {
      timer = setTimeout(() => {
        timer = undefined;
        holdReady = true;
        if (Math.hypot(dragLabelPosition.left - startX, dragLabelPosition.top - startY) > 5) {
          activateDrag();
        }
      }, 250);
    } else {
      if (event.cancelable) event.preventDefault();
      activateDrag();
    }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mousedown", handleRightClick, true);
    window.addEventListener("contextmenu", suppressClick, true);
    window.addEventListener("touchmove", handleMove, { passive: false });
    window.addEventListener("mouseup", handleEnd, true);
    window.addEventListener("touchend", handleEnd);
    window.addEventListener("touchcancel", cleanupDragState);
    window.addEventListener("blur", cleanupDragState);
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("visibilitychange", handleVisibility);
  };

  watch(itemCount, cancelDrag);
  if (options.enabled) watch(options.enabled, cancelDrag);
  onDeactivated(cleanupDragState);
  onUnmounted(cleanupDragState);

  return {
    isDragging,
    draggedIndex,
    draggedIndices,
    dropIndicator,
    dragLabelData,
    dragLabelPosition,
    handlePointerDown,
    suppressClick,
    cancelDrag,
  };
};
