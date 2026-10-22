import { describe, expect, it, vi } from "vitest";
import type { Query } from "../core/option";
import type { RequestFn } from "../core/types";
import scrobble from "./scrobble";

const createRequest = () =>
  vi.fn().mockResolvedValue({ status: 200, body: { code: 200 }, cookie: [] });

describe("网易云原版日志听歌打卡", () => {
  it.each([
    ["list", "song", "list"],
    ["album", "song", "album"],
    ["artist", "song", "artist"],
    ["song", "song", "track"],
    ["radio", "dj", "djradio"],
  ])("将 %s 来源的 %s 资源映射为官方 %s 类型", async (sourceType, resourceType, expected) => {
    const request = createRequest();

    for (const action of ["startPlay", "play"])
      await scrobble(
        {
          action,
          id: resourceType === "dj" ? "3081133072" : "123",
          sourceid: "456",
          sourceType,
          resourceType,
          time: 60,
          total: 180,
          fee: 1,
          categoryId: resourceType === "dj" ? 7 : undefined,
          cookie: {},
        } satisfies Query,
        request as unknown as RequestFn,
      );

    expect(request).toHaveBeenCalledTimes(2);
    const startplayData = request.mock.calls[0]?.[1] as { logs: string };
    const playData = request.mock.calls[1]?.[1] as { logs: string };
    const [startplay] = JSON.parse(startplayData.logs);
    const [play] = JSON.parse(playData.logs);
    expect(startplay).toMatchObject({
      action: "startplay",
      json: {
        id: resourceType === "dj" ? "3081133072" : "123",
        type: resourceType,
        sourceId: "456",
        source: expected,
        sourcetype: expected,
        ...(resourceType === "dj" ? { categoryId: 7 } : {}),
      },
    });
    expect(play).toMatchObject({
      action: "play",
      json: {
        id: resourceType === "dj" ? "3081133072" : "123",
        sourceId: "456",
        source: expected,
        sourcetype: expected,
        type: resourceType,
        time: 60,
        ...(resourceType === "dj" ? { categoryId: 7 } : {}),
      },
    });
  });

  it("单次原版日志失败时原样返回错误，不伪造成功", async () => {
    const request = vi.fn().mockResolvedValueOnce({ status: 500, body: { code: 500 }, cookie: [] });

    const result = await scrobble(
      { id: "123", sourceid: "123", time: 60, cookie: {} } satisfies Query,
      request as unknown as RequestFn,
    );

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ code: 500 });
    expect(request).toHaveBeenCalledOnce();
  });
});
