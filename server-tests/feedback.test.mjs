import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

test('站内改进意见：员工提交、管理员站内通知、已读和权限隔离',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'momoyu-feedback-'));
  let child,base;
  const stop=async()=>{if(child&&child.exitCode===null){child.kill();await once(child,'exit');}};
  t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
  child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,MATCHING_SCHEDULER:'off',DIFY_API_KEY:'',DIFY_CHATFLOW_API_KEY:'',DIFY_ENTRYPOINT:'legacy',AGENT_CATALOG_TTL_MS:'3600000'},stdio:['ignore','pipe','pipe']});
  let text='';for await(const chunk of child.stdout){text+=chunk;const m=text.match(/"port":(\d+)/);if(m){base='http://127.0.0.1:'+m[1];break;}}
  assert.ok(base,'test server did not start');
  async function call(path,method='GET',body,cookie){const r=await fetch(base+'/api'+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json().catch(()=>({}));return{status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const register=async username=>call('/auth/register','POST',{username,password:'Feedback2026!',displayName:username,department:'测试',skills:[],availability:'',acceptingHelp:false});
  const admin=await register('feedback-admin'),employee=await register('feedback-employee');
  assert.equal(admin.status,201);assert.equal(employee.status,201);
  const db=new DatabaseSync(join(dir,'momoyu.sqlite'));
  db.prepare("INSERT INTO account_access(user_id,role,enabled) VALUES(?, 'primary_admin',1) ON CONFLICT(user_id) DO UPDATE SET role='primary_admin',enabled=1").run(admin.data.user.id);
  db.close();

  const created=await call('/feedback','POST',{content:'希望站内消息切换更平滑。',category:'功能建议'},employee.cookie);
  assert.equal(created.status,201);
  assert.equal(created.data.email.status,'skipped');
  assert.equal(created.data.notify.status,'skipped');
  assert.equal(created.data.feedback.content,'希望站内消息切换更平滑。');

  const employeeList=await call('/feedback','GET',undefined,employee.cookie);
  assert.equal(employeeList.data.admin,false);assert.equal(employeeList.data.items.length,1);
  const adminList=await call('/feedback','GET',undefined,admin.cookie);
  assert.equal(adminList.data.admin,true);assert.equal(adminList.data.unread,1);assert.equal(adminList.data.items[0].displayName,'feedback-employee');

  const notifications=await call('/notifications','GET',undefined,admin.cookie);
  assert.equal(notifications.data.items[0].type,'feedback');assert.equal(notifications.data.unread,1);assert.equal(notifications.data.items[0].title,'站内改进意见');

  assert.equal((await call('/feedback/'+created.data.feedback.id+'/read','POST',{},employee.cookie)).status,403);
  const read=await call('/feedback/'+created.data.feedback.id+'/read','POST',{},admin.cookie);
  assert.equal(read.status,200);assert.equal(read.data.unread,0);
  assert.equal((await call('/notifications','GET',undefined,admin.cookie)).data.unread,0);
  assert.equal((await call('/feedback','POST',{content:'短'},employee.cookie)).status,400);
});
