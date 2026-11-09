import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {createServer} from 'node:http';import {once} from 'node:events';import {taskDifficulty,scoreTask} from '../server/task-difficulty.mjs';

test('难度严格1–5、失败不伪造、重启租约恢复及旧任务结果不能覆盖新内容',async t=>{
  let value={score:3,reason:'需要多步骤核对'},status=200,delay,calls=0;
  const upstream=createServer(async(req,res)=>{for await(const c of req){}calls++;if(delay)await delay();res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({data:{status:'succeeded',outputs:{difficulty_result_json:JSON.stringify(value)}}}));});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');t.after(()=>{upstream.closeAllConnections();upstream.close();});
  const config={base:'http://127.0.0.1:'+upstream.address().port+'/v1',key:'synthetic'},d={title:'合成工作',problem:'核对表格',deliverables:['清单'],status:'open',visibility:'company'};
  for(const bad of [{score:0,reason:'x'},{score:6,reason:'x'},{score:1.5,reason:'x'},{score:'3',reason:'x'},{score:3,reason:''},{score:3,reason:'x',reward:999}]){value=bad;await assert.rejects(scoreTask(d,config));}
  value={score:3,reason:'需要多步骤核对'};assert.deepEqual(await scoreTask(d,config),value);
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE requests(id TEXT PRIMARY KEY,data TEXT)');db.prepare('INSERT INTO requests VALUES(?,?)').run('task',JSON.stringify(d));let now=100000,busy=true;
  let service=taskDifficulty({db,config,clock:()=>now,isBusy:()=>busy});service.enqueue('task');const before=calls;await service.drain();assert.equal(calls,before);assert.equal(service.state('task').status,'pending');
  busy=false;status=429;await service.drain();assert.deepEqual(service.state('task'),{status:'pending',score:null,reason:''});assert.ok(db.prepare('SELECT next_at FROM task_difficulty').get().next_at>now);
  status=200;now+=400000;db.prepare("UPDATE task_difficulty SET status='running',lease_until=?").run(now-1);
  service=taskDifficulty({db,config,clock:()=>now});await service.drain();assert.equal(service.state('task').score,3,'重启后过期租约可恢复');
  const cached=calls;db.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify({...d,rewardPoints:500}),'task');service.enqueue('task');await service.drain();assert.equal(calls,cached,'奖励金额不影响评分/缓存');
  db.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify({...d,title:'新任务'}),'task');service.enqueue('task');let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);delay=()=>{entered();return gate;};
  const pending=service.drain();await started;db.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify({...d,status:'draft'}),'task');release();await pending;assert.deepEqual(service.state('task'),{status:'unavailable',score:null,reason:''},'草稿不能被异步公开评分');
});
