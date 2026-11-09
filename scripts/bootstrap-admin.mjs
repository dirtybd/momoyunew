import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {bootstrapPrimary} from '../server/accounts.mjs';

const index=process.argv.indexOf('--username'),username=index>=0?process.argv[index+1]:null;
if(!username)throw new Error('用法：node scripts/bootstrap-admin.mjs --username <主账号>，数据库须先启动一次完成迁移');
const password=await new Promise((resolve,reject)=>{
  let value='';const raw=process.stdin.isTTY;process.stdin.setEncoding('utf8');if(raw)process.stdin.setRawMode(true);process.stdin.resume();
  process.stdout.write('请输入主账号初始密码（不回显）：\n');
  const done=()=>{if(raw)process.stdin.setRawMode(false);process.stdin.pause();process.stdin.removeAllListeners('data');resolve(value);};
  process.stdin.on('data',chunk=>{for(const c of chunk){if(c==='\u0003'){reject(new Error('已取消'));return;}if(c==='\r'||c==='\n'){done();return;}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else value+=c;}});
  process.stdin.on('end',()=>done());
});
const db=new DatabaseSync(resolve(process.env.DATA_DIR||'data','momoyu.sqlite'));
try{bootstrapPrimary(db,{username,password});console.log('主账号初始化完成；密码仅保存为加盐哈希。');}finally{db.close();}
