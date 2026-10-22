import type { Ref } from "vue";
import type { Track } from "@shared/types/player";
import type { Collection, CollectionType } from "@/types/collection";
import type { CoverItem } from "@/types/artist";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";
import { loadCollection } from "@/services/collection";
import { fetchPodcastPrograms } from "@/apis/podcast/netease";
import { useCopyText } from "@/composables/useCopyText";
import { useDownload } from "@/composables/useDownload";
import { dialog } from "@/composables/useDialog";
import { toast } from "@/composables/useToast";
import { getCollectionShareUrl } from "@/utils/format/shareUrl";
import * as player from "@/core/player";
import IconLucideEye from "~icons/lucide/eye";
import IconLucidePlay from "~icons/lucide/play";
import IconLucideShare2 from "~icons/lucide/share-2";
import IconLucideDownload from "~icons/lucide/download";
import IconLucideTrash2 from "~icons/lucide/trash-2";

export type ResourceCardType = Exclude<CollectionType, "cloud"> | "artist";

/**
 * 收藏资源与播客卡片的通用右键菜单
 * @param resourceType - 当前页面展示的资源类型
 */
export const useResourceCardMenu = (resourceType: Ref<ResourceCardType>) => {
  const { t } = useI18n();
  const router = useRouter();
  const settings = useSettingsStore();
  const user = useUserStore();
  const { copy } = useCopyText();
  const download = useDownload();
  const downloading = ref(false);
  const downloadDisabled = computed(() => !settings.system.download.enabled);

  const menuItems = computed<DropdownMenuItem[]>(() => {
    const hasTracks = resourceType.value !== "artist";
    return [
      {
        key: "view",
        label: t("resourceMenu.view"),
        icon: markRaw(IconLucideEye),
      },
      {
        key: "play",
        label: t("resourceMenu.play"),
        icon: markRaw(IconLucidePlay),
        show: hasTracks,
      },
      {
        key: "share",
        label: t("resourceMenu.share"),
        icon: markRaw(IconLucideShare2),
      },
      {
        key: "downloadAll",
        label: t("resourceMenu.downloadAll"),
        icon: markRaw(IconLucideDownload),
        show: hasTracks,
        disabled: !settings.system.download.enabled,
      },
      {
        key: "delete",
        label: t(`resourceMenu.delete.${resourceType.value}`),
        icon: markRaw(IconLucideTrash2),
        separator: true,
      },
    ];
  });

  const openResource = (item: CoverItem): void => {
    if (resourceType.value === "artist") {
      void router.push(`/artist/netease/${encodeURIComponent(item.id)}`);
      return;
    }
    void router.push(`/collection/netease/${resourceType.value}/${encodeURIComponent(item.id)}`);
  };

  const shareResource = async (item: CoverItem): Promise<void> => {
    if (resourceType.value === "artist") {
      await copy(`https://music.163.com/#/artist?id=${item.id}`);
      return;
    }
    await copy(
      getCollectionShareUrl({
        id: item.id,
        source: "netease",
        type: resourceType.value,
      }),
    );
  };

  /**
   * 加载卡片对应的曲目
   * @param item - 当前卡片
   * @param loadAllRadio - 是否继续补齐播客的全部声音
   */
  const loadTracks = async (item: CoverItem, loadAllRadio: boolean): Promise<Track[]> => {
    if (resourceType.value === "artist") return [];
    let current: Collection | null = null;
    await loadCollection("netease", resourceType.value, item.id, {
      fallbackName: item.title,
      onUpdate: (next) => {
        if (next) current = next;
      },
    });
    const loaded = current as Collection | null;
    if (!loaded) throw new Error(t("resourceMenu.loadFailed", { title: item.title }));
    if (resourceType.value !== "radio" || !loadAllRadio) return loaded.tracks;

    const tracks = [...loaded.tracks];
    const seen = new Set(tracks.map((track) => track.extId ?? track.id));
    const total = loaded.trackCount ?? tracks.length;
    let offset = loaded.tracks.length;
    while (offset < total) {
      const page = await fetchPodcastPrograms(item.id, offset);
      if (page.items.length === 0) break;
      for (const track of page.items) {
        const key = track.extId ?? track.id;
        if (seen.has(key)) continue;
        seen.add(key);
        tracks.push(track);
      }
      offset += page.items.length;
      if (!page.hasMore) break;
    }
    return tracks;
  };

  const playResource = async (item: CoverItem): Promise<void> => {
    if (resourceType.value === "artist") return;
    const loading = toast.loading(t("resourceMenu.loading", { title: item.title }), {
      duration: 0,
    });
    try {
      const tracks = await loadTracks(item, false);
      await player.playFrom(tracks, {
        context: {
          provider: "netease",
          originId: item.id,
          originType: resourceType.value,
          originName: item.title,
        },
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("resourceMenu.loadFailed", { title: item.title }),
      );
    } finally {
      loading.close();
    }
  };

  const downloadResource = async (item: CoverItem): Promise<void> => {
    if (downloading.value) return;
    const confirmed = await dialog.confirm({
      title: t("resourceMenu.downloadConfirmTitle"),
      content: t("resourceMenu.downloadConfirm", { title: item.title }),
      confirmText: t("resourceMenu.downloadAll"),
      type: "warning",
    });
    if (!confirmed) return;

    downloading.value = true;
    const loading = toast.loading(t("resourceMenu.loading", { title: item.title }), {
      duration: 0,
    });
    try {
      const tracks = await loadTracks(item, true);
      download.enqueueMany(tracks);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("resourceMenu.loadFailed", { title: item.title }),
      );
    } finally {
      loading.close();
      downloading.value = false;
    }
  };

  /**
   * 下载多个资源中的全部曲目，只展示一次确认并合并重复歌曲
   * @param items - 已选择的资源卡片
   */
  const downloadResources = async (items: CoverItem[]): Promise<void> => {
    if (downloading.value || items.length === 0 || downloadDisabled.value) return;
    const confirmed = await dialog.confirm({
      title: t("resourceMenu.downloadConfirmTitle"),
      content: t("resourceMenu.downloadBatchConfirm", { count: items.length }),
      confirmText: t("resourceMenu.downloadAll"),
      type: "warning",
    });
    if (!confirmed) return;

    downloading.value = true;
    const loading = toast.loading(t("resourceMenu.loadingBatch"), { duration: 0 });
    try {
      const tracks: Track[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        const loaded = await loadTracks(item, true);
        for (const track of loaded) {
          const key = `${track.source}:${track.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          tracks.push(track);
        }
      }
      download.enqueueMany(tracks);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("resourceMenu.loadBatchFailed"));
    } finally {
      loading.close();
      downloading.value = false;
    }
  };

  const deleteResource = async (item: CoverItem): Promise<void> => {
    const type = resourceType.value;
    const createdPodcast =
      type === "radio" && user.createdPodcasts.some((podcast) => podcast.id === item.id);
    const confirmed = await dialog.confirm({
      title: t(`resourceMenu.delete.${type}`),
      content: t(
        createdPodcast ? "resourceMenu.deleteCreatedPodcastConfirm" : "resourceMenu.deleteConfirm",
        { title: item.title },
      ),
      confirmText: createdPodcast ? t("podcasts.manage") : t("common.confirm"),
      type: createdPodcast ? "warning" : "error",
    });
    if (!confirmed) return;

    try {
      if (createdPodcast) {
        const userId = user.profile?.userId;
        if (!userId) throw new Error(t("podcasts.manageFailed"));
        const result = await window.api.apis.openPodcastManager(userId);
        if (!result.ok) throw new Error(t("podcasts.manageFailed"));
        return;
      }
      if (type === "playlist") {
        await user.togglePlaylistSubscribe(item.id, false);
      } else if (type === "album") {
        await user.toggleAlbumSubscribe(item.id, false);
      } else if (type === "artist") {
        await user.toggleArtistSubscribe(item.id, false);
      } else if (type === "radio") {
        await user.togglePodcastSubscribe(item.id, false);
      }
      toast.success(t("resourceMenu.deleted", { title: item.title }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("resourceMenu.deleteFailed"));
    }
  };

  const handleSelect = async (key: string, item: CoverItem): Promise<void> => {
    switch (key) {
      case "view":
        openResource(item);
        break;
      case "play":
        await playResource(item);
        break;
      case "share":
        await shareResource(item);
        break;
      case "downloadAll":
        await downloadResource(item);
        break;
      case "delete":
        await deleteResource(item);
        break;
    }
  };

  return { menuItems, downloading, downloadDisabled, downloadResources, handleSelect };
};
