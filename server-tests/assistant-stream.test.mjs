import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sendAssistant} from '../frontend/src/assistant-api.mjs';

test('网页对话流正确处理中文分片、工具进度、错误与未完成结果',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  let wire='event: status\ndata: {"stage":"designing","label":"正在制作卡片"}\n\nevent: result\ndata: {"reply":"完成","request":{"title":"海岸互助"}}\n\n';
  globalThis.fetch=async()=>{
    const bytes=new TextEncoder().encode(wire);
    return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=5)controller.enqueue(bytes.slice(i,i+5));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
  };
  const progress=[];const result=await sendAssistant({message:'制作海岸卡片'},{onProgress:x=>progress.push(x)});
  assert.equal(result.request.title,'海岸互助');assert.equal(progress[0].label,'正在制作卡片');
  wire='event: error\ndata: {"message":"模型暂时不可用"}\n\n';await assert.rejects(sendAssistant({}),/模型暂时不可用/);
  wire='event: status\ndata: {"stage":"thinking"}\n\n';await assert.rejects(sendAssistant({}),/回复未完成/);
});
