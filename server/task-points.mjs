import {TASK_LIMITS,REWARD_POINTS,DIFFICULTY_REWARD_POLICY} from '../shared/task-limits.mjs';
const fail=(code,message)=>{throw Object.assign(new Error(message),{status:409,code});};
export function taskPoints(db){
  // Preserve agreed rewards; unclaimed cards move to system-assessed points.
  db.exec('CREATE TABLE IF NOT EXISTS task_points(request_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,points INTEGER NOT NULL CHECK(points>=0 AND points<=1000000),awarded_at TEXT NOT NULL)');
  const migrations=db.prepare('SELECT id,claimer_id,data FROM requests').all().filter(r=>{const d=JSON.parse(r.data);return !d.isDemo&&!r.claimer_id&&['draft','open'].includes(d.status)&&d.rewardPolicy!==DIFFICULTY_REWARD_POLICY;});
  if(migrations.length){db.exec('BEGIN IMMEDIATE');try{for(const r of migrations){const d=JSON.parse(r.data);d.rewardPoints=null;d.rewardPolicy=DIFFICULTY_REWARD_POLICY;d.rewardText??='';db.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify(d),r.id);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
  function capacity(userId){
    const rows=db.prepare('SELECT owner_id,claimer_id,data FROM requests WHERE owner_id=? OR claimer_id=?').all(userId,userId);
    let publishing=0,claiming=0;
    for(const r of rows){const d=JSON.parse(r.data);if(d.isDemo||d.kind==='announcement')continue;
      if(r.owner_id===userId&&!d.deletedAt&&['open','claimed','submitted','changes_requested'].includes(d.status)&&!(d.status==='open'&&d.moderatedAt))publishing++;
      if(r.claimer_id===userId&&['claimed','submitted','changes_requested'].includes(d.status))claiming++;
    }
    return {publishing:{used:publishing,limit:TASK_LIMITS.publishing},claiming:{used:claiming,limit:TASK_LIMITS.claiming}};
  }
  function requireSlot(userId,kind){const c=capacity(userId)[kind];if(c.used>=c.limit)fail('TASK_LIMIT',kind==='publishing'?`同时最多发布${c.limit}个未完成需求，请先完成或下架已有需求。`:`同时最多接取${c.limit}个任务，请先完成已有任务；待验收和退回修改也占名额。`);}
  function award(row,d,time){
    if(d.isDemo||!row.owner_id||!row.claimer_id||row.owner_id===row.claimer_id)fail('INVALID_AWARD','只能为真实双方协作的已验收任务发放积分');
    const points=d.rewardPoints??0,legacy=!['five-point-v1',DIFFICULTY_REWARD_POLICY].includes(d.rewardPolicy);if(!Number.isInteger(points)||points<(legacy?0:REWARD_POINTS.min)||points>(legacy?1000000:REWARD_POINTS.max))fail('INVALID_AWARD','验收积分无效，未完成验收');
    const awarded=db.prepare('INSERT OR IGNORE INTO task_points(request_id,user_id,points,awarded_at) VALUES(?,?,?,?)').run(row.id,row.claimer_id,points,time);if(!awarded.changes)fail('ALREADY_AWARDED','本次积分已经发放，请刷新任务状态');
  }
  const awarded=id=>db.prepare('SELECT points FROM task_points WHERE request_id=?').get(id)?.points??null;
  function leaderboard(userId,period='month',now=Date.now()){
    if(!['month','all'].includes(period))throw Object.assign(new Error('请选择本月或总榜'),{status:400,code:'INVALID_PERIOD'});
    const china=new Date(now+8*3600000),start=period==='month'?new Date(Date.UTC(china.getUTCFullYear(),china.getUTCMonth(),1)-8*3600000).toISOString():'0000';
    const hasDifficulty=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_difficulty'").get();
    const rows=db.prepare(`SELECT u.id,u.profile,sum(p.points) AS points,count(*) AS completedCount,${hasDifficulty?'sum(coalesce(d.score,0))':'0'} AS difficultyTotal,min(p.awarded_at) firstAward
      FROM task_points p JOIN users u ON u.id=p.user_id
      LEFT JOIN account_access a ON a.user_id=u.id LEFT JOIN account_restrictions r ON r.user_id=u.id
      ${hasDifficulty?'LEFT JOIN task_difficulty d ON d.request_id=p.request_id AND d.status=\'scored\'':''}
      WHERE p.awarded_at>=? AND p.awarded_at<=? AND coalesce(a.enabled,1)=1 AND r.deleted_at IS NULL
      GROUP BY u.id ORDER BY points DESC,completedCount DESC,difficultyTotal DESC,firstAward,u.id`).all(start,new Date(now).toISOString());
    let rank=0,last;const items=rows.map((r,i)=>{const key=[r.points,r.completedCount,r.difficultyTotal].join(':');if(key!==last)rank=i+1;last=key;const p=JSON.parse(r.profile);return {rank,userId:r.id,displayName:p.displayName,department:p.department,points:r.points,completedCount:r.completedCount,difficultyTotal:r.difficultyTotal};});
    return {period,items:items.slice(0,100),me:items.find(p=>p.userId===userId)||null,totalParticipants:items.length};
  }
  return {capacity,requireSlot,award,awarded,leaderboard};
}
