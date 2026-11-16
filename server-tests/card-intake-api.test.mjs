import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,dirname,basename} from 'node:path';import {randomUUID} from 'node:crypto';

test('空白互助开场不调用Dify、不推荐其他助手；补充具体内容仍进入卡片LLM并保留首问',async t=>{
 const calls=[],uploads=new Map();const upstream=createServer(async(req,res)=>{
  if(req.url==='/v1/files/upload'){
   const bytes=[];for await(const b of req)bytes.push(b);const f=await new Response(Buffer.concat(bytes),{headers:{'content-type':req.headers['content-type']}}).formData(),id=randomUUID();uploads.set(id,await f.get('file').text());calls.push('upload');res.setHeader('content-type','application/json');return res.end(JSON.stringify({id}));
  }
  if(req.url==='/v1/chat-messages'){
   let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);calls.push(b);const card={title:'整理门店周报为Excel模板',problem:'每周手工汇总六家门店周报',desiredOutcome:'得到可复用Excel汇总模板',deliverables:['Excel模板'],acceptanceCriteria:['覆盖六家门店的周报'],skills:['Excel']};
   res.writeHead(200,{'content-type':'text/event-stream'});return res.end('data: '+JSON.stringify({event:'message',conversation_id:'intake-test',answer:JSON.stringify({version:1,route:'card',answer_json:JSON.stringify({reply:'已整理为草稿，请确认。',card}),files:[],artifact_json:''})})+'\n\ndata: '+JSON.stringify({event:'message_end'})+'\n\n');
  }
  res.writeHead(500);res.end('{}');
 });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');const root=resolve(tmpdir()),dir=mkdtempSync(join(root,'momoyu-card-intake-')),fake=`http://127.0.0.1:${upstream.address().port}/v1`;let child;
 t.after(async()=>{if(child?.exitCode===null){child.kill();await once(child,'exit');}upstream.closeAllConnections();await new Promise(r=>upstream.close(r));assert.equal(dirname(resolve(dir)),root);assert.ok(basename(dir).startsWith('momoyu-card-intake-'));rmSync(dir,{recursive:true,force:true});});
 child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,DATA_DIR:dir,HOST:'127.0.0.1',PORT:'0',MATCHING_SCHEDULER:'off',DIFY_ENTRYPOINT:'chatflow',DIFY_BASE_URL:fake,DIFY_CHATFLOW_BASE_URL:fake,DIFY_API_KEY:'fake',DIFY_CHATFLOW_API_KEY:'fake',DIFY_MATCHING_API_KEY:''},stdio:['ignore','pipe','pipe']});let base,text='';for await(const c of child.stdout){text+=c;const m=text.match(/"port":(\d+)/);if(m){base='http://127.0.0.1:'+m[1];break;}}assert.ok(base);
 let cookie;const post=async(path,body)=>{const r=await fetch(base+'/api'+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});cookie||=r.headers.get('set-cookie')?.split(';')[0];const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;};
 await post('/auth/register',{username:'intake-user',password:'SyntheticOnly2026!',displayName:'合成首问',department:'测试'});
 const template='帮我发布一条互助请求：关于……（要解决的问题），希望达成……，交付物是……，截止时间是……，需要具备……经验的同事帮忙。';
 const first=await post('/clarify',{message:template,attachmentIds:[]});assert.deepEqual(calls,[]);assert.equal(first.request.title,'');assert.equal(first.request.status,'draft');assert.equal(first.readyForPreview,false);assert.equal(first.intent,'request');assert.equal(first.messages.at(-1).intent,'request');assert.deepEqual(first.recommendations,[]);assert.doesNotMatch(first.reply,/占位|字段|模板|预匹配/);
 const next=await post('/clarify',{requestId:first.request.id,message:'每周要汇总六家门店周报，想请同事做一个能反复使用的Excel模板。',attachmentIds:[]});assert.equal(next.request.id,first.request.id);assert.equal(next.request.title,'整理门店周报为Excel模板');const body=calls.find(x=>typeof x==='object');assert.equal(JSON.parse(body.inputs.route_context).forceRoute,'card');const context=JSON.parse(uploads.get(body.inputs.context_file.upload_file_id));assert.equal(context.history[1].content,first.reply);assert.equal(context.history[0].content,template);
});
