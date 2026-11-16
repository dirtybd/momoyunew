import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {purgeExpiredArchives} from '../server/archive-cleanup.mjs';

test('已移除的对话/草稿按保留期清理，完成任务和接取中任务保留',()=>{
  const dir=mkdtempSync(join(tmpdir(),'momoyu-archive-cleanup-'));
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(`CREATE TABLE requests(id TEXT PRIMARY KEY,owner_id TEXT,claimer_id TEXT,data TEXT);
      CREATE TABLE attachments(id TEXT PRIMARY KEY,request_id TEXT,storage_key TEXT,preview_key TEXT);
      CREATE TABLE messages(rowid INTEGER PRIMARY KEY,request_id TEXT,role TEXT,content TEXT);
      CREATE TABLE assistant_outputs(message_rowid INTEGER,attachment_id TEXT,native_reference TEXT);
      CREATE TABLE submissions(id TEXT PRIMARY KEY,request_id TEXT);
      CREATE TABLE dify_conversations(request_id TEXT,conversation_id TEXT,scope TEXT);
      CREATE TABLE notifications(id TEXT PRIMARY KEY,user_id TEXT,request_id TEXT,type TEXT,reason TEXT,created_at INTEGER,read_at INTEGER);
      CREATE TABLE matching_jobs(request_id TEXT PRIMARY KEY,status TEXT);
      CREATE TABLE task_difficulty(request_id TEXT PRIMARY KEY,status TEXT);
      CREATE TABLE task_points(request_id TEXT PRIMARY KEY,user_id TEXT,points INTEGER,awarded_at TEXT);
      CREATE TABLE dify_attachment_uploads(attachment_id TEXT,scope TEXT,user_id TEXT,upload_id TEXT);`);
    const now=Date.parse('2026-11-10T12:00:00Z');
    const old=new Date(now-8*86400000).toISOString();
    const recent=new Date(now-1*86400000).toISOString();
    const insert=(id,status,deletedAt,claimer=null)=>{db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(id,'owner',claimer,JSON.stringify({status,deletedAt}));};
    insert('old-draft','draft',old);
    insert('old-open','open',old);
    insert('recent-draft','draft',recent);
    insert('completed-archived','completed',old,'worker');
    insert('claimed-archived','claimed',old,'worker');
    db.prepare('INSERT INTO attachments VALUES(?,?,?,?)').run('a1','old-draft','a1.bin','a1.webp');
    db.prepare('INSERT INTO attachments VALUES(?,?,?,?)').run('a2','old-open','a2.bin',null);
    db.prepare('INSERT INTO messages(rowid,request_id,role,content) VALUES(1,?,?,?)').run('old-draft','user','x');
    db.prepare('INSERT INTO assistant_outputs VALUES(1,?,?)').run('a1','ref');
    db.prepare('INSERT INTO submissions VALUES(?,?)').run('s1','old-draft');
    db.prepare('INSERT INTO dify_conversations VALUES(?,?,?)').run('old-draft','conv','scope');
    db.prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,?)').run('n1','worker','old-draft','recommendation','r',now,null);
    db.prepare('INSERT INTO matching_jobs VALUES(?,?)').run('old-draft','done');
    db.prepare('INSERT INTO task_difficulty VALUES(?,?)').run('old-draft','pending');
    db.prepare('INSERT INTO task_points VALUES(?,?,?,?)').run('old-draft','worker',3,old);
    db.prepare('INSERT INTO dify_attachment_uploads VALUES(?,?,?,?)').run('a1','scope','worker','u1');
    mkdirSync(join(dir,'uploads'),{recursive:true});
    for(const f of ['a1.bin','a1.webp','a2.bin'])writeFileSync(join(dir,'uploads',f),'x');
    const result=purgeExpiredArchives({db,dataDir:dir,retentionDays:7,clock:()=>now});
    assert.equal(result.deleted,2);
    assert.equal(db.prepare("SELECT count(*) n FROM requests WHERE id IN ('old-draft','old-open')").get().n,0);
    assert.equal(db.prepare("SELECT count(*) n FROM requests WHERE id IN ('recent-draft','completed-archived','claimed-archived')").get().n,3);
    assert.equal(db.prepare('SELECT count(*) n FROM attachments').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM messages').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM assistant_outputs').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM submissions').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM dify_conversations').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM notifications').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM matching_jobs').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM dify_attachment_uploads').get().n,0);
    assert.ok(!existsSync(join(dir,'uploads','a1.bin'))&&!existsSync(join(dir,'uploads','a1.webp'))&&!existsSync(join(dir,'uploads','a2.bin')));
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('保留期内的已移除草稿不清理',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec("CREATE TABLE requests(id TEXT PRIMARY KEY,owner_id TEXT,claimer_id TEXT,data TEXT)");
    db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run('recent','owner',null,JSON.stringify({status:'draft',deletedAt:new Date(Date.now()-3600000).toISOString()}));
    const result=purgeExpiredArchives({db,dataDir:tmpdir(),retentionDays:7});
    assert.equal(result.deleted,0);
    assert.equal(db.prepare('SELECT count(*) n FROM requests').get().n,1);
  }finally{db.close();}
});
