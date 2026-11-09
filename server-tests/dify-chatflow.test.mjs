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
import {difyConfig,parseChatflowPacket,readDifyStream} from '../server/dify.mjs';
import {makeChatflow} from '../scripts/build-multi-agent-chatflow.mjs';
import vm from 'node:vm';

const frame=x=>'data: '+JSON.stringify(x)+'\n\n';
const answer=(reply='已完成')=>({reply,intent:'help',card:null,cardStyle:null,readyForPreview:false});
const packet=(result=answer())=>({version:1,route:'office',answer_json:JSON.stringify(result),files:[],artifact_json:''});

test('Chatflow选择与严格分支协议，旧入口始终可单独配置',()=>{
  const env={DIFY_BASE_URL:'http://127.0.0.1/v1',DIFY_API_KEY:'old-key',DIFY_CHATFLOW_API_KEY:'new-key'};
  const cfg=difyConfig(env);
  assert.equal(cfg.kind,'chatflow');assert.equal(cfg.key,'new-key');assert.equal(cfg.legacy.key,'old-key');assert.notEqual(cfg.scope,cfg.legacy.scope);
  assert.equal(difyConfig({...env,DIFY_ENTRYPOINT:'legacy'}).key,'old-key');
  assert.throws(()=>difyConfig({...env,DIFY_ENTRYPOINT:'unknown'}));
  assert.throws(()=>difyConfig({...env,DIFY_ENTRYPOINT:'chatflow',DIFY_CHATFLOW_API_KEY:''}));
  assert.equal(parseChatflowPacket(JSON.stringify(packet())).parsed.intent,'help');
  assert.equal(parseChatflowPacket('{"version":1,"route":"legacy"}').route,'legacy');
  for(const p of [{version:1,route:'other'}, {...packet(),files:[{url:'https://evil.test/x'}]}, {...packet(),answer_json:JSON.stringify({...answer(),intent:'request'})}, {version:1,route:'legacy',files:[]}])
    assert.throws(()=>parseChatflowPacket(JSON.stringify(p)));
});

test('Chatflow流仅接收外层答复，不把子Agent输出当作页面JSON',async()=>{
  const expected=JSON.stringify(packet()),progress=[];
  const body=[{event:'node_started',data:{title:'办公任务'}},{event:'agent_message',answer:'private-worker-text'},
    {event:'message',answer:expected.slice(0,16),conversation_id:'parent'}, {event:'message',answer:expected.slice(16)}, {event:'message_end'}].map(frame).join('');
  const result=await readDifyStream(new Response(body,{headers:{'content-type':'text/event-stream'}}),{chatflow:true,onProgress:p=>progress.push(p)});
  assert.equal(result.answer,expected);assert.equal(progress[0].action,'office');assert.ok(!JSON.stringify(progress).includes('private-worker'));
});

test('分发DSL真实Code可运行，长推理不进入结果，空文件与危机路由正确处理',()=>{
  const app=makeChatflow({office:{providerId:'mock-office',toolName:'office_task'},card:{providerId:'mock-card',toolName:'card_task'},care:{providerId:'mock-care',toolName:'care_task'}});
  for(const role of ['office','card']){
    const tool=app.workflow.graph.nodes.find(n=>n.id===role).data;
    assert.equal(tool.tool_node_version,'2');
    assert.deepEqual(tool.tool_configurations,tool.tool_parameters);
    assert.deepEqual(tool.tool_configurations.context_file.value,['start',role==='care'?'care_context_file':'context_file']);
    if(role==='care')assert.equal(tool.tool_parameters.materials,undefined);
  }
  const run=(id,args)=>JSON.parse(JSON.stringify(vm.runInNewContext(app.workflow.graph.nodes.find(n=>n.id===id).data.code+';main(args)',{args},{timeout:500})));
  const thought=Array.from({length:27},()=>'<think>内部判断\n</think>\n').join('');
  assert.equal(run('route',{text:thought+'```json\n{"route":"card"}\n```',route_context:'{}'}).route,'card');
  assert.equal(run('route',{text:'not-json',route_context:'{"careSafety":"urgent"}'}).route,'care');
  assert.throws(()=>run('route',{text:'<think>未闭合',route_context:'{}'}));
  assert.throws(()=>run('route',{text:'{"route":"office","tool":"publish"}',route_context:'{}'}));
  const result=run('office_packet',{data:[{answer_json:JSON.stringify(answer()),artifact_json:''}],files:null});
  assert.equal(parseChatflowPacket(result.packet).route,'office');
  assert.deepEqual(parseChatflowPacket(result.packet).files,[]);
  for(const [id,input] of [['care_fast','care_text'],['office_fast','office_text']]){
    const fast=app.workflow.graph.nodes.find(n=>n.id===id).data;
    assert.equal(fast.reasoning_format,'separated');assert.equal(fast.prompt_template[1].text,'{{#start.'+input+'#}}');
    const output=app.workflow.graph.nodes.find(n=>n.id===(id==='care_fast'?'care_answer':'office_chat_answer')).data.answer;
    assert.ok(output.includes('{{#'+id+'.text#}}'));assert.ok(output.startsWith(id==='care_fast'?'{"version":2':'{"version":3'));
  }
  assert.equal(run('route',{text:'{"route":"office_chat"}',route_context:'{"hasMaterials":true}'}).route,'office');
});

test('新入口文件续改、转互助、双会话回退、失败保护与旧会话迁移',async t=>{
  const secret='chatflow-test-only-card-secret-32-characters',uploads=new Map(),outputs=new Map(),calls=[];
  let behavior='normal',entrypoint='chatflow';
  const upstream=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://local');
    if(url.pathname==='/v1/files/upload'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const form=await new Response(Buffer.concat(chunks),{headers:{'content-type':req.headers['content-type']}}).formData();
      const file=form.get('file'),id=randomUUID();uploads.set(id,{name:file.name,text:await file.text(),user:form.get('user')});
      res.setHeader('content-type','application/json');return res.end(JSON.stringify({id}));
    }
    if(url.pathname.startsWith('/files/tools/')){
      const file=outputs.get(url.pathname.split('/').at(-1).replace(/\.txt$/,''));
      if(!file){res.writeHead(404);return res.end();}
      res.setHeader('content-disposition',`attachment; filename="${file.name}"`);res.setHeader('content-type','text/plain');return res.end(file.content);
    }
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
    calls.push({authorization:req.headers.authorization,...body});
    res.writeHead(200,{'content-type':'text/event-stream'});
    const finish=(a,id)=>res.end(frame({event:'message',answer:a.slice(0,23),conversation_id:id})+frame({event:'message',answer:a.slice(23)})+frame({event:'message_end'}));
    if(req.headers.authorization==='Bearer old-key')return finish(JSON.stringify(answer('原助手继续倾听')),'legacy-'+body.user);
    const context=JSON.parse(uploads.get(body.inputs.context_file.upload_file_id).text);
    assert.equal(context.user_message,body.query);assert.ok(context.output_prefix.startsWith('mm-'));
    const id='parent-'+body.user;
    if(body.query.includes('难过'))return finish('{"version":1,"route":"legacy"}',id);
    if(behavior==='invalid')return finish(JSON.stringify({...packet(),files:[{url:'https://evil.test/fake.docx'}]}),id);
    if(body.query.includes('找同事')){
      const card={title:'核对周报',problem:'希望同事检查遗漏',desiredOutcome:'得到核对后的周报',deliverables:['修改建议'],acceptanceCriteria:['逐项核对'],materials:['已有周报'],constraints:[],deadline:null,skills:['文档编辑']};
      const design={name:'测试橙色',paper:'#fffaf0',accent:'#ed6a24',sky:'#ffbb77',shape:'ticket',layout:'note',elements:[{type:'circle',cx:100,cy:100,r:30,fill:'#ff0000'}]};
      return finish(JSON.stringify({version:1,route:'card',answer_json:JSON.stringify({...answer('已整理为私密预览'),intent:'request',card,readyForPreview:true,design}),files:[],artifact_json:''}),id);
    }
    const fileId=randomUUID(),name=context.output_prefix+'report.txt';outputs.set(fileId,{name,content:body.query.includes('修改')?'version2':'version1'});
    const file={dify_model_identity:'__dify__file__',transfer_method:'tool_file',reference:'dify-file-ref:'+Buffer.from(JSON.stringify({record_id:fileId})).toString('base64url'),url:`http://untrusted-host.test/files/tools/${fileId}.txt?timestamp=1&nonce=n&sign=s`};
    return finish(JSON.stringify({...packet(),files:[file]}),id);
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const dir=mkdtempSync(join(tmpdir(),'momoyu-chatflow-'));
  const seed=new DatabaseSync(join(dir,'momoyu.sqlite'));seed.exec('CREATE TABLE dify_conversations(request_id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,scope TEXT NOT NULL)');
  seed.prepare('INSERT INTO dify_conversations VALUES(?,?,?)').run('prior-request','prior-conversation','prior-scope');seed.close();
  let child,base;
  const stop=async()=>{if(child&&child.exitCode===null){child.kill();await once(child,'exit');}};
  const start=async()=>{
    child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,MATCHING_SCHEDULER:'off',DIFY_MATCHING_API_KEY:'',CARD_TOOL_SECRET:secret,
      DIFY_BASE_URL:`http://127.0.0.1:${upstream.address().port}/v1`,DIFY_CHATFLOW_BASE_URL:`http://127.0.0.1:${upstream.address().port}/v1`,DIFY_API_KEY:'old-key',DIFY_CHATFLOW_API_KEY:'new-key',DIFY_ENTRYPOINT:entrypoint},stdio:['ignore','pipe','pipe']});
    let text='';for await(const chunk of child.stdout){text+=chunk;const m=text.match(/"port":(\d+)/);if(m){base='http://127.0.0.1:'+m[1];return;}}
    throw Error('Server failed to start');
  };
  t.after(async()=>{await stop();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));rmSync(dir,{recursive:true,force:true});});
  await start();
  const call=async(path,method='GET',body,cookie)=>{const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const register=async username=>call('/auth/register','POST',{username,password:'Password2026!',displayName:username,department:'合成测试'});
  const a=await register('alice-cf'),b=await register('bob-cf');
  const long='保留完整材料'.repeat(500),first=await call('/clarify','POST',{message:long},a.cookie);assert.equal(first.status,200);
  const firstInput=JSON.parse([...uploads.values()].find(f=>f.name==='momoyu-session-context.txt').text);assert.equal(firstInput.user_message,long);
  const requestId=first.data.request.id,original=first.data.messages.at(-1).files[0];
  await call('/requests/'+requestId,'PATCH',{visibility:'private',anonymous:true,rewardText:'一杯咖啡'},a.cookie);
  const second=await call('/clarify','POST',{requestId,message:'修改刚才文件'},a.cookie);assert.equal(second.status,200);
  assert.equal(calls.at(-1).conversation_id,calls[0].user?'parent-'+calls[0].user:undefined);
  const contexts=[...uploads.values()].filter(f=>f.name==='momoyu-session-context.txt').map(f=>JSON.parse(f.text));assert.equal(contexts.at(-1).outputHistory[0].name,'report.txt');
  const latest=second.data.messages.at(-1).files[0];
  assert.equal(await (await fetch(base+original.downloadUrl,{headers:{cookie:a.cookie}})).text(),'version1');
  assert.equal(await (await fetch(base+latest.downloadUrl,{headers:{cookie:a.cookie}})).text(),'version2');
  assert.equal((await fetch(base+latest.downloadUrl,{headers:{cookie:b.cookie}})).status,404);
  const transferred=await call('/clarify','POST',{requestId,message:'这个结果不满意，找同事帮忙'},a.cookie);
  assert.equal(transferred.status,200);assert.equal(transferred.data.intent,'request');assert.equal(transferred.data.request.status,'draft');assert.equal(transferred.data.request.visibility,'private');
  assert.equal(transferred.data.request.cardArtwork.design.shape,'ticket');assert.equal(transferred.data.readyForPreview,true);
  assert.equal(transferred.data.request.anonymous,true);assert.equal(transferred.data.request.rewardText,'一杯咖啡');
  behavior='invalid';const failed=await call('/clarify','POST',{requestId,message:'保留原文'},a.cookie);assert.equal(failed.data.error.code,'DIFY_CHATFLOW_FORMAT');
  assert.equal((await call('/requests/'+requestId+'/messages','GET',undefined,a.cookie)).data.messages.length,6);behavior='normal';
  const care=await call('/clarify','POST',{requestId,message:'我有点难过'},a.cookie);assert.equal(care.status,200);assert.equal(calls.at(-1).authorization,'Bearer old-key');
  await call('/clarify','POST',{requestId,message:'还是难过'},a.cookie);assert.equal(calls.at(-1).conversation_id,'legacy-'+calls.at(-1).user);
  await stop();entrypoint='legacy';await start();
  const legacy=await call('/clarify','POST',{requestId,message:'继续'},a.cookie);assert.equal(legacy.status,200);assert.equal(calls.at(-1).conversation_id,'legacy-'+calls.at(-1).user);
  const db=new DatabaseSync(join(dir,'momoyu.sqlite'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM dify_conversations WHERE request_id=?').get(requestId).n,2);
  assert.equal(db.prepare('SELECT conversation_id FROM dify_conversations WHERE request_id=?').get('prior-request').conversation_id,'prior-conversation');db.close();
});
