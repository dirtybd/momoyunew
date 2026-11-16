import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {collectOutputLinks,downloadOutputFiles} from '../server/dify-output-files.mjs';
import {readDifyStream} from '../server/dify.mjs';

const frame=o=>'data: '+JSON.stringify(o)+'\n\n';
test('文件只取实际工具事件，拒绝跨轮、伪文件、重定向和超大结果',async t=>{
  let mode='ok',hits=0;const id=randomUUID(),probeId=randomUUID(),prefix='mm-current-',bytes=Buffer.from('%PDF-1.7\nfixture');
  const mock=createServer((req,res)=>{
    hits++;assert.equal(req.headers.authorization,undefined);
    if(mode==='redirect'){res.writeHead(302,{Location:'http://127.0.0.1:1/private'});return res.end();}
    res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent((mode==='wrong'||req.url.includes(probeId)?'mm-other-':prefix)+'结果.pdf'),...(mode==='large'?{'Content-Length':String(21*1024*1024)}:{})});res.end(mode==='invalid'?'not-a-pdf':bytes);
  });mock.listen(0,'127.0.0.1');await once(mock,'listening');t.after(()=>{mock.closeAllConnections();mock.close();});
  const config={base:'http://127.0.0.1:'+mock.address().port+'/v1'},link=`https://ignored.invalid/files/tools/${id}.pdf?timestamp=1&nonce=n&sign=s`;
  assert.equal(collectOutputLinks({output:JSON.stringify({public_download_url:link})}).size,1);
  assert.equal(collectOutputLinks('ordinary '+link).size,0);
  assert.equal(collectOutputLinks('<output>\n'+JSON.stringify({public_download_url:link}).replaceAll('&','\\u0026')+'\n</output>').size,1);
  assert.deepEqual([...collectOutputLinks('<output>\n'+JSON.stringify({public_download_url:link}).replaceAll('&','\\u0026')+'\n</output>')],[link]);
  const stream=await readDifyStream(new Response(frame({event:'message',answer:JSON.stringify({public_download_url:link}),conversation_id:'x'})+frame({event:'message_end'}),{headers:{'Content-Type':'text/event-stream'}}));assert.equal(stream.outputLinks.size,0,'最终JSON不能伪造工具文件');
  const good=await downloadOutputFiles({config,links:new Set([link]),prefix});assert.equal(good.outputs.length,1);assert.equal(good.outputs[0].name,'结果.pdf');assert.deepEqual(good.outputs[0].bytes,bytes);
  assert.equal(good.outputs[0].nativeReference,'dify-file-ref:'+Buffer.from(JSON.stringify({record_id:id})).toString('base64'),'结果续改引用保留Python urlsafe_b64decode要求的填充');
  const mixed=await downloadOutputFiles({config,links:new Set([link,link.replace(id,probeId)]),prefix});assert.equal(mixed.outputs.length,1);assert.deepEqual(mixed.warnings,[],'探测文件不冒充结果，也不误报有效结果失败');
  assert.equal((await downloadOutputFiles({config,links:new Set([link,link.replace('timestamp=1','timestamp=2')]),prefix})).outputs.length,1,'同一工具文件只保存一次');
  for(mode of ['wrong','invalid','large','redirect'])assert.equal((await downloadOutputFiles({config,links:new Set([link]),prefix})).outputs.length,0,mode);
  const before=hits;await downloadOutputFiles({config,links:new Set(['http://127.0.0.1/private?timestamp=1&nonce=n&sign=s']),prefix});assert.equal(hits,before);
});

test('真实工具文件接回、私人下载、历史恢复、后续修改引用与失败回滚',async t=>{
  let mode='ok',latestPrefix='',currentId=randomUUID();const chats=[];
  const mock=createServer(async(req,res)=>{
    if(req.url.startsWith('/files/tools/')){
      res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent((mode==='wrong'?'mm-other-':latestPrefix)+'处理结果.pdf')});return res.end('%PDF-1.7\nsynthetic-result');
    }
    let body='';for await(const c of req)body+=c;const b=JSON.parse(body);chats.push(b);latestPrefix=b.query.match(/output_prefix=(mm-[a-f0-9]{32}-)/)[1];currentId=randomUUID();
    const link=`http://localhost/files/tools/${currentId}.pdf?timestamp=1&nonce=n&sign=s`;
    res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(frame({event:'agent_thought',tool:'shell',observation:JSON.stringify({output:JSON.stringify({public_download_url:link})})})+frame({event:'message',answer:JSON.stringify({reply:'处理完成 '+link,intent:'help',card:null,cardStyle:null,readyForPreview:false}),conversation_id:'remote-'+b.user})+frame({event:'message_end'}));
  });mock.listen(0,'127.0.0.1');await once(mock,'listening');
  const dir=mkdtempSync(join(tmpdir(),'momoyu-outputs-'));let child,base;
  const start=async()=>{child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:dir,DIFY_BASE_URL:'http://127.0.0.1:'+mock.address().port+'/v1',DIFY_API_KEY:'output-test-only'},stdio:['ignore','pipe','pipe']});for await(const c of child.stdout){const m=String(c).match(/"port":(\d+)/);if(m){base='http://127.0.0.1:'+m[1];break;}}};
  const stop=async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}};
  t.after(async()=>{await stop();mock.closeAllConnections();await new Promise(r=>mock.close(r));rmSync(dir,{recursive:true,force:true});});await start();
  const call=async(path,method='GET',body,cookie,expected=200)=>{const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...cookie?{cookie}:{}},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,expected,JSON.stringify(d));return {data:d,cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const register=async username=>(await call('/auth/register','POST',{username,password:'OutputTest2026',displayName:username,department:'测试'},undefined,201)).cookie;
  const a=await register('alice'),b=await register('bob');const first=(await call('/clarify','POST',{message:'合并图片为PDF'},a)).data;
  assert.equal(first.hasCard,false);const output=first.messages.at(-1).files[0];assert.equal(output.name,'处理结果.pdf');assert.ok(!JSON.stringify(first).includes('timestamp=1'));assert.ok(!JSON.stringify(first).includes(latestPrefix));
  assert.equal((await fetch(base+output.downloadUrl,{headers:{cookie:a}})).status,200);
  assert.equal((await fetch(base+output.downloadUrl,{headers:{cookie:b}})).status,404);assert.equal((await fetch(base+output.downloadUrl)).status,404);
  await call(`/requests/${first.request.id}/messages`,'GET',undefined,b,404);
  assert.ok((await call('/me/requests','GET',undefined,a)).data.drafts.some(r=>r.id===first.request.id));
  await stop();await start();const restored=(await call(`/requests/${first.request.id}/messages`,'GET',undefined,a)).data.messages;assert.equal(restored.at(-1).files[0].id,output.id);
  const second=(await call('/clarify','POST',{requestId:first.request.id,message:'把刚才结果再修改一版'},a)).data;assert.equal(second.messages.filter(m=>m.files?.length).length,2);assert.ok(chats.at(-1).query.includes('dify-file-ref:'));
  mode='wrong';const failed=(await call('/clarify','POST',{requestId:first.request.id,message:'重做一个文件'},a)).data;assert.equal(failed.messages.at(-1).files,undefined);assert.ok(failed.reply.includes('未能接回'));assert.ok(failed.warnings.length);
  mode='ok';const db=new DatabaseSync(join(dir,'momoyu.sqlite'));const owner=db.prepare("SELECT id FROM users WHERE username='alice'").get().id;db.prepare("INSERT INTO attachments(id,request_id,uploader_id,role,name,mime,size,storage_key,included,created_at) VALUES('quota',?,?,'material','quota.zip','application/octet-stream',1073741824,'none',0,'now')").run(first.request.id,owner);db.close();
  const count=readdirSync(join(dir,'uploads')).length;await call('/clarify','POST',{requestId:first.request.id,message:'空间不够时不能保存'},a,413);assert.equal(readdirSync(join(dir,'uploads')).length,count,'失败清理暂存文件');
});
