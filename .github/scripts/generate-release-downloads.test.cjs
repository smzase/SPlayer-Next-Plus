"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { generateReleaseDownloads } = require("./generate-release-downloads.cjs");

const version = "1.2.0-beta.1";
const assets = [];
for (const arch of ["x64", "arm64"]) {
  for (const suffix of ["setup.exe", "portable.exe"]) {
    assets.push(`SPlayer-Next-Plus-${version}-Windows-${arch}-${suffix}`);
  }
  for (const suffix of ["dmg", "zip"]) {
    assets.push(`SPlayer-Next-Plus-${version}-Mac-${arch}.${suffix}`);
  }
  for (const [suffix, linuxArch] of [
    ["AppImage", arch === "x64" ? "x86_64" : "arm64"],
    ["deb", arch === "x64" ? "amd64" : "arm64"],
    ["rpm", arch === "x64" ? "x86_64" : "aarch64"],
    ["pacman", arch === "x64" ? "x64" : "aarch64"],
  ]) {
    assets.push(`SPlayer-Next-Plus-${version}-Linux-${linuxArch}.${suffix}`);
  }
}

test("按系统和架构分组，正确识别 Linux 架构别名且仅链接安装包", () => {
  const notes = generateReleaseDownloads(
    [...assets].reverse().concat("beta.yml", "alpha-mac.yml", `${assets[0]}.blockmap`),
    version,
    "smzase/SPlayer-Next-Plus",
    `v${version}`,
  );
  const rows = notes.split("\n").filter((line) => /^\| (Windows|Mac|Linux) /.test(line));
  assert.deepEqual(
    rows.map((row) => row.split(" | ").slice(0, 2).join(" | ")),
    [
      "| Windows | x64",
      "| Windows | arm64",
      "| Mac | x64",
      "| Mac | arm64",
      "| Linux | x64",
      "| Linux | arm64",
    ],
  );
  const urls = [...notes.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((match) => match[1]);
  assert.equal(urls.length, 16);
  for (const asset of assets) {
    assert.ok(
      urls.includes(
        `https://github.com/smzase/SPlayer-Next-Plus/releases/download/v${version}/${asset}`,
      ),
    );
  }
  assert.ok(!notes.includes(".blockmap"));
});

test("缺失安装包时阻止发布含无效链接的说明", () => {
  assert.throws(
    () => generateReleaseDownloads(assets.slice(1), version, "owner/repo", `v${version}`),
    /缺少下载资源: .*Windows-x64-setup\.exe/,
  );
});

test("手动输入的单行 Markdown 按反斜杠 n 换行并放在下载表前", () => {
  const notes = generateReleaseDownloads(
    assets,
    version,
    "owner/repo",
    `v${version}`,
    "本次更新\\n\\n- Electron 升级至 45.0.0\\n- **歌词支持多源**",
  );
  assert.ok(
    notes.startsWith(
      "本次更新\n\n- Electron 升级至 45.0.0\n- **歌词支持多源**\n\n| 系统 | 架构 | 下载 |",
    ),
  );
});

test("真实多行 Markdown 保留代码中的反斜杠、引号和 shell 字符", () => {
  for (const customNotes of [
    '## 本次更新\n\n```js\nconst text = "\\n";\n```\n\n`$(echo example)`',
    '    const text = "\\n";\n\n缩进代码块',
  ]) {
    const notes = generateReleaseDownloads(
      assets,
      version,
      "owner/repo",
      `v${version}`,
      customNotes,
    );
    assert.ok(notes.startsWith(`${customNotes}\n\n| 系统 | 架构 | 下载 |`));
  }
});

test("未填写或只填写空白时保持原有下载说明", () => {
  const original = generateReleaseDownloads(assets, version, "owner/repo", `v${version}`);
  for (const customNotes of ["", "  \r\n  ", "\\n\\n"]) {
    assert.equal(
      generateReleaseDownloads(assets, version, "owner/repo", `v${version}`, customNotes),
      original,
    );
  }
});
