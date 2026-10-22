import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadTask } from "@shared/types/download";
import { useDownloadStore } from "./download";

const downloadApi = {
  list: vi.fn<() => Promise<DownloadTask[]>>(),
  cancel: vi.fn<(taskId: string) => Promise<void>>(),
  remove: vi.fn<(taskId: string) => Promise<void>>(),
  clearFinished: vi.fn<() => Promise<void>>(),
  onState: vi.fn(() => vi.fn()),
  onProgress: vi.fn(() => vi.fn()),
  onResolve: vi.fn(() => vi.fn()),
};

const createTask = (taskId: string, status: DownloadTask["status"] = "queued"): DownloadTask => ({
  taskId,
  status,
  track: {
    id: taskId,
    title: taskId,
    artists: [],
    duration: 0,
    source: "netease",
  },
  qualityLevel: "sq",
  received: 0,
  total: 0,
  createdAt: Date.now(),
});

describe("下载 store 本地排队任务", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    downloadApi.list.mockReset().mockResolvedValue([]);
    downloadApi.cancel.mockReset().mockResolvedValue();
    downloadApi.remove.mockReset().mockResolvedValue();
    downloadApi.clearFinished.mockReset().mockResolvedValue();
    downloadApi.onState.mockClear();
    downloadApi.onProgress.mockClear();
    vi.stubGlobal("window", { api: { download: downloadApi } });
  });

  afterEach(() => {
    useDownloadStore().$dispose();
    vi.unstubAllGlobals();
  });

  it("展示本地排队任务并在解析前直接取消", () => {
    const store = useDownloadStore();
    const cancelPending = vi.fn();

    store.addPending(createTask("pending"), cancelPending);

    expect(store.tasks.map((task) => task.taskId)).toEqual(["pending"]);
    expect(store.activeCount).toBe(1);

    store.cancel("pending");

    expect(cancelPending).toHaveBeenCalledOnce();
    expect(downloadApi.cancel).not.toHaveBeenCalled();
    expect(store.tasks).toEqual([]);
  });

  it("任务交给主进程后通过 IPC 取消", () => {
    const store = useDownloadStore();
    const cancelPending = vi.fn();

    store.addPending(createTask("active"), cancelPending);
    store.activatePending("active");
    store.cancel("active");

    expect(cancelPending).not.toHaveBeenCalled();
    expect(downloadApi.cancel).toHaveBeenCalledWith("active");
  });

  it("初始化时合并尚未交给主进程的排队任务", async () => {
    const store = useDownloadStore();
    store.addPending(createTask("local"), vi.fn());
    downloadApi.list.mockResolvedValue([createTask("remote", "downloading")]);

    await store.init();

    expect(store.tasks.map((task) => task.taskId)).toEqual(["local", "remote"]);
    expect(store.activeCount).toBe(2);
  });

  it("批量移除时停止本地排队任务且不调用主进程", () => {
    const store = useDownloadStore();
    const cancelFirst = vi.fn();
    const cancelSecond = vi.fn();
    store.addPending(createTask("first"), cancelFirst);
    store.addPending(createTask("second"), cancelSecond);

    store.removeMany(["first", "second", "first"]);

    expect(cancelFirst).toHaveBeenCalledOnce();
    expect(cancelSecond).toHaveBeenCalledOnce();
    expect(downloadApi.remove).not.toHaveBeenCalled();
    expect(store.tasks).toEqual([]);
  });

  it("批量取消已交给主进程的任务时按任务 ID 去重", () => {
    const store = useDownloadStore();
    store.addPending(createTask("first"), vi.fn());
    store.addPending(createTask("second"), vi.fn());
    store.activatePending("first");
    store.activatePending("second");

    store.cancelMany(["first", "second", "first"]);

    expect(downloadApi.cancel).toHaveBeenCalledTimes(2);
    expect(downloadApi.cancel).toHaveBeenCalledWith("first");
    expect(downloadApi.cancel).toHaveBeenCalledWith("second");
  });
});
