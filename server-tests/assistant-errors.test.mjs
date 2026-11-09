import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,sep} from 'node:path';

test('模型限流必须返回安全error帧，不丢失原因或自动重跑整个Agent',async t=>{
  let calls=0,mode='event';
  const upstream=createServer(async(req,res)=>{for await(const chunk of req){}calls++;if(mode==='http'){res.writeHead(429).end('private-credential-never-display');return;}res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify(mode==='overload'?{event:'error',status:429,message:'[overloaded] the server is overloaded; retry shortly; private-credential-never-display'}:mode==='workflow'?{event:'workflow_finished',data:{status:'failed',error:'Provider 429 private-credential-never-display'}}:{event:'error',message:'Provider HTTP 429 rate limit; private-credential-never-display'})+'\n\n');});
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const dir=mkdtempSync(join(tmpdir(),'momoyu-errors-')),child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,DATA_DIR:dir,PORT:'0',DIFY_ENTRYPOINT:'legacy',DIFY_API_KEY:'synthetic',DIFY_BASE_URL:'http://127.0.0.1:'+upstream.address().port+'/v1',MATCHING_SCHEDULER:'off'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{child.kill();await once(child,'exit').catch(()=>{});upstream.closeAllConnections();upstream.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
  let base;for await(const c of child.stdout){const m=String(c).match(/"port":(\d+)/);if(m){base='http://127.0.0.1:'+m[1];break;}}
  const registered=await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'error-test',password:'Synthetic2026!',displayName:'错误测试',department:'合成测试'})});
  const cookie=registered.headers.get('set-cookie').split(';')[0];
  const response=await fetch(base+'/api/clarify',{method:'POST',headers:{cookie,'content-type':'application/json',accept:'text/event-stream'},body:JSON.stringify({message:'没有资料，先确认表格需要什么内容'})}),wire=await response.text();
  assert.match(wire,/event: error\ndata: /,'流式已开始后的失败也必须返回error帧');
  assert.match(wire,/限流/);assert.ok(!wire.includes('private-credential'));assert.equal(calls,1);
  const drafts=await(await fetch(base+'/api/me/requests',{headers:{cookie}})).json();assert.equal(drafts.drafts.length,0,'失败不伪造成功对话');
  const headers={cookie,'content-type':'application/json'},draft=await(await fetch(base+'/api/requests',{method:'POST',headers,body:'{}'})).json();
  await fetch(base+'/api/requests/'+draft.request.id,{method:'PATCH',headers,body:JSON.stringify({title:'原草稿必须保留',problem:'原始资料说明'})});
  for(const kind of ['http','workflow','overload']){
    mode=kind;const before=calls,r=await fetch(base+'/api/clarify',{method:'POST',headers:{...headers,accept:'text/event-stream'},body:JSON.stringify({requestId:draft.request.id,message:'继续整理表格'})}),body=await r.text();
    assert.match(body,/event: error\ndata: /);assert.ok(!body.includes('private-credential'));if(kind==='overload')assert.match(body,/上游过载/);assert.equal(calls-before,1);
    const kept=await(await fetch(base+'/api/requests/'+draft.request.id,{headers})).json();assert.equal(kept.request.title,'原草稿必须保留');assert.equal(kept.request.problem,'原始资料说明');
    const history=await(await fetch(base+'/api/requests/'+draft.request.id+'/messages',{headers})).json();assert.equal(history.messages.length,0);
  }
});
