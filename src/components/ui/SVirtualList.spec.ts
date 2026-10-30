import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SVirtualList, { type SVirtualListExposed } from "./SVirtualList.vue";

describe("分碟虚拟列表与拖拽定位", () => {
  it("分碟行高变化后定位与放置位置一致，滚动状态立即更新", async () => {
    const wrapper = mount(SVirtualList, {
      props: {
        items: ["disc-1-track-1", "disc-1-track-2", "disc-2-track-1"],
        itemHeight: 88,
        exactItemHeights: [128, 88, 128],
      },
    });
    const list = wrapper.vm as unknown as SVirtualListExposed;
    expect(list.getItemTop(2)).toBe(216);
    expect(list.getDropInfoByOffset(200)).toEqual({ index: 1, position: "bottom" });
    list.scrollToIndex(2);
    expect(list.getScrollTop()).toBe(216);

    await wrapper.setProps({ itemHeight: 56, exactItemHeights: [96, 56, 96] });
    expect(list.getItemTop(2)).toBe(152);
    expect(list.getDropInfoByOffset(200)).toEqual({ index: 2, position: "bottom" });
    list.scrollToIndex(2);
    expect(list.getScrollTop()).toBe(152);
    wrapper.unmount();
  });

  it("切回普通歌单后使用定高坐标，搜索过滤后不残留旧分碟高度", async () => {
    const wrapper = mount(SVirtualList, {
      props: { items: ["a", "b", "c"], itemHeight: 88, exactItemHeights: [128, 88, 128] },
    });
    const list = wrapper.vm as unknown as SVirtualListExposed;
    await wrapper.setProps({ itemFixed: true, exactItemHeights: undefined });
    expect(list.getItemTop(2)).toBe(176);
    expect(list.getDropInfoByOffset(210)).toEqual({ index: 2, position: "top" });

    await wrapper.setProps({ items: ["c"], itemFixed: false, exactItemHeights: [128] });
    expect(list.getItemTop(0)).toBe(0);
    expect(list.getDropInfoByOffset(80)).toEqual({ index: 0, position: "bottom" });
    list.scrollTo(-10);
    expect(list.getScrollTop()).toBe(0);
    wrapper.unmount();
  });
});
