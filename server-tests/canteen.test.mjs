import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';

const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');

test('食堂菜单、实拍、评分与管理员发布',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'momoyu-canteen-'));
  const child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,DIFY_API_KEY:'',DIFY_MATCHING_API_KEY:''},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}rmSync(dir,{recursive:true,force:true});});
  let base,out='';for await(const chunk of child.stdout){out+=chunk;const m=out.match(/"port":(\d+)/);if(m){base=`http://127.0.0.1:${m[1]}`;break;}}assert.ok(base);

  const call=async(path,method='GET',value,cookie)=>{const r=await fetch(base+'/api'+path,{method,headers:{...(method!=='GET'?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:value===undefined?undefined:JSON.stringify(value)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const register=async username=>call('/auth/register','POST',{username,password:'password123',displayName:username,department:'虚拟部门',skillDescription:'合成技能说明'});
  const alice=await register('食堂甲'),bob=await register('食堂乙');

  const menu=await call('/canteen/menu','GET',undefined,alice.cookie);
  assert.equal(menu.status,200);assert.ok(menu.data.week?.label);
  const item=menu.data.meals.lunch[0];
  assert.ok(item?.id);assert.equal(menu.data.days.length,5);

  const rate1=await call('/canteen/items/'+item.id+'/rating','PUT',{score:5,comment:'好吃'},alice.cookie);
  assert.equal(rate1.status,200);assert.equal(rate1.data.rating.avg,5);assert.equal(rate1.data.rating.count,1);
  const rate2=await call('/canteen/items/'+item.id+'/rating','PUT',{score:3},bob.cookie);
  assert.equal(rate2.data.rating.avg,4);assert.equal(rate2.data.rating.count,2);
  assert.equal((await call('/canteen/items/'+item.id+'/rating','PUT',{score:9},alice.cookie)).status,400);

  const detail=await call('/canteen/items/'+item.id,'GET',undefined,alice.cookie);
  assert.equal(detail.data.myRating.score,5);assert.equal(detail.data.photos.length,0);

  const fd=new FormData();fd.append('file',new Blob([PNG],{type:'image/png'}),'dish.png');
  const upload=await fetch(base+'/api/canteen/items/'+item.id+'/photos',{method:'POST',credentials:'same-origin',headers:{cookie:alice.cookie},body:fd});
  const uploaded=await upload.json();assert.equal(upload.status,201);assert.ok(uploaded.photo.id);
  const photoId=uploaded.photo.id;
  assert.equal((await fetch(base+uploaded.photo.url)).status,401);
  const image=await fetch(base+uploaded.photo.url,{headers:{cookie:bob.cookie}});
  assert.equal(image.status,200);
  assert.equal(image.headers.get('content-type'),'image/webp');
  await image.arrayBuffer();

  const liked=await call('/canteen/photos/'+photoId+'/like','PUT',{liked:true},bob.cookie);
  assert.equal(liked.status,200);assert.equal(liked.data.photo.likeCount,1);assert.equal(liked.data.photo.liked,true);
  const commented=await call('/canteen/photos/'+photoId+'/comments','POST',{content:'看着不错'},bob.cookie);
  assert.equal(commented.status,201);assert.equal(commented.data.photo.commentCount,1);
  const after=await call('/canteen/items/'+item.id,'GET',undefined,alice.cookie);
  assert.equal(after.data.photos.length,1);assert.equal(after.data.photos[0].commentCount,1);assert.equal(after.data.item.photoCount,1);

  const rank=await call('/canteen/rank','GET',undefined,alice.cookie);
  assert.equal(rank.status,200);assert.ok(rank.data.red.length>=1);

  const denied=await call('/canteen/menu','PUT',{items:[{meal:'breakfast',day:0,name:'测试菜',price:1}]},alice.cookie);
  assert.equal(denied.status,403);

  const db=new DatabaseSync(join(dir,'momoyu.sqlite'));
  db.prepare("INSERT INTO account_access(user_id,role,enabled) SELECT id,'admin',1 FROM users WHERE username='食堂甲' ON CONFLICT(user_id) DO UPDATE SET role='admin'").run();
  db.prepare("INSERT INTO account_restrictions(user_id,muted) SELECT id,1 FROM users WHERE username='食堂乙' ON CONFLICT(user_id) DO UPDATE SET muted=1").run();
  db.close();
  assert.equal((await call('/canteen/photos/'+photoId+'/comments','POST',{content:'禁言后测试'},bob.cookie)).status,403);
  assert.equal((await call('/canteen/items/'+item.id+'/rating','PUT',{score:1},bob.cookie)).status,403);
  assert.equal((await fetch(base+'/api/canteen/items/'+item.id+'/photos',{method:'POST',headers:{cookie:bob.cookie},body:fd})).status,403);
  const invalid=new FormData();invalid.append('file',new Blob(['invalid image'],{type:'image/png'}),'invalid.png');
  assert.equal((await fetch(base+'/api/canteen/items/'+item.id+'/photos',{method:'POST',headers:{cookie:alice.cookie},body:invalid})).status,415);
  assert.equal((await call('/canteen/menu','PUT',{},alice.cookie)).status,400);
  const updatedItem={meal:item.meal,day:item.day,name:item.name,price:2};
  const saved=await call('/canteen/menu','PUT',{items:[{meal:'breakfast',day:0,name:'测试菜',price:1.5},updatedItem]},alice.cookie);
  assert.equal(saved.status,200);
  assert.equal(saved.data.meals.breakfast.length,1);assert.equal(saved.data.meals.breakfast[0].name,'测试菜');assert.equal(saved.data.meals.breakfast[0].price,1.5);
  assert.equal(saved.data.meals.lunch.length,1);
  assert.equal(saved.data.meals.lunch[0].id,item.id);
  assert.equal(saved.data.meals.lunch[0].photoCount,1);
  assert.equal(saved.data.meals.lunch[0].rating.count,2);
  assert.equal((await call('/canteen/menu','PUT',{items:[]},alice.cookie)).status,200);
  assert.equal((await call('/canteen/items/'+item.id,'GET',undefined,alice.cookie)).status,404);
  assert.equal((await call('/canteen/menu','PUT',{items:[updatedItem]},alice.cookie)).data.meals.lunch[0].id,item.id);

  const photoDelete=await call('/canteen/photos/'+photoId,'DELETE',undefined,bob.cookie);
  assert.equal(photoDelete.status,403);
  const removed=await call('/canteen/photos/'+photoId,'DELETE',undefined,alice.cookie);
  assert.equal(removed.status,200);
});
