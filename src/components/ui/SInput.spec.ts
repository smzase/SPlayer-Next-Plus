import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h, ref } from "vue";
import { describe, expect, it } from "vitest";
import SInput from "./SInput.vue";

const ContextMenuStub = defineComponent({
  emits: {
    select: (_key: string) => true,
    closed: () => true,
  },
  setup(_, { emit, slots }) {
    return () =>
      h("div", [
        slots.default?.(),
        h(
          "button",
          {
            "data-menu-action": "delete",
            onClick: () => {
              emit("select", "delete");
              emit("closed");
            },
          },
          "delete",
        ),
        h(
          "button",
          {
            "data-menu-action": "selectAll",
            onClick: () => {
              emit("select", "selectAll");
              emit("closed");
            },
          },
          "select all",
        ),
      ]);
  },
});

const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  messages: {
    "zh-CN": {
      inputMenu: {
        cut: "剪切",
        copy: "复制",
        paste: "粘贴",
        delete: "删除",
        selectAll: "全选",
        pasteFailed: "无法读取剪贴板",
      },
      common: {
        copied: "已复制",
        copyFailed: "复制失败",
      },
    },
  },
});

const mountInput = (type: "text" | "textarea") => {
  const Harness = defineComponent({
    components: { SInput },
    setup() {
      return { type, value: ref("abcd") };
    },
    template: '<SInput v-model="value" :type="type" />',
  });

  return mount(Harness, {
    attachTo: document.body,
    global: {
      components: {
        IconLucideX: defineComponent({ render: () => h("span") }),
        SContextMenu: ContextMenuStub,
      },
      plugins: [i18n],
    },
  });
};

const waitForSelectionRestore = async (): Promise<void> => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

describe("SInput 文本编辑菜单", () => {
  it("删除选中文字后恢复单行输入框焦点和光标", async () => {
    const wrapper = mountInput("text");
    const input = wrapper.get("input");
    const element = input.element as HTMLInputElement;
    element.focus();
    element.setSelectionRange(1, 3);

    await input.trigger("contextmenu");
    await wrapper.get('[data-menu-action="delete"]').trigger("click");
    await waitForSelectionRestore();

    expect(element.value).toBe("ad");
    expect(document.activeElement).toBe(element);
    expect(element.selectionStart).toBe(1);
    expect(element.selectionEnd).toBe(1);
    wrapper.unmount();
  });

  it("在多行输入框执行全选后恢复完整选区", async () => {
    const wrapper = mountInput("textarea");
    const input = wrapper.get("textarea");
    const element = input.element as HTMLTextAreaElement;
    element.focus();
    element.setSelectionRange(2, 2);

    await input.trigger("contextmenu");
    await wrapper.get('[data-menu-action="selectAll"]').trigger("click");
    await waitForSelectionRestore();

    expect(document.activeElement).toBe(element);
    expect(element.selectionStart).toBe(0);
    expect(element.selectionEnd).toBe(4);
    wrapper.unmount();
  });
});
