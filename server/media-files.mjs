import Busboy from 'busboy';
import {randomUUID} from 'node:crypto';
import {createWriteStream,createReadStream} from 'node:fs';
import {mkdir,rm,open,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const fail=(status,code,message)=>Object.assign(new Error(message),{status,code});
export const videoExt=/\.(mp4|webm|mov)$/i;
export function storageUsed(db,userId){return [['attachments','uploader_id'],['care_media','owner_id'],['official_media','owner_id'],['canteen_photos','owner_id']].reduce((total,[table,owner])=>total+(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)?db.prepare(`SELECT coalesce(sum(size),0) n FROM ${table} WHERE ${owner}=?`).get(userId).n:0),0);}
export async function receiveFile(req,{root,maxBytes,limitForName=()=>maxBytes}){
  await mkdir(root,{recursive:true});const path=resolve(root,randomUUID()+'.upload');
  let parser,fileTask,result,failure,activeFile;
  const rejectUpload=e=>{failure??=e;req.unpipe(parser);req.resume();activeFile?.destroy(e);parser?.destroy(e);};
  const aborted=()=>rejectUpload(fail(400,'UPLOAD_ABORTED','上传已中断，请重试'));
  try{
    if(Number(req.headers['content-length'])>maxBytes+65536)throw fail(413,'FILE_TOO_LARGE','上传文件超过大小限制');
    try{parser=Busboy({headers:req.headers,defParamCharset:'utf8',limits:{files:1,fields:0,fileSize:maxBytes,headerPairs:100}});}catch{throw fail(400,'INVALID_UPLOAD','文件上传格式无效');}
    parser.on('file',(field,file,info)=>{
      activeFile=file;file.on('error',()=>{});
      if(field!=='file'||result){file.resume();rejectUpload(fail(400,'FILE_REQUIRED','每次请选择一个文件'));return;}
      const name=String(info.filename||'').replace(/[\\/\x00-\x1f\x7f]/g,'_').trim().slice(0,180);let size=0;
      result={path,name,size:0};const limit=limitForName(name);
      const meter=new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>limit)callback(fail(413,'FILE_TOO_LARGE','文件超过允许大小'));else callback(null,chunk);}});
      file.on('limit',()=>rejectUpload(fail(413,'FILE_TOO_LARGE','文件超过允许大小')));
      fileTask=pipeline(file,meter,createWriteStream(path,{flags:'wx'})).then(()=>{result.size=size;});
      fileTask.catch(rejectUpload);
    });
    parser.on('filesLimit',()=>rejectUpload(fail(400,'FILE_REQUIRED','每次请选择一个文件')));
    parser.on('fieldsLimit',()=>rejectUpload(fail(400,'INVALID_UPLOAD','上传字段无效')));
    req.once('aborted',aborted);req.once('error',aborted);
    await new Promise((done,reject)=>{parser.once('close',done);parser.once('error',reject);req.pipe(parser);});
    await fileTask;
    if(failure)throw failure;
    if(!result||!result.name||!result.size)throw fail(400,'FILE_REQUIRED','请选择非空文件');
    return result;
  }catch(e){
    await fileTask?.catch(()=>{});await rm(path,{force:true});
    throw e.status?e:fail(400,'INVALID_UPLOAD','文件上传未完成或格式无效');
  }finally{req.removeListener('aborted',aborted);req.removeListener('error',aborted);}
}
export async function videoMime(path,name){
  const handle=await open(path,'r');let header;
  try{header=Buffer.alloc(4096);const r=await handle.read(header,0,header.length,0);header=header.subarray(0,r.bytesRead);}finally{await handle.close();}
  if(/\.webm$/i.test(name)&&header.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))&&header.includes(Buffer.from('webm')))return 'video/webm';
  if(/\.(mp4|mov)$/i.test(name)&&header.length>=24&&header.subarray(4,8).toString()==='ftyp')return /\.mov$/i.test(name)?'video/quicktime':'video/mp4';
  throw fail(415,'INVALID_VIDEO','视频格式无法识别，请使用有效的MP4、WebM或MOV视频');
}
export async function serveVideo(req,res,path,mime,name='video',{download=false}={}){
  const {size}=await stat(path);let start=0,end=size-1,partial=false;
  if(req.headers.range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if(match&&(match[1]||match[2])){
      if(!match[1]){const tail=Number(match[2]);start=Math.max(0,size-tail);if(!tail)start=size;}
      else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):end;}
      partial=true;
    }else start=size;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start){res.writeHead(416,{'Content-Range':`bytes */${size}`,'Cache-Control':'private, no-store'});res.end();return;}
  }
  res.writeHead(partial?206:200,{'Content-Type':mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes',...(partial?{'Content-Range':`bytes ${start}-${end}/${size}`}:{ }),'Content-Disposition':`${download?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
  if(req.method==='HEAD'){res.end();return;}
  try{await pipeline(createReadStream(path,{start,end}),res);}catch(e){if(!res.destroyed)throw e;}
}
