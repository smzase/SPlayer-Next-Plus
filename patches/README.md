# AMLL 词内长音衔接

`@applemusic-like-lyrics/core@0.6.0` 的补丁恢复旧版按 `Intl.Segmenter` 词语边界组织强调动画的行为

上游提交 `b04ada8c5d5d44b8a6c0a063a9b795c3a62e11ea` 改为单独处理 CJK 音节，使“宝物”这类词语中的长音分别放大、缩回。恢复分组后，词内字符共用强调时长并错峰开始，后一个字会在前一个字缩回前上浮放大

- 保留 0.6.0 的空格拆分、逐词音译分配和注音处理
- 保留每个音节及注音的时间戳，恢复词内强调时序，不合并高亮时间
- 复用核心已有的分词器，不新增缓存、逐帧计算或合成层
- 同时修补 ESM 和 CommonJS 入口，安装时由 `pnpm-workspace.yaml` 中的 `patchedDependencies` 应用

回归用例位于 `src/components/player/Lyrics/amllEmphasis.spec.ts`，覆盖预放大、空格边界、短音节、音译分配和跨分词边界的注音

升级 AMLL 时需重新核对分组实现和回归用例，确认上游已恢复预放大效果后再移除补丁
