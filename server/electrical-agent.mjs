const MAX_ANSWER_LENGTH = 200000;

const fail = (status, code, message) => {
  throw Object.assign(new Error(message), {status, code});
};
const isAbort = error => error?.name === 'AbortError' || error?.name === 'TimeoutError';

export function electricalAgentConfig(env = process.env) {
  const key = env.DIFY_ELECTRICAL_API_KEY?.trim();
  if (!key) return null;
  const base = (env.DIFY_ELECTRICAL_BASE_URL || env.DIFY_BASE_URL || '').trim().replace(/\/+$/, '');
  let url;
  try {
    url = new URL(base);
  } catch {
    fail(503, 'ELECTRICAL_CONFIG', '电气专家入口地址无效。');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    fail(503, 'ELECTRICAL_CONFIG', '电气专家入口地址无效。');
  }
  return {base, key};
}

/**
 * Slash commands select a capability before the Chatflow task classifier runs.
 * `electrical` calls the full Agent directly; `office` and `card` are forwarded
 * to the unified Chatflow as forced routes so they keep the existing file,
 * card-context and output-file handling. Keep the menu descriptions in
 * frontend/src/AssistantConversation.jsx in sync with these aliases.
 */
const CAPABILITY_COMMANDS = [
  {capability: 'electrical', aliases: ['电气专家', '电气', 'electrical']},
  {capability: 'office', aliases: ['办公', 'office']},
  {capability: 'card', aliases: ['卡片', 'card']},
];

export function parseCapabilityCommand(message) {
  const text = String(message ?? '').trim();
  for (const item of CAPABILITY_COMMANDS) {
    const aliases = [...item.aliases].sort((left, right) => right.length - left.length).join('|');
    const match = new RegExp(`^\\/(${aliases})(?:[：:]\\s*|\\s+|$)`, 'i').exec(text);
    if (match) return {
      capability: item.capability,
      command: match[1],
      query: text.slice(match[0].length).trim(),
    };
  }
  return null;
}

// Kept for callers/tests that only need the electrical shortcut.
export function parseElectricalCommand(message) {
  const command = parseCapabilityCommand(message);
  return command?.capability === 'electrical' ? {command: command.command, query: command.query} : null;
}

export function stripCapabilityCommand(message) {
  const text = String(message ?? '').trim();
  const command = parseCapabilityCommand(text);
  return command ? command.query : text;
}

export async function askElectricalAgent({config, userId, conversationId, query, signal, timeoutMs = 180000, fetchImpl = fetch, onProgress = null}) {
  if (!config) fail(503, 'ELECTRICAL_NOT_CONFIGURED', '电气专家尚未配置服务端密钥，请联系管理员。');
  if (typeof query !== 'string' || !query.trim()) fail(400, 'EMPTY_QUERY', '请在 /电气 后面输入问题。');
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  let response;
  try {
    response = await fetchImpl(config.base + '/chat-messages', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any(signals),
      headers: {
        authorization: 'Bearer ' + config.key,
        'content-type': 'application/json',
        connection: 'close',
      },
      body: JSON.stringify({
        inputs: {},
        query: query.trim(),
        response_mode: 'streaming',
        user: 'momoyu-' + userId,
        auto_generate_name: false,
        ...(conversationId ? {conversation_id: conversationId} : {}),
      }),
    });
  } catch (error) {
    if (isAbort(error)) fail(504, 'ELECTRICAL_TIMEOUT', '电气专家响应超时，请稍后重试。');
    fail(503, 'ELECTRICAL_UNAVAILABLE', '电气专家暂时不可用，请稍后重试。');
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    fail(response.status >= 500 ? 503 : 502, 'ELECTRICAL_UNAVAILABLE', `电气专家返回 HTTP ${response.status}${text ? '：' + text.slice(0, 200) : ''}，请稍后重试。`);
  }
  let answer = '';
  let agentAnswer = '';
  let nextConversationId = conversationId || null;
  let streamError = null;
  let buffer = '';
  const decoder = new TextDecoder();
  try {
    const reader = response.body.getReader();
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true}).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = (frame.match(/^event: (.+)$/m) || [])[1] || '';
        const data = frame.split(/\r?\n/)
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n');
        if (!data || data === '[DONE]') continue;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        if (event === 'error' || parsed.event === 'error') {
          streamError = parsed;
          continue;
        }
        if (typeof parsed.conversation_id === 'string') nextConversationId = parsed.conversation_id;
        const type = parsed.event || event;
        if (type === 'agent_thought' && parsed.tool) {
          // Let the UI follow the actual agent action instead of sitting on a
          // generic "电气专家正在处理" for the whole retrieval round.
          const tool = String(parsed.tool);
          const label = tool.includes('electrical_knowledge') ? '正在检索电气知识库'
            : tool.includes('electrical_translation') ? '正在翻译项目文本'
              : '电气专家正在处理';
          onProgress?.({stage: label.includes('检索') ? 'reading' : 'tool', label, action: 'electrical'});
        }
        if (typeof parsed.answer === 'string') {
          if (type === 'agent_message') agentAnswer += parsed.answer;
          else if (type === 'message' || !type) answer += parsed.answer;
          if ((answer.length + agentAnswer.length) > MAX_ANSWER_LENGTH) fail(502, 'ELECTRICAL_OUTPUT', '电气专家返回内容过大，请缩小问题范围。');
        }
      }
    }
  } catch (error) {
    if (isAbort(error)) fail(504, 'ELECTRICAL_TIMEOUT', '电气专家响应超时，请稍后重试。');
    if (error?.code === 'ELECTRICAL_OUTPUT') throw error;
    fail(503, 'ELECTRICAL_UNAVAILABLE', '电气专家连接中断，请稍后重试。');
  }
  if (streamError) {
    const message = typeof streamError.message === 'string' ? streamError.message : '';
    fail(502, 'ELECTRICAL_OUTPUT', `电气专家执行失败${message ? '：' + message.slice(0, 160) : ''}，请稍后重试。`);
  }
  if (!answer.trim() && !agentAnswer.trim()) fail(502, 'ELECTRICAL_OUTPUT', '电气专家没有返回有效回答，请稍后重试。');
  return {
    reply: (answer.trim() ? answer : agentAnswer).trim(),
    conversationId: nextConversationId,
  };
}
