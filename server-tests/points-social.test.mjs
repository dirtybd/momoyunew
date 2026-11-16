import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {createServer} from 'node:http';import {once} from 'node:events';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,sep} from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {taskPoints} from '../server/task-points.mjs';

test('自动积分迁移只调整未接取卡，历史约定和已发积分保留，新规则不可越界',()=>{
  const db=new DatabaseSync(':memory:');try{db.exec('CREATE TABLE requests(id TEXT PRIMARY KEY,owner_id TEXT,claimer_id TEXT,data TEXT)');
    for(const [id,status,rewardPoints,claimer] of [['draft','draft',80,null],['open','open',0,null],['locked','claimed',75,'worker'],['completed','completed',20,'worker']])db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(id,'owner',claimer,JSON.stringify({status,rewardPoints}));
    const points=taskPoints(db),data=id=>JSON.parse(db.prepare('SELECT data FROM requests WHERE id=?').get(id).data);
    assert.equal(data('draft').rewardPoints,null);assert.equal(data('open').rewardPoints,null);assert.equal(data('draft').rewardPolicy,'difficulty-v1');assert.equal(data('locked').rewardPoints,75);assert.equal(data('locked').rewardPolicy,undefined);
    points.award({id:'locked',owner_id:'owner',claimer_id:'worker'},data('locked'),new Date().toISOString());assert.equal(points.awarded('locked'),75);
    assert.throws(()=>points.award({id:'bad',owner_id:'owner',claimer_id:'worker'},{rewardPolicy:'five-point-v1',rewardPoints:6},new Date().toISOString()),{code:'INVALID_AWARD'});
    taskPoints(db);assert.equal(points.awarded('locked'),75);assert.equal(data('completed').rewardPoints,20);
  }finally{db.close();}
});

test('点赞幂等、任务并发上限、难度评分、退回重提、唯一积分结算与月榜',async t=>{
  const summaries=[];
  const upstream=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const {inputs}=JSON.parse(raw);if(inputs.difficulty_json)summaries.push(JSON.parse(inputs.difficulty_json));res.setHeader('content-type','application/json');res.end(JSON.stringify({data:{status:'succeeded',outputs:{difficulty_result_json:JSON.stringify({score:3,reason:'需要多步骤整理与核对'}),review_result_json:JSON.stringify({allow:true,urgent:false,reason:'合成通过'}),matches_json:'[]'}}}));});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const dir=mkdtempSync(join(tmpdir(),'momoyu-points-')),child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1',DIFY_API_KEY:'',DIFY_CHATFLOW_API_KEY:'',MATCHING_SCHEDULER:'off',DIFY_MATCHING_BASE_URL:'http://127.0.0.1:'+upstream.address().port+'/v1',DIFY_MATCHING_API_KEY:'synthetic'},stdio:['ignore','pipe','pipe']});let db;
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}db?.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
  let base;for await(const c of child.stdout){const m=String(c).match(/"port":(\d+)/);if(m){base='http://127.0.0.1:'+m[1];break;}}assert.ok(base);db=new DatabaseSync(join(dir,'momoyu.sqlite'));
  async function call(path,method='GET',body,cookie){const r=await fetch(base+'/api'+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const register=async username=>{const r=await call('/auth/register','POST',{username,password:'Synthetic2026!',displayName:username,department:'积分验收'});assert.equal(r.status,201);return r;};
  const a=await register('points-owner'),b=await register('points-worker'),c=await register('points-reader');
  assert.equal((await call('/leaderboard')).status,401);assert.equal((await call('/leaderboard?period=bad','GET',undefined,a.cookie)).status,400);
  const posted=await call('/care/posts','POST',{title:'点赞合成测试',content:'匿名分享',kind:'vent',confirmed:true},a.cookie);assert.equal(posted.status,201);const post='/care/posts/'+posted.data.post.id;
  const liked=await Promise.all([call(post+'/like','PUT',{liked:true},b.cookie),call(post+'/like','PUT',{liked:true},b.cookie)]);assert.ok(liked.every(r=>r.status===200));assert.equal(liked[1].data.post.likeCount,1);
  assert.equal((await call(post+'/like','PUT',{liked:true},c.cookie)).data.post.likeCount,2);
  assert.equal((await call(post+'/like','PUT',{liked:false},b.cookie)).data.post.likeCount,1);assert.equal((await call(post+'/like','PUT',{liked:false},b.cookie)).data.post.likeCount,1);
  assert.equal((await call(post+'/like','PUT',{liked:true,userId:c.data.user.id},b.cookie)).status,400);
  assert.equal((await call(post,'GET',undefined,c.cookie)).data.post.liked,true);assert.equal((await call(post,'GET',undefined,a.cookie)).data.post.liked,false);
  await call(post+'/archive','POST',{confirmed:true},a.cookie);assert.equal((await call(post+'/like','PUT',{liked:true},b.cookie)).status,404);
  async function draft(rewardPoints){const created=await call('/requests','POST',{},a.cookie),id=created.data.request.id;const r=await call('/requests/'+id,'PATCH',{title:'合成互助任务',problem:'核对两份表格',desiredOutcome:'可靠的差异表',deliverables:['差异清单'],rewardText:'一杯咖啡'},a.cookie);assert.equal(r.status,200);return id;}
  const ids=[];for(const points of [5,2,3,4,5]){const id=await draft(points);ids.push(id);assert.equal((await call('/requests/'+id+'/publish','POST',{confirmed:true},a.cookie)).status,200);}
  for(const rewardPoints of [0,1,5,6,1.5,'3'])assert.equal((await call('/requests/'+ids[0],'PATCH',{rewardPoints,confirmed:true},a.cookie)).status,400);
  const excess=await draft(1);assert.equal((await call('/requests/'+excess+'/publish','POST',{confirmed:true},a.cookie)).status,409);
  assert.deepEqual((await call('/me/task-limits','GET',undefined,a.cookie)).data.publishing,{used:5,limit:5});
  await call('/requests/'+ids[4]+'/archive','POST',{confirmed:true},a.cookie);
  const another=await draft(2);const publication=await Promise.all([call('/requests/'+excess+'/publish','POST',{confirmed:true},a.cookie),call('/requests/'+another+'/publish','POST',{confirmed:true},a.cookie)]);assert.deepEqual(publication.map(r=>r.status).sort(),[200,409]);
  assert.equal((await call('/requests/'+ids[4]+'/restore','POST',{confirmed:true},a.cookie)).status,409);
  for(let i=0;i<100&&db.prepare("SELECT count(*) n FROM task_difficulty WHERE status='scored'").get().n<4;i++)await new Promise(r=>setTimeout(r,10));
  const claims=await Promise.all(ids.slice(0,4).map(id=>call('/requests/'+id+'/claim','POST',{},b.cookie)));assert.equal(claims.filter(r=>r.status===200).length,3);assert.equal(claims.filter(r=>r.status===409).length,1);
  const taken=ids.slice(0,4).filter((id,i)=>claims[i].status===200),first=taken[0],second=taken[1];
  assert.equal((await call('/me/task-limits','GET',undefined,b.cookie)).data.claiming.used,3);
  const pointsFor=id=>3;
  assert.equal((await call('/requests/'+first,'PATCH',{rewardPoints:999,confirmed:true},a.cookie)).status,409,'接取后不能改单方奖励');
  const submission=await call('/requests/'+first+'/submit','POST',{note:'已完成合成任务',attachmentIds:[]},b.cookie);assert.equal(submission.status,200);
  assert.equal((await call('/leaderboard?period=all','GET',undefined,b.cookie)).data.items.length,0,'提交不提前给分');
  const approve={submissionId:submission.data.submissions[0].id,decision:'approve',feedback:'合成验收通过',confirmed:true};
  const completed=await Promise.all([call('/requests/'+first+'/review','POST',approve,a.cookie),call('/requests/'+first+'/review','POST',approve,a.cookie)]);assert.deepEqual(completed.map(r=>r.status).sort(),[200,409]);
  assert.equal(completed.find(r=>r.status===200).data.request.awardedPoints,pointsFor(first));assert.equal(db.prepare('SELECT count(*) n FROM task_points WHERE request_id=?').get(first).n,1);
  assert.ok(completed.find(r=>r.status===200).data.request.deletedAt,'验收完成后自动下架');
  assert.equal((await call('/me/task-limits','GET',undefined,b.cookie)).data.claiming.used,2);
  assert.equal((await call('/requests/'+ids[4]+'/restore','POST',{confirmed:true},a.cookie)).status,200,'验收后释放发布名额');
  const draftSubmit=await call('/requests/'+second+'/submit','POST',{note:'第一版',attachmentIds:[]},b.cookie);
  assert.equal((await call('/requests/'+second+'/review','POST',{submissionId:draftSubmit.data.submissions[0].id,decision:'changes_requested',feedback:''},a.cookie)).status,400);
  assert.equal((await call('/requests/'+second+'/review','POST',{submissionId:draftSubmit.data.submissions[0].id,decision:'changes_requested',feedback:'补充核对总数'},a.cookie)).status,200);
  assert.equal((await call('/leaderboard?period=all','GET',undefined,b.cookie)).data.me.points,pointsFor(first));
  const revised=await call('/requests/'+second+'/submit','POST',{note:'已补总数',attachmentIds:[]},b.cookie);assert.equal(revised.data.submissions.length,2);
  assert.equal((await call('/requests/'+second+'/review','POST',{...approve,submissionId:revised.data.submissions[0].id,points:1000},a.cookie)).status,400);
  assert.equal((await call('/requests/'+second+'/review','POST',{...approve,submissionId:revised.data.submissions[0].id},a.cookie)).status,200);
  const board=(await call('/leaderboard?period=month','GET',undefined,b.cookie)).data;assert.equal(board.me.points,pointsFor(first)+pointsFor(second));assert.equal(board.me.completedCount,2);assert.equal(board.me.rank,1);assert.ok(!JSON.stringify(board).includes(first),'排行榜不泄露任务关联');
  await call('/requests/'+first+'/archive','POST',{confirmed:true},a.cookie);assert.equal((await call('/requests/'+first,'GET',undefined,c.cookie)).status,404);assert.equal((await call('/leaderboard?period=all','GET',undefined,b.cookie)).data.me.points,board.me.points,'下架保留积分');
  assert.equal((await call('/requests/'+first+'/restore','POST',{confirmed:true},b.cookie)).status,403,'接取者不能恢复发布者下架的卡片');
  assert.equal((await call('/requests/'+first+'/workspace','GET',undefined,b.cookie)).status,200);
  assert.ok(summaries.length>0);assert.ok(summaries.every(d=>!('rewardPoints'in d)&&!('owner'in d)&&!('attachments'in d)));
  for(let i=0;i<30&&!db.prepare("SELECT 1 FROM task_difficulty WHERE status='scored'").get();i++)await new Promise(r=>setTimeout(r,30));
  assert.ok(db.prepare("SELECT 1 FROM task_difficulty WHERE score=3 AND status='scored'").get());
  const old=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()-1,2)).toISOString();db.prepare('UPDATE task_points SET awarded_at=? WHERE request_id=?').run(old,first);
  assert.equal((await call('/leaderboard?period=month','GET',undefined,b.cookie)).data.me.points,pointsFor(second));assert.equal((await call('/leaderboard?period=all','GET',undefined,b.cookie)).data.me.points,board.me.points);
});
