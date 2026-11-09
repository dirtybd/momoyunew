import {randomUUID} from 'node:crypto';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {FILE_LIMITS} from '../shared/attachment-limits.mjs';
import {receiveFile,storageUsed} from './media-files.mjs';
import {accountAccess} from './accounts.mjs';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export function officialMediaStore({db,dataDir,json}){
  db.exec('CREATE TABLE IF NOT EXISTS official_media(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,request_id TEXT,storage_key TEXT NOT NULL,size INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,created_at TEXT NOT NULL)');
  const root=resolve(dataDir,'official-media'),get=id=>db.prepare('SELECT * FROM official_media WHERE id=?').get(id);
  const view=f=>({id:f.id,url:'/api/official/media/'+f.id,width:f.width,height:f.height,size:f.size});
  function bindImages(currentIds,nextIds,requestId,user){
    const current=new Set(currentIds.filter(Boolean)),next=new Set(nextIds.filter(Boolean));
    for(const id of next){const f=get(id);if(!f||f.request_id&&f.request_id!==requestId||!current.has(id)&&f.owner_id!==user.id)fail(404,'MEDIA_NOT_FOUND','请选择本人上传且未用于其他发布的图片');}
    for(const id of current)if(!next.has(id))db.prepare('UPDATE official_media SET request_id=NULL WHERE id=? AND request_id=?').run(id,requestId);
    for(const id of next)db.prepare('UPDATE official_media SET request_id=? WHERE id=?').run(requestId,id);
  }
  async function handleAdmin(req,res,url,user){
    if(url.pathname==='/api/admin/official/media'&&req.method==='GET'){json(res,200,{items:db.prepare('SELECT * FROM official_media WHERE owner_id=? AND request_id IS NULL ORDER BY rowid DESC').all(user.id).map(view)});return true;}
    if(url.pathname==='/api/admin/official/media'&&req.method==='POST'){
      const count=()=>db.prepare('SELECT count(*) n FROM official_media WHERE owner_id=? AND request_id IS NULL').get(user.id).n;
      if(count()>=30)fail(413,'MEDIA_COUNT','未使用背景已达30张，请先整理');
      const file=await receiveFile(req,{root,maxBytes:FILE_LIMITS.careImageBytes});const id=randomUUID(),path=resolve(root,id+'.webp');
      try{
        if(!/\.(png|jpe?g|webp|gif)$/i.test(file.name))fail(415,'INVALID_IMAGE','背景仅支持PNG、JPG、WebP或GIF图片');
        let image;try{const source=sharp(await readFile(file.path),{limitInputPixels:40000000,animated:false});const meta=await source.metadata();if(!['png','jpeg','webp','gif'].includes(meta.format))throw Error('format');image=await source.rotate().resize({width:2400,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer({resolveWithObject:true});}catch{fail(415,'INVALID_IMAGE','图片无法读取或像素过大');}
        await writeFile(path,image.data,{flag:'wx'});
        const access=accountAccess(db,user.id);if(!access.enabled||access.role==='employee')fail(403,'ADMIN_REQUIRED','管理员权限已失效');
        if(count()>=30||storageUsed(db,user.id)+image.data.length>FILE_LIMITS.storageBytes)fail(413,'STORAGE_LIMIT','背景数量或个人空间已达上限');
        db.prepare('INSERT INTO official_media VALUES(?,?,NULL,?,?,?,?,?)').run(id,user.id,id+'.webp',image.data.length,image.info.width,image.info.height,new Date().toISOString());
        json(res,201,{media:view(get(id))});return true;
      }catch(e){await rm(path,{force:true});throw e;}finally{await rm(file.path,{force:true});}
    }
    const match=url.pathname.match(/^\/api\/admin\/official\/media\/([a-f0-9-]{36})$/i);
    if(match&&req.method==='DELETE'){const f=get(match[1]);if(!f||f.owner_id!==user.id||f.request_id)fail(404,'NOT_FOUND','未使用背景不存在');db.prepare('DELETE FROM official_media WHERE id=?').run(f.id);await rm(resolve(root,f.storage_key),{force:true});json(res,200,{ok:true});return true;}
    return false;
  }
  async function handle(req,res,url,user){
    const match=url.pathname.match(/^\/api\/official\/media\/([a-f0-9-]{36})$/i);if(!match||!['GET','HEAD'].includes(req.method))return false;
    const f=get(match[1]);if(!f)fail(404,'NOT_FOUND','背景不存在');
    const row=f.request_id&&db.prepare('SELECT owner_id,claimer_id,data FROM requests WHERE id=?').get(f.request_id),d=row&&JSON.parse(row.data),access=user&&accountAccess(db,user.id);
    const bound=d&&d.source==='official'&&[d.coverMediaId,d.rewardMediaId].includes(f.id);
    const published=bound&&d.visibility==='company'&&d.status!=='draft'&&!d.deletedAt&&(!d.moderatedAt||access?.enabled&&access.role!=='employee');
    const participant=bound&&user&&(row.owner_id===user.id||row.claimer_id===user.id);
    if(f.owner_id!==user?.id&&!published&&!participant)fail(404,'NOT_FOUND','图片不存在');
    const bytes=await readFile(resolve(root,f.storage_key));res.writeHead(200,{'Content-Type':'image/webp','Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);return true;
  }
  return {handle,handleAdmin,bindImages};
}
