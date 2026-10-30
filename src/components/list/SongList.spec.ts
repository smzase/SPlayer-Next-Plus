import { shallowMount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import { nextTick, ref } from "vue";
import type { Track } from "@shared/types/player";
import type { DragSortOptions } from "@/composables/useDragSort";
import zhCN from "@/i18n/locales/zh-CN.json";
import SVirtualList, { type SVirtualListProps } from "@/components/ui/SVirtualList.vue";
import SongList from "./SongList.vue";

const mocks = vi.hoisted(() => ({
  playFrom: vi.fn(),
  playNow: vi.fn(),
  pointerDown: vi.fn(),
  dragOptions: undefined as DragSortOptions | undefined,
  settings: {
    appearance: {
      layoutMode: "default",
      songListStyle: "comfortable",
      dragRightClickAction: "cancel",
    },
    player: { singleTrackQueueMode: "replace" },
  },
}));
vi.mock("vue-router", () => ({ useRoute: () => ({ name: "collection" }) }));
vi.mock("@vueuse/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vueuse/core")>()),
  useElementSize: () => ({ width: ref(1000), height: ref(600) }),
}));
vi.mock("@/stores/media", () => ({ useMediaStore: () => ({ track: null }) }));
vi.mock("@/stores/status", () => ({ useStatusStore: () => ({ isPlaying: false }) }));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/download", () => ({ useDownloadStore: () => ({ isDownloaded: () => false }) }));
vi.mock("@/core/player", () => ({ playFrom: mocks.playFrom, playNow: mocks.playNow }));
vi.mock("@/utils/navigate", () => ({}));
vi.mock("@/composables/useTrackMenu", () => ({
  useTrackMenu: () => ({ items: [], handleSelect: vi.fn() }),
}));
vi.mock("@/composables/useDownload", () => ({ useDownload: () => ({ enqueue: vi.fn() }) }));
vi.mock("@/composables/useFavorite", () => ({
  useFavorite: () => ({ isSupported: () => false, isLiked: () => false }),
}));
vi.mock("@/composables/useFloatingPlayerBar", () => ({ PLAYER_BAR_GAP: 104 }));
vi.mock("@/composables/usePlaylistPicker", () => ({
  usePlaylistPicker: () => ({
    open: ref(false),
    tracks: ref([]),
    mode: ref("local"),
    openPicker: vi.fn(),
  }),
}));
vi.mock("@/composables/useMultiSelect", () => ({
  useMultiSelect: () => ({
    active: ref(false),
    selectedIds: ref(new Set()),
    selectedItems: ref([]),
    selectedCount: ref(0),
    canRemove: ref(false),
    canRemoveFromCloud: ref(false),
    deleteConfirmOpen: ref(false),
    exit: vi.fn(),
    enter: vi.fn(),
  }),
}));
vi.mock("@/composables/useDragSort", () => ({
  useDragSort: (options: DragSortOptions) => {
    mocks.dragOptions = options;
    return {
      isDragging: ref(false),
      draggedIndices: ref([]),
      dropIndicator: { index: -1, position: "none" },
      dragLabelData: ref(null),
      dragLabelPosition: { top: 0, left: 0 },
      handlePointerDown: mocks.pointerDown,
      suppressClick: vi.fn(),
      cancelDrag: vi.fn(),
    };
  },
}));

const tracks: Track[] = [
  { id: "b1", title: "乙一", disc: 2, discTitle: "下篇" },
  { id: "a1", title: "甲一", disc: 1, discTitle: "上篇" },
  { id: "a2", title: "甲二", disc: 1 },
].map((track) => ({ ...track, source: "netease", artists: [], duration: 20000 }));
const wrappers: VueWrapper[] = [];

/**
 * 挂载歌曲列表和真实虚拟列表，检查分碟、播放与拖拽之间的索引关系
 * @param collectionType - 专辑或允许手动排序的歌单
 * @returns 歌曲列表组件
 */
const mountList = async (collectionType: "album" | "playlist") => {
  const wrapper = shallowMount(SongList, {
    props: { items: tracks, collectionType, canReorder: collectionType === "playlist" },
    global: {
      renderStubDefaultSlot: true,
      components: { SVirtualList },
      plugins: [createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": zhCN } })],
      stubs: {
        SVirtualList: false,
        ...Object.fromEntries(
          [
            "SImg",
            "SButton",
            "SCheckbox",
            "SContextMenu",
            "SDialog",
            "SDivider",
            "SIconSwap",
            "SLoading",
            "SPopover",
            "SRadio",
            "SRadioGroup",
            "STag",
            "PlaylistPickerDialog",
            "TagEditorDialog",
            "DragSortPreview",
            "IconLucideArrowLeftRight",
            "IconLucideArrowUp",
            "IconLucideArrowUpAz",
            "IconLucideArrowUpDown",
            "IconLucideCheck",
            "IconLucideCloud",
            "IconLucideCloudOff",
            "IconLucideDisc3",
            "IconLucideDownload",
            "IconLucideListEnd",
            "IconLucideListMinus",
            "IconLucideListPlus",
            "IconLucideLocate",
            "IconLucideMusic",
            "IconLucidePause",
            "IconLucidePlay",
            "IconLucideSearchX",
            "IconLucideTrash2",
            "IconLucideX",
            "IconMaterialSymbolsFavoriteOutlineRounded",
            "IconMaterialSymbolsFavoriteRounded",
          ].map((name) => [name, true]),
        ),
      },
    },
  });
  wrappers.push(wrapper);
  await nextTick();
  return wrapper;
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("专辑分碟与 fork 歌单交互兼容", () => {
  it("按碟号展示标题和碟内曲序，点击第二碟使用同一播放顺序", async () => {
    const wrapper = await mountList("album");
    expect(wrapper.findAll("h2").map((header) => header.text().replace(/\s+/g, " "))).toEqual([
      "CD 1 · 上篇",
      "CD 2 · 下篇",
    ]);
    const rows = wrapper.findAll("[data-song-item]");
    expect(rows.map((row) => row.text().trim()[0])).toEqual(["1", "2", "1"]);
    await rows[2].trigger("dblclick");
    expect(mocks.playFrom).toHaveBeenCalledWith([tracks[1], tracks[2], tracks[0]], {
      startIndex: 2,
      context: undefined,
    });
    expect(mocks.dragOptions?.enabled?.value).toBe(false);
  });

  it("过滤专辑后保留碟内曲序，并重算分碟高度与点击索引", async () => {
    const wrapper = await mountList("album");
    await wrapper.setProps({ searchQuery: "甲二" });
    const row = wrapper.get("[data-song-item]");
    expect(row.text().trim()[0]).toBe("2");
    expect(
      (wrapper.getComponent(SVirtualList).props() as SVirtualListProps<Track>).exactItemHeights,
    ).toEqual([128]);
    await row.trigger("dblclick");
    expect(mocks.playFrom).toHaveBeenCalledWith([tracks[2]], { startIndex: 0, context: undefined });
  });

  it("歌单保留原顺序与长按拖拽，排序回调只产生一份新顺序", async () => {
    const wrapper = await mountList("playlist");
    expect(wrapper.findAll("h2")).toHaveLength(0);
    expect((wrapper.getComponent(SVirtualList).props() as SVirtualListProps<Track>).itemFixed).toBe(
      true,
    );
    expect(mocks.dragOptions?.enabled?.value).toBe(true);
    const rows = wrapper.findAll("[data-song-item]");
    await rows[0].trigger("mousedown", { button: 0 });
    expect(mocks.pointerDown).toHaveBeenCalledWith(expect.any(MouseEvent), 0, tracks[0]);
    mocks.dragOptions!.onReorder(0, 2, 3, [0]);
    expect(wrapper.emitted("reorder")).toEqual([[[tracks[1], tracks[2], tracks[0]]]]);
  });
});
