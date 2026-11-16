import {basename} from 'node:path';
import {detectTargetLanguage} from './electrical-translation.mjs';
import {PLAIN_TRANSLATION_LANGUAGE_QUESTION} from './plain-text-translation.mjs';
import {prepareOfficeTranslation} from './ooxml-translation.mjs';

const fail=(status,code,message)=>Object.assign(new Error(message),{status,code});
const formats=/\.(docx|xlsx|pdf)$/i;
const types={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pdf:'application/pdf'};
const baseResult={intent:'help',ready:false,suppressRecommendations:true,conversations:[]};
function batches(items){const result=[],ids=new Set();let current=[],size=0;for(const item of items){if(!item||typeof item.id!=='string'||!item.id||item.id.length>160||ids.has(item.id)||typeof item.text!=='string'||!item.text.trim()||item.text.length>3000)throw fail(422,'DOCUMENT_SEGMENT','单个段落过长或内容编号无效，请拆分后翻译。');ids.add(item.id);if(current.length&&(size+item.text.length>3000||current.length>=12)){result.push(current);current=[];size=0;}current.push(item);size+=item.text.length;}if(current.length)result.push(current);return result;}

export async function translateDocumentSegments({items,targetLanguage,config,userId,signal,onProgress=()=>{},fetchImpl=fetch,timeoutMs=90000}){
 const parts=batches(items),result=new Map();if(!parts.length)return result;
 if(!config)throw fail(503,'DOCUMENT_TRANSLATION_CONFIG','文件翻译服务尚未配置，请联系管理员。');
 const wholeSignal=AbortSignal.any([AbortSignal.timeout(300000),...(signal?[signal]:[])]);
 for(let i=0;i<parts.length;i++){
  if(wholeSignal.aborted){if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');throw fail(504,'DOCUMENT_TRANSLATION_TIMEOUT','文件翻译超时，原件未改动；请缩小文件或分批处理。');}onProgress({stage:'translating',label:`正在翻译第 ${i+1}/${parts.length} 批文本`});
  const batch=parts[i],requestSignal=AbortSignal.any([wholeSignal,AbortSignal.timeout(timeoutMs)]);
  try{
   const r=await fetchImpl(config.base+'/workflows/run',{method:'POST',redirect:'error',signal:requestSignal,headers:{authorization:'Bearer '+config.key,'content-type':'application/json',connection:'close'},body:JSON.stringify({inputs:{payload_json:'',plain_payload_json:'',document_payload_json:JSON.stringify({targetLanguage,items:batch})},response_mode:'blocking',user:'momoyu-document-'+userId})});
   if(!r.ok){await r.body?.cancel();throw fail(r.status===429?429:502,'DOCUMENT_TRANSLATION_UPSTREAM','翻译服务暂时不可用，未交付不完整文件，原件未改动。');}
   const raw=await r.text();requestSignal.throwIfAborted();if(raw.length>1024*1024)throw fail(502,'DOCUMENT_TRANSLATION_FORMAT','译文返回过长，未生成文件。');
   let d,value;try{d=JSON.parse(raw);value=JSON.parse(d.data?.outputs?.document_translations_json);}catch{throw fail(502,'DOCUMENT_TRANSLATION_FORMAT','翻译未返回有效的完整结果。');}
   if(d.data?.status!=='succeeded'||!value||Object.keys(value).length!==1||!Array.isArray(value.translations)||value.translations.length!==batch.length)throw fail(502,'DOCUMENT_TRANSLATION_FORMAT','译文条目不完整，未生成文件。');
   const ids=new Set(batch.map(x=>x.id)),seen=new Set();for(const item of value.translations){if(!item||Object.keys(item).length!==2||!ids.has(item.id)||seen.has(item.id)||typeof item.text!=='string'||!item.text.trim()||item.text.length>24000||/<think>|<\/think>/i.test(item.text))throw fail(502,'DOCUMENT_TRANSLATION_FORMAT','译文内容或编号不完整，未生成文件。');seen.add(item.id);result.set(item.id,item.text);}
  }catch(e){if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');if(requestSignal.aborted||wholeSignal.aborted)throw fail(504,'DOCUMENT_TRANSLATION_TIMEOUT','文件翻译超时，原件未改动；请缩小文件或分批处理。');if(e.code?.startsWith?.('DOCUMENT_'))throw e;throw fail(503,'DOCUMENT_TRANSLATION_UNAVAILABLE','文件翻译连接中断，未交付不完整文件，原件未改动。');}
 }
 return result;
}

export async function translateDocuments({task,message,config,userId,signal,onProgress=()=>{},fetchImpl=fetch}){
 if(!task?.isTranslation||task.mode!=='document'||task.scope==='requested'||!task.documents?.length||task.project?.length||task.ignored?.length)return null;
 const files=task.documents;
 if(files.some(f=>/\.(doc|xls|xlsm)$/i.test(f.name)))return {...baseResult,outputFiles:[],reply:'请将旧版或含宏文件另存为无宏的 DOCX 或 XLSX 后再翻译，原件不会修改。'};
 if(files.some(f=>!formats.test(f.name)))return null;
 if(files.length>5)throw fail(422,'DOCUMENT_LIMIT','每次最多翻译5个文件，请分批发送。');
 const targetLanguage=detectTargetLanguage(message);if(!targetLanguage)return {...baseResult,outputFiles:[],reply:PLAIN_TRANSLATION_LANGUAGE_QUESTION};
 const plans=[];
 try{
  for(const file of files){signal?.throwIfAborted();if(file.bytes.length>20*1024*1024)throw fail(422,'DOCUMENT_LIMIT','自动保格式翻译单个文件最多20MB，请拆分后处理。');onProgress({stage:'reading',label:'正在本地提取文档文字'});const plan=/\.pdf$/i.test(file.name)?await (await import('./pdf-translation.mjs')).preparePdfTranslation({...file,signal}):await prepareOfficeTranslation(file);if(!plan)throw fail(422,'DOCUMENT_UNSUPPORTED','当前格式无法安全保留，请另存为DOCX、XLSX或文字PDF。');plans.push({file,plan});}
  const unique=[],byText=new Map(),references=[];let total=0;
  for(const {plan} of plans){const refs=new Map();for(const s of plan.segments){total+=s.text.length;if(total>160000||references.reduce((n,m)=>n+m.size,0)+refs.size>=2000)throw fail(422,'DOCUMENT_LIMIT','待翻译内容过多，请拆分文件后处理。');let id=byText.get(s.text);if(!id){id='text-'+unique.length;byText.set(s.text,id);unique.push({id,text:s.text});}refs.set(s.id,id);}references.push(refs);}
  if(!unique.length)return {...baseResult,outputFiles:[],reply:'文件中没有可翻译的文字单元，原件未改动。'};
  const translations=await translateDocumentSegments({items:unique,targetLanguage,config,userId,signal,onProgress,fetchImpl});
  const outputFiles=[],limitations=new Set();
  for(let i=0;i<plans.length;i++){signal?.throwIfAborted();const {file,plan}=plans[i];onProgress({stage:'writing',label:'正在写回译文并保留原文件结构'});const values=new Map([...references[i]].map(([id,key])=>[id,translations.get(key)]));const bytes=await plan.write(values);if(bytes.length>20*1024*1024)throw fail(422,'DOCUMENT_LIMIT','译文文件超过20MB，未交付不完整结果，请拆分处理。');const suffix=plan.format==='pdf'?'_对照译文':'_译文';outputFiles.push({name:basename(file.name).replace(/\.[^.]+$/,'')+suffix+'_'+targetLanguage+'.'+plan.format,mime:types[plan.format],bytes,nativeReference:'local-document-translation'});for(const item of plan.limitations||[])limitations.add(item);}
  return {...baseResult,outputFiles,reply:`已生成 ${outputFiles.length} 份 ${targetLanguage} 译文副本，原件未改动。`+(limitations.size?'\n\n'+[...limitations].join('\n'):'')};
 }finally{for(const {plan} of plans)await plan.dispose?.();}
}
