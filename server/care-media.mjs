import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,rm,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {FILE_LIMITS as limits} from '../shared/attachment-limits.mjs';
import {receiveFile,videoExt,videoMime,serveVideo,storageUsed} from './media-files.mjs';
const MAX_FILE_SIZE=limits.careImageBytes;

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export function careMediaStore(db,dataDir){
  db.exec(`CREATE TABLE IF NOT EXISTS care_media(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,post_id TEXT,storage_key TEXT NOT NULL,size INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS care_media_post ON care_media(post_id);`);
  const columns=db.prepare('PRAGMA table_info(care_media)').all();
  if(!columns.some(c=>c.name==='kind'))db.exec("ALTER TABLE care_media ADD COLUMN kind TEXT NOT NULL DEFAULT 'image'");
  if(!columns.some(c=>c.name==='mime'))db.exec("ALTER TABLE care_media ADD COLUMN mime TEXT NOT NULL DEFAULT 'image/webp'");
  const root=resolve(dataDir,'care-media'),get=id=>db.prepare('SELECT * FROM care_media WHERE id=?').get(id);
  const view=m=>({id:m.id,url:'/api/care/media/'+m.id,width:m.width,height:m.height,kind:m.kind||'image',mime:m.mime||'image/webp',size:m.size});
  const list=post=>db.prepare('SELECT * FROM care_media WHERE post_id=? ORDER BY sort_order').all(post).map(view);
  function validate(ids,userId,postId=null){
    if(!Array.isArray(ids)||ids.length>limits.careMediaCount||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[-a-f0-9]{36}$/i.test(id)))fail(400,'INVALID_MEDIA','最多选择9项不同的照片或视频。');
    let videos=0;
    for(const id of ids){const m=get(id);if(!m||m.owner_id!==userId||(m.post_id&&m.post_id!==postId))fail(404,'MEDIA_NOT_FOUND','照片不存在或不能用于这条帖子。');}
    for(const id of ids)if(get(id).kind==='video')videos++;
    if(videos>limits.careVideoCount)fail(400,'VIDEO_COUNT','每条帖子最多3个视频');
  }
  function bind(ids,userId,postId){
    validate(ids,userId,postId);db.prepare('UPDATE care_media SET post_id=NULL WHERE post_id=?').run(postId);
    ids.forEach((id,index)=>db.prepare('UPDATE care_media SET post_id=?,sort_order=? WHERE id=?').run(postId,index,id));
  }
  async function handle(req,res,url,user,json){
    if(url.pathname==='/api/care/media'&&req.method==='GET'){json(res,200,{items:db.prepare('SELECT * FROM care_media WHERE owner_id=? AND post_id IS NULL ORDER BY created_at DESC LIMIT 30').all(user.id).map(view)});return true;}
    if(url.pathname==='/api/care/media'&&req.method==='POST'){
      if(db.prepare('SELECT count(*) n FROM care_media WHERE owner_id=? AND post_id IS NULL').get(user.id).n>=30)fail(413,'MEDIA_COUNT','未发布照片已达30张，请先整理。');
      const used=()=>storageUsed(db,user.id);
      if(used()>=limits.storageBytes)fail(413,'STORAGE_LIMIT','个人附件空间已达1GB。');
      const file=await receiveFile(req,{root,maxBytes:limits.careVideoBytes,limitForName:name=>videoExt.test(name)?Math.min(limits.careVideoBytes,limits.storageBytes-used()):MAX_FILE_SIZE});
      const id=randomUUID(),isVideo=videoExt.test(file.name),key=id+(isVideo?'.bin':'.webp');let output,mime='image/webp';
      try{
      if(isVideo){mime=await videoMime(file.path,file.name);output={size:file.size,width:0,height:0};await rename(file.path,resolve(root,key));}
      else{if(!file.name.match(/\.(png|jpe?g|webp|gif)$/i))fail(415,'INVALID_IMAGE','请选择图片或MP4/WebM/MOV视频');try{
        const image=sharp(await readFile(file.path),{limitInputPixels:40000000,animated:false});
        const meta=await image.metadata();if(!['jpeg','png','webp','gif'].includes(meta.format))throw Error('format');
        const converted=await image.rotate().resize({width:2000,height:2400,fit:'inside',withoutEnlargement:true}).webp({quality:86}).toBuffer({resolveWithObject:true});
        output={size:converted.data.length,width:converted.info.width,height:converted.info.height};await writeFile(resolve(root,key),converted.data,{flag:'wx'});
      }catch{fail(415,'INVALID_IMAGE','照片无法读取或像素过大，请换一张。');}}
        if(db.prepare('SELECT count(*) n FROM care_media WHERE owner_id=? AND post_id IS NULL').get(user.id).n>=30)fail(413,'MEDIA_COUNT','未发布照片已达30张，请先整理。');
        if(used()+output.size>limits.storageBytes)fail(413,'STORAGE_LIMIT','个人附件空间不足。');
        db.prepare('INSERT INTO care_media(id,owner_id,post_id,storage_key,size,width,height,sort_order,created_at,kind,mime) VALUES (?,?,NULL,?,?,?,?,0,?,?,?)').run(id,user.id,key,output.size,output.width,output.height,new Date().toISOString(),isVideo?'video':'image',mime);
      }catch(e){await rm(resolve(root,key),{force:true});throw e;}finally{await rm(file.path,{force:true});}
      json(res,201,{media:view(get(id))});return true;
    }
    const match=url.pathname.match(/^\/api\/care\/media\/([a-f0-9-]{36})$/i);if(!match)return false;
    const media=get(match[1]);if(!media)fail(404,'NOT_FOUND','照片不存在');
    if(['GET','HEAD'].includes(req.method)){
      if(media.owner_id!==user.id&&(!media.post_id||!db.prepare('SELECT 1 FROM care_posts WHERE id=? AND removed_at IS NULL AND moderated_at IS NULL').get(media.post_id)))fail(404,'NOT_FOUND','照片不存在');
      if(media.kind==='video'){await serveVideo(req,res,resolve(root,media.storage_key),media.mime,'video.'+(media.mime==='video/webm'?'webm':media.mime==='video/quicktime'?'mov':'mp4'));return true;}
      const bytes=await readFile(resolve(root,media.storage_key));res.writeHead(200,{'Content-Type':'image/webp','Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);return true;
    }
    if(req.method==='DELETE'){
      if(media.owner_id!==user.id||media.post_id)fail(404,'NOT_FOUND','未发布照片不存在');
      db.prepare('DELETE FROM care_media WHERE id=?').run(media.id);await rm(resolve(root,media.storage_key),{force:true});json(res,200,{ok:true});return true;
    }
    return false;
  }
  return {list,validate,bind,handle};
}
