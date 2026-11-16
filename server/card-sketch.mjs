// 手绘风卡片封面：用 Rough.js 把“对象清单”渲成抖动手绘线稿。
// 只接受受控的对象类型和数值，不执行模型生成的任何代码。
import rough from 'roughjs';

const W = 1200;
const H = 400;
const DESK_Y = 352;

const PALETTES = [
  {paper:'#FFF9EF', sky:'#F6E7CE', accent:'#D9542B', blue:'#2F6F8F', green:'#4C7A5A', gold:'#E8B23C'},
  {paper:'#FFFBF2', sky:'#EFE5D0', accent:'#B85C38', blue:'#3C6E71', green:'#5B7F5A', gold:'#D9A441'},
  {paper:'#FDFBF6', sky:'#EAE7DC', accent:'#C4553D', blue:'#416B7A', green:'#56735A', gold:'#D9A441'},
  {paper:'#FFF8EC', sky:'#F1E2C6', accent:'#C25B2E', blue:'#376A7A', green:'#53795B', gold:'#E0AE4A'}
];

const KINDS = new Set(['document','cabinet','magnifier','badge','cup','speech','globe','presentation','book','chart','folder','person','arrow','plant','sparkle']);
const BACKGROUNDS = new Set(['hills','mountains','sea','forest','city','industrial','fields']);

function hashSeed(text) {
  let value = 2166136261;
  for (const ch of text) { value ^= ch.codePointAt(0); value = Math.imul(value, 16777619); }
  return (value >>> 0) % 100000;
}
function esc(value) {
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value * 100) / 100)) : fallback;
}
function lum(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return 0.5;
  const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function shade(hex, amount) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#2b2620';
  return '#' + hex.slice(1).match(/../g).map(v => Math.round(parseInt(v, 16) * (1 - amount)).toString(16).padStart(2, '0')).join('');
}
function mix(a, b, t) {
  if (!/^#[0-9a-f]{6}$/i.test(a || '') || !/^#[0-9a-f]{6}$/i.test(b || '')) return a || b;
  const pa = a.slice(1).match(/../g).map(v => parseInt(v, 16));
  const pb = b.slice(1).match(/../g).map(v => parseInt(v, 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
function readable(background) { return lum(background) > 0.45 ? '#2B2620' : '#FFF9EF'; }

function pickPalette(text) {
  return PALETTES[hashSeed(text) % PALETTES.length];
}
function hasAny(text, words) { return words.some(word => text.includes(word)); }

// 根据卡片文本挑一套“场景”；后续模型直接给 objects 时，同样走 renderSketch。
export function planSketch(card = {}, design = {}) {
  const title = typeof card.title === 'string' ? card.title : '';
  const skills = (Array.isArray(card.skills) ? card.skills : []).filter(v => typeof v === 'string');
  const body = [card.problem, card.desiredOutcome, card.category,
    ...(Array.isArray(card.deliverables) ? card.deliverables : []),
    ...(Array.isArray(card.materials) ? card.materials : []),
    ...(Array.isArray(card.constraints) ? card.constraints : [])].filter(v => typeof v === 'string');
  const text = [title, title, title, ...skills, ...skills, ...body].join(' ');
  const palette = pickPalette(text);
  const paper = /^#[0-9a-f]{6}$/i.test(design.paper || '') && lum(design.paper) > 0.72 ? design.paper : palette.paper;
  const accent = /^#[0-9a-f]{6}$/i.test(design.accent || '') && lum(design.accent) < 0.72 && lum(design.accent) > 0.12
    ? design.accent : palette.accent;
  const ink = readable(paper);
  const base = {name:'sketch', paper, accent, sky:palette.sky, ink,
    blue:palette.blue, green:palette.green, gold:palette.gold, background:'hills'};

  const isElectric = hasAny(text, ['电气','电力','配电','变电','高压','低压','开关柜','plc','回路','控制柜','接线','电路']);
  const isTranslation = hasAny(text, ['翻译','英文','英语','德文','德语','中译英','translate']);
  const isTraining = hasAny(text, ['培训','学习','教程','带教','课程','教学']);
  const isData = hasAny(text, ['数据','报表','统计','分析','图表','看板','复盘']);
  const isCollab = hasAny(text, ['协作','团队','同事','协同','合作','跨部门','求助','帮忙','支持','协助','请教']);
  const isReview = hasAny(text, ['审阅','审核','校对','复核','评审','检查','验收','质检','把关']);

  // 统一前景"站位"：主物体底边落在桌面线附近，右侧小物不压住远处山线。
  const GROUND = 344;
  const onGround = (object, height) => ({...object, y: GROUND - height});
  const cup = (x = 1060) => ({kind:'cup', x, y: GROUND - 70, width:54, height:70});
  const badge = (x = 920, y = 98, r = 34) => ({kind:'badge', x, y, r});

  if (isTranslation) {
    return {...base, name:'translation', background:'sea', objects:[
      onGround({kind:'document', x:124, width:222, height:254, lines:7, checks:0, marks:0}, 254),
      {kind:'speech', x:300, y:52, width:200, height:120, lines:3},
      {kind:'globe', x:812, y:176, r:94},
      badge(986, 86, 34),
      {kind:'arrow', x1:372, y1:236, x2:704, y2:188},
      cup()
    ]};
  }
  if (isTraining) {
    return {...base, name:'training', background:'forest', objects:[
      {kind:'presentation', x:112, y:72, width:330, height:206},
      onGround({kind:'book', x:486, width:196, height:112}, 112),
      onGround({kind:'plant', x:744, width:66, height:80}, 80),
      {kind:'sparkle', x:884, y:166, size:26},
      badge(968, 92, 34),
      cup()
    ]};
  }
  if (isData && !isElectric && !isReview && !isTraining) {
    return {...base, name:'data', background:'fields', objects:[
      onGround({kind:'chart', x:100, width:300, height:234}, 234),
      onGround({kind:'document', x:452, width:212, height:250, lines:7, checks:2, marks:1}, 250),
      {kind:'magnifier', x:678, y:222, r:54},
      {kind:'sparkle', x:830, y:190, size:22},
      badge(916, 98, 34),
      onGround({kind:'plant', x:1032, width:70, height:84}, 84)
    ]};
  }
  if (isCollab && !isElectric && !isReview && !isTraining && !isData) {
    return {...base, name:'collab', background:'city', objects:[
      {kind:'person', x:206, y:222, scale:0.95},
      {kind:'person', x:340, y:222, scale:0.95, color:base.blue},
      {kind:'speech', x:240, y:44, width:208, height:126, lines:3},
      {kind:'person', x:772, y:231, scale:0.88, color:base.green},
      {kind:'speech', x:700, y:50, width:160, height:96, lines:2, color:base.green},
      badge(930, 96, 32),
      {kind:'cup', x:1116, y:286, width:44, height:58}
    ]};
  }
  if (isElectric || isReview) {
    return {...base, name:isElectric?'electric-review':'review', background:isElectric?'industrial':'mountains', objects:[
      ...(isElectric
        ? [onGround({kind:'cabinet', x:84, width:255, height:228}, 228)]
        : [onGround({kind:'folder', x:104, width:250, height:200}, 200)]),
      onGround({kind:'document', x:isElectric?404:400, width:isElectric?212:214, height:isElectric?258:252, lines:8, checks:3, marks:2}, isElectric?258:252),
      {kind:'magnifier', x:isElectric?626:622, y:218, r:54},
      {kind:'badge', x:isElectric?596:592, y:isElectric?94:92, r:32},
      cup(),
      ...(isElectric ? [{kind:'arrow', x1:348, y1:292, x2:396, y2:258}] : [])
    ]};
  }
  return {...base, name:'default', objects:[
    onGround({kind:'folder', x:104, width:248, height:200}, 200),
    onGround({kind:'document', x:452, width:214, height:252, lines:7, checks:2, marks:1}, 252),
    {kind:'magnifier', x:680, y:220, r:52},
    badge(900, 98, 32),
    cup()
  ]};
}

// ---------- 受控场景校验 ----------
export function normalizeScene(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('场景格式无效');
  const color = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value.toLowerCase() : null;
  const paper = color(input.paper) || '#fff9ef';
  const accent = color(input.accent) || '#d9542b';
  const scene = {
    name: typeof input.name === 'string' && input.name.length <= 40 ? input.name : 'sketch',
    paper, accent,
    sky: color(input.sky) || '#f6e7ce',
    ink: color(input.ink) || readable(paper),
    blue: color(input.blue) || '#2f6f8f',
    green: color(input.green) || '#4c7a5a',
    gold: color(input.gold) || '#e8b23c',
    objects: []
  };
  if (typeof input.background === 'string') {
    if (!BACKGROUNDS.has(input.background)) throw new Error('背景类型无效');
    scene.background = input.background;
  }
  if (!Array.isArray(input.objects) || input.objects.length < 1 || input.objects.length > 14) throw new Error('场景需要 1 到 14 个对象');
  const fields = new Set(['kind','x','y','width','height','r','scale','size','x1','y1','x2','y2','lines','checks','marks','color','fill']);
  for (const item of input.objects) {
    if (!item || typeof item !== 'object' || !KINDS.has(item.kind)) throw new Error('场景对象类型无效');
    if (Object.keys(item).some(key => !fields.has(key))) throw new Error('场景对象属性无效');
    const object = {kind:item.kind};
    const mins = {x:-1200, y:-1200, x1:-1200, y1:-1200, x2:-1200, y2:-1200,
      width:0, height:0, r:8, scale:0.5, size:0, lines:0, checks:0, marks:0};
    const maxs = {width:2400, height:2400, r:2400, scale:3, size:2400, lines:14, checks:14, marks:14};
    for (const key of Object.keys(mins)) {
      if (item[key] != null) object[key] = clamp(item[key], mins[key], maxs[key] ?? 2400, 0);
    }
    for (const key of ['color','fill']) {
      if (item[key] && color(item[key])) object[key] = item[key].toLowerCase();
    }
    scene.objects.push(object);
  }
  return scene;
}

// ---------- Rough.js 绘制 ----------
function makeContext(scene) {
  const seed = hashSeed(JSON.stringify(scene));
  // 前景线稿用暖灰墨色，和风景的低饱和色块更接近，避免纯黑描边像贴纸。
  const ink = mix(scene.ink, scene.paper, 0.3);
  const paper = mix(scene.paper, scene.sky, 0.16);
  return {scene, seed, ink, paper, index:0, g:rough.generator({seed})};
}
function nextSeed(ctx) { return ctx.seed + (++ctx.index) * 97; }

function emit(ctx, shape, opacity) {
  if (!shape || !shape.sets) return '';
  const options = shape.options || {};
  const parts = [];
  for (const set of shape.sets) {
    const d = ctx.g.opsToPath(set, 1);
    if (!d) continue;
    if (set.type === 'path') {
      parts.push(`<path d="${d}" fill="none" stroke="${esc(options.stroke)}" stroke-width="${options.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`);
    } else if (set.type === 'fillPath') {
      parts.push(`<path d="${d}" fill="${esc(options.fill)}" stroke="none"/>`);
    } else if (set.type === 'fillSketch') {
      parts.push(`<path d="${d}" fill="none" stroke="${esc(options.fill)}" stroke-width="${options.fillWeight || 1}" stroke-linecap="round"/>`);
    }
  }
  const svg = parts.join('');
  return opacity != null ? `<g opacity="${opacity}">${svg}</g>` : svg;
}
function opts(ctx, extra = {}) {
  return {
    seed: extra.seed ?? nextSeed(ctx),
    roughness: extra.roughness ?? 1.25,
    bowing: extra.bowing ?? 0.85,
    stroke: extra.stroke || ctx.ink,
    strokeWidth: extra.strokeWidth ?? 2.5,
    fill: extra.fill,
    fillStyle: extra.fill ? 'solid' : undefined,
    fillWeight: extra.fillWeight ?? 0.9,
    hachureGap: extra.hachureGap ?? 11,
    hachureAngle: extra.hachureAngle ?? -38,
    preserveVertices: true
  };
}
function rect(ctx, x, y, width, height, extra = {}) {
  return emit(ctx, ctx.g.rectangle(x, y, width, height, opts(ctx, extra)), extra.opacity);
}
function circle(ctx, cx, cy, r, extra = {}) {
  return emit(ctx, ctx.g.circle(cx, cy, r, opts(ctx, extra)), extra.opacity);
}
function ellipse(ctx, cx, cy, rx, ry, extra = {}) {
  return emit(ctx, ctx.g.ellipse(cx, cy, rx, ry, opts(ctx, extra)), extra.opacity);
}
function line(ctx, x1, y1, x2, y2, extra = {}) {
  return emit(ctx, ctx.g.line(x1, y1, x2, y2, opts(ctx, extra)), extra.opacity);
}
function path(ctx, d, extra = {}) {
  return emit(ctx, ctx.g.path(d, opts(ctx, extra)), extra.opacity);
}
function hatch(ctx, x, y, width, height, color, opacity = 0.28) {
  const shape = ctx.g.rectangle(x, y, width, height, opts(ctx, {
    fill:color, fillStyle:'hachure', fillWeight:0.9, hachureGap:10, stroke:'none', strokeWidth:0
  }));
  return emit(ctx, shape, opacity);
}
function sparkle(ctx, x, y, size, color) {
  return line(ctx, x - size, y, x + size, y, {stroke:color, strokeWidth:2.2}) +
    line(ctx, x, y - size, x, y + size, {stroke:color, strokeWidth:2.2});
}

// ---------- 风景简笔画背景 ----------
function backgroundColors(scene) {
  return {
    skyTop: mix(scene.sky, '#ffffff', 0.3),
    skyBottom: mix(scene.sky, scene.gold, 0.24),
    far: mix(scene.blue, scene.sky, 0.55),
    mid: mix(scene.green, scene.sky, 0.42),
    near: mix(scene.green, scene.sky, 0.18),
    sun: scene.gold,
    cloud: mix(scene.paper, '#ffffff', 0.62),
    water: mix(scene.blue, scene.sky, 0.28),
    dark: mix(scene.ink, scene.blue, 0.42),
    warm: mix(scene.accent, scene.gold, 0.3),
    white: '#FFFDF6'
  };
}
function cloud(ctx, x, y, s, color) {
  return ellipse(ctx, x, y + 7 * s, 47 * s, 13 * s, {fill:color, stroke:'none', roughness:0.7}) +
    circle(ctx, x - 28 * s, y, 20 * s, {fill:color, stroke:'none', roughness:0.7}) +
    circle(ctx, x, y - 12 * s, 26 * s, {fill:color, stroke:'none', roughness:0.7}) +
    circle(ctx, x + 30 * s, y + 1 * s, 19 * s, {fill:color, stroke:'none', roughness:0.7});
}
function sun(ctx, cx, cy, r, color) {
  let out = `<circle cx="${cx}" cy="${cy}" r="${r * 1.75}" fill="${color}" opacity="0.13"/>`;
  out += circle(ctx, cx, cy, r, {fill:color, stroke:mix(color, ctx.ink, 0.38), strokeWidth:2.2, roughness:0.85});
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const x1 = cx + Math.cos(angle) * (r + 12), y1 = cy + Math.sin(angle) * (r + 12);
    const x2 = cx + Math.cos(angle) * (r + 31), y2 = cy + Math.sin(angle) * (r + 31);
    out += line(ctx, x1, y1, x2, y2, {stroke:color, strokeWidth:2.2, opacity:0.65});
  }
  return out;
}
function bird(ctx, x, y, s, color) {
  return path(ctx, `M${x - 10 * s} ${y} Q${x - 4 * s} ${y - 8 * s} ${x} ${y - 2 * s} Q${x + 4 * s} ${y - 8 * s} ${x + 10 * s} ${y}`,
    {stroke:color, strokeWidth:2.2});
}
function roundTree(ctx, x, baseY, s, color, trunk) {
  const edge = mix(color, ctx.ink, 0.3);
  let out = line(ctx, x, baseY, x, baseY - 34 * s, {stroke:trunk, strokeWidth:3.4});
  out += circle(ctx, x, baseY - 52 * s, 23 * s, {fill:color, stroke:edge, strokeWidth:2.0, roughness:0.8});
  out += circle(ctx, x - 17 * s, baseY - 42 * s, 15 * s, {fill:color, stroke:edge, strokeWidth:2.0, roughness:0.8});
  out += circle(ctx, x + 17 * s, baseY - 44 * s, 14 * s, {fill:color, stroke:edge, strokeWidth:2.0, roughness:0.8});
  return out;
}
function pine(ctx, x, baseY, s, color, trunk) {
  const edge = mix(color, ctx.ink, 0.3);
  let out = line(ctx, x, baseY, x, baseY - 26 * s, {stroke:trunk, strokeWidth:3});
  out += path(ctx, `M${x} ${baseY - 92 * s} L${x - 22 * s} ${baseY - 46 * s} L${x + 22 * s} ${baseY - 46 * s} Z`, {fill:color, stroke:edge, strokeWidth:1.8});
  out += path(ctx, `M${x} ${baseY - 70 * s} L${x - 27 * s} ${baseY - 22 * s} L${x + 27 * s} ${baseY - 22 * s} Z`, {fill:color, stroke:edge, strokeWidth:1.8});
  return out;
}
function grass(ctx, x, y, s, color) {
  return line(ctx, x, y, x - 5 * s, y - 11 * s, {stroke:color, strokeWidth:2}) +
    line(ctx, x, y, x + 1 * s, y - 14 * s, {stroke:color, strokeWidth:2}) +
    line(ctx, x, y, x + 7 * s, y - 9 * s, {stroke:color, strokeWidth:2});
}
function turbine(ctx, x, baseY, h, color) {
  let out = line(ctx, x, baseY, x, baseY - h, {stroke:color, strokeWidth:3.2});
  out += circle(ctx, x, baseY - h, 5, {fill:color, stroke:'none'});
  for (let i = 0; i < 3; i++) {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / 3;
    out += line(ctx, x, baseY - h,
      x + Math.cos(angle) * h * 0.42, baseY - h + Math.sin(angle) * h * 0.42,
      {stroke:color, strokeWidth:2.6});
  }
  return out;
}

function drawBackground(ctx, scene) {
  const c = backgroundColors(scene);
  const variant = scene.background;
  // 风景也带一层墨线，和前景线稿用同一套画法，避免“贴纸感”。
  const edge = fill => mix(fill, ctx.ink, 0.55);
  let out = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${c.skyTop}"/><stop offset="0.74" stop-color="${c.skyBottom}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  out += sun(ctx, variant === 'sea' ? 1080 : 1118, variant === 'sea' ? 104 : 78, 38, c.sun);
  out += cloud(ctx, 170, 78, 1, c.cloud);
  out += cloud(ctx, 430, 52, 0.72, c.cloud);
  out += cloud(ctx, 742, 96, 0.82, c.cloud);

  if (variant === 'hills') {
    out += path(ctx, 'M0 252 Q150 192 320 238 T640 232 T960 246 T1200 222 L1200 340 L0 340 Z', {fill:c.far, stroke:edge(c.far, 0.3), strokeWidth:2.2, roughness:1, opacity:0.82});
    out += path(ctx, 'M0 282 Q180 226 380 268 T760 258 T1120 274 T1200 255 L1200 340 L0 340 Z', {fill:c.mid, stroke:edge(c.mid, 0.32), strokeWidth:2.2, roughness:1});
    out += path(ctx, 'M0 316 Q220 272 460 306 T900 296 T1200 312 L1200 340 L0 340 Z', {fill:c.near, stroke:edge(c.near, 0.34), strokeWidth:2.2, roughness:1});
    out += roundTree(ctx, 36, 306, 0.85, c.near, '#8A6A45');
    out += roundTree(ctx, 1148, 304, 0.75, c.near, '#8A6A45');
    out += grass(ctx, 330, 330, 1, '#6F8A62') + grass(ctx, 470, 326, 0.8, '#6F8A62') + grass(ctx, 890, 328, 0.9, '#6F8A62');
  } else if (variant === 'mountains') {
    out += path(ctx, 'M0 274 L110 176 L205 236 L320 150 L430 238 L520 188 L640 250 L760 168 L880 236 L990 190 L1110 248 L1200 214 L1200 340 L0 340 Z',
      {fill:c.far, stroke:edge(c.far, 0.3), strokeWidth:2.2, roughness:0.9, opacity:0.78});
    out += path(ctx, 'M0 302 L150 238 L270 292 L390 224 L520 294 L650 242 L780 298 L900 240 L1040 296 L1160 252 L1200 282 L1200 340 L0 340 Z',
      {fill:c.mid, stroke:edge(c.mid, 0.32), strokeWidth:2.2, roughness:0.9});
    out += path(ctx, 'M320 150 L300 174 L324 168 L338 178 Z', {fill:c.white, stroke:'none', opacity:0.78});
    out += path(ctx, 'M760 168 L742 190 L764 184 L778 192 Z', {fill:c.white, stroke:'none', opacity:0.72});
    out += pine(ctx, 62, 332, 0.95, c.near, '#8A6A45') + pine(ctx, 1120, 330, 0.9, c.near, '#8A6A45');
    out += grass(ctx, 410, 330, 0.9, '#6F8A62') + grass(ctx, 850, 330, 0.8, '#6F8A62');
  } else if (variant === 'sea') {
    out += path(ctx, 'M0 210 Q90 190 180 208 Q260 222 340 208 L340 300 L0 300 Z', {fill:c.far, stroke:edge(c.far, 0.3), strokeWidth:2.2, roughness:0.9, opacity:0.72});
    out += `<rect x="0" y="210" width="${W}" height="90" fill="${c.water}" opacity="0.9"/>`;
    out += line(ctx, 0, 210, W, 210, {stroke:mix(c.water, ctx.ink, 0.32), strokeWidth:2.2});
    for (let i = 0; i < 4; i++) {
      out += path(ctx, `M${70 + i * 280} ${232 + i * 15} Q${140 + i * 280} ${222 + i * 15} ${210 + i * 280} ${232 + i * 15} T${350 + i * 280} ${232 + i * 15}`,
        {stroke:mix(c.water, '#ffffff', 0.35), strokeWidth:2.2, opacity:0.6});
    }
    out += line(ctx, 1080, 154, 1080, 208, {stroke:c.sun, strokeWidth:3, opacity:0.5});
    out += path(ctx, 'M700 218 L700 268 L748 268 Z', {fill:c.white, stroke:'none', opacity:0.95});
    out += path(ctx, 'M704 220 L704 260 L738 260 Z', {fill:c.warm, stroke:'none', opacity:0.7});
    out += line(ctx, 700, 216, 700, 274, {stroke:ctx.ink, strokeWidth:2.4});
    out += path(ctx, 'M684 274 Q700 284 758 274 L748 268 L700 268 Z', {fill:c.dark, stroke:'none'});
  } else if (variant === 'forest') {
    out += path(ctx, 'M0 258 Q180 198 360 244 T720 234 T1080 250 T1200 228 L1200 340 L0 340 Z', {fill:c.far, stroke:edge(c.far, 0.3), strokeWidth:2.2, roughness:1, opacity:0.78});
    out += path(ctx, 'M0 300 Q240 252 480 292 T960 284 T1200 300 L1200 340 L0 340 Z', {fill:c.mid, stroke:edge(c.mid, 0.32), strokeWidth:2.2, roughness:1});
    for (const [x, s] of [[32,1.05],[92,0.8],[153,0.92],[1156,1],[1092,0.78],[1034,0.9]]) {
      out += pine(ctx, x, 332, s, mix(c.near, c.mid, 0.35), '#8A6A45');
    }
    out += grass(ctx, 390, 330, 0.9, '#6F8A62') + grass(ctx, 800, 330, 0.8, '#6F8A62');
  } else if (variant === 'city') {
    const farBuildings = [[16,226,64,108],[88,246,54,88],[150,208,72,126],[230,236,58,98],[920,216,70,118],[998,242,54,92],[1060,204,74,130],[1142,238,48,96]];
    for (const [x, y, w, h] of farBuildings) {
      out += rect(ctx, x, y, w, h, {fill:c.far, stroke:edge(c.far, 0.3), strokeWidth:2.0, roughness:0.9, opacity:0.75});
      for (let wy = y + 14; wy < y + h - 12; wy += 22) {
        for (let wx = x + 12; wx < x + w - 10; wx += 20) {
          out += `<rect x="${wx}" y="${wy}" width="7" height="9" fill="${c.warm}" opacity="0.5"/>`;
        }
      }
    }
    out += rect(ctx, 0, 330, W, 10, {fill:c.dark, stroke:'none', opacity:0.8});
  } else if (variant === 'industrial') {
    out += path(ctx, 'M0 300 Q240 246 480 288 T960 280 T1200 296 L1200 340 L0 340 Z', {fill:c.mid, stroke:edge(c.mid, 0.32), strokeWidth:2.2, roughness:1, opacity:0.8});
    // 左侧厂房
    out += rect(ctx, 10, 252, 190, 78, {fill:c.far, stroke:edge(c.far, 0.3), strokeWidth:2.0, roughness:0.9});
    out += path(ctx, 'M28 252 L60 224 L92 252 Z M108 252 L140 224 L172 252 Z', {fill:c.far, stroke:edge(c.far, 0.3), strokeWidth:2.0, roughness:0.8});
    out += rect(ctx, 42, 182, 18, 70, {fill:c.dark, stroke:'none'});
    for (let i = 0; i < 3; i++) out += circle(ctx, 50 + i * 4, 166 - i * 16, 12 + i * 4, {fill:c.cloud, stroke:'none', opacity:0.65 - i * 0.12});
    // 右侧厂房
    out += rect(ctx, 1000, 260, 190, 70, {fill:c.far, stroke:edge(c.far, 0.3), strokeWidth:2.0, roughness:0.9});
    out += path(ctx, 'M1018 260 L1050 232 L1082 260 Z M1098 260 L1130 232 L1162 260 Z', {fill:c.far, stroke:edge(c.far, 0.3), strokeWidth:2.0, roughness:0.8});
    // 电塔和电线
    out += line(ctx, 430, 330, 430, 176, {stroke:c.dark, strokeWidth:3.2});
    out += line(ctx, 400, 206, 460, 206, {stroke:c.dark, strokeWidth:3});
    out += line(ctx, 410, 232, 450, 232, {stroke:c.dark, strokeWidth:2.6});
    out += path(ctx, 'M430 176 Q560 214 1000 196', {stroke:c.dark, strokeWidth:2, opacity:0.6});
    out += path(ctx, 'M430 176 Q300 206 200 190', {stroke:c.dark, strokeWidth:2, opacity:0.6});
    out += line(ctx, 416, 300, 430, 252, {stroke:c.dark, strokeWidth:2, opacity:0.6});
    out += line(ctx, 444, 300, 430, 252, {stroke:c.dark, strokeWidth:2, opacity:0.6});
  } else if (variant === 'fields') {
    out += path(ctx, 'M0 266 Q200 220 400 258 T800 250 T1200 264 L1200 340 L0 340 Z', {fill:c.far, stroke:edge(c.far, 0.3), strokeWidth:2.2, roughness:1, opacity:0.8});
    out += path(ctx, 'M0 292 Q240 252 480 286 T960 280 T1200 292 L1200 340 L0 340 Z', {fill:c.mid, stroke:edge(c.mid, 0.32), strokeWidth:2.2, roughness:1});
    out += path(ctx, 'M0 318 Q260 288 520 314 T1040 308 T1200 316 L1200 340 L0 340 Z', {fill:c.near, stroke:edge(c.near, 0.34), strokeWidth:2.2, roughness:1});
    out += turbine(ctx, 60, 328, 92, c.dark);
    out += turbine(ctx, 450, 330, 80, c.dark);
    out += turbine(ctx, 1150, 328, 86, c.dark);
    for (let i = 0; i < 5; i++) {
      out += path(ctx, `M${40 + i * 240} 330 Q${140 + i * 240} 318 ${240 + i * 240} 330`, {stroke:mix(c.near, ctx.ink, 0.25), strokeWidth:1.8, opacity:0.5});
    }
  }

  for (const [x, y, s] of [[300, 50, 1], [360, 34, 0.8], [920, 36, 0.9], [980, 24, 0.7]]) {
    out += bird(ctx, x, y, s, mix(ctx.ink, c.far, 0.2));
  }

  // 前景桌面：给卡片对象一个稳定的浅色落点；海景抬高桌面，避免对象像站在水里
  const deskTop = variant === 'sea' ? 300 : 334;
  out += `<rect x="0" y="${deskTop}" width="${W}" height="${H - deskTop}" fill="${scene.paper}" opacity="0.96"/>`;
  out += line(ctx, 16, deskTop, W - 16, deskTop, {stroke:'#B98A52', strokeWidth:2.2, opacity:0.5});
  return out;
}

function roundedTop(x, y, w, h, r = 7) {
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + h} L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} ` +
    `L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${y + h} Z`;
}
function leaf(ctx, x, y, len, width, angle, color, opacity = 0.85) {
  const rad = angle * Math.PI / 180;
  const ex = x + Math.cos(rad) * len, ey = y + Math.sin(rad) * len;
  const nx = Math.cos(rad + Math.PI / 2) * width, ny = Math.sin(rad + Math.PI / 2) * width;
  const dx = ex - x, dy = ey - y;
  return path(ctx,
    `M${x} ${y} Q${x + dx * .42 + nx} ${y + dy * .42 + ny} ${ex} ${ey} ` +
    `Q${x + dx * .58 - nx} ${y + dy * .58 - ny} ${x} ${y} Z`,
    {fill:color, stroke:mix(color, ctx.ink, .28), strokeWidth:1.4, opacity});
}
function ruleColor(ctx, base) { return mix(ctx.ink, base || ctx.paper, .55); }

const DRAW = {
  document(ctx, o) {
    const x = o.x ?? 470, y = o.y ?? 50, w = o.width ?? 230, h = o.height ?? 290;
    const lines = Math.min(14, Math.max(1, o.lines ?? 8));
    const checks = Math.min(lines, Math.max(0, o.checks ?? 0));
    const marks = Math.min(lines, Math.max(0, o.marks ?? 0));
    const paper = ctx.paper, rule = ruleColor(ctx, paper);
    const fold = Math.min(38, w * .18);
    let out = rect(ctx, x, y, w, h, {fill:paper, strokeWidth:2.6});
    out += path(ctx, `M${x + w - fold} ${y} L${x + w} ${y + fold} L${x + w - fold} ${y + fold} Z`,
      {fill:mix(paper, ctx.ink, .15), strokeWidth:2.1});
    out += line(ctx, x + w - fold, y + 2, x + w - 2, y + fold, {stroke:rule, strokeWidth:1.6, opacity:.65});
    // 纸张顶部的小色块和标题线，避免整页看起来像空白表格。
    out += rect(ctx, x + 22, y + 24, Math.min(58, w * .28), 9, {fill:ctx.scene.accent, stroke:'none', roughness:.4});
    out += line(ctx, x + 22, y + 45, x + w * .47, y + 45, {stroke:rule, strokeWidth:2.1, opacity:.8});
    const top = y + 68, bottom = y + h - 30;
    const step = (bottom - top) / Math.max(1, lines - 1);
    const lengths = [.82,.56,.74,.64,.86,.52,.7,.6,.78,.55,.68,.62,.8,.58];
    for (let i = 0; i < lines; i++) {
      const rowY = top + step * i;
      const checked = i < checks;
      const lineX = x + (checked ? 46 : 24);
      const lineW = (w - (lineX - x) - 26) * lengths[i % lengths.length];
      if (checked) {
        out += rect(ctx, x + 21, rowY - 7, 14, 14, {fill:paper, strokeWidth:1.9});
        out += path(ctx, `M${x + 25} ${rowY} L${x + 28} ${rowY + 4} L${x + 34} ${rowY - 6}`, {stroke:ctx.scene.green, strokeWidth:2.4});
      }
      out += line(ctx, lineX, rowY, lineX + lineW, rowY, {stroke:rule, strokeWidth:2.2});
    }
    if (marks) {
      const picks = marks === 1 ? [Math.min(2, lines - 1)] : [1, Math.min(3, lines - 1)];
      for (const i of picks) {
        const rowY = top + step * i;
        const lineX = x + 22;
        const lineW = (w - 46) * lengths[i % lengths.length];
        out += `<g transform="rotate(-2 ${lineX + lineW / 2} ${rowY})">` +
          ellipse(ctx, lineX + lineW / 2, rowY, lineW / 2 + 9, 13, {stroke:ctx.scene.accent, strokeWidth:3.2}) + '</g>';
      }
    }
    out += path(ctx, `M${x} ${y + h - 18} Q${x + 12} ${y + h - 5} ${x + 24} ${y + h} L${x} ${y + h} Z`,
      {fill:mix(paper, ctx.ink, .09), stroke:'none'});
    return out;
  },

  cabinet(ctx, o) {
    const x = o.x ?? 80, y = o.y ?? 58, w = o.width ?? 300, h = o.height ?? 286;
    const panel = mix(ctx.paper, ctx.scene.sky, .4);
    let out = rect(ctx, x, y, w, h, {fill:ctx.paper, strokeWidth:2.6});
    out += rect(ctx, x + 14, y + 14, w - 28, h - 28, {fill:panel, strokeWidth:1.9, roughness:1.05});
    const sx = x + 28, sy = y + 26, sw = w - 56, sh = Math.min(54, h * .24);
    out += rect(ctx, sx, sy, sw, sh, {fill:'#2F3B3A', strokeWidth:1.9});
    for (let i = 0; i < 3; i++) {
      out += line(ctx, sx + 12, sy + 14 + i * 13, sx + 12 + sw * (.62 - i * .09), sy + 14 + i * 13,
        {stroke:'#8FD3C7', strokeWidth:2.5});
    }
    const lamps = [ctx.scene.green, ctx.scene.gold, ctx.scene.accent];
    for (let i = 0; i < 3; i++) {
      out += circle(ctx, x + 34 + i * 20, sy + sh + 16, 6, {fill:lamps[i], strokeWidth:1.3});
    }
    const colors = [ctx.scene.blue, ctx.scene.accent, ctx.scene.green];
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const bx = x + 30 + col * ((w - 60) / 3), by = sy + sh + 34 + row * 40;
        out += rect(ctx, bx, by, 18, 28, {fill:ctx.paper, strokeWidth:1.5});
        out += line(ctx, bx + 9, by + 5, bx + 9, by + 16, {stroke:colors[col], strokeWidth:2.3});
        out += circle(ctx, bx + 9, by + 22, 2.2, {fill:colors[col], stroke:'none'});
      }
    }
    out += line(ctx, x + w - 20, y + h * .45, x + w - 20, y + h * .61, {stroke:ctx.ink, strokeWidth:2.1});
    out += circle(ctx, x + w - 20, y + h * .45, 2.8, {fill:ctx.ink, stroke:'none'});
    for (let i = 0; i < 3; i++) {
      out += line(ctx, x + 26, y + h - 34 + i * 8, x + w - 26, y + h - 34 + i * 8,
        {stroke:mix(ctx.ink, panel, .45), strokeWidth:1.7});
    }
    return out;
  },

  magnifier(ctx, o) {
    const cx = o.x ?? 796, cy = o.y ?? 168, r = o.r ?? 57, R = r / 2;
    const rim = mix(ctx.scene.blue, ctx.ink, .3);
    const handle = mix(ctx.scene.gold, ctx.ink, .28);
    let out = circle(ctx, cx, cy, r, {fill:mix(ctx.scene.sky, '#ffffff', .55), stroke:rim, strokeWidth:3.2});
    out += circle(ctx, cx, cy, r - 6, {stroke:mix(rim, ctx.paper, .45), strokeWidth:1.4, roughness:.8});
    out += path(ctx, `M${cx - R * .56} ${cy - R * .3} Q${cx - R * .18} ${cy - R * .7} ${cx + R * .2} ${cy - R * .58}`,
      {stroke:'#FFFFFF', strokeWidth:5, opacity:.9});
    const hx = cx + R * .72, hy = cy + R * .72;
    out += line(ctx, hx, hy, hx + 14, hy + 14, {stroke:rim, strokeWidth:15});
    out += line(ctx, hx + 12, hy + 12, hx + 62, hy + 62, {stroke:handle, strokeWidth:12});
    out += circle(ctx, hx + 62, hy + 62, 6, {fill:handle, strokeWidth:1.6});
    return out;
  },

  badge(ctx, o) {
    const cx = o.x ?? 962, cy = o.y ?? 96, r = o.r ?? 40, k = r / 80;
    return circle(ctx, cx, cy, r, {fill:ctx.scene.accent, strokeWidth:2.6}) +
      circle(ctx, cx, cy, r * .86, {stroke:mix(ctx.scene.accent, '#ffffff', .45), strokeWidth:1.3, roughness:.7}) +
      path(ctx, `M${cx - 20 * k} ${cy} L${cx - 6 * k} ${cy + 14 * k} L${cx + 23 * k} ${cy - 17 * k}`, {stroke:ctx.paper, strokeWidth:8 * k});
  },

  cup(ctx, o) {
    const x = o.x ?? 1002, y = o.y ?? 252, w = o.width ?? 58, h = o.height ?? 74;
    const band = ctx.scene.blue;
    let out = path(ctx, `M${x} ${y} Q${x + 2} ${y + h * .58} ${x + 8} ${y + h} L${x + w - 8} ${y + h} ` +
      `Q${x + w - 2} ${y + h * .58} ${x + w} ${y} Z`, {fill:ctx.paper, strokeWidth:2.5});
    out += ellipse(ctx, x + w / 2, y + 1, w - 2, 10, {fill:mix(ctx.paper, '#ffffff', .45), strokeWidth:1.8});
    out += path(ctx, `M${x + 3} ${y + h * .62} Q${x + w / 2} ${y + h * .7} ${x + w - 3} ${y + h * .62}`,
      {stroke:band, strokeWidth:5, opacity:.82});
    out += path(ctx, `M${x + w} ${y + 15} Q${x + w + 26} ${y + 15} ${x + w + 26} ${y + h * .5} ` +
      `Q${x + w + 26} ${y + h - 12} ${x + w} ${y + h - 12}`, {stroke:ctx.ink, strokeWidth:3.2});
    for (const dx of [18, 37]) {
      out += path(ctx, `M${x + dx} ${y - 12} C${x + dx - 10} ${y - 27} ${x + dx + 10} ${y - 33} ${x + dx} ${y - 48}`,
        {stroke:'#B98A52', strokeWidth:2.3, opacity:.8});
    }
    return out;
  },

  speech(ctx, o) {
    const x = o.x ?? 450, y = o.y ?? 70, w = o.width ?? 220, h = o.height ?? 150;
    const fill = o.color || ctx.paper;
    const rule = lum(fill) > .45 ? mix(ctx.ink, fill, .55) : mix(ctx.paper, '#ffffff', .35);
    const r = 16, tailX = x + 52, tailY = y + h;
    let out = path(ctx,
      `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} ` +
      `L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} ` +
      `L${tailX + 26} ${tailY} Q${tailX + 6} ${tailY + 22} ${tailX} ${tailY + 24} ` +
      `L${tailX} ${tailY} L${x + r} ${tailY} Q${x} ${tailY} ${x} ${tailY - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`,
      {fill, strokeWidth:2.6});
    const mark = lum(fill) > .45 ? ctx.scene.accent : mix(ctx.paper, '#ffffff', .3);
    out += path(ctx, `M${x + 22} ${y + 26} Q${x + 28} ${y + 30} ${x + 24} ${y + 38}`, {stroke:mark, strokeWidth:2.6, opacity:.9});
    out += path(ctx, `M${x + 34} ${y + 26} Q${x + 40} ${y + 30} ${x + 36} ${y + 38}`, {stroke:mark, strokeWidth:2.6, opacity:.9});
    const lines = Math.min(6, Math.max(1, o.lines ?? 3));
    for (let i = 0; i < lines; i++) {
      out += line(ctx, x + 24, y + 52 + i * 22, x + w - 26 - (i % 2) * 34, y + 52 + i * 22, {stroke:rule, strokeWidth:2.2});
    }
    return out;
  },

  globe(ctx, o) {
    const cx = o.x ?? 848, cy = o.y ?? 150, r = o.r ?? 68, R = r / 2;
    const rim = mix(ctx.scene.blue, ctx.ink, .28);
    let out = circle(ctx, cx, cy, r, {fill:mix(ctx.scene.sky, '#ffffff', .5), stroke:rim, strokeWidth:3});
    const grid = mix(rim, ctx.ink, .12);
    out += ellipse(ctx, cx, cy, R * .84, R * 1.88, {stroke:grid, strokeWidth:2, roughness:.8, opacity:.85});
    out += ellipse(ctx, cx, cy, R * 1.76, R * .64, {stroke:grid, strokeWidth:1.9, roughness:.8, opacity:.8});
    out += line(ctx, cx - R * .94, cy, cx + R * .94, cy, {stroke:grid, strokeWidth:1.7, opacity:.7});
    const land = mix(ctx.scene.green, ctx.ink, .08);
    out += path(ctx, `M${cx - R * .55} ${cy - R * .3} Q${cx - R * .3} ${cy - R * .52} ${cx - R * .02} ${cy - R * .42} ` +
      `Q${cx + R * .22} ${cy - R * .34} ${cx + R * .12} ${cy - R * .02} ` +
      `Q${cx + R * .02} ${cy + R * .2} ${cx - R * .24} ${cy + R * .12} ` +
      `Q${cx - R * .5} ${cy + R * .04} ${cx - R * .55} ${cy - R * .3} Z`,
      {fill:land, stroke:'none', opacity:.72});
    out += path(ctx, `M${cx + R * .18} ${cy + R * .2} Q${cx + R * .4} ${cy + R * .1} ${cx + R * .52} ${cy + R * .34} ` +
      `Q${cx + R * .34} ${cy + R * .48} ${cx + R * .16} ${cy + R * .38} Z`,
      {fill:land, stroke:'none', opacity:.62});
    out += path(ctx, `M${cx - R * .42} ${cy + R * .4} Q${cx - R * .28} ${cy + R * .34} ${cx - R * .2} ${cy + R * .48} ` +
      `Q${cx - R * .3} ${cy + R * .56} ${cx - R * .42} ${cy + R * .5} Z`,
      {fill:land, stroke:'none', opacity:.55});
    out += path(ctx, `M${cx - R * .52} ${cy - R * .44} Q${cx - R * .3} ${cy - R * .62} ${cx - R * .16} ${cy - R * .5}`,
      {stroke:'#FFFFFF', strokeWidth:3.4, opacity:.8});
    return out;
  },

  presentation(ctx, o) {
    const x = o.x ?? 80, y = o.y ?? 48, w = o.width ?? 340, h = o.height ?? 218;
    let out = rect(ctx, x, y, w, h, {fill:ctx.paper, strokeWidth:2.8});
    out += rect(ctx, x + 12, y + 12, w - 24, h - 24, {fill:mix(ctx.scene.sky, '#ffffff', .38), strokeWidth:1.8});
    out += line(ctx, x + 28, y + 30, x + w * .46, y + 30, {stroke:ruleColor(ctx), strokeWidth:2.3});
    const baseY = y + h - 34;
    const bars = [.4, .64, .5, .8];
    const colors = [ctx.scene.blue, ctx.scene.accent, ctx.scene.green, ctx.scene.gold];
    const maxH = baseY - (y + 54), bw = Math.min(34, (w - 80) / 4 - 12), gap = (w - 76 - bw * 4) / 3;
    const tops = [];
    for (let i = 0; i < bars.length; i++) {
      const bh = maxH * bars[i], bx = x + 38 + i * (bw + gap);
      out += path(ctx, roundedTop(bx, baseY - bh, bw, bh, 6), {fill:colors[i], strokeWidth:1.7});
      tops.push([bx + bw / 2, baseY - bh]);
    }
    out += line(ctx, x + 26, baseY, x + w - 26, baseY, {stroke:ctx.ink, strokeWidth:2.3});
    out += path(ctx, `M${tops[0][0]} ${tops[0][1]} L${tops[1][0]} ${tops[1][1]} L${tops[2][0]} ${tops[2][1]} L${tops[3][0]} ${tops[3][1]}`,
      {stroke:ctx.scene.accent, strokeWidth:2.8, roughness:.7});
    for (const [px, py] of tops) out += circle(ctx, px, py, 3.4, {fill:ctx.scene.accent, stroke:'none'});
    out += rect(ctx, x + w - 58, y + 16, 34, 26, {fill:ctx.scene.gold, strokeWidth:1.4, opacity:.9});
    out += line(ctx, x + w - 50, y + 29, x + w - 34, y + 29, {stroke:mix(ctx.ink, ctx.scene.gold, .45), strokeWidth:1.7});
    out += line(ctx, x + w * .36, y + h, x + w * .3, y + h + 56, {stroke:ctx.ink, strokeWidth:3});
    out += line(ctx, x + w * .64, y + h, x + w * .7, y + h + 56, {stroke:ctx.ink, strokeWidth:3});
    out += line(ctx, x + w * .3 - 11, y + h + 56, x + w * .3 + 11, y + h + 56, {stroke:ctx.ink, strokeWidth:3});
    out += line(ctx, x + w * .7 - 11, y + h + 56, x + w * .7 + 11, y + h + 56, {stroke:ctx.ink, strokeWidth:3});
    return out;
  },

  book(ctx, o) {
    const x = o.x ?? 486, y = o.y ?? 196, w = o.width ?? 210, h = o.height ?? 122;
    const cx = x + w / 2, rule = ruleColor(ctx);
    let out = path(ctx, `M${cx} ${y + 8} Q${cx - 22} ${y - 5} ${x} ${y + 4} L${x} ${y + h} Q${cx - 22} ${y + h + 10} ${cx} ${y + h - 4} Z`,
      {fill:ctx.paper, strokeWidth:2.5});
    out += path(ctx, `M${cx} ${y + 8} Q${cx + 22} ${y - 5} ${x + w} ${y + 4} L${x + w} ${y + h} Q${cx + 22} ${y + h + 10} ${cx} ${y + h - 4} Z`,
      {fill:ctx.paper, strokeWidth:2.5});
    out += line(ctx, x + 8, y + 8, x + 8, y + h - 4, {stroke:mix(ctx.ink, ctx.paper, .6), strokeWidth:1.5, opacity:.7});
    out += line(ctx, x + w - 8, y + 8, x + w - 8, y + h - 4, {stroke:mix(ctx.ink, ctx.paper, .6), strokeWidth:1.5, opacity:.7});
    out += line(ctx, cx, y + 6, cx, y + h - 6, {stroke:'#B98A52', strokeWidth:2.4});
    const lengths = [.72, .86, .6];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const from = cx + side * 20, to = cx + side * (w / 2 - 22) * lengths[i];
        out += line(ctx, from, y + 32 + i * 21, to, y + 32 + i * 21, {stroke:rule, strokeWidth:2.2});
      }
    }
    out += rect(ctx, x + w * .62, y + h - 36, 26, 20, {fill:ctx.scene.gold, strokeWidth:1.3, opacity:.85});
    out += path(ctx, `M${cx + 24} ${y - 2} L${cx + 24} ${y + 38} L${cx + 40} ${y + 30} L${cx + 56} ${y + 40} L${cx + 56} ${y - 2} Z`,
      {fill:ctx.scene.accent, strokeWidth:1.8});
    return out;
  },

  chart(ctx, o) {
    const x = o.x ?? 86, y = o.y ?? 62, w = o.width ?? 330, h = o.height ?? 250;
    const rule = ruleColor(ctx);
    let out = line(ctx, x, y + 18, x, y + h, {stroke:ctx.ink, strokeWidth:2.8});
    out += line(ctx, x, y + h, x + w, y + h, {stroke:ctx.ink, strokeWidth:2.8});
    out += line(ctx, x + 12, y + 14, x + 66, y + 14, {stroke:rule, strokeWidth:2.2});
    out += line(ctx, x + 12, y + 26, x + 48, y + 26, {stroke:rule, strokeWidth:2.2, opacity:.75});
    for (let i = 1; i <= 3; i++) {
      out += line(ctx, x - 5, y + h - i * h / 4, x + 4, y + h - i * h / 4, {stroke:rule, strokeWidth:1.6});
    }
    const bars = [.34, .58, .44, .78];
    const colors = [ctx.scene.blue, ctx.scene.accent, ctx.scene.green, ctx.scene.gold];
    const bw = Math.min(40, (w - 80) / 4 - 12), gap = (w - 70 - bw * 4) / 3;
    const tops = [];
    for (let i = 0; i < bars.length; i++) {
      const bh = h * bars[i], bx = x + 38 + i * (bw + gap);
      out += path(ctx, roundedTop(bx, y + h - bh, bw, bh, 6), {fill:colors[i], strokeWidth:1.7});
      tops.push([bx + bw / 2, y + h - bh]);
    }
    out += path(ctx, `M${tops[0][0]} ${tops[0][1]} L${tops[1][0]} ${tops[1][1]} L${tops[2][0]} ${tops[2][1]} L${tops[3][0]} ${tops[3][1]}`,
      {stroke:ctx.scene.accent, strokeWidth:2.6, roughness:.7});
    for (const [px, py] of tops) out += circle(ctx, px, py, 3.2, {fill:ctx.scene.accent, stroke:'none'});
    return out;
  },

  folder(ctx, o) {
    const x = o.x ?? 96, y = o.y ?? 96, w = o.width ?? 270, h = o.height ?? 206;
    const body = mix(ctx.scene.gold, ctx.paper, .5);
    const rule = ruleColor(ctx);
    let out = rect(ctx, x + 20, y - 8, w - 46, h - 14, {fill:ctx.paper, strokeWidth:1.8});
    out += line(ctx, x + 36, y + 10, x + w - 44, y + 10, {stroke:rule, strokeWidth:2, opacity:.8});
    out += line(ctx, x + 36, y + 24, x + w * .62, y + 24, {stroke:rule, strokeWidth:2, opacity:.65});
    out += path(ctx, `M${x} ${y + 18} L${x + w * .34} ${y + 18} L${x + w * .43} ${y} L${x + w} ${y} L${x + w} ${y + h} L${x} ${y + h} Z`,
      {fill:body, strokeWidth:2.4});
    out += path(ctx, `M${x + 8} ${y + h * .32} L${x + w - 8} ${y + h * .45} L${x + w - 8} ${y + h - 6} L${x + 8} ${y + h - 6} Z`,
      {fill:mix(body, '#ffffff', .18), strokeWidth:1.7});
    out += rect(ctx, x + 24, y + h * .48, Math.min(92, w * .4), 24, {fill:ctx.paper, strokeWidth:1.4});
    out += line(ctx, x + 34, y + h * .48 + 12, x + 64, y + h * .48 + 12, {stroke:ctx.scene.accent, strokeWidth:2.2});
    out += circle(ctx, x + w - 30, y + h * .64, 4, {fill:ctx.paper, strokeWidth:1.4});
    out += line(ctx, x + w - 30, y + h * .64, x + w - 8, y + h * .78, {stroke:mix(ctx.ink, body, .35), strokeWidth:1.7});
    return out;
  },

  person(ctx, o) {
    const x = o.x ?? 170, y = o.y ?? 104, s = o.scale ?? 1;
    const color = o.color || o.fill || ctx.scene.accent;
    let out = circle(ctx, x, y, 52 * s, {fill:ctx.paper, strokeWidth:2.4});
    out += path(ctx, `M${x - 40 * s} ${y + 128 * s} L${x - 40 * s} ${y + 92 * s} Q${x - 38 * s} ${y + 30 * s} ${x} ${y + 20 * s} Q${x + 38 * s} ${y + 30 * s} ${x + 40 * s} ${y + 92 * s} L${x + 40 * s} ${y + 128 * s} Z`,
      {fill:color, strokeWidth:2.6});
    out += path(ctx, `M${x - 10 * s} ${y + 38 * s} L${x} ${y + 54 * s} L${x + 10 * s} ${y + 38 * s}`,
      {stroke:ctx.paper, strokeWidth:2.4, opacity:.9});
    out += line(ctx, x - 8 * s, y + 42 * s, x + 2 * s, y + 74 * s, {stroke:ctx.paper, strokeWidth:1.8, opacity:.75});
    out += line(ctx, x + 8 * s, y + 42 * s, x - 2 * s, y + 74 * s, {stroke:ctx.paper, strokeWidth:1.8, opacity:.75});
    out += rect(ctx, x - 4 * s, y + 76 * s, 16 * s, 11 * s, {fill:ctx.paper, strokeWidth:1.2});
    out += path(ctx, `M${x - 39 * s} ${y + 98 * s} Q${x - 58 * s} ${y + 112 * s} ${x - 67 * s} ${y + 132 * s}`,
      {stroke:ctx.ink, strokeWidth:2.8});
    out += path(ctx, `M${x + 39 * s} ${y + 98 * s} Q${x + 58 * s} ${y + 112 * s} ${x + 67 * s} ${y + 132 * s}`,
      {stroke:ctx.ink, strokeWidth:2.8});
    out += circle(ctx, x - 68 * s, y + 134 * s, 8 * s, {fill:ctx.paper, strokeWidth:1.8});
    out += circle(ctx, x + 68 * s, y + 134 * s, 8 * s, {fill:ctx.paper, strokeWidth:1.8});
    return out;
  },

  arrow(ctx, o) {
    const x1 = o.x1 ?? 300, y1 = o.y1 ?? 200, x2 = o.x2 ?? 440, y2 = o.y2 ?? 180;
    const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - 34;
    let out = path(ctx, `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`, {stroke:ctx.scene.accent, strokeWidth:3.2});
    out += line(ctx, x2, y2, x2 - 14, y2 - 1, {stroke:ctx.scene.accent, strokeWidth:3.2});
    out += line(ctx, x2, y2, x2 - 4, y2 - 14, {stroke:ctx.scene.accent, strokeWidth:3.2});
    out += circle(ctx, x1, y1, 3.2, {fill:ctx.scene.accent, stroke:'none'});
    return out;
  },

  plant(ctx, o) {
    const x = o.x ?? 766, y = o.y ?? 258, w = o.width ?? 64, h = o.height ?? 82;
    const pot = mix(ctx.scene.accent, ctx.scene.gold, .45);
    const green = ctx.scene.green, light = mix(green, ctx.scene.gold, .28);
    let out = path(ctx, `M${x} ${y + 12} L${x + w} ${y + 12} L${x + w - 8} ${y + h} L${x + 8} ${y + h} Z`,
      {fill:pot, strokeWidth:2.2});
    out += rect(ctx, x - 4, y, w + 8, 12, {fill:mix(pot, '#ffffff', .2), strokeWidth:2});
    out += line(ctx, x + 12, y + h - 12, x + w - 14, y + h - 12, {stroke:mix(pot, ctx.ink, .22), strokeWidth:1.4, opacity:.55});
    const cx = x + w / 2;
    out += path(ctx, `M${cx} ${y} C${cx - 22} ${y - 32} ${cx - 14} ${y - 58} ${cx + 2} ${y - 76}`,
      {stroke:green, strokeWidth:2.6});
    out += path(ctx, `M${cx} ${y - 2} C${cx + 26} ${y - 28} ${cx + 20} ${y - 52} ${cx + 12} ${y - 66}`,
      {stroke:green, strokeWidth:2.6});
    out += path(ctx, `M${cx - 2} ${y - 18} C${cx - 26} ${y - 26} ${cx - 30} ${y - 44} ${cx - 22} ${y - 54}`,
      {stroke:green, strokeWidth:2.4});
    out += leaf(ctx, cx + 2, y - 74, 22, 11, -38, light);
    out += leaf(ctx, cx + 12, y - 64, 20, 10, 26, green);
    out += leaf(ctx, cx - 22, y - 52, 19, 10, -128, green);
    out += leaf(ctx, cx - 4, y - 30, 17, 9, -156, light);
    return out;
  },

  sparkle(ctx, o) {
    const cx = o.x ?? 920, cy = o.y ?? 190, r = o.size ?? 26, color = o.color || ctx.scene.gold;
    const star = `M${cx} ${cy - r} Q${cx + r * .12} ${cy - r * .14} ${cx + r} ${cy} ` +
      `Q${cx + r * .12} ${cy + r * .14} ${cx} ${cy + r} ` +
      `Q${cx - r * .12} ${cy + r * .14} ${cx - r} ${cy} ` +
      `Q${cx - r * .12} ${cy - r * .14} ${cx} ${cy - r} Z`;
    return path(ctx, star, {fill:color, stroke:'none', roughness:.6}) +
      path(ctx, `M${cx + r * .8} ${cy - r * .8} l1 7 l7 1 l-7 1 l-1 7 l-1 -7 l-7 -1 l7 -1 Z`,
        {fill:mix(color, '#ffffff', .35), stroke:'none', roughness:.5});
  }
};

export function renderSketch(input) {
  const scene = normalizeScene(input);
  const ctx = makeContext(scene);
  const layers = [];
  const background = scene.background
    ? drawBackground(ctx, scene)
    : `<rect width="${W}" height="${H}" fill="${esc(scene.sky)}"/>`;
  // 桌面线
  layers.push(line(ctx, 28, DESK_Y, W - 28, DESK_Y, {stroke:'#B98A52', strokeWidth:4.2}));
  // 少量桌面阴影，避免画面“飘”在空中
  layers.push(hatch(ctx, 60, DESK_Y + 8, W - 120, 12, '#B98A52', 0.16));
  for (const [index, object] of scene.objects.entries()) {
    const draw = DRAW[object.kind];
    if (!draw) continue;
    const body = draw(ctx, object);
    // 每个对象轻微歪一点，避免排得像贴纸目录；角度由 kind+序号决定，重放一致。
    const flat = object.kind === 'arrow' || object.kind === 'sparkle';
    const angle = flat ? 0 : (hashSeed(`${object.kind}-${index}`) % 100 - 50) / 18;
    const cx = Number.isFinite(object.x) && Number.isFinite(object.width) ? object.x + object.width / 2 : object.x ?? 600;
    const cy = object.kind === 'person'
      ? (object.y ?? 104) + 60 * (object.scale ?? 1)
      : Number.isFinite(object.y) && Number.isFinite(object.height) ? object.y + object.height / 2 : object.y ?? 200;
    // 轻投影让前景和风景产生前后关系，不再像直接贴上去的白色贴纸。
    layers.push(flat ? body :
      `<g transform="rotate(${angle.toFixed(2)} ${cx.toFixed(1)} ${cy.toFixed(1)})" filter="url(#lift)">${body}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">` +
    `<defs><filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="7" result="n"/>` +
    `<feColorMatrix in="n" type="saturate" values="0"/>` +
    `<feComponentTransfer><feFuncA type="linear" slope="0.085"/></feComponentTransfer></filter>` +
    `<filter id="lift" x="-15%" y="-15%" width="130%" height="130%">` +
    `<feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#3F352B" flood-opacity="0.16"/></filter></defs>` +
    background +
    layers.join('') +
    `<rect width="${W}" height="${H}" filter="url(#paper)" opacity="0.7"/>` +
    `</svg>`;
}
