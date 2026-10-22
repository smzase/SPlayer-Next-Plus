import { describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@shared/types/errors";
import zhCN from "@/i18n/locales/zh-CN.json";
import enUS from "@/i18n/locales/en-US.json";
vi.mock("@/composables/useToast", () => ({ toast: {} }));
vi.mock("@/composables/useDialog", () => ({ dialog: {} }));
vi.mock("@/i18n", () => ({ default: {} }));
import { isSkippableError } from "./errors";

describe("播放失败跳曲范围", () => {
  it("所有错误码都有中英文提示，避免显示原始翻译键", () => {
    for (const code of Object.values(ErrorCode)) {
      if (code === ErrorCode.LOAD_SUPERSEDED) continue;
      expect(zhCN.errors).toHaveProperty(code, expect.any(String));
      expect(enUS.errors).toHaveProperty(code, expect.any(String));
    }
  });
  it("网络故障停留当前歌曲，单曲损坏和无版权允许跳过", () => {
    expect(isSkippableError(ErrorCode.NETWORK_ERROR)).toBe(false);
    expect(isSkippableError(ErrorCode.NETWORK_TIMEOUT)).toBe(false);
    expect(isSkippableError(ErrorCode.FILE_DECODE_ERROR)).toBe(true);
    expect(isSkippableError(ErrorCode.NETEASE_UNAVAILABLE)).toBe(true);
  });
});
