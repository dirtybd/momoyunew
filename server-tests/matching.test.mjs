import {assessPublishedTask} from './helpers/task-score.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {main} from '../shared/matching-rules.mjs';
import {matchingService,defaultPreferences,validatePreferences,deadlineEnd,rankSnapshot,createMatchToken,verifyMatchToken} from '../server/matching.mjs';

const now=Date.parse('2026-11-03T10:00:00+08:00'); // Tuesday in Shanghai, not UTC midnight.
const profile=(extra={})=>({skills:['电子表格'],acceptingHelp:true,preferences:{...defaultPreferences(),weekdays:[2]},activeCount:0,...extra});
const snapshot=(candidates,request={skills:['Excel'],deadlineEnd:deadlineEnd('2026-11-03')})=>({now,request,candidates});
const rank=s=>JSON.parse(main({snapshot_json:JSON.stringify(s)}).matches_json);

test('技能同义词、空闲时段、北京时间与负载/意愿过滤',()=>{
  const result=rank(snapshot([{id:'fit',...profile()},{id:'unknown',...profile({preferences:defaultPreferences()})},{id:'busy',...profile({activeCount:2})},{id:'off',...profile({acceptingHelp:false})},{id:'mute',...profile({preferences:{...defaultPreferences(),notifications:false}})},{id:'zero',...profile({preferences:{...defaultPreferences(),weeklyMinutes:0}})},{id:'no-skill',...profile({skills:['CAD']})},{id:'too-late',...profile({preferences:{...defaultPreferences(),weekdays:[3]}})}]));
  assert.deepEqual(result.map(m=>m.candidateId),['fit','unknown']);assert.equal(result[0].nextAt,Date.parse('2026-11-03T12:00:00+08:00'));assert.equal(result[1].timeStatus,'unconfirmed');
  assert.equal(rank({...snapshot([{id:'a',...profile()}]),now:deadlineEnd('2026-11-03')+1}).length,0);
  assert.equal(rank(snapshot([{id:'partial',...profile({preferences:{...defaultPreferences(),weekdays:[2],start:'09:00',end:'10:10'}})}])).length,0,'不足15分钟不推荐');
  assert.equal(rank(snapshot([{id:'cad',...profile({skills:['CAD']})}],{skills:['Word'],deadlineEnd:null})).length,0,'不同技能不做任意子串相似匹配');
  assert.equal(rank(snapshot([{id:'descriptive',...profile({skills:['Excel 数据核对 / 透视表']})}])).length,1,'技能标签允许带描述');
  assert.equal(rank(snapshot([{id:'substring',...profile({skills:['Excelling']})}])).length,0,'英文须完整词，不能误匹配子串');
  assert.equal(deadlineEnd('下周五'),null);assert.equal(deadlineEnd('2026-11-03'),Date.parse('2026-11-03T23:59:59+08:00'));
  for(const bad of [{weekdays:[0]},{end:'11:00'},{maxActive:0},{weeklyMinutes:-1},{notifications:'yes'},{weekdays:[2,2]}])assert.throws(()=>validatePreferences({...defaultPreferences(),...bad}));
  const token=createMatchToken('secret','owner','request');assert.equal(verifyMatchToken(token,'secret').requestId,'request');assert.equal(verifyMatchToken(token,'wrong'),null);assert.equal(verifyMatchToken(token+'a','secret'),null);
});

function fixture(){
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,profile TEXT);CREATE TABLE requests(id TEXT PRIMARY KEY,owner_id TEXT,claimer_id TEXT,data TEXT);');
  const user=(id,p={})=>db.prepare('INSERT OR REPLACE INTO users VALUES(?,?)').run(id,JSON.stringify({skills:['Excel'],acceptingHelp:true,helpPreferences:defaultPreferences(),displayName:'绝不传给工作流的姓名',bio:'private-notes',...p}));
  const task=(id,d={})=>db.prepare('INSERT OR REPLACE INTO requests VALUES(?,?,NULL,?)').run(id,'owner',JSON.stringify({title:'名单核对',skills:['Excel'],status:'open',visibility:'company',deadline:'2026-11-04',...d}));
  return {db,user,task};
}

test('发布队列去重、每日上限、过期与演示/草稿过滤、读消息隔离',async()=>{
  const {db,user,task}=fixture();user('alice');user('owner');user('bob',{acceptingHelp:false});
  for(let i=0;i<5;i++)task('job'+i);
  task('draft',{status:'draft'});task('private',{visibility:'private'});task('demo',{isDemo:true});task('expired',{deadline:'2026-11-01'});task('announcement',{kind:'announcement'});
  const m=matchingService({db,config:null,clock:()=>now});m.enqueueOpen();await m.drain();
  assert.equal(m.list('alice').items.length,3,'每天最多3条');assert.equal(m.list('bob').unread,0);assert.equal(m.list('owner').unread,0);assert.equal(m.list('alice').unread,3);
  m.enqueueOpen();await m.drain();assert.equal(m.list('alice').items.length,3,'定时重扫不会重复通知');
  const id=m.list('alice').items[0].id;m.read('bob',id);assert.equal(m.list('alice').unread,3);m.read('alice',id);assert.equal(m.list('alice').unread,2);m.readAll('alice');assert.equal(m.list('alice').unread,0);
  const first=m.list('alice').items[0];task(first.requestId,{deletedAt:'now'});assert.equal(m.list('alice').items.find(n=>n.id===first.id).available,false);assert.equal(m.list('alice').items.find(n=>n.id===first.id).title,'此需求已不再公开');db.close();
});

test('工作流失败保留重试任务，重启恢复，并在返回后复核最新意愿',async t=>{
  const {db,user,task}=fixture();user('alice');task('job');let fail=true,received,withdraw=false,requeue;
  const mock=createServer(async(req,res)=>{let b='';for await(const c of req)b+=c;received=JSON.parse(b);if(fail){res.writeHead(503);return res.end();}if(withdraw)user('alice',{acceptingHelp:false});if(requeue){const f=requeue;requeue=null;f();}const s=JSON.parse(received.inputs.snapshot_json);const matches=s.candidates.map(c=>({candidateId:c.id,score:90,reason:'技能说明支持表格核对',evidence:c.skills[0]}));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:{status:'succeeded',outputs:{matches_json:JSON.stringify(matches)}}}));});mock.listen(0,'127.0.0.1');await once(mock,'listening');t.after(()=>{mock.closeAllConnections();mock.close();db.close();});
  const config={base:'http://127.0.0.1:'+mock.address().port+'/v1',key:'test-only'};let tick=now;
  const m=matchingService({db,config,clock:()=>tick});m.enqueue('job');await m.drain();assert.equal(m.publicState('job').status,'pending');assert.equal(m.list('alice').unread,0);
  assert.ok(!JSON.stringify(received).includes('private-notes'));assert.ok(!JSON.stringify(received).includes('绝不传给'));
  fail=false;tick+=120000;const afterRestart=matchingService({db,config,clock:()=>tick});await afterRestart.drain();assert.equal(afterRestart.publicState('job').mode,'dify');assert.equal(afterRestart.list('alice').unread,1);
  task('job2',{title:'第二种表格工作'});withdraw=true;afterRestart.enqueue('job2');await afterRestart.drain();assert.equal(afterRestart.list('alice').unread,1,'工作流执行期间撤回意愿则不发');
  withdraw=false;user('alice');task('job3',{title:'第三种表格工作'});requeue=()=>{user('late-joiner');afterRestart.enqueue('job3');};afterRestart.enqueue('job3');await afterRestart.drain();assert.equal(afterRestart.list('late-joiner').unread,1,'工作流运行中有新档案须重跑，不丢失入队触发');
  task('stale-lease');db.prepare("INSERT INTO matching_jobs(request_id,status,lease_until) VALUES('stale-lease','running',?)").run(tick-1);await afterRestart.drain();assert.equal(afterRestart.publicState('stale-lease').status,'done','崩溃遗留且租约已到期的任务可恢复');
  const malicious=createServer((req,res)=>res.end(JSON.stringify({data:{status:'succeeded',outputs:{matches_json:JSON.stringify([{candidateId:'intruder',score:100}])}}})));malicious.listen(0,'127.0.0.1');await once(malicious,'listening');t.after(()=>{malicious.closeAllConnections();malicious.close();});await assert.rejects(()=>rankSnapshot(snapshot([{id:'alice',...profile()}]),{base:'http://127.0.0.1:'+malicious.address().port,key:'x'}));
});

test('API建档设置、草稿预匹配不发送、发布后站内推荐、读状态及重启持久化',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'momoyu-inbox-'));let child,base;
  const start=async()=>{child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:dir,DIFY_API_KEY:'',DIFY_MATCHING_API_KEY:'',CARD_TOOL_SECRET:'matching-api-test-secret-at-least-32-chars',MATCHING_SCHEDULER:'off'},stdio:['ignore','pipe','pipe']});for await(const c of child.stdout){const m=String(c).match(/"port":(\d+)/);if(m){base='http://127.0.0.1:'+m[1];break;}}};
  const stop=async()=>{if(child?.exitCode===null){child.kill();await once(child,'exit');}};
  t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});await start();
  const call=async(path,method='GET',data,cookie,status=200)=>{const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...cookie?{cookie}:{}},body:data===undefined?undefined:JSON.stringify(data)});const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));return {data:b,cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const register=async name=>call('/auth/register','POST',{username:name,password:'Matching2026',displayName:name,department:'测试',skills:['Excel'],acceptingHelp:true},undefined,201);
  const a=await register('alice'),b=await register('bob'),c=await register('carol');
  await call('/profile','PUT',{helpPreferences:{...defaultPreferences(),maxActive:0}},a.cookie,400);
  await call('/profile','PUT',{acceptingHelp:false},c.cookie);
  const id=(await call('/requests','POST',{},a.cookie,201)).data.request.id;
  const token=createMatchToken('matching-api-test-secret-at-least-32-chars',a.data.user.id,id),card_json=JSON.stringify({title:'核对名单',skills:['Excel'],deadline:null});
  await call('/internal/match-preview','POST',{match_token:'fake',card_json},undefined,403);
  const preview=(await call('/internal/match-preview','POST',{match_token:token,card_json})).data;assert.equal(preview.count,1);assert.equal(preview.sent,false);assert.equal((await call('/notifications','GET',undefined,b.cookie)).data.unread,0);assert.ok(!JSON.stringify(preview).includes('bob'));
  await call('/requests/'+id,'PATCH',{title:'核对名单',problem:'两份表需核对',desiredOutcome:'找出差异',deliverables:['差异表'],skills:['Excel'],anonymous:true},a.cookie);
  const published=(await call('/requests/'+id+'/publish','POST',{confirmed:true},a.cookie)).data;assert.ok(published.matching);
  let inbox;for(let i=0;i<20;i++){inbox=(await call('/notifications','GET',undefined,b.cookie)).data;if(inbox.unread)break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(inbox.unread,1);assert.equal(inbox.items[0].requestId,id);assert.equal(inbox.items[0].title,'核对名单');assert.equal((await call('/notifications','GET',undefined,c.cookie)).data.unread,0);await call('/notifications','GET',undefined,undefined,401);
  await call('/notifications/'+inbox.items[0].id+'/read','POST',{},a.cookie);assert.equal((await call('/notifications','GET',undefined,b.cookie)).data.unread,1);
  await call('/notifications/'+inbox.items[0].id+'/read','POST',{},b.cookie);await stop();await start();assert.equal((await call('/notifications','GET',undefined,b.cookie)).data.unread,0);assert.equal((await call('/notifications','GET',undefined,b.cookie)).data.items.length,1);
  assessPublishedTask(dir,id);
  await call('/requests/'+id+'/claim','POST',{},b.cookie);assert.equal((await call('/notifications','GET',undefined,b.cookie)).data.items[0].status,'claimed');
});
