import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import assert from 'node:assert/strict';
// Non-AI integration fixtures provide an assessed result without calling a provider.
export function assessPublishedTask(dir,id,score=3){
  const db=new DatabaseSync(join(dir,'momoyu.sqlite'));
  try{const result=db.prepare("UPDATE task_difficulty SET status='scored',score=?,reason='合成评分',scored_at=? WHERE request_id=?").run(score,new Date().toISOString(),id);assert.equal(result.changes,1);}finally{db.close();}
}
