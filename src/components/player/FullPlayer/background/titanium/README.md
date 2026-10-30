# Titanium 背景

移植自 [AMLL 5fee356](https://github.com/amll-dev/applemusic-like-lyrics/commit/5fee356362353dbb24ce9bea3a62536478040de7) 的 `packages/core/src/bg-render/titanium`，作者与贡献者见上游仓库，遵循 AGPL-3.0 许可（见本目录 LICENSE）

保留上游的解析高度场、程序化沙粒、封面调色板、低频脉动、WebGL 上下文恢复及材质选项。当前继续使用 core 0.6.0 的公开 BaseRenderer、GLProgram 和取色接口，从而保留项目现有的歌词重音修复补丁

本地适配：首张封面立即应用配色，资源加载使用解码后的首帧，销毁时使异步加载失效并释放封面引用。着色器维持上游实现；渲染器生命周期、缩略图输入与背景切换由父组件管理

流体背景之间临时捕获两幅正在绘制的 GPU 帧，在 64×40 流场中根据色块与明暗梯度估计形变，再将对齐中的轮廓与材质连续插值。没有固定遮罩或切换起点，不启用 preserveDrawingBuffer，也不向 CPU 读取像素。过渡期间最多两个背景画布与一个合成画布，结束即释放源帧监听、临时纹理、流场和合成 WebGL 上下文；窗口隐藏时立即结束过渡。纯色、模糊背景与减少动态效果模式使用普通交叉淡入

未来升级到正式导出 TitaniumRenderer 的 core 版本时，可将 BackgroundRender.vue 的导入替换为包导出，再移除此目录
