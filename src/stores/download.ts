/**
 * 下载任务镜像 store
 *
 * 权威态在主进程；本 store 拉取全量后订阅 onState/onProgress 增量更新，供下载页与侧边栏角标使用。
 * 用 shallowRef 持有任务数组，进度更新只替换对应元素。
 */

import type { DownloadTask, DownloadProgress } from "@shared/types/download";
import type { Track } from "@shared/types/player";
import { initDownloadResolver } from "@/services/download/resolver";

export const useDownloadStore = defineStore("download", () => {
  /** 内存中保留的已结束任务上限（进行中任务始终完整保留） */
  const MAX_FINISHED_TASKS = 200;

  const tasks = shallowRef<DownloadTask[]>([]);
  const initialized = ref(false);
  const unsubscribers: Array<() => void> = [];
  const pendingCancelHandlers = new Map<string, () => void>();

  const isOngoing = (task: DownloadTask): boolean =>
    task.status === "queued" || task.status === "downloading";

  /** 裁剪历史记录，但不丢弃仍可操作的排队和下载中任务 */
  const trimFinished = (items: DownloadTask[]): DownloadTask[] => {
    let finishedCount = 0;
    return items.filter((task) => {
      if (isOngoing(task)) return true;
      finishedCount += 1;
      return finishedCount <= MAX_FINISHED_TASKS;
    });
  };

  /** 进行中任务数（侧边栏角标） */
  const activeCount = computed(
    () =>
      tasks.value.filter((task) => task.status === "queued" || task.status === "downloading")
        .length,
  );

  // 流媒体曲目的 id 已包含服务器 ID，可与在线歌曲共用来源和 ID 匹配
  const activeTasks = computed(() => tasks.value.filter(isOngoing));
  const historyTasks = computed(() => tasks.value.filter((task) => !isOngoing(task)));
  const downloadedIds = computed(() => {
    const ids = new Set<string>();
    for (const task of historyTasks.value) {
      if (task.status === "done" && task.filePath) ids.add(`${task.track.source}:${task.track.id}`);
    }
    return ids;
  });

  const isDownloaded = (track: Track): boolean =>
    downloadedIds.value.has(`${track.source}:${track.id}`);

  /** 替换或插入一条任务 */
  const applyTask = (task: DownloadTask): void => {
    pendingCancelHandlers.delete(task.taskId);
    const idx = tasks.value.findIndex((item) => item.taskId === task.taskId);
    const next = tasks.value.slice();
    if (idx === -1) next.unshift(task);
    else next[idx] = task;
    tasks.value = trimFinished(next);
  };

  /** 更新进度 */
  const applyProgress = (data: DownloadProgress): void => {
    const idx = tasks.value.findIndex((item) => item.taskId === data.taskId);
    if (idx === -1) return;
    const next = tasks.value.slice();
    next[idx] = { ...next[idx], received: data.received, total: data.total };
    tasks.value = next;
  };

  /** 拉取全量并订阅增量 */
  const init = async (): Promise<void> => {
    if (initialized.value) return;
    initialized.value = true;
    unsubscribers.push(initDownloadResolver());
    unsubscribers.push(window.api.download.onState(applyTask));
    unsubscribers.push(window.api.download.onProgress(applyProgress));
    const remoteTasks = await window.api.download.list();
    const current = new Map(tasks.value.map((task) => [task.taskId, task]));
    const remoteIds = new Set(remoteTasks.map((task) => task.taskId));
    tasks.value = trimFinished([
      ...tasks.value.filter((task) => !remoteIds.has(task.taskId)),
      ...remoteTasks.map((task) => current.get(task.taskId) ?? task),
    ]);
  };

  /**
   * 登记尚未交给主进程的批量下载任务
   * @param task - 用于页面展示的排队任务
   * @param cancelHandler - 解析开始前取消时调用
   */
  const addPending = (task: DownloadTask, cancelHandler: () => void): void => {
    applyTask(task);
    pendingCancelHandlers.set(task.taskId, cancelHandler);
  };

  /** 标记任务即将交给主进程，后续取消改走下载 IPC */
  const activatePending = (taskId: string): void => {
    pendingCancelHandlers.delete(taskId);
  };

  /** 丢弃解析失败或未能入队的本地排队任务 */
  const discardPending = (taskId: string): void => {
    pendingCancelHandlers.delete(taskId);
    tasks.value = tasks.value.filter((task) => task.taskId !== taskId);
  };

  const cancel = (taskId: string): void => {
    const cancelPending = pendingCancelHandlers.get(taskId);
    if (cancelPending) {
      pendingCancelHandlers.delete(taskId);
      cancelPending();
      tasks.value = tasks.value.filter((task) => task.taskId !== taskId);
      return;
    }
    void window.api.download.cancel(taskId);
  };

  const remove = (taskId: string): void => {
    const cancelPending = pendingCancelHandlers.get(taskId);
    if (cancelPending) {
      pendingCancelHandlers.delete(taskId);
      cancelPending();
      tasks.value = tasks.value.filter((task) => task.taskId !== taskId);
      return;
    }
    tasks.value = tasks.value.filter((item) => item.taskId !== taskId);
    void window.api.download.remove(taskId);
  };

  /**
   * 批量取消下载任务
   * @param taskIds - 需要取消的任务 ID
   */
  const cancelMany = (taskIds: string[]): void => {
    for (const taskId of new Set(taskIds)) cancel(taskId);
  };

  /**
   * 批量移除任务；尚未交给主进程的任务会同时停止本地解析
   * @param taskIds - 需要移除的任务 ID
   */
  const removeMany = (taskIds: string[]): void => {
    for (const taskId of new Set(taskIds)) remove(taskId);
  };

  const clearFinished = (): void => {
    tasks.value = tasks.value.filter(
      (item) => item.status === "queued" || item.status === "downloading",
    );
    void window.api.download.clearFinished();
  };

  onScopeDispose(() => {
    for (const off of unsubscribers) off();
    unsubscribers.length = 0;
    for (const cancelPending of pendingCancelHandlers.values()) cancelPending();
    pendingCancelHandlers.clear();
  });

  return {
    tasks,
    activeTasks,
    historyTasks,
    activeCount,
    isDownloaded,
    init,
    addPending,
    activatePending,
    discardPending,
    cancel,
    cancelMany,
    remove,
    removeMany,
    clearFinished,
  };
});
