import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  askElectricalAgent,
  electricalAgentConfig,
  parseCapabilityCommand,
  parseElectricalCommand,
  stripCapabilityCommand,
} from '../server/electrical-agent.mjs';
import {parseChatflowPacket} from '../server/dify.mjs';

test('只识别明确的 /电气 命令，不误伤普通斜杠文本', () => {
  assert.deepEqual(parseElectricalCommand('/电气 帮我看看选型'), {command: '电气', query: '帮我看看选型'});
  assert.deepEqual(parseElectricalCommand('/电气专家'), {command: '电气专家', query: ''});
  assert.deepEqual(parseElectricalCommand('/electrical S7-1500'), {command: 'electrical', query: 'S7-1500'});
  assert.deepEqual(parseElectricalCommand('/电气：接触器怎么选'), {command: '电气', query: '接触器怎么选'});
  assert.equal(parseElectricalCommand('/办公 整理表格'), null);
  assert.deepEqual(parseCapabilityCommand('/办公 整理表格'), {capability: 'office', command: '办公', query: '整理表格'});
  assert.deepEqual(parseCapabilityCommand('/卡片：整理需求'), {capability: 'card', command: '卡片', query: '整理需求'});
  assert.equal(stripCapabilityCommand('/办公 整理表格'), '整理表格');
  assert.equal(stripCapabilityCommand('普通消息'), '普通消息');
  assert.equal(parseElectricalCommand('/电气化项目'), null);
  assert.equal(parseElectricalCommand('普通消息 /电气'), null);
});

test('Agent SSE 的 agent_message 和 message 只取一次，不重复正文', async () => {
  const frames = [
    {event: 'agent_message', conversation_id: 'conv-1', answer: '你好'},
    {event: 'message', conversation_id: 'conv-1', answer: '你好'},
    {event: 'message_end', conversation_id: 'conv-1'},
  ].map(item => `data: ${JSON.stringify(item)}\n\n`).join('');
  const fetchImpl = async () => new Response(frames, {
    status: 200,
    headers: {'content-type': 'text/event-stream'},
  });
  const result = await askElectricalAgent({
    config: {base: 'http://dify.test/v1', key: 'test'},
    userId: 'u1',
    query: '你好',
    fetchImpl,
  });
  assert.equal(result.reply, '你好');
  assert.equal(result.conversationId, 'conv-1');
});

test('电气专家调用知识库时给出检索进度', async () => {
  const frames = [
    {event: 'agent_thought', tool: 'electrical_knowledge', conversation_id: 'conv-2'},
    {event: 'agent_message', conversation_id: 'conv-2', answer: '故障码 06 表示供电相线故障。'},
    {event: 'message_end', conversation_id: 'conv-2'},
  ].map(item => `data: ${JSON.stringify(item)}\n\n`).join('');
  const progress = [];
  await askElectricalAgent({
    config: {base: 'http://dify.test/v1', key: 'test'},
    userId: 'u1',
    query: '故障码 06',
    fetchImpl: async () => new Response(frames, {status: 200, headers: {'content-type': 'text/event-stream'}}),
    onProgress: item => progress.push(item),
  });
  assert.equal(progress[0].action, 'electrical');
  assert.equal(progress[0].label, '正在检索电气知识库');
});

test('Agent 错误事件和 HTTP 错误都转为可读失败', async () => {
  const streamError = async () => new Response('data: {"event":"error","message":"模型不可用"}\n\n', {status: 200});
  await assert.rejects(
    askElectricalAgent({config: {base: 'http://dify.test/v1', key: 'test'}, userId: 'u1', query: '你好', fetchImpl: streamError}),
    error => error.status === 502 && /模型不可用/.test(error.message),
  );
  const httpError = async () => new Response('bad request', {status: 400});
  await assert.rejects(
    askElectricalAgent({config: {base: 'http://dify.test/v1', key: 'test'}, userId: 'u1', query: '你好', fetchImpl: httpError}),
    error => error.status === 502 && /HTTP 400/.test(error.message),
  );
});

test('统一入口接受电气快速回复路由', () => {
  const packet = parseChatflowPacket(JSON.stringify({
    version: 3,
    route: 'electrical',
    format: 'markdown',
    reply: 'S7-1500 性能更高。',
  }));
  assert.equal(packet.route, 'electrical');
  assert.equal(packet.parsed.intent, 'help');
  assert.equal(packet.parsed.reply, 'S7-1500 性能更高。');
});

test('未配置电气专家时返回可读配置错误', async () => {
  assert.equal(electricalAgentConfig({}), null);
  await assert.rejects(
    askElectricalAgent({config: null, userId: 'u1', query: '你好'}),
    error => error.status === 503 && error.code === 'ELECTRICAL_NOT_CONFIGURED',
  );
});
