import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgentCatalog, normalizeCatalog, scoreProduct, tokenize} from '../server/agent-catalog.mjs';

const product = (id, name, description, categories = [], extra = {}) => ({
  productId: 'product-' + id,
  name,
  description,
  status: 'PUBLISHED',
  type: 'AGENT_API',
  enabled: true,
  icon: {type: 'BASE64', value: 'data:image/png;base64,' + Buffer.from('icon-' + id).toString('base64')},
  categories: categories.map(name => ({name})),
  clickCount: 0,
  likeCount: 0,
  ...extra,
});

const ROWS = [
  product('c1', '运行管理合同审核助手', '对各类型合同全文逐条核验，识别条款缺漏、付款履约、违约等风险。', ['经营管理']),
  product('c2', '新制度编写助手', '根据需求生成制度初稿，支持多轮修改', ['经营管理']),
  product('c3', '差旅制度问答助手', '7*24在线，智能解答差旅制度疑问', ['日常办公']),
  product('c4', '采购投标文件的相似度查询报告', '采购投标文件相似度比对，识别围标、串标线索', ['经营管理']),
  product('c5', '境外票据识别翻译智能体', '境外票据识别翻译，提供 OCR 与自动翻译', ['日常办公']),
  product('c6', '成套基层党业融合宣传员', '智能生成党建资料、活动、项目新闻报道', ['日常办公']),
];

const payload = rows => ({code: 'SUCCESS', message: null, data: {content: rows, number: 1, size: 100, totalElements: rows.length}});

function fixture(rows = ROWS) {
  const dir = mkdtempSync(join(tmpdir(), 'momoyu-catalog-'));
  const catalog = createAgentCatalog({
    dataDir: dir,
    portalBase: 'http://portal.test:5173',
    fetchImpl: async () => new Response(JSON.stringify(payload(rows)), {status: 200, headers: {'content-type': 'application/json'}}),
    logger: {warn() {}},
  });
  return {dir, catalog};
}

test('目录只保留已发布的 AGENT_API，并按名称去重', () => {
  const rows = [
    ...ROWS,
    product('c7', '运行管理合同审核助手', '重复名称'),
    product('c8', '内部工具', '未发布', [], {status: 'DRAFT'}),
    product('c9', 'MCP 工具', '类型不符', [], {type: 'MCP_SERVER'}),
    product('c10', '停用工具', '已停用', [], {enabled: false}),
    {...product('bad', '坏 ID', 'x'), productId: 'not-a-product'},
    product('c11', '无图标工具', '没有图标', [], {icon: null}),
  ];
  const normalized = normalizeCatalog(payload(rows));
  assert.deepEqual(normalized.map(x => x.productId), ['product-c1', 'product-c2', 'product-c3', 'product-c4', 'product-c5', 'product-c6', 'product-c11']);
  assert.equal(normalized.find(x => x.productId === 'product-c11').icon, null);
  assert.equal(tokenize('帮我审核合同，找出违约风险').includes('合同'), true);
  assert.ok(scoreProduct(normalized[0], tokenize('合同审核')).score > 0);
});

test('关键词检索与别名优先命中正确的智能体', async () => {
  const {dir, catalog} = fixture();
  try {
    await catalog.refresh();
    assert.equal(catalog.status().count, 6);
    assert.equal(catalog.recommend('帮我审核一份采购合同，找出违约和付款风险')[0].name, '运行管理合同审核助手');
    assert.equal(catalog.recommend('几份投标文件内容很像，帮我查重')[0].name, '采购投标文件的相似度查询报告');
    assert.equal(catalog.recommend('把这张境外发票翻译成中文')[0].name, '境外票据识别翻译智能体');
    assert.equal(catalog.recommend('写一篇党建活动的新闻稿')[0].name, '成套基层党业融合宣传员');
    assert.equal(catalog.recommend('帮我制定一个差旅报销制度')[0].name, '新制度编写助手');
    assert.equal(catalog.recommend('公司差旅报销标准是什么')[0].name, '差旅制度问答助手');
    assert.deepEqual(catalog.recommend('今天天气怎么样'), []);
    const first = catalog.recommend('帮我审核合同')[0];
    assert.match(first.url, /^http:\/\/portal\.test:5173\/agents\/product-c1$/);
    assert.equal(first.iconUrl, '/api/agents/product-c1/icon');
    assert.deepEqual(Buffer.from(catalog.icon('product-c1').bytes).toString(), 'icon-c1');
    assert.equal(catalog.icon('product-c3').mime, 'image/png');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('只在明确求助、或回复确实做不了时推荐，且不打扰卡片和关怀对话', async () => {
  const {dir, catalog} = fixture();
  try {
    await catalog.refresh();
    assert.ok(catalog.recommendFor('帮我审核合同', '我无法完成这个任务，建议使用合同审核工具。').length > 0);
    assert.ok(catalog.recommendFor('帮我审核合同', '已为你生成审核意见。').length === 0);
    assert.ok(catalog.recommendFor('帮我审核合同', '无法读取视频画面，请提供截图。').length > 0);
    assert.ok(catalog.recommendFor('有没有别的智能体可以审核合同？', '我这边只能做基础问答。').length > 0);
    assert.equal(catalog.recommendFor('有没有别的智能体可以帮我订机票？', '我做不到')[0].url, 'http://portal.test:5173/agents');
    assert.ok(catalog.recommendFor('帮我审核合同', '推荐运行管理合同审核助手，地址 http://portal.test:5173/agents/product-c1').length === 0);
    assert.deepEqual(catalog.recommendFor('好', '无法完成'), []);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('门户不可用时沿用磁盘缓存，不阻塞对话', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'momoyu-catalog-'));
  try {
    const good = createAgentCatalog({
      dataDir: dir, portalBase: 'http://portal.test:5173',
      fetchImpl: async () => new Response(JSON.stringify(payload(ROWS)), {status: 200}),
      logger: {warn() {}},
    });
    await good.refresh();
    const saved = JSON.parse(readFileSync(join(dir, 'agent-catalog.json'), 'utf8'));
    assert.equal(saved.products.length, 6);

    let calls = 0;
    const offline = createAgentCatalog({
      dataDir: dir, portalBase: 'http://portal.test:5173',
      fetchImpl: async () => { calls++; throw new Error('offline'); },
      logger: {warn() {}},
    });
    assert.equal(offline.status().count, 6, '启动时读取上次缓存');
    await offline.refresh();
    assert.equal(calls, 1);
    assert.equal(offline.status().count, 6, '失败后仍保留旧目录');
    assert.match(offline.status().error, /offline/);

    writeFileSync(join(dir, 'agent-aliases.json'), JSON.stringify({rules: [
      {keywords: ['特殊说法'], agent: '新制度编写助手'},
      {keywords: ['坏规则']},
    ]}));
    const aliased = createAgentCatalog({
      dataDir: dir, portalBase: 'http://portal.test:5173',
      fetchImpl: async () => new Response(JSON.stringify(payload(ROWS)), {status: 200}),
      logger: {warn() {}},
    });
    assert.equal(aliased.recommend('特殊说法')[0].name, '新制度编写助手');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
