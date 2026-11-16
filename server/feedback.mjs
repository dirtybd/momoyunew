import {randomUUID} from 'node:crypto';
import {accountAccess} from './accounts.mjs';

const fail = (status, code, message) => { throw Object.assign(new Error(message), {status, code}); };
const CATEGORIES = ['功能建议', '使用问题', '内容问题', '其他'];
const EMAIL_LABELS = {pending: '待发送', sent: '已发送', failed: '发送失败', skipped: '未配置邮件'};
const NOTIFY_LABELS = {pending: '待发送', sent: '钉钉已发送', failed: '钉钉发送失败', skipped: '未配置钉钉'};
const profileOf = row => { try { return JSON.parse(row?.profile || '{}'); } catch { return {}; } };
const iso = value => value ? new Date(value).toISOString() : null;

export function feedbackSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS feedback(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '其他',
      created_at TEXT NOT NULL,
      admin_read_at TEXT,
      email_status TEXT NOT NULL DEFAULT 'pending',
      email_error TEXT,
      notify_status TEXT NOT NULL DEFAULT 'pending',
      notify_error TEXT
    );
    CREATE INDEX IF NOT EXISTS feedback_created ON feedback(created_at);
    CREATE INDEX IF NOT EXISTS feedback_unread ON feedback(admin_read_at);
    CREATE TABLE IF NOT EXISTS notifications(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      type TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      read_at INTEGER,
      UNIQUE(user_id,request_id,type)
    );
    CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created_at);`);
  const columns = db.prepare('PRAGMA table_info(feedback)').all().map(column => column.name);
  if (!columns.includes('notify_status')) db.exec("ALTER TABLE feedback ADD COLUMN notify_status TEXT NOT NULL DEFAULT 'pending'");
  if (!columns.includes('notify_error')) db.exec('ALTER TABLE feedback ADD COLUMN notify_error TEXT');
}

export function feedbackService({db, body, json, mailer, notifier}) {
  feedbackSchema(db);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const isAdmin = userId => accountAccess(db, userId).role !== 'employee';
  const adminIds = () => all(`SELECT a.user_id FROM account_access a
    LEFT JOIN account_restrictions r ON r.user_id=a.user_id
    WHERE a.role IN ('admin','primary_admin') AND a.enabled=1 AND (r.deleted_at IS NULL OR r.deleted_at='')`)
    .map(row => row.user_id);

  function submitter(row) {
    const u = get('SELECT username,profile FROM users WHERE id=?', row.user_id);
    const p = profileOf(u);
    return {displayName: p.displayName || u?.username || '员工', department: p.department || '', username: u?.username || ''};
  }

  function view(row, {admin = false} = {}) {
    const person = admin ? submitter(row) : null;
    return {
      id: row.id,
      content: row.content,
      category: row.category,
      createdAt: iso(row.created_at),
      readAt: iso(row.admin_read_at),
      emailStatus: row.email_status,
      emailLabel: EMAIL_LABELS[row.email_status] || row.email_status,
      notifyStatus: row.notify_status || 'skipped',
      notifyLabel: NOTIFY_LABELS[row.notify_status] || row.notify_status || '未配置钉钉',
      ...(admin ? {...person, emailError: row.email_error || null, notifyError: row.notify_error || null} : {}),
    };
  }

  function unreadCount() {
    return get('SELECT count(*) AS n FROM feedback WHERE admin_read_at IS NULL').n;
  }

  function markNotificationRead(userId, feedbackId) {
    const now = Date.now();
    run("UPDATE notifications SET read_at=? WHERE user_id=? AND request_id=? AND type='feedback' AND read_at IS NULL", now, userId, feedbackId);
  }

  function markFeedbackRead(row, userId) {
    if (!row.admin_read_at) run('UPDATE feedback SET admin_read_at=? WHERE id=?', new Date().toISOString(), row.id);
    markNotificationRead(userId, row.id);
    return unreadCount();
  }

  async function handle(req, res, url, user) {
    const path = url.pathname, method = req.method;
    if (!path.startsWith('/api/feedback')) return false;
    if (!user) fail(401, 'UNAUTHORIZED', '请先登录');

    if (path === '/api/feedback' && method === 'POST') {
      const b = await body(req);
      if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !['content', 'category'].includes(k)))
        fail(400, 'INVALID_FIELD', '请求字段无效');
      const content = typeof b.content === 'string' ? b.content.trim() : '';
      const category = b.category === undefined ? '其他' : b.category;
      if (content.length < 5 || content.length > 2000) fail(400, 'INVALID_CONTENT', '改进意见需要 5 到 2000 个字');
      if (!CATEGORIES.includes(category)) fail(400, 'INVALID_CATEGORY', '请选择有效的意见分类');
      const last = get('SELECT created_at FROM feedback WHERE user_id=? ORDER BY rowid DESC LIMIT 1', user.id);
      if (last && Date.now() - new Date(last.created_at).getTime() < 30000) fail(429, 'FEEDBACK_RATE', '提交太频繁，请 30 秒后再试');
      const dayAgo = new Date(Date.now() - 86400000).toISOString();
      if (get('SELECT count(*) AS n FROM feedback WHERE user_id=? AND created_at>?', user.id, dayAgo).n >= 20)
        fail(429, 'FEEDBACK_DAILY_LIMIT', '今天提交的意见较多，请明天再试');

      const id = randomUUID(), createdAt = new Date().toISOString();
      run('INSERT INTO feedback(id,user_id,content,category,created_at,email_status) VALUES(?,?,?,?,?,?)', id, user.id, content, category, createdAt, 'pending');

      const p = profileOf(user);
      const preview = content.length > 300 ? content.slice(0, 300) + '…' : content;
      for (const adminId of adminIds()) {
        if (adminId === user.id) continue;
        run("INSERT OR IGNORE INTO notifications(id,user_id,request_id,type,reason,created_at) VALUES(?,?,?,?,?,?)",
          randomUUID(), adminId, id, 'feedback', preview, Date.now());
      }

      const email = await mailer.send({
        content, category, createdAt,
        displayName: p.displayName || '', username: user.username || '', department: p.department || '',
      }).catch(e => ({status: 'failed', message: String(e?.message || e).slice(0, 300)}));
      run('UPDATE feedback SET email_status=?, email_error=? WHERE id=?', email.status, email.message || null, id);
      const notify = await notifier.send({
        content, category, createdAt,
        displayName: p.displayName || '', username: user.username || '', department: p.department || '',
      }).catch(e => ({status: 'failed', message: String(e?.message || e).slice(0, 300)}));
      run('UPDATE feedback SET notify_status=?, notify_error=? WHERE id=?', notify.status, notify.message || null, id);
      const row = get('SELECT * FROM feedback WHERE id=?', id);
      json(res, 201, {
        feedback: view(row),
        email: {status: email.status, message: email.message || null},
        notify: {status: notify.status, message: notify.message || null},
      });
      return true;
    }

    if (path === '/api/feedback' && method === 'GET') {
      const admin = isAdmin(user.id);
      const rows = admin
        ? all('SELECT * FROM feedback ORDER BY rowid DESC LIMIT 100')
        : all('SELECT * FROM feedback WHERE user_id=? ORDER BY rowid DESC LIMIT 100', user.id);
      return json(res, 200, {admin, unread: admin ? unreadCount() : 0, items: rows.map(row => view(row, {admin}))}), true;
    }

    const readOne = path.match(/^\/api\/feedback\/([a-f0-9-]{36})\/read$/i);
    if (readOne && method === 'POST') {
      if (!isAdmin(user.id)) fail(403, 'ADMIN_REQUIRED', '仅管理员可以处理改进意见');
      const row = get('SELECT * FROM feedback WHERE id=?', readOne[1]);
      if (!row) fail(404, 'NOT_FOUND', '改进意见不存在');
      const unread = markFeedbackRead(row, user.id);
      return json(res, 200, {ok: true, unread, feedback: view(get('SELECT * FROM feedback WHERE id=?', row.id), {admin: true})}), true;
    }

    if (path === '/api/feedback/read-all' && method === 'POST') {
      if (!isAdmin(user.id)) fail(403, 'ADMIN_REQUIRED', '仅管理员可以处理改进意见');
      const now = new Date().toISOString();
      run('UPDATE feedback SET admin_read_at=? WHERE admin_read_at IS NULL', now);
      run("UPDATE notifications SET read_at=? WHERE user_id=? AND type='feedback' AND read_at IS NULL", Date.now(), user.id);
      return json(res, 200, {ok: true, unread: 0}), true;
    }

    return false;
  }

  return {handle};
}
