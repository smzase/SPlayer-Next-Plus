<div align="center">

<img alt="SPlayer-Next logo" width="120" height="120" src="public/icons/favicon.png" />

<h2>SPlayer-Next</h2>

<p>🎵 跨平台桌面音乐播放器，支持丰富的歌词展现形式与广泛的音频格式</p>

<p>「<a href="https://github.com/SPlayer-Dev/SPlayer">SPlayer</a>」的继任版本</p>

[![Stars](https://img.shields.io/github/stars/SPlayer-Dev/SPlayer-Next?style=flat)](https://github.com/SPlayer-Dev/SPlayer-Next/stargazers)
[![Release](https://img.shields.io/github/v/release/SPlayer-Dev/SPlayer-Next)](https://github.com/SPlayer-Dev/SPlayer-Next/releases)
[![License](https://img.shields.io/github/license/SPlayer-Dev/SPlayer-Next)](https://github.com/SPlayer-Dev/SPlayer-Next/blob/main/LICENSE)
[![Issues](https://img.shields.io/github/issues/SPlayer-Dev/SPlayer-Next)](https://github.com/SPlayer-Dev/SPlayer-Next/issues)

</div>

---

## 关于 fork

本 fork 的代码由 GPT 5.6 Sol 制作，添加了自用的功能，不会 PR 至上游主仓库（本想着改改任务栏歌词的，结果越改越多，PR也不好搞）

目前，功能大致上是齐全了，剩下的看情况做吧

新增功能

- 新增了「消息」，完善了大部分功能
  - 私信能传图片，以及撤回消息功能
  - 消息浮窗的左下角可拖拽调节窗口宽高
  - 点击头像可跳转到该用户主页（浏览器打开），点击歌曲卡片可播放该曲，专辑卡片点击可跳转
  - 私信内每 3 秒刷新，信息主页每 10 秒刷新，未打开消息每 30 分钟刷新
- 新增了「我的播客」，但「播客」板块没做也不想做
  - 使用官方客户端接口 `/api/v6/dj/program/byradio` ，播客动辄几千首歌，就算猛猛加载也不会有问题
  - 在「创建的播客」页面右上角有「管理播客」，管理播客页面跳转到网页端操作
- 新增了「关注 “笔记”」板块
  - 可以发布，可以评论，与电脑 3.0 客户端基本一致
- 新增了「个人主页」功能
  - 可「编辑个人信息」，以及添加了「我的听歌排行」
- 播放历史添加了「单曲、声音、歌单、专辑、播客、本地」
  - 播放历史的「移除」支持多端同步
- 支持「发表评论、回复评论」功能
  - 评论字数上限 1000 字与官方客户端保持一致
- 新增了「听歌识曲」，并支持与QQ音乐同款的实时歌词查看
- 我的云盘新增了「网盘歌曲信息匹配纠正」

播放

- 添加了网易云音乐同款「单曲播放列表行为」
  - 直接替换整个播放列表 / 将单曲添加至当前播放列表
- 修复了播放歌曲时，播放历史的错误传参

外观

- 任务栏歌词
  - 添加了「纯歌词模式」
  - 添加了「封面&歌词」分离功能，歌词穿透，仅悬停在封面显示按钮
  - 添加了背景歌词支持，歌词之间使用竖线分隔 → [ 背景歌词 | 歌词 ]
  - 可单独设置歌词与翻译的字重
  - 在原有「上一首、播放/暂停、下一首」按钮的基础上，添加了「播放列表」按钮
    - 播放列表支持宽度和高度调节
- 添加了折叠侧边栏「悬停展开」功能
- 搜索栏的搜索历史支持右键复制，热搜榜支持隐藏，搜索结果添加「播客、声音」
- 歌单、专辑等页面添加「评论、分享」按钮，并且为收藏和博客页面的卡片添加右键菜单
- 统一添加输入框右键菜单，包含「剪贴、复制、粘贴、删除、全选」

其他功能

- 文件缓存和数据库缓存支持调节缓存更新天数
- 全局快捷键配置支持小键盘
- 音量支持同步 Windows 音量合成器，无论是在软件还是在任务栏调节声音，皆可同步，该功能提供了开关

- ………………更多功能正在构思中………………

## 功能特性

- 🎵 **广泛的格式支持** —— MP3、FLAC、WAV、AAC、OGG、APE 等，基于 FFmpeg 解码
- 📝 **丰富的歌词** —— LRC / QRC / YRC / TTML，逐字高亮与翻译，支持桌面、灵动岛、任务栏歌词窗口
- 🌐 **流媒体服务** —— Subsonic / Navidrome / Jellyfin / Emby（多服务器、自动连接）
- 🖥️ **跨平台** —— Windows / macOS / Linux
- 🎚️ **音乐频谱** —— 实时 FFT 可视化
- 🏷️ **元信息编辑** —— 编辑本地曲目标签与封面
- ⬇️ **下载** —— 内置下载管理器
- 🎧 **系统媒体集成** —— Windows SMTC / Linux MPRIS / macOS Now Playing + Discord RPC
- ⚡ **高性能音频引擎** —— FFmpeg + Rust
- 🎨 **自适应主题** —— 基于封面取色，Light / Dark / Auto
- 📈 **Last.fm Scrobble**

## 开发

### 环境要求

- **Node.js** >= 24
- **pnpm** >= 12
- **Rust 工具链**（构建原生模块所需，见下）

### 原生模块

核心性能特性由 Rust 编写的原生模块提供：

| 模块            | 说明                                               |
| --------------- | -------------------------------------------------- |
| `audio-engine`  | 高性能音频解码（FFmpeg）、播放、FFT 频谱、封面提取 |
| `media-ctrl`    | 系统媒体控制 + Discord Rich Presence               |
| `taskbar-lyric` | Windows 任务栏歌词原生渲染                         |

`pnpm dev` 与 `pnpm build` 会自动编译原生模块。若只做 UI 开发想跳过，可设置 `SKIP_NATIVE_BUILD=true`。

### 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 启动开发（先以 debug 构建原生模块，再启动 Electron）
pnpm dev
```

### 构建

```bash
pnpm build         # 完整构建：清理 → 原生模块 → 类型检查 → electron-vite

pnpm build:win     # 打包 Windows
pnpm build:mac     # 打包 macOS
pnpm build:linux   # 打包 Linux（AppImage / deb / rpm / pacman）
```

> 默认仅构建当前架构。如需指定架构，可追加参数，例如 `pnpm build:win --x64 --arm64`。

发行包名称包含系统，例如 `SPlayer-Next-Plus-1.2.1-beta.1-Windows-x64-setup.exe`。
Release 发布说明按 Windows、Mac、Linux 排列下载入口，各系统保留 x64 和 arm64。
Linux 默认不再发布 `tar.gz`，其他安装格式保留；更新使用完整包，不再发布 `.blockmap`。
`.yml` 是应用检查更新所需的清单，必须随安装包保留，无需手动下载。

### 其他脚本

```bash
pnpm typecheck        # tsc + vue-tsc（node + web 双目标）
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm build:native     # 仅构建 Rust 原生模块（加 `--dev` 为 debug 构建）
```

## 安装

### Arch Linux / Manjaro / EndeavourOS

从 Release 页面下载 `.pacman` 包，使用 `pacman` 安装：

```bash
sudo pacman -U ./splayer-next-*.pacman
```

## 致谢

特别感谢以下让 SPlayer-Next 成为可能的开源项目：

- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) —— 类 Apple Music 歌词显示组件库
- [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced) —— 网易云音乐 API 备份 + 增强

## 开源许可

本项目基于 [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 许可开源。

- **修改与分发：** 任何修改或分发都必须同样基于 **AGPL-3.0**，并一并提供完整源代码。
- **派生作品：** 必须同样采用 **AGPL-3.0**，并在适当位置保留本项目的许可与版权信息。
- **署名：** 必须保留原作者及版权信息。可为二次开发添加你自己的署名，但不得移除或篡改原始信息。
- **商业用途：** 如用于售卖或其他盈利用途，必须提供源代码及原项目链接。由于本项目涉及第三方服务，商业使用可能存在法律风险。
- **免责：** 本软件按「现状」提供，不附带任何形式的担保，详见 AGPL-3.0。

## 免责声明

本项目仅供个人学习与研究使用，禁止用于商业及非法用途。部分功能依赖第三方 API，使用者须自行确保其使用符合相关法律法规及服务协议。对于因使用本项目而产生的任何直接或间接后果，作者不承担任何责任。
