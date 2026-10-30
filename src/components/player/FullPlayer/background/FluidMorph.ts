import { GLProgram } from "@applemusic-like-lyrics/core";
import vertexShader from "./morph.vert.glsl?raw";
import flowShader from "./flow.frag.glsl?raw";
import morphShader from "./morph.frag.glsl?raw";

/** 仅在切换期间存在的实时画面形变器 */
export class FluidMorph {
  private readonly gl: WebGLRenderingContext;
  private readonly textures: WebGLTexture[] = [];
  private readonly framebuffers: WebGLFramebuffer[] = [];
  private readonly unsubscribe: (() => void)[] = [];
  private readonly sourcesReady = [false, false];
  private flowProgram?: GLProgram;
  private morphProgram?: GLProgram;
  private buffer: WebGLBuffer | null = null;
  private frame = 0;
  private startedAt: number | undefined;
  private previousTime = -Infinity;
  private flowIndex = 0;
  private disposed = false;

  /**
   * 建立临时 GPU 合成器，在源画布绘制后同步取得尚未被浏览器清空的帧
   * @param canvas - 临时输出画布
   * @param from - 旧背景的实时画布
   * @param to - 新背景的实时画布
   * @param fps - 合成帧率上限
   * @param onReady - 两幅实时帧就绪后的回调
   * @param onComplete - 形变完成回调
   * @param onError - 图形资源失效时的回调
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    from: HTMLCanvasElement,
    to: HTMLCanvasElement,
    private readonly fps: number,
    private readonly onReady: () => void,
    private readonly onComplete: () => void,
    private readonly onError: () => void,
  ) {
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) throw new Error("Fluid morph requires WebGL");
    this.gl = gl;
    canvas.width = from.width;
    canvas.height = from.height;
    try {
      this.flowProgram = new GLProgram(gl, vertexShader, flowShader, "background-flow");
      this.morphProgram = new GLProgram(gl, vertexShader, morphShader, "background-morph");
      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      for (let index = 0; index < 4; index++) {
        const texture = gl.createTexture();
        if (!texture) throw new Error("Unable to allocate morph texture");
        this.textures.push(texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (index >= 2) {
          const framebuffer = gl.createFramebuffer();
          if (!framebuffer) throw new Error("Unable to allocate flow framebuffer");
          this.framebuffers.push(framebuffer);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 40, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error("Incomplete flow framebuffer");
          }
          gl.clearColor(0.5, 0.5, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // 每个源只在本次过渡内监听，避免 preserveDrawingBuffer 的常驻显存开销
      for (const [index, source] of [from, to].entries()) {
        const sourceGl = source.getContext("webgl") || source.getContext("webgl2");
        if (!sourceGl) throw new Error("Background has no WebGL context");
        const drawArrays = sourceGl.drawArrays;
        const drawElements = sourceGl.drawElements;
        const ownDrawArrays = Object.hasOwn(sourceGl, "drawArrays");
        const ownDrawElements = Object.hasOwn(sourceGl, "drawElements");
        sourceGl.drawArrays = (...args) => {
          drawArrays.apply(sourceGl, args);
          if (sourceGl.getParameter(sourceGl.FRAMEBUFFER_BINDING) === null)
            this.capture(source, index);
        };
        sourceGl.drawElements = (...args) => {
          drawElements.apply(sourceGl, args);
          if (sourceGl.getParameter(sourceGl.FRAMEBUFFER_BINDING) === null)
            this.capture(source, index);
        };
        this.unsubscribe.push(() => {
          if (ownDrawArrays) sourceGl.drawArrays = drawArrays;
          else Reflect.deleteProperty(sourceGl, "drawArrays");
          if (ownDrawElements) sourceGl.drawElements = drawElements;
          else Reflect.deleteProperty(sourceGl, "drawElements");
        });
      }
      canvas.addEventListener("webglcontextlost", this.handleContextLost);
      this.frame = requestAnimationFrame(this.tick);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /**
   * 在源绘制调用返回时复制 GPU 帧，不依赖已被清空的绘图缓冲区
   * @param source - 刚绘制完成的源画布
   * @param index - 源纹理索引
   */
  private capture(source: HTMLCanvasElement, index: number): void {
    if (this.disposed) return;
    const gl = this.gl;
    try {
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[index]);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.sourcesReady[index] = true;
    } catch (error) {
      console.warn("[background] 无法读取背景帧", error);
      this.dispose();
      this.onError();
    }
  }

  /**
   * 计算小尺寸光流并合成实时背景，结束时精确还原目标帧
   * @param time - 当前帧时间戳
   */
  private tick = (time: number): void => {
    if (this.disposed) return;
    if (this.sourcesReady.every(Boolean) && time - this.previousTime >= 1000 / this.fps) {
      this.previousTime = time;
      this.startedAt ??= time;
      const progress = Math.min(1, (time - this.startedAt) / 1800);
      const gl = this.gl;
      const flowProgram = this.flowProgram!;
      const morphProgram = this.morphProgram!;
      const nextIndex = 1 - this.flowIndex;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      for (let index = 0; index < 2; index++) {
        gl.activeTexture(gl.TEXTURE0 + index);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[index]);
      }
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[2 + this.flowIndex]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[nextIndex]);
      gl.viewport(0, 0, 64, 40);
      flowProgram.use();
      gl.enableVertexAttribArray(flowProgram.attrs.a_pos);
      gl.vertexAttribPointer(flowProgram.attrs.a_pos, 2, gl.FLOAT, false, 0, 0);
      flowProgram.setUniform1i("u_from", 0);
      flowProgram.setUniform1i("u_to", 1);
      flowProgram.setUniform1i("u_previous", 2);
      flowProgram.setUniform2f("u_step", 1 / 64, 1 / 40);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.flowIndex = nextIndex;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[2 + this.flowIndex]);
      morphProgram.use();
      gl.enableVertexAttribArray(morphProgram.attrs.a_pos);
      gl.vertexAttribPointer(morphProgram.attrs.a_pos, 2, gl.FLOAT, false, 0, 0);
      morphProgram.setUniform1i("u_from", 0);
      morphProgram.setUniform1i("u_to", 1);
      morphProgram.setUniform1i("u_flow", 2);
      morphProgram.setUniform1f("u_progress", progress * progress * (3 - 2 * progress));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (this.canvas.style.opacity !== "1") {
        this.canvas.style.opacity = "1";
        this.onReady();
      }
      if (progress === 1) {
        this.onComplete();
        return;
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  /** 图形上下文失效时结束形变，交还背景图层的控制权 */
  private handleContextLost = (): void => {
    this.dispose();
    this.onError();
  };

  /** 取消帧监听并释放全部临时纹理、流场和 WebGL 上下文 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.unsubscribe.length = 0;
    this.flowProgram?.dispose();
    this.morphProgram?.dispose();
    this.gl.deleteBuffer(this.buffer);
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    for (const framebuffer of this.framebuffers) this.gl.deleteFramebuffer(framebuffer);
    this.textures.length = 0;
    this.framebuffers.length = 0;
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas.width = this.canvas.height = 1;
  }
}
