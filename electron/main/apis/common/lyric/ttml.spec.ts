// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AMLL_DB_SERVERS, OFFICIAL_AMLL_API } from "@shared/defaults/lyrics";

const state = vi.hoisted(() => ({
  enabled: true,
  sources: [] as string[],
  cache: new Map<string, { content: string | null; fresh: boolean }>(),
  fetch: vi.fn(),
  write: vi.fn(),
}));
vi.mock("@main/store", () => ({
  store: {
    get: (key: string) => (key === "lyric.enableOnlineTTMLLyric" ? state.enabled : state.sources),
  },
}));
vi.mock("@main/utils/config", () => ({ appVersion: "1.3.5-beta.1" }));
vi.mock("@main/utils/logger", () => ({ coreLog: { warn: vi.fn() } }));
vi.mock("@main/database/lyricTtmlCache", () => ({
  getCachedTTML: (platform: string, id: string, source: string) => {
    const key = JSON.stringify([platform, id, source]);
    return state.cache.get(key) ?? null;
  },
  setCachedTTML: (platform: string, id: string, source: string, content: string | null) => {
    state.write(platform, id, source, content);
    state.cache.set(JSON.stringify([platform, id, source]), { content, fresh: true });
  },
}));
import { fetchTTML, waitForTrackTTML } from "./ttml";

describe("TTML 多源顺序回退", () => {
  it.each([
    ["netease", "ncmMusicId"],
    ["qqmusic", "qqMusicId"],
  ] as const)("官方 API 使用 %s 的查询参数并读取 JSON 歌词", async (platform, query) => {
    state.sources = [OFFICIAL_AMLL_API];
    state.fetch.mockResolvedValue(Response.json({ data: { lyrics: "<tt>official</tt>" } }));
    expect(await fetchTTML(platform, ["id/1"])).toBe("<tt>official</tt>");
    expect(state.fetch.mock.calls[0][0]).toBe(`${OFFICIAL_AMLL_API}?${query}=id%2F1`);
    expect(state.write).toHaveBeenCalledWith(
      platform,
      "id/1",
      OFFICIAL_AMLL_API,
      "<tt>official</tt>",
    );
  });

  it("列表留空时使用官方 API 和备用镜像", async () => {
    state.sources = [];
    state.fetch
      .mockResolvedValueOnce(Response.json({ data: {} }))
      .mockResolvedValueOnce(new Response("<tt>mirror</tt>"));
    expect(await fetchTTML("netease", ["1"])).toBe("<tt>mirror</tt>");
    expect(state.fetch.mock.calls[0][0]).toBe(`${OFFICIAL_AMLL_API}?ncmMusicId=1`);
    expect(state.write).toHaveBeenCalledWith("netease", "1", OFFICIAL_AMLL_API, null);
  });

  it("镜像仅包含歌曲 ID 占位符时也可使用", async () => {
    state.sources = ["https://custom.example/%s.ttml"];
    state.fetch.mockResolvedValue(new Response("<tt>custom</tt>"));
    expect(await fetchTTML("netease", ["id/1"])).toBe("<tt>custom</tt>");
    expect(state.fetch.mock.calls[0][0]).toBe("https://custom.example/id%2F1.ttml");
  });

  it.each([429, 500])("全部源遇到临时 HTTP %i 故障时回退旧缓存且不刷新时间", async (status) => {
    state.cache.set(JSON.stringify(["netease", "1", state.sources[0]]), {
      content: "<tt>stale</tt>",
      fresh: false,
    });
    state.fetch.mockImplementation(() => Promise.resolve(new Response("", { status })));
    expect(await fetchTTML("netease", ["1"])).toBe("<tt>stale</tt>");
    expect(state.fetch).toHaveBeenCalledTimes(2);
    expect(state.write).not.toHaveBeenCalled();
  });

  it("首源临时失败时优先使用备用源的新内容", async () => {
    state.cache.set(JSON.stringify(["netease", "1", state.sources[0]]), {
      content: "<tt>stale</tt>",
      fresh: false,
    });
    state.fetch
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("<tt>fresh</tt>"));
    expect(await fetchTTML("netease", ["1"])).toBe("<tt>fresh</tt>");
  });

  it("源明确返回不存在时不恢复过期歌词", async () => {
    state.sources = [OFFICIAL_AMLL_API];
    state.cache.set(JSON.stringify(["netease", "1", OFFICIAL_AMLL_API]), {
      content: "<tt>removed</tt>",
      fresh: false,
    });
    state.fetch.mockResolvedValue(new Response("", { status: 404 }));
    expect(await fetchTTML("netease", ["1"])).toBeNull();
    expect(state.write).toHaveBeenCalledWith("netease", "1", OFFICIAL_AMLL_API, null);
  });

  it("清理会等待相关歌曲的完整备用源回退", async () => {
    let finish!: (response: Response) => void;
    state.fetch.mockResolvedValueOnce(new Response("", { status: 404 })).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    const fetching = fetchTTML("netease", ["1"]);
    let completed = false;
    const waiting = waitForTrackTTML([{ platform: "netease", id: "1" }]).then(() => {
      completed = true;
    });
    await vi.waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
    expect(completed).toBe(false);
    finish(new Response("<tt>late</tt>"));
    await fetching;
    await waiting;
    expect(state.write).toHaveBeenLastCalledWith("netease", "1", state.sources[1], "<tt>late</tt>");
    expect(completed).toBe(true);
  });
  beforeEach(() => {
    state.enabled = true;
    state.sources = ["https://amlldb.bikonoo.com/%p/%s.ttml", DEFAULT_AMLL_DB_SERVERS[1]];
    state.cache.clear();
    state.fetch.mockReset();
    state.write.mockReset();
    vi.stubGlobal("fetch", state.fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("首源命中后不请求备用源", async () => {
    state.fetch.mockResolvedValue(new Response("<tt>first</tt>"));
    expect(await fetchTTML("netease", ["1"])).toBe("<tt>first</tt>");
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch.mock.calls[0][0]).toBe("https://amlldb.bikonoo.com/ncm-lyrics/1.ttml");
  });

  it.each([404, 500, 200])("首源返回 %i 或空内容时继续备用源", async (status) => {
    state.fetch
      .mockResolvedValueOnce(new Response("", { status }))
      .mockResolvedValueOnce(new Response("<tt>mirror</tt>"));
    expect(await fetchTTML("qqmusic", ["mid/1"])).toBe("<tt>mirror</tt>");
    expect(state.fetch.mock.calls[1][0]).toBe(
      "https://amll.mirror.dimeta.top/api/db/qq-lyrics/mid%2F1.ttml",
    );
    const negatives = state.write.mock.calls.filter((call) => call[3] === null);
    expect(negatives).toHaveLength(status === 404 ? 1 : 0);
  });

  it("网络超时后继续备用源，不缓存临时失败", async () => {
    state.fetch
      .mockRejectedValueOnce(new DOMException("Timeout", "TimeoutError"))
      .mockResolvedValueOnce(new Response("<tt>mirror</tt>"));
    expect(await fetchTTML("netease", ["1"])).toBe("<tt>mirror</tt>");
    expect(state.write).toHaveBeenCalledTimes(1);
  });

  it("同一源先尝试全部候选 ID，再尝试低优先级源", async () => {
    state.fetch
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response("<tt>numeric</tt>"));
    expect(await fetchTTML("qqmusic", ["mid", "123"])).toBe("<tt>numeric</tt>");
    expect(state.fetch.mock.calls.map((call) => call[0])).toEqual([
      "https://amlldb.bikonoo.com/qq-lyrics/mid.ttml",
      "https://amlldb.bikonoo.com/qq-lyrics/123.ttml",
    ]);
  });

  it("重排后优先新首源，旧正缓存不能越过优先级", async () => {
    state.cache.set(JSON.stringify(["netease", "1", state.sources[0]]), {
      content: "<tt>old</tt>",
      fresh: true,
    });
    state.sources.reverse();
    state.fetch.mockResolvedValue(new Response("<tt>new</tt>"));
    expect(await fetchTTML("netease", ["1"])).toBe("<tt>new</tt>");
    expect(state.fetch.mock.calls[0][0]).toContain("amll.mirror.dimeta.top");
  });

  it("旧源负缓存不会阻止新增源请求", async () => {
    state.cache.set(JSON.stringify(["netease", "1", state.sources[0]]), {
      content: null,
      fresh: true,
    });
    state.fetch.mockResolvedValue(new Response("<tt>new</tt>"));
    expect(await fetchTTML("netease", ["1"])).toBe("<tt>new</tt>");
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });

  it("并发请求复用单源抓取，结束后允许新的请求", async () => {
    let finish!: (response: Response) => void;
    state.sources = [state.sources[0]];
    state.fetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    const first = fetchTTML("netease", ["1"]);
    const second = fetchTTML("netease", ["1"]);
    finish(new Response("", { status: 500 }));
    expect(await Promise.all([first, second])).toEqual([null, null]);
    expect(state.fetch).toHaveBeenCalledTimes(1);
    state.fetch.mockResolvedValue(new Response("<tt>retry</tt>"));
    expect(await fetchTTML("netease", ["1"])).toBe("<tt>retry</tt>");
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });

  it("关闭在线 TTML 时不访问网络或缓存", async () => {
    state.enabled = false;
    expect(await fetchTTML("netease", ["1"])).toBeNull();
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
