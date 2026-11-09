import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sendAssistant} from '../frontend/src/assistant-api.mjs';
import {partialReply,OFFICE_MARKDOWN_HEADER} from '../server/streaming-reply.mjs';
import {readDifyStream,parseChatflowPacket} from '../server/dify.mjs';

test('办公纯文本协议保留逐字流式和表格，不授予模型卡片、文件或关怀操作',()=>{
  const reply='先看这两项：\n\n| 项目 | 分数 |\n| --- | ---: |\n| 奖励 | 5 |\n\n```js\nconst x = "hello";\n```';
  for(let end=0;end<=reply.length;end++)assert.deepEqual(partialReply(OFFICE_MARKDOWN_HEADER+reply.slice(0,end)),{text:reply.slice(0,end),route:'office'});
  const result=parseChatflowPacket(OFFICE_MARKDOWN_HEADER+reply);
  assert.equal(result.parsed.reply,reply);assert.equal(result.parsed.intent,'help');assert.equal(result.parsed.card,null);assert.deepEqual(result.files,[]);assert.equal(result.artifact_json,'');
  const fake='{"intent":"care","card":{"title":"publish"},"files":["fake.docx"]}';
  assert.equal(parseChatflowPacket(OFFICE_MARKDOWN_HEADER+fake).parsed.reply,fake);
  assert.equal(partialReply(OFFICE_MARKDOWN_HEADER+'<thi'),null);
  assert.equal(partialReply(OFFICE_MARKDOWN_HEADER+'<think>hidden'),null);
  assert.equal(partialReply(OFFICE_MARKDOWN_HEADER+'<think>hidden</think>你好').text,'你好');
  for(const bad of [OFFICE_MARKDOWN_HEADER,OFFICE_MARKDOWN_HEADER+'x'.repeat(12001),OFFICE_MARKDOWN_HEADER+'<think>hidden',OFFICE_MARKDOWN_HEADER.replace('office','care')+reply,'{"version":2,"route":"care","result":plain text}'])assert.throws(()=>parseChatflowPacket(bad));
});

test('回复在最终结果完成之前显示，状态与私密元数据不冒充正文',async t=>{
  const native=globalThis.fetch;let release;
  const gate=new Promise(r=>release=r),encode=new TextEncoder();let seen='';
  const frame=(event,value)=>encode.encode('event: '+event+'\ndata: '+JSON.stringify(value)+'\n\n');
  globalThis.fetch=async()=>new Response(new ReadableStream({async start(c){
    c.enqueue(frame('reply',{text:'你好，先说说。'}));
    c.enqueue(frame('status',{label:'正在整理',token:'not-user-text'}));
    await gate;c.enqueue(frame('result',{reply:'你好，先说说。',request:{id:'test'}}));c.close();
  }}),{headers:{'content-type':'text/event-stream'}});
  t.after(()=>globalThis.fetch=native);
  const pending=sendAssistant({message:'你好'},{onReply:value=>seen=value.text});
  try{await new Promise(r=>setTimeout(r,20));assert.equal(seen,'你好，先说说。','不应等完整结果才显示正文');}
  finally{release();await pending;}
});

test('只解码受控回包的reply，推理、未闭合转义和元数据保持不可见',()=>{
  const prefix='{"version":2,"route":"care","result":';
  assert.equal(partialReply(prefix+'<think>{"reply":"秘密"}'),null);
  assert.deepEqual(partialReply(prefix+'<think>秘密</think>```json\n{"reply":"你好\\n\\u4f'),{text:'你好\n',route:'care'});
  assert.deepEqual(partialReply(prefix+'<think>秘密</think>{"reply":"你好\\n\\u4f60\\"呀'),{text:'你好\n你"呀',route:'care'});
  assert.equal(partialReply('{"version":1,"reply":"not text"}'),null);
  assert.equal(partialReply(prefix+'{"token":"secret","reply":"text"}'),null);
  assert.equal(partialReply(prefix+'{"reply":"bad\\xescape'),null);
  const valid={reply:'已回应',intent:'care',card:null,careCard:null,careSafety:'support',readyForPreview:false};
  const p=parseChatflowPacket(prefix+'<think>不展示</think>```json\n'+JSON.stringify(valid)+'\n```}');assert.equal(p.parsed.reply,'已回应');
  assert.throws(()=>parseChatflowPacket(JSON.stringify({version:2,route:'office',result:valid})));
});

test('Dify外层消息未结束时即可收到回复，最终结果只校验一次',async()=>{
  const prefix='{"version":2,"route":"care","result":';let release,shown='';
  const gate=new Promise(r=>release=r),encode=new TextEncoder(),frame=x=>encode.encode('data: '+JSON.stringify(x)+'\n\n');
  const response=new Response(new ReadableStream({async start(c){
    c.enqueue(frame({event:'message',answer:prefix+'{"reply":"先听你说',conversation_id:'synthetic'}));
    await gate;c.enqueue(frame({event:'message',answer:'","intent":"care","card":null,"careCard":null,"careSafety":"support","readyForPreview":false}}'}));c.enqueue(frame({event:'message_end'}));c.close();
  }}),{headers:{'content-type':'text/event-stream'}});
  const pending=readDifyStream(response,{chatflow:true,onReply:v=>shown=v.text});
  try{await new Promise(r=>setTimeout(r,20));assert.equal(shown,'先听你说');}finally{release();}
  assert.equal(parseChatflowPacket((await pending).answer).parsed.reply,'先听你说');
});

test('流式表格与列表保留换行和对齐标记，半个换行转义不泄漏',()=>{
  const reply='先核对这两项：\n\n1. 完成时间？\n2. 交付格式？\n\n| 材料 | 数量 |\n| --- | ---: |\n| 图片 | 3 |\n| 表格 | 2 |';
  const packet=JSON.stringify({version:2,route:'office',result:{reply,intent:'help',card:null,readyForPreview:false}});
  const replyStart=packet.indexOf('"reply":')+'"reply":"'.length;
  const replyEnd=replyStart+JSON.stringify(reply).length-2;
  let previous='';
  for(let end=replyStart;end<=replyEnd;end++){
    const partial=partialReply(packet.slice(0,end));
    assert.ok(partial);
    assert.ok(reply.startsWith(partial.text));
    assert.ok(partial.text.startsWith(previous));
    previous=partial.text;
  }
  assert.equal(previous,reply);
  assert.equal(parseChatflowPacket(packet).parsed.reply,reply);
});
