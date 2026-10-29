import { createApp, computed, h, nextTick, ref, shallowRef, type App } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";
import type { DragRightClickAction } from "@shared/types/settings";
import { moveItemsToGap } from "@shared/utils/reorder";
import { useDragSort } from "./useDragSort";

let app: App;
let root: HTMLElement;
let row: HTMLElement;
let scroller: HTMLElement;
let drag: ReturnType<typeof useDragSort>;
const enabled = ref(true);
const rightClickAction = ref<DragRightClickAction>("cancel");
const onReorder = vi.fn();
const selected = ref([0]);
const previewTrack = { title: "歌曲", cover: "cover://test.jpg", artists: [{ name: "歌手" }] };

/**
 * 模拟行上的按下和全局移动、松开事件
 * @param type - 鼠标事件类型
 * @param y - 指针纵坐标
 * @param target - 接收事件的元素
 * @param init - 按键与其他事件属性
 * @returns 已派发的鼠标事件
 */
const mouse = (
  type: string,
  y: number,
  target: EventTarget = window,
  init: MouseEventInit = {},
): MouseEvent => {
  const event = new MouseEvent(type, {
    clientX: 100,
    clientY: y,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

describe("虚拟列表拖拽排序", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    onReorder.mockClear();
    enabled.value = true;
    rightClickAction.value = "cancel";
    selected.value = [0];
    root = document.createElement("div");
    document.body.appendChild(root);
    scroller = document.createElement("div");
    Object.defineProperties(scroller, {
      scrollHeight: { value: 1100 },
      clientHeight: { value: 300 },
    });
    scroller.getBoundingClientRect = () => ({ top: 100, bottom: 400 }) as DOMRect;
    const list = shallowRef<SVirtualListExposed>({
      scrollRef: scroller,
      wrapperRef: root,
      contentRef: null,
      actualStartIndex: 0,
      scrollTo: (top) => {
        scroller.scrollTop = Math.max(0, Math.min(top, 800));
      },
      scrollToIndex: vi.fn(),
      getScrollTop: () => scroller.scrollTop,
      getItemTop: (index) => 32 + index * 50,
      getDropInfoByOffset: (offset) => ({
        index: Math.max(0, Math.min(19, Math.floor((offset - 32) / 50))),
        position: (offset - 32) % 50 < 25 ? "top" : "bottom",
      }),
    });
    app = createApp({
      setup() {
        drag = useDragSort({
          virtualListRef: list,
          itemCount: computed(() => 20),
          enabled: computed(() => enabled.value),
          rightClickAction: computed(() => rightClickAction.value),
          triggerMode: "longpress",
          getDragIndices: () => [...selected.value],
          onReorder,
        });
        return () =>
          h("div", {
            onMousedown: (event: MouseEvent) => drag.handlePointerDown(event, 0, previewTrack),
            onClickCapture: drag.suppressClick,
            onDblclickCapture: drag.suppressClick,
            onContextmenuCapture: drag.suppressClick,
          });
      },
    });
    app.mount(root);
    row = root.firstElementChild as HTMLElement;
  });
  afterEach(() => {
    app.unmount();
    root.remove();
    vi.useRealTimers();
  });

  it("长按后按真实滚动区域和顶部内边距计算目标，并拦截松开后的点击", () => {
    mouse("mousedown", 150, row);
    vi.advanceTimersByTime(300);
    mouse("mousemove", 240);
    mouse("mouseup", 240);
    expect(onReorder).toHaveBeenCalledWith(0, 1, 2, [0]);
    const click = new MouseEvent("click", { cancelable: true });
    drag.suppressClick(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it("提前移动不取消等待，按住满 250 毫秒且位移超过 5 像素后触发", () => {
    mouse("mousedown", 150, row);
    mouse("mousemove", 240);
    vi.advanceTimersByTime(249);
    expect(drag.isDragging.value).toBe(false);
    expect(drag.dropIndicator.index).toBe(-1);
    vi.advanceTimersByTime(1);
    expect(drag.isDragging.value).toBe(true);
    expect(drag.dropIndicator).toEqual({ index: 2, position: "top" });
    vi.advanceTimersByTime(350);
    mouse("mouseup", 240);
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(0, 1, 2, [0]);
  });

  it("先按住满 250 毫秒仍须移动超过 5 像素才触发", () => {
    mouse("mousedown", 150, row);
    vi.advanceTimersByTime(250);
    expect(drag.isDragging.value).toBe(false);
    mouse("mousemove", 155);
    expect(drag.isDragging.value).toBe(false);
    mouse("mousemove", 156);
    expect(drag.isDragging.value).toBe(true);
    expect(drag.dragLabelData.value).toEqual({
      title: "歌曲",
      cover: "cover://test.jpg",
      artists: "歌手",
    });
    mouse("mouseup", 156);
    expect(drag.dragLabelData.value).toBeNull();
  });

  it("提前移动后回到阈值内，计时结束仍不触发拖拽", () => {
    mouse("mousedown", 150, row);
    mouse("mousemove", 240);
    mouse("mousemove", 154);
    vi.advanceTimersByTime(250);
    expect(drag.isDragging.value).toBe(false);
    mouse("mouseup", 154);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("未满 250 毫秒即松手不提交排序，也不会延迟激活", () => {
    mouse("mousedown", 150, row);
    mouse("mousemove", 240);
    vi.advanceTimersByTime(249);
    mouse("mouseup", 240);
    vi.advanceTimersByTime(500);
    expect(drag.isDragging.value).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("鼠标短按或轻微抖动仍是普通点击", () => {
    mouse("mousedown", 150, row);
    mouse("mousemove", 154);
    mouse("mouseup", 154);
    vi.advanceTimersByTime(350);
    expect(drag.isDragging.value).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
    const click = new MouseEvent("click", { cancelable: true });
    drag.suppressClick(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it("触摸长按前移动保留滚动手势", () => {
    const touches = [{ clientX: 100, clientY: 150 }] as Touch[];
    drag.handlePointerDown(new TouchEvent("touchstart", { touches }), 0, previewTrack);
    window.dispatchEvent(
      new TouchEvent("touchmove", { touches: [{ clientX: 100, clientY: 160 }] as Touch[] }),
    );
    vi.advanceTimersByTime(350);
    expect(drag.isDragging.value).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("右键和按钮不会进入拖动", () => {
    row.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true }));
    const button = document.createElement("button");
    row.appendChild(button);
    mouse("mousedown", 150, button);
    vi.advanceTimersByTime(350);
    expect(drag.isDragging.value).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it.each([{ indices: [0] }, { indices: [0, 2] }])(
    "右键取消 $indices 拖拽，保留原顺序和勾选，停止滚动并允许重新拖动",
    ({ indices }) => {
      selected.value = indices;
      mouse("mousedown", 150, row, { buttons: 1 });
      vi.advanceTimersByTime(250);
      mouse("mousemove", 399, window, { buttons: 1 });
      vi.advanceTimersByTime(192);
      const scrollTop = scroller.scrollTop;
      expect(scrollTop).toBeGreaterThan(0);
      expect(drag.draggedIndices.value).toEqual(indices);

      const rightDown = mouse("mousedown", 399, row, { button: 2, buttons: 3 });
      expect(rightDown.defaultPrevented).toBe(true);
      expect(drag.isDragging.value).toBe(false);
      expect(drag.dragLabelData.value).toBeNull();
      expect(drag.draggedIndices.value).toEqual([]);
      expect(drag.dropIndicator).toEqual({ index: -1, position: "none" });
      vi.advanceTimersByTime(1000);
      mouse("mousemove", 450, window, { buttons: 3 });
      expect(scroller.scrollTop).toBe(scrollTop);
      expect(drag.isDragging.value).toBe(false);
      mouse("mouseup", 450, row, { button: 2, buttons: 1 });
      mouse("mouseup", 450, row, { buttons: 0 });
      expect(onReorder).not.toHaveBeenCalled();
      expect(selected.value).toEqual(indices);

      scroller.scrollTop = 0;
      mouse("mousedown", 150, row, { buttons: 1 });
      vi.advanceTimersByTime(250);
      mouse("mousemove", 340, window, { buttons: 1 });
      mouse("mouseup", 340, row);
      expect(onReorder).toHaveBeenCalledExactlyOnceWith(0, 3, 4, indices);
    },
  );

  it.each([
    { first: 2, remaining: 1, last: 0 },
    { first: 0, remaining: 2, last: 2 },
  ])(
    "取消后先松开 $first 键，仍拦截长时间按住剩余按键产生的菜单和点击",
    ({ first, remaining, last }) => {
      mouse("mousedown", 150, row, { buttons: 1 });
      vi.advanceTimersByTime(250);
      mouse("mousemove", 240, window, { buttons: 1 });
      mouse("mousedown", 240, row, { button: 2, buttons: 3 });
      mouse("mouseup", 240, row, { button: first, buttons: remaining });
      vi.advanceTimersByTime(1000);
      expect(mouse("contextmenu", 240, document.body).defaultPrevented).toBe(true);
      expect(mouse("click", 240, row).defaultPrevented).toBe(true);
      mouse("mouseup", 240, row, { button: last, buttons: 0 });
      expect(mouse("click", 240, row).defaultPrevented).toBe(true);
      expect(mouse("dblclick", 240, row).defaultPrevented).toBe(true);
      expect(mouse("contextmenu", 240, row).defaultPrevented).toBe(true);
      expect(onReorder).not.toHaveBeenCalled();

      vi.advanceTimersByTime(401);
      expect(mouse("click", 240, row).defaultPrevented).toBe(false);
      expect(mouse("contextmenu", 240, row).defaultPrevented).toBe(false);
    },
  );

  it("选择保持拖拽时，右键和中键松开都不提交，继续移动并由左键松开确认", () => {
    rightClickAction.value = "keep";
    mouse("mousedown", 150, row, { buttons: 1 });
    vi.advanceTimersByTime(250);
    mouse("mousemove", 240, window, { buttons: 1 });
    mouse("mousedown", 240, row, { button: 2, buttons: 3 });
    mouse("mouseup", 240, row, { button: 2, buttons: 1 });
    expect(mouse("contextmenu", 240, document.body).defaultPrevented).toBe(true);
    mouse("mouseup", 240, row, { button: 1, buttons: 1 });
    expect(drag.isDragging.value).toBe(true);
    expect(onReorder).not.toHaveBeenCalled();
    mouse("mousemove", 340, window, { buttons: 1 });
    mouse("mouseup", 340, row);
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(0, 3, 4, [0]);
  });

  it.each([
    { indices: [0], first: 2, remaining: 1, last: 0 },
    { indices: [0, 2], first: 0, remaining: 2, last: 2 },
  ])(
    "右键更改立即提交 $indices，后续移动、重复右键及松键不会再次排序",
    ({ indices, first, remaining, last }) => {
      rightClickAction.value = "commit";
      selected.value = indices;
      mouse("mousedown", 150, row, { buttons: 1 });
      vi.advanceTimersByTime(250);
      mouse("mousemove", 340, window, { buttons: 1 });
      const rightDown = mouse("mousedown", 340, row, { button: 2, buttons: 3 });
      expect(rightDown.defaultPrevented).toBe(true);
      expect(onReorder).toHaveBeenCalledExactlyOnceWith(0, 3, 4, indices);
      expect(drag.isDragging.value).toBe(false);
      expect(drag.dragLabelData.value).toBeNull();
      expect(drag.dropIndicator).toEqual({ index: -1, position: "none" });
      expect(selected.value).toEqual(indices);

      mouse("mouseup", 340, row, { button: first, buttons: remaining });
      vi.advanceTimersByTime(1000);
      mouse("mousemove", 496, window, { buttons: remaining });
      vi.advanceTimersByTime(1000);
      expect(scroller.scrollTop).toBe(0);
      expect(mouse("contextmenu", 496, document.body).defaultPrevented).toBe(true);
      expect(mouse("click", 496, row).defaultPrevented).toBe(true);
      if (remaining === 1) {
        mouse("mousedown", 496, row, { button: 2, buttons: 3 });
        mouse("mouseup", 496, row, { button: 2, buttons: 1 });
      }
      mouse("mouseup", 496, row, { button: last, buttons: 0 });
      expect(mouse("click", 496, row).defaultPrevented).toBe(true);
      expect(onReorder).toHaveBeenCalledTimes(1);
    },
  );

  it("右键更改提交时停止正在进行的边缘滚动", () => {
    rightClickAction.value = "commit";
    mouse("mousedown", 150, row, { buttons: 1 });
    vi.advanceTimersByTime(250);
    mouse("mousemove", 496, window, { buttons: 1 });
    vi.advanceTimersByTime(192);
    const scrollTop = scroller.scrollTop;
    expect(scrollTop).toBeGreaterThan(0);
    mouse("mousedown", 496, row, { button: 2, buttons: 3 });
    vi.advanceTimersByTime(1000);
    expect(scroller.scrollTop).toBe(scrollTop);
    expect(onReorder).toHaveBeenCalledTimes(1);
    mouse("mouseup", 496, row, { button: 2, buttons: 1 });
    mouse("mouseup", 496, row);
    expect(onReorder).toHaveBeenCalledTimes(1);
  });

  it("右键提交触发列表更新和保存禁用后，仍拦截尚未释放的按键", async () => {
    rightClickAction.value = "commit";
    onReorder.mockImplementationOnce(() => drag.cancelDrag());
    mouse("mousedown", 150, row, { buttons: 1 });
    vi.advanceTimersByTime(250);
    mouse("mousemove", 340, window, { buttons: 1 });
    mouse("mousedown", 340, row, { button: 2, buttons: 3 });
    enabled.value = false;
    await nextTick();
    mouse("mouseup", 340, row, { button: 2, buttons: 1 });
    vi.advanceTimersByTime(1000);
    expect(mouse("contextmenu", 340, document.body).defaultPrevented).toBe(true);
    mouse("mouseup", 340, row);
    expect(mouse("click", 340, row).defaultPrevented).toBe(true);
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(0, 3, 4, [0]);
    vi.advanceTimersByTime(401);
    expect(mouse("contextmenu", 340, document.body).defaultPrevented).toBe(false);
    expect(mouse("click", 340, row).defaultPrevented).toBe(false);
  });

  it("右键更改模式下，在原位置结束仍不提交排序", () => {
    rightClickAction.value = "commit";
    mouse("mousedown", 150, row, { buttons: 1 });
    vi.advanceTimersByTime(250);
    mouse("mousemove", 156, window, { buttons: 1 });
    expect(drag.isDragging.value).toBe(true);
    mouse("mousedown", 156, row, { button: 2, buttons: 3 });
    expect(drag.isDragging.value).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
    mouse("mouseup", 156, row, { button: 2, buttons: 1 });
    mouse("mouseup", 156, row);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("未拖拽时右键仍可正常打开菜单", () => {
    expect(mouse("mousedown", 150, row, { button: 2, buttons: 2 }).defaultPrevented).toBe(false);
    mouse("mouseup", 150, row, { button: 2 });
    expect(mouse("contextmenu", 150, row).defaultPrevented).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(drag.isDragging.value).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("长按松开但没有移动时不改变非连续选择的顺序", () => {
    selected.value = [0, 2];
    mouse("mousedown", 150, row);
    vi.advanceTimersByTime(300);
    expect(drag.isDragging.value).toBe(false);
    mouse("mouseup", 150);
    expect(onReorder).not.toHaveBeenCalled();
    const click = new MouseEvent("click", { cancelable: true });
    drag.suppressClick(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it("固定激活时的批量范围并保留非连续选中项的相对顺序", () => {
    selected.value = [0, 2];
    mouse("mousedown", 150, row);
    vi.advanceTimersByTime(300);
    mouse("mousemove", 340);
    selected.value = [1];
    mouse("mouseup", 340);
    expect(onReorder).toHaveBeenCalledWith(0, 3, 4, [0, 2]);
    expect(moveItemsToGap(["a", "b", "c", "d", "e"], [2, 0], 4)).toEqual(["b", "d", "a", "c", "e"]);
    expect(moveItemsToGap(["a", "b", "c", "d"], [1, 2], 2)).toEqual(["a", "b", "c", "d"]);
  });

  it.each(["blur", "touchcancel", "escape", "disabled", "unmount"])(
    "%s 取消拖动并清理动画",
    async (reason) => {
      mouse("mousedown", 150, row);
      vi.advanceTimersByTime(300);
      mouse("mousemove", 399);
      if (reason === "disabled") {
        enabled.value = false;
        await nextTick();
      } else if (reason === "unmount") app.unmount();
      else if (reason === "escape")
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      else window.dispatchEvent(new Event(reason));
      expect(drag.isDragging.value).toBe(false);
      vi.advanceTimersByTime(1000);
      mouse("mouseup", 399);
      expect(onReorder).not.toHaveBeenCalled();
      expect(scroller.scrollTop).toBe(0);
    },
  );

  it("指针停在边缘时连续滚动，到底后停止且仍可反向拖回顶部", () => {
    mouse("mousedown", 150, row);
    vi.advanceTimersByTime(300);
    mouse("mousemove", 399);
    vi.advanceTimersByTime(6000);
    expect(scroller.scrollTop).toBe(800);
    mouse("mousemove", 101);
    vi.advanceTimersByTime(6000);
    expect(scroller.scrollTop).toBe(0);
    mouse("mouseup", 101);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("拿起靠近顶部的歌曲并向列表内部移动时不自动上滚", () => {
    scroller.scrollTop = 400;
    mouse("mousedown", 110, row);
    vi.advanceTimersByTime(250);
    mouse("mousemove", 116);
    vi.advanceTimersByTime(1000);
    expect(drag.isDragging.value).toBe(true);
    expect(scroller.scrollTop).toBe(400);
    mouse("mousemove", 104);
    vi.advanceTimersByTime(1000);
    expect(scroller.scrollTop).toBeLessThan(400);
    expect(scroller.scrollTop).toBeGreaterThan(160);
  });

  it("刚进入滚动边缘时缓慢滚动，靠近边界才逐渐加速", () => {
    mouse("mousedown", 150, row);
    vi.advanceTimersByTime(250);
    mouse("mousemove", 376);
    vi.advanceTimersByTime(1000);
    const nearEdge = scroller.scrollTop;
    expect(nearEdge).toBeGreaterThan(0);
    expect(nearEdge).toBeLessThan(20);
    mouse("mousemove", 399);
    vi.advanceTimersByTime(1000);
    const atEdge = scroller.scrollTop - nearEdge;
    expect(atEdge).toBeGreaterThan(200);
    expect(atEdge).toBeLessThanOrEqual(240);
    mouse("mousemove", 250);
    vi.advanceTimersByTime(1000);
    expect(scroller.scrollTop).toBe(nearEdge + atEdge);
  });

  it.each([-1, 1])("向 %s 方向超出边缘越远越快，拉回边缘随即减速", (direction) => {
    const boundary = direction < 0 ? 100 : 400;
    const distances: number[] = [];
    mouse("mousedown", 250, row);
    vi.advanceTimersByTime(250);
    for (const outside of [0, 32, 64, 96, 512, 0]) {
      scroller.scrollTop = 400;
      mouse("mousemove", boundary + direction * outside);
      vi.advanceTimersByTime(192);
      distances.push(Math.abs(scroller.scrollTop - 400));
    }
    mouse("mouseup", boundary);
    expect(distances[1]).toBeGreaterThan(distances[0]);
    expect(distances[2]).toBeGreaterThan(distances[1]);
    expect(distances[3]).toBeGreaterThan(distances[2]);
    expect(distances[3]).toBeLessThan(360);
    expect(Math.abs(distances[4] - distances[3])).toBeLessThanOrEqual(1);
    expect(Math.abs(distances[5] - distances[0])).toBeLessThanOrEqual(4);
  });

  it.each([399, 464])("指针位于 %s 时，60 Hz 和 144 Hz 下滚动距离相同", (y) => {
    let frame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    const distances: number[] = [];
    for (const fps of [60, 144]) {
      scroller.scrollTop = 0;
      mouse("mousedown", 150, row);
      vi.advanceTimersByTime(250);
      mouse("mousemove", y);
      for (let i = 0; i <= fps / 2; i++) frame!((i * 1000) / fps);
      distances.push(scroller.scrollTop);
      mouse("mouseup", y);
    }
    expect(distances[0]).toBeGreaterThan(100);
    expect(distances[0]).toBeLessThan(800);
    expect(Math.abs(distances[0] - distances[1])).toBeLessThanOrEqual(1);
  });
});
