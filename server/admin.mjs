import {randomUUID} from 'node:crypto';
import {accountAccess,passwordFields,requirePublishing} from './accounts.mjs';
import {isCardStyle,normalizeCardStyle} from '../shared/card-style.mjs';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const fields=['title','problem','desiredOutcome','deliverables','acceptanceCriteria','skills','deadline','rewardText','rewardMediaId','cardStyle','coverMediaId'];
const valid=(b,keys)=>{if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!keys.includes(k)))fail(400,'INVALID_FIELD','请求字段无效');};
const text=(s,max=2000)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
export function adminService({db,body,json,base,save,matching,activeClarifications,officialMedia,points,difficulty,wakeBackground}){
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  const requireAdmin=user=>{if(!user)fail(401,'UNAUTHORIZED','请先登录');const a=accountAccess(db,user.id);if(!a.enabled||a.role==='employee')fail(403,'ADMIN_REQUIRED','仅管理员可以执行此操作');return a;};
  const audit=(user,action,type,id,reason='')=>run('INSERT INTO management_audit(actor_id,action,target_type,target_id,reason,created_at) VALUES(?,?,?,?,?,?)',user.id,action,type,id,reason,new Date().toISOString());
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');if(e.message.includes('ADMIN_LIMIT'))fail(409,'ADMIN_LIMIT','管理员最多2个，请先移除另一账号的管理员权限');if(e.message.includes('UNIQUE'))fail(409,'USERNAME_TAKEN','账号已存在');throw e;}};
  const userView=u=>{const p=JSON.parse(u.profile),a=accountAccess(db,u.id);return {id:u.id,username:u.username,displayName:p.displayName,department:p.department,role:a.role,enabled:!!a.enabled,muted:!!a.muted,deletedAt:a.deleted_at};};
  const officialView=r=>{const d=JSON.parse(r.data),grade=difficulty.state(r.id);return {id:r.id,...Object.fromEntries([...fields,'kind','status','rewardPolicy'].map(k=>[k,d[k]])),rewardPoints:r.claimer_id?d.rewardPoints:grade.score,difficulty:grade,rewardText:d.rewardText||'',rewardMediaId:d.rewardMediaId||null,rewardUrl:d.rewardMediaId?'/api/official/media/'+d.rewardMediaId:null,cardStyle:normalizeCardStyle(d.cardStyle),coverMediaId:d.coverMediaId||null,coverUrl:d.coverMediaId?'/api/official/media/'+d.coverMediaId:null,hidden:!!d.moderatedAt};};
  function officialBody(b,current){
    valid(b,[...fields,'kind','confirmed']);if(b.confirmed!==true)fail(400,'CONFIRM_REQUIRED','请确认向全公司公开发布');
    const d={...current,...Object.fromEntries(Object.entries(b).filter(([k])=>k!=='confirmed'))};
    if(!isCardStyle(d.cardStyle,{partial:true})||[d.coverMediaId,d.rewardMediaId].some(id=>id!=null&&(typeof id!=='string'||!/^[-a-f0-9]{36}$/i.test(id))))fail(400,'INVALID_STYLE','请选择有效样式及上传图片');
    d.cardStyle=normalizeCardStyle(d.cardStyle);d.coverMediaId??=null;d.rewardMediaId??=null;d.rewardText??='';
    if(!['announcement','bounty'].includes(d.kind)||!text(d.title,200)||!text(d.problem))fail(400,'INVALID_FIELD','请填写标题和正文，并选择发布类型');
    if(typeof d.desiredOutcome!=='string'||d.desiredOutcome.length>2000)fail(400,'INVALID_FIELD','目标格式无效');
    for(const k of ['deliverables','acceptanceCriteria','skills'])if(!Array.isArray(d[k])||d[k].length>20||d[k].some(v=>typeof v!=='string'||v.length>500))fail(400,'INVALID_FIELD','列表格式无效');
    if(d.deadline!==null&&(typeof d.deadline!=='string'||d.deadline.length>100))fail(400,'INVALID_FIELD','截止时间无效');
    if(typeof d.rewardText!=='string'||d.rewardText.length>500)fail(400,'INVALID_FIELD','报酬说明最多500字');
    if(d.kind==='bounty'&&(!d.desiredOutcome.trim()||![...d.deliverables,...d.acceptanceCriteria].some(v=>v.trim())))fail(400,'INCOMPLETE','悬赏须填写目标及交付物或完成标准');
    return d;
  }
  async function handle(req,res,url,user){
    const path=url.pathname,method=req.method;if(!path.startsWith('/api/admin/'))return false;
    requireAdmin(user);
    if(await officialMedia.handleAdmin(req,res,url,user))return true;
    if(path==='/api/admin/users'&&method==='GET'){
      const q=(url.searchParams.get('q')||'').toLowerCase(),users=all('SELECT id,username,profile FROM users ORDER BY rowid').map(userView).filter(u=>[u.username,u.displayName,u.department].join(' ').toLowerCase().includes(q));
      json(res,200,{users,adminCount:get("SELECT count(*) AS n FROM account_access WHERE role IN ('admin','primary_admin')").n,maxAdmins:2});return true;
    }
    if(path==='/api/admin/users'&&method==='POST'){
      const b=await body(req);valid(b,['username','password','displayName','department','role']);const actor=requireAdmin(user),role=b.role||'employee';
      if(!['employee','admin'].includes(role)||role==='admin'&&actor.role!=='primary_admin')fail(403,'PRIMARY_REQUIRED','只有主账号可以创建第二个管理员');
      if(!text(b.username,100)||!text(b.displayName,100)||!text(b.department,200))fail(400,'INVALID_FIELD','请填写账号、姓名和部门');
      const credentials=passwordFields(b.password),id=randomUUID();
      transaction(()=>{run('INSERT INTO users VALUES(?,?,?,?,?)',id,b.username.trim(),credentials.salt,credentials.hash,JSON.stringify({displayName:b.displayName.trim(),department:b.department.trim(),skills:[],availability:'',acceptingHelp:false,bio:'',skillDescription:''}));run('INSERT INTO account_access VALUES(?,?,1)',id,role);audit(user,'create_account','account',id,role);});
      json(res,201,{user:userView(get('SELECT * FROM users WHERE id=?',id))});return true;
    }
    const account=path.match(/^\/api\/admin\/users\/([a-f0-9-]{36})$/i);
    if(account&&method==='PATCH'){
      const b=await body(req);valid(b,['enabled','role','password','muted']);if(!Object.keys(b).length)fail(400,'INVALID_FIELD','请选择修改项');
      const actor=requireAdmin(user),target=get('SELECT * FROM users WHERE id=?',account[1]);if(!target)fail(404,'NOT_FOUND','账号不存在');const access=accountAccess(db,target.id);
      if(access.deleted_at)fail(409,'ACCOUNT_DELETED','请先恢复已删除账号');
      if(target.id===user.id||access.role==='primary_admin')fail(403,'PROTECTED_ACCOUNT','不能通过后台修改本人或主账号的登录与权限');
      if(actor.role!=='primary_admin'&&(access.role!=='employee'||b.role!==undefined))fail(403,'PRIMARY_REQUIRED','只有主账号可以管理管理员权限');
      if(b.role!==undefined&&!['employee','admin'].includes(b.role)||b.enabled!==undefined&&typeof b.enabled!=='boolean'||b.muted!==undefined&&typeof b.muted!=='boolean')fail(400,'INVALID_FIELD','账号设置无效');
      const credentials=b.password!==undefined?passwordFields(b.password):null;
      transaction(()=>{run('INSERT INTO account_access VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,enabled=excluded.enabled',target.id,b.role??access.role,b.enabled===undefined?access.enabled:Number(b.enabled));if(b.muted!==undefined)run('INSERT INTO account_restrictions(user_id,muted) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET muted=excluded.muted',target.id,Number(b.muted));if(credentials)run('UPDATE users SET salt=?,hash=? WHERE id=?',credentials.salt,credentials.hash,target.id);if(credentials||b.enabled===false||b.role!==undefined)run('DELETE FROM sessions WHERE user_id=?',target.id);audit(user,'update_account','account',target.id,Object.keys(b).join(','));});
      json(res,200,{user:userView(get('SELECT * FROM users WHERE id=?',target.id))});return true;
    }
    const accountAction=path.match(/^\/api\/admin\/users\/([a-f0-9-]{36})\/(archive|restore)$/i);
    if(accountAction&&method==='POST'){
      const b=await body(req);valid(b,['confirmed']);if(b.confirmed!==true)fail(400,'CONFIRM_REQUIRED','请确认账号操作');
      const actor=requireAdmin(user),target=get('SELECT * FROM users WHERE id=?',accountAction[1]);if(!target)fail(404,'NOT_FOUND','账号不存在');const access=accountAccess(db,target.id),restore=accountAction[2]==='restore';
      if(target.id===user.id||access.role==='primary_admin')fail(403,'PROTECTED_ACCOUNT','不能删除或恢复本人及主账号');
      if(actor.role!=='primary_admin'&&access.role!=='employee')fail(403,'PRIMARY_REQUIRED','只有主账号可以管理其他管理员');
      if(restore?!access.deleted_at:!!access.deleted_at)fail(409,'ACCOUNT_STATE','账号状态已变化，请刷新');
      transaction(()=>{run('INSERT INTO account_restrictions(user_id,deleted_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET deleted_at=excluded.deleted_at',target.id,restore?null:new Date().toISOString());run("INSERT INTO account_access VALUES(?,'employee',0) ON CONFLICT(user_id) DO UPDATE SET enabled=0,role='employee'",target.id);run('DELETE FROM sessions WHERE user_id=?',target.id);audit(user,restore?'restore_account':'archive_account','account',target.id);});
      json(res,200,{user:userView(get('SELECT * FROM users WHERE id=?',target.id))});return true;
    }
    if(path==='/api/admin/content'&&method==='GET'){
      const type=url.searchParams.get('type')||'tasks',q=(url.searchParams.get('q')||'').toLowerCase();let items;
      if(type==='tasks')items=all('SELECT * FROM requests ORDER BY rowid DESC').flatMap(r=>{const d=JSON.parse(r.data);if(d.status==='draft'||d.visibility!=='company'||d.deletedAt||d.isDemo)return [];return [{id:r.id,type,title:d.title,content:d.problem,source:d.source,kind:d.kind,status:d.status,hidden:!!d.moderatedAt,reason:d.moderationReason||'',createdAt:d.createdAt,canEdit:d.source==='official'&&d.status==='open'&&!r.claimer_id}];});
      else if(type==='posts')items=all('SELECT * FROM care_posts WHERE removed_at IS '+(url.searchParams.get('removed')==='true'?'NOT NULL':'NULL')+' ORDER BY rowid DESC').map(p=>({id:p.id,type,title:p.title,content:p.content,source:'employee',kind:p.kind,status:'published',hidden:!!p.moderated_at,removedAt:p.removed_at,reason:p.moderation_reason||'',createdAt:p.created_at,canEdit:false}));
      else if(type==='comments')items=all('SELECT c.*,p.title FROM care_comments c JOIN care_posts p ON p.id=c.post_id WHERE c.removed_at IS '+(url.searchParams.get('removed')==='true'?'NOT NULL':'NULL')+' ORDER BY c.rowid DESC').map(c=>({id:c.id,type,title:c.title,content:c.content,source:'employee',kind:'comment',status:'published',hidden:!!c.moderated_at,removedAt:c.removed_at,reason:c.moderation_reason||'',createdAt:c.created_at,canEdit:false}));
      else fail(400,'INVALID_TYPE','内容类型无效');
      items=items.filter(i=>(i.title+' '+i.content).toLowerCase().includes(q));json(res,200,{items,total:items.length});return true;
    }
    const contentAction=path.match(/^\/api\/admin\/content\/(posts|comments)\/([a-f0-9-]{36})\/(archive|restore)$/i);
    if(contentAction&&method==='POST'){
      const b=await body(req);valid(b,['confirmed','reason']);requireAdmin(user);if(b.confirmed!==true||b.reason!==undefined&&(typeof b.reason!=='string'||b.reason.length>500))fail(400,'CONFIRM_REQUIRED','请确认操作，说明最多500字');
      const [,type,id,action]=contentAction,table=type==='posts'?'care_posts':'care_comments',row=get(`SELECT * FROM ${table} WHERE id=?`,id);if(!row)fail(404,'NOT_FOUND','内容不存在');
      if(action==='restore'&&type==='comments'&&get('SELECT removed_at FROM care_posts WHERE id=?',row.post_id)?.removed_at)fail(409,'PARENT_REMOVED','请先恢复所属帖子');
      transaction(()=>{run(`UPDATE ${table} SET removed_at=? WHERE id=?`,action==='archive'?new Date().toISOString():null,id);audit(user,action+'_content',type,id,b.reason||'');});json(res,200,{ok:true});return true;
    }
    const moderation=path.match(/^\/api\/admin\/content\/(tasks|posts|comments)\/([a-f0-9-]{36})\/moderation$/i);
    if(moderation&&method==='POST'){
      const b=await body(req);valid(b,['hidden','reason','confirmed']);requireAdmin(user);
      if(typeof b.hidden!=='boolean'||b.confirmed!==true||b.hidden&&!text(b.reason,500)||b.reason!==undefined&&(typeof b.reason!=='string'||b.reason.length>500))fail(400,'CONFIRM_REQUIRED','请确认操作，下架时填写不超过500字的原因');
      const [,type,id]=moderation;
      transaction(()=>{
        if(type==='tasks'){
          const r=get('SELECT * FROM requests WHERE id=?',id),d=r&&JSON.parse(r.data);if(!d||d.status==='draft'||d.visibility!=='company'||d.deletedAt||d.isDemo)fail(404,'NOT_FOUND','公开卡片不存在');
          if(activeClarifications.has(id))fail(409,'CLARIFY_BUSY','请等待当前整理完成');
          if(!b.hidden&&d.moderatedAt&&d.status==='open'&&d.kind!=='announcement'&&r.owner_id)points.requireSlot(r.owner_id,'publishing');
          if(b.hidden){d.moderatedAt=new Date().toISOString();d.moderationReason=b.reason.trim();}else{delete d.moderatedAt;delete d.moderationReason;}save(r,d);
        }else{
          const table=type==='posts'?'care_posts':'care_comments',row=get(`SELECT id FROM ${table} WHERE id=? AND removed_at IS NULL`,id);if(!row)fail(404,'NOT_FOUND','公开内容不存在');run(`UPDATE ${table} SET moderated_at=?,moderation_reason=? WHERE id=?`,b.hidden?new Date().toISOString():null,b.hidden?b.reason.trim():'',id);
        }
        audit(user,b.hidden?'hide_content':'restore_content',type,id,b.reason||'');
      });
      if(type==='tasks'&&!b.hidden){difficulty.enqueue(id);matching.enqueue(id);void wakeBackground();}
      json(res,200,{ok:true});return true;
    }
    if(path==='/api/admin/official'&&method==='GET'){
      json(res,200,{items:all('SELECT * FROM requests ORDER BY rowid DESC').filter(r=>{const d=JSON.parse(r.data);return d.source==='official'&&!d.isDemo&&!d.deletedAt&&d.status!=='draft';}).map(officialView)});return true;
    }
    if(path==='/api/admin/official'&&method==='POST'){
      const b=await body(req);requireAdmin(user);requirePublishing(db,user.id);const d=officialBody(b,{...base(),kind:'announcement',source:'official',visibility:'company',anonymous:false,status:'open'}),id=randomUUID();
      transaction(()=>{if(d.kind==='bounty')points.requireSlot(user.id,'publishing');officialMedia.bindImages([],[d.coverMediaId,d.rewardMediaId],id,user);run('INSERT INTO requests VALUES(?,?,NULL,?)',id,user.id,JSON.stringify(d));audit(user,'publish_official','tasks',id,d.kind);});difficulty.enqueue(id);matching.enqueue(id);void wakeBackground();json(res,201,{item:officialView(get('SELECT * FROM requests WHERE id=?',id))});return true;
    }
    const official=path.match(/^\/api\/admin\/official\/([a-f0-9-]{36})$/i);
    if(official&&method==='PATCH'){
      const b=await body(req);requireAdmin(user);requirePublishing(db,user.id);const r=get('SELECT * FROM requests WHERE id=?',official[1]),current=r&&JSON.parse(r.data);
      if(!current||current.source!=='official'||current.isDemo||current.deletedAt||current.status==='draft')fail(404,'NOT_FOUND','官方发布不存在');
      if(r.claimer_id||current.status!=='open')fail(409,'TASK_ACTIVE','任务已被接取，须保留原始约定');
      const d=officialBody(b,current);transaction(()=>{if(current.kind==='announcement'&&d.kind==='bounty')points.requireSlot(r.owner_id,'publishing');officialMedia.bindImages([current.coverMediaId,current.rewardMediaId],[d.coverMediaId,d.rewardMediaId],r.id,user);save(r,d);audit(user,'edit_official','tasks',r.id);});difficulty.enqueue(r.id);matching.enqueue(r.id);void wakeBackground();json(res,200,{item:officialView(get('SELECT * FROM requests WHERE id=?',r.id))});return true;
    }
    fail(404,'NOT_FOUND','管理接口不存在');
  }
  return {handle};
}
