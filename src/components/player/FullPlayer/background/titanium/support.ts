let highpSupport: boolean | undefined;

/**
 * 探测 WebGL 高精度片元能力并释放临时上下文，避免噪声哈希退化成条带
 * @returns 当前环境是否支持钛金属流沙着色器
 */
export function isHighpFragmentSupported(): boolean {
  if (highpSupport !== undefined) return highpSupport;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const gl = canvas.getContext("webgl");
  if (!gl) return (highpSupport = false);
  try {
    const format = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    return (highpSupport = (format?.precision ?? 0) > 0);
  } finally {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
