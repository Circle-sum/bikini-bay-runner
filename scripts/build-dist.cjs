// 组装部署产物到 dist/。
// 只按白名单拷贝运行时真正会请求的文件：仓库里那些设计稿、调试导出、预览图
// 不进部署包，Pages 上就只托管游戏本身。
// 用法: node scripts/build-dist.cjs
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const FILES = [
  'index.html',
  'sw.js',
  'manifest.webmanifest',
  'assets/ui.css',
  'assets/chars/characters.js',
  'assets/world/world.js',
  'assets/chars/spongebob.webp',
  'assets/chars/patrick.webp',
  'assets/chars/squidward.webp',
  'assets/chars/sandy.webp',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
];

const missing = FILES.filter(rel => !fs.existsSync(path.join(root, rel)));
if (missing.length) {
  console.error('以下运行时文件不存在，构建中止：\n  ' + missing.join('\n  '));
  process.exit(1);
}

fs.rmSync(dist, { recursive: true, force: true });
let total = 0;
for (const rel of FILES) {
  const target = path.join(dist, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, rel), target);
  total += fs.statSync(target).size;
}

console.log(`dist/ 已生成：${FILES.length} 个文件，合计 ${(total / 1024).toFixed(1)}KB`);
for (const rel of FILES) {
  console.log(`  ${(fs.statSync(path.join(dist, rel)).size / 1024).toFixed(1).padStart(7)}KB  ${rel}`);
}
