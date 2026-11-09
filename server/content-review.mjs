import {matchingConfig} from './matching.mjs';

const unavailable=()=>Object.assign(new Error('内容审核暂不可用，内容尚未发布，请稍后重试。'),{status:503,code:'CARE_REVIEW_UNAVAILABLE'});
export async function reviewCareContent({type,title='',content},config=matchingConfig()){
  if(!config)throw unavailable();
  if(!['care_post','care_comment'].includes(type)||typeof title!=='string'||title.length>120||typeof content!=='string'||!content.trim()||content.length>(type==='care_post'?1500:500))throw Object.assign(new Error('待审核内容格式无效'),{status:400,code:'CARE_REVIEW_INVALID'});
  try{
    const r=await fetch(config.base+'/workflows/run',{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},body:JSON.stringify({inputs:{snapshot_json:'',review_json:JSON.stringify({type,title,content})},response_mode:'blocking',user:'momoyu-care-review'})});
    if(!r.ok){await r.body?.cancel();throw unavailable();}
    const raw=await r.text();if(raw.length>1000000)throw unavailable();
    const result=JSON.parse(raw);if(result.data?.status!=='succeeded')throw unavailable();
    const value=JSON.parse(result.data.outputs?.review_result_json);
    if(!value||typeof value.allow!=='boolean'||typeof value.urgent!=='boolean'||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>180)throw unavailable();
    return {allow:value.allow&&!value.urgent,urgent:value.urgent,reason:value.reason.trim()};
  }catch{throw unavailable();}
}
