/**
 * 极简打包脚本：把 src/ 下的模块按顺序拼成一个 index.js。
 *
 * 不用 webpack、不用 npm 安装任何依赖，node 直接跑。
 * 做法：把 ESM 的 import/export 去掉，按依赖顺序拼接，全部收进一个 IIFE。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const files = [
  { file: 'src/baibai.js', exports: ['listArtistPresets', 'readChannelDefaults', 'formatOne', 'formatMany', 'downloadText', 'copyText'] },
  { file: 'src/dialog.js', exports: ['openExportDialog', 'exportSingle'] },
  { file: 'src/index.js', exports: [] },
];

const chunks = [];

for (const { file } of files) {
  let code = await readFile(path.join(root, file), 'utf8');

  // 去掉 import 语句（模块间靠拼接后的作用域共享）
  code = code.replace(/^\s*import[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/^\s*import\s*['"][^'"]+['"];?\s*$/gm, '');

  // export function xxx -> function xxx
  code = code.replace(/^export\s+(async\s+)?function\s+/gm, '$1function ');
  code = code.replace(/^export\s+const\s+/gm, 'const ');
  code = code.replace(/^export\s+let\s+/gm, 'let ');

  chunks.push(`/* ===== ${file} ===== */\n${code.trim()}\n`);
}

const banner = `/*
 * 画师串导出 · 柏宝绘辅助插件
 * 只读取柏宝绘的画师串设置，不写入、不修改任何数据。
 * 生成时间：${new Date().toISOString()}
 */
`;

const bundled = `${banner}(function () {\n'use strict';\n\n${chunks.join('\n')}\n})();\n`;

await writeFile(path.join(root, 'index.js'), bundled, 'utf8');

const size = (bundled.length / 1024).toFixed(1);
console.log(`已生成 index.js（${size} KB）`);
