// 卡片图标素材库：读取 assets/icons 下的本地 Lucide 图标，按卡片文本挑选并渲染成封面 SVG。
// 运行时不再访问网络；素材来源与许可见 assets/icons/LICENSES.md。
import {readFileSync} from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const catalogFile = path.join(root, 'assets/icons/catalog.json');
const keywordsFile = path.join(root, 'assets/icons/keywords.json');

let catalogCache, keywordCache, byNameCache;

export function loadCatalog() {
  if (!catalogCache) {
    catalogCache = JSON.parse(readFileSync(catalogFile, 'utf8'));
    byNameCache = new Map(catalogCache.icons.map(icon => [icon.name, icon]));
  }
  return catalogCache;
}
export function loadKeywords() {
  if (!keywordCache) keywordCache = JSON.parse(readFileSync(keywordsFile, 'utf8'));
  return keywordCache;
}
export function iconByName(name) {
  loadCatalog();
  return byNameCache.get(name) || null;
}
export function hasIcon(name) {
  return !!iconByName(name);
}

function countKey(text, key) {
  const needle = key.toLowerCase();
  if (/^[a-z0-9-]+$/.test(needle)) {
    return (text.match(new RegExp(`(^|[^a-z0-9])${needle}([^a-z0-9]|$)`, 'g')) || []).length;
  }
  let count = 0, index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) { count++; index += needle.length; }
  return count;
}

// 标题和技能更能代表卡片主题，重复计入权重；同一组只取一个主图标，避免三个图标语义重复。
function scoreGroups(text) {
  const lower = ' ' + text.toLowerCase() + ' ';
  const groups = [];
  for (const group of loadKeywords().groups) {
    let score = 0, longest = 0;
    for (const key of group.keys) {
      const count = countKey(lower, key);
      if (!count) continue;
      score += count * (key.length >= 3 ? 1.2 : 1);
      longest = Math.max(longest, key.length);
    }
    if (score) groups.push({group, score, longest});
  }
  groups.sort((a, b) => b.score - a.score || b.longest - a.longest);
  return groups;
}

// 按标题、问题描述、技能和交付物挑选 1-3 个图标；没有命中时用通用组合。
export function pickIcons(card = {}, max = 3) {
  const title = typeof card.title === 'string' ? card.title : '';
  const skills = (Array.isArray(card.skills) ? card.skills : []).filter(value => typeof value === 'string');
  const body = [
    card.problem, card.desiredOutcome, card.category,
    ...(Array.isArray(card.deliverables) ? card.deliverables : []),
    ...(Array.isArray(card.materials) ? card.materials : []),
    ...(Array.isArray(card.constraints) ? card.constraints : [])
  ].filter(value => typeof value === 'string');
  const weighted = [title, title, title, ...skills, ...skills, ...body].join(' ');
  const result = [];
  for (const {group} of scoreGroups(weighted)) {
    const name = group.icons.find(candidate => hasIcon(candidate));
    if (name && !result.includes(name)) result.push(name);
    if (result.length >= max) return result;
  }
  for (const name of (loadKeywords().fallback || []).filter(hasIcon)) {
    if (!result.includes(name)) result.push(name);
    if (result.length >= max) break;
  }
  return result;
}

function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// 封面构图：左侧米色大圆主图标，中间小贴纸补充语义，右侧橙色徽章。
// 图标数量和名称由关键词匹配决定；只有 1 个图标时用三个圆点补足右侧。
const SLOTS = {
  disc: {cx: 300, cy: 200, r: 205},
  hero: {x: 185, y: 85, size: 230, stroke: 8},
  tile: {x: 560, y: 150, width: 120, height: 100, rx: 18},
  tileIcon: {x: 585, y: 165, size: 70, stroke: 5},
  badge: {cx: 1040, cy: 210, r: 230},
  badgeIcon: {x: 952, y: 120, size: 176, stroke: 10}
};

export function renderIcon(name, {x, y, size, color, stroke = 2.2, opacity = 1}) {
  const icon = iconByName(name);
  if (!icon) return '';
  const grid = icon.size || 16;
  const scale = size / grid;
  const unitStroke = (stroke / scale).toFixed(4);
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="${unitStroke}" stroke-linecap="round" stroke-linejoin="round" color="${color}" opacity="${opacity}">${icon.body}</g>`;
}

export function renderIconArtwork(design, iconNames = []) {
  const names = [...new Set(iconNames.filter(hasIcon))].slice(0, 3);
  const paper = design.paper || '#f4ead8';
  const accent = design.accent || '#c4553d';
  const sky = design.sky || '#163b34';
  const ink = design.ink || '#211f1c';
  const iconColor = contrast(sky, paper) >= contrast(sky, ink) ? paper : ink;
  const badgeColor = design.accentInk || (contrast(accent, paper) >= contrast(accent, ink) ? paper : ink);
  const hero = names[0] ? renderIcon(names[0], {...SLOTS.hero, color: ink}) : '';
  const middle = names.length >= 3 ? renderIcon(names[2], {...SLOTS.tileIcon, color: iconColor}) : '';
  const badge = names.length >= 2 ? renderIcon(names[1], {...SLOTS.badgeIcon, color: badgeColor}) : '';
  const dots = badge ? '' : `<g fill="${badgeColor}" opacity="0.75"><circle cx="1000" cy="200" r="8"/><circle cx="1040" cy="200" r="8"/><circle cx="1080" cy="200" r="8"/></g>`;
  const tile = middle ? `<rect x="${SLOTS.tile.x}" y="${SLOTS.tile.y}" width="${SLOTS.tile.width}" height="${SLOTS.tile.height}" rx="${SLOTS.tile.rx}" fill="${paper}" opacity="0.16"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400">` +
    `<rect width="1200" height="400" fill="${sky}"/>` +
    `<circle cx="${SLOTS.disc.cx}" cy="${SLOTS.disc.cy}" r="${SLOTS.disc.r}" fill="${paper}"/>` +
    `<circle cx="${SLOTS.badge.cx}" cy="${SLOTS.badge.cy}" r="${SLOTS.badge.r}" fill="${accent}"/>` +
    `<path d="M720 330 Q820 290 920 330" fill="none" stroke="${iconColor}" stroke-width="2" opacity="0.25"/>` +
    tile + hero + middle + badge + dots +
    `</svg>`;
}
