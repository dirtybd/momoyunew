import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import sharp from 'sharp';

test('个人档案概览、积分记录与头像上传',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'momoyu-profile-'));
  const child=spawn(process.execPath,['server/index.mjs'],{
    windowsHide:true,
    env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1',DIFY_API_KEY:'',DIFY_CHATFLOW_API_KEY:'',MATCHING_SCHEDULER:'off'},
    stdio:['ignore','pipe','pipe'],
  });
  let db;
  t.after(async()=>{
    if(child.exitCode===null){child.kill();await once(child,'exit');}
    db?.close();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));
    rmSync(dir,{recursive:true,force:true});
  });
  let base;
  for await(const chunk of child.stdout){
    const match=String(chunk).match(/"port":(\d+)/);
    if(match){base='http://127.0.0.1:'+match[1];break;}
  }
  assert.ok(base,'server started');
  db=new DatabaseSync(join(dir,'momoyu.sqlite'));

  const call=async(path,method='GET',body,cookie)=>{
    const response=await fetch(base+'/api'+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const register=async username=>{
    const result=await call('/auth/register','POST',{username,password:'Synthetic2026!',displayName:username,department:'档案测试'});
    assert.equal(result.status,201);
    return result;
  };

  const owner=await register('profile-owner'),worker=await register('profile-worker');
  assert.equal((await call('/me/profile-overview')).status,401);
  assert.equal((await call('/me/points')).status,401);

  const currentRequest=randomUUID(),pastRequest=randomUUID();
  const now=new Date(),past=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,15));
  db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(currentRequest,owner.data.user.id,worker.data.user.id,JSON.stringify({title:'整理季度复盘数据',skills:['数据可视化'],status:'completed'}));
  db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(pastRequest,owner.data.user.id,worker.data.user.id,JSON.stringify({title:'品牌提案排版校对',skills:['文档排版'],status:'completed'}));
  db.prepare('INSERT INTO task_points VALUES(?,?,?,?)').run(pastRequest,worker.data.user.id,3,past.toISOString());
  db.prepare('INSERT INTO task_points VALUES(?,?,?,?)').run(currentRequest,worker.data.user.id,4,now.toISOString());

  const overview=await call('/me/profile-overview','GET',undefined,worker.cookie);
  assert.equal(overview.status,200);
  assert.equal(overview.data.totalPoints,7);
  assert.equal(overview.data.completedCount,2);
  assert.equal(overview.data.monthPoints,4);
  assert.equal(overview.data.monthCompleted,1);
  assert.equal(overview.data.monthOwners,1);
  assert.equal(overview.data.rank,1);
  assert.equal(overview.data.recent[0].title,'整理季度复盘数据');
  assert.deepEqual(overview.data.recent[0].skills,['数据可视化']);
  assert.equal(overview.data.recent[0].points,4);
  assert.equal(overview.data.user.id,worker.data.user.id);

  const history=await call('/me/points?limit=10','GET',undefined,worker.cookie);
  assert.equal(history.status,200);
  assert.equal(history.data.total,2);
  assert.equal(history.data.items.length,2);
  assert.equal(history.data.items[0].requestId,currentRequest);

  const png=await sharp({create:{width:64,height:64,channels:4,background:{r:220,g:101,b:24,alpha:1}}}).png().toBuffer();
  const form=new FormData();
  form.append('file',new Blob([png],{type:'image/png'}),'avatar.png');
  const uploaded=await fetch(base+'/api/profile/avatar',{method:'POST',headers:{cookie:worker.cookie},body:form});
  assert.equal(uploaded.status,200);
  const uploadedData=await uploaded.json();
  assert.match(uploadedData.user.avatar,/^\/api\/avatars\/[a-f0-9-]{36}-[a-f0-9]{8}\.webp$/);
  const image=await fetch(base+uploadedData.user.avatar);
  assert.equal(image.status,200);
  assert.equal(image.headers.get('content-type'),'image/webp');
  assert.ok((await image.arrayBuffer()).byteLength>0);

  const profileUpdate=await call('/profile','PUT',{bio:'更新简介后保留头像'},worker.cookie);
  assert.equal(profileUpdate.status,200);
  assert.equal(profileUpdate.data.user.avatar,uploadedData.user.avatar);
  assert.equal((await call('/session','GET',undefined,worker.cookie)).data.user.avatar,uploadedData.user.avatar);

  const removed=await fetch(base+'/api/profile/avatar',{method:'DELETE',headers:{cookie:worker.cookie,'content-type':'application/json'}});
  assert.equal(removed.status,200);
  assert.ok(!('avatar' in (await removed.json()).user));
  assert.equal((await fetch(base+uploadedData.user.avatar)).status,404);

  const invalid=new FormData();
  invalid.append('file',new Blob(['not an image'],{type:'text/plain'}),'note.txt');
  const rejected=await fetch(base+'/api/profile/avatar',{method:'POST',headers:{cookie:worker.cookie},body:invalid});
  assert.equal(rejected.status,415);
});
