import {randomUUID} from 'node:crypto';
import {accountAccess,requirePublishing} from './accounts.mjs';
import {reviewCareContent} from './content-review.mjs';
import {careMediaStore} from './care-media.mjs';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const validBody=(b,keys)=>{
  if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!keys.includes(k))) fail(400,'INVALID_FIELD','请求字段无效');
};
const text=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
export function careService({db,body,json,dataDir}) {
  db.exec(`CREATE TABLE IF NOT EXISTS care_posts (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, comments_enabled INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, removed_at TEXT);
    CREATE TABLE IF NOT EXISTS care_comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, owner_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, removed_at TEXT);
    CREATE TABLE IF NOT EXISTS care_reports (comment_id TEXT NOT NULL, reporter_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(comment_id,reporter_id));
    CREATE TABLE IF NOT EXISTS care_rate (user_id TEXT NOT NULL, kind TEXT NOT NULL, created_ms INTEGER NOT NULL);`);
  db.exec('CREATE TABLE IF NOT EXISTS care_likes(post_id TEXT NOT NULL,user_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(post_id,user_id))');
  if(!db.prepare('PRAGMA table_info(care_posts)').all().some(c=>c.name==='kind'))db.exec("ALTER TABLE care_posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'mood'");
  for(const table of ['care_posts','care_comments']){
    const columns=db.prepare(`PRAGMA table_info(${table})`).all();
    if(!columns.some(c=>c.name==='moderated_at'))db.exec(`ALTER TABLE ${table} ADD COLUMN moderated_at TEXT`);
    if(!columns.some(c=>c.name==='moderation_reason'))db.exec(`ALTER TABLE ${table} ADD COLUMN moderation_reason TEXT`);
  }
  const media=careMediaStore(db,dataDir),kinds=['mood','vent','moment'];
  const get=(sql,...args)=>db.prepare(sql).get(...args), all=(sql,...args)=>db.prepare(sql).all(...args), run=(sql,...args)=>db.prepare(sql).run(...args);
  const requirePost=id=>{const p=get('SELECT * FROM care_posts WHERE id=? AND removed_at IS NULL AND moderated_at IS NULL',id);if(!p)fail(404,'NOT_FOUND','内容不存在');return p;};
  const ownedPost=(id,user)=>{const p=requirePost(id);if(p.owner_id!==user.id)fail(404,'NOT_FOUND','内容不存在');return p;};
  const isAdmin=user=>{const a=accountAccess(db,user.id);return a.enabled&&a.role!=='employee';};
  const postView=(p,user)=>({id:p.id,title:p.title,content:p.content,kind:p.kind,photos:media.list(p.id),createdAt:p.created_at,updatedAt:p.updated_at,anonymous:true,isMine:p.owner_id===user.id,commentsEnabled:!!p.comments_enabled,commentCount:get('SELECT count(*) AS n FROM care_comments WHERE post_id=? AND removed_at IS NULL AND moderated_at IS NULL',p.id).n,likeCount:get('SELECT count(*) AS n FROM care_likes WHERE post_id=?',p.id).n,liked:!!get('SELECT 1 FROM care_likes WHERE post_id=? AND user_id=?',p.id,user.id)});
  const commentView=(c,p,user)=>({id:c.id,content:c.content,authorLabel:c.owner_id===p.owner_id?'发布者':'匿名同事',isMine:c.owner_id===user.id,canRemove:c.owner_id===user.id||p.owner_id===user.id||isAdmin(user),createdAt:c.created_at});
  const cursor=url=>{const v=url.searchParams.get('cursor');if(v!==null&&!/^[1-9]\d{0,14}$/.test(v))fail(400,'INVALID_CURSOR','游标无效');return v?Number(v):Number.MAX_SAFE_INTEGER;};
  const rate=(user,kind)=>{const time=Date.now();run('DELETE FROM care_rate WHERE created_ms<?',time-60000);if(get('SELECT count(*) AS n FROM care_rate WHERE user_id=? AND kind=?',user.id,kind).n>=5)fail(429,'RATE_LIMIT','操作过于频繁，请稍后再试');run('INSERT INTO care_rate VALUES (?,?,?)',user.id,kind,time);};
  const review=async(type,title,content)=>{const result=await reviewCareContent({type,title,content:content||'图片分享'});if(!result||result.urgent||result.allow!==true)fail(422,result?.urgent?'CARE_URGENT':'CARE_REJECTED',result?.urgent?'当前内容暂不适合公开，请优先联系身边可信任的人或当地紧急和专业支持。':(result?.reason||'内容暂未通过审核，请调整后重试。'));};
  const checkConversation=(id,user)=>{if(id===undefined)return; if(typeof id!=='string'||!id)fail(400,'INVALID_FIELD','对话无效');const r=get('SELECT data FROM requests WHERE id=? AND owner_id=?',id,user.id);if(!r)fail(404,'NOT_FOUND','对话不存在');const d=JSON.parse(r.data);if(d.status!=='draft'||d.deletedAt)fail(404,'NOT_FOUND','对话不存在');if(d.careSafety==='urgent')fail(422,'CARE_URGENT','当前对话暂不适合公开，请优先寻求身边支持。');};
  async function handle(req,res,url,user){
    const path=url.pathname,method=req.method;
    if(!path.startsWith('/api/care/'))return false;
    if(!user)fail(401,'UNAUTHORIZED','请先登录');
    if(await media.handle(req,res,url,user,json))return true;
    const like=path.match(/^\/api\/care\/posts\/([^/]+)\/like$/);
    if(like&&method==='PUT'){
      const b=await body(req);validBody(b,['liked']);if(typeof b.liked!=='boolean')fail(400,'INVALID_FIELD','点赞状态无效');const post=requirePost(like[1]);
      if(b.liked)run('INSERT OR IGNORE INTO care_likes VALUES(?,?,?)',post.id,user.id,new Date().toISOString());else run('DELETE FROM care_likes WHERE post_id=? AND user_id=?',post.id,user.id);
      json(res,200,{post:postView(post,user)});return true;
    }
    if(path==='/api/care/posts'&&method==='GET'){
      const kind=url.searchParams.get('kind');if(kind&&!kinds.includes(kind))fail(400,'INVALID_FIELD','帖子分类无效');
      const rows=kind?all('SELECT rowid AS seq,* FROM care_posts WHERE removed_at IS NULL AND moderated_at IS NULL AND kind=? AND rowid<? ORDER BY rowid DESC LIMIT 21',kind,cursor(url)):all('SELECT rowid AS seq,* FROM care_posts WHERE removed_at IS NULL AND moderated_at IS NULL AND rowid<? ORDER BY rowid DESC LIMIT 21',cursor(url));
      json(res,200,{items:rows.slice(0,20).map(p=>postView(p,user)),nextCursor:rows.length>20?String(rows[19].seq):null});return true;
    }
    if(path==='/api/care/posts'&&method==='POST'){
      requirePublishing(db,user.id);
      const b=await body(req);validBody(b,['title','content','conversationId','commentsEnabled','confirmed','kind','mediaIds']);
      if(b.confirmed!==true)fail(400,'CONFIRM_REQUIRED','请确认公开发布');
      const ids=b.mediaIds??[],kind=b.kind??'mood';media.validate(ids,user.id);
      if(!text(b.title,120)||typeof b.content!=='string'||b.content.length>1500||(!b.content.trim()&&!ids.length)||!kinds.includes(kind)||(b.commentsEnabled!==undefined&&typeof b.commentsEnabled!=='boolean'))fail(400,'INVALID_FIELD','请填写标题，并提供文字或照片');
      checkConversation(b.conversationId,user);rate(user,'post');await review('care_post',b.title.trim(),b.content.trim());checkConversation(b.conversationId,user);
      requirePublishing(db,user.id);const id=randomUUID(),time=new Date().toISOString();db.exec('BEGIN IMMEDIATE');try{media.validate(ids,user.id);run('INSERT INTO care_posts (id,owner_id,title,content,comments_enabled,created_at,updated_at,kind) VALUES (?,?,?,?,?,?,?,?)',id,user.id,b.title.trim(),b.content.trim(),b.commentsEnabled===false?0:1,time,time,kind);media.bind(ids,user.id,id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
      json(res,201,{post:postView(requirePost(id),user)});return true;
    }
    const p=path.match(/^\/api\/care\/posts\/([^/]+)(?:\/(archive|comments))?$/);
    if(p){const [,id,action]=p;
      if(!action&&method==='GET'){json(res,200,{post:postView(requirePost(id),user)});return true;}
      if(!action&&method==='PATCH'){
        requirePublishing(db,user.id);
        const b=await body(req);validBody(b,['title','content','commentsEnabled','confirmed','kind','mediaIds']);if(b.confirmed!==true)fail(400,'CONFIRM_REQUIRED','请确认修改');
        let current=ownedPost(id,user);
        const ids=b.mediaIds??media.list(id).map(m=>m.id),kind=b.kind??current.kind;media.validate(ids,user.id,id);
        if(('title'in b&&!text(b.title,120))||('content'in b&&(typeof b.content!=='string'||b.content.length>1500||(!b.content.trim()&&!ids.length)))||!kinds.includes(kind)||('commentsEnabled'in b&&typeof b.commentsEnabled!=='boolean'))fail(400,'INVALID_FIELD','修改内容无效');
        const title='title'in b?b.title.trim():current.title,content='content'in b?b.content.trim():current.content;
        if('title'in b||'content'in b){rate(user,'post');await review('care_post',title,content);const latest=ownedPost(id,user);if(latest.updated_at!==current.updated_at||latest.title!==current.title||latest.content!==current.content||latest.comments_enabled!==current.comments_enabled)fail(409,'POST_CHANGED','内容已变化，请刷新后重试');current=latest;}
        if(!content.trim()&&!ids.length)fail(400,'INVALID_FIELD','请保留文字或照片');
        requirePublishing(db,user.id);db.exec('BEGIN IMMEDIATE');try{media.bind(ids,user.id,id);run('UPDATE care_posts SET title=?,content=?,comments_enabled=?,updated_at=?,kind=? WHERE id=?',title,content,'commentsEnabled'in b?(b.commentsEnabled?1:0):current.comments_enabled,new Date().toISOString(),kind,id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
        json(res,200,{post:postView(requirePost(id),user)});return true;
      }
      if(action==='archive'&&method==='POST') {const b=await body(req);validBody(b,['confirmed']);if(b.confirmed!==true)fail(400,'CONFIRM_REQUIRED','请确认移除');ownedPost(id,user);run('UPDATE care_posts SET removed_at=? WHERE id=?',new Date().toISOString(),id);json(res,200,{ok:true});return true;}
      if(action==='comments'&&method==='GET'){
        const post=requirePost(id),rows=all('SELECT rowid AS seq,* FROM care_comments WHERE post_id=? AND removed_at IS NULL AND moderated_at IS NULL AND rowid<? ORDER BY rowid DESC LIMIT 21',id,cursor(url));
        json(res,200,{items:rows.slice(0,20).map(c=>commentView(c,post,user)),nextCursor:rows.length>20?String(rows[19].seq):null});return true;
      }
      if(action==='comments'&&method==='POST'){
        requirePublishing(db,user.id);
        const b=await body(req);validBody(b,['content']);if(!text(b.content,500))fail(400,'INVALID_FIELD','请填写不超过500字的留言');let post=requirePost(id);if(!post.comments_enabled)fail(409,'COMMENTS_CLOSED','评论已关闭');rate(user,'comment');await review('care_comment','',b.content.trim());post=requirePost(id);if(!post.comments_enabled)fail(409,'COMMENTS_CLOSED','评论已关闭');
        requirePublishing(db,user.id);const cid=randomUUID();run('INSERT INTO care_comments (id,post_id,owner_id,content,created_at,removed_at) VALUES (?,?,?,?,?,NULL)',cid,id,user.id,b.content.trim(),new Date().toISOString());json(res,201,{comment:commentView(get('SELECT * FROM care_comments WHERE id=?',cid),post,user)});return true;
      }
    }
    const c=path.match(/^\/api\/care\/comments\/([^/]+)\/(remove|report)$/);
    if(c&&method==='POST'){
      const b=await body(req);const comment=get('SELECT * FROM care_comments WHERE id=? AND removed_at IS NULL AND moderated_at IS NULL',c[1]);if(!comment)fail(404,'NOT_FOUND','留言不存在');const post=requirePost(comment.post_id);
      if(c[2]==='remove'){validBody(b,['confirmed']);if(b.confirmed!==true)fail(400,'CONFIRM_REQUIRED','请确认移除');if(comment.owner_id!==user.id&&post.owner_id!==user.id)fail(404,'NOT_FOUND','留言不存在');run('UPDATE care_comments SET removed_at=? WHERE id=?',new Date().toISOString(),comment.id);json(res,200,{ok:true});return true;}
      validBody(b,['reason']);if(!text(b.reason,300))fail(400,'INVALID_FIELD','请填写反馈原因');run('INSERT OR IGNORE INTO care_reports VALUES (?,?,?,?)',comment.id,user.id,b.reason.trim(),new Date().toISOString());json(res,200,{ok:true,status:'pending'});return true;
    }
    fail(404,'NOT_FOUND','接口不存在');
  }
  return {handle};
}
