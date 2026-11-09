import {assessPublishedTask} from './helpers/task-score.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDesignJob,verifyDesignJob,makeCardArtifact,readCardArtifact} from '../server/card-design.mjs';
import {readDifyStream} from '../server/dify.mjs';

const key='test-only-card-design-key-0123456789';
const design={name:'橙色日落海岸',paper:'#fff8ef',accent:'#c75b21',sky:'#ffe0b6',shape:'polaroid',layout:'poster',elements:[{type:'circle',cx:900,cy:140,r:70,fill:'#f18b40'},{type:'path',d:'M 0 250 Q 400 180 700 300 T 1200 280 L 1200 400 L 0 400 Z',fill:'#346f7a'}]};
const frame=o=>'data: '+JSON.stringify(o)+'\n\n';
test('制卡工具成品验签、会话绑定、恶意图形和 SSE 提取',async()=>{
  const job=createDesignJob(key),artifact=makeCardArtifact(design,job,key);
  assert.ok(verifyDesignJob(job,key));assert.equal(verifyDesignJob(job+'x',key),false);
  assert.equal(readCardArtifact(artifact,job,key).design.name,design.name);
  assert.equal(readCardArtifact(artifact,createDesignJob(key),key),null);
  assert.equal(readCardArtifact({...artifact,signature:'字'.repeat(43)},job,key),null);
  assert.equal(readCardArtifact({...artifact,card_artifact:{...artifact.card_artifact,svg:'<script/>'}},job,key),null);
  assert.throws(()=>makeCardArtifact({...design,elements:[{type:'path',d:'M0 0"/><script>alert(1)</script>',fill:'#ffffff'}]},job,key));
  assert.throws(()=>makeCardArtifact({...design,elements:[{type:'image',href:'http://private'}]},job,key));
  assert.throws(()=>makeCardArtifact(design,'fake',key),{code:'INVALID_JOB'});
  const events=frame({event:'agent_thought',tool:'design_card',observation:JSON.stringify({text:JSON.stringify(artifact)})})+frame({event:'message',answer:'{}',conversation_id:'x'})+frame({event:'message_end'});
  const progress=[];const parsed=await readDifyStream(new Response(events,{headers:{'content-type':'text/event-stream'}}),{job,designKey:key,onProgress:e=>progress.push(e)});
  assert.equal(parsed.artwork.id,artifact.card_artifact.id);assert.equal(progress.at(-1).stage,'designed');
});

test('真实工具成品接收、私密读取、发布、其他账号接取和失败保留',async t=>{
  let mode='design',lastArtifact;
  const mock=createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw),job=b.query.match(/job_token=([^。\s]+)/)?.[1];
    res.writeHead(200,{'content-type':'text/event-stream'});
    const content={reply:'已制作设计，请预览。',intent:'request',card:{title:'名单核对',problem:'需要核对名单漏项',desiredOutcome:'找出A有B无',deliverables:['漏项清单'],acceptanceCriteria:[],materials:[],constraints:[],skills:['Excel'],deadline:null},cardStyle:null,readyForPreview:true};
    if(mode==='design'){lastArtifact=makeCardArtifact(design,job,key);res.write(frame({event:'agent_thought',tool:'design_card',observation:JSON.stringify(lastArtifact)}));}
    if(mode==='forged')res.write(frame({event:'agent_thought',tool:'design_card',observation:JSON.stringify({...lastArtifact,signature:'fake'})}));
    res.end(frame({event:'message',answer:JSON.stringify(content),conversation_id:'test-conversation'})+frame({event:'message_end'}));
  });mock.listen(0,'127.0.0.1');await once(mock,'listening');
  const dir=mkdtempSync(join(tmpdir(),'momoyu-design-'));
  const child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,DIFY_BASE_URL:`http://127.0.0.1:${mock.address().port}/v1`,DIFY_API_KEY:'test-key',CARD_TOOL_SECRET:key},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{child.kill();mock.closeAllConnections();await new Promise(r=>mock.close(r));await once(child,'exit');rmSync(dir,{recursive:true,force:true});});
  let output='',base;for await(const c of child.stdout){output+=c;const m=output.match(/"port":(\d+)/);if(m){base='http://127.0.0.1:'+m[1];break;}}
  const call=async(path,body,cookie,accept)=>{const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{}),...(accept?{accept}:{})},body:body?JSON.stringify(body):undefined});return r;};
  const register=async username=>(await call('/auth/register',{username,password:'password123',displayName:username,department:'测试'})).headers.get('set-cookie').split(';')[0];
  const alice=await register('alice'),bob=await register('bob');
  const r=await call('/clarify',{message:'帮我做一张日落海边拍立得互助卡'},alice,'text/event-stream');
  const sse=await r.text();assert.ok(sse.includes('event: status'));const result=JSON.parse(sse.match(/event: result\ndata: (.*)/)[1]);
  const id=result.request.id;assert.equal(result.request.cardArtwork.design.name,design.name);assert.equal(result.request.cardArtwork.svg,undefined);
  assert.equal((await call('/requests/'+id+'/artwork.svg',null,bob)).status,404);
  const art=await call('/requests/'+id+'/artwork.svg',null,alice);assert.equal(await art.text(),lastArtifact.card_artifact.svg);
  for(const next of ['forged','failed']){mode=next;const d=await(await call('/clarify',{requestId:id,message:'再设计一下'},alice)).json();assert.equal(d.request.cardArtwork.id,result.request.cardArtwork.id);if(next==='forged')assert.match(d.warnings[0],/未返回有效成品/);}
  await call('/requests/'+id+'/publish',{confirmed:true},alice);
  assert.equal((await call('/requests/'+id+'/artwork.svg',null,bob)).status,200);
  assessPublishedTask(dir,id);
  const claim=await(await call('/requests/'+id+'/claim',{},bob)).json();assert.equal(claim.request.status,'claimed');assert.equal(claim.request.cardArtwork.id,result.request.cardArtwork.id);
});
