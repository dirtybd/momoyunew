import {randomUUID,createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {main} from '../shared/matching-rules.mjs';
import {eligibleCandidates} from '../shared/matching-eligibility.mjs';
import {accountSchema} from './accounts.mjs';
import {TASK_LIMITS} from '../shared/task-limits.mjs';

export const defaultPreferences=()=>({weekdays:[],start:'12:00',end:'13:00',weeklyMinutes:60,maxActive:2,notifications:true});
const fail=(status,message)=>{throw Object.assign(new Error(message),{status,code:'MATCHING_ERROR'});};
export function validatePreferences(p){
  const keys=Object.keys(defaultPreferences());
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!keys.includes(k))||keys.some(k=>!(k in p)))fail(400,'推荐设置格式无效');
  if(!Array.isArray(p.weekdays)||p.weekdays.length>7||new Set(p.weekdays).size!==p.weekdays.length||p.weekdays.some(d=>!Number.isInteger(d)||d<1||d>7))fail(400,'请选择有效的每周空闲日');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.end)||p.end<=p.start)fail(400,'结束时间须晚于开始时间；跨夜时段请拆开登记');
  if(!Number.isInteger(p.weeklyMinutes)||p.weeklyMinutes<0||p.weeklyMinutes>2400||!Number.isInteger(p.maxActive)||p.maxActive<1||p.maxActive>20||typeof p.notifications!=='boolean')fail(400,'每周可投入0–2400分钟，同时接取上限1–20项');
}
export function deadlineEnd(text){
  if(typeof text!=='string')return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(text)){const t=Date.parse(text+'T23:59:59+08:00');return Number.isFinite(t)?t:null;}
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)){const t=Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(text)?text:text+'+08:00');return Number.isFinite(t)?t:null;}
  return null;
}
export function matchingConfig(env=process.env){
  if(!env.DIFY_MATCHING_API_KEY?.trim())return null;
  const base=(env.DIFY_MATCHING_BASE_URL||env.DIFY_BASE_URL||'').trim().replace(/\/+$/,'');
  let u;try{u=new URL(base);}catch{fail(503,'匹配工作流地址无效');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)fail(503,'匹配工作流地址无效');
  return {base,key:env.DIFY_MATCHING_API_KEY.trim(),policy:env.DIFY_MATCHING_POLICY_VERSION||'semantic-care-v1'};
}
export async function rankSnapshot(snapshot,config,{cache,timeoutMs=180000}={}){
  snapshot={...snapshot,candidates:snapshot.candidates.map(c=>({...c,preferences:{...c.preferences,maxActive:Math.min(TASK_LIMITS.claiming,c.preferences?.maxActive??2)}}))};
  if(!config)return {matches:JSON.parse(main({snapshot_json:JSON.stringify(snapshot)}).matches_json),mode:'local',method:'rules'};
  const hard=new Map(eligibleCandidates(snapshot).map(m=>[m.candidateId,m]));
  const candidates=snapshot.candidates.filter(c=>hard.has(c.id)).map(c=>({id:c.id,skills:(c.skills||[]).slice(0,20).map(s=>s.slice(0,80)),skillDescription:(c.skillDescription||'').slice(0,2000),acceptingHelp:c.acceptingHelp,preferences:c.preferences,activeCount:c.activeCount}));
  const batches=[];for(let i=0;i<candidates.length;i+=24)batches.push(candidates.slice(i,i+24));
  const matches=[],overall=AbortSignal.timeout(timeoutMs),cancel=new AbortController();let next=0,failure;
  const norm=s=>s.normalize('NFKC').replace(/\s+/g,' ').trim();
  const check=(rows,batch)=>{
    if(!Array.isArray(rows)||rows.length>batch.length)throw new Error('Matching workflow invalid result');
    const allowed=new Map(batch.map(c=>[c.id,c])),seen=new Set(),out=[];
    for(const m of rows){
      const c=allowed.get(m.candidateId);
      if(!c||seen.has(m.candidateId))throw new Error('Matching workflow returned ineligible or duplicate candidate');seen.add(m.candidateId);
      if(!Number.isFinite(m.score)||m.score<0||m.score>100||typeof m.reason!=='string'||!m.reason.trim()||m.reason.length>400||typeof m.evidence!=='string'||m.evidence.trim().length<2||m.evidence.length>240||!norm((c.skills||[]).join(' ')+' '+(c.skillDescription||'')).includes(norm(m.evidence)))throw new Error('Matching workflow returned unsupported evidence');
      if(m.score>=65)out.push({candidateId:m.candidateId,score:Math.round(m.score),reason:m.reason.trim(),evidence:m.evidence.trim()});
    }
    return out;
  };
  async function worker(){
    try{while(next<batches.length&&!failure){
      const batch=batches[next++],semantic={request:snapshot.request,candidates:batch.map(c=>({id:c.id,skills:c.skills||[],skillDescription:c.skillDescription||''}))};
      const key=createHash('sha256').update(JSON.stringify([config.base,config.key,config.policy,semantic])).digest('hex');
      let rows=cache?.get(key);
      if(!rows){
        const r=await fetch(config.base+'/workflows/run',{method:'POST',redirect:'error',signal:AbortSignal.any([overall,cancel.signal,AbortSignal.timeout(Math.min(90000,timeoutMs))]),headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},body:JSON.stringify({inputs:{snapshot_json:JSON.stringify({now:snapshot.now,request:snapshot.request,candidates:batch}),review_json:''},response_mode:'blocking',user:'momoyu-matching-worker'})});
        if(!r.ok){await r.body?.cancel();throw new Error('Matching workflow HTTP '+r.status);}
        const text=await r.text();if(text.length>2*1024*1024)throw new Error('Matching workflow response too large');
        const result=JSON.parse(text);if(result.data?.status!=='succeeded')throw new Error('Matching workflow failed');
        rows=check(JSON.parse(result.data.outputs?.matches_json),batch);cache?.set(key,rows);
      }else rows=check(rows,batch);
      for(const m of rows){const h=hard.get(m.candidateId);matches.push({...m,...h,method:'semantic',reason:'AI匹配依据：'+m.reason+'；'+(h.timeStatus==='unconfirmed'?'空闲时间待双方确认':'有登记的空闲时段')+'；推荐时接取'+h.activeCount+'项'});}
    }}catch(e){failure??=e;cancel.abort();throw e;}
  }
  await Promise.allSettled(Array.from({length:Math.min(2,batches.length)},worker));if(failure)throw failure;
  matches.sort((a,b)=>b.score-a.score||(a.timeStatus==='available'?0:1)-(b.timeStatus==='available'?0:1)||a.activeCount-b.activeCount||(a.nextAt??Infinity)-(b.nextAt??Infinity)||a.candidateId.localeCompare(b.candidateId));
  return {matches,mode:'dify',method:'semantic'};
}

export function matchingService({db,config=matchingConfig(),clock=()=>Date.now(),isBusy=()=>false}){
  accountSchema(db);
  db.exec(`CREATE TABLE IF NOT EXISTS matching_jobs(request_id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,mode TEXT,error TEXT,finished_at INTEGER);
    CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,request_id TEXT NOT NULL,type TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER,UNIQUE(user_id,request_id,type));
    CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created_at);
    CREATE TABLE IF NOT EXISTS semantic_match_cache(cache_key TEXT PRIMARY KEY,data_json TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  const eligible=row=>{if(!row)return false;const d=JSON.parse(row.data);return d.status==='open'&&d.visibility==='company'&&!d.deletedAt&&!d.moderatedAt&&!d.isDemo&&d.kind!=='announcement'&&(deadlineEnd(d.deadline)===null||deadlineEnd(d.deadline)>clock());};
  const snapshot=(row,d=JSON.parse(row.data),dispatch=false)=>{
    const day=new Date(clock()+28800000).toISOString().slice(0,10),dayStart=Date.parse(day+'T00:00:00+08:00');
    const candidates=all('SELECT id,profile FROM users WHERE id<>? AND NOT EXISTS(SELECT 1 FROM account_access a WHERE a.user_id=users.id AND a.enabled=0) ORDER BY id',row.owner_id||'').map(u=>{const p=JSON.parse(u.profile);return {id:u.id,skills:p.skills||[],skillDescription:p.skillDescription||'',acceptingHelp:!!p.acceptingHelp,preferences:p.helpPreferences||defaultPreferences(),activeCount:get("SELECT count(*) AS n FROM requests WHERE claimer_id=? AND json_extract(data,'$.status') IN ('claimed','submitted','changes_requested')",u.id).n};}).filter(c=>c.acceptingHelp&&c.preferences.notifications&&(!dispatch||(!get("SELECT 1 FROM notifications WHERE user_id=? AND request_id=? AND type='recommendation'",c.id,row.id)&&get("SELECT count(*) AS n FROM notifications WHERE user_id=? AND created_at>=? AND type='recommendation'",c.id,dayStart).n<3))).slice(0,2000);
    return {now:clock(),request:{title:d.title||'',problem:d.problem||'',desiredOutcome:d.desiredOutcome||'',deliverables:d.deliverables||[],skills:d.skills||[],deadlineEnd:deadlineEnd(d.deadline)},candidates};
  };
  const cache={get:key=>{const row=get('SELECT data_json FROM semantic_match_cache WHERE cache_key=? AND expires_at>?',key,clock());return row?JSON.parse(row.data_json):null;},set:(key,rows)=>{run('DELETE FROM semantic_match_cache WHERE expires_at<=?',clock());run('INSERT OR REPLACE INTO semantic_match_cache VALUES(?,?,?)',key,JSON.stringify(rows),clock()+3600000);}};
  function enqueue(id){
    if(!eligible(get('SELECT * FROM requests WHERE id=?',id)))return;
    run("INSERT INTO matching_jobs(request_id,status,next_at) VALUES(?,'pending',?) ON CONFLICT(request_id) DO UPDATE SET status='pending',attempts=0,next_at=excluded.next_at,error=NULL",id,clock());
  }
  function enqueueOpen(){for(const row of all("SELECT * FROM requests WHERE json_extract(data,'$.status')='open'"))enqueue(row.id);}
  const publicState=id=>{const j=get('SELECT status,mode FROM matching_jobs WHERE request_id=?',id);return j?{status:j.status,mode:j.mode,notified:get('SELECT count(*) AS n FROM notifications WHERE request_id=?',id).n}:null;};
  let running=false;
  async function drain(){
    if(running||isBusy())return;running=true;
    try{
      for(let batch=0;batch<20&&!isBusy();batch++){
        const j=get("SELECT * FROM matching_jobs WHERE (status='pending' AND next_at<=?) OR (status='running' AND lease_until<=?) ORDER BY next_at LIMIT 1",clock(),clock());if(!j)break;
        const claimed=run("UPDATE matching_jobs SET status='running',lease_until=? WHERE request_id=? AND ((status='pending' AND next_at<=?) OR (status='running' AND lease_until<=?))",clock()+240000,j.request_id,clock(),clock());if(!claimed.changes)continue;
        const row=get('SELECT * FROM requests WHERE id=?',j.request_id);
        try{
          if(!eligible(row)){run("UPDATE matching_jobs SET status='done',finished_at=? WHERE request_id=?",clock(),j.request_id);continue;}
          const ranked=await rankSnapshot(snapshot(row,undefined,true),config,{cache});
          // A publish/profile edit during the workflow marks this job pending again.
          if(get('SELECT status FROM matching_jobs WHERE request_id=?',row.id)?.status!=='running')continue;
          const fresh=get('SELECT * FROM requests WHERE id=?',row.id);
          if(!eligible(fresh)){run("UPDATE matching_jobs SET status='done',finished_at=? WHERE request_id=?",clock(),j.request_id);continue;}
          if(fresh.data!==row.data){enqueue(row.id);continue;}
          const stillEligible=new Set(eligibleCandidates(snapshot(fresh)).map(m=>m.candidateId));
          const day=new Date(clock()+8*3600000).toISOString().slice(0,10),dayStart=Date.parse(day+'T00:00:00+08:00');
          db.exec('BEGIN IMMEDIATE');
          try{
            let sent=0;
            for(const m of ranked.matches){
              if(sent>=5)break;
              if(!stillEligible.has(m.candidateId)||get("SELECT 1 FROM notifications WHERE user_id=? AND request_id=? AND type='recommendation'",m.candidateId,row.id))continue;
              if(get("SELECT count(*) AS n FROM notifications WHERE user_id=? AND created_at>=? AND type='recommendation'",m.candidateId,dayStart).n>=3)continue;
              const n=run("INSERT OR IGNORE INTO notifications VALUES(?,?,?,'recommendation',?,?,NULL)",randomUUID(),m.candidateId,row.id,m.reason,clock());sent+=Number(n.changes);
            }
            run("UPDATE matching_jobs SET status='done',mode=?,error=NULL,finished_at=? WHERE request_id=?",ranked.mode,clock(),row.id);db.exec('COMMIT');
          }catch(e){db.exec('ROLLBACK');throw e;}
        }catch(e){
          const attempts=j.attempts+1;
          run("UPDATE matching_jobs SET status='pending',attempts=?,next_at=?,error=? WHERE request_id=?",attempts,clock()+Math.min(3600000,30000*2**Math.min(attempts,7)),'匹配暂未完成，将自动重试',j.request_id);
          console.warn('Matching job deferred:',j.request_id);
        }
      }
    }finally{running=false;}
  }
  const previewSummary=r=>({count:r.matches.length,mode:r.mode,method:r.method,timeUnconfirmed:r.matches.filter(m=>m.timeStatus==='unconfirmed').length,sent:false,summary:r.matches.length?'找到具备相关能力且愿意互助的候选人；确认发布后才发送站内推荐。':'暂未找到合适人选；确认发布后仍会显示在公屏，后台继续匹配。'});
  const preview=async(row,d,{semantic=true,timeoutMs=20000}={})=>{
    if(!semantic||!config){const r=await rankSnapshot(snapshot(row,d),null);return {...previewSummary(r),fallback:false};}
    try{const r=await rankSnapshot(snapshot(row,d),config,{cache,timeoutMs});return {...previewSummary(r),fallback:false};}
    catch{const r=await rankSnapshot(snapshot(row,d),null);return {...previewSummary(r),fallback:true,fallbackReason:'语义预匹配暂不可用，已使用本地规则'};}
  };
  function list(userId,cursor=Infinity){
    const rows=all('SELECT rowid,* FROM notifications WHERE user_id=? AND rowid<? ORDER BY rowid DESC LIMIT 31',userId,cursor),more=rows.length>30;
    const items=rows.slice(0,30).map(n=>{
      if(n.type==='feedback'){
        let fb=null;try{fb=get('SELECT content,category,created_at FROM feedback WHERE id=?',n.request_id);}catch{}
        return {id:n.id,requestId:null,feedbackId:n.request_id,type:'feedback',threadId:null,title:'站内改进意见',reason:fb?.content||n.reason||'',status:'feedback',available:false,createdAt:new Date(n.created_at).toISOString(),readAt:n.read_at?new Date(n.read_at).toISOString():null};
      }
      const r=get('SELECT * FROM requests WHERE id=?',n.request_id),d=r&&JSON.parse(r.data),visible=d&&d.visibility==='company'&&!d.deletedAt&&!d.moderatedAt&&d.status!=='draft';let threadId=null;if(n.type==='question'||n.type==='reply'){try{threadId=get('SELECT id FROM request_threads WHERE request_id=? AND (asker_id=? OR owner_id=?) ORDER BY updated_at DESC LIMIT 1',n.request_id,userId,userId)?.id||null;}catch{}}return {id:n.id,requestId:n.request_id,type:n.type,threadId,title:visible?d.title:'此需求已不再公开',reason:visible?n.reason:'原推荐已失效',status:visible?d.status:'unavailable',available:!!visible,createdAt:new Date(n.created_at).toISOString(),readAt:n.read_at?new Date(n.read_at).toISOString():null};});
    return {items,unread:get('SELECT count(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL',userId).n,nextCursor:more?String(rows[29].rowid):null};
  }
  const read=(userId,id)=>run('UPDATE notifications SET read_at=? WHERE user_id=? AND id=? AND read_at IS NULL',clock(),userId,id);
  const readAll=userId=>run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL',clock(),userId);
  return {enqueue,enqueueOpen,drain,preview,list,read,readAll,publicState,config};
}

export function createMatchToken(key,userId,requestId){
  if(!key)return null;
  const body=Buffer.from(JSON.stringify({userId,requestId,expires:Date.now()+600000,nonce:randomUUID()})).toString('base64url');
  return body+'.'+createHmac('sha256',key).update(body).digest('base64url');
}
export function verifyMatchToken(token,key){
  if(!key||typeof token!=='string'||token.length>800)return null;
  const [body,sig,...extra]=token.split('.'),expected=createHmac('sha256',key).update(body||'').digest('base64url');
  if(extra.length||!sig||sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
  try{const p=JSON.parse(Buffer.from(body,'base64url'));return p.expires>Date.now()&&p.expires<=Date.now()+600000&&typeof p.userId==='string'&&typeof p.requestId==='string'?p:null;}catch{return null;}
}
