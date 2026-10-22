/** 注册音源接口和会话管理的跨进程入口 */

import { ipcMain } from "electron";
import { clearNeteaseCookies, mergeNeteaseCookies } from "@main/apis/netease";
import { cookieToJson } from "@main/apis/netease/core/cookie";
import { clearQQMusicCookies } from "@main/apis/qqmusic";
import { clearKugouSession } from "@main/apis/kugou";
import { openNeteaseLoginWindow } from "@main/window/login";
import { openNeteasePodcastManager } from "@main/window/neteasePodcastManager";
import { coreLog } from "@main/utils/logger";
import type { ApiPlatform } from "@shared/types/apis";
import { callPlatformApi } from "@main/services/platformApi";

/**
 * 注册平台接口的进程通信处理器
 */
export const registerApisIpc = (): void => {
  ipcMain.handle(
    "apis:call",
    async (_evt, platform: ApiPlatform, name: string, params?: Record<string, unknown>) => {
      return callPlatformApi(platform, name, params);
    },
  );

  ipcMain.handle("apis:clearSession", (_evt, platform: ApiPlatform) => {
    if (platform === "netease") clearNeteaseCookies();
    if (platform === "qqmusic") clearQQMusicCookies();
    if (platform === "kugou") clearKugouSession();
  });

  /** 打开官方网页登录，成功后把 cookies 合并写入 session */
  ipcMain.handle("apis:openLoginWeb", async (_evt, platform: ApiPlatform) => {
    if (platform !== "netease") return { ok: false, error: "unsupported platform" };
    try {
      const cookies = await openNeteaseLoginWindow();
      if (!cookies) return { ok: false, error: "canceled" };
      mergeNeteaseCookies(cookies);
      return { ok: true };
    } catch (err) {
      coreLog.warn("[apis] openLoginWeb failed:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** 手动写入 cookie 登录 */
  ipcMain.handle("apis:setCookie", (_evt, platform: ApiPlatform, raw: string) => {
    if (platform !== "netease") return { ok: false, error: "unsupported platform" };
    const parsed = cookieToJson(raw);
    if (!parsed.MUSIC_U) return { ok: false, error: "missing MUSIC_U" };
    mergeNeteaseCookies(parsed);
    return { ok: true };
  });

  ipcMain.handle("apis:openPodcastManager", async (_event, userId: number) => {
    try {
      await openNeteasePodcastManager(userId);
      return { ok: true };
    } catch (err) {
      coreLog.warn("[apis] openPodcastManager failed:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
};
