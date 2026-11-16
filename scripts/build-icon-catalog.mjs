// 从 Lucide 的 lucide-static 包生成离线图标素材库（ISC 许可）。
// 运行时只读 assets/icons/catalog.json，不访问网络。
//
// 准备素材（只需在重建时执行）：
//   npm pack lucide-static --pack-destination work/icon-src
//   mkdir -p work/icon-src/lucide
//   tar -xzf work/icon-src/lucide-static-*.tgz -C work/icon-src/lucide --strip-components=1
//   npm run icons:build
import {copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const catalogFile = path.join(root, 'assets/icons/catalog.json');
const keywordsFile = path.join(root, 'assets/icons/keywords.json');
const licenseFile = path.join(root, 'assets/icons/LUCIDE-LICENSE.txt');
const sourceDir = path.resolve(process.argv[2] || process.env.LUCIDE_ICONS_DIR || path.join(root, 'work/icon-src/lucide/icons'));

if (!existsSync(sourceDir)) {
  console.error(`找不到 Lucide 图标目录：${sourceDir}`);
  console.error('先执行：npm pack lucide-static --pack-destination work/icon-src');
  console.error('再执行：tar -xzf work/icon-src/lucide-static-*.tgz -C work/icon-src/lucide --strip-components=1');
  process.exit(1);
}

function extractBody(text) {
  const start = text.indexOf('<svg');
  const from = text.indexOf('>', start) + 1;
  const to = text.lastIndexOf('</svg>');
  if (start < 0 || from <= 0 || to < from) return '';
  return text.slice(from, to).replace(/\s+/g, ' ').trim();
}

const files = readdirSync(sourceDir).filter(name => name.endsWith('.svg')).sort();
const icons = [];
for (const file of files) {
  const name = file.slice(0, -4);
  const body = extractBody(readFileSync(path.join(sourceDir, file), 'utf8'));
  if (!body || body.length > 8000) throw new Error(`图标内容无效：${file}`);
  icons.push({name, viewBox: '0 0 24 24', size: 24, body});
}

const packageFile = path.join(sourceDir, '..', 'package.json');
const version = existsSync(packageFile) ? JSON.parse(readFileSync(packageFile, 'utf8')).version : '';
const catalog = {
  source: 'Lucide (https://github.com/lucide-icons/lucide)',
  package: 'lucide-static',
  version,
  license: 'ISC',
  viewBox: '0 0 24 24',
  size: 24,
  generatedAt: new Date().toISOString(),
  count: icons.length,
  icons
};
writeFileSync(catalogFile, JSON.stringify(catalog) + '\n');

const sourceLicense = path.join(sourceDir, '..', 'LICENSE');
if (existsSync(sourceLicense)) copyFileSync(sourceLicense, licenseFile);

// 关键词映射必须全部指向真实图标，避免以后换素材时悄悄失效。
const keywords = JSON.parse(readFileSync(keywordsFile, 'utf8'));
const byName = new Set(icons.map(icon => icon.name));
const missing = [...new Set(keywords.groups.flatMap(group => group.icons).concat(keywords.fallback || []))]
  .filter(name => !byName.has(name));
if (missing.length) throw new Error(`keywords.json 引用了不存在的图标：${missing.join(', ')}`);

console.log(`icons: ${icons.length}`);
console.log(`catalog: ${catalogFile}`);
console.log(`keywords groups: ${keywords.groups.length}`);
