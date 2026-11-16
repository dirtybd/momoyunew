import {rmSync} from 'node:fs';
import {resolve} from 'node:path';

const DAY=24*60*60*1000;
const hasTable=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const run=(db,sql,...args)=>db.prepare(sql).run(...args);

export function purgeExpiredArchives({db,dataDir,retentionDays=7,clock=Date.now,isBusy=()=>false}={}){
  const days=Math.max(1,Math.min(3650,Number(retentionDays)||7));
  const cutoff=new Date(clock()-days*DAY).toISOString();
  const rows=db.prepare(`
    SELECT id FROM requests
    WHERE claimer_id IS NULL
      AND json_extract(data,'$.deletedAt') IS NOT NULL
      AND json_extract(data,'$.deletedAt') < ?
      AND json_extract(data,'$.status') IN ('draft','open')
  `).all(cutoff);
  let deleted=0,filesRemoved=0;
  for(const {id} of rows){
    if(isBusy())break;
    const attachments=hasTable(db,'attachments')
      ? db.prepare('SELECT storage_key,preview_key FROM attachments WHERE request_id=?').all(id)
      : [];
    db.exec('BEGIN IMMEDIATE');
    try{
      if(hasTable(db,'assistant_outputs')&&hasTable(db,'messages'))
        run(db,'DELETE FROM assistant_outputs WHERE message_rowid IN (SELECT rowid FROM messages WHERE request_id=?)',id);
      if(hasTable(db,'dify_attachment_uploads')&&hasTable(db,'attachments'))
        run(db,'DELETE FROM dify_attachment_uploads WHERE attachment_id IN (SELECT id FROM attachments WHERE request_id=?)',id);
      if(hasTable(db,'submissions'))run(db,'DELETE FROM submissions WHERE request_id=?',id);
      if(hasTable(db,'attachments'))run(db,'DELETE FROM attachments WHERE request_id=?',id);
      if(hasTable(db,'messages'))run(db,'DELETE FROM messages WHERE request_id=?',id);
      if(hasTable(db,'dify_conversations'))run(db,'DELETE FROM dify_conversations WHERE request_id=?',id);
      if(hasTable(db,'dify_file_deliveries'))run(db,'DELETE FROM dify_file_deliveries WHERE request_id=?',id);
      if(hasTable(db,'notifications'))run(db,'DELETE FROM notifications WHERE request_id=?',id);
      if(hasTable(db,'matching_jobs'))run(db,'DELETE FROM matching_jobs WHERE request_id=?',id);
      if(hasTable(db,'task_difficulty'))run(db,'DELETE FROM task_difficulty WHERE request_id=?',id);
      if(hasTable(db,'task_points'))run(db,'DELETE FROM task_points WHERE request_id=?',id);
      run(db,'DELETE FROM requests WHERE id=?',id);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    for(const f of attachments){
      for(const key of [f.storage_key,f.preview_key]){
        if(!key)continue;
        try{rmSync(resolve(dataDir,'uploads',key),{force:true});filesRemoved++;}catch{}
      }
    }
    deleted++;
  }
  return {deleted,filesRemoved,cutoff,retentionDays:days};
}
