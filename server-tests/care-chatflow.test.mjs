import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {parseChatflowPacket,parseDifyAnswer} from '../server/dify.mjs';

const frame=v=>'data: '+JSON.stringify(v)+'\n\n';
const support={reply:'我在听，你想从哪件事说起？',intent:'care',card:null,cardStyle:null,careCard:null,clearCarePreview:false,careSafety:'support',readyForPreview:false};
const packet=value=>({version:1,route:'care',answer_json:JSON.stringify(value),files:[],artifact_json:''});
test('情感回包只接受关怀内容，撤回和危机优先于草稿',()=>{
  assert.equal(parseChatflowPacket(JSON.stringify(packet(support))).parsed.intent,'care');
  for(const p of [{...packet(support),files:[{}]},{...packet(support),artifact_json:'anything'},packet({...support,intent:'help'})])assert.throws(()=>parseChatflowPacket(JSON.stringify(p)));
  const preview={title:'想慢一点',content:'最近有点累，想给自己留点空间。'};
  assert.equal(parseDifyAnswer(JSON.stringify({...support,careCard:preview,clearCarePreview:true,readyForPreview:true})).careCard,null);
  assert.equal(parseDifyAnswer(JSON.stringify({...support,careCard:preview,careSafety:'urgent',readyForPreview:true})).ready,false);
  assert.throws(()=>parseDifyAnswer(JSON.stringify({...support,clearCarePreview:'true'})));
});

test('独立情感流程：私密历史隔离、确认后匿名发布、撤回、危机和办公切换',async t=>{
  const uploads=new Map(),calls=[],reviews=[];let mode='support';
  const preview={title:'给自己一点空间',content:'最近任务有些集中，想慢下来理一理，也想听听大家如何休息。'};
  const upstream=createServer(async(req,res)=>{
    if(req.url==='/v1/files/upload'){
      const chunks=[];for await(const c of req)chunks.push(c);
      const form=await new Response(Buffer.concat(chunks),{headers:{'content-type':req.headers['content-type']}}).formData();
      const f=form.get('file'),id=randomUUID();uploads.set(id,{name:f.name,value:JSON.parse(await f.text())});
      res.setHeader('content-type','application/json');return res.end(JSON.stringify({id}));
    }
    let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);
    if(req.url==='/v1/workflows/run'){
      reviews.push(JSON.parse(b.inputs.review_json));res.setHeader('content-type','application/json');
      return res.end(JSON.stringify({data:{status:'succeeded',outputs:{review_result_json:JSON.stringify({allow:true,urgent:false,reason:'合成审核通过'})}}}));
    }
    assert.equal(req.headers.authorization,'Bearer care-entry-key','新关怀分支不使用原Agent');
    const work=uploads.get(b.inputs.context_file.upload_file_id).value,care=uploads.get(b.inputs.care_context_file.upload_file_id).value;
    calls.push({work,care,route:JSON.parse(b.inputs.route_context)});
    assert.equal(care.job_token,undefined);assert.equal(care.match_token,undefined);assert.equal(care.inputs,undefined);assert.equal(care.card,undefined);
    let result={...support};
    if(mode==='preview')result={...result,careCard:preview,readyForPreview:true};
    if(mode==='withdraw')result={...result,careCard:preview,clearCarePreview:true,readyForPreview:true};
    if(mode==='urgent')result={...result,careCard:preview,careSafety:'urgent',readyForPreview:true};
    let p=packet(result);
    if(mode==='office')p={...p,route:'office',answer_json:JSON.stringify({...support,intent:'help',reply:'周报可以分为完成事项和下一步安排。'})};
    if(mode==='bad')p.artifact_json='forged';
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.end(frame({event:'message',answer:JSON.stringify(p),conversation_id:'care-parent-'+b.user})+frame({event:'message_end'}));
  });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const dir=mkdtempSync(join(tmpdir(),'momoyu-care-entry-'));
  const child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,MATCHING_SCHEDULER:'off',DIFY_ENTRYPOINT:'chatflow',DIFY_CHATFLOW_API_KEY:'care-entry-key',DIFY_CHATFLOW_BASE_URL:`http://127.0.0.1:${upstream.address().port}/v1`,DIFY_API_KEY:'old-key',DIFY_BASE_URL:`http://127.0.0.1:${upstream.address().port}/v1`,DIFY_MATCHING_BASE_URL:`http://127.0.0.1:${upstream.address().port}/v1`,DIFY_MATCHING_API_KEY:'review-key'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}upstream.closeAllConnections();await new Promise(r=>upstream.close(r));rmSync(dir,{recursive:true,force:true});});
  let base;for await(const c of child.stdout){const m=String(c).match(/"port":(\d+)/);if(m){base='http://127.0.0.1:'+m[1];break;}}assert.ok(base);
  const call=async(path,method='GET',body,cookie)=>{const r=await fetch(base+'/api'+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const register=async username=>call('/auth/register','POST',{username,password:'Synthetic2026!',displayName:username,department:'合成验收'});
  const a=await register('care-owner'),b=await register('care-colleague');
  assert.equal((await call('/clarify','POST',{message:'你好',entryMode:'invalid'},a.cookie)).status,400);
  const first=await call('/clarify','POST',{message:'私密标记QA-CARE-7391，只想说说，不公开。',entryMode:'care'},a.cookie);assert.equal(first.status,200);
  assert.equal(calls[0].route.careMode,true);
  const id=first.data.request.id;assert.equal(first.data.carePreview,null);assert.equal(first.data.intent,'care');
  assert.equal((await call('/clarify','POST',{requestId:id,message:'你好',entryMode:'care'},a.cookie)).status,400);
  assert.equal((await call('/requests/'+id+'/messages','GET',undefined,b.cookie)).status,404);
  assert.equal((await call('/requests/'+id,'GET',undefined,b.cookie)).status,404);
  assert.equal((await call('/care/posts','GET',undefined,b.cookie)).data.items.length,0);
  mode='preview';const prepared=await call('/clarify','POST',{requestId:id,message:'帮我整理为匿名心情卡，先不发布。'},a.cookie);
  assert.equal(prepared.data.readyForPreview,true);assert.equal(prepared.data.request.status,'draft');assert.deepEqual(prepared.data.carePreview,preview);
  assert.ok(JSON.stringify(calls.at(-1).care.history).includes('QA-CARE-7391'));
  assert.ok(!JSON.stringify(calls.at(-1).work).includes('QA-CARE-7391'));assert.ok(!JSON.stringify(calls.at(-1).route).includes('QA-CARE-7391'));
  assert.equal((await call('/care/posts','POST',{...preview,conversationId:id,confirmed:false},a.cookie)).status,400);
  assert.equal((await call('/care/posts','POST',{...preview,conversationId:id,confirmed:true},b.cookie)).status,404);
  const published=await call('/care/posts','POST',{...preview,conversationId:id,commentsEnabled:false,confirmed:true},a.cookie);assert.equal(published.status,201);
  const view=await call('/care/posts/'+published.data.post.id,'GET',undefined,b.cookie);assert.equal(view.status,200);assert.equal(view.data.post.anonymous,true);assert.equal(view.data.post.commentsEnabled,false);
  assert.ok(!JSON.stringify(view.data).includes('owner_id'));assert.ok(!JSON.stringify(view.data).includes('QA-CARE-7391'));
  assert.ok(!JSON.stringify(reviews).includes('QA-CARE-7391'),'公开审核只接收本人确认的卡片文字');
  mode='withdraw';const withdrawn=await call('/clarify','POST',{requestId:id,message:'不想分享了，撤回草稿。'},a.cookie);assert.equal(withdrawn.data.carePreview,null);assert.equal(withdrawn.data.readyForPreview,false);
  const count=withdrawn.data.messages.length;mode='bad';const failed=await call('/clarify','POST',{requestId:id,message:'继续私聊'},a.cookie);assert.equal(failed.status,502);
  assert.equal((await call('/requests/'+id+'/messages','GET',undefined,a.cookie)).data.messages.length,count);
  const older=new DatabaseSync(join(dir,'momoyu.sqlite'));
  older.prepare('INSERT INTO messages (request_id,role,content) VALUES (?,?,?)').run(id,'assistant','OLD_PRIVATE_UNTYPED_HISTORY');older.close();
  mode='office';const office=await call('/clarify','POST',{requestId:id,message:'换个话题，帮我写一份周报。'},a.cookie);assert.equal(office.data.intent,'help');assert.equal(office.data.request.careMode,false);
  assert.equal(calls.at(-1).work.history.length,0);assert.equal(calls.at(-1).work.carePreview,undefined);
  assert.ok(!JSON.stringify(calls.at(-1).work).includes('OLD_PRIVATE_UNTYPED_HISTORY'));assert.ok(!JSON.stringify(calls.at(-1).route).includes('OLD_PRIVATE_UNTYPED_HISTORY'));
  mode='urgent';const urgent=await call('/clarify','POST',{requestId:id,message:'合成危机场景'},a.cookie);assert.equal(urgent.data.careSafety,'urgent');assert.equal(urgent.data.carePreview,null);
  assert.equal((await call('/care/posts','POST',{...preview,conversationId:id,confirmed:true},a.cookie)).data.error.code,'CARE_URGENT');
  mode='preview';const later=await call('/clarify','POST',{requestId:id,message:'现在发卡'},a.cookie);assert.equal(later.data.careSafety,'urgent');assert.equal(later.data.carePreview,null);
  const db=new DatabaseSync(join(dir,'momoyu.sqlite'),{readOnly:true});
  assert.equal(db.prepare('SELECT count(*) n FROM notifications').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM matching_jobs').get().n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM messages WHERE request_id=? AND intent='care'").get(id).n,10);db.close();
});
