/**
 * 小程序素材预算检查：
 * - 单张图片不得超过 500 KB
 * - 单个字体文件不得超过 128 KB
 * - 图片与字体合计不得超过 6 MB；新增财务/人力各最多 512 KB
 * 超出时退出码为 1 并打印具体文件。
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMAGE_DIRS = [
  fileURLToPath(new URL('../assets/parent', import.meta.url)),
  fileURLToPath(new URL('../assets/teacher', import.meta.url)),
  fileURLToPath(new URL('../assets/campus-manager', import.meta.url)),
  fileURLToPath(new URL('../assets/super-admin', import.meta.url)),
  fileURLToPath(new URL('../assets/partner', import.meta.url)),
  fileURLToPath(new URL('../pages/parent/assets', import.meta.url)),
  fileURLToPath(new URL('../pages/teacher/assets', import.meta.url)),
  fileURLToPath(new URL('../pages/campus-manager/assets', import.meta.url)),
  fileURLToPath(new URL('../pages/super-admin/assets', import.meta.url)),
  fileURLToPath(new URL('../pages/partner/assets', import.meta.url)),
];
const FONT_DIR = fileURLToPath(new URL('../assets/fonts', import.meta.url));
const NEW_ROLE_DIRS = ['finance', 'hr'].map((role) =>
  fileURLToPath(new URL(`../pages/${role}`, import.meta.url)),
);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const FONT_EXTS = new Set(['.woff', '.woff2', '.ttf', '.otf']);
const SINGLE_LIMIT = 500 * 1024;
const FONT_SINGLE_LIMIT = 128 * 1024;
const TOTAL_LIMIT = 6 * 1024 * 1024;

let failures = 0;
let total = 0;

function walk(dir, extensions, singleLimit, label) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, extensions, singleLimit, label);
      continue;
    }
    if (!extensions.has(extname(entry.name).toLowerCase())) continue;
    const size = statSync(full).size;
    total += size;
    if (size > singleLimit) {
      failures += 1;
      console.error(`OVER ${label}: ${full} (${(size / 1024).toFixed(1)} KB)`);
    }
  }
}

for (const dir of IMAGE_DIRS) {
  walk(dir, IMAGE_EXTS, SINGLE_LIMIT, '500KB IMAGE LIMIT');
}
for (const dir of NEW_ROLE_DIRS) {
  if (!existsSync(dir)) continue;
  const before = total;
  walk(dir, IMAGE_EXTS, SINGLE_LIMIT, '500KB IMAGE LIMIT');
  if (total - before > 512 * 1024) {
    failures += 1;
    console.error(`OVER 512KB ROLE IMAGE BUDGET: ${dir}`);
  }
}
walk(FONT_DIR, FONT_EXTS, FONT_SINGLE_LIMIT, '128KB FONT LIMIT');
console.log(`assets total: ${(total / 1024).toFixed(1)} KB (limit ${(TOTAL_LIMIT / 1024).toFixed(1)} KB)`);
if (total > TOTAL_LIMIT) {
  failures += 1;
  console.error('OVER TOTAL BUDGET');
}
if (failures > 0) process.exit(1);
console.log('asset budget OK');
