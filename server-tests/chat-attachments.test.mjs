import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transformWithOxc} from 'vite';

const main=fs.readFileSync('frontend/src/main.jsx','utf8');
const pendingSource=main.slice(main.indexOf(' const sentAttachmentIds='),main.indexOf('\n const [showCard,'));
const plain=value=>JSON.parse(JSON.stringify(value));
const file=(id,extra={})=>({id,name:id+'.pdf',size:1024,downloadUrl:'/api/attachments/'+id,aiEnabled:true,...extra});
function app(extra={}){
  const ctx={chatBusy:false,uploading:false,busy:false,messages:[],draft:{id:'request-a'},fields:null,attachmentFiles:[],careMode:false,health:{},assistantController:{current:null},AbortController,profileBlank:{},sessionReady:true,user:{id:'synthetic'},chatViewKey:0,
    saveDraft:async()=>{},editable:r=>r,board:async()=>{},api:async()=>({}),...extra};
  for(const name of ['Busy','ChatBusy','Progress','StreamReply','Error','Messages','Draft','AttachmentFiles','CareMode','ShowCare','Health','Notice','User','Profile','Fields','ShowCard','CareSafety','CarePreview','Page','ChatViewKey','AuthMode','Modal','Uploading']){
    const key=name[0].toLowerCase()+name.slice(1);ctx['set'+name]=value=>{ctx[key]=typeof value==='function'?value(ctx[key]):value;};
  }
  ctx.pending=()=>plain(vm.runInNewContext('(()=>{'+pendingSource+';return pendingFiles;})()',ctx));
  ctx.run=(start,end,name,...args)=>{ctx.pendingFiles=ctx.pending();ctx.args=args;const callback=main.slice(main.indexOf(' const '+start+'='),main.indexOf('\n const '+end+'='));return vm.runInNewContext('(async()=>{'+callback+';return '+name+'(...args);})()',ctx);};
  return ctx;
}

test('队列从当前对话恢复，排除已发材料、封面与报酬；旧消息不猜附件归属',()=>{
  const a=app({attachmentFiles:['sent','pending','cover','reward'].map(id=>file(id)),draft:{id:'request-a',selectedCoverId:'cover',selectedRewardId:'reward'},messages:[{role:'user',content:'旧消息'},{role:'user',attachments:[file('sent')]}]});
  assert.deepEqual(a.pending().map(f=>f.id),['pending']);
  a.messages=[{role:'user',content:'无快照的旧消息'}];assert.deepEqual(a.pending().map(f=>f.id),['sent','pending']);
  a.run('go','openDetail','go','board');a.run('go','openDetail','go','clarify');assert.equal(a.pending().length,2);
});

test('发送只提交新附件 ID，成功按服务端快照清队列，续问传空数组',async()=>{
  const existing=file('sent'),next=file('pending');let payload;
  const a=app({attachmentFiles:[existing,next],messages:[{role:'user',content:'上一轮',attachments:[existing]}],sendAssistant:async body=>{payload=body;return {request:{id:'request-a',materialFiles:[existing,next]},messages:[...a.messages,{role:'assistant',content:'完成'}],intent:'help'};}});
  assert.equal(await a.run('send','resume','send','处理新文件'),true);
  assert.deepEqual(plain(payload.attachmentIds),['pending']);assert.equal(payload.requestId,'request-a');
  assert.deepEqual(a.pending(),[]);assert.deepEqual(plain(a.messages[1].attachments),[next]);
  await a.run('send','resume','send','继续说明');assert.deepEqual(plain(payload.attachmentIds),[]);
});

test('发送失败或停止时保留原消息和待发送文件，可以直接重试',async()=>{
  for(const abort of [false,true]){
    const before=[{role:'user',content:'已发送'}],pending=file('pending');
    const a=app({messages:before,attachmentFiles:[pending],sendAssistant:async(_body,{signal})=>{if(abort)return new Promise((_,reject)=>{const stopped=()=>reject(Object.assign(new Error('stop'),{name:'AbortError'}));if(signal.aborted)stopped();else signal.addEventListener('abort',stopped);});throw Error('synthetic failure');}});
    const running=a.run('send','resume','send','继续处理');if(abort){await Promise.resolve();a.assistantController.current.abort();}
    assert.equal(await running,false);assert.deepEqual(plain(a.messages),before);assert.deepEqual(a.pending(),[pending]);assert.equal(a.chatBusy,false);
  }
});

test('上传不写入旧消息，删除成功才移出队列；部分上传失败保留已成功文件',async()=>{
  const before=[{role:'user',content:'已发送'}];let uploads=0;
  const a=app({messages:before,uploadAttachment:async()=>{if(++uploads===2)throw Error('second file failed');return {request:{id:'request-a',materialFiles:[file('new')]},attachment:file('new')};}});
  await a.run('acceptAttachments','setCover','uploadFiles',[{},{}]);assert.deepEqual(plain(a.messages),before);assert.equal(a.pending().length,1);assert.equal(a.uploading,false);
  a.api=async()=>{throw Error('delete failed');};await a.run('acceptAttachments','setCover','changeAttachment',file('new'),'DELETE');assert.equal(a.pending().length,1);
  a.api=async()=>({request:{id:'request-a',materialFiles:[]}});await a.run('acceptAttachments','setCover','changeAttachment',file('new'),'DELETE');assert.deepEqual(a.pending(),[]);
  a.messages=[{role:'user',attachments:[file('sent')]}];await a.run('acceptAttachments','setCover','changeAttachment',file('sent'),'DELETE');assert.equal(a.messages[0].attachments[0].unavailable,true);
});

test('恢复其他对话不会串附件，新建与退出清空队列',async()=>{
  const a=app({attachmentFiles:[file('a')],messages:[],api:async path=>path.endsWith('/messages')?{messages:[{role:'user',attachments:[file('b-sent')]}]}:{request:{id:'request-b',materialFiles:[file('b-sent'),file('b-pending')]}}});
  await a.run('resume','saveDraft','resume',{id:'request-b'});assert.deepEqual(a.pending().map(f=>f.id),['b-pending']);
  await a.run('go','openDetail','go','clarify',{newConversation:true});assert.deepEqual(a.pending(),[]);
  a.attachmentFiles=[file('private')];a.draft={id:'private'};await a.run('logout','openProfile','logout');assert.deepEqual(a.pending(),[]);assert.equal(a.user,null);
});

// Compile the real component without a browser, network, or private session.
const componentSource=fs.readFileSync('frontend/src/AssistantConversation.jsx','utf8').replace(/^import .*;\r?$/gm,'').replace('export function AssistantConversation','function AssistantConversation');
const compiled=await transformWithOxc(componentSource,'AssistantConversation.jsx',{jsx:{runtime:'classic'}});
function conversation(extra={}){
  const states=[],refs=[];let stateIndex=0,refIndex=0;
  const ctx={React:{createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'fragment'},
    useState:initial=>{const i=stateIndex++;if(!(i in states))states[i]=initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},
    useRef:initial=>refs[refIndex++]||=( {current:initial}),useEffect:()=>{},FILE_LIMITS:{aiCount:10},bytesLabel:()=> '1 KB',FilePicker:()=>{},AgentRecommendationFallback:()=>{},AgentRecommendations:()=>{}};
  vm.createContext(ctx);vm.runInContext(compiled.code,ctx);
  const props={messages:[],onSend:async()=>true,onFiles:()=>{},onRemovePending:()=>{},...extra};
  return {props,render:()=>{stateIndex=0;refIndex=0;ctx.props=props;return vm.runInContext('AssistantConversation(props)',ctx);}};
}
function nodes(node){return Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[];}
const find=(tree,type)=>nodes(tree).find(n=>n.type===type);
const event=(types,files=[])=>({dataTransfer:{types,files},preventDefault(){this.prevented=true;}});

test('拖拽只接收 Files，文字拖拽不拦截；忙碌时阻止文件打开但不上传',()=>{
  const uploaded=[],c=conversation({onFiles:files=>uploaded.push(...files)});let tree=c.render();
  const text=event(['text/plain']);tree.props.onDragEnter(text);tree.props.onDrop(text);assert.equal(text.prevented,undefined);assert.equal(uploaded.length,0);
  const enter=event(['Files']);tree.props.onDragEnter(enter);tree=c.render();assert.ok(tree.props.className.includes('is-file-dragover'));
  const drop=event(['Files'],[file('dropped')]);tree.props.onDrop(drop);assert.equal(drop.prevented,true);assert.equal(uploaded.length,1);assert.ok(!c.render().props.className.includes('is-file-dragover'));
  for(const state of ['busy','uploading']){c.props[state]=true;tree=c.render();const blocked=event(['Files'],[file('blocked')]);tree.props.onDrop(blocked);assert.equal(blocked.prevented,true);assert.equal(uploaded.length,1);c.props[state]=false;}
});

test('待发送附件放在输入区，历史消息只读自己的快照；移除按钮作用于选中文件',()=>{
  let removed;const pending=file('pending'),sent=file('sent'),c=conversation({files:[sent,pending],pendingFiles:[pending],messages:[{role:'user',content:'旧消息'},{role:'user',content:'新消息',attachments:[sent]}],onRemovePending:f=>{removed=f;}});
  const tree=c.render(),snapshots=nodes(tree).filter(n=>n.type?.name==='MessageAttachments');assert.equal(snapshots.length,2);assert.equal(snapshots[0].props.files,undefined);assert.deepEqual(snapshots[1].props.files,[sent]);
  const queue=nodes(tree).find(n=>n.props?.['aria-label']==='待发送附件');assert.ok(queue);assert.ok(!nodes(tree).filter(n=>n.type==='article').some(n=>nodes(n).includes(queue)));
  nodes(queue).find(n=>n.props?.className==='pending-file-remove').props.onClick();assert.equal(removed,pending);
  const unavailable=snapshots[1].type({files:[file('deleted',{unavailable:true})]});assert.equal(find(unavailable,'a'),undefined);
  c.props.pendingFiles=[{...pending,aiEnabled:false}];const saved=nodes(c.render()).find(n=>n.props?.className==='file-saved-only');assert.ok(saved,'未供 AI 阅读的文件保留仅保存状态');
});

test('输入失败保留完整原文，成功清空；上传时不能提交',async()=>{
  let complete,calls=0;const c=conversation({onSend:()=>{calls++;return new Promise(resolve=>{complete=resolve;});}});
  let tree=c.render();find(tree,'textarea').props.onChange({target:{value:'  保留原文\n'}});tree=c.render();
  const sending=find(tree,'form').props.onSubmit({preventDefault(){}});complete(false);await sending;tree=c.render();assert.equal(find(tree,'textarea').props.value,'  保留原文\n');
  c.props.uploading=true;await find(c.render(),'form').props.onSubmit();assert.equal(calls,1);
  c.props.uploading=false;const retry=find(c.render(),'form').props.onSubmit();complete(true);await retry;assert.equal(find(c.render(),'textarea').props.value,'');
});
