import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {parseDifyAnswer} from '../server/dify.mjs';

test('关怀预览协议兼容旧响应，危机不返回预览',()=>{
  const make=(extra)=>JSON.stringify({reply:'合成测试回复',intent:'care',card:null,readyForPreview:true,...extra});
  const support=parseDifyAnswer(make({careSafety:'support',careCard:{title:'合成标题',content:'合成内容'}}));
  assert.equal(support.ready,true);assert.equal(support.card,null);assert.equal(support.careCard.title,'合成标题');
  const urgent=parseDifyAnswer(make({careSafety:'urgent',careCard:{title:'合成标题',content:'合成内容'}}));
  assert.equal(urgent.careCard,null);assert.equal(urgent.ready,false);
  assert.throws(()=>parseDifyAnswer(make({careSafety:'support',careCard:{title:'x',content:'y',owner:'x'}})),{code:'DIFY_CARD_FORMAT'});
});

test('独立关怀接口审核、匿名、隔离、软移除与限频',async t=>{
  let reviewMode='allow';const seen=[];
  const mock=createServer(async(req,res)=>{
    let s='';for await(const c of req)s+=c;const b=JSON.parse(s);if(b.inputs?.review_json)seen.push(JSON.parse(b.inputs.review_json));
    if(reviewMode==='fail'){res.writeHead(503);return res.end();}
    const review={allow:reviewMode==='allow',urgent:reviewMode==='urgent',reason:'合成审核结果'};
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:{status:'succeeded',outputs:{review_result_json:JSON.stringify(review),matches_json:'[]'}}}));
  });mock.listen(0,'127.0.0.1');await once(mock,'listening');
  const dir=mkdtempSync(join(tmpdir(),'momoyu-care-'));
  const child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,DIFY_API_KEY:'',DIFY_MATCHING_BASE_URL:`http://127.0.0.1:${mock.address().port}/v1`,DIFY_MATCHING_API_KEY:'synthetic-test-key'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}mock.closeAllConnections();await new Promise(r=>mock.close(r));rmSync(dir,{recursive:true,force:true});});
  let base,out='';for await(const chunk of child.stdout){out+=chunk;const m=out.match(/"port":(\d+)/);if(m){base=`http://127.0.0.1:${m[1]}`;break;}}assert.ok(base);
  const call=async(path,method='GET',value,cookie)=>{const r=await fetch(base+'/api'+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:value===undefined?undefined:JSON.stringify(value)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const register=async username=>call('/auth/register','POST',{username,password:'password123',displayName:username,department:'虚拟部门',skillDescription:'合成技能说明'});
  const alice=await register('虚拟甲'),bob=await register('虚拟乙'),other=await register('虚拟丙');
  assert.equal(alice.data.user.skillDescription,'合成技能说明');
  assert.equal((await call('/profile','PUT',{skillDescription:'x'.repeat(2001)},alice.cookie)).status,400);
  const mixed=await call('/clarify','POST',{message:'合成测试：压力大，帮我写周报'},alice.cookie);
  assert.equal(mixed.data.intent,'help'); assert.equal(mixed.data.hasCard,false);
  assert.equal((await call('/care/posts')).status,401);
  assert.equal((await call('/care/posts','POST',{title:'合成标题',content:'合成内容'},alice.cookie)).status,400);
  reviewMode='fail';assert.equal((await call('/care/posts','POST',{title:'合成标题',content:'合成内容',confirmed:true},alice.cookie)).status,503);
  assert.equal((await call('/care/posts','GET',undefined,alice.cookie)).data.items.length,0);
  reviewMode='urgent';assert.equal((await call('/care/posts','POST',{title:'合成标题',content:'合成危机模拟',confirmed:true},alice.cookie)).status,422);
  reviewMode='allow';const post=await call('/care/posts','POST',{title:'合成标题',content:'合成倾诉文本',confirmed:true},alice.cookie);assert.equal(post.status,201);
  assert.deepEqual(Object.keys(post.data.post).sort(),['anonymous','commentCount','commentsEnabled','content','createdAt','id','isMine','kind','likeCount','liked','photos','title','updatedAt'].sort());
  assert.equal(post.data.post.anonymous,true);const id=post.data.post.id;
  const view=await call('/care/posts/'+id,'GET',undefined,bob.cookie);assert.equal(view.data.post.isMine,false);assert.ok(!JSON.stringify(view.data).includes('虚拟甲'));
  assert.equal((await call('/care/posts/'+id,'PATCH',{title:'非法修改',confirmed:true},bob.cookie)).status,404);
  reviewMode='fail';assert.equal((await call('/care/posts/'+id,'PATCH',{content:'合成修改',confirmed:true},alice.cookie)).status,503);
  assert.equal((await call('/care/posts/'+id,'GET',undefined,bob.cookie)).data.post.content,'合成倾诉文本');
  assert.equal((await call('/care/posts/'+id+'/comments','POST',{content:'合成鼓励'},bob.cookie)).status,503);
  reviewMode='allow';const comment=await call('/care/posts/'+id+'/comments','POST',{content:'合成鼓励'},bob.cookie);assert.equal(comment.status,201);assert.equal(comment.data.comment.authorLabel,'匿名同事');
  assert.equal((await call('/care/comments/'+comment.data.comment.id+'/remove','POST',{confirmed:true},other.cookie)).status,404);
  const report=await call('/care/comments/'+comment.data.comment.id+'/report','POST',{reason:'合成反馈'},other.cookie);assert.equal(report.data.status,'pending');
  assert.equal((await call('/care/comments/'+comment.data.comment.id+'/remove','POST',{confirmed:true},alice.cookie)).status,200);
  assert.equal((await call('/care/posts/'+id+'/comments','GET',undefined,bob.cookie)).data.items.length,0);
  assert.equal((await call('/care/posts/'+id,'PATCH',{commentsEnabled:false,confirmed:true},alice.cookie)).status,200);
  assert.equal((await call('/care/posts/'+id+'/comments','POST',{content:'合成留言'},other.cookie)).status,409);
  await call('/care/posts/'+id,'PATCH',{commentsEnabled:true,confirmed:true},alice.cookie);
  for(let i=0;i<5;i++)assert.equal((await call('/care/posts/'+id+'/comments','POST',{content:'合成留言'+i},other.cookie)).status,201);
  assert.equal((await call('/care/posts/'+id+'/comments','POST',{content:'合成超限'},other.cookie)).status,429);
  assert.ok(seen.every(x=>Object.keys(x).every(k=>['type','title','content'].includes(k))));
  assert.equal((await call('/care/posts/'+id+'/archive','POST',{confirmed:true},bob.cookie)).status,404);
  assert.equal((await call('/care/posts/'+id+'/archive','POST',{confirmed:true},alice.cookie)).status,200);
  assert.equal((await call('/care/posts/'+id,'GET',undefined,alice.cookie)).status,404);
  const db=new DatabaseSync(join(dir,'momoyu.sqlite'));assert.ok(db.prepare('SELECT removed_at FROM care_posts WHERE id=?').get(id).removed_at);assert.equal(db.prepare('SELECT count(*) AS n FROM care_reports').get().n,1);db.close();
});

test('关怀对话的本人恢复、公开脱敏及危机阻止发布',async t=>{
  let mode='support'; const queries=[];
  const mock=createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;
    if(req.url.endsWith('/workflows/run')) {res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({data:{status:'succeeded',outputs:{review_result_json:JSON.stringify({allow:true,urgent:false,reason:'合成审核'}),matches_json:'[]'}}}));}
    queries.push(JSON.parse(body).query);
    const result=mode==='help'?{reply:'合成办公回答',intent:'help',card:null,readyForPreview:false}:{reply:'合成关怀回复',intent:'care',card:null,careCard:{title:'合成私密标题',content:'合成私密内容'},careSafety:mode,readyForPreview:true};
    const frame=x=>'data: '+JSON.stringify(x)+'\n\n';res.writeHead(200,{'content-type':'text/event-stream'});res.end(frame({event:'message',answer:JSON.stringify(result),conversation_id:'synthetic-conversation'})+frame({event:'message_end',conversation_id:'synthetic-conversation'}));
  });mock.listen(0,'127.0.0.1');await once(mock,'listening');
  const dir=mkdtempSync(join(tmpdir(),'momoyu-care-preview-'));
  const child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,DIFY_BASE_URL:`http://127.0.0.1:${mock.address().port}/v1`,DIFY_API_KEY:'synthetic-agent-key',DIFY_MATCHING_BASE_URL:`http://127.0.0.1:${mock.address().port}/v1`,DIFY_MATCHING_API_KEY:'synthetic-review-key',CARD_TOOL_SECRET:'synthetic-secret-32-characters-long'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}mock.closeAllConnections();await new Promise(r=>mock.close(r));rmSync(dir,{recursive:true,force:true});});
  let base,out='';for await(const chunk of child.stdout){out+=chunk;const m=out.match(/"port":(\d+)/);if(m){base=`http://127.0.0.1:${m[1]}`;break;}}assert.ok(base);
  const call=async(path,method='GET',value,cookie)=>{const r=await fetch(base+'/api'+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:value===undefined?undefined:JSON.stringify(value)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const register=async username=>call('/auth/register','POST',{username,password:'password123',displayName:username,department:'合成部门'});
  const a=await register('合成用户一'),b=await register('合成用户二');
  const first=await call('/clarify','POST',{message:'合成倾诉测试'},a.cookie);assert.equal(first.data.intent,'care');assert.equal(first.data.request.problem,'');assert.equal(first.data.carePreview.content,'合成私密内容');
  const id=first.data.request.id;
  assert.equal((await call('/requests/'+id,'GET',undefined,b.cookie)).status,404);
  assert.equal((await call('/requests/'+id+'/messages','GET',undefined,b.cookie)).status,404);
  assert.equal((await call('/requests/'+id,'GET',undefined,a.cookie)).data.request.carePreview.title,'合成私密标题');
  assert.equal((await call('/requests/'+id+'/publish','POST',{confirmed:true},a.cookie)).data.error.code,'CARE_NOT_TASK');
  assert.equal((await call('/care/posts','POST',{title:'合成',content:'合成',confirmed:true,conversationId:id},b.cookie)).status,404);
  mode='help';
  const office=await call('/clarify','POST',{requestId:id,message:'帮我写周报'},a.cookie);
  assert.equal(office.data.intent,'help'); assert.equal(office.data.request.careMode,false);
  assert.equal(office.data.carePreview.content,'合成私密内容'); assert.equal(office.data.careSafety,'support');
  await call('/clarify','POST',{requestId:id,message:'继续写周报'},a.cookie);
  assert.match(queries.at(-1),/本轮 match_token=/);
  const db=new DatabaseSync(join(dir,'momoyu.sqlite'));
  const draftRow=db.prepare('SELECT data FROM requests WHERE id=?').get(id), draftData=JSON.parse(draftRow.data);
  draftData.status='open'; db.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify(draftData),id);
  assert.equal((await call('/care/posts','POST',{title:'合成',content:'合成',confirmed:true,conversationId:id},a.cookie)).status,404);
  draftData.status='draft'; draftData.deletedAt=new Date().toISOString(); db.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify(draftData),id);
  assert.equal((await call('/care/posts','POST',{title:'合成',content:'合成',confirmed:true,conversationId:id},a.cookie)).status,404);
  delete draftData.deletedAt; db.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify(draftData),id);
  const demo=db.prepare("SELECT id,data FROM requests WHERE json_extract(data,'$.isDemo')=1 LIMIT 1").get();const data=JSON.parse(demo.data);data.carePreview={title:'合成私密标题',content:'合成私密内容'};data.careMode=true;data.careSafety='support';db.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify(data),demo.id);db.close();
  const publicView=await call('/requests/'+demo.id,'GET',undefined,b.cookie);assert.equal(publicView.status,200);assert.ok(!JSON.stringify(publicView.data).includes('合成私密'));assert.ok(!('careSafety' in publicView.data.request));
  mode='urgent';const urgent=await call('/clarify','POST',{requestId:id,message:'合成危机测试'},a.cookie);assert.equal(urgent.data.careSafety,'urgent');assert.equal(urgent.data.carePreview,null);assert.equal(urgent.data.readyForPreview,false);
  assert.equal((await call('/requests/'+id,'GET',undefined,a.cookie)).data.request.carePreview,null);
  assert.equal((await call('/care/posts','POST',{title:'合成标题',content:'合成内容',confirmed:true,conversationId:id},a.cookie)).data.error.code,'CARE_URGENT');
  mode='help'; const afterUrgent=await call('/clarify','POST',{requestId:id,message:'帮我写周报'},a.cookie);
  assert.equal(afterUrgent.data.request.careMode,false); assert.equal(afterUrgent.data.careSafety,'urgent');
  assert.equal((await call('/requests/'+id+'/publish','POST',{confirmed:true},a.cookie)).data.error.code,'CARE_NOT_TASK');
  assert.equal((await call('/care/posts','POST',{title:'合成标题',content:'合成内容',confirmed:true,conversationId:id},a.cookie)).data.error.code,'CARE_URGENT');
  mode='support'; const later=await call('/clarify','POST',{requestId:id,message:'合成后续'},a.cookie);
  assert.equal(later.data.careSafety,'urgent'); assert.equal(later.data.carePreview,null); assert.equal(later.data.readyForPreview,false);

});
