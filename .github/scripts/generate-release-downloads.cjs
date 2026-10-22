#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * 从实际发布资源生成按系统、架构排列的下载入口
 * @param {string[]} assets - 发布资源文件名
 * @param {string} version - 应用版本
 * @param {string} repository - GitHub 仓库名称
 * @param {string} tag - 发布标签
 * @returns {string} 发布说明中的下载表格
 */
const generateReleaseDownloads = (assets, version, repository, tag) => {
  const baseUrl = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`;
  const lines = [
    "## 下载安装",
    "",
    "Windows 通常选择 x64 安装版；Apple 芯片 Mac 选择 arm64，Intel Mac 选择 x64；Linux 不确定格式时选择 AppImage",
    "",
    "| 系统 | 架构 | 下载 |",
    "| --- | --- | --- |",
  ];
  const platforms = [
    [
      "Windows",
      [
        ["-setup.exe", "安装版（推荐）"],
        ["-portable.exe", "便携版"],
      ],
    ],
    [
      "Mac",
      [
        [".dmg", "DMG（推荐）"],
        [".zip", "ZIP"],
      ],
    ],
    [
      "Linux",
      [
        [".AppImage", "AppImage"],
        [".deb", "deb"],
        [".rpm", "rpm"],
        [".pacman", "pacman"],
      ],
    ],
  ];
  for (const [platform, formats] of platforms) {
    const prefix = `SPlayer-Next-Plus-${version}-${platform}-`;
    for (const [arch, aliases] of [
      ["x64", ["x64", "x86_64", "amd64"]],
      ["arm64", ["arm64", "aarch64"]],
    ]) {
      const links = [];
      for (const [suffix, label] of formats) {
        const name = assets.find((asset) =>
          aliases.some((alias) => asset === `${prefix}${alias}${suffix}`),
        );
        if (!name) throw new Error(`缺少下载资源: ${prefix}${arch}${suffix}`);
        links.push(`[${label}](${baseUrl}/${encodeURIComponent(name)})`);
      }
      lines.push(`| ${platform} | ${arch} | ${links.join(" · ")} |`);
    }
  }
  lines.push("", "更新使用完整安装包下载，资源列表中的 `.yml` 用于应用检查更新，无需手动下载", "");
  return lines.join("\n");
};

if (require.main === module) {
  const [assetsDir, version, repository, tag, outputFile] = process.argv.slice(2);
  if (!assetsDir || !version || !repository || !tag || !outputFile) {
    console.error(
      "用法: node generate-release-downloads.cjs <assetsDir> <version> <repository> <tag> <outputFile>",
    );
    process.exit(1);
  }
  const assets = fs
    .readdirSync(assetsDir)
    .filter((name) => fs.statSync(path.join(assetsDir, name)).isFile());
  fs.writeFileSync(outputFile, generateReleaseDownloads(assets, version, repository, tag));
}

module.exports = { generateReleaseDownloads };
