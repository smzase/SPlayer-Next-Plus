import type { Ref } from "vue";
import type { Collection } from "@/types/collection";
import { usePlaylistStore } from "@/stores/playlist";
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";

export interface PlaylistManageOptions {
  /** 编辑成功后回调 */
  onEdited?: () => void;
  /** 删除成功后回调 */
  onDeleted?: () => void;
}

/** 取服务端错误 message，没有则用兜底 */
const errorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

/**
 * 提供歌单编辑、删除及歌曲排序权限
 * @param collection - 当前歌单
 * @param options - 编辑和删除完成后的回调
 * @returns 歌单权限、编辑状态和操作方法
 */
export const usePlaylistManage = (
  collection: Ref<Collection | null>,
  options: PlaylistManageOptions = {},
) => {
  const { t } = useI18n();
  const playlistStore = usePlaylistStore();
  const userStore = useUserStore();

  /** 是否可管理 */
  const canManage = computed(() => {
    const current = collection.value;
    if (!current || current.type !== "playlist") return false;
    if (current.source === "local") return true;
    if (current.source !== "netease") return false;
    const isCreated = userStore.createdPlaylists.some((item) => item.id === current.id);
    const isLiked = userStore.likedPlaylistId === current.id;
    return isCreated && !isLiked;
  });

  /** 歌曲排序权限独立于歌单编辑权限，喜欢歌单也可调整顺序 */
  const canReorder = computed(
    () =>
      canManage.value ||
      (collection.value?.type === "playlist" &&
        collection.value.source === "netease" &&
        userStore.isLoggedIn &&
        collection.value.id === userStore.likedPlaylistId),
  );

  /** 编辑弹窗 */
  const editOpen = ref(false);
  const editTitle = ref("");
  const editDescription = ref("");
  const submitting = ref(false);

  const openEdit = (): void => {
    const current = collection.value;
    if (!current) return;
    editTitle.value = current.title;
    editDescription.value = current.description ?? "";
    editOpen.value = true;
  };

  const saveEdit = async (): Promise<void> => {
    const current = collection.value;
    if (!current || submitting.value || !editTitle.value.trim()) return;
    submitting.value = true;
    try {
      const title = editTitle.value.trim();
      const description = editDescription.value.trim();
      if (current.source === "local") {
        await playlistStore.update(current.id, {
          title,
          description: description || undefined,
        });
      } else {
        await userStore.updatePlaylist(current.id, { name: title, description });
      }
      editOpen.value = false;
      options.onEdited?.();
    } catch (err) {
      toast.error(errorMessage(err, t("liked.toast.failed")));
    } finally {
      submitting.value = false;
    }
  };

  /** 删除弹窗 */
  const deleteOpen = ref(false);
  const deleting = ref(false);

  const openDelete = (): void => {
    if (!collection.value) return;
    deleteOpen.value = true;
  };

  const confirmDelete = async (): Promise<void> => {
    const current = collection.value;
    if (!current || deleting.value) return;
    deleting.value = true;
    try {
      if (current.source === "local") {
        await playlistStore.remove(current.id);
      } else {
        await userStore.deletePlaylist(current.id);
      }
      deleteOpen.value = false;
      options.onDeleted?.();
    } catch (err) {
      toast.error(errorMessage(err, t("liked.toast.failed")));
    } finally {
      deleting.value = false;
    }
  };

  return {
    canManage,
    canReorder,
    editOpen,
    editTitle,
    editDescription,
    submitting,
    openEdit,
    saveEdit,
    deleteOpen,
    deleting,
    openDelete,
    confirmDelete,
  };
};
