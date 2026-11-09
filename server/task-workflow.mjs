import {randomUUID} from 'node:crypto';
import {requirePublishing} from './accounts.mjs';
import {FILE_LIMITS} from '../shared/attachment-limits.mjs';
import {DIFFICULTY_REWARD_POLICY} from '../shared/task-limits.mjs';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const limitedText=(value,max=4000)=>typeof value==='string'&&value.length<=max;
export function taskWorkflow({db,files,body,json,card,save,base,activeClarifications,points,difficulty,wakeBackground}) {
  const get=id=>db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  const data=row=>JSON.parse(row.data);
  const participant=(row,user)=>!!user&&(row.owner_id===user.id||row.claimer_id===user.id);
  const requireRow=(id,user)=>{const row=get(id);if(!row||!participant(row,user))fail(404,'NOT_FOUND','需求不存在');return row;};
  const history=id=>db.prepare('SELECT * FROM submissions WHERE request_id=? ORDER BY version DESC').all(id).map(s=>({id:s.id,version:s.version,note:s.note,createdAt:s.created_at,decision:s.decision,feedback:s.feedback,reviewedAt:s.reviewed_at,files:db.prepare('SELECT * FROM attachments WHERE submission_id=? AND removed_at IS NULL ORDER BY rowid').all(s.id).map(files.view)}));
  const sourceFiles=(row,user)=>files.list(row.id,'material').filter(f=>row.owner_id===user?.id||f.included).map(files.view);
  function summary(row,user) {
    const d=data(row),cover=d.coverFileId&&files.get(d.coverFileId),reward=d.rewardFileId&&files.get(d.rewardFileId),grade=difficulty.state(row.id);
    return {difficulty:grade,rewardPoints:d.rewardPolicy===DIFFICULTY_REWARD_POLICY&&!row.claimer_id&&!d.isDemo?grade.score:d.rewardPoints,rewardText:d.rewardText||'',rewardFileId:undefined,rewardImage:d.source==='official'&&d.rewardMediaId?{url:'/api/official/media/'+d.rewardMediaId}:reward?{url:`/api/requests/${row.id}/reward-image?v=${reward.id}`}:null,selectedRewardId:row.owner_id===user?.id?(reward?.id||null):null,awardedPoints:points.awarded(row.id),coverFileId:undefined,selectedCoverId:row.owner_id===user?.id?(cover?.id||null):null,cardCover:d.source==='official'&&d.coverMediaId?{url:'/api/official/media/'+d.coverMediaId}:cover?{url:`/api/requests/${row.id}/cover?v=${cover.id}`} :null,materialFileCount:files.list(row.id,'material').filter(f=>f.included).length,
      materialFiles:participant(row,user)?sourceFiles(row,user):[],canEdit:d.source!=='official'&&row.owner_id===user?.id&&!d.deletedAt&&['draft','open'].includes(d.status),canArchive:d.source!=='official'&&row.owner_id===user?.id&&!d.deletedAt&&['draft','open','completed'].includes(d.status),canSubmit:row.claimer_id===user?.id&&['claimed','changes_requested'].includes(d.status),canReview:row.owner_id===user?.id&&d.status==='submitted'};
  }
  function applyImage(row,d,id,user,field) {
    if(id===null){delete d[field];return;}
    const f=typeof id==='string'&&files.get(id);
    if(!f||f.request_id!==row.id||f.uploader_id!==user.id||f.role!=='material'||!f.preview_key)fail(400,'INVALID_IMAGE','请选择这份需求中本人上传的图片。');
    d[field]=f.id;
    db.prepare('UPDATE attachments SET ai_enabled=0,included=0 WHERE id=?').run(f.id);
  }
  const applyCover=(row,d,id,user)=>applyImage(row,d,id,user,'coverFileId');
  const applyReward=(row,d,id,user)=>applyImage(row,d,id,user,'rewardFileId');
  function workspace(row,user) {
    return {request:card(row,user),materials:sourceFiles(row,user),pendingFiles:row.claimer_id===user.id?files.list(row.id,'deliverable').filter(f=>!f.submission_id).map(files.view):[],submissions:history(row.id)};
  }
  function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
  async function handle(req,res,path,user) {
    const method=req.method;
    if(path==='/api/requests'&&method==='POST'){
      if(!user)fail(401,'UNAUTHORIZED','请先登录');
      const b=await body(req);if(Object.keys(b).length)fail(400,'INVALID_FIELD','新草稿不接受其他字段');
      const id=randomUUID();db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(id,user.id,null,JSON.stringify(base()));json(res,201,{request:card(get(id),user)});return true;
    }
    const download=path.match(/^\/api\/attachments\/([^/]+)(?:\/(preview|play))?$/);
    if(download&&['GET','HEAD'].includes(method)){
      const f=files.get(download[1]),row=f&&get(f.request_id);
      if(!f||!files.canRead(f,row,user))fail(404,'NOT_FOUND','文件不存在或暂不可下载');
      await files.serve(res,f,{preview:download[2]==='preview',play:download[2]==='play',req});return true;
    }
    const m=path.match(/^\/api\/requests\/([^/]+)\/(attachments|workspace|submit|review|cover|reward-image|archive|restore)(?:\/([^/]+))?$/);
    if(!m)return false;
    const [,id,action,fileId]=m;
    if(['cover','reward-image'].includes(action)&&['GET','HEAD'].includes(method)){
      const row=get(id);if(!row)fail(404,'NOT_FOUND','卡片不存在');const d=data(row);
      if((d.deletedAt||d.moderatedAt||d.status==='draft'||d.visibility!=='company')&&row.owner_id!==user?.id&&row.claimer_id!==user?.id)fail(404,'NOT_FOUND','卡片不存在');
      const imageId=d[action==='cover'?'coverFileId':'rewardFileId'],f=imageId&&files.get(imageId);
      if(f){await files.serve(res,f,{preview:true});return true;}
      if(action==='reward-image')fail(404,'NOT_FOUND','暂无报酬图片');
      if(!d.cardArtwork)fail(404,'NOT_FOUND','暂无卡片背景');
      res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});res.end(d.cardArtwork.svg);return true;
    }
    if(!user)fail(401,'UNAUTHORIZED','请先登录');
    let row=requireRow(id,user),d=data(row);
    if(['archive','restore'].includes(action)&&method==='POST'){
      const b=await body(req);row=requireRow(id,user);d=data(row);
      if(row.owner_id!==user.id)fail(403,'FORBIDDEN','只有发布者可以管理卡片。');
      if(d.source==='official')fail(403,'OFFICIAL_EDITOR','官方内容请在管理后台下架或恢复');
      if(b.confirmed!==true)fail(400,'CONFIRM_REQUIRED','请确认此操作。');
      if(!['draft','open','completed'].includes(d.status)||(d.status!=='completed'&&row.claimer_id))fail(409,'TASK_ACTIVE','任务已被接取，需保留协作与交付记录，不能移除。');
      if(activeClarifications.has(id))fail(409,'CLARIFY_BUSY','请等待本轮对话完成。');
      if(action==='restore'&&d.status==='open')requirePublishing(db,user.id);
      transaction(()=>{if(action==='archive')d.deletedAt=new Date().toISOString();else{if(d.status==='open')points.requireSlot(user.id,'publishing');delete d.deletedAt;}save(row,d);});
      if(action==='restore'){difficulty.enqueue(id);void wakeBackground();}json(res,200,{request:card(get(id),user)});return true;
    }
    if(d.deletedAt&&action!=='workspace')fail(409,'ARCHIVED','请先从已移除列表恢复卡片。');
    if(action==='workspace'&&method==='GET'){json(res,200,workspace(row,user));return true;}
    if(action==='attachments'&&method==='POST'&&!fileId){
      const role=row.owner_id===user.id?'material':'deliverable';
      if(role==='material'&&!['draft','open','claimed','changes_requested','submitted'].includes(d.status))fail(409,'TASK_CLOSED','已完成或取消的任务不能追加材料。');
      if(role==='deliverable'&&!['claimed','changes_requested'].includes(d.status))fail(409,'CANNOT_SUBMIT','请在进行中或需要修改时上传成果。');
      const f=await files.upload(req,row,user,role);
      row=requireRow(id,user);d=data(row);
      if(d.deletedAt||['completed','cancelled'].includes(d.status)||(role==='deliverable'&&!['claimed','changes_requested'].includes(d.status))){db.prepare('UPDATE attachments SET removed_at=? WHERE id=?').run(new Date().toISOString(),f.id);fail(409,'TASK_CHANGED','任务状态已变化，请刷新后再上传。');}
      json(res,201,{attachment:files.view(f),...workspace(row,user)});return true;
    }
    if(action==='attachments'&&fileId&&['PATCH','DELETE'].includes(method)){
      const b=method==='PATCH'?await body(req):{};row=requireRow(id,user);d=data(row);if(d.deletedAt)fail(409,'ARCHIVED','请先恢复卡片。');const f=files.get(fileId);
      if(!f||f.request_id!==id||f.uploader_id!==user.id)fail(404,'NOT_FOUND','附件不存在');
      if(f.submission_id||!(f.role==='material'?['draft','open'].includes(d.status):['claimed','changes_requested'].includes(d.status)))fail(409,'FILE_LOCKED','已接取任务的材料和已提交的成果需保留历史；可以另行补充文件。');
      if(activeClarifications.has(id))fail(409,'CLARIFY_BUSY','请等待本轮对话完成后再修改附件。');
      if(method==='DELETE'){
        db.prepare('UPDATE attachments SET removed_at=? WHERE id=?').run(new Date().toISOString(),f.id);
        if(d.coverFileId===f.id||d.rewardFileId===f.id){if(d.coverFileId===f.id)delete d.coverFileId;if(d.rewardFileId===f.id)delete d.rewardFileId;save(row,d);}
      }else{
        if(!Object.keys(b).length||Object.keys(b).some(k=>!['included','aiEnabled'].includes(k))||f.role!=='material'||Object.values(b).some(v=>typeof v!=='boolean'))fail(400,'INVALID_FIELD','附件设置无效');
        if(b.aiEnabled!==undefined){
          if(d.status!=='draft'||(b.aiEnabled&&(!files.view(f).aiReadable||d.coverFileId===f.id||d.rewardFileId===f.id)))fail(400,'INVALID_AI_FILE','AI阅读只适用于草稿需求材料；背景和报酬图片不参与阅读。');
          if(b.aiEnabled&&!f.ai_enabled&&files.list(id,'material').filter(m=>m.ai_enabled&&m.id!==d.coverFileId).length>=FILE_LIMITS.aiCount)fail(400,'AI_FILE_LIMIT','每轮最多读取10个材料，请先取消其他附件的AI阅读。');
          db.prepare('UPDATE attachments SET ai_enabled=? WHERE id=?').run(b.aiEnabled?1:0,f.id);
        }
        if(b.included!==undefined)db.prepare('UPDATE attachments SET included=? WHERE id=?').run(b.included?1:0,f.id);
      }
      json(res,200,workspace(get(id),user));return true;
    }
    if(action==='cover'&&method==='POST'){
      const b=await body(req);row=requireRow(id,user);d=data(row);
      if(d.deletedAt||row.owner_id!==user.id||d.status!=='draft')fail(409,'NOT_DRAFT','只能修改本人草稿的背景。');
      if(activeClarifications.has(id))fail(409,'CLARIFY_BUSY','请等待本轮对话完成后再更换背景。');
      if(Object.keys(b).some(k=>k!=='attachmentId')||!(b.attachmentId===null||typeof b.attachmentId==='string'))fail(400,'INVALID_FIELD','请选择背景图片');
      applyCover(row,d,b.attachmentId,user);save(row,d);json(res,200,workspace(get(id),user));return true;
    }
    if(action==='submit'&&method==='POST'){
      const b=await body(req);row=requireRow(id,user);d=data(row);
      if(row.claimer_id!==user.id)fail(403,'FORBIDDEN','只有接取者能提交成果。');
      if(!['claimed','changes_requested'].includes(d.status))fail(409,'CANNOT_SUBMIT','当前任务不能重复提交，请等待发布者验收。');
      if(Object.keys(b).some(k=>!['note','attachmentIds'].includes(k))||!limitedText(b.note)||!Array.isArray(b.attachmentIds)||b.attachmentIds.length>20||new Set(b.attachmentIds).size!==b.attachmentIds.length)fail(400,'INVALID_FIELD','请填写提交说明并选择有效成果文件，最多20个。');
      if(!b.note.trim()&&!b.attachmentIds.length)fail(400,'EMPTY_SUBMISSION','请填写成果说明或上传成果文件。');
      for(const id of b.attachmentIds){const f=typeof id==='string'&&files.get(id);if(!f||f.request_id!==row.id||f.uploader_id!==user.id||f.role!=='deliverable'||f.submission_id)fail(400,'INVALID_FILE','成果文件必须是这份任务中本人尚未提交的附件。');}
      const submissionId=randomUUID(),createdAt=new Date().toISOString();
      transaction(()=>{
        const version=db.prepare('SELECT coalesce(max(version),0)+1 AS next FROM submissions WHERE request_id=?').get(row.id).next;
        db.prepare('INSERT INTO submissions(id,request_id,version,note,created_at) VALUES(?,?,?,?,?)').run(submissionId,row.id,version,b.note.trim(),createdAt);
        for(const id of b.attachmentIds)db.prepare('UPDATE attachments SET submission_id=? WHERE id=?').run(submissionId,id);
        d.status='submitted';save(row,d);
      });
      json(res,200,workspace(get(id),user));return true;
    }
    if(action==='review'&&method==='POST'){
      const b=await body(req);row=requireRow(id,user);d=data(row);
      if(row.owner_id!==user.id)fail(403,'FORBIDDEN','只有发布者能验收成果。');
      if(d.status!=='submitted')fail(409,'CANNOT_REVIEW','当前没有待验收的提交。');
      if(Object.keys(b).some(k=>!['submissionId','decision','feedback','confirmed'].includes(k))||!['approve','changes_requested'].includes(b.decision)||!limitedText(b.feedback,2000))fail(400,'INVALID_FIELD','验收内容无效');
      const latest=db.prepare('SELECT * FROM submissions WHERE request_id=? ORDER BY version DESC LIMIT 1').get(id);
      if(!latest||latest.id!==b.submissionId||latest.decision)fail(409,'STALE_SUBMISSION','提交版本已变化，请刷新后验收。');
      if(b.decision==='approve'&&b.confirmed!==true)fail(400,'CONFIRM_REQUIRED','请确认验收完成。');
      if(b.decision==='changes_requested'&&!b.feedback.trim())fail(400,'FEEDBACK_REQUIRED','请说明需要修改的内容。');
      const time=new Date().toISOString();
      transaction(()=>{
        db.prepare('UPDATE submissions SET decision=?,feedback=?,reviewed_at=? WHERE id=?').run(b.decision,b.feedback.trim(),time,latest.id);
        d.status=b.decision==='approve'?'completed':'changes_requested';if(d.status==='completed'){d.completedAt=time;points.award(row,d,time);}save(row,d);
      });
      json(res,200,workspace(get(id),user));return true;
    }
    return false;
  }
  return {handle,summary,applyCover,applyReward,sourceFiles};
}
