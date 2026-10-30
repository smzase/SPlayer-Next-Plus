/**
 * 加载并解码封面资源，视频仅加载取色需要的首帧
 * @param url - 封面地址
 * @param isVideo - 是否使用视频首帧
 * @returns 可供画布取色的媒体元素
 */
export async function loadResourceFromUrl(
  url: string,
  isVideo = false,
): Promise<HTMLImageElement | HTMLVideoElement> {
  const element = document.createElement(isVideo ? "video" : "img");
  element.crossOrigin = "anonymous";
  if (element instanceof HTMLVideoElement) element.preload = "auto";
  element.src = url;
  return loadResourceFromElement(element);
}

/**
 * 等待媒体首帧可读，完成后移除临时事件监听
 * @param element - 调用方提供的封面元素
 * @returns 已解码的封面元素
 */
export async function loadResourceFromElement(
  element: HTMLImageElement | HTMLVideoElement,
): Promise<HTMLImageElement | HTMLVideoElement> {
  if (element instanceof HTMLImageElement) {
    await element.decode();
  } else if (element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise<void>((resolve, reject) => {
      /** 清理首帧就绪与加载失败监听 */
      const cleanup = (): void => {
        element.removeEventListener("loadeddata", onReady);
        element.removeEventListener("error", onError);
      };
      /** 首帧完成后结束等待 */
      const onReady = (): void => {
        cleanup();
        resolve();
      };
      /** 加载失败后释放监听并交给调用方处理 */
      const onError = (): void => {
        cleanup();
        reject(element.error ?? new Error("Failed to load album video"));
      };
      element.addEventListener("loadeddata", onReady);
      element.addEventListener("error", onError);
    });
  }
  return element;
}
