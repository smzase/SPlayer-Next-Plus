import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick, type Ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import zhCN from "@/i18n/locales/zh-CN.json";
import { DEFAULT_AMLL_DB_SERVERS } from "@shared/defaults/lyrics";
import AmllDbServerConfig from "./AmllDbServerConfig.vue";

const state = vi.hoisted(() => ({
  list: null as Ref<{ id: number; url: string }[]> | null,
  error: vi.fn(),
}));
vi.mock("@/composables/useToast", () => ({ toast: { error: state.error } }));
vi.mock("@vueuse/integrations/useSortable", () => ({
  useSortable: (_element: unknown, list: Ref<{ id: number; url: string }[]>) => {
    state.list = list;
  },
}));

/**
 * 挂载来源配置并打开弹窗
 * @param modelValue - 配置值，包含热更新期间尚未迁移的旧地址
 * @returns 配置组件测试实例
 */
const mountConfig = async (modelValue: string[] | string = [...DEFAULT_AMLL_DB_SERVERS]) => {
  const wrapper = mount(AmllDbServerConfig, {
    props: { modelValue },
    global: {
      plugins: [createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": zhCN } })],
      stubs: {
        SButton: { template: "<button><slot /></button>" },
        SDialog: {
          props: ["open"],
          emits: ["update:open"],
          template:
            '<section v-if="open"><slot /><slot name="footer" :close="() => $emit(\'update:open\', false)" /></section>',
        },
        SCard: { template: "<div><slot /></div>" },
        SInput: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        IconLucideGripVertical: true,
        IconLucideTrash2: true,
        IconLucidePlus: true,
      },
    },
  });
  await wrapper.get("button").trigger("click");
  return wrapper;
};

describe("TTML 来源编辑", () => {
  beforeEach(() => state.error.mockReset());

  it("旧进程返回单地址时仍能打开配置并保存多个源", async () => {
    const legacy = "https://custom.example/%p/%s.ttml";
    const wrapper = await mountConfig(legacy);
    expect(wrapper.findAll("input").map((input) => input.element.value)).toEqual([
      legacy,
      DEFAULT_AMLL_DB_SERVERS[1],
    ]);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "确认")!
      .trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([
      [legacy, DEFAULT_AMLL_DB_SERVERS[1]],
    ]);
    wrapper.unmount();
  });

  it("添加来源并保存排序后的纯地址数组", async () => {
    const wrapper = await mountConfig();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "添加源")!
      .trigger("click");
    await wrapper.findAll("input")[2].setValue(" https://third.example/%p/%s.ttml ");
    state.list!.value = [state.list!.value[2], state.list!.value[0], state.list!.value[1]];
    await nextTick();
    expect(wrapper.findAll("input")[0].element.value).toContain("third.example");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "确认")!
      .trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([
      ["https://third.example/%p/%s.ttml", ...DEFAULT_AMLL_DB_SERVERS],
    ]);
    wrapper.unmount();
  });

  it("重复来源和缺失占位符的地址不保存", async () => {
    const wrapper = await mountConfig();
    await wrapper.findAll("input")[1].setValue(DEFAULT_AMLL_DB_SERVERS[0]);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "确认")!
      .trigger("click");
    expect(state.error).toHaveBeenLastCalledWith(zhCN.settings.amllDbServer.duplicate);
    await wrapper.findAll("input")[1].setValue("https://example.com/%s.ttml");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "确认")!
      .trigger("click");
    expect(state.error).toHaveBeenLastCalledWith(zhCN.settings.amllDbServer.invalid);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    wrapper.unmount();
  });

  it("取消编辑不修改配置，重新打开恢复已保存列表", async () => {
    const wrapper = await mountConfig();
    await wrapper.get("input").setValue("https://changed.example/%p/%s.ttml");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "取消")!
      .trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await wrapper.get("button").trigger("click");
    expect(wrapper.get("input").element.value).toBe(DEFAULT_AMLL_DB_SERVERS[0]);
    wrapper.unmount();
  });
});
