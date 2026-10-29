import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { reactive } from "vue";
import type { UpdateMeta } from "@shared/types/update";
import UpdateDialog from "./UpdateDialog.vue";

const mocks = vi.hoisted(() => ({
  store: {
    phase: "available",
    errorSource: undefined as string | undefined,
    canInstall: true,
    dialogOpen: true,
    meta: null as UpdateMeta | null,
    percent: 23,
    download: vi.fn(),
    checkManually: vi.fn(),
    install: vi.fn(),
    openDownloadPage: vi.fn(),
  },
}));
vi.mock("@/stores/update", () => ({ useUpdateStore: () => mocks.store }));
vi.mock("@/utils/config", () => ({ APP_VERSION: "1.0.0", IS_APPX: false }));
vi.mock("@/utils/format", () => ({ formatFileSize: () => "0 B" }));
/**
 * 挂载更新弹窗并保留正文和按钮交互
 * @returns 可检查正文和触发操作的组件包装器
 */
const mountDialog = () =>
  mount(UpdateDialog, {
    global: {
      plugins: [
        createI18n({ legacy: false, locale: "zh-CN", missingWarn: false, fallbackWarn: false }),
      ],
      stubs: {
        SDialog: { template: '<div><slot/><slot name="footer" :close="() => {}"/></div>' },
        SButton: { props: ["disabled"], template: '<button :disabled="disabled"><slot/></button>' },
        STag: { template: "<span><slot/></span>" },
        IconLucideArrowRight: true,
        IconLucideCalendar: true,
        IconLucideHardDrive: true,
      },
    },
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.store = reactive({
    ...mocks.store,
    phase: "available",
    errorSource: undefined,
    meta: null,
  });
});

describe("更新弹窗的发布正文", () => {
  const downloadUrl =
    "https://github.com/smzase/SPlayer-Next-Plus/releases/download/v1.2.2-beta.1/setup.exe";
  const compareUrl =
    "https://github.com/smzase/SPlayer-Next-Plus/compare/v1.2.1-beta.1...v1.2.2-beta.1";
  const downloads = `| 系统 | 架构 | 下载 |\n| --- | --- | --- |\n| Windows | x64 | [安装版](${downloadUrl}) |`;
  const changelog = `**Full Changelog**: ${compareUrl}`;

  beforeEach(() => {
    mocks.store.meta = {
      version: "1.2.2-beta.1",
      releaseNotes: "",
      releaseDate: "2026-10-29T00:00:00Z",
      size: 0,
      releaseUrl: "https://github.com/smzase/SPlayer-Next-Plus/releases/tag/v1.2.2-beta.1",
    };
  });

  it.each([
    [
      "Markdown",
      `## 本次更新\n\n- **Electron** 升级至 45.0.0\n\n${downloads}\n\n${changelog}\n\n补充说明`,
    ],
    [
      "GitHub Atom HTML",
      `<h2>本次更新</h2><ul><li><strong>Electron</strong> 升级至 45.0.0</li></ul>
      <table><thead><tr><th>系统</th><th>架构</th><th>下载</th></tr></thead>
      <tbody><tr><td>Windows</td><td>x64</td><td><a href="${downloadUrl}">安装版</a></td></tr></tbody></table>
      <p><strong>Full Changelog</strong>: <a class="commit-link" href="${compareUrl}"><tt>v1.2.1-beta.1...v1.2.2-beta.1</tt></a></p>
      <p>补充说明</p>`,
    ],
  ])("%s 只隐藏下载表和完整比较链接，保留正文及格式", (_format, notes) => {
    mocks.store.meta!.releaseNotes = notes;
    const wrapper = mountDialog();
    const body = wrapper.get(".markdown-body");
    expect(body.get("h2").text()).toBe("本次更新");
    expect(body.get("li strong").text()).toBe("Electron");
    expect(body.text()).toContain("升级至 45.0.0");
    expect(body.text()).toContain("补充说明");
    expect(body.find("table").exists()).toBe(false);
    expect(body.text()).not.toContain("Full Changelog");
    expect(body.html()).not.toContain(compareUrl);
    expect(mocks.store.meta!.releaseNotes).toBe(notes);
    wrapper.unmount();
  });

  it("保留普通表格、正文链接和代码示例", () => {
    mocks.store.meta!.releaseNotes = `| 功能 | 变化 |\n| --- | --- |\n| 歌词 | 支持多源 |\n\n[实现细节](${compareUrl})\n\n\`Full Changelog: 示例\`\n\n${downloads}\n\n${changelog}`;
    const wrapper = mountDialog();
    const body = wrapper.get(".markdown-body");
    expect(body.findAll("table")).toHaveLength(1);
    expect(body.get("table").text()).toContain("支持多源");
    expect(body.get("a").attributes("href")).toBe(compareUrl);
    expect(body.get("code").text()).toBe("Full Changelog: 示例");
    wrapper.unmount();
  });

  it.each(["", `${downloads}\n\n${changelog}`])("过滤后没有正文时不显示空白内容框", (notes) => {
    mocks.store.meta!.releaseNotes = notes;
    const wrapper = mountDialog();
    expect(wrapper.find(".markdown-body").exists()).toBe(false);
    wrapper.unmount();
  });

  it("新的版本正文会重新渲染", async () => {
    mocks.store.meta!.releaseNotes = `${downloads}\n\n${changelog}`;
    const wrapper = mountDialog();
    mocks.store.meta!.releaseNotes = "本次更新\n\n- 支持多个歌词源";
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".markdown-body li").text()).toBe("支持多个歌词源");
    wrapper.unmount();
  });
});

describe("更新弹窗的阶段动作", () => {
  it("可用版本显示下载操作", async () => {
    const wrapper = mountDialog();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "update.download")!
      .trigger("click");
    expect(mocks.store.download).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
  it("安装失败仍展示安装重试，不误触发重新下载", async () => {
    mocks.store.phase = "error";
    mocks.store.errorSource = "install";
    const wrapper = mountDialog();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "update.installNow")!
      .trigger("click");
    expect(mocks.store.install).toHaveBeenCalledOnce();
    expect(mocks.store.download).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("下载失败重新检查，避免继续下载已删除的 Nightly", async () => {
    mocks.store.phase = "error";
    mocks.store.errorSource = "download";
    const wrapper = mountDialog();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "settings.about.checkUpdate")!
      .trigger("click");
    expect(mocks.store.checkManually).toHaveBeenCalledOnce();
    expect(mocks.store.download).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each(["checking", "cancelling", "idle"])("%s 不提供下载或安装操作", (phase) => {
    mocks.store.phase = phase;
    const wrapper = mountDialog();
    expect(wrapper.text()).not.toContain("update.installNow");
    expect(wrapper.findAll("button").some((button) => button.text() === "update.download")).toBe(
      false,
    );
    wrapper.unmount();
  });
});
