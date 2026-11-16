import nodemailer from 'nodemailer';

export function createFeedbackMailer(env = process.env) {
  const host = (env.FEEDBACK_SMTP_HOST || env.SMTP_HOST || '').trim();
  const port = Number(env.FEEDBACK_SMTP_PORT || env.SMTP_PORT || 465);
  const secure = String(env.FEEDBACK_SMTP_SECURE || env.SMTP_SECURE || 'true').toLowerCase() !== 'false';
  const user = (env.FEEDBACK_SMTP_USER || env.SMTP_USER || '').trim();
  const pass = env.FEEDBACK_SMTP_PASS || env.SMTP_PASS || '';
  const from = (env.FEEDBACK_SMTP_FROM || env.SMTP_FROM || user).trim();
  const to = (env.FEEDBACK_EMAIL || 'gdirtybd@gmail.com').trim();
  const enabled = Boolean(host && user && pass && from);
  let transporter = null;

  function transport() {
    if (!enabled) return null;
    transporter ||= nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {user, pass},
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    return transporter;
  }

  async function send({content, category, displayName, username, department, createdAt}) {
    const t = transport();
    if (!t) return {status: 'skipped', message: '未配置 SMTP，邮件未发送'};
    const clean = (value, max = 80) => String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
    const sender = clean(displayName || username || '员工');
    const safeCategory = clean(category || '其他', 20);
    const subject = `[摸摸鱼] 站内改进意见 · ${safeCategory} · ${sender}`;
    const text = [
      `提交人：${sender}${username ? `（${username}）` : ''}`,
      `部门：${department || '未填写'}`,
      `分类：${category || '其他'}`,
      `时间：${createdAt}`,
      '',
      content,
    ].join('\n');
    try {
      const info = await t.sendMail({
        from,
        to,
        subject,
        text,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      return {status: 'sent', messageId: info.messageId || null, to};
    } catch (e) {
      return {status: 'failed', message: String(e?.message || e).slice(0, 300)};
    }
  }

  return {enabled, to, send};
}
