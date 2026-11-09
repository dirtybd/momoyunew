import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 站内智能体目录：公开 REST 接口 + 本地缓存 + 关键词检索。
// 不把用户原文发给门户，只读取公开目录；门户不可用时沿用旧缓存。
const DEFAULT_PORTAL = 'http://10.37.26.35:5173';
const CACHE_FILE = 'agent-catalog.json';
const ALIAS_FILE = 'agent-aliases.json';
const MAX_PRODUCTS = 200;

const STOP = new Set([
  '帮我', '一个', '可以', '怎么', '如何', '什么', '我们', '你们', '这个', '那个',
  '需要', '现在', '一下', '我的', '有没有', '能不能', '请问',
  '智能', '能体', '助手', '工具', '推荐', '别的', '其他', '其它', '哪些', '哪个',
  '服务', '平台', '系统',
]);

// 目录描述很短，关键词检索容易错配；这里给常见说法补一条优先级更高的别名。
const DEFAULT_ALIASES = [
  { all: ['制度'], any: ['诊断', '修订', '更新'], agent: '制度诊断和修订AI助手' },
  { all: ['制度'], any: ['制定', '写', '起草', '编写', '新建'], agent: '新制度编写助手' },
  { all: ['制度'], any: ['审核', '审查'], agent: '新制度审核助手' },
  { all: ['制度'], any: ['宣贯', '解读', '培训'], agent: '制度宣贯助手' },
  { keywords: ['制度问答', '规章制度', '制度规定'], agent: '制度问答助手' },
  { keywords: ['差旅', '报销', '出差'], agent: '差旅制度问答助手' },
  { keywords: ['合同审核', '合同审查', '审核合同', '合同风险', '违约条款', '付款条款'], agent: '运行管理合同审核助手' },
  { keywords: ['查重', '相似度', '围标', '串标', '投标文件比对'], agent: '采购投标文件的相似度查询报告' },
  { keywords: ['供应商风险', '客商风险', '工商风险', '企业风险'], agent: '客商风险评估' },
  { keywords: ['股权', '关联关系', '工商查询', '关联公司'], agent: '客商关联关系查询' },
  { keywords: ['发票识别', '票据识别', '发票翻译', '境外票据', 'OCR'], agent: '境外票据识别翻译智能体' },
  { keywords: ['铭牌', '铭牌识别', '样品分类', '照片分类'], agent: '检测智眼' },
  { keywords: ['翻译文件', '文件翻译'], agent: '文件翻译助手' },
  { keywords: ['招聘', 'JD', '岗位描述', '招聘需求'], agent: '招聘需求编写助手' },
  { keywords: ['党建', '宣传稿', '新闻稿', '活动报道'], agent: '成套基层党业融合宣传员' },
  { keywords: ['报告审核', '检测报告', '报告质量'], agent: '报告智能审核' },
  { keywords: ['标准解读', '检测标准', '标准问答'], agent: '标准解读与智能检测助手' },
  { keywords: ['法规', '合格评定', '国际法规'], agent: '国际合格评定法规助手' },
  { keywords: ['合同纠纷', '买卖纠纷', '法务', '诉讼'], agent: '买卖纠纷法务风险助理' },
  { keywords: ['审稿', '稿件审核', '文字校对', '文稿'], agent: '电研文盾' },
  { keywords: ['AI点子', 'AI方案', '需求分析'], agent: 'AI需求分析' },
  { keywords: ['政策', '政策解读'], agent: '检策通NEW' },
  { keywords: ['写作', '写文章', '文案'], agent: 'AI 写作助手' },
  { keywords: ['物料编码', '物料检索', '采购物料'], agent: '成套AI物料编码与采购辅助工具' },
  { keywords: ['认证', '客服', '认证咨询'], agent: '威凯认证智能客服' },
  { keywords: ['重大决策', '决策合规'], agent: '威凯智治-重大决策合规全周期智能体' },
];

const explicitAsk = text => /(?:推荐|有没有|有哪些|哪个|其他|别的|其它|找找)[^。；\n]{0,16}(?:智能体|助手|工具|AI)|(?:智能体|助手)(?:广场|中心|市场)/i.test(text || '');
const unsupported = text => /(?:无法|不能|做不到|做不了|暂不支持|不支持|完成不了|实现不了|没有(?:相关|相应|对应)?(?:的)?(?:功能|工具|能力|权限)|超出[^。；\n]{0,10}(?:能力|范围)|需要(?:专门的?|专业的?)(?:助手|工具|智能体|系统)|建议(?:你)?(?:使用|前往|联系|咨询))/i.test(text || '');

export function tokenize(text = '') {
  const value = String(text).toLowerCase();
  const out = new Set();
  for (const word of value.match(/[a-z0-9][a-z0-9.+-]{1,}/g) || []) out.add(word);
  for (const run of value.match(/[一-鿿]+/g) || []) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i < run.length - 1; i++) {
      const bigram = run.slice(i, i + 2);
      if (!STOP.has(bigram)) out.add(bigram);
    }
  }
  return [...out];
}

export function scoreProduct(product, queryTokens) {
  const name = (product.name || '').toLowerCase();
  const description = (product.description || '').toLowerCase();
  const categories = (product.categories || []).map(item => typeof item === 'string' ? item : item?.name).filter(Boolean).join(' ').toLowerCase();
  let score = 0;
  let hits = 0;
  for (const token of queryTokens) {
    let weight = 0;
    if (name.includes(token)) weight += 6;
    if (description.includes(token)) weight += 3;
    if (categories.includes(token)) weight += 2;
    if (weight) { score += weight; hits += 1; }
  }
  if (hits >= 2) score *= 1.3;
  return { score, hits };
}

export function normalizeCatalog(payload) {
  const rows = Array.isArray(payload?.data?.content) ? payload.data.content : [];
  const seen = new Set();
  const products = [];
  for (const row of rows.slice(0, MAX_PRODUCTS)) {
    if (!row || typeof row.productId !== 'string') continue;
    if (row.type !== 'AGENT_API' || row.status !== 'PUBLISHED' || row.enabled === false) continue;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name || !/^product-[a-z0-9]+$/i.test(row.productId)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const icon = typeof row.icon?.value === 'string' && /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(row.icon.value)
      ? row.icon.value : null;
    products.push({
      productId: row.productId,
      name,
      description: typeof row.description === 'string' ? row.description.trim().slice(0, 400) : '',
      categories: (row.categories || []).map(item => item?.name).filter(Boolean).slice(0, 5),
      icon,
      clickCount: Number.isFinite(row.clickCount) ? row.clickCount : 0,
      likeCount: Number.isFinite(row.likeCount) ? row.likeCount : 0,
    });
  }
  return products;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function cleanCached(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(item => item && typeof item.productId === 'string' && typeof item.name === 'string').map(item => ({
    productId: item.productId,
    name: item.name.trim(),
    description: typeof item.description === 'string' ? item.description.slice(0, 400) : '',
    categories: (Array.isArray(item.categories) ? item.categories : []).map(entry => typeof entry === 'string' ? entry : entry?.name).filter(Boolean).slice(0, 5),
    icon: typeof item.icon === 'string' ? item.icon : null,
    clickCount: Number.isFinite(item.clickCount) ? item.clickCount : 0,
    likeCount: Number.isFinite(item.likeCount) ? item.likeCount : 0,
  })).filter(item => item.name.trim());
}

function writeJsonAtomic(path, value) {
  const temp = path + '.tmp';
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, path);
}

function safeMtime(path) {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}

export function createAgentCatalog({
  dataDir = resolve(process.env.DATA_DIR || 'data'),
  portalBase = (process.env.AGENT_PORTAL_BASE_URL || DEFAULT_PORTAL).replace(/\/+$/, ''),
  ttlMs = Number(process.env.AGENT_CATALOG_TTL_MS || 1800000),
  timeoutMs = Number(process.env.AGENT_CATALOG_TIMEOUT_MS || 10000),
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  mkdirSync(dataDir, { recursive: true });
  const cachePath = resolve(dataDir, CACHE_FILE);
  const aliasPath = resolve(dataDir, ALIAS_FILE);

  let products = [];
  let updatedAt = 0;
  let lastError = '';
  let inflight = null;
  let timer = null;
  let aliases = DEFAULT_ALIASES;

  const cached = readJson(cachePath);
  if (Array.isArray(cached?.products)) {
    products = cleanCached(cached.products);
    updatedAt = Number(cached.updatedAt) || safeMtime(cachePath);
  }
  const custom = readJson(aliasPath);
  if (Array.isArray(custom?.rules)) {
    const valid = custom.rules.filter(rule => rule && typeof rule.agent === 'string'
      && (Array.isArray(rule.keywords) || Array.isArray(rule.all) || Array.isArray(rule.any)));
    aliases = [...DEFAULT_ALIASES, ...valid];
  }

  const byId = new Map(products.map(product => [product.productId, product]));
  const byName = new Map(products.map(product => [product.name.toLowerCase(), product]));

  function adopt(next) {
    products = next;
    byId.clear();
    byName.clear();
    for (const product of products) {
      byId.set(product.productId, product);
      byName.set(product.name.toLowerCase(), product);
    }
    updatedAt = Date.now();
  }

  async function fetchCatalog() {
    const url = `${portalBase}/api/v1/products?page=0&size=${MAX_PRODUCTS}`;
    const response = await fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`目录接口返回 ${response.status}`);
    const payload = await response.json();
    if (payload?.code && payload.code !== 'SUCCESS') throw new Error(`目录接口错误 ${payload.code}`);
    const next = normalizeCatalog(payload);
    if (!next.length) throw new Error('目录为空或格式已变化');
    adopt(next);
    writeJsonAtomic(cachePath, { updatedAt, portalBase, products });
    return next;
  }

  async function ensureFresh({ maxAgeMs = ttlMs } = {}) {
    if (!portalBase) return products;
    if (products.length && Date.now() - updatedAt < maxAgeMs) return products;
    if (!inflight) {
      inflight = fetchCatalog()
        .catch(error => { lastError = error.message; logger.warn?.('[agent-catalog] 刷新失败，沿用旧缓存：' + error.message); return products; })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  function start() {
    if (timer) return;
    ensureFresh({ maxAgeMs: 0 }).catch(() => {});
    timer = setInterval(() => { ensureFresh({ maxAgeMs: 0 }).catch(() => {}); }, ttlMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function find(productId) {
    return byId.get(productId) || null;
  }

  function resolveAlias(query) {
    for (const rule of aliases) {
      const matched = (rule.keywords?.some(keyword => query.includes(keyword)) || false)
        || ((rule.all?.length || rule.any?.length)
          && (rule.all || []).every(keyword => query.includes(keyword))
          && (!rule.any || rule.any.some(keyword => query.includes(keyword))));
      if (!matched) continue;
      const product = byName.get(String(rule.agent).toLowerCase()) || (rule.productId && byId.get(rule.productId));
      if (product) return product;
    }
    return null;
  }

  function recommend(query, { limit = 3 } = {}) {
    const text = String(query || '').trim();
    if (!text || products.length === 0) return [];
    const tokens = tokenize(text);
    const alias = resolveAlias(text);
    const ranked = products.map(product => {
      const { score, hits } = scoreProduct(product, tokens);
      const aliasBoost = product === alias ? 60 : 0;
      return { product, score: score + aliasBoost, hits: hits + (aliasBoost ? 2 : 0) };
    }).sort((a, b) => b.score - a.score || b.product.clickCount - a.product.clickCount || a.product.name.localeCompare(b.product.name, 'zh-CN'));
    const top = ranked[0]?.score || 0;
    const floor = Math.max(6, top * 0.5);
    return ranked
      .filter(item => item.score >= floor && (item.hits >= 2 || item.score >= top * 0.8))
      .slice(0, Math.max(1, Math.min(5, limit)))
      .map(({ product }) => ({
        productId: product.productId,
        name: product.name,
        description: product.description,
        category: product.categories[0] || '',
        iconUrl: product.icon ? `/api/agents/${product.productId}/icon` : null,
        url: `${portalBase}/agents/${product.productId}`,
      }));
  }

  function recommendFor(message, reply, options) {
    const text = String(message || '');
    if (text.trim().length < 4) return [];
    if (!explicitAsk(text) && !unsupported(reply)) return [];
    if (/(?:10\.37\.26\.35|\/agents\/|智能体广场)/.test(String(reply || ''))) return [];
    const picked = recommend(text, options);
    if (picked.length || !explicitAsk(text)) return picked;
    return [{
      productId: 'portal',
      name: '智能体广场',
      description: '浏览全部站内智能体，按分类查找可用的助手',
      category: '',
      iconUrl: null,
      url: `${portalBase}/agents`,
    }];
  }

  function icon(productId) {
    const product = find(productId);
    if (!product?.icon) return null;
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(product.icon);
    if (!match) return null;
    return { mime: match[1], bytes: Buffer.from(match[2], 'base64') };
  }

  function status() {
    return {
      enabled: Boolean(portalBase),
      portalBase,
      count: products.length,
      updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
      stale: !updatedAt || Date.now() - updatedAt > ttlMs,
      error: lastError || null,
    };
  }

  return { start, stop, refresh: () => ensureFresh({ maxAgeMs: 0 }), recommend, recommendFor, find, icon, status, lookups: { explicitAsk, unsupported } };
}
