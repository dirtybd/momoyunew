import {basename} from 'node:path';
import {detectTargetLanguage} from './electrical-translation.mjs';

const MAX_SOURCE_CHARS=6000;
const MAX_TRANSLATION_CHARS=48000;
const fail=(status,code,message)=>Object.assign(new Error(message),{status,code});
export const PLAIN_TRANSLATION_LANGUAGE_QUESTION='这份文本需要翻译成哪种语言？例如“翻译成英文”。';

export function resumePlainTranslationMessage(message,previousReply){
  if(previousReply!==PLAIN_TRANSLATION_LANGUAGE_QUESTION)return message;
  const language=String(message).trim().replace(/[。.!！]$/,'');
  if(!/^[\p{L}-]{2,16}$/u.test(language))return message;
  const target=detectTargetLanguage('目标语言：'+language);
  return target?'全文翻译成 '+target:message;
}

function decodeText(bytes){
  if(!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array))return null;
  if(bytes.byteLength>MAX_SOURCE_CHARS*4+4)return null;
  let encoding='utf-8',offset=0;
  if(bytes[0]===0xff&&bytes[1]===0xfe){encoding='utf-16le';offset=2;}
  else if(bytes[0]===0xfe&&bytes[1]===0xff){encoding='utf-16be';offset=2;}
  try{
    const text=new TextDecoder(encoding,{fatal:true}).decode(bytes.subarray(offset));
    if(text.length>MAX_SOURCE_CHARS||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))return null;
    return text;
  }catch{return null;}
}

/** Null means this task needs the normal document path; never silently drop files. */
export async function translatePlainText({task,message,config,userId,signal,onProgress=()=>{},fetchImpl=fetch,timeoutMs=90000}){
  if(!task?.isTranslation||task.mode!=='document'||task.scope==='requested'||task.documents?.length!==1||task.project?.length||task.ignored?.length)return null;
  const file=task.documents[0];
  if(!/\.txt$/i.test(file.name||''))return null;
  const text=decodeText(file.bytes);
  if(text===null)return null;
  const baseResult={intent:'help',ready:false,suppressRecommendations:true,conversations:[],outputFiles:[]};
  if(!text.trim())return {...baseResult,reply:'这个文本文件没有可翻译的内容，请补充原文后再试。'};
  const targetLanguage=detectTargetLanguage(message);
  if(!targetLanguage)return {...baseResult,reply:PLAIN_TRANSLATION_LANGUAGE_QUESTION};
  if(!config)throw fail(503,'PLAIN_TRANSLATION_CONFIG','文本翻译服务暂未配置，请联系管理员。');
  const requestSignal=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
  onProgress({stage:'translating',label:'正在翻译文本'});
  try{
    requestSignal.throwIfAborted();
    const response=await fetchImpl(config.base+'/workflows/run',{
      method:'POST',redirect:'error',signal:requestSignal,
      headers:{authorization:'Bearer '+config.key,'content-type':'application/json',connection:'close'},
      body:JSON.stringify({inputs:{payload_json:'',plain_payload_json:JSON.stringify({text,targetLanguage})},response_mode:'blocking',user:'momoyu-plain-'+userId}),
    });
    if(!response.ok){await response.body?.cancel();throw fail(response.status===429?429:502,'PLAIN_TRANSLATION_UPSTREAM','翻译服务暂时不可用，原文未改动，请稍后重试。');}
    const raw=await response.text();
    requestSignal.throwIfAborted();
    if(raw.length>MAX_TRANSLATION_CHARS*8)throw fail(502,'PLAIN_TRANSLATION_FORMAT','翻译结果过长，原文未改动。');
    let value;
    try{value=JSON.parse(raw);}catch{throw fail(502,'PLAIN_TRANSLATION_FORMAT','翻译服务未返回有效结果，原文未改动。');}
    const translated=value.data?.outputs?.plain_translation;
    if(value.data?.status!=='succeeded'||typeof translated!=='string'||!translated.trim()||translated.length>MAX_TRANSLATION_CHARS)throw fail(502,'PLAIN_TRANSLATION_FORMAT','翻译服务未返回完整译文，原文未改动。');
    const name=basename(file.name).replace(/\.txt$/i,'')+'_'+targetLanguage+'.txt';
    return {...baseResult,reply:`已翻译为 ${targetLanguage}，译文另存为文本文件，原件未改动。`,outputFiles:[{name,mime:'text/plain; charset=utf-8',bytes:Buffer.from(translated,'utf8'),nativeReference:'local-plain-text-translation'}]};
  }catch(error){
    if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
    if(requestSignal.aborted)throw fail(504,'PLAIN_TRANSLATION_TIMEOUT','文本翻译超时，原文未改动，请稍后重试。');
    if(error.code?.startsWith?.('PLAIN_TRANSLATION_'))throw error;
    throw fail(503,'PLAIN_TRANSLATION_UNAVAILABLE','文本翻译连接中断，原文未改动，请稍后重试。');
  }
}
