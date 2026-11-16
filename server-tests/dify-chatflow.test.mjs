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
import {difyConfig,parseChatflowPacket,readDifyStream,autoCardDesign,cardMaterialPolicy} from '../server/dify.mjs';
import {makeChatflow} from '../scripts/build-multi-agent-chatflow.mjs';
import vm from 'node:vm';

const frame=x=>'data: '+JSON.stringify(x)+'\n\n';
const answer=(reply='已完成')=>({reply,intent:'help',card:null,cardStyle:null,readyForPreview:false});
const packet=(result=answer())=>({version:1,route:'office',answer_json:JSON.stringify(result),files:[],artifact_json:''});

test('Chatflow选择与严格分支协议，旧入口始终可单独配置',()=>{  const env={DIFY_BASE_URL:'http://127.0.0.1/v1',DIFY_API_KEY:'old-key',DIFY_CHATFLOW_API_KEY:'new-key'};
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

test('无 design 时后端按卡片语境生成封面',()=>{
  const translation=autoCardDesign({title:'翻译设备操作手册',skills:['翻译','英文']});
  const electric=autoCardDesign({title:'审阅低压配电柜二次回路图纸',skills:['电气','图纸审阅']});
  assert.equal(translation.name,'翻译设备操作手册');
  assert.match(translation.paper,/^#[0-9a-f]{6}$/i);
  assert.match(translation.accent,/^#[0-9a-f]{6}$/i);
  assert.equal(translation.shape,'standard');assert.equal(translation.layout,'standard');
  assert.notEqual(`${translation.paper}${translation.accent}`,`${electric.paper}${electric.accent}`);
  const styled=autoCardDesign({title:'整理周报',cardStyle:{shape:'ticket',layout:'note'}});
  assert.equal(styled.shape,'ticket');assert.equal(styled.layout,'note');
});

test('卡片助手默认读取获准文档和图片，保存、背景和禁止读取保留名称',()=>{
  const files=[{id:'a',name:'销售报表.xlsx',isImage:false,aiReadable:true}];
  assert.deepEqual(cardMaterialPolicy('帮我设计一张需求卡：汇总门店报表',files),{mode:'read',passFiles:true,reason:'authorized-document'});
  assert.equal(cardMaterialPolicy('不要读取附件内容，只作为附件',files).passFiles,false);
  assert.equal(cardMaterialPolicy('只看文件名帮我写卡',files).passFiles,false);
  assert.equal(cardMaterialPolicy('根据附件内容写卡',files.map(f=>({...f,aiEnabled:false}))).passFiles,false);
  assert.equal(cardMaterialPolicy('根据附件内容写卡',files.map(f=>({...f,included:false,aiEnabled:true}))).passFiles,true);
  assert.equal(cardMaterialPolicy('看看图片内容写卡',[{name:'需求截图.png',aiReadable:true,isImage:true}]).passFiles,true);
  assert.equal(cardMaterialPolicy('帮我看看附件里的数据问题，整理成求助卡',files).mode,'read');
  assert.equal(cardMaterialPolicy('根据附件内容写一张求助卡',files).mode,'read');
  assert.equal(cardMaterialPolicy('把附件里的手册翻译成英文，做张求助卡',files).mode,'read');
  assert.deepEqual(cardMaterialPolicy('用这张图片做背景',files,true),{mode:'names-only',passFiles:false,reason:'background-image'});
  assert.equal(cardMaterialPolicy('设计一张求助卡',[]).passFiles,false);
});


test('卡片 Agent 只返回关键信息时后端补全 intent、ready 与省略字段',()=>{
  const packetOf=(route,answer_json,context)=>parseChatflowPacket(JSON.stringify({version:1,route,answer_json,files:[],artifact_json:''}),context);
  const minimal=packetOf('card',JSON.stringify({reply:'已整理',card:{title:'汇总门店报表',problem:'每周手工汇总 6 家门店',desiredOutcome:'得到自动汇总模板',acceptanceCriteria:['一键生成']}}));
  assert.equal(minimal.parsed.intent,'request');assert.equal(minimal.parsed.ready,true);
  assert.deepEqual(minimal.parsed.card.materials,[]);assert.equal(minimal.parsed.card.deadline,null);
  assert.equal(packetOf('office',JSON.stringify({reply:'可以用 SUM。'})).parsed.intent,'help');
  const merged=packetOf('card',JSON.stringify({reply:'补充问题描述',card:{problem:'新的问题描述'}}),{currentCard:{title:'原标题',problem:'旧问题',desiredOutcome:'旧目标',deliverables:[],acceptanceCriteria:['旧标准'],materials:['旧材料'],constraints:[],deadline:null,skills:['Excel']}});
  assert.equal(merged.parsed.card.title,'原标题');assert.equal(merged.parsed.card.problem,'新的问题描述');
  assert.deepEqual(merged.parsed.card.materials,['旧材料']);assert.equal(merged.parsed.ready,true);
  const cleared=packetOf('card',JSON.stringify({reply:'已取消截止时间',card:{deadline:null}}),{currentCard:{title:'原任务',problem:'原问题',desiredOutcome:'原目标',deadline:'2026-11-20',deliverables:['Excel'],acceptanceCriteria:['口径一致'],materials:[],constraints:[],skills:['Excel']}});
  assert.equal(cleared.parsed.card.deadline,null);assert.equal(cleared.parsed.card.title,'原任务');
  assert.equal(packetOf('card',JSON.stringify({reply:'改目标',card:{desiredOutcome:'新目标'}}),{currentCard:{...cleared.parsed.card,deadline:'2026-11-20'}}).parsed.card.deadline,'2026-11-20');
  assert.throws(()=>packetOf('card',JSON.stringify({reply:'格式错误',card:{title:3}})),{code:'DIFY_CARD_FORMAT'});
});


test('Chatflow流仅接收外层答复，不把子Agent输出当作页面JSON',async()=>{
  const expected=JSON.stringify(packet()),progress=[];
  const body=[{event:'node_started',data:{title:'办公任务'}},{event:'agent_message',answer:'private-worker-text'},
    {event:'message',answer:expected.slice(0,16),conversation_id:'parent'}, {event:'message',answer:expected.slice(16)}, {event:'message_end'}].map(frame).join('');
  const result=await readDifyStream(new Response(body,{headers:{'content-type':'text/event-stream'}}),{chatflow:true,onProgress:p=>progress.push(p)});
  assert.equal(result.answer,expected);assert.equal(progress[0].action,'office');assert.ok(!JSON.stringify(progress).includes('private-worker'));
});

test('电气分支一开始就显示电气专家状态，不停留在分配助手',async()=>{
  const expected=JSON.stringify(packet());
  const body=[{event:'node_finished',data:{node_id:'route',outputs:{route:'electrical'}}},
    {event:'node_started',data:{title:'电气专家 Agent'}},
    {event:'message',answer:expected,conversation_id:'parent'},{event:'message_end'}].map(frame).join('');
  const progress=[];
  await readDifyStream(new Response(body,{headers:{'content-type':'text/event-stream'}}),{chatflow:true,onProgress:p=>progress.push(p)});
  assert.equal(progress[0].action,'electrical');assert.equal(progress[0].label,'电气专家正在处理');
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
  const cardPacket=run('card_packet',{data:[{answer_json:JSON.stringify({reply:'补充问题描述',card:{problem:'新的问题描述'}}),artifact_json:''}],files:null});
  assert.equal(parseChatflowPacket(cardPacket.packet).route,'card');
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
    const inline=JSON.parse(body.inputs.office_text);
    assert.deepEqual(inline.inputs,context.inputs);assert.deepEqual(inline.outputHistory,context.outputHistory);
    assert.equal(inline.output_prefix,context.output_prefix);
    const id='parent-'+body.user;
    if(body.query.includes('难过'))return finish('{"version":1,"route":"legacy"}',id);
    if(behavior==='invalid')return finish(JSON.stringify({...packet(),files:[{url:'https://evil.test/fake.docx'}]}),id);
    if(body.query.includes('自动封面验证')){
      const card={title:'自动封面测试',problem:'希望同事帮忙汇总数据',desiredOutcome:'得到汇总结果',deliverables:['汇总表'],acceptanceCriteria:['数据准确'],materials:[],constraints:[],deadline:null,skills:['Excel']};
      return finish(JSON.stringify({version:1,route:'card',answer_json:JSON.stringify({...answer('已整理成卡片'),intent:'request',card,readyForPreview:true,design:null}),files:[],artifact_json:''}),id);
    }
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
  const auto=await call('/clarify','POST',{message:'自动封面验证'},a.cookie);
  assert.equal(auto.status,200);assert.equal(auto.data.intent,'request');assert.equal(auto.data.readyForPreview,true);
  assert.equal(auto.data.request.cardArtwork,null);assert.equal(auto.data.request.cardStyle.background,'data');
  behavior='invalid';const failed=await call('/clarify','POST',{requestId,message:'保留原文'},a.cookie);assert.equal(failed.data.error.code,'DIFY_CHATFLOW_FORMAT');
  assert.equal((await call('/requests/'+requestId+'/messages','GET',undefined,a.cookie)).data.messages.length,6);behavior='normal';
  const care=await call('/clarify','POST',{requestId,message:'我有点难过'},a.cookie);assert.equal(care.status,200);assert.equal(calls.at(-1).authorization,'Bearer old-key');
  await call('/clarify','POST',{requestId,message:'还是难过'},a.cookie);assert.equal(calls.at(-1).conversation_id,'legacy-'+calls.at(-1).user);
  // 非轻量TXT的翻译交给办公文件助手时，材料字节和附件上下文要一起传过去。
  const draft=await call('/clarify','POST',{message:'新建草稿'},a.cookie);assert.equal(draft.status,200);
  const draftId=draft.data.request.id;
  const form=new FormData();form.append('file',new Blob(['设备说明：先断电。'],{type:'text/plain'}),'设备说明.csv');
  const uploadedFile=await fetch(base+'/api/requests/'+draftId+'/attachments',{method:'POST',headers:{cookie:a.cookie},body:form});
  assert.equal(uploadedFile.status,201);
  const translationTurn=await call('/clarify','POST',{requestId:draftId,message:'请把这份文件翻译成英文'},a.cookie);
  assert.equal(translationTurn.status,200);
  const sent=calls.at(-1);
  assert.equal(sent.files.length,1);assert.equal(sent.files[0].type,'document');
  const sentJson=JSON.parse([...uploads.values()].filter(f=>f.name==='momoyu-session-context.txt').at(-1).text);
  assert.equal(sentJson.translation.mode,'document');assert.deepEqual(sentJson.translation.documentFiles,['设备说明.csv']);
  assert.equal(sentJson.attachments.length,1);assert.equal(sentJson.attachments[0].aiReadable,true);assert.equal(sentJson.inputs.length,1);
  const sentHints=JSON.parse(sent.inputs.route_context);
  assert.equal(sentHints.forceRoute,'office');assert.equal(sentHints.hasMaterials,true);
  // 卡片分支提取本轮授权文档，后续复用引用而不再次上传/挂载到父会话。
  const cardDraft=await call('/clarify','POST',{message:'新建卡片草稿'},a.cookie);assert.equal(cardDraft.status,200);
  const cardDraftId=cardDraft.data.request.id;
  const cardForm=new FormData();cardForm.append('file',new Blob(['设备清单：电机、阀门'],{type:'text/plain'}),'设备清单.txt');
  const cardUpload=await fetch(base+'/api/requests/'+cardDraftId+'/attachments',{method:'POST',headers:{cookie:a.cookie},body:cardForm});
  assert.equal(cardUpload.status,201);
  const cardTurn=await call('/clarify','POST',{requestId:cardDraftId,message:'帮我设计一张求助卡：汇总门店报表'},a.cookie);assert.equal(cardTurn.status,200);
  const cardSent=calls.at(-1);
  assert.equal(cardSent.files.length,1,'卡片分支默认允许获准文档');
  assert.equal(cardSent.inputs.card_materials.length,1);
  const cardJson=JSON.parse([...uploads.values()].filter(f=>f.name==='momoyu-session-context.txt').at(-1).text);
  assert.equal(cardJson.cardMaterialPolicy.passFiles,true);assert.equal(cardJson.inputs.length,1);
  assert.equal(cardJson.attachmentDigests[0].name,'设备清单.txt');assert.equal(cardJson.attachmentDigests[0].summary,'设备清单：电机、阀门');
  assert.equal(JSON.parse(cardSent.inputs.route_context).forceRoute,'card');
  const readTurn=await call('/clarify','POST',{requestId:cardDraftId,message:'根据附件内容写一张求助卡'},a.cookie);assert.equal(readTurn.status,200);
  assert.equal(calls.at(-1).files,undefined,'父会话不重复挂载已递送的材料');
  assert.equal(calls.at(-1).inputs.card_materials.length,1,'子工作流继续取得授权文件引用');
  assert.equal(calls.at(-1).inputs.card_materials[0].upload_file_id,cardSent.inputs.card_materials[0].upload_file_id);
  const readJson=JSON.parse([...uploads.values()].filter(f=>f.name==='momoyu-session-context.txt').at(-1).text);
  assert.equal(readJson.cardMaterialPolicy.mode,'read');assert.equal(readJson.inputs.length,1);
  const namesOnly=await call('/clarify','POST',{requestId:cardDraftId,message:'不要读取附件内容，只作为附件；根据我描述的周报整理求助卡'},a.cookie);assert.equal(namesOnly.status,200);
  assert.deepEqual(calls.at(-1).inputs.card_materials,[]);
  const namesJson=JSON.parse([...uploads.values()].filter(f=>f.name==='momoyu-session-context.txt').at(-1).text);
  assert.deepEqual(namesJson.attachmentDigests,[]);assert.deepEqual(namesJson.projectTextWorkbooks,[]);
  await stop();entrypoint='legacy';await start();
  const legacy=await call('/clarify','POST',{requestId,message:'继续'},a.cookie);assert.equal(legacy.status,200);assert.equal(calls.at(-1).conversation_id,'legacy-'+calls.at(-1).user);
  const db=new DatabaseSync(join(dir,'momoyu.sqlite'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM dify_conversations WHERE request_id=?').get(requestId).n,2);
  assert.equal(db.prepare('SELECT conversation_id FROM dify_conversations WHERE request_id=?').get('prior-request').conversation_id,'prior-conversation');db.close();
});
