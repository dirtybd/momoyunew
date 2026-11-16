import {test} from 'node:test';
import assert from 'node:assert/strict';
import {translatePlainText,resumePlainTranslationMessage,PLAIN_TRANSLATION_LANGUAGE_QUESTION} from '../server/plain-text-translation.mjs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';

const config={base:'http://dify.test/v1',key:'synthetic'};
const task=(bytes=Buffer.from('你好\n世界'),name='原文.txt')=>({isTranslation:true,mode:'document',scope:'whole',documents:[{name,bytes}],project:[],ignored:[]});
const answer=text=>new Response(JSON.stringify({data:{status:'succeeded',outputs:{plain_translation:text}}}),{headers:{'content-type':'application/json'}});

test('小TXT仅调用一次翻译Workflow，后端生成独立UTF8译文且原件不变',async()=>{
  const input=task(),before=Buffer.from(input.documents[0].bytes),calls=[];
  const result=await translatePlainText({task:input,message:'全文翻译成英文',config,userId:'test-owner',fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return answer('Hello\nWorld');}});
  assert.equal(calls.length,1);assert.equal(calls[0].url,config.base+'/workflows/run');
  assert.deepEqual(JSON.parse(calls[0].body.inputs.plain_payload_json),{text:'你好\n世界',targetLanguage:'en-US'});assert.equal(calls[0].body.inputs.payload_json,'');
  assert.equal(calls[0].body.user,'momoyu-plain-test-owner');
  assert.equal(result.outputFiles[0].name,'原文_en-US.txt');assert.equal(result.outputFiles[0].bytes.toString(),'Hello\nWorld');
  assert.deepEqual(input.documents[0].bytes,before);assert.equal(result.intent,'help');assert.equal(result.ready,false);
});

test('缺目标语言、空文件不调用模型；局部/多文件/错误编码回退原路径',async()=>{
  const call=async()=>{assert.fail('不应调用模型');};
  const missing=await translatePlainText({task:task(),message:'翻译这个文件',config,userId:'test',fetchImpl:call});assert.match(missing.reply,/哪种语言/);assert.deepEqual(missing.outputFiles,[]);
  const empty=await translatePlainText({task:task(Buffer.from(' \n')),message:'翻译成英文',config,userId:'test',fetchImpl:call});assert.match(empty.reply,/没有可翻译/);
  for(const input of [{...task(),scope:'requested'},{...task(),documents:[...task().documents,...task().documents]},{...task(),ignored:[{name:'视频.mp4'}]},{...task(),project:[{}]},task(Buffer.from([0xc3,0x28])),task(Buffer.from([0,1,2])),task(Buffer.from('字'.repeat(6001))),task(Buffer.from('字'),'原文.md')])assert.equal(await translatePlainText({task:input,message:'翻译成英文',config,userId:'test',fetchImpl:call}),null);
});

test('追问语言后简短回答继续轻量翻译，其他对话不被冒充翻译任务',()=>{
  assert.equal(resumePlainTranslationMessage('英文',PLAIN_TRANSLATION_LANGUAGE_QUESTION),'全文翻译成 en-US');
  assert.equal(resumePlainTranslationMessage('de-DE。',PLAIN_TRANSLATION_LANGUAGE_QUESTION),'全文翻译成 de-DE');
  assert.equal(resumePlainTranslationMessage('英文','普通问题'),'英文');
  assert.equal(resumePlainTranslationMessage('帮我创建需求卡',PLAIN_TRANSLATION_LANGUAGE_QUESTION),'帮我创建需求卡');
});

test('安全解码UTF8 BOM与UTF16 BOM，不要求Agent读取文件',async()=>{
  const utf16le=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('你好','utf16le')]);
  const utf16be=Buffer.from(utf16le);utf16be.swap16();
  for(const bytes of [Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('你好')]),utf16le,utf16be]){
    await translatePlainText({task:task(bytes),message:'翻译成英文',config,userId:'test',fetchImpl:async(_url,options)=>{assert.equal(JSON.parse(JSON.parse(options.body).inputs.plain_payload_json).text,'你好');return answer('Hello');}});
  }
});

test('服务错误与无效译文不重试、不生成假文件，取消与超时可中断',async()=>{
  for(const response of [new Response('bad',{status:429}),new Response('bad',{status:503}),new Response('not-json'),answer(''),answer('x'.repeat(48001))]){
    let calls=0;await assert.rejects(translatePlainText({task:task(),message:'翻译成英文',config,userId:'test',fetchImpl:async()=>{calls++;return response;}}));assert.equal(calls,1);
  }
  const controller=new AbortController();controller.abort();let called=false;
  await assert.rejects(translatePlainText({task:task(),message:'翻译成英文',config,userId:'test',signal:controller.signal,fetchImpl:async()=>{called=true;return answer('Hello');}}),{name:'AbortError'});assert.equal(called,false);
  const waitForAbort=async(_url,{signal})=>{await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
  const timer=setTimeout(()=>{},100);
  try{await assert.rejects(translatePlainText({task:task(),message:'翻译成英文',config,userId:'test',timeoutMs:10,fetchImpl:waitForAbort}),{code:'PLAIN_TRANSLATION_TIMEOUT'});}finally{clearTimeout(timer);}
});

test('网站TXT翻译直达一次Workflow，结果私人下载且失败不覆盖历史',async t=>{
  const paths=[],uploads=[],queries=[];let failing=false;
  const mock=createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);if(!req.url.startsWith('/v1/')){res.writeHead(200,{'content-type':'application/json'});res.end('{"data":[]}');return;}paths.push(req.url);
    if(req.url==='/v1/files/upload'){
      const form=await new Response(Buffer.concat(chunks),{headers:{'content-type':req.headers['content-type']}}).formData(),file=form.get('file'),id=randomUUID();
      uploads.push({id,name:file.name,text:await file.text()});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id}));return;
    }
    if(req.url==='/v1/chat-messages'){
      const b=JSON.parse(Buffer.concat(chunks).toString());queries.push(b.query);
      const frame=v=>'data: '+JSON.stringify(v)+'\n\n';res.writeHead(200,{'content-type':'text/event-stream'});
      res.end(frame({event:'message',answer:JSON.stringify({reply:'已读取此前译文，可继续指定修改要求。',intent:'help',card:null,cardStyle:null,readyForPreview:false}),conversation_id:'local-output-edit'})+frame({event:'message_end'}));return;
    }
    if(req.url!=='/v1/workflows/run'){res.writeHead(500);res.end('Unexpected path');return;}
    const b=JSON.parse(Buffer.concat(chunks).toString());assert.equal(b.inputs.payload_json,'');
    assert.deepEqual(JSON.parse(b.inputs.plain_payload_json),{text:'你好\n世界',targetLanguage:'en-US'});
    res.writeHead(failing?503:200,{'content-type':'application/json'});res.end(JSON.stringify({data:{status:'succeeded',outputs:{plain_translation:'Hello\nWorld'}}}));
  });mock.listen(0,'127.0.0.1');await once(mock,'listening');
  const dir=mkdtempSync(join(tmpdir(),'momoyu-txt-')),root='http://127.0.0.1:'+mock.address().port;
  const child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1',DIFY_ENTRYPOINT:'legacy',DIFY_API_KEY:'synthetic',DIFY_BASE_URL:root+'/v1',DIFY_CHATFLOW_API_KEY:'',DIFY_MATCHING_API_KEY:'',DIFY_TRANSLATION_BASE_URL:root+'/v1',DIFY_TRANSLATION_API_KEY:'synthetic',MATCHING_SCHEDULER:'off',AGENT_PORTAL_BASE_URL:root},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}mock.closeAllConnections();await new Promise(r=>mock.close(r));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
  let base;for await(const chunk of child.stdout){const m=String(chunk).match(/"port":(\d+)/);if(m){base='http://127.0.0.1:'+m[1];break;}}assert.ok(base);
  const call=async(path,method='GET',body,cookie)=>{const r=await fetch(base+'/api'+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const register=async username=>{const r=await call('/auth/register','POST',{username,password:'Synthetic2026!',displayName:username,department:'合成测试'});assert.equal(r.status,201);return r.cookie;};
  const owner=await register('txt-owner'),other=await register('txt-other');
  const draft=await call('/requests','POST',{},owner),id=draft.data.request.id;
  const form=new FormData();form.append('file',new Blob(['你好\n世界']),'原文.txt');
  const upload=await fetch(base+'/api/requests/'+id+'/attachments',{method:'POST',headers:{cookie:owner},body:form});assert.equal(upload.status,201);const original=(await upload.json()).attachment;
  const question=await call('/clarify','POST',{requestId:id,message:'翻译这个文件'},owner);assert.equal(question.status,200);assert.match(question.data.reply,/哪种语言/);assert.equal(paths.length,0);
  const translated=await call('/clarify','POST',{requestId:id,message:'英文'},owner);assert.equal(translated.status,200);assert.deepEqual(paths,['/v1/workflows/run']);
  const output=translated.data.messages.at(-1).files[0];assert.equal(output.name,'原文_en-US.txt');assert.ok(!JSON.stringify(translated.data).includes('local-plain-text-translation'));
  assert.equal(await (await fetch(base+output.downloadUrl,{headers:{cookie:owner}})).text(),'Hello\nWorld');
  assert.equal((await fetch(base+output.downloadUrl,{headers:{cookie:other}})).status,404);assert.equal((await fetch(base+output.downloadUrl)).status,404);
  assert.equal(await (await fetch(base+original.downloadUrl,{headers:{cookie:owner}})).text(),'你好\n世界');
  const before=(await call('/requests/'+id+'/messages','GET',undefined,owner)).data.messages.length;failing=true;
  const failed=await call('/clarify','POST',{requestId:id,message:'全文翻译成英文'},owner);assert.equal(failed.status,502);assert.equal(paths.length,2,'错误不自动重跑整个翻译');
  assert.equal((await call('/requests/'+id+'/messages','GET',undefined,owner)).data.messages.length,before);
  assert.equal(await (await fetch(base+output.downloadUrl,{headers:{cookie:owner}})).text(),'Hello\nWorld');
  failing=false;
  const edit=await call('/clarify','POST',{requestId:id,message:'把刚才译文的第二行改为Everyone，保留其余内容'},owner);assert.equal(edit.status,200);
  const localUploads=uploads.filter(x=>x.name==='原文_en-US.txt');assert.equal(localUploads.length,1);assert.equal(localUploads[0].text,'Hello\nWorld');
  const ref='dify-file-ref:'+Buffer.from(JSON.stringify({record_id:localUploads[0].id})).toString('base64');
  assert.ok(queries.at(-1).includes(ref));assert.ok(!queries.at(-1).includes('local-plain-text-translation'));
  assert.ok(queries.at(-1).includes('"transfer_method":"local_file"'));
  const uploadCount=uploads.length;
  const editAgain=await call('/clarify','POST',{requestId:id,message:'继续修改刚才的文件'},owner);assert.equal(editAgain.status,200);assert.equal(uploads.length,uploadCount,'续改复用已上传本地产物，不重复传输');
  assert.equal((await call('/clarify','POST',{requestId:id,message:'继续修改文件'},other)).status,404);
});
