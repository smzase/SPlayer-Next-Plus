/** 滚轮和快捷键每次调整的滑块位置 */
export const VOLUME_STEP = 0.05;

/** 响度幂指数，半程约为 -10 dB */
const LOUDNESS_EXPONENT = 1.66;

/**
 * 将滑块位置转换为增益，同步合成器时直接使用 Windows 百分比
 * @param position - 滑块位置（0.0 ~ 1.0）
 * @param syncWindowsVolumeMixer - 是否已启用 Windows 音量合成器同步
 * @returns 音频线性增益（0.0 ~ 1.0）
 */
export const volumePositionToGain = (position: number, syncWindowsVolumeMixer = false): number => {
  const value = Math.max(0, Math.min(1, position));
  if (syncWindowsVolumeMixer) return value;
  // 按百分比取整，避免连续步进在静音附近留下浮点尾差
  return (Math.round(value * 100) / 100) ** LOUDNESS_EXPONENT;
};

/**
 * 将线性增益转换为滑块位置，保证存档增益还原后仍是同一响度
 * @param gain - 音频线性增益（0.0 ~ 1.0）
 * @param syncWindowsVolumeMixer - 是否已启用 Windows 音量合成器同步
 * @returns 滑块位置（0.0 ~ 1.0）
 */
export const volumeGainToPosition = (gain: number, syncWindowsVolumeMixer = false): number => {
  const value = Math.max(0, Math.min(1, gain));
  if (syncWindowsVolumeMixer) return value;
  return value ** (1 / LOUDNESS_EXPONENT);
};
