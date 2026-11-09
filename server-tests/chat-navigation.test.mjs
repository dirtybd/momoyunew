import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual navigation callback, including its in-flight guards.
function navigate(target,{chatBusy=false,uploading=false,options}={}){
  const source=fs.readFileSync('frontend/src/main.jsx','utf8');
  const body=source.slice(source.indexOf(' const go='),source.indexOf('\n const openDetail='));
  const calls=[],ctx={chatBusy,uploading,sessionReady:true,user:{id:'synthetic'},draft:{id:'in-progress'},messages:[{role:'user',content:'keep'}],target,options};
  for(const name of ['setPage','setNotice','setError','setAuthMode','setModal','setDraft','setFields','setMessages','setAttachmentFiles','setShowCard','setCareMode','setCareSafety','setCarePreview','setShowCare','setChatViewKey'])ctx[name]=value=>calls.push({name,value});
  vm.runInNewContext(body+';go(target,options);',ctx,{timeout:500});return calls;
}

test('助手生成或上传时可以浏览其他页面，返回对话不会清空当前工作',()=>{
  for(const pending of [{chatBusy:true},{uploading:true}]){
    for(const target of ['board','care','mine','inbox','profile','clarify']){
      const calls=navigate(target,pending);
      assert.ok(calls.some(c=>c.name==='setPage'&&c.value===target),'pending navigation to '+target);
      assert.ok(!calls.some(c=>['setDraft','setMessages','setCareMode'].includes(c.name)),'keep active conversation');
    }
  }
});

test('对话异步完成不占用或清除其他页面的操作状态；退出清理私密现场',async()=>{
  const source=fs.readFileSync('frontend/src/main.jsx','utf8'),calls=[];
  const ctx={chatBusy:false,uploading:false,busy:false,messages:[],draft:null,fields:null,careMode:false,assistantController:{current:null},AbortController,profileBlank:{},
    sendAssistant:async()=>({request:{id:'new',materialFiles:[]},messages:[{role:'assistant',content:'finished'}],intent:'help',mode:'dify'}),api:async()=>({}),board:async()=>{}};
  for(const name of ['setBusy','setChatBusy','setProgress','setStreamReply','setError','setMessages','setDraft','setAttachmentFiles','setCareMode','setShowCare','setHealth','setNotice','setUser','setProfile','setFields','setShowCard','setCareSafety','setCarePreview','setPage','setChatViewKey'])ctx[name]=value=>calls.push({name,value});
  await vm.runInNewContext(source.slice(source.indexOf(' const send='),source.indexOf('\n const resume='))+';send("synthetic");',ctx,{timeout:500});
  assert.ok(!calls.some(c=>c.name==='setBusy'),'chat never toggles shared mutation state');
  assert.ok(calls.some(c=>c.name==='setChatBusy'&&c.value===true));assert.ok(calls.some(c=>c.name==='setChatBusy'&&c.value===false));
  calls.length=0;
  await vm.runInNewContext(source.slice(source.indexOf(' const logout='),source.indexOf('\n const saveProfile='))+';logout();',ctx,{timeout:500});
  assert.ok(calls.some(c=>c.name==='setMessages'&&Array.isArray(c.value)&&!c.value.length));assert.ok(calls.some(c=>c.name==='setDraft'&&c.value===null));
  assert.ok(calls.some(c=>c.name==='setChatViewKey'),'private composer resets at logout');
});

test('普通返回保留对话；新建操作只在当前工作完成后清空，倾诉模式只随成功新建设置',()=>{
  assert.ok(!navigate('clarify').some(c=>c.name==='setMessages'));
  const pending=navigate('clarify',{chatBusy:true,options:{newConversation:true,care:true}});
  assert.ok(!pending.some(c=>['setMessages','setCareMode'].includes(c.name)));
  const fresh=navigate('clarify',{options:{newConversation:true,care:true}});
  assert.ok(fresh.some(c=>c.name==='setMessages'&&Array.isArray(c.value)&&!c.value.length));
  assert.ok(fresh.some(c=>c.name==='setCareMode'&&c.value===true));
});

test('活动对话可直接返回，但不让另一段历史覆盖尚未完成的结果',async()=>{
  const source=fs.readFileSync('frontend/src/main.jsx','utf8'),callback=source.slice(source.indexOf(' const resume='),source.indexOf('\n const saveDraft='));
  for(const pending of [{chatBusy:true,uploading:false},{chatBusy:false,uploading:true}]){
    const calls=[],ctx={...pending,draft:{id:'active'},r:{id:'different'},go:target=>calls.push(target),api:async()=>{calls.push('fetch');throw Error('should not load');},setBusy:()=>calls.push('busy'),setError:()=>{},setNotice:()=>calls.push('notice')};
    await vm.runInNewContext('{'+callback+';resume(r);}',ctx,{timeout:500});assert.deepEqual(calls,['notice']);
    calls.length=0;ctx.r={id:'active'};
    await vm.runInNewContext('{'+callback+';resume(r);}',ctx,{timeout:500});assert.deepEqual(calls,['clarify']);
  }
});
