import {createHash,randomUUID} from 'node:crypto';

// Requests/threads engagement: views, private questions and public comments.
// Dependencies are injected so this module never imports server/index.mjs.
export function engagementService({db,get,all,run,body,json,fail}) {
  const now=()=>new Date().toISOString();
  const excerpt=content=>content.trim().slice(0,60);
  const requestRow=id=>get('SELECT * FROM requests WHERE id=?',id);
  const visible=(row,user)=>{
    if(!row)return false;
    const d=JSON.parse(row.data);
    return !((d.deletedAt||d.moderatedAt||d.status==='draft'||d.visibility!=='company')&&row.owner_id!==user?.id&&row.claimer_id!==user?.id);
  };
  const displayName=id=>{
    const row=get('SELECT profile FROM users WHERE id=?',id);
    if(!row)return '同事';
    try{return JSON.parse(row.profile).displayName||'同事';}catch{return '同事';}
  };
  const label=(id,d)=>d?.anonymous?'匿名同事':displayName(id);
  const notify=(userId,requestId,type,reason)=>{
    if(!userId)return;
    run(
      `INSERT INTO notifications(id,user_id,request_id,type,reason,created_at,read_at) VALUES(?,?,?,?,?,?,NULL)
       ON CONFLICT(user_id,request_id,type) DO UPDATE SET reason=excluded.reason,created_at=excluded.created_at,read_at=NULL`,
      randomUUID(),userId,requestId,type,reason,Date.now());
  };
  const commentView=(c,row,user,d)=>({
    id:c.id,
    authorLabel:label(c.author_id,d),
    content:c.content,
    createdAt:c.created_at,
    canRemove:!!user&&(c.author_id===user.id||row.owner_id===user.id),
    isMine:!!user&&c.author_id===user.id,
  });
  const threadMessages=id=>all('SELECT * FROM request_thread_messages WHERE thread_id=? ORDER BY rowid',id);
  const threadView=(t,user,d,{markRead=true}={})=>{
    const rows=threadMessages(t.id);
    const unread=rows.filter(m=>m.author_id!==user.id&&!m.read_at).length;
    const messages=rows.map(m=>({id:m.id,authorLabel:label(m.author_id,d),content:m.content,createdAt:m.created_at,mine:m.author_id===user.id}));
    if(markRead)run('UPDATE request_thread_messages SET read_at=? WHERE thread_id=? AND author_id<>? AND read_at IS NULL',now(),t.id,user.id);
    return {id:t.id,askerLabel:label(t.asker_id,d),updatedAt:t.updated_at,unread,messages};
  };
  const threadItem=(t,user,d)=>{
    const last=get('SELECT content FROM request_thread_messages WHERE thread_id=? ORDER BY rowid DESC LIMIT 1',t.id);
    const unread=Number(get('SELECT count(*) AS n FROM request_thread_messages WHERE thread_id=? AND author_id<>? AND read_at IS NULL',t.id,user.id).n);
    const deletedAt=user.id===t.owner_id?t.owner_deleted_at:t.asker_deleted_at;
    const otherId=user.id===t.owner_id?t.asker_id:t.owner_id;
    return {id:t.id,requestId:t.request_id,requestTitle:d.title||'',otherLabel:label(otherId,d),lastMessage:(last?.content||'').slice(0,80),updatedAt:t.updated_at,unread,deletedAt:deletedAt||null};
  };
  const visibleThreads=(row,user)=>{
    const d=JSON.parse(row.data);
    if(user.id===row.owner_id)return all('SELECT * FROM request_threads WHERE request_id=? AND owner_id=? AND owner_deleted_at IS NULL ORDER BY updated_at DESC',row.id,user.id);
    return all('SELECT * FROM request_threads WHERE request_id=? AND asker_id=? AND asker_deleted_at IS NULL ORDER BY updated_at DESC',row.id,user.id);
  };
  const validContent=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=1000;

  function ensure(){
    db.exec(`CREATE TABLE IF NOT EXISTS request_views(request_id TEXT, viewer_key TEXT, viewed_at TEXT, PRIMARY KEY(request_id, viewer_key));
      CREATE TABLE IF NOT EXISTS request_threads(id TEXT PRIMARY KEY, request_id TEXT, asker_id TEXT, owner_id TEXT, created_at TEXT, updated_at TEXT, asker_deleted_at TEXT, owner_deleted_at TEXT, UNIQUE(request_id, asker_id));
      CREATE TABLE IF NOT EXISTS request_thread_messages(id TEXT PRIMARY KEY, thread_id TEXT, author_id TEXT, content TEXT, created_at TEXT, read_at TEXT);
      CREATE TABLE IF NOT EXISTS request_comments(id TEXT PRIMARY KEY, request_id TEXT, author_id TEXT, content TEXT, created_at TEXT, removed_at TEXT);
      CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,request_id TEXT NOT NULL,type TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER,UNIQUE(user_id,request_id,type));
      CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created_at);
      CREATE INDEX IF NOT EXISTS request_views_request ON request_views(request_id);
      CREATE INDEX IF NOT EXISTS request_threads_request ON request_threads(request_id);
      CREATE INDEX IF NOT EXISTS request_thread_messages_thread ON request_thread_messages(thread_id);
      CREATE INDEX IF NOT EXISTS request_comments_request ON request_comments(request_id);`);
    for(const column of ['asker_deleted_at','owner_deleted_at']){
      if(!db.prepare('PRAGMA table_info(request_threads)').all().some(c=>c.name===column))
        db.exec(`ALTER TABLE request_threads ADD COLUMN ${column} TEXT`);
    }
  }

  function viewCount(id){
    return Number(get('SELECT count(*) AS n FROM request_views WHERE request_id=?',id)?.n||0);
  }

  async function handle(req,res,path,method,user){
    const view=path.match(/^\/api\/requests\/([^/]+)\/view$/);
    if(view&&method==='POST'){
      await body(req);
      const row=requestRow(view[1]);
      if(!visible(row,user))fail(404,'NOT_FOUND','需求不存在');
      if(user&&row.owner_id===user.id)return json(res,200,{views:viewCount(row.id)}),true;
      const viewerKey=user?user.id:createHash('sha256').update(`${req.socket?.remoteAddress||''}|${req.headers['user-agent']||''}`).digest('hex').slice(0,32);
      run('INSERT OR IGNORE INTO request_views(request_id,viewer_key,viewed_at) VALUES(?,?,?)',row.id,viewerKey,now());
      return json(res,200,{views:viewCount(row.id)}),true;
    }

    const interactions=path.match(/^\/api\/requests\/([^/]+)\/interactions$/);
    if(interactions&&method==='GET'){
      const row=requestRow(interactions[1]);
      if(!visible(row,user))fail(404,'NOT_FOUND','需求不存在');
      const d=JSON.parse(row.data);
      const comments=all('SELECT * FROM request_comments WHERE request_id=? AND removed_at IS NULL ORDER BY rowid DESC',row.id).map(c=>commentView(c,row,user,d));
      const threads=user?visibleThreads(row,user).map(t=>threadView(t,user,d)):[];
      return json(res,200,{views:viewCount(row.id),comments,threads}),true;
    }

    const questions=path.match(/^\/api\/requests\/([^/]+)\/questions$/);
    if(questions&&method==='POST'){
      if(!user)fail(401,'UNAUTHORIZED','请先登录');
      const b=await body(req);
      if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['content','visibility'].includes(k)))fail(400,'INVALID_BODY','请求格式无效');
      const row=requestRow(questions[1]);
      if(!row)fail(404,'NOT_FOUND','需求不存在');
      const d=JSON.parse(row.data);
      if(d.visibility!=='company'||d.deletedAt||d.moderatedAt||d.status==='draft')fail(404,'NOT_FOUND','需求不存在');
      if(!row.owner_id)fail(400,'NO_OWNER','示例需求暂不支持提问');
      if(row.owner_id===user.id)fail(400,'CANNOT_ASK','不能向自己的需求提问');
      if(!validContent(b.content))fail(400,'INVALID_FIELD','请填写1至1000字的提问');
      if(!['private','public'].includes(b.visibility))fail(400,'INVALID_FIELD','提问方式无效');
      const content=b.content.trim(),time=now(),authorLabel=label(user.id,d);
      if(b.visibility==='public'){
        const id=randomUUID();
        run('INSERT INTO request_comments VALUES(?,?,?,?,?,NULL)',id,row.id,user.id,content,time);
        notify(row.owner_id,row.id,'comment',`${authorLabel}留言：${excerpt(content)}`);
        return json(res,200,{comment:commentView(get('SELECT * FROM request_comments WHERE id=?',id),row,user,d)}),true;
      }
      let thread=get('SELECT * FROM request_threads WHERE request_id=? AND asker_id=?',row.id,user.id);
      if(thread){
        run('UPDATE request_threads SET updated_at=?,asker_deleted_at=NULL,owner_deleted_at=NULL WHERE id=?',time,thread.id);
        thread=get('SELECT * FROM request_threads WHERE id=?',thread.id);
      }else{
        const id=randomUUID();
        run('INSERT OR IGNORE INTO request_threads(id,request_id,asker_id,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?)',id,row.id,user.id,row.owner_id,time,time);
        thread=get('SELECT * FROM request_threads WHERE request_id=? AND asker_id=?',row.id,user.id);
      }
      run('INSERT INTO request_thread_messages VALUES(?,?,?,?,?,NULL)',randomUUID(),thread.id,user.id,content,time);
      notify(row.owner_id,row.id,'question',`${authorLabel}提问：${excerpt(content)}`);
      return json(res,200,{thread:threadView(thread,user,d,{markRead:false})}),true;
    }

    if(path==='/api/interactions/threads'&&method==='GET'){
      if(!user)fail(401,'UNAUTHORIZED','请先登录');
      const rows=all('SELECT * FROM request_threads WHERE owner_id=? OR asker_id=? ORDER BY updated_at DESC',user.id,user.id);
      const items=[];let unread=0;
      for(const thread of rows){
        const deletedAt=user.id===thread.owner_id?thread.owner_deleted_at:thread.asker_deleted_at;
        if(deletedAt)continue;
        const row=requestRow(thread.request_id),d=row?JSON.parse(row.data):{};
        const item=threadItem(thread,user,d);
        unread+=item.unread;items.push(item);
      }
      return json(res,200,{items,unread}),true;
    }

    const threadRoute=path.match(/^\/api\/interactions\/threads\/([^/]+)(?:\/(messages|delete|restore))?$/);
    if(threadRoute){
      const [,id,action]=threadRoute;
      if(!user)fail(401,'UNAUTHORIZED','请先登录');
      const thread=get('SELECT * FROM request_threads WHERE id=?',id);
      if(!thread||(thread.owner_id!==user.id&&thread.asker_id!==user.id))fail(404,'NOT_FOUND','会话不存在');
      const row=requestRow(thread.request_id);
      if(!row)fail(404,'NOT_FOUND','需求不存在');
      const d=JSON.parse(row.data);
      if(!action&&method==='GET'){
        const view=threadView(thread,user,d);
        return json(res,200,{thread:view,messages:view.messages}),true;
      }
      if(action==='messages'&&method==='POST'){
        const b=await body(req);
        if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>k!=='content'))fail(400,'INVALID_BODY','请求格式无效');
        if(!validContent(b.content))fail(400,'INVALID_FIELD','请填写1至1000字的回复');
        const content=b.content.trim(),time=now();
        run('INSERT INTO request_thread_messages VALUES(?,?,?,?,?,NULL)',randomUUID(),thread.id,user.id,content,time);
        run('UPDATE request_threads SET updated_at=?,owner_deleted_at=NULL,asker_deleted_at=NULL WHERE id=?',time,thread.id);
        const other=thread.owner_id===user.id?thread.asker_id:thread.owner_id;
        notify(other,thread.request_id,'reply',`${label(user.id,d)}回复：${excerpt(content)}`);
        return json(res,200,{thread:threadView(get('SELECT * FROM request_threads WHERE id=?',thread.id),user,d,{markRead:false})}),true;
      }
      if(action==='delete'&&method==='POST'){
        await body(req);
        const time=now();
        if(user.id===thread.owner_id)run('UPDATE request_threads SET owner_deleted_at=? WHERE id=?',time,thread.id);
        else run('UPDATE request_threads SET asker_deleted_at=? WHERE id=?',time,thread.id);
        return json(res,200,{ok:true}),true;
      }
      if(action==='restore'&&method==='POST'){
        await body(req);
        if(user.id===thread.owner_id)run('UPDATE request_threads SET owner_deleted_at=NULL WHERE id=?',thread.id);
        else run('UPDATE request_threads SET asker_deleted_at=NULL WHERE id=?',thread.id);
        return json(res,200,{ok:true}),true;
      }
    }

    const commentRemove=path.match(/^\/api\/interactions\/comments\/([^/]+)\/remove$/);
    if(commentRemove&&method==='POST'){
      if(!user)fail(401,'UNAUTHORIZED','请先登录');
      await body(req);
      const comment=get('SELECT * FROM request_comments WHERE id=? AND removed_at IS NULL',commentRemove[1]);
      if(!comment)fail(404,'NOT_FOUND','留言不存在');
      const row=requestRow(comment.request_id);
      if(!row)fail(404,'NOT_FOUND','留言不存在');
      if(comment.author_id!==user.id&&row.owner_id!==user.id)fail(404,'NOT_FOUND','留言不存在');
      run('UPDATE request_comments SET removed_at=? WHERE id=?',now(),comment.id);
      return json(res,200,{ok:true}),true;
    }
    return false;
  }

  return {ensure,viewCount,handle};
}
