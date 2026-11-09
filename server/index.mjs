import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readFileSync, statSync, realpathSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { CARD_STYLE_OPTIONS, DEFAULT_CARD_STYLE, isCardStyle, normalizeCardStyle } from "../shared/card-style.mjs";
import { DEMO_REQUESTS } from "../shared/demo-requests.mjs";
import { difyConfig, clarifyWithDify } from './dify.mjs';
import {attachmentStore,uploadedBackgroundRequested} from './attachments.mjs';
import {taskWorkflow} from './task-workflow.mjs';
import {careService} from './care.mjs';
import {matchingService,defaultPreferences,validatePreferences,verifyMatchToken} from './matching.mjs';
import {accountSchema,accountAccess,requirePublishing} from './accounts.mjs';
import {adminService} from './admin.mjs';
import {officialMediaStore} from './official-media.mjs';
import {taskPoints} from './task-points.mjs';
import {taskDifficulty} from './task-difficulty.mjs';
import {DIFFICULTY_REWARD_POLICY} from '../shared/task-limits.mjs';
import {createAgentCatalog} from './agent-catalog.mjs';

const remoteConfig = difyConfig();
if(process.env.CARD_TOOL_SECRET&&process.env.CARD_TOOL_SECRET.length<32)throw new Error('CARD_TOOL_SECRET 需要至少32字符');
const activeClarifications = new Set();

const dataDir = resolve(process.env.DATA_DIR || "data");
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(resolve(dataDir, "momoyu.sqlite"));
db.exec(
  `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, profile TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, owner_id TEXT, claimer_id TEXT, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages (request_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL);`,
);
if (
  !db
    .prepare("PRAGMA table_info(sessions)")
    .all()
    .some((column) => column.name === "expires_at")
) {
  db.exec(
    "ALTER TABLE sessions ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0",
  );
}
const run = (sql, ...args) => db.prepare(sql).run(...args);
const get = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
db.exec('CREATE TABLE IF NOT EXISTS dify_conversations (request_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, scope TEXT NOT NULL)');
// Keep each app's conversation when switching between Chatflow and legacy.
if(!db.prepare('PRAGMA table_info(dify_conversations)').all().some(c=>c.name==='scope'&&c.pk)){
  db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE dify_conversations RENAME TO dify_conversations_before_multi;
    CREATE TABLE dify_conversations (request_id TEXT NOT NULL,conversation_id TEXT NOT NULL,scope TEXT NOT NULL,PRIMARY KEY(request_id,scope));
    INSERT INTO dify_conversations SELECT request_id,conversation_id,scope FROM dify_conversations_before_multi;
    DROP TABLE dify_conversations_before_multi;
    COMMIT;`);
}
accountSchema(db);
const attachments=attachmentStore(db,dataDir);
const matching=matchingService({db,isBusy:()=>activeClarifications.size>0});
const points=taskPoints(db);
const difficulty=taskDifficulty({db,isBusy:()=>activeClarifications.size>0});
let backgroundRunning=false;
async function wakeBackground(){if(backgroundRunning||activeClarifications.size)return;backgroundRunning=true;try{await difficulty.drain();if(!activeClarifications.size)await matching.drain();}finally{backgroundRunning=false;}}
if(!all('PRAGMA table_info(messages)').some(c=>c.name==='intent'))db.exec('ALTER TABLE messages ADD COLUMN intent TEXT');
if(!all('PRAGMA table_info(messages)').some(c=>c.name==='meta'))db.exec('ALTER TABLE messages ADD COLUMN meta TEXT');
const messageViews=id=>all('SELECT rowid,role,content,intent,meta FROM messages WHERE request_id=? ORDER BY rowid',id).map(m=>{
  const files=attachments.messageFiles(m.rowid);
  let meta=null;try{meta=m.meta?JSON.parse(m.meta):null;}catch{}
  const recommendations=Array.isArray(meta?.recommendations)&&meta.recommendations.length?meta.recommendations:null;
  return {role:m.role,content:m.content,...(recommendations?{recommendations}:{}),...(files.length?{files}:{})};
});
const agentCatalog=createAgentCatalog({dataDir});
agentCatalog.start();
const now = () => new Date().toISOString();
const base = () => ({
  title: "",
  problem: "",
  desiredOutcome: "",
  deliverables: [],
  acceptanceCriteria: [],
  materials: [],
  constraints: [],
  deadline: null,
  skills: [],
  rewardPoints: null,
  rewardPolicy:DIFFICULTY_REWARD_POLICY,
  rewardText:'',
  anonymous: false,
  visibility: "company",
  fallbackToBoard: false,
  cardStyle: { ...DEFAULT_CARD_STYLE },
  source: "employee",
  kind: "request",
  status: "draft",
  createdAt: now(),
  updatedAt: now(),
  isDemo: false,
});
if (!get("SELECT id FROM requests LIMIT 1")) {
  for (const example of DEMO_REQUESTS) {
    const d = {...base(), ...example, status:"open", isDemo:true};
    run("INSERT INTO requests VALUES (?,?,?,?)", randomUUID(), null, null, JSON.stringify(d));
  }
}
const fields = [
  "title",
  "problem",
  "desiredOutcome",
  "deliverables",
  "acceptanceCriteria",
  "materials",
  "constraints",
  "deadline",
  "skills",
  "rewardText",
  "anonymous",
  "visibility",
  "fallbackToBoard",
  "cardStyle",
];
const profileFields = [
  "displayName",
  "department",
  "skills",
  "availability",
  "acceptingHelp",
  "bio",
  "helpPreferences",
  "skillDescription",
];
const arrayFields = [
  "deliverables",
  "acceptanceCriteria",
  "materials",
  "constraints",
  "skills",
];
class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => {
  throw new HttpError(status, code, message);
};
function validCardStyle(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => Object.hasOwn(CARD_STYLE_OPTIONS, key)) && isCardStyle(value);
}
function validate(obj, allowed) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj))
    fail(400, "INVALID_BODY", "请求格式无效");
  for (const [key, value] of Object.entries(obj)) {
    if (!allowed.includes(key))
      fail(400, "INVALID_FIELD", `不允许字段：${key}`);
    if (key === "cardStyle") {
      if (!validCardStyle(value)) fail(400, "INVALID_FIELD", "卡片样式无效");
    } else if(key==='helpPreferences'){
      validatePreferences(value);
    } else if (arrayFields.includes(key)) {
      if (
        !Array.isArray(value) ||
        value.length > 20 ||
        value.some((x) => typeof x !== "string" || x.length > 500)
      )
        fail(400, "INVALID_FIELD", `${key} 格式无效`);
    } else if (
      ["anonymous", "fallbackToBoard", "acceptingHelp", "confirmed"].includes(
        key,
      )
    ) {
      if (typeof value !== "boolean")
        fail(400, "INVALID_FIELD", `${key} 格式无效`);
    } else if (key === "rewardText") {
      if (typeof value!=='string'||value.length>500)fail(400,'INVALID_FIELD','报酬说明最多500字');
    } else if (key === "deadline") {
      if (value !== null && (typeof value !== "string" || value.length > 100))
        fail(400, "INVALID_FIELD", "截止时间无效");
    } else if (
      typeof value !== "string" ||
      value.length > (key === "message" ? 4000 : 2000)
    )
      fail(400, "INVALID_FIELD", `${key} 格式无效`);
    if (key === "visibility" && !["company", "private"].includes(value))
      fail(400, "INVALID_FIELD", "可见范围无效");
  }
}
function userView(row) {
  return row
    ? {
        id: row.id,
        username: row.username,
        ...JSON.parse(row.profile),
        helpPreferences:JSON.parse(row.profile).helpPreferences||defaultPreferences(),
        skillDescription:JSON.parse(row.profile).skillDescription||"",
        role: accountAccess(db,row.id).role,
        enabled: !!accountAccess(db,row.id).enabled,
        muted: !!accountAccess(db,row.id).muted,
      }
    : null;
}
function card(row, user) {
  const d = JSON.parse(row.data),
    mine = !!user && row.owner_id === user.id;
  const owner =
    row.owner_id && !d.anonymous
      ? get("SELECT profile FROM users WHERE id=?", row.owner_id)
      : null;
  const ownerProfile = owner && JSON.parse(owner.profile);
  const claimer =
    row.claimer_id &&
    get("SELECT profile FROM users WHERE id=?", row.claimer_id);
  return {
    id: row.id,
    ...Object.fromEntries(Object.entries(d).filter(([key])=>!["carePreview","careSafety","careMode"].includes(key))),
    ...(mine?{carePreview:d.careSafety==="urgent"?null:(d.carePreview||null),careSafety:d.careSafety||"support",careMode:!!d.careMode}:{}),
    cardStyle: normalizeCardStyle(d.cardStyle),
    cardArtwork:d.cardArtwork?{id:d.cardArtwork.id,design:Object.fromEntries(['name','paper','ink','accent','accentInk','shape','layout'].map(k=>[k,d.cardArtwork.design[k]]))}:null,
    materials: d.anonymous && !mine && row.claimer_id!==user?.id ? [] : d.materials,
    owner: ownerProfile
      ? {
          displayName: ownerProfile.displayName,
          department: ownerProfile.department,
        }
      : null,
    isMine: mine,
    matching:mine?matching.publicState(row.id):undefined,
    conversationTitle:mine&&d.status==='draft'?(get("SELECT content FROM messages WHERE request_id=? AND role='user' ORDER BY rowid LIMIT 1",row.id)?.content||'').slice(0,48):undefined,
    ...workflow.summary(row,user),
    isClaimedByMe: !!user && row.claimer_id === user.id,
    claimerLabel:
      claimer && (!d.anonymous || mine || row.claimer_id === user?.id)
        ? JSON.parse(claimer.profile).displayName
        : null,
  };
}
function owned(id, user) {
  const row = get(
    "SELECT * FROM requests WHERE id=? AND owner_id=?",
    id,
    user.id,
  );
  if (!row) fail(404, "NOT_FOUND", "需求不存在");
  return row;
}
function save(row, d) {
  d.updatedAt = now();
  run("UPDATE requests SET data=? WHERE id=?", JSON.stringify(d), row.id);
}
function auth(req) {
  const token = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("session="))
    ?.slice(8);
  return (
    token &&
    get(
      "SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.token=? AND sessions.expires_at>? AND NOT EXISTS(SELECT 1 FROM account_access WHERE user_id=users.id AND enabled=0)",
      token,
      Date.now(),
    )
  );
}
function requireUser(user) {
  if (!user) fail(401, "UNAUTHORIZED", "请先登录");
}
function setSession(res, user) {
  const token = randomBytes(32).toString("hex");
  run(
    "INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)",
    token,
    user.id,
    Date.now() + 2592000000,
  );
  res.setHeader(
    "Set-Cookie",
    `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
  );
}
async function body(req) {
  let s = "";
  for await (const chunk of req) {
    s += chunk;
    if (s.length > 65536) fail(413, "TOO_LARGE", "请求过大");
  }
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    fail(400, "INVALID_JSON", "JSON 格式无效");
  }
}
function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
function hasCard(d) {
  return Boolean(d.title?.trim() || d.problem?.trim() || d.desiredOutcome?.trim() ||
    ["deliverables", "acceptanceCriteria", "materials", "constraints", "skills"].some(k => d[k]?.some(v => v.trim())) || d.deadline);
}
const labelPattern = /^(?:标题|问题|需求|现状|目标|期望|交付物|交付|完成标准|验收标准|材料|限制|截止时间|技能)[:：]/;
function styleText(message) {
  return message.split(/[\n；;]/).map(line => line.trim()).filter(line => !labelPattern.test(line)).join('；');
}
function styleRequested(message) {
  message = styleText(message);
  if (/(?:怎么|如何|什么是|[?？])/.test(message) && !/(?:改|换|设置|设为|变成|去掉|移除)/.test(message)) return false;
  if (/(?:山景|山峰|海边|海岸|表情包|摸鱼表情|纯色|票根|车票|拍立得|照片框|气泡|对话框|标准轮廓)/.test(message) &&
      /(?:改|换|设置|设为|变成|做成|去掉|移除|用.*(?:做|作|当).*背景)/.test(message)) return true;
  return /(?:卡片|这张卡|需求卡|卡的样式|样式|外观|配色|颜色|背景|布局|圆角|字体|色调|橙色|橘色|orange|深蓝|藏蓝|蓝色|绿色|粉色|黑色|米色|沙色|墨色|玫瑰|薄荷|海报|便签|直角|方角|加粗)/i.test(message) && /(?:改|换|调整|设置|设为|变|用|成|风格|样式)/.test(message);
}
function localStyle(d, message) {
  const style = normalizeCardStyle(d.cardStyle);
  for (const [pattern, key, value] of [
    [/橙色|橘色|orange/i,'theme','orange'], [/薄荷|绿色|绿/,'theme','mint'], [/沙色|米色/,'theme','sand'], [/玫瑰|粉色|粉/,'theme','rose'], [/天空|蓝色|蓝/,'theme','sky'], [/深蓝|藏蓝|墨色|黑色|深色/,'theme','ink'],
    [/海报/,'layout','poster'], [/便签/,'layout','note'], [/标准布局|标准样式/,'layout','standard'],
    [/票根|车票/,'shape','ticket'], [/拍立得|照片框/,'shape','polaroid'], [/气泡|对话框/,'shape','bubble'], [/标准轮廓/,'shape','standard'],
    [/山景|山峰/,'background','mountain'], [/海边|海岸/,'background','coast'], [/表情包|摸鱼表情/,'background','meme'], [/去掉背景图|去掉背景|移除背景|纯色/,'background','none'],
    [/直角|方角/,'radius','square'], [/圆角/,'radius','soft'], [/加粗|醒目/,'emphasis','bold'], [/正常字重|普通字重/,'emphasis','normal']
  ]) if (pattern.test(message)) style[key] = value;
  d.cardStyle = style;
  return {intent:'style', ready: false, reply:'本地引导已按可识别的关键词调整卡片样式；未调用 AI。可用颜色、布局、圆角、字重、背景图和形状关键词描述调整。'};
}
function clarify(d, message) {
  if (/(?:现在|马上|准备|已经).{0,16}(?:自杀|自伤|伤害自己|结束生命|不想活)/.test(message)) return {intent:'care',careSafety:'urgent',careCard:null,ready:false,reply:'听起来你现在可能正面临危险。请先远离可能伤害自己的物品，尽快联系身边可信任的人陪伴你；如果危险迫在眉睫，请联系当地紧急服务或前往附近急诊。这里是本地引导，未连接 AI。'};
  if (/(?:压力大|心情低落|难过|焦虑|情绪不好|很崩溃|想倾诉)/.test(message) && !/(?:帮我|请).{0,8}(?:写|翻译|润色|计算)/.test(message)) return {intent:'care',careSafety:'support',careCard:null,ready:false,reply:'听起来这段时间不容易。你可以按自己的节奏说说，也可以先做一件让自己稍微舒服一点的小事。这里是本地引导，未连接 AI。'};
  const labeled = message.split(/[\n；;]/).some(line => labelPattern.test(line.trim()));
  const collaboration = labeled || /(?:互助|找人|请人|帮忙完成|协作|发布需求)/.test(message);
  if (styleRequested(message)) {
    const style = localStyle(d, styleText(message));
    if (!collaboration) return style;
  }
  if (!labeled && !collaboration && /[?？]|怎么|如何|什么是|解释一下|计算|excel.*(?:公式|函数)|(?:帮我|请|麻烦).{0,8}(?:写|翻译|润色|计算)/i.test(message)) {
    return {intent:'help', ready:false, reply:'当前是本地引导模式，未连接 AI，无法直接回答这个问题。配置 Dify 后可以继续办公问答；如需同事协作，也可以明确提出互助需求。'};
  }
  const lines = message
    .split(/[\n；;]/)
    .map((x) => x.trim())
    .filter(Boolean);
  const labels = {
    标题: "title",
    问题: "problem",
    需求: "problem",
    现状: "problem",
    目标: "desiredOutcome",
    期望: "desiredOutcome",
    交付物: "deliverables",
    交付: "deliverables",
    完成标准: "acceptanceCriteria",
    验收标准: "acceptanceCriteria",
    材料: "materials",
    限制: "constraints",
    截止时间: "deadline",
    技能: "skills",
  };
  let recognized = false;
  for (const line of lines) {
    const m = line.match(/^([^:：]{1,8})[:：]\s*(.+)$/);
    if (!m || !labels[m[1]]) continue;
    const key = labels[m[1]],
      v = m[2].trim();
    d[key] = arrayFields.includes(key)
      ? v
          .split(/[、,，]/)
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 20)
      : v.slice(0, 500);
    recognized = true;
  }
  if (!recognized && message.trim()) {
    if (!d.problem) d.problem = message.trim().slice(0, 500);
    else if (!d.desiredOutcome) d.desiredOutcome = message.trim().slice(0, 500);
    else if (!d.deliverables.length && !d.acceptanceCriteria.length)
      d.deliverables = [message.trim().slice(0, 500)];
  }
  if (!d.title && d.problem) d.title = d.problem.slice(0, 30);
  const missing = [];
  if (!d.problem) missing.push("需要解决什么问题？");
  if (!d.desiredOutcome) missing.push("希望达到什么结果？");
  if (!d.deliverables.length && !d.acceptanceCriteria.length)
    missing.push("需要什么交付物或完成标准？");
  return {
    intent: "request",
    ready: missing.length === 0,
    reply: missing.length
      ? `本地引导：${missing.slice(0, 2).join(" ")} 未提供的信息仍待确认；也可以在卡片中编辑。`
      : "本地引导：已收集基本信息，请检查卡片并补充或修改后再确认发布。",
  };
}
const workflow=taskWorkflow({db,files:attachments,body,json,card,save,base,activeClarifications,points,difficulty,wakeBackground});
const care=careService({db,body,json,dataDir});
const officialMedia=officialMediaStore({db,dataDir,json});
const admin=adminService({db,body,json,base,save,matching,activeClarifications,officialMedia,points,difficulty,wakeBackground});
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost"),
      path = url.pathname,
      method = req.method;
    if (
      path.startsWith("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(method)
    ) {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`)
        fail(403, "INVALID_ORIGIN", "请求来源不被允许");
      const multipartUpload=req.method==='POST'&&(/^\/api\/requests\/[^/]+\/attachments$/.test(path)||path==='/api/care/media'||path==='/api/admin/official/media')&&/^multipart\/form-data;/.test(req.headers['content-type']||'');
      if (!multipartUpload&&
        !/^application\/json(?:\s*;|\s*$)/i.test(
          req.headers["content-type"] || "",
        )
      )
        fail(415, "JSON_REQUIRED", "请使用 application/json");
    }
    const user = auth(req);
    if(await officialMedia.handle(req,res,url,user))return;
    if(await admin.handle(req,res,url,user))return;
    if(path==='/api/internal/match-preview'&&method==='POST'){
      const b=await body(req);validate(b,['match_token','card_json']);const scope=verifyMatchToken(b.match_token,process.env.CARD_TOOL_SECRET);
      if(!scope)fail(403,'INVALID_MATCH_TOKEN','预匹配授权已过期或无效');
      if(!accountAccess(db,scope.userId).enabled)fail(403,'ACCOUNT_DISABLED','账号已停用');
      const row=get('SELECT * FROM requests WHERE id=? AND owner_id=?',scope.requestId,scope.userId);
      if(!row||JSON.parse(row.data).status!=='draft'||JSON.parse(row.data).deletedAt||JSON.parse(row.data).careMode||JSON.parse(row.data).careSafety==='urgent')fail(403,'INVALID_MATCH_SCOPE','仅允许当前本人草稿预匹配');
      let d;try{d=typeof b.card_json==='string'?JSON.parse(b.card_json):null;}catch{fail(400,'INVALID_MATCH_CARD','需求摘要格式无效');}
      if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['title','skills','deadline','problem','desiredOutcome','deliverables'].includes(k))||typeof d.title!=='string'||d.title.length>200||!Array.isArray(d.skills)||d.skills.length>20||d.skills.some(x=>typeof x!=='string'||x.length>500)||(d.deadline!==null&&(typeof d.deadline!=='string'||d.deadline.length>100))||(['problem','desiredOutcome'].some(k=>d[k]!==undefined&&(typeof d[k]!=='string'||d[k].length>2000)))||(d.deliverables!==undefined&&(!Array.isArray(d.deliverables)||d.deliverables.length>20||d.deliverables.some(x=>typeof x!=='string'||x.length>500))))fail(400,'INVALID_MATCH_CARD','请提供标题、技能和截止时间');
      return json(res,200,await matching.preview(row,d));
    }
    if(path==='/api/notifications'&&method==='GET'){
      requireUser(user);const cursor=url.searchParams.get('cursor');
      if(cursor!==null&&(!/^\d{1,15}$/.test(cursor)||Number(cursor)<1))fail(400,'INVALID_CURSOR','消息游标无效');
      return json(res,200,matching.list(user.id,cursor?Number(cursor):Number.MAX_SAFE_INTEGER));
    }
    if(path==='/api/notifications/read-all'&&method==='POST'){
      requireUser(user);validate(await body(req),[]);matching.readAll(user.id);return json(res,200,{ok:true});
    }
    const readMessage=path.match(/^\/api\/notifications\/([a-f0-9-]{36})\/read$/);
    if(readMessage&&method==='POST'){
      requireUser(user);validate(await body(req),[]);matching.read(user.id,readMessage[1]);return json(res,200,{ok:true});
    }
    if(path==='/api/leaderboard'&&method==='GET'){requireUser(user);return json(res,200,points.leaderboard(user.id,url.searchParams.get('period')||'month'));}
    if(path==='/api/me/task-limits'&&method==='GET'){requireUser(user);return json(res,200,points.capacity(user.id));}
    if(await care.handle(req,res,url,user))return;
    if(await workflow.handle(req,res,path,user))return;
    const agentIcon=path.match(/^\/api\/agents\/(product-[a-z0-9]+)\/icon$/i);
    if(agentIcon&&method==='GET'){
      const icon=agentCatalog.icon(agentIcon[1]);
      if(!icon)fail(404,'NOT_FOUND','图标不存在');
      res.writeHead(200,{'Content-Type':icon.mime,'Content-Length':icon.bytes.length,'Cache-Control':'public, max-age=86400'});
      return res.end(icon.bytes);
    }
    if(path==='/api/agents/recommend'&&method==='POST'){
      requireUser(user);
      const b=await body(req);
      if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['query','limit'].includes(k)))fail(400,'INVALID_BODY','请求格式无效');
      if(typeof b.query!=='string'||!b.query.trim()||b.query.length>2000)fail(400,'INVALID_QUERY','请提供要检索的需求描述');
      const limit=b.limit===undefined?3:b.limit;
      if(!Number.isInteger(limit)||limit<1||limit>5)fail(400,'INVALID_LIMIT','推荐数量需为1到5');
      if(!agentCatalog.status().count)await agentCatalog.refresh().catch(()=>{});
      return json(res,200,{recommendations:agentCatalog.recommend(b.query,{limit})});
    }
    if (path === "/api/health" && method === "GET")
      return json(res, 200, {
        ok: true,
        mode: remoteConfig ? "dify" : "local",
        difyConfigured: !!remoteConfig,
        difyEntrypoint:remoteConfig?(remoteConfig.kind||'legacy'):'local',
        matchingMode:matching.config?'dify':'local',
        agentCatalog:agentCatalog.status(),
      });
    if (path === "/api/session" && method === "GET")
      return json(res, 200, { user: userView(user) });
    if (path === "/api/auth/register" && method === "POST") {
      const b = await body(req);
      validate(b, ["username", "password", ...profileFields]);
      if (
        !b.username?.trim() ||
        b.username.length > 100 ||
        !b.password ||
        b.password.length < 8 ||
        !b.displayName?.trim() ||
        !b.department?.trim()
      )
        fail(400, "INVALID_FIELD", "请填写账号、至少8位密码、姓名和部门");
      const id = randomUUID(),
        salt = randomBytes(16).toString("hex"),
        hash = scryptSync(b.password, salt, 64).toString("hex");
      const profile = {
        displayName: b.displayName,
        department: b.department,
        skills: b.skills || [],
        availability: b.availability || "",
        acceptingHelp: b.acceptingHelp ?? true,
        bio: b.bio || "",
        skillDescription: b.skillDescription || "",
        helpPreferences:b.helpPreferences||defaultPreferences(),
      };
      try {
        run(
          "INSERT INTO users VALUES (?,?,?,?,?)",
          id,
          b.username.trim(),
          salt,
          hash,
          JSON.stringify(profile),
        );
      } catch (e) {
        if (e.message.includes("UNIQUE"))
          fail(409, "USERNAME_TAKEN", "账号已存在");
        throw e;
      }
      const u = get("SELECT * FROM users WHERE id=?", id);
      setSession(res, u);
      matching.enqueueOpen();void wakeBackground();
      return json(res, 201, { user: userView(u) });
    }
    if (path === "/api/auth/login" && method === "POST") {
      const b = await body(req);
      validate(b, ["username", "password"]);
      if (
        !b.username?.trim() ||
        b.username.length > 100 ||
        !b.password ||
        b.password.length < 8
      )
        fail(400, "INVALID_FIELD", "请输入账号和至少8位密码");
      const u =
        typeof b.username === "string" &&
        get("SELECT * FROM users WHERE username=?", b.username.trim());
      if (
        !u ||
        typeof b.password !== "string" ||
        !timingSafeEqual(
          Buffer.from(u.hash, "hex"),
          scryptSync(b.password, u.salt, 64),
        )
      )
        fail(401, "INVALID_CREDENTIALS", "账号或密码错误");
      if(!accountAccess(db,u.id).enabled)fail(403,'ACCOUNT_DISABLED','账号已停用，请联系管理员');
      setSession(res, u);
      return json(res, 200, { user: userView(u) });
    }
    if (path === "/api/auth/logout" && method === "POST") {
      const token = (req.headers.cookie || "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("session="))
        ?.slice(8);
      if (token) run("DELETE FROM sessions WHERE token=?", token);
      res.setHeader(
        "Set-Cookie",
        "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
      );
      return json(res, 200, { ok: true });
    }
    if (path === "/api/profile" && method === "PUT") {
      requireUser(user);
      const b = await body(req);
      validate(b, profileFields);
      if (
        ("displayName" in b && !b.displayName.trim()) ||
        ("department" in b && !b.department.trim())
      )
        fail(400, "INVALID_FIELD", "姓名和部门不能为空");
      run(
        "UPDATE users SET profile=? WHERE id=?",
        JSON.stringify({ ...JSON.parse(user.profile), ...b }),
        user.id,
      );
      matching.enqueueOpen();void wakeBackground();
      return json(res, 200, {
        user: userView(get("SELECT * FROM users WHERE id=?", user.id)),
      });
    }
    if (path === "/api/requests" && method === "GET") {
      const source = url.searchParams.get("source") || "all",
        q = (url.searchParams.get("q") || "").toLowerCase();
      if (!["all", "employee", "official"].includes(source))
        fail(400, "INVALID_FIELD", "来源无效");
      const requests = all("SELECT * FROM requests")
        .map((r) => card(r, user))
        .filter(
          (d) =>
            d.visibility === "company" &&
            !d.deletedAt &&
            !d.moderatedAt &&
            d.status !== "draft" &&
            (source === "all" || d.source === source) &&
            (!q ||
              [d.title, d.problem, d.desiredOutcome, ...d.skills]
                .join(" ")
                .toLowerCase()
                .includes(q)),
        );
      return json(res, 200, { requests, total: requests.length });
    }
    if (path === "/api/me/requests" && method === "GET") {
      requireUser(user);
      const rows = all(
        "SELECT * FROM requests WHERE owner_id=? OR claimer_id=?",
        user.id,
        user.id,
      );
      const requests = rows
        .filter(
          (r) =>
            r.owner_id === user.id && JSON.parse(r.data).status !== "draft" && !JSON.parse(r.data).deletedAt,
        )
        .map((r) => card(r, user));
      const drafts = rows
        .filter(
          (r) =>
            r.owner_id === user.id && !JSON.parse(r.data).deletedAt && JSON.parse(r.data).status === "draft" && (hasCard(JSON.parse(r.data))||attachments.list(r.id,'material').length>0||get('SELECT 1 FROM messages WHERE request_id=? LIMIT 1',r.id)),
        )
        .map((r) => card(r, user));
      const claimed = rows
        .filter((r) => r.claimer_id === user.id)
        .map((r) => card(r, user));
      const archived=rows.filter(r=>r.owner_id===user.id&&JSON.parse(r.data).deletedAt).map(r=>card(r,user));
      return json(res, 200, { requests, claimed, drafts, archived });
    }
    if (path === "/api/clarify" && method === "POST") {
      requireUser(user);
      const b = await body(req);
      validate(b, ["requestId", "message", "entryMode"]);
      if(b.entryMode!==undefined&&(b.entryMode!=='care'||b.requestId))fail(400,'INVALID_FIELD','倾诉入口只用于新对话。');
      if (!b.message?.trim()) fail(400, "INVALID_FIELD", "请输入需求");
      let row = b.requestId ? owned(b.requestId, user) : null;
      if (!row) {
        const id = randomUUID();
        run(
          "INSERT INTO requests VALUES (?,?,?,?)",
          id,
          user.id,
          null,
          JSON.stringify({...base(),careMode:b.entryMode==='care'}),
        );
        row = owned(id, user);
      }
      const d = JSON.parse(row.data);
      if(d.deletedAt)fail(409,'ARCHIVED','请先恢复这份草稿。');
      if (d.status !== "draft") fail(409, "NOT_DRAFT", "只能澄清草稿");
      if (activeClarifications.has(row.id)) fail(409, 'CLARIFY_BUSY', '这张卡片正在整理中，请等待本轮完成。');
      activeClarifications.add(row.id);
      try {
        let result;
        let preview=null;
        const streaming=req.headers.accept?.includes('text/event-stream');
        const controller=new AbortController();
        const progress=value=>{if(streaming&&!res.destroyed)res.write('event: status\ndata: '+JSON.stringify(value)+'\n\n');};
        const reply=value=>{if(streaming&&!res.destroyed)res.write('event: reply\ndata: '+JSON.stringify(value)+'\n\n');};
        if(streaming){res.setHeader('Content-Type','text/event-stream; charset=utf-8');res.writeHead(200,{'Cache-Control':'no-store','X-Accel-Buffering':'no'});progress({stage:'thinking',label:'正在理解你的描述'});}
        res.once('close',()=>{if(!res.writableEnded)controller.abort();});
        {
          if (remoteConfig) {
            const conversation = get('SELECT conversation_id FROM dify_conversations WHERE request_id=? AND scope=?', row.id, remoteConfig.scope);
            const inputFiles=await attachments.aiInputs(row,user,remoteConfig.scope,{skipImages:uploadedBackgroundRequested(b.message)});
            result = await clarifyWithDify({config: remoteConfig, userId: user.id,
              conversationId: conversation?.conversation_id, requestId:row.id,card: d, message: b.message,
              history: all('SELECT role,content,intent FROM messages WHERE request_id=? ORDER BY rowid', row.id),onProgress:progress,onReply:reply,signal:controller.signal,attachments:workflow.sourceFiles(row,user),inputFiles,
              getConversationId:scope=>get('SELECT conversation_id FROM dify_conversations WHERE request_id=? AND scope=?',row.id,scope)?.conversation_id,
              onFileUploaded:(id,uploadId,scope=remoteConfig.scope)=>attachments.cacheUpload(id,scope,user.id,uploadId),outputHistory:attachments.outputHistory(row,user)});
            if(controller.signal.aborted)fail(499,'CANCELLED','本轮已停止，草稿保持不变。');
            const current = owned(row.id, user);
            if (current.data !== row.data) fail(409, 'DRAFT_CHANGED', '这张草稿已在其他页面修改，请重新打开草稿后再发送。');
            if (result.card) Object.assign(d, result.card);
            if (['request', 'style'].includes(result.intent) && result.cardStyle && styleRequested(b.message)) d.cardStyle = normalizeCardStyle({...normalizeCardStyle(d.cardStyle), ...result.cardStyle});
            if(['request','style'].includes(result.intent)&&result.artwork){
              d.cardArtwork=result.artwork;
              delete d.coverFileId;
              d.cardStyle=normalizeCardStyle({...d.cardStyle,shape:result.artwork.design.shape,layout:result.artwork.design.layout,background:'none'});
            }
            if(['request','style'].includes(result.intent)&&result.coverAttachmentId&&uploadedBackgroundRequested(b.message))workflow.applyCover(row,d,result.coverAttachmentId,user);
            if(['request','style'].includes(result.intent)&&result.ready&&!d.careMode&&!d.deletedAt&&d.status==='draft'&&d.title&&(d.skills?.length||d.problem)){
              try{preview=await matching.preview(row,d,{semantic:true,timeoutMs:20000});}
              catch{preview={unavailable:true,count:0,timeUnconfirmed:0,sent:false};}
              if(preview&&!/预匹配/.test(result.reply)){
                if(preview.unavailable)result.reply+='\n\n（预匹配：服务暂时不可用，未发送任何通知；发布后后台会继续匹配。）';
                else if(preview.count>0)result.reply+=`\n\n（预匹配：找到 ${preview.count} 位匿名候选人${preview.timeUnconfirmed?`，其中 ${preview.timeUnconfirmed} 位空闲时间待确认`:''}；未发送任何通知。）`;
                else result.reply+='\n\n（预匹配：暂未找到合适人选；发布后后台会继续匹配。）';
              }
            }
          } else result = clarify(d, b.message);
          if (result.intent === 'care') {
            d.careMode=true;
            if (result.careSafety==='urgent') d.careSafety='urgent';
            else if (d.careSafety!=='urgent') d.careSafety='support';
            if(d.careSafety==='urgent') { d.carePreview=null; result.ready=false; }
            else if(result.clearCarePreview) {d.carePreview=null;result.ready=false;}
            else if(result.careCard) d.carePreview=result.careCard;
          } else if(['request','help'].includes(result.intent)) d.careMode=false;
        }
        const recommendations=result.intent==='help'&&!b.entryMode&&d.careSafety!=='urgent'&&!(result.outputFiles||[]).length
          ?agentCatalog.recommendFor(b.message,result.reply,{limit:3}):[];
        const staged=await attachments.stageOutputs(row,user,result.outputFiles);
        try{
          if(controller.signal.aborted)fail(499,'CANCELLED','本轮已停止，原内容保持不变。');
          if(owned(row.id,user).data!==row.data)fail(409,'DRAFT_CHANGED','会话已在其他页面修改，请刷新后重试。');
          db.exec('BEGIN IMMEDIATE');
          try{
            save(row,d);run('INSERT INTO messages (request_id,role,content,intent) VALUES (?,?,?,?)',row.id,'user',b.message,result.intent);
            const inserted=run('INSERT INTO messages (request_id,role,content,intent,meta) VALUES (?,?,?,?,?)',row.id,'assistant',result.reply,result.intent,recommendations.length?JSON.stringify({recommendations}):null);
            if(remoteConfig)for(const session of result.conversations||[{scope:remoteConfig.scope,conversationId:result.conversationId}])
              run('INSERT INTO dify_conversations VALUES (?,?,?) ON CONFLICT(request_id,scope) DO UPDATE SET conversation_id=excluded.conversation_id',row.id,session.conversationId,session.scope);
            staged.commit(inserted.lastInsertRowid);db.exec('COMMIT');
          }catch(e){db.exec('ROLLBACK');throw e;}
        }catch(e){await staged.rollback();throw e;}
        const messages=messageViews(row.id);
        const payload={
          request: card(get("SELECT * FROM requests WHERE id=?", row.id), user),
          messages,
          reply: result.reply,
          readyForPreview: result.ready,
          intent: result.intent,
          hasCard: hasCard(d),
          carePreview: d.careSafety==='urgent'?null:(d.carePreview||null),
          careSafety: d.careSafety||'support',
          recommendations,
          mode: remoteConfig ? "dify" : "local",
          preview: preview ? {count:preview.count,timeUnconfirmed:preview.timeUnconfirmed,mode:preview.mode,method:preview.method,fallback:!!preview.fallback,unavailable:!!preview.unavailable} : null,
          warnings: remoteConfig ? [...(result.designWarning?[result.designWarning]:[]),...(result.fileWarnings||[])] : ["本地引导模式，未调用远程模型；请核对并补充信息。"],
        };
        if(streaming){res.write('event: result\ndata: '+JSON.stringify(payload)+'\n\n');return res.end();}
        return json(res,200,payload);
      } finally {activeClarifications.delete(row.id);}
    }
    const artworkMatch=path.match(/^\/api\/requests\/([^/]+)\/artwork.svg$/);
    if(artworkMatch&&method==='GET'){
      const row=get('SELECT * FROM requests WHERE id=?',artworkMatch[1]);
      if(!row)fail(404,'NOT_FOUND','卡片不存在');
      const d=JSON.parse(row.data);
      if((d.deletedAt||d.moderatedAt||d.status==='draft'||d.visibility!=='company')&&row.owner_id!==user?.id&&row.claimer_id!==user?.id)fail(404,'NOT_FOUND','卡片不存在');
      if(!d.cardArtwork)fail(404,'NOT_FOUND','暂无自主设计');
      res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'none'; sandbox"});
      return res.end(d.cardArtwork.svg);
    }
    const match = path.match(
      /^\/api\/requests\/([^/]+)(?:\/(messages|publish|claim))?$/,
    );
    if (match) {
      const [, id, action] = match;
      let row = get("SELECT * FROM requests WHERE id=?", id);
      if (!row) fail(404, "NOT_FOUND", "需求不存在");
      const d = JSON.parse(row.data);
      if (!action && method === "GET") {
        if (
          (d.deletedAt || d.moderatedAt || d.status === "draft" || d.visibility !== "company") &&
          row.owner_id !== user?.id && row.claimer_id !== user?.id
        )
          fail(404, "NOT_FOUND", "需求不存在");
        return json(res, 200, { request: card(row, user) });
      }
      if (action === "messages" && method === "GET") {
        if (!user) fail(404, "NOT_FOUND", "需求不存在");
        owned(id, user);
        return json(res, 200, {
          messages: messageViews(id),
        });
      }
      if (!action && method === "PATCH") {
        requireUser(user);
        row = owned(id, user);
        if(d.source==='official')fail(403,'OFFICIAL_EDITOR','官方内容请在管理后台编辑');
        if(d.deletedAt)fail(409,'ARCHIVED','请先恢复卡片。');
        if (!['draft','open'].includes(d.status)) fail(409, "NOT_DRAFT", "任务已被接取，需保留原需求；可在详情补充材料。否则仅能编辑未接取卡片。");
        const b = await body(req);
        const {coverAttachmentId,rewardAttachmentId,...editableBody}=b;
        validate(editableBody,[...fields,'confirmed']);
        const latest=owned(id,user);
        if(latest.data!==row.data)fail(409,'DRAFT_CHANGED','卡片已变化，请刷新后再保存。');
        if(d.status==='open')requirePublishing(db,user.id);
        if(d.status==='open'&&b.confirmed!==true)fail(400,'CONFIRM_REQUIRED','修改公开卡片需要确认保存。');
        if(d.status==='open'&&b.visibility&&b.visibility!=='company')fail(400,'INVALID_FIELD','已发布卡片请使用移除功能下架。');
        delete b.confirmed;delete b.coverAttachmentId;delete b.rewardAttachmentId;
        if (b.cardStyle) b.cardStyle = normalizeCardStyle({...normalizeCardStyle(d.cardStyle), ...b.cardStyle});
        Object.assign(d, b);
        if(d.status==='open'&&(!d.title.trim()||!d.problem.trim()||!d.desiredOutcome.trim()||![...d.deliverables,...d.acceptanceCriteria].some(x=>x.trim())))fail(400,'INCOMPLETE','公开卡片须保留标题、问题、目标及交付物或完成标准。');
        db.exec('BEGIN IMMEDIATE');try{if(coverAttachmentId!==undefined)workflow.applyCover(row,d,coverAttachmentId,user);if(rewardAttachmentId!==undefined)workflow.applyReward(row,d,rewardAttachmentId,user);save(row,d);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
        if(d.status==='open'){difficulty.enqueue(id);matching.enqueue(id);void wakeBackground();}
        return json(res, 200, {
          request: card(get("SELECT * FROM requests WHERE id=?", id), user),
        });
      }
      if (action === "publish" && method === "POST") {
        requireUser(user);
        row = owned(id, user);
        if(d.careMode||d.careSafety==='urgent') fail(400,'CARE_NOT_TASK','关怀对话不能作为互助任务发布。');
        const b = await body(req);
        validate(b, ["confirmed"]);
        requirePublishing(db,user.id);
        if(owned(id,user).data!==row.data)fail(409,'DRAFT_CHANGED','草稿已变化，请刷新后再发布。');
        if (b.confirmed !== true)
          fail(400, "CONFIRM_REQUIRED", "请先明确确认发布");
        if (d.deletedAt||d.status !== "draft") fail(409, "NOT_DRAFT", "只能发布未移除的草稿");
        if (d.visibility !== "company")
          fail(
            400,
            "PRIVATE_DRAFT",
            "私密需求保留为草稿，请修改为公司可见后发布",
          );
        if (
          !d.title.trim() ||
          !d.problem.trim() ||
          !d.desiredOutcome.trim() ||
          ![...d.deliverables, ...d.acceptanceCriteria].some((x) => x.trim())
        )
          fail(
            400,
            "INCOMPLETE",
            "请填写标题、问题、期望结果及交付物或完成标准",
          );
        db.exec('BEGIN IMMEDIATE');try{points.requireSlot(user.id,'publishing');d.status = "open";save(row,d);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
        difficulty.enqueue(id);
        matching.enqueue(id);void wakeBackground();
        return json(res, 200, {
          request: card(get("SELECT * FROM requests WHERE id=?", id), user),
          matches:[],
          matching:matching.publicState(id),
          publishedToBoard: true,
        });
      }
      if (action === "claim" && method === "POST") {
        requireUser(user);
        if (d.deletedAt||d.moderatedAt||d.visibility !== "company" || d.status === "draft")
          fail(404, "NOT_FOUND", "需求不存在");
        if (row.owner_id === user.id || d.kind === "announcement")
          fail(400, "CANNOT_CLAIM", "此需求不可接取");
        if (d.status !== "open")
          fail(409, "ALREADY_CLAIMED", "需求已被接取或不可接取");
        d.status = "claimed";
        d.updatedAt = now();
        db.exec('BEGIN IMMEDIATE');
        let result;try{points.requireSlot(user.id,'claiming');if(d.rewardPolicy===DIFFICULTY_REWARD_POLICY){const grade=difficulty.state(id);if(grade.status!=='scored'||!Number.isInteger(grade.score)||grade.score<1||grade.score>5)fail(409,'DIFFICULTY_PENDING','积分尚未评定，请待系统完成难度评估后再接取。');d.rewardPoints=grade.score;}result = run(
          "UPDATE requests SET claimer_id=?,data=? WHERE id=? AND claimer_id IS NULL AND json_extract(data,'$.status')='open'",
          user.id,
          JSON.stringify(d),
          id,
        );
        if (!result.changes) fail(409, "ALREADY_CLAIMED", "需求已被接取");
        db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
        return json(res, 200, {
          request: card(get("SELECT * FROM requests WHERE id=?", id), user),
        });
      }
    }
    if (path.startsWith("/api/")) fail(404, "NOT_FOUND", "接口不存在");
    if (method !== "GET" && method !== "HEAD")
      fail(404, "NOT_FOUND", "页面不存在");
    const root = resolve("dist");
    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      fail(400, "INVALID_PATH", "路径无效");
    }
    const file = resolve(root, "." + decoded);
    if (file !== root && !file.startsWith(root + sep))
      fail(403, "FORBIDDEN", "路径无效");
    let target = file;
    try {
      if (!statSync(target).isFile()) target = resolve(root, "index.html");
    } catch {
      target = resolve(root, "index.html");
    }
    try {
      const realRoot = realpathSync(root),
        realTarget = realpathSync(target);
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep))
        fail(403, "FORBIDDEN", "路径无效");
      const contents = readFileSync(realTarget);
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
      };
      res.writeHead(200, {
        "Content-Type": types[extname(target)] || "application/octet-stream",
      });
      res.end(method === "HEAD" ? undefined : contents);
    } catch (e) {
      if (e.status) throw e;
      fail(404, "NOT_FOUND", "页面不存在");
    }
  } catch (e) {
    if (!res.headersSent)
      json(res, e.status || 500, {
        error: {
          code: e.code || "INTERNAL_ERROR",
          message: e.status ? e.message : "服务器内部错误",
        },
      });
    else {if(!res.destroyed&&res.getHeader('Content-Type')?.startsWith('text/event-stream'))res.write('event: error\ndata: '+JSON.stringify({message:e.status?e.message:'服务器内部错误'})+'\n\n');res.end();}
    if (!e.status) console.error(e);
  }
});
server.listen(
  Number(process.env.PORT ?? 8787),
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      `momoyu server listening on ${JSON.stringify(server.address())}`,
    ),
);
// Durable jobs survive restarts; the timers only wake the worker, never create chats.
if(process.env.MATCHING_SCHEDULER!=='off'){
  difficulty.enqueueOpen();matching.enqueueOpen();void wakeBackground();
  setInterval(()=>{void wakeBackground();},5000).unref();
  setInterval(()=>{difficulty.enqueueOpen();matching.enqueueOpen();void wakeBackground();},900000).unref();
}
