import {randomBytes,randomUUID,scryptSync} from 'node:crypto';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export function accountSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS account_access(user_id TEXT PRIMARY KEY,role TEXT NOT NULL CHECK(role IN ('employee','admin','primary_admin')),enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)));
    CREATE UNIQUE INDEX IF NOT EXISTS one_primary_admin ON account_access(role) WHERE role='primary_admin';
    CREATE TRIGGER IF NOT EXISTS two_admins_insert BEFORE INSERT ON account_access WHEN NEW.role IN ('admin','primary_admin') AND (SELECT count(*) FROM account_access WHERE role IN ('admin','primary_admin') AND user_id<>NEW.user_id)>=2 BEGIN SELECT RAISE(ABORT,'ADMIN_LIMIT'); END;
    CREATE TRIGGER IF NOT EXISTS two_admins_update BEFORE UPDATE OF role ON account_access WHEN NEW.role IN ('admin','primary_admin') AND (SELECT count(*) FROM account_access WHERE role IN ('admin','primary_admin') AND user_id<>NEW.user_id)>=2 BEGIN SELECT RAISE(ABORT,'ADMIN_LIMIT'); END;
    CREATE TABLE IF NOT EXISTS management_audit(id INTEGER PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);`);
  db.exec('CREATE TABLE IF NOT EXISTS account_restrictions(user_id TEXT PRIMARY KEY,muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0,1)),deleted_at TEXT)');
}
export const accountAccess=(db,id)=>({...{role:'employee',enabled:1,muted:0,deleted_at:null},...db.prepare('SELECT role,enabled FROM account_access WHERE user_id=?').get(id),...db.prepare('SELECT muted,deleted_at FROM account_restrictions WHERE user_id=?').get(id)});
export function requirePublishing(db,id){const a=accountAccess(db,id);if(!a.enabled||a.deleted_at)fail(403,'ACCOUNT_DISABLED','账号已停用，请联系管理员');if(a.muted)fail(403,'ACCOUNT_MUTED','账号已禁言，暂不能公开发布或修改内容；私密对话与已有任务交付仍可使用。');}
export const passwordFields=password=>{
  if(typeof password!=='string'||password.length<8||password.length>2000)fail(400,'INVALID_PASSWORD','密码须为8至2000个字符');
  const salt=randomBytes(16).toString('hex');return {salt,hash:scryptSync(password,salt,64).toString('hex')};
};
export function bootstrapPrimary(db,{username,password}){
  accountSchema(db);
  if(typeof username!=='string'||!username.trim()||username.length>100)fail(400,'INVALID_USERNAME','请提供主账号');
  const credentials=passwordFields(password),primary=db.prepare("SELECT u.username FROM account_access a JOIN users u ON u.id=a.user_id WHERE a.role='primary_admin'").get();
  if(primary)fail(409,'PRIMARY_EXISTS','主账号已初始化，未更改原密码');
  db.exec('BEGIN IMMEDIATE');
  try{
    const existing=db.prepare('SELECT id FROM users WHERE username=?').get(username.trim()),id=existing?.id||randomUUID();
    if(existing)db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(credentials.salt,credentials.hash,id);
    else db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id,username.trim(),credentials.salt,credentials.hash,JSON.stringify({displayName:'主管理员',department:'平台管理',skills:[],availability:'',acceptingHelp:false,bio:'',skillDescription:''}));
    db.prepare("INSERT INTO account_access VALUES(?,'primary_admin',1) ON CONFLICT(user_id) DO UPDATE SET role='primary_admin',enabled=1").run(id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);db.exec('COMMIT');return id;
  }catch(e){db.exec('ROLLBACK');throw e;}
}
