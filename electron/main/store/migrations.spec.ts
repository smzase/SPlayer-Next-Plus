import { describe, expect, it } from "vitest";
import { defaultSystemConfig } from "@shared/defaults/settings";
import { DEFAULT_AMLL_DB_SERVERS } from "@shared/defaults/lyrics";
import { migrateConfig } from "./migrations";
import { deepMerge } from "./utils";

describe("TTML 来源配置迁移", () => {
  it("已迁移的 fork 配置仅替换旧默认镜像，保留自定义源顺序", () => {
    const config = migrateConfig(
      deepMerge(defaultSystemConfig, {
        __configVersion: 1,
        lyric: {
          amllDbServer: [
            "https://custom.example/%s.ttml",
            "https://amlldb.bikonoo.com/%p/%s.ttml",
            DEFAULT_AMLL_DB_SERVERS[1],
          ],
        },
      }),
    );
    expect(config.lyric.amllDbServer).toEqual([
      "https://custom.example/%s.ttml",
      ...DEFAULT_AMLL_DB_SERVERS,
    ]);
    expect(migrateConfig(config).lyric.amllDbServer).toEqual(config.lyric.amllDbServer);
  });

  it("空列表和用户移除旧默认源的选择保持不变", () => {
    expect(
      migrateConfig(
        deepMerge(defaultSystemConfig, {
          __configVersion: 1,
          lyric: { amllDbServer: [] },
        }),
      ).lyric.amllDbServer,
    ).toEqual([]);
  });

  it("新配置包含两个默认源", () => {
    expect(migrateConfig(deepMerge(defaultSystemConfig, {})).lyric.amllDbServer).toEqual(
      DEFAULT_AMLL_DB_SERVERS,
    );
  });

  it("旧自定义源保持最高优先级并追加新镜像", () => {
    const config = migrateConfig(
      deepMerge(defaultSystemConfig, {
        lyric: { amllDbServer: "https://custom.example/%p/%s.ttml" },
      }),
    );
    expect(config.lyric.amllDbServer).toEqual([
      "https://custom.example/%p/%s.ttml",
      DEFAULT_AMLL_DB_SERVERS[1],
    ]);
    expect(migrateConfig(config).lyric.amllDbServer).toEqual(config.lyric.amllDbServer);
  });

  it("旧备份中的单地址可以迁移，已有镜像不重复添加", () => {
    const config = migrateConfig(
      deepMerge(defaultSystemConfig, {
        __configVersion: 0,
        lyric: { amllDbServer: DEFAULT_AMLL_DB_SERVERS[1] },
      }),
    );
    expect(config.lyric.amllDbServer).toEqual([DEFAULT_AMLL_DB_SERVERS[1]]);
  });

  it("保留多源顺序及用户删除默认源的选择", () => {
    const sources = [DEFAULT_AMLL_DB_SERVERS[1], "https://custom.example/%p/%s.ttml"];
    const config = migrateConfig(
      deepMerge(defaultSystemConfig, { lyric: { amllDbServer: sources } }),
    );
    expect(config.lyric.amllDbServer).toEqual(sources);
  });
});
