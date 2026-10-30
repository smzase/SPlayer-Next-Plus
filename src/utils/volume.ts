/** 滚轮和快捷键每次调整的滑块位置 */
export const VOLUME_STEP = 0.05;

/** 满音量到滑块最低位置的衰减跨度（dB），每格滚轮 2 dB，半程 -20 dB 与旧三次方曲线接近 */
const VOLUME_RANGE_DB = 40;

/** 低于该位置改为增益线性收敛到 0，避免从静音直接跳到可闻电平 */
const TAPER_POSITION = 0.1;

/** 线性收敛段起点处的增益 */
const TAPER_GAIN = 10 ** ((-VOLUME_RANGE_DB * (1 - TAPER_POSITION)) / 20);

/**
 * 将数值限制到 0.0 ~ 1.0
 * @param value - 待限制的数值
 * @returns 限制后的数值
 */
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * 将滑块位置转换为线性增益，主体与 dB 线性，底部线性收敛到静音
 * @param position - 滑块位置（0.0 ~ 1.0）
 * @returns 音频线性增益（0.0 ~ 1.0）
 */
export const volumePositionToGain = (position: number): number => {
  const value = clamp01(position);
  if (value < TAPER_POSITION) return (value / TAPER_POSITION) * TAPER_GAIN;
  return 10 ** ((-VOLUME_RANGE_DB * (1 - value)) / 20);
};

/**
 * 将线性增益转换为滑块位置，保证存档增益还原后仍是同一响度
 * @param gain - 音频线性增益（0.0 ~ 1.0）
 * @returns 滑块位置（0.0 ~ 1.0）
 */
export const volumeGainToPosition = (gain: number): number => {
  const value = clamp01(gain);
  const position =
    value < TAPER_GAIN
      ? (value / TAPER_GAIN) * TAPER_POSITION
      : clamp01(1 + (20 * Math.log10(value)) / VOLUME_RANGE_DB);
  // 位置保留 6 位小数，避免浮点尾差让最低一档减一档后落在 0 与最低音量之间
  return Math.round(position * 1e6) / 1e6;
};
