import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {readDifyStream, parseDifyAnswer, difyConfig} from '../server/dify.mjs';

test('文档进度只传递受控动作名称，不暴露工具输入和观察内容',async()=>{
  const progress=[];
  const body=[{event:'agent_thought',tool:'workflow_document_visual_review',tool_input:'private-input',observation:'private-observation'},
    {event:'message',answer:'{}',conversation_id:'synthetic'}, {event:'message_end'}].map(x=>'data: '+JSON.stringify(x)+'\n\n').join('');
  await readDifyStream(new Response(body,{headers:{'content-type':'text/event-stream'}}),{onProgress:x=>progress.push(x)});
  assert.equal(progress[0].action,'document_visual_review');
  assert.equal(progress[0].label,'正在检查页面排版');
  assert.ok(!JSON.stringify(progress).includes('private-'));
});
import {CARD_STYLE_OPTIONS} from '../shared/card-style.mjs';

const structured = () => ({reply:'请确认是否按工号匹配？', readyForPreview:true, card:{title:'名单核对',problem:'两份名单存在漏项',desiredOutcome:'找出漏项',deliverables:['差异清单'],acceptanceCriteria:['按工号匹配'],materials:[],constraints:[],deadline:null,skills:['Excel'],status:'open',anonymous:false,owner_id:'evil'}});
const frame = value => 'data: ' + JSON.stringify(value) + '\r\n\r\n';
const stream = answer => frame({event:'agent_message',answer:answer.slice(0,10),conversation_id:'remote-conversation'}) + frame({event:'agent_thought',thought:'internal reasoning must not enter the reply'}) + frame({event:'agent_message',answer:answer.slice(10)}) + frame({event:'message',answer}) + frame({event:'message_end',conversation_id:'remote-conversation'});

test('新版 Agent SSE 分片、中文、最终快照与严格卡片校验', async () => {
  const answer=JSON.stringify(structured());
  const bytes=new TextEncoder().encode(stream(answer));
  const body=new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}});
  const result=await readDifyStream(new Response(body,{headers:{'content-type':'text/event-stream'}}));
  assert.equal(result.answer,answer);
  assert.equal(result.conversationId,'remote-conversation');
  const parsed=parseDifyAnswer('```json\n'+result.answer+'\n```');
  assert.equal(parsed.card.title,'名单核对');
  assert.equal(parsed.ready,true);
  assert.equal(parsed.card.status,undefined);
  assert.equal(parsed.card.owner_id,undefined);
  assert.equal(parsed.card.anonymous,undefined);
  const withBackground={...structured(),intent:'request',cardStyle:{theme:'orange',layout:'note',radius:'soft',emphasis:'normal',background:'mountain'}};
  assert.equal(parseDifyAnswer(JSON.stringify(withBackground)).cardStyle.background,'mountain');
  withBackground.cardStyle.shape='polaroid';
  assert.equal(parseDifyAnswer(JSON.stringify(withBackground)).cardStyle.shape,'polaroid');
  withBackground.cardStyle.shape='clip-path:polygon(0 0)';
  assert.throws(()=>parseDifyAnswer(JSON.stringify(withBackground)),{code:'DIFY_CARD_FORMAT'});
  withBackground.cardStyle.shape='standard';
  withBackground.cardStyle.background='https://example.com/image.png';
  assert.throws(()=>parseDifyAnswer(JSON.stringify(withBackground)),{code:'DIFY_CARD_FORMAT'});
  assert.throws(()=>parseDifyAnswer('ordinary chat'),{code:'DIFY_CARD_FORMAT'});
  const invalid=structured();invalid.card.skills=[3];
  assert.throws(()=>parseDifyAnswer(JSON.stringify(invalid)),{code:'DIFY_CARD_FORMAT'});
  await assert.rejects(readDifyStream(new Response(frame({event:'message',answer}),{headers:{'content-type':'text/event-stream'}})),{code:'DIFY_INCOMPLETE'});
  await assert.rejects(readDifyStream(new Response(frame({event:'error',message:'private model credential'}),{headers:{'content-type':'text/event-stream'}})),e=>e.code==='DIFY_UPSTREAM'&&!e.message.includes('credential'));
  assert.equal(difyConfig({}),null);
  assert.throws(()=>difyConfig({DIFY_API_KEY:'fake',DIFY_BASE_URL:'invalid'}),{code:'DIFY_CONFIG'});
});

test('Dify 多轮隔离、重启续聊、错误不覆盖、并发修改不丢失', async t => {
  const received=[];
  let behavior='ok';
  let release, entered;
  const mock=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    received.push({path:req.url,authorization:req.headers.authorization,...JSON.parse(body)});
    if(behavior==='unauthorized'){res.writeHead(401);return res.end('secret-provider-message');}
    if(behavior==='wait') { entered(); await new Promise(r=>{release=r;}); }
    if(behavior==='timeout') { await new Promise(r=>setTimeout(r,1200)); if(res.destroyed)return; }
    res.writeHead(200,{'content-type':'text/event-stream'});
    if(behavior==='invalid')return res.end(stream('not-json'));
    if(behavior==='help')return res.end(stream(JSON.stringify({reply:'可以用 SUM 求和。',intent:'help',card:null,cardStyle:null,readyForPreview:false})));
    if(behavior==='mixed')return res.end(stream(JSON.stringify({...structured(),intent:'request',cardStyle:{theme:'orange',layout:'note',radius:'soft',emphasis:'normal'}})));
    if(behavior==='unprompted')return res.end(stream(JSON.stringify({...structured(),intent:'request',cardStyle:{theme:'sky',layout:'poster',radius:'soft',emphasis:'normal'}})));
    if(behavior==='helpstyle')return res.end(stream(JSON.stringify({reply:'办公回答',intent:'help',card:null,cardStyle:{theme:'rose',layout:'note',radius:'soft',emphasis:'normal'},readyForPreview:false})));
    if(behavior==='style')return res.end(stream(JSON.stringify({reply:'已调整。',intent:'style',card:null,cardStyle:{theme:'sky',layout:'poster',radius:'square',emphasis:'bold'},readyForPreview:false})));
    if(behavior==='badstyle')return res.end(stream(JSON.stringify({reply:'已调整。',intent:'style',card:null,cardStyle:{theme:'sky',layout:'poster',radius:'square',emphasis:'bold',css:'position:fixed'},readyForPreview:false})));
    if(behavior==='truncated')return res.end(frame({event:'message',answer:JSON.stringify(structured())}));
    res.end(stream(JSON.stringify(structured())));
  });
  mock.listen(0,'127.0.0.1');await once(mock,'listening');
  const dir=mkdtempSync(join(tmpdir(),'momoyu-dify-'));
  let child,base;
  const stop=async()=>{if(child&&child.exitCode===null){child.kill();await once(child,'exit');}};
  const start=async()=>{
    child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,DIFY_BASE_URL:`http://127.0.0.1:${mock.address().port}/v1`,DIFY_API_KEY:'fake-key-for-tests',DIFY_TIMEOUT_MS:'1000'},stdio:['ignore','pipe','pipe']});
    let out='';for await(const chunk of child.stdout){out+=chunk;const m=out.match(/"port":(\d+)/);if(m){base='http://127.0.0.1:'+m[1];return;}}
    throw new Error('Test server failed to start');
  };
  t.after(async()=>{release?.();await stop();mock.closeAllConnections();await new Promise(r=>mock.close(r));rmSync(dir,{recursive:true,force:true});});
  await start();
  async function call(path,method='GET',data,cookie){const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const register=async name=>call('/auth/register','POST',{username:name,password:'password123',displayName:name,department:'测试'},undefined);
  const alice=await register('alice'),bob=await register('bob');
  const first=await call('/clarify','POST',{message:'核对名单'},alice.cookie);
  const id=first.data.request.id;
  assert.equal(first.data.mode,'dify');
  assert.equal(first.data.reply,structured().reply+'\n\n（预匹配：暂未找到合适人选；发布后后台会继续匹配。）');
  assert.equal(first.data.request.status,'draft');
  assert.equal(received[0].response_mode,'streaming');
  assert.ok(received[0].query.includes(CARD_STYLE_OPTIONS.theme.join('|')));
  assert.equal(received[0].path,'/v1/chat-messages');
  assert.equal(received[0].authorization,'Bearer fake-key-for-tests');
  assert.equal(received[0].conversation_id,undefined);
  assert.ok(!JSON.stringify(first.data).includes('remote-conversation'));
  assert.ok(!JSON.stringify((await call('/health')).data).includes('fake-key'));
  await call('/requests/'+id,'PATCH',{anonymous:true,visibility:'private',rewardText:'一杯咖啡',title:'手动调整标题'},alice.cookie);
  await stop();await start();
  const second=await call('/clarify','POST',{requestId:id,message:'是，按工号'},alice.cookie);
  assert.equal(second.status,200);
  assert.equal(received.at(-1).conversation_id,'remote-conversation');
  assert.ok(received.at(-1).query.includes('手动调整标题'));
  assert.equal(second.data.messages.length,4);
  assert.equal(second.data.request.anonymous,true);
  assert.equal(second.data.request.visibility,'private');
  assert.equal(second.data.request.rewardText,'一杯咖啡');
  const before=received.length;
  assert.equal((await call('/clarify','POST',{requestId:id,message:'attempt'},bob.cookie)).status,404);
  assert.equal(received.length,before);
  await call('/clarify','POST',{message:'另一张需求'},bob.cookie);
  assert.notEqual(received.at(-1).user,received[0].user);
  assert.equal(received.at(-1).conversation_id,undefined);
  for(const [mode,code] of [['invalid','DIFY_CARD_FORMAT'],['unauthorized','DIFY_AUTH'],['truncated','DIFY_INCOMPLETE'],['timeout','DIFY_TIMEOUT']]){
    behavior=mode;
    const failure=await call('/clarify','POST',{requestId:id,message:'不能丢失原草稿'},alice.cookie);
    assert.equal(failure.data.error.code,code);
    assert.ok(!JSON.stringify(failure.data).includes('secret-provider-message'));
    const preserved=await call('/requests/'+id,'GET',undefined,alice.cookie);
    assert.equal(preserved.data.request.title,second.data.request.title);
    assert.equal((await call('/requests/'+id+'/messages','GET',undefined,alice.cookie)).data.messages.length,4);
  }
  behavior='wait';
  const pendingEntered=new Promise(r=>{entered=r;});
  const pending=call('/clarify','POST',{requestId:id,message:'等待期间修改'},alice.cookie);
  await pendingEntered;
  assert.equal((await call('/clarify','POST',{requestId:id,message:'重复请求'},alice.cookie)).data.error.code,'CLARIFY_BUSY');
  await call('/requests/'+id,'PATCH',{title:'另一页面最新修改'},alice.cookie);
  release();
  assert.equal((await pending).data.error.code,'DRAFT_CHANGED');
  assert.equal((await call('/requests/'+id,'GET',undefined,alice.cookie)).data.request.title,'另一页面最新修改');
  behavior='help';
  const help=await call('/clarify','POST',{message:'Excel 如何求和？'},alice.cookie);
  assert.equal(help.data.intent,'help'); assert.equal(help.data.hasCard,false);
  assert.ok((await call('/me/requests','GET',undefined,alice.cookie)).data.drafts.some(d=>d.id===help.data.request.id&&d.conversationTitle==='Excel 如何求和？'));
  const existing=await call('/clarify','POST',{requestId:id,message:'Excel 如何求和？'},alice.cookie);
  assert.equal(existing.data.hasCard,true); assert.equal(existing.data.request.title,'另一页面最新修改');
  assert.equal(received.at(-1).conversation_id,'remote-conversation');
  await call('/requests/'+id,'PATCH',{cardStyle:{theme:'orange',layout:'standard',radius:'soft',emphasis:'normal',background:'mountain',shape:'ticket'}},alice.cookie);
  behavior='style';
  const styled=await call('/clarify','POST',{requestId:id,message:'把卡片样式改成蓝色海报'},alice.cookie);
  assert.equal(styled.data.intent,'style'); assert.equal(styled.data.request.cardStyle.theme,'sky');
  assert.equal(styled.data.request.title,'另一页面最新修改');
  assert.equal(styled.data.request.cardStyle.background,'mountain'); assert.equal(styled.data.request.cardStyle.shape,'ticket');
  behavior='badstyle';
  assert.equal((await call('/clarify','POST',{requestId:id,message:'修改卡片样式'},alice.cookie)).data.error.code,'DIFY_CARD_FORMAT');
  assert.equal((await call('/requests/'+id,'GET',undefined,alice.cookie)).data.request.cardStyle.theme,'sky');
  behavior='mixed';
  const mixed=await call('/clarify','POST',{requestId:id,message:'发布Excel互助需求，并把卡片改成橙色便签'},alice.cookie);
  assert.equal(mixed.data.intent,'request'); assert.equal(mixed.data.request.cardStyle.theme,'orange'); assert.equal(mixed.data.request.cardStyle.layout,'note');
  assert.equal(mixed.data.request.status,'draft'); assert.equal(mixed.data.request.visibility,'private'); assert.equal(mixed.data.request.rewardText,'一杯咖啡');
  behavior='unprompted';
  const unchanged=await call('/clarify','POST',{requestId:id,message:'需求细节继续'},alice.cookie);
  assert.equal(unchanged.data.request.cardStyle.theme,'orange');
  behavior='helpstyle';
  const ignored=await call('/clarify','POST',{requestId:id,message:'把卡片改成粉色'},alice.cookie);
  assert.equal(ignored.data.intent,'help'); assert.equal(ignored.data.request.cardStyle.theme,'orange');
  const db=new DatabaseSync(join(dir,'momoyu.sqlite'));
  assert.equal(db.prepare('SELECT conversation_id FROM dify_conversations WHERE request_id=?').get(id).conversation_id,'remote-conversation');db.close();
});
