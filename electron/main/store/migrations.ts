import type { SystemConfig } from "@shared/types/settings";
import { normalizeTtmlServers } from "@shared/utils/ttmlServer";

/** 配置版本键名 */
const META_KEY = "__configVersion";

export interface Migration {
  /** 版本号，递增整数 */
  version: number;
  /** 迁移函数，直接修改 data 对象 */
  migrate: (data: SystemConfig) => void;
}

/**
 * 迁移列表，按 version 递增排列
 * 新增字段已由 deepMerge 自动补全，此处仅用于字段重命名、数据转换等
 */
export const migrations: Migration[] = [
  {
    version: 1,
    migrate: (data) => {
      data.lyric.amllDbServer = normalizeTtmlServers(data.lyric.amllDbServer);
    },
  },
];

/**
 * 对已合并默认值的配置执行迁移，兼容启动、重置和旧备份导入
 * @param data - 配置对象
 * @returns 迁移后的配置对象
 */
export const migrateConfig = (data: SystemConfig): SystemConfig => {
  const metadata = data as unknown as Record<string, unknown>;
  let version = Number(metadata[META_KEY] ?? 0);
  for (const migration of migrations) {
    if (migration.version <= version) continue;
    migration.migrate(data);
    version = migration.version;
  }
  metadata[META_KEY] = version;
  return data;
};
