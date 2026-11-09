import {randomUUID} from 'node:crypto';

const extensions=/\.(pdf|docx|xlsx|pptx|txt|csv|md|json|xml|png|jpe?g|webp)$/i;
const fail=message=>{throw new Error(message);};
export const outputPrefix=()=>'mm-'+randomUUID().replaceAll('-','')+'-';

// Tool output is only a candidate: signed download headers must prove this turn's nonce.
export function collectOutputLinks(value,links=new Set(),depth=0) {
  if(depth>10||!value)return links;
  if(typeof value==='object'){
    if(typeof value.public_download_url==='string')links.add(value.public_download_url);
    for(const child of Object.values(value))collectOutputLinks(child,links,depth+1);
  }else if(typeof value==='string'){
    try{collectOutputLinks(JSON.parse(value),links,depth+1);}catch{
      for(const line of value.split('\n')){try{collectOutputLinks(JSON.parse(line),links,depth+1);}catch{}}
      for(const m of value.matchAll(/"public_download_url"\s*:\s*"((?:\\.|[^"\\\r\n])+)"/g)){
        try{links.add(JSON.parse('"'+m[1]+'"'));}catch{}
      }
    }
  }
  return links;
}

export async function downloadOutputFiles({config,links,prefix,signal,onProgress}) {
  const outputs=[],warnings=[],seen=new Set();let total=0,unrelated=0;
  for(const raw of [...links].slice(0,20)){
    try{
      const supplied=new URL(raw,'http://unused');
      const match=supplied.pathname.match(/\/files\/tools\/([a-f0-9-]{36})\.([a-z0-9]+)$/i);
      if(!match||!extensions.test('.'+match[2]))fail('不支持的文件链接');
      if(seen.has(match[1]))continue;
      const query=new URLSearchParams();
      for(const key of ['timestamp','nonce','sign']){const value=supplied.searchParams.get(key);if(!value||value.length>512)fail('文件签名不完整');query.set(key,value);}
      query.set('as_attachment','true');
      const root=config.base.replace(/\/v1$/,'');
      onProgress?.({stage:'exporting',label:'正在接收处理后的文件'});
      const response=await fetch(root+match[0]+'?'+query,{signal,redirect:'error',headers:{connection:'close'}});
      if(!response.ok){await response.body?.cancel();fail('文件下载失败');}
      const disposition=response.headers.get('content-disposition')||'';
      const encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const filename=encoded?decodeURIComponent(encoded):disposition.match(/filename="([^"]+)"/i)?.[1];
      if(!filename?.startsWith(prefix)){await response.body?.cancel();unrelated++;continue;}
      seen.add(match[1]);
      if(outputs.length>=5){await response.body?.cancel();warnings.push('每轮最多接收5个结果文件，请分批处理。');continue;}
      const name=filename.slice(prefix.length).replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,180);
      if(!name||!extensions.test(name)){await response.body?.cancel();fail('文件类型无效');}
      if(Number(response.headers.get('content-length'))>20*1024*1024){await response.body?.cancel();fail('结果文件超过20MB');}
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>20*1024*1024||total+size>50*1024*1024)fail('结果文件过大');chunks.push(chunk);}
      const bytes=Buffer.concat(chunks);if(!size)fail('文件为空');
      if(/\.pdf$/i.test(name)&&bytes.subarray(0,5).toString()!=='%PDF-')fail('PDF格式无效');
      if(/\.(docx|xlsx|pptx)$/i.test(name)&&!bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])))fail('Office格式无效');
      total+=size;
      outputs.push({name,bytes,mime:response.headers.get('content-type')||'application/octet-stream',nativeReference:'dify-file-ref:'+Buffer.from(JSON.stringify({record_id:match[1]})).toString('base64url'),sourceUrl:raw});
    }catch(e){if(signal?.aborted)throw e;warnings.push('有结果文件未能安全接回，请让助手重新生成或重试。');}
  }
  if(unrelated&&!outputs.length)warnings.push('本轮没有可接回的结果文件，请让助手重新生成或重试。');
  if(links.size>20)warnings.push('工具文件过多，请分批处理。');
  return {outputs,warnings:[...new Set(warnings)]};
}
