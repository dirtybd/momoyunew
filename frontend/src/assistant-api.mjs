export async function sendAssistant(body,{signal,onProgress,onReply}={}) {
  const response=await fetch('/api/clarify',{method:'POST',credentials:'same-origin',signal,headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify(body)});
  if(!response.ok){const value=await response.json();throw new Error(value.error?.message||'发送失败，请重试');}
  if(!response.headers.get('content-type')?.includes('text/event-stream'))return response.json();
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result;
  const consume=frame=>{
    const event=frame.match(/^event: (.+)$/m)?.[1];
    const data=frame.split('\n').filter(l=>l.startsWith('data: ')).map(l=>l.slice(6)).join('\n');
    if(!data)return;
    const value=JSON.parse(data);
    if(event==='status')onProgress?.(value);
    if(event==='reply'){if(typeof value.text!=='string'||value.text.length>12000)throw new Error('回复分片无效，请重试');onReply?.(value);}
    if(event==='result')result=value;
    if(event==='error')throw new Error(value.message||'回复中断，请重试');
  };
  try{
    while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let i;while((i=buffer.indexOf('\n\n'))>=0){consume(buffer.slice(0,i));buffer=buffer.slice(i+2);}}
    buffer+=decoder.decode();if(buffer.trim())consume(buffer);
    if(!result)throw new Error('回复未完成，请重试');return result;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
