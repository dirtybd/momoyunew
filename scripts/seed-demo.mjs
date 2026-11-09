import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {DEMO_REQUESTS} from '../shared/demo-requests.mjs';

const directory=resolve(process.env.DATA_DIR||'data');
mkdirSync(directory,{recursive:true});
const db=new DatabaseSync(resolve(directory,'momoyu.sqlite'));
const all=db.prepare('SELECT * FROM requests').all();
const protectedRows=all.filter(row=>row.owner_id||!JSON.parse(row.data).isDemo);
let updated=0,inserted=0;
db.exec('BEGIN IMMEDIATE');
try{
 for(const example of DEMO_REQUESTS){
  const old=all.find(row=>!row.owner_id&&JSON.parse(row.data).isDemo===true&&JSON.parse(row.data).title===example.title);
  const now=new Date().toISOString();
  if(old){
   const previous=JSON.parse(old.data);
   db.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify({...previous,...example,isDemo:true,status:previous.status,createdAt:previous.createdAt,updatedAt:now}),old.id);updated++;
  }else{
   const data={...example,anonymous:false,visibility:'company',fallbackToBoard:false,status:'open',isDemo:true,createdAt:now,updatedAt:now};
   db.prepare('INSERT INTO requests VALUES (?,?,?,?)').run(randomUUID(),null,null,JSON.stringify(data));inserted++;
  }
 }
 for(const row of protectedRows){
  const after=db.prepare('SELECT * FROM requests WHERE id=?').get(row.id);
  if(!after||after.data!==row.data||after.owner_id!==row.owner_id||after.claimer_id!==row.claimer_id)throw new Error('User data changed; rolling back');
 }
 db.exec('COMMIT');
 console.log(JSON.stringify({updatedExamples:updated,addedExamples:inserted,untouchedUserRequests:protectedRows.length}));
}catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
