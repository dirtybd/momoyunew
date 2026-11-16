import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('需求互动：详情版式、浏览数、私聊会话与公开留言',async t=>{
  // Synthetic upstream keeps care review, difficulty and matching local.
  const upstream=createServer(async(req,res)=>{
    for await(const chunk of req){void chunk;}
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({data:{status:'succeeded',outputs:{
      review_result_json:JSON.stringify({allow:true,urgent:false,reason:'合成审核通过'}),
      difficulty_result_json:JSON.stringify({score:3,reason:'合成难度'}),
      matches_json:'[]',
    }}}));
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const dir=mkdtempSync(join(tmpdir(),'momoyu-engagement-'));
  const child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,DIFY_API_KEY:'',DIFY_MATCHING_BASE_URL:`http://127.0.0.1:${upstream.address().port}/v1`,DIFY_MATCHING_API_KEY:'synthetic-test-key',MATCHING_SCHEDULER:'off'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}upstream.closeAllConnections();await new Promise(r=>upstream.close(r));rmSync(dir,{recursive:true,force:true});});
  let base,out='';for await(const chunk of child.stdout){out+=chunk;const m=out.match(/"port":(\d+)/);if(m){base=`http://127.0.0.1:${m[1]}`;break;}}assert.ok(base);
  const call=async(path,method='GET',value,cookie,headers={})=>{const r=await fetch(base+'/api'+path,{method,headers:{...(value===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{}),...headers},body:value===undefined?undefined:JSON.stringify(value)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const register=async username=>call('/auth/register','POST',{username,password:'password123',displayName:username,department:'合成部门',acceptingHelp:false});
  const owner=await register('eng-owner'),asker=await register('eng-asker'),other=await register('eng-other');

  // 1. Request detailLayout round-trip and validation.
  const draft=await call('/clarify','POST',{message:'标题：互动测试需求\n问题：需要整理资料\n目标：得到清单\n交付物：清单'},owner.cookie);
  assert.equal(draft.status,200);assert.equal(draft.data.request.detailLayout,'auto');
  const id=draft.data.request.id;
  assert.equal((await call(`/requests/${id}`,'PATCH',{detailLayout:'dossier'},owner.cookie)).status,200);
  assert.equal((await call(`/requests/${id}`,'GET',undefined,owner.cookie)).data.request.detailLayout,'dossier');
  assert.equal((await call(`/requests/${id}`,'PATCH',{detailLayout:'bogus'},owner.cookie)).status,400);
  const published=await call(`/requests/${id}/publish`,'POST',{confirmed:true},owner.cookie);
  assert.equal(published.status,200);
  assert.equal((await call(`/requests/${id}`,'GET',undefined,asker.cookie)).data.request.detailLayout,'dossier');

  // 2. Care post detailLayout round-trip.
  const care=await call('/care/posts','POST',{title:'版式帖子',content:'合成内容',confirmed:true,detailLayout:'magazine'},owner.cookie);
  assert.equal(care.status,201);assert.equal(care.data.post.detailLayout,'magazine');
  const careId=care.data.post.id;
  const carePatched=await call(`/care/posts/${careId}`,'PATCH',{detailLayout:'polaroid',confirmed:true},owner.cookie);
  assert.equal(carePatched.status,200);assert.equal(carePatched.data.post.detailLayout,'polaroid');
  assert.equal((await call(`/care/posts/${careId}`,'PATCH',{detailLayout:'bogus',confirmed:true},owner.cookie)).status,400);
  assert.equal((await call(`/care/posts/${careId}`,'GET',undefined,asker.cookie)).data.post.detailLayout,'polaroid');

  // 3. Views: owner excluded, repeat viewer idempotent, distinct viewers count.
  assert.equal((await call(`/requests/${id}/view`,'POST',{},owner.cookie)).data.views,0);
  assert.equal((await call(`/requests/${id}/view`,'POST',{},asker.cookie)).data.views,1);
  assert.equal((await call(`/requests/${id}/view`,'POST',{},asker.cookie)).data.views,1);
  assert.equal((await call(`/requests/${id}/view`,'POST',{},other.cookie)).data.views,2);
  assert.equal((await call(`/requests/${id}/view`,'POST',{},undefined,{'user-agent':'anon-a'})).data.views,3);
  assert.equal((await call(`/requests/${id}/view`,'POST',{},undefined,{'user-agent':'anon-a'})).data.views,3);
  assert.equal((await call(`/requests/${id}/view`,'POST',{},undefined,{'user-agent':'anon-b'})).data.views,4);
  assert.equal((await call(`/requests/${id}`,'GET',undefined,asker.cookie)).data.request.viewCount,4);

  // 4. Private question thread, notification, owner reply and reply notification.
  assert.equal((await call(`/requests/${id}/questions`,'POST',{content:'未登录提问',visibility:'private'})).status,401);
  assert.equal((await call(`/requests/${id}/questions`,'POST',{content:'向自己提问',visibility:'private'},owner.cookie)).status,400);
  assert.equal((await call(`/requests/${id}/questions`,'POST',{content:'',visibility:'private'},asker.cookie)).status,400);
  assert.equal((await call(`/requests/${id}/questions`,'POST',{content:'内容',visibility:'wrong'},asker.cookie)).status,400);
  const question=await call(`/requests/${id}/questions`,'POST',{content:'想私聊请教细节',visibility:'private'},asker.cookie);
  assert.equal(question.status,200);
  const threadId=question.data.thread.id;
  assert.ok(threadId);
  assert.equal(question.data.thread.messages.length,1);
  assert.equal(question.data.thread.messages[0].mine,true);
  assert.equal(question.data.thread.messages[0].authorLabel,'eng-asker');

  const ownerInbox=await call('/notifications','GET',undefined,owner.cookie);
  const ownerQuestion=ownerInbox.data.items.find(n=>n.type==='question');
  assert.ok(ownerQuestion);assert.equal(ownerQuestion.threadId,threadId);assert.match(ownerQuestion.reason,/提问/);

  const ownerInteractions=await call(`/requests/${id}/interactions`,'GET',undefined,owner.cookie);
  assert.equal(ownerInteractions.data.threads.length,1);
  assert.equal(ownerInteractions.data.threads[0].id,threadId);
  assert.equal(ownerInteractions.data.threads[0].unread,1);
  assert.equal((await call(`/requests/${id}/interactions`,'GET',undefined,owner.cookie)).data.threads[0].unread,0);

  const reply=await call(`/interactions/threads/${threadId}/messages`,'POST',{content:'可以，请说'},owner.cookie);
  assert.equal(reply.status,200);assert.equal(reply.data.thread.messages.length,2);
  const askerInbox=await call('/notifications','GET',undefined,asker.cookie);
  const replyNote=askerInbox.data.items.find(n=>n.type==='reply');
  assert.ok(replyNote);assert.equal(replyNote.threadId,threadId);assert.match(replyNote.reason,/回复/);

  // Non-participants cannot read or reply.
  assert.equal((await call(`/interactions/threads/${threadId}`,'GET',undefined,other.cookie)).status,404);
  assert.equal((await call(`/interactions/threads/${threadId}/messages`,'POST',{content:'闯入'},other.cookie)).status,404);
  const otherInteractions=await call(`/requests/${id}/interactions`,'GET',undefined,other.cookie);
  assert.deepEqual(otherInteractions.data.threads,[]);

  // 5. Conversation list, unread, single-thread read, delete and restore.
  const askerThreads=await call('/interactions/threads','GET',undefined,asker.cookie);
  assert.equal(askerThreads.data.items.length,1);
  const listItem=askerThreads.data.items[0];
  assert.equal(listItem.id,threadId);assert.equal(listItem.requestId,id);
  assert.equal(listItem.requestTitle,'互动测试需求');assert.equal(listItem.lastMessage,'可以，请说');
  assert.equal(listItem.unread,1);assert.equal(askerThreads.data.unread,1);
  const single=await call(`/interactions/threads/${threadId}`,'GET',undefined,asker.cookie);
  assert.equal(single.data.thread.messages.length,2);assert.equal(single.data.thread.unread,1);
  assert.equal((await call('/interactions/threads','GET',undefined,asker.cookie)).data.items[0].unread,0);
  assert.equal((await call(`/interactions/threads/${threadId}/delete`,'POST',{},asker.cookie)).status,200);
  assert.equal((await call('/interactions/threads','GET',undefined,asker.cookie)).data.items.length,0);
  assert.equal((await call(`/requests/${id}/interactions`,'GET',undefined,asker.cookie)).data.threads.length,0);
  assert.equal((await call('/interactions/threads','GET',undefined,owner.cookie)).data.items.length,1);
  assert.equal((await call(`/interactions/threads/${threadId}/restore`,'POST',{},asker.cookie)).status,200);
  assert.equal((await call('/interactions/threads','GET',undefined,asker.cookie)).data.items.length,1);

  // 6. Public comments, notification, author/owner removal.
  const publicComment=await call(`/requests/${id}/questions`,'POST',{content:'公开留言一条',visibility:'public'},other.cookie);
  assert.equal(publicComment.status,200);
  const commentId=publicComment.data.comment.id;
  assert.equal(publicComment.data.comment.authorLabel,'eng-other');
  const seen=await call(`/requests/${id}/interactions`,'GET',undefined,asker.cookie);
  const shown=seen.data.comments.find(c=>c.id===commentId);
  assert.ok(shown);assert.equal(shown.content,'公开留言一条');assert.equal(shown.isMine,false);assert.equal(shown.canRemove,false);
  const mine=await call(`/requests/${id}/interactions`,'GET',undefined,other.cookie);
  assert.equal(mine.data.comments.find(c=>c.id===commentId).canRemove,true);
  const ownerSees=await call(`/requests/${id}/interactions`,'GET',undefined,owner.cookie);
  assert.equal(ownerSees.data.comments.find(c=>c.id===commentId).canRemove,true);
  const ownerInbox2=await call('/notifications','GET',undefined,owner.cookie);
  const ownerComment=ownerInbox2.data.items.find(n=>n.type==='comment');
  assert.ok(ownerComment);assert.match(ownerComment.reason,/留言/);

  assert.equal((await call(`/interactions/comments/${commentId}/remove`,'POST',{},asker.cookie)).status,404);
  assert.equal((await call(`/interactions/comments/${commentId}/remove`,'POST',{},other.cookie)).status,200);
  assert.ok(!(await call(`/requests/${id}/interactions`,'GET',undefined,asker.cookie)).data.comments.some(c=>c.id===commentId));
  const secondComment=await call(`/requests/${id}/questions`,'POST',{content:'由发布者移除',visibility:'public'},asker.cookie);
  assert.equal((await call(`/interactions/comments/${secondComment.data.comment.id}/remove`,'POST',{},owner.cookie)).status,200);

  // Anonymous visitors can read comments but never private threads.
  const anonymous=await call(`/requests/${id}/interactions`,'GET');
  assert.equal(anonymous.status,200);assert.ok(Array.isArray(anonymous.data.comments));assert.deepEqual(anonymous.data.threads,[]);
});
