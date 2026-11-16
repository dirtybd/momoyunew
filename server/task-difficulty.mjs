import {createHash} from 'node:crypto';
import {matchingConfig} from './matching.mjs';

const summary=d=>Object.fromEntries(['title','problem','desiredOutcome','deliverables','acceptanceCriteria','constraints','skills','deadline'].map(k=>[k,d[k]??null]));
const digest=d=>createHash('sha256').update(JSON.stringify(summary(d))).digest('hex');
export async function scoreTask(d,config){
  const response=await fetch(config.base+'/workflows/run',{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},body:JSON.stringify({inputs:{snapshot_json:'',review_json:'',difficulty_json:JSON.stringify(summary(d))},response_mode:'blocking',user:'momoyu-task-difficulty'})});
  if(!response.ok){await response.body?.cancel();throw Error('Difficulty service unavailable');}
  const raw=await response.text();if(raw.length>1000000)throw Error('Difficulty output too large');
  const result=JSON.parse(raw);if(result.data?.status!=='succeeded')throw Error('Difficulty workflow failed');
  const value=JSON.parse(result.data.outputs?.difficulty_result_json);
  if(!value||Object.keys(value).some(k=>!['score','reason'].includes(k))||!Number.isInteger(value.score)||value.score<1||value.score>5||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>200)throw Error('Invalid difficulty assessment');
  return {score:value.score,reason:value.reason.trim()};
}
export function taskDifficulty({db,config=matchingConfig(),clock=Date.now,isBusy=()=>false}){
  db.exec("CREATE TABLE IF NOT EXISTS task_difficulty(request_id TEXT PRIMARY KEY,status TEXT NOT NULL,score INTEGER CHECK(score BETWEEN 1 AND 5),reason TEXT NOT NULL DEFAULT '',input_hash TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0,scored_at TEXT)");
  const get=id=>db.prepare('SELECT * FROM task_difficulty WHERE request_id=?').get(id);
  const request=id=>db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  const eligible=r=>{if(!r)return false;const d=JSON.parse(r.data);return !d.isDemo&&d.kind!=='announcement'&&d.visibility==='company'&&d.status!=='draft'&&!d.deletedAt&&!d.moderatedAt;};
  function enqueue(id){const row=request(id);if(!eligible(row))return;const hash=digest(JSON.parse(row.data)),old=get(id);if(old?.input_hash===hash&&['pending','running','scored'].includes(old.status))return;
    db.prepare("INSERT INTO task_difficulty(request_id,status,input_hash,next_at) VALUES(?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET status=excluded.status,score=NULL,reason='',input_hash=excluded.input_hash,attempts=0,next_at=excluded.next_at,lease_until=0,scored_at=NULL").run(id,config?'pending':'unavailable',hash,clock());
  }
  const state=id=>{const r=get(id),row=request(id),current=r&&row&&r.input_hash===digest(JSON.parse(row.data));return current?{status:r.status==='running'?'pending':r.status,score:r.status==='scored'?r.score:null,reason:r.status==='scored'?r.reason:''}:{status:'unavailable',score:null,reason:''};};
  function enqueueOpen(){for(const row of db.prepare("SELECT id,data FROM requests WHERE json_extract(data,'$.status')='open'").all())enqueue(row.id);}
  let running=false;
  async function drain(){if(running||!config||isBusy())return;running=true;
    try{for(let i=0;i<5&&!isBusy();i++){
      const job=db.prepare("SELECT * FROM task_difficulty WHERE status='pending' AND next_at<=? OR status='running' AND lease_until<=? ORDER BY next_at LIMIT 1").get(clock(),clock());if(!job)break;
      const row=request(job.request_id);if(!eligible(row)){db.prepare("UPDATE task_difficulty SET status='unavailable',score=NULL,reason='' WHERE request_id=?").run(job.request_id);continue;}
      const claimed=db.prepare("UPDATE task_difficulty SET status='running',lease_until=? WHERE request_id=? AND input_hash=? AND (status='pending' OR status='running' AND lease_until<=?)").run(clock()+90000,job.request_id,job.input_hash,clock());if(!claimed.changes)continue;
      try{const d=JSON.parse(row.data),value=await scoreTask(d,config),fresh=request(row.id);
        if(!eligible(fresh)||digest(JSON.parse(fresh.data))!==job.input_hash){if(eligible(fresh))enqueue(row.id);else db.prepare("UPDATE task_difficulty SET status='unavailable',score=NULL,reason='' WHERE request_id=? AND input_hash=?").run(row.id,job.input_hash);continue;}
        db.prepare("UPDATE task_difficulty SET status='scored',score=?,reason=?,scored_at=?,lease_until=0 WHERE request_id=? AND input_hash=? AND status='running'").run(value.score,value.reason,new Date(clock()).toISOString(),row.id,job.input_hash);
      }catch{const attempts=job.attempts+1,delay=Math.min(3600000,30000*2**Math.min(attempts,7));db.prepare("UPDATE task_difficulty SET status='pending',attempts=?,next_at=?,lease_until=0 WHERE request_id=? AND input_hash=? AND status='running'").run(attempts,clock()+delay+Math.floor(Math.random()*Math.min(15000,delay*.2)),job.request_id,job.input_hash);}
    }}finally{running=false;}
  }
  return {enqueue,enqueueOpen,state,drain};
}
