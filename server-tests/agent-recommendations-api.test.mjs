import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const icon = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64');
const products = [
  {
    productId: 'product-11111111111111111111111111111111',
    name: '运行管理合同审核助手',
    description: '对各类型合同全文逐条核验，识别违约、付款、合规风险',
    categories: ['经营管理'], icon, clickCount: 3, likeCount: 1,
  },
  {
    productId: 'product-22222222222222222222222222222222',
    name: '采购投标文件的相似度查询报告',
    description: '投标文件查重，识别围标、串标线索',
    categories: ['经营管理'], icon: null, clickCount: 1, likeCount: 0,
  },
];

test('AI办公无法完成时推荐站内智能体，并随消息持久化', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'momoyu-reco-api-'));
  writeFileSync(join(dir, 'agent-catalog.json'), JSON.stringify({updatedAt: Date.now(), portalBase: 'http://127.0.0.1:1', products}));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    windowsHide: true,
    env: {
      ...process.env, DATA_DIR: dir, HOST: '127.0.0.1', PORT: '0',
      DIFY_API_KEY: '', DIFY_CHATFLOW_API_KEY: '', DIFY_ENTRYPOINT: 'legacy',
      MATCHING_SCHEDULER: 'off',
      AGENT_PORTAL_BASE_URL: 'http://127.0.0.1:1',
      AGENT_CATALOG_TIMEOUT_MS: '300',
      AGENT_CATALOG_TTL_MS: '600000',
      CARD_TOOL_SECRET: 'test-secret-0123456789abcdef0123456789',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    rmSync(dir, {recursive: true, force: true});
  });
  let base = '';
  for await (const chunk of child.stdout) {
    const match = String(chunk).match(/"port":(\d+)/);
    if (match) { base = 'http://127.0.0.1:' + match[1]; break; }
  }
  assert.ok(base, 'server started');
  const call = async (path, method = 'GET', body, cookie) => {
    const response = await fetch(base + '/api' + path, {
      method,
      headers: {'content-type': 'application/json', ...(cookie ? {cookie} : {})},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0]};
  };
  const registered = await call('/auth/register', 'POST', {
    username: 'recommend@example.com', password: 'Synthetic2026!', displayName: '推荐测试', department: '测试',
  });
  assert.equal(registered.status, 201);
  const cookie = registered.cookie;

  assert.equal((await call('/agents/recommend', 'POST', {query: '帮我审核合同'})).status, 401);
  const manual = await call('/agents/recommend', 'POST', {query: '帮我审核采购合同，找出违约风险', limit: 3}, cookie);
  assert.equal(manual.status, 200);
  assert.equal(manual.data.recommendations[0].name, '运行管理合同审核助手');
  assert.equal(manual.data.recommendations[0].iconUrl, '/api/agents/product-11111111111111111111111111111111/icon');
  assert.equal((await call('/agents/recommend', 'POST', {query: '审核合同', limit: 9}, cookie)).status, 400);

  const clarify = await call('/clarify', 'POST', {message: '有没有别的智能体可以帮我审核合同？'}, cookie);
  assert.equal(clarify.status, 200);
  assert.equal(clarify.data.intent, 'help');
  assert.ok(clarify.data.recommendations.length > 0);
  assert.ok(clarify.data.messages.at(-1).recommendations.length > 0);
  const reload = await call('/requests/' + clarify.data.request.id + '/messages', 'GET', undefined, cookie);
  assert.equal(reload.status, 200);
  assert.equal(reload.data.messages.at(-1).recommendations[0].name, '运行管理合同审核助手');

  const iconResponse = await fetch(base + '/api/agents/product-11111111111111111111111111111111/icon');
  assert.equal(iconResponse.status, 200);
  assert.equal(iconResponse.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await iconResponse.arrayBuffer()).toString(), 'fake-png');
  assert.equal((await fetch(base + '/api/agents/product-99999999999999999999999999999999/icon')).status, 404);
});
