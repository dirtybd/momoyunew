import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,rm,stat,rename,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {FILE_LIMITS as limits} from '../shared/attachment-limits.mjs';
import {receiveFile,videoExt,videoMime,serveVideo,storageUsed} from './media-files.mjs';

export const MAX_FILE_SIZE=limits.uploadBytes;
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const imageExt=/\.(png|jpe?g|webp|gif)$/i;
const allowed=/\.(png|jpe?g|webp|gif|mp4|webm|mov|pdf|docx?|xlsx?|pptx?|txt|csv|md|json|xml|zip|7z|rar|dwg|dxf|step|stp|stl|s7p|ap\d{2}|zap\d{2}|zef|zw1)$/i;
const imageMime={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'};
const readable=/\.(png|jpe?g|webp|gif|pdf|docx?|xlsx?|pptx?|txt|csv|md|json|xml)$/i;
export const usesPreviousMaterials=message=>/(?:上次|上一[份个轮次]|之前|前面|刚才).{0,12}(?:文件|材料|文档|表格|译文|结果|生成|翻译)|(?:继续|接着|补充|一起|合并|对比|比较|结合|同时)/.test(message);
export function uploadedBackgroundRequested(message) {
  if(/(?:不要|不是|不能|别把|不用于|不作为).{0,30}(?:背景|封面)/.test(message))return false;
  return /(?:用|把|将|拿).{0,80}(?:图片|照片|截图|上传|这张|那张|\.png|\.jpg).{0,35}(?:作|做|当|设为|设置为|换成).{0,8}(?:背景|封面)/i.test(message)||/(?:图片|照片|这张图|那张图).{0,12}(?:作为|用作|设为|做成|当作|做|当).{0,8}(?:背景|封面)/.test(message)||/(?:背景|封面).{0,10}(?:用|换成).{0,40}(?:上传|图片|照片|这张|那张)/.test(message);
}

export function attachmentStore(db,dataDir) {
  db.exec(`CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL, uploader_id TEXT NOT NULL,
    role TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
    storage_key TEXT NOT NULL, preview_key TEXT, included INTEGER NOT NULL DEFAULT 1,
    submission_id TEXT, removed_at TEXT, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS attachments_request ON attachments(request_id);
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL, version INTEGER NOT NULL, note TEXT NOT NULL,
    created_at TEXT NOT NULL, decision TEXT, feedback TEXT, reviewed_at TEXT,
    UNIQUE(request_id,version)
  );`);
  // Existing uploads stay opt-out; their owners have not yet chosen to send content to AI.
  if(!db.prepare('PRAGMA table_info(attachments)').all().some(c=>c.name==='ai_enabled'))db.exec('ALTER TABLE attachments ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE TABLE IF NOT EXISTS dify_attachment_uploads (
    attachment_id TEXT NOT NULL, scope TEXT NOT NULL, user_id TEXT NOT NULL, upload_id TEXT NOT NULL,
    PRIMARY KEY(attachment_id,scope,user_id)
  )`);
  db.exec('CREATE TABLE IF NOT EXISTS assistant_outputs (message_rowid INTEGER NOT NULL,attachment_id TEXT PRIMARY KEY,native_reference TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS dify_file_deliveries(request_id TEXT NOT NULL,scope TEXT NOT NULL,conversation_id TEXT NOT NULL,attachment_id TEXT NOT NULL,PRIMARY KEY(request_id,scope,conversation_id,attachment_id))');
  const root=resolve(dataDir,'uploads');
  const usedBytes=userId=>storageUsed(db,userId);
  const get=id=>db.prepare('SELECT * FROM attachments WHERE id=? AND removed_at IS NULL').get(id);
  const list=(id,role)=>db.prepare('SELECT * FROM attachments WHERE request_id=? AND role=? AND removed_at IS NULL ORDER BY rowid').all(id,role);
  const view=f=>({id:f.id,name:f.name,size:f.size,mime:f.mime,isImage:!!f.preview_key,isVideo:videoExt.test(f.name),playbackUrl:videoExt.test(f.name)?'/api/attachments/'+f.id+'/play':null,included:!!f.included,aiEnabled:!!f.ai_enabled,aiReadable:readable.test(f.name),createdAt:f.created_at,downloadUrl:'/api/attachments/'+f.id,previewUrl:f.preview_key?'/api/attachments/'+f.id+'/preview':null});
  async function upload(req,row,user,role) {
    const total={bytes:usedBytes(user.id)};
    if(total.bytes>=limits.storageBytes)fail(413,'STORAGE_LIMIT','个人附件空间已达1GB，请联系管理员整理。');
    const count=()=>list(row.id,role).filter(f=>role==='material'||!f.submission_id).length;
    if(count()>=(role==='material'?limits.materialCount:limits.submissionCount))fail(413,'FILE_COUNT',role==='material'?'每个对话或需求最多100个材料附件。':'本次最多提交20个成果文件。');
    const file=await receiveFile(req,{root,maxBytes:limits.videoBytes,limitForName:name=>Math.min(videoExt.test(name)?limits.videoBytes:MAX_FILE_SIZE,limits.storageBytes-total.bytes)});
    const {name}=file,id=randomUUID();let preview=null,mime='application/octet-stream';
    try{
    if(!allowed.test(name))fail(415,'FILE_TYPE','支持图片、MP4/WebM/MOV视频、Office、文本及常见工程文件。');
    if(imageExt.test(name)){
      try{
        const image=sharp(await readFile(file.path),{limitInputPixels:40000000,animated:false}),metadata=await image.metadata();
        mime=imageMime[metadata.format];if(!mime)throw new Error('format');
        preview=await image.rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer();
      }catch{fail(415,'INVALID_IMAGE','图片无法读取，请使用有效的PNG、JPG、WebP或GIF图片。');}
    }else if(videoExt.test(name))mime=await videoMime(file.path,name);
    else if(/\.pdf$/i.test(name)){const handle=await open(file.path,'r');try{const bytes=Buffer.alloc(5);await handle.read(bytes,0,5,0);if(bytes.toString()!=='%PDF-')fail(415,'INVALID_FILE','PDF文件格式无效。');}finally{await handle.close();}mime='application/pdf';}
    else if(/\.(txt|csv|md|json|xml)$/i.test(name))mime='text/plain';
    await mkdir(root,{recursive:true});
    try{
      await rename(file.path,resolve(root,id+'.bin'));
      if(preview)await writeFile(resolve(root,id+'.webp'),preview,{flag:'wx'});
      const current={bytes:usedBytes(user.id)};
      if(current.bytes+file.size>limits.storageBytes||count()>=(role==='material'?limits.materialCount:limits.submissionCount))fail(413,'STORAGE_LIMIT','附件数量或个人空间已达上限。');
      db.prepare('INSERT INTO attachments(id,request_id,uploader_id,role,name,mime,size,storage_key,preview_key,included,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,row.id,user.id,role,name,mime,file.size,id+'.bin',preview?id+'.webp':null,role==='material'&&preview&&['draft','open'].includes(JSON.parse(row.data).status)?0:1,new Date().toISOString());
      if(role==='material'&&JSON.parse(row.data).status==='draft'&&readable.test(name)&&list(row.id,'material').filter(f=>f.ai_enabled).length<limits.aiCount)db.prepare('UPDATE attachments SET ai_enabled=1 WHERE id=?').run(id);
    }catch(e){await rm(resolve(root,id+'.bin'),{force:true});if(preview)await rm(resolve(root,id+'.webp'),{force:true});throw e;}
    return get(id);
    }finally{await rm(file.path,{force:true});}
  }
  function canRead(f,row,user) {
    if(!user||!f||!row||f.request_id!==row.id)return false;
    if(f.role==='assistant')return row.owner_id===user.id&&f.uploader_id===user.id;
    if(f.role==='material')return row.owner_id===user.id || (row.claimer_id===user.id&&!!f.included);
    return row.claimer_id===user.id || (row.owner_id===user.id&&!!f.submission_id);
  }
  async function serve(res,f,{preview=false,req,play=false}={}) {
    if(videoExt.test(f.name)&&req&&!preview){await serveVideo(req,res,resolve(root,f.storage_key),f.mime,f.name,{download:!play});return;}
    if(play)fail(415,'NOT_VIDEO','该附件不是视频');
    if(preview&&!f.preview_key)fail(404,'NOT_FOUND','图片不存在');
    const bytes=await readFile(resolve(root,preview?f.preview_key:f.storage_key));
    res.writeHead(200,{'Content-Type':preview?'image/webp':f.mime,'Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':preview?'inline':`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(f.name)}`});
    res.end(bytes);
  }
  async function aiInputs(row,user,scope,{skipImages=false,ids}={}) {
    if(row.owner_id!==user.id||JSON.parse(row.data).status!=='draft')fail(403,'FORBIDDEN','只能读取本人的草稿材料。');
    const d=JSON.parse(row.data),visualIds=[d.coverFileId,d.rewardFileId];
    const selected=list(row.id,'material').filter(f=>f.ai_enabled&&(ids===undefined||ids.includes(f.id))&&!visualIds.includes(f.id)&&!(skipImages&&f.preview_key));
    if(selected.length>limits.aiCount)fail(400,'AI_FILE_LIMIT','每轮最多读取10个材料，请在管理附件中调整“AI阅读”。');
    const sizes=await Promise.all(selected.map(f=>stat(resolve(root,f.preview_key||f.storage_key))));
    if(sizes.reduce((sum,f)=>sum+f.size,0)>limits.aiTotalBytes)fail(413,'AI_TOTAL_SIZE','本轮AI阅读材料合计最多100MB，请在管理附件中分批选择。');
    return Promise.all(selected.map(async f=>{
      if(!readable.test(f.name))fail(415,'AI_FILE_TYPE','此文件可随需求传递，但暂不支持AI阅读。');
      const isImage=!!f.preview_key,bytes=await readFile(resolve(root,isImage?f.preview_key:f.storage_key));
      if(bytes.length>(isImage?limits.aiImageBytes:limits.aiDocumentBytes))fail(413,'AI_FILE_TOO_LARGE','AI阅读的文档最多50MB，图片预览最多10MB；可取消AI阅读后仅作附件。');
      const cached=db.prepare('SELECT upload_id FROM dify_attachment_uploads WHERE attachment_id=? AND scope=? AND user_id=?').get(f.id,scope,user.id);
      return {id:f.id,name:isImage?f.name.replace(/\.[^.]+$/,'.webp'):f.name,isImage,mime:isImage?'image/webp':f.mime,bytes,uploadId:cached?.upload_id};
    }));
  }
  const cacheUpload=(id,scope,userId,uploadId)=>db.prepare('INSERT OR REPLACE INTO dify_attachment_uploads VALUES(?,?,?,?)').run(id,scope,userId,uploadId);
  const wasDelivered=(requestId,scope,conversationId,id)=>!!conversationId&&!!db.prepare('SELECT 1 FROM dify_file_deliveries WHERE request_id=? AND scope=? AND conversation_id=? AND attachment_id=?').get(requestId,scope,conversationId,id);
  const recordDelivered=(requestId,scope,conversationId,ids)=>{if(conversationId)for(const id of ids||[])db.prepare('INSERT OR IGNORE INTO dify_file_deliveries VALUES(?,?,?,?)').run(requestId,scope,conversationId,id);};
  const sentIds=requestId=>{const ids=new Set();for(const m of db.prepare("SELECT meta FROM messages WHERE request_id=? AND role='user'").all(requestId)){try{for(const f of JSON.parse(m.meta)?.attachments||[])if(f?.id)ids.add(f.id);}catch{}}return [...ids];};
  function taskIds(requestId,currentIds,message){
    const available=list(requestId,'material'),named=available.filter(f=>String(message).includes(f.name)).map(f=>f.id);
    let latest=[];
    for(const m of db.prepare("SELECT meta FROM messages WHERE request_id=? AND role='user' ORDER BY rowid DESC").all(requestId)){
      try{const meta=JSON.parse(m.meta);if(Array.isArray(meta?.taskAttachmentIds)){latest=meta.taskAttachmentIds.filter(id=>available.some(f=>f.id===id));break;}const files=meta?.attachments;if(files?.length){latest=files.map(f=>f.id).filter(id=>available.some(f=>f.id===id));break;}}catch{}
    }
    return [...new Set(currentIds.length?[...currentIds,...named,...(usesPreviousMaterials(message)?latest:[])]:named.length?named:latest)];
  }
  function taskOutputs(row,user,message,currentIds){
    const outputs=outputHistory(row,user),named=outputs.filter(f=>String(message).includes(f.name));
    if(named.length)return named;
    if(/(?:上次|上一[份个轮次]|之前|刚才).{0,12}(?:生成|译文|成果|结果|输出)|(?:继续|修改).{0,8}(?:译文|生成的文件|成果)/.test(message))return outputs;
    if(currentIds.length)return [];
    const latest=db.prepare("SELECT rowid,meta FROM messages WHERE request_id=? AND role='user' ORDER BY rowid DESC").all(row.id).find(m=>{try{return JSON.parse(m.meta)?.attachments?.length;}catch{return false;}});
    return outputs.filter(f=>!latest||db.prepare('SELECT message_rowid FROM assistant_outputs WHERE attachment_id=?').get(f.id)?.message_rowid>latest.rowid);
  }
  const messageFiles=rowid=>db.prepare('SELECT a.* FROM assistant_outputs o JOIN attachments a ON a.id=o.attachment_id WHERE o.message_rowid=? AND a.removed_at IS NULL ORDER BY a.rowid').all(rowid).map(view);
  const outputHistory=(row,user)=>row.owner_id===user.id?db.prepare('SELECT a.id,a.name,o.native_reference AS reference FROM assistant_outputs o JOIN attachments a ON a.id=o.attachment_id WHERE a.request_id=? AND a.removed_at IS NULL ORDER BY a.rowid DESC LIMIT 8').all(row.id):[];
  async function readOutput(id,row,user,scope){
    const f=get(id);
    if(!f||f.role!=='assistant'||f.request_id!==row.id||row.owner_id!==user.id||f.uploader_id!==user.id)fail(404,'NOT_FOUND','此前生成的文件不存在或不可读取。');
    if(f.size>20*1024*1024)fail(413,'OUTPUT_TOO_LARGE','此前生成的文件超过续改读取限制。');
    const cached=db.prepare('SELECT upload_id FROM dify_attachment_uploads WHERE attachment_id=? AND scope=? AND user_id=?').get(f.id,scope,user.id);
    return {name:f.name,mime:f.mime,uploadId:cached?.upload_id,bytes:cached?undefined:await readFile(resolve(root,f.storage_key))};
  }
  async function stageOutputs(row,user,outputs=[]) {
    if(row.owner_id!==user.id)fail(403,'FORBIDDEN','只能保存本人的处理结果。');
    const staged=[];await mkdir(root,{recursive:true});
    const rollback=()=>Promise.all(staged.map(f=>rm(resolve(root,f.id+'.bin'),{force:true})));
    try{
      for(const output of outputs){const id=randomUUID();staged.push({...output,id});await writeFile(resolve(root,id+'.bin'),output.bytes,{flag:'wx'});}
      return {rollback,commit(messageRowid){
        const total=usedBytes(user.id);
        if(total+staged.reduce((n,f)=>n+f.bytes.length,0)>limits.storageBytes)fail(413,'STORAGE_LIMIT','结果文件超过个人1GB空间，请联系管理员整理。');
        for(const f of staged){
          db.prepare('INSERT INTO attachments(id,request_id,uploader_id,role,name,mime,size,storage_key,included,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(f.id,row.id,user.id,'assistant',f.name,f.mime,f.bytes.length,f.id+'.bin',0,new Date().toISOString());
          db.prepare('INSERT INTO assistant_outputs VALUES(?,?,?)').run(messageRowid,f.id,f.nativeReference);
        }
      }};
    }catch(e){await rollback();throw e;}
  }
  return {get,list,view,upload,canRead,serve,aiInputs,cacheUpload,wasDelivered,recordDelivered,sentIds,taskIds,taskOutputs,messageFiles,outputHistory,readOutput,stageOutputs};
}
