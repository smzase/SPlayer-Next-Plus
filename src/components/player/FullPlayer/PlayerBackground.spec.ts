import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { reactive, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerBgRenderer, PlayerBgType } from "@/types/settings";
import PlayerBackground from "./PlayerBackground.vue";
import BackgroundRender from "./BackgroundRender.vue";

const settings = reactive({
  player: {
    playerBgType: "blur" as PlayerBgType,
    playerBgRenderer: "mesh" as PlayerBgRenderer,
    playerBgFreezeOnPause: false,
    playerBgFps: 30,
  },
});
const status = reactive({ isPlayerExpanded: true, isPlaying: true });
const morphDisposed = vi.fn();
vi.mock("./background/FluidMorph", () => ({
  FluidMorph: class {
    private timer: ReturnType<typeof setTimeout>;
    /**
     * 模拟 GPU 就绪与形变结束事件，验证组件之间的生命周期约定
     * @param _canvas - 输出画布
     * @param _from - 旧画布
     * @param _to - 新画布
     * @param _fps - 帧率上限
     * @param ready - 首帧就绪回调
     * @param complete - 形变结束回调
     */
    constructor(
      _canvas: HTMLCanvasElement,
      _from: HTMLCanvasElement,
      _to: HTMLCanvasElement,
      _fps: number,
      ready: () => void,
      complete: () => void,
    ) {
      ready();
      this.timer = setTimeout(complete, 1800);
    }
    /** 记录临时资源释放并取消尚未触发的回调 */
    dispose(): void {
      clearTimeout(this.timer);
      morphDisposed();
    }
  },
}));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => settings }));
vi.mock("@/stores/status", () => ({ useStatusStore: () => status }));
vi.mock("@/stores/media", () => ({ useMediaStore: () => ({ track: null, parsedLyric: [] }) }));
vi.mock("./BackgroundRender.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    __esModule: true,
    default: defineComponent({
      props: { renderEngine: String, visible: Boolean, playing: Boolean },
      emits: ["ready", "error"],
      setup: () => () => h("canvas"),
    }),
  };
});

let wrapper: VueWrapper;
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
  });
  settings.player.playerBgType = "blur";
  settings.player.playerBgRenderer = "mesh";
  status.isPlayerExpanded = true;
  morphDisposed.mockClear();
  wrapper = mount(PlayerBackground, { props: { visible: true, active: true } });
});
afterEach(() => {
  wrapper.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("背景过渡生命周期", () => {
  it("保留旧背景直到新画布就绪，淡入完成后释放旧图层", async () => {
    settings.player.playerBgType = "animation";
    settings.player.playerBgRenderer = "titanium";
    await nextTick();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2000);
    expect(wrapper.findAll(".bg-layer")).toHaveLength(2);
    expect(wrapper.findAll(".bg-layer.ready")).toHaveLength(1);
    wrapper.getComponent(BackgroundRender).vm.$emit("ready");
    await nextTick();
    expect(wrapper.findAll(".bg-layer.ready")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(650);
    expect(wrapper.findAll(".bg-layer")).toHaveLength(1);
    expect(wrapper.findAll("canvas")).toHaveLength(1);
  });

  it("连续切换最多保留两层，并最终应用最后一次选择", async () => {
    settings.player.playerBgType = "animation";
    settings.player.playerBgRenderer = "titanium";
    await nextTick();
    await flushPromises();
    settings.player.playerBgRenderer = "mesh";
    await nextTick();
    settings.player.playerBgType = "solid";
    await nextTick();
    expect(wrapper.findAll(".bg-layer")).toHaveLength(2);
    wrapper.getComponent(BackgroundRender).vm.$emit("ready");
    await vi.advanceTimersByTimeAsync(650);
    expect(wrapper.findAll(".bg-layer")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(750);
    expect(wrapper.findAll(".bg-layer")).toHaveLength(1);
    expect(wrapper.findAll("canvas")).toHaveLength(0);
    expect(wrapper.find(".bg-layer .bg-solid-wrap").exists()).toBe(true);
  });

  it("初始化失败回到封面且不反复创建失败渲染器，收起后释放图层", async () => {
    settings.player.playerBgType = "animation";
    settings.player.playerBgRenderer = "titanium";
    await nextTick();
    await flushPromises();
    wrapper.getComponent(BackgroundRender).vm.$emit("error", new Error("WebGL unavailable"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(wrapper.findAll(".bg-layer")).toHaveLength(1);
    expect(wrapper.findAll("canvas")).toHaveLength(0);
    expect(wrapper.find(".bg-layer .bg-blur-wrap").exists()).toBe(true);
    await wrapper.setProps({ visible: false, active: false });
    expect(wrapper.findAll(".bg-layer")).toHaveLength(0);
  });

  it("收起过程中暂停绘制，窗口隐藏时也暂停背景", async () => {
    settings.player.playerBgType = "animation";
    await nextTick();
    await flushPromises();
    const renderer = wrapper.getComponent(BackgroundRender);
    expect(renderer.props("visible")).toBe(true);
    status.isPlayerExpanded = false;
    await nextTick();
    expect(renderer.props("visible")).toBe(false);
    expect(renderer.props("playing")).toBe(false);
    status.isPlayerExpanded = true;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await nextTick();
    expect(renderer.props("visible")).toBe(false);
    expect(renderer.props("playing")).toBe(false);
  });

  it("流体之间使用实时形变并在结束后释放合成器与旧画布", async () => {
    settings.player.playerBgType = "animation";
    await nextTick();
    await flushPromises();
    wrapper.getComponent(BackgroundRender).vm.$emit("ready");
    await vi.advanceTimersByTimeAsync(650);
    settings.player.playerBgRenderer = "titanium";
    await nextTick();
    await flushPromises();
    wrapper.findAllComponents(BackgroundRender)[1].vm.$emit("ready");
    await nextTick();
    const incoming = wrapper.findAll<HTMLElement>(".bg-layer")[1].element;
    expect(wrapper.find(".fluid-transition").exists()).toBe(true);
    expect(incoming.style.transition).toBe("none");
    expect(incoming.style.opacity).toBe("1");
    await vi.advanceTimersByTimeAsync(650);
    expect(wrapper.findAll("canvas")).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1200);
    expect(wrapper.findAll("canvas")).toHaveLength(1);
    expect(wrapper.find(".fluid-transition").exists()).toBe(false);
    expect(incoming.style.opacity).toBe("");
    expect(morphDisposed).toHaveBeenCalledTimes(1);
  });

  it("形变期间收起立即释放合成器，保留的背景暂停", async () => {
    settings.player.playerBgType = "animation";
    await nextTick();
    await flushPromises();
    wrapper.getComponent(BackgroundRender).vm.$emit("ready");
    await vi.advanceTimersByTimeAsync(650);
    settings.player.playerBgRenderer = "titanium";
    await nextTick();
    await flushPromises();
    wrapper.findAllComponents(BackgroundRender)[1].vm.$emit("ready");
    await nextTick();
    expect(wrapper.find(".fluid-transition").exists()).toBe(true);
    status.isPlayerExpanded = false;
    await nextTick();
    expect(wrapper.find(".fluid-transition").exists()).toBe(false);
    expect(wrapper.findAll("canvas")).toHaveLength(1);
    expect(wrapper.getComponent(BackgroundRender).props("visible")).toBe(false);
    expect(morphDisposed).toHaveBeenCalledTimes(1);
  });
});
