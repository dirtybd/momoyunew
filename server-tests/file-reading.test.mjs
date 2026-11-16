import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import sharp from 'sharp';
import {attachmentStore,uploadedBackgroundRequested} from '../server/attachments.mjs';

test('旧附件迁移后不自动发送给AI',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('CREATE TABLE attachments(id TEXT PRIMARY KEY,request_id TEXT,uploader_id TEXT,role TEXT,name TEXT,mime TEXT,size INTEGER,storage_key TEXT,preview_key TEXT,included INTEGER,submission_id TEXT,removed_at TEXT,created_at TEXT)');
    db.prepare('INSERT INTO attachments(id,name) VALUES(?,?)').run('legacy','旧客户资料.pdf');
    const files=attachmentStore(db,tmpdir());assert.equal(files.view(files.get('legacy')).aiEnabled,false);
  }finally{db.close();}
});

test('图片默认需求材料，只有明确指令才能选作上传背景',()=>{
  for(const s of ['请使用刚上传的图片做卡片背景','把这张照片设为背景','卡片背景用刚上传的那张','这张照片做背景'])assert.equal(uploadedBackgroundRequested(s),true,s);
  for(const s of ['根据客户截图里的内容整理需求卡片','这张图片不是背景，请分析里面的问题','不要把截图当作背景','图里的背景设置报错，应该怎么处理'])assert.equal(uploadedBackgroundRequested(s),false,s);
});

test('原生材料传入、缓存与用户隔离，背景不读取，取消阅读、数量和大小边界',async t=>{
  const uploads=[],chats=[];let behavior='ok',selectedCover=null;
  const mock=createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);
    if(req.url==='/v1/files/upload'){
      if(behavior==='reject'){res.writeHead(413);return res.end('private-upstream-details');}
      const form=await new Request('http://localhost/upload',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:bytes}).formData();
      const f=form.get('file'),id=randomUUID();uploads.push({id,user:form.get('user'),name:f.name,bytes:Buffer.from(await f.arrayBuffer())});res.writeHead(201,{'Content-Type':'application/json'});return res.end(JSON.stringify({id}));
    }
    const b=JSON.parse(bytes);chats.push(b);
    for(const f of b.files||[])assert.ok(uploads.some(u=>u.id===f.upload_file_id&&u.user===b.user));
    const answer=JSON.stringify({intent:selectedCover?'style':'help',reply:'已按实际文件处理。',card:null,cardStyle:null,coverAttachmentId:selectedCover,readyForPreview:false});
    res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({event:'message',answer,conversation_id:'remote-'+b.user})+'\n\ndata: '+JSON.stringify({event:'message_end'})+'\n\n');
  });
  mock.listen(0,'127.0.0.1');await once(mock,'listening');
  const dir=mkdtempSync(join(tmpdir(),'momoyu-reading-'));
  const child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,DIFY_BASE_URL:'http://127.0.0.1:'+mock.address().port+'/v1',DIFY_API_KEY:'file-test-only'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{child.kill();if(child.exitCode===null)await once(child,'exit');mock.closeAllConnections();await new Promise(r=>mock.close(r));rmSync(dir,{recursive:true,force:true});});
  let base;for await(const c of child.stdout){const m=String(c).match(/"port":(\d+)/);if(m){base='http://127.0.0.1:'+m[1];break;}}
  const call=async(path,method='GET',body,cookie,expected=200)=>{const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...cookie?{cookie}:{}},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,expected,JSON.stringify(d));return {data:d,cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const account=async username=>(await call('/auth/register','POST',{username,password:'Reading2026',displayName:username,department:'测试'},undefined,201)).cookie;
  const a=await account('alice'),b=await account('bob');
  const draft=async cookie=>(await call('/requests','POST',{},cookie,201)).data.request.id;
  const upload=async(id,name,bytes,cookie=a)=>{const form=new FormData();form.append('file',new Blob([bytes]),name);const r=await fetch(base+`/api/requests/${id}/attachments`,{method:'POST',headers:{cookie},body:form});assert.equal(r.status,201);return(await r.json()).attachment;};
  const uploadPurpose=async(id,name,bytes,purpose,cookie=a)=>{const form=new FormData();form.append('file',new Blob([bytes]),name);const r=await fetch(base+`/api/requests/${id}/attachments?purpose=${purpose}`,{method:'POST',headers:{cookie},body:form});assert.equal(r.status,201);return r.json();};
  const image=await sharp({create:{width:20,height:10,channels:3,background:'#ff9922'}}).png().withExif({IFD0:{Artist:'private-metadata'}}).toBuffer();
  const id=await draft(a),photo=await upload(id,'客户截图.png',image),csv=await upload(id,'数据.csv','item,amount\na,18\nb,24');
  assert.equal(photo.aiEnabled,true);assert.equal(photo.included,false);assert.equal(csv.aiEnabled,true);
  await call('/clarify','POST',{requestId:id,message:'请分析文件中的问题，不要生成卡片'},a);
  assert.equal(uploads.length,2);assert.equal(chats.at(-1).files.length,2);assert.ok(chats.at(-1).query.includes('本轮实际传入内容的材料'));
  for(const f of uploads)assert.ok(chats.at(-1).query.includes('dify-file-ref:'+Buffer.from(JSON.stringify({record_id:f.id})).toString('base64')),'视觉输入也提供原生下载引用');
  const png=uploads.find(f=>f.name==='客户截图.webp');assert.ok(png);assert.equal((await sharp(png.bytes).metadata()).exif,undefined);
  await call('/clarify','POST',{requestId:id,message:'继续解释'},a);assert.equal(uploads.length,2,'同用户同文件复用引用');
  selectedCover=photo.id;
  let r=await call('/clarify','POST',{requestId:id,message:'根据客户截图整理需求卡片'},a);assert.equal(r.data.request.selectedCoverId,null,'无背景授权不能采用模型选择');
  r=await call('/clarify','POST',{requestId:id,message:'把刚上传的图片用作卡片背景'},a);assert.equal(r.data.request.selectedCoverId,photo.id);assert.equal(chats.at(-1).files.length,1,'背景指令不传图片内容');selectedCover=null;
  const coverDraft=await draft(a);
  const dedicated=await uploadPurpose(coverDraft,'专用背景.png',image,'cover');
  assert.equal(dedicated.attachment.aiEnabled,false,'专用背景上传不参与AI阅读');
  assert.equal(dedicated.attachment.included,false);
  assert.equal(dedicated.request.selectedCoverId,dedicated.attachment.id);
  await call('/clarify','POST',{requestId:coverDraft,message:'继续解释'},a);assert.equal(chats.at(-1).files,undefined,'专用背景不会随消息上传给Dify');assert.ok(!uploads.some(u=>u.name.includes('专用背景')),'背景图片没有被上传到Dify');
  await call(`/requests/${id}/attachments/${csv.id}`,'PATCH',{aiEnabled:false},a);
  await call('/clarify','POST',{requestId:id,message:'只回答文字问题'},a);assert.equal(chats.at(-1).files,undefined);
  await call(`/requests/${id}/attachments/${photo.id}`,'PATCH',{aiEnabled:true},a,400);
  await call(`/requests/${id}/attachments/${csv.id}`,'PATCH',{aiEnabled:true},b,404);
  const bid=await draft(b);await upload(bid,'数据.csv','bob-only,99',b);await call('/clarify','POST',{requestId:bid,message:'核对金额'},b);assert.equal(uploads.length,3);assert.notEqual(chats.at(-1).user,chats[0].user);assert.equal(uploads.at(-1).bytes.toString(),'bob-only,99');
  const limited=await draft(a),many=[];for(let i=0;i<11;i++)many.push(await upload(limited,`材料${i}.txt`,'fixture'));
  assert.equal(many.filter(f=>f.aiEnabled).length,10);assert.equal(many.at(-1).aiEnabled,false,'超过本轮上限仍可保存，不静默读取');
  await call('/clarify','POST',{requestId:limited,message:'分析材料'},a);assert.equal(chats.at(-1).files.length,10);
  await call(`/requests/${limited}/attachments/${many[10].id}`,'PATCH',{aiEnabled:true},a,400);
  await call(`/requests/${limited}/attachments/${many[0].id}`,'PATCH',{aiEnabled:false},a);
  await call(`/requests/${limited}/attachments/${many[10].id}`,'PATCH',{aiEnabled:true},a);
  await call('/clarify','POST',{requestId:limited,message:'分析下一批材料'},a);assert.equal(chats.at(-1).files.length,10);
  const large=await draft(a);await upload(large,'大材料.txt',Buffer.alloc(21*1024*1024,65));await call('/clarify','POST',{requestId:large,message:'分析材料'},a);assert.equal(uploads.at(-1).bytes.length,21*1024*1024);
  const aggregate=await draft(a);for(let i=0;i<3;i++)await upload(aggregate,`大批材料${i}.txt`,Buffer.alloc(34*1024*1024,65));
  const beforeLimit=uploads.length;const totalFailure=await call('/clarify','POST',{requestId:aggregate,message:'读取全部材料'},a,413);assert.equal(totalFailure.data.error.code,'AI_TOTAL_SIZE');assert.equal(uploads.length,beforeLimit,'超出总量不发送上游');
  const rejected=await draft(a);await upload(rejected,'无法传入.txt','fixture');behavior='reject';const failure=await call('/clarify','POST',{requestId:rejected,message:'读取文件'},a,413);assert.ok(!JSON.stringify(failure.data).includes('private-upstream-details'));assert.equal((await call(`/requests/${rejected}/messages`,'GET',undefined,a)).data.messages.length,0);
});
