import {createHmac} from 'node:crypto';

const clean = (value, max = 200) => String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

export function createFeedbackNotifier(env = process.env) {
  const webhook = (env.FEEDBACK_DINGTALK_WEBHOOK || '').trim();
  const secret = (env.FEEDBACK_DINGTALK_SECRET || '').trim();
  const enabled = Boolean(webhook);

  function signedUrl() {
    if (!secret) return webhook;
    const timestamp = Date.now();
    const sign = encodeURIComponent(createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64'));
    const url = new URL(webhook);
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('sign', sign);
    return url.toString();
  }

  async function send({content, category, displayName, username, department, createdAt}) {
    if (!enabled) return {status: 'skipped', message: '未配置钉钉机器人'};
    const sender = clean(displayName || username || '员工', 80);
    const text = [
      '【摸摸鱼·站内改进意见】',
      `分类：${clean(category || '其他', 20)}`,
      `提交人：${sender}${username ? `（${clean(username, 80)}）` : ''}`,
      `部门：${clean(department || '未填写', 100)}`,
      `时间：${createdAt}`,
      '',
      String(content || '').slice(0, 6000),
    ].join('\n');
    try {
      const response = await fetch(signedUrl(), {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({msgtype: 'text', text: {content: text}}),
        signal: AbortSignal.timeout(10000),
      });
      const raw = await response.text();
      let data = null;
      try { data = JSON.parse(raw); } catch {}
      if (!response.ok || data?.errcode !== 0) {
        return {status: 'failed', message: `HTTP ${response.status} ${data?.errmsg || raw.slice(0, 200)}`};
      }
      return {status: 'sent'};
    } catch (e) {
      return {status: 'failed', message: String(e?.message || e).slice(0, 300)};
    }
  }

  return {enabled, send};
}
