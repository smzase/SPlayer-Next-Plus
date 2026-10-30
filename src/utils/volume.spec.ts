import { describe, expect, it } from "vitest";
import { volumeGainToPosition, volumePositionToGain } from "./volume";

/** 把滑块位置对应的增益换算成 dB */
const toDb = (position: number): number => 20 * Math.log10(volumePositionToGain(position));

describe("音量曲线", () => {
  it("静音与满音量为端点", () => {
    expect(volumePositionToGain(0)).toBe(0);
    expect(volumeGainToPosition(0)).toBe(0);
    expect(volumePositionToGain(1)).toBe(1);
    expect(volumeGainToPosition(1)).toBe(1);
  });

  it("主体区间位置与 dB 线性，每格滚轮 2 dB", () => {
    expect(toDb(0.5)).toBeCloseTo(-20, 6);
    expect(toDb(0.1)).toBeCloseTo(-36, 6);
    for (const position of [0.15, 0.35, 0.6, 0.95]) {
      expect(toDb(position) - toDb(position - 0.05)).toBeCloseTo(2, 6);
    }
  });

  it("底部线性收敛到静音且与主体连续", () => {
    expect(volumePositionToGain(0.05)).toBeCloseTo(volumePositionToGain(0.1) / 2, 9);
    expect(volumePositionToGain(0.1 - 1e-9)).toBeCloseTo(volumePositionToGain(0.1), 6);
    expect(toDb(0.01)).toBeCloseTo(-56, 0);
  });

  it("位置与增益互为逆映射", () => {
    for (const position of [0.01, 0.05, 0.1, 0.2, 0.5, 0.77, 1]) {
      expect(volumeGainToPosition(volumePositionToGain(position))).toBeCloseTo(position, 5);
    }
  });
});
