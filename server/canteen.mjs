import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {FILE_LIMITS as limits} from '../shared/attachment-limits.mjs';
import {receiveFile,storageUsed} from './media-files.mjs';
import {accountAccess,requirePublishing} from './accounts.mjs';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const MEALS=['breakfast','lunch','takeout'];
const DAY_LABELS=['周一','周二','周三','周四','周五'];
const MAX_ITEMS=160, MAX_NAME=40, MAX_COMMENT=200;

function localDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function mondayOf(date=new Date()){
  const x=new Date(date.getFullYear(),date.getMonth(),date.getDate());
  x.setDate(x.getDate()-((x.getDay()+6)%7));
  return x;
}
function shortDate(d){return `${d.getMonth()+1}.${String(d.getDate()).padStart(2,'0')}`;}
function weekLabel(start){const end=new Date(start);end.setDate(end.getDate()+4);return `${shortDate(start)} – ${shortDate(end)}`;}

// 首次启动时写入一份可编辑的示例周菜单（来自用户提供的食堂海报），管理员可随时整周替换。
const SEED={
  breakfast:[
    [['蒸饺',3],['鸡汁广式粥',4.5],['排骨汤面',6],['花卷',1],['肉包',2.2],['白粥',1.1],['豆浆',1.1]],
    [['鸡蛋三丝炒米粉',3.5],['瘦肉小面',3],['红糖馒头',1.5],['椰香面包',2],['白粥',1.1],['鲜榨玉米汁',1.5]],
    [['京式煎饼',10],['肉汁汤米粉',8],['红豆卷',1.5],['肉包',2.2],['黑豆浆',1.5],['蛋糕',2]],
    [['猪油肠粉',2.5],['紫米莲子粥',6],['红糖馒头',1.5],['油条',1.1],['茶叶蛋',1.5],['三角蛋糕',2]],
    [['肉沫布拉肠',4.5],['煎蛋汤面',6],['手工油条',2],['蒸饺面包',2],['白粥',1.1],['豆浆',1.1]]
  ],
  lunch:[
    ['蛋炒饭','玉米蒸肉饼','口水鸡','红烧狮子头','西芹木耳拌花生','炝炒土豆丝','冬瓜大骨汤','米饭'],
    ['萝卜牛腩','蒜蓉蒸排骨','剁椒蒸鱼头','青椒炒蛋','蒜苔回锅肉','玉米糊','米饭'],
    ['酸菜鱼片','梅菜扣肉','番茄炒蛋','花菜炒肉','鱼香肉丝','紫菜蛋花汤','米饭'],
    ['老坛酸菜鱼','木耳蒸鸡','红烧豆腐','干煸豆角','大盘鸡','银耳雪梨糖水','米饭'],
    ['土豆烧鸡','咕噜肉','清蒸鲈鱼','西芹炒肉','酸辣土豆丝','冬瓜薏米老鸭汤','米饭']
  ],
  takeout:[
    [['酸菜水煮肉片',15],['苦瓜酿肉',30],['醋溜白菜',18],['上汤菠菜',18],['蛋挞',1.5],['鸡腿盖饭',18]],
    [['白云猪手',42],['椒盐蘑菇',24],['平锅辣子鸡',35],['小炒黄牛肉',48],['提子面包',3],['烧鸭盖饭',18]],
    [['红烧狮子头',38],['姜葱炒花蟹',45],['韭菜香干炒肉',22],['蒜蓉生菜',18],['肉松面包',2.5],['红烧肉盖饭',18]],
    [['可乐焖牛腩',45],['木须肉',22],['酸辣肚片',40],['桂圆蒸南瓜条',22],['蛋挞',2.5],['白切鸡盖饭',18]],
    [['凉拌猪头肉',42],['红烧金鲳鱼',45],['丝瓜腐竹炒肉',22],['红烧牛排',58],['红豆吐司',12],['鸡腿盖饭',18]]
  ]
};

export function canteenService({db,body,json,dataDir}){
  db.exec(`CREATE TABLE IF NOT EXISTS canteen_weeks(id TEXT PRIMARY KEY,week_start TEXT NOT NULL,label TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT);
    CREATE TABLE IF NOT EXISTS canteen_items(id TEXT PRIMARY KEY,week_id TEXT NOT NULL,meal TEXT NOT NULL,day_index INTEGER NOT NULL,name TEXT NOT NULL,price REAL,sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS canteen_photos(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,owner_id TEXT NOT NULL,storage_key TEXT NOT NULL,size INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,created_at TEXT NOT NULL,removed_at TEXT);
    CREATE TABLE IF NOT EXISTS canteen_ratings(item_id TEXT NOT NULL,owner_id TEXT NOT NULL,score INTEGER NOT NULL,comment TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,PRIMARY KEY(item_id,owner_id));
    CREATE TABLE IF NOT EXISTS canteen_photo_likes(photo_id TEXT NOT NULL,user_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(photo_id,user_id));
    CREATE TABLE IF NOT EXISTS canteen_photo_comments(id TEXT PRIMARY KEY,photo_id TEXT NOT NULL,owner_id TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,removed_at TEXT);`);
  db.exec('CREATE INDEX IF NOT EXISTS canteen_items_week ON canteen_items(week_id);');
  db.exec('CREATE INDEX IF NOT EXISTS canteen_photos_item ON canteen_photos(item_id);');
  if(!db.prepare('PRAGMA table_info(canteen_items)').all().some(column=>column.name==='active')){
    db.exec('ALTER TABLE canteen_items ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  }

  const root=resolve(dataDir,'canteen'),get=(sql,...a)=>db.prepare(sql).get(...a),all=(sql,...a)=>db.prepare(sql).all(...a),run=(sql,...a)=>db.prepare(sql).run(...a);
  const isAdmin=user=>{const a=accountAccess(db,user.id);return !!a.enabled&&a.role!=='employee';};

  function seed(){
    if(get('SELECT count(*) AS n FROM canteen_weeks').n)return;
    const start=mondayOf(),weekId=randomUUID(),now=new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try{
      run('INSERT INTO canteen_weeks VALUES(?,?,?,?,?)',weekId,localDate(start),weekLabel(start),now,null);
      const insert=(meal,day,name,price,sort)=>run('INSERT INTO canteen_items (id,week_id,meal,day_index,name,price,sort) VALUES(?,?,?,?,?,?,?)',randomUUID(),weekId,meal,day,name,price,sort);
      for(let day=0;day<5;day++){
        SEED.breakfast[day].forEach(([name,price],i)=>insert('breakfast',day,name,price,i));
        SEED.lunch[day].forEach((name,i)=>insert('lunch',day,name,null,i));
        SEED.takeout[day].forEach(([name,price],i)=>insert('takeout',day,name,price,i));
      }
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }

  const currentWeek=()=>get('SELECT * FROM canteen_weeks ORDER BY week_start DESC LIMIT 1');
  const ratingSummary=itemId=>{
    const rows=all('SELECT score,count(*) AS n FROM canteen_ratings WHERE item_id=? GROUP BY score',itemId);
    const dist=[0,0,0,0,0];let count=0,total=0;
    for(const row of rows){if(row.score>=1&&row.score<=5){dist[row.score-1]=row.n;count+=row.n;total+=row.score*row.n;}}
    return {avg:count?Math.round(total/count*10)/10:null,count,dist};
  };
  const photoView=(p,user,withComments=false)=>({
    id:p.id,url:'/api/canteen/photos/'+p.id+'/image',width:p.width,height:p.height,createdAt:p.created_at,
    by:'匿名同事',isMine:p.owner_id===user.id,
    likeCount:get('SELECT count(*) AS n FROM canteen_photo_likes WHERE photo_id=?',p.id).n,
    liked:!!get('SELECT 1 FROM canteen_photo_likes WHERE photo_id=? AND user_id=?',p.id,user.id),
    commentCount:get('SELECT count(*) AS n FROM canteen_photo_comments WHERE photo_id=? AND removed_at IS NULL',p.id).n,
    comments:withComments?all('SELECT * FROM canteen_photo_comments WHERE photo_id=? AND removed_at IS NULL ORDER BY created_at LIMIT 50',p.id).map(c=>({id:c.id,content:c.content,by:'匿名同事',isMine:c.owner_id===user.id,createdAt:c.created_at})):[]
  });
  const itemView=(item,user)=>({id:item.id,name:item.name,price:item.price,meal:item.meal,day:item.day_index,rating:ratingSummary(item.id),
    photoCount:get('SELECT count(*) AS n FROM canteen_photos WHERE item_id=? AND removed_at IS NULL',item.id).n});
  const requireItem=id=>{const item=get('SELECT * FROM canteen_items WHERE id=? AND active=1',id);if(!item)fail(404,'NOT_FOUND','菜品不存在');return item;};

  function menuView(user){
    const week=currentWeek();
    if(!week)return {week:null,days:[],meals:{breakfast:[],lunch:[],takeout:[]}};
    const items=all('SELECT * FROM canteen_items WHERE week_id=? AND active=1 ORDER BY day_index,sort,rowid',week.id);
    const start=new Date(week.week_start+'T00:00:00');
    return {
      week:{id:week.id,label:week.label,weekStart:week.week_start},
      days:DAY_LABELS.map((label,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return {index:i,label,date:shortDate(d)};}),
      meals:Object.fromEntries(MEALS.map(meal=>[meal,items.filter(x=>x.meal===meal).map(x=>itemView(x,user))]))
    };
  }

  async function savePhoto(req,item,user){
    await mkdir(root,{recursive:true});
    if(storageUsed(db,user.id)>=limits.storageBytes)fail(413,'STORAGE_LIMIT','个人附件空间已达上限。');
    const file=await receiveFile(req,{root,maxBytes:limits.careImageBytes});
    const id=randomUUID(),key=id+'.webp';
    try{
      if(!file.name.match(/\.(png|jpe?g|webp|gif)$/i))fail(415,'INVALID_IMAGE','请选择图片文件');
      const bytes=await readFile(file.path);
      let out;
      try{
        const image=sharp(bytes,{limitInputPixels:40000000,animated:false});
        const meta=await image.metadata();
        if(!['jpeg','png','webp','gif'].includes(meta.format))throw new Error('Unsupported image format');
        out=await image.rotate().resize({width:1600,height:2000,fit:'inside',withoutEnlargement:true}).webp({quality:84}).toBuffer({resolveWithObject:true});
      }catch{fail(415,'INVALID_IMAGE','无法读取图片，请换一张重试');}
      await writeFile(resolve(root,key),out.data,{flag:'wx'});
      requirePublishing(db,user.id);
      requireItem(item.id);
      if(storageUsed(db,user.id)+out.data.length>limits.storageBytes)fail(413,'STORAGE_LIMIT','个人附件空间已达上限。');
      run('INSERT INTO canteen_photos VALUES(?,?,?,?,?,?,?,?,NULL)',id,item.id,user.id,key,out.data.length,out.info.width,out.info.height,new Date().toISOString());
      return get('SELECT * FROM canteen_photos WHERE id=?',id);
    }catch(e){await rm(resolve(root,key),{force:true});throw e;}finally{await rm(file.path,{force:true});}
  }

  async function handle(req,res,url,user){
    const path=url.pathname,method=req.method;
    if(!path.startsWith('/api/canteen/'))return false;
    if(!user)fail(401,'UNAUTHORIZED','请先登录');
    if(path==='/api/canteen/menu'&&method==='GET'){json(res,200,menuView(user));return true;}
    if(path==='/api/canteen/menu'&&method==='PUT'){
      if(!isAdmin(user))fail(403,'ADMIN_REQUIRED','仅管理员可以发布菜单');
      const b=await body(req);
      if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['label','weekStart','items'].includes(k)))fail(400,'INVALID_FIELD','请求字段无效');
      if(!Array.isArray(b.items))fail(400,'INVALID_FIELD','请提供菜品列表');
      const items=b.items;
      if(items.length>MAX_ITEMS)fail(400,'INVALID_FIELD','菜品数量过多');
      const clean=[];
      for(const it of items){
        if(!it||typeof it!=='object'||Object.keys(it).some(k=>!['meal','day','name','price'].includes(k)))fail(400,'INVALID_FIELD','菜品格式无效');
        const name=typeof it.name==='string'?it.name.trim():'';
        if(!name||name.length>MAX_NAME||!MEALS.includes(it.meal)||!Number.isInteger(it.day)||it.day<0||it.day>4)fail(400,'INVALID_FIELD','菜品名称、餐次或星期无效');
        const price=it.price===null||it.price===undefined||it.price===''?null:Number(it.price);
        if(price!==null&&(!Number.isFinite(price)||price<0||price>999))fail(400,'INVALID_FIELD','价格无效');
        clean.push({meal:it.meal,day:it.day,name,price});
      }
      const start=b.weekStart?new Date(b.weekStart+'T00:00:00'):mondayOf();
      if(Number.isNaN(start.getTime()))fail(400,'INVALID_FIELD','周起始日期无效');
      const weekStart=localDate(start),label=typeof b.label==='string'&&b.label.trim()?b.label.trim().slice(0,40):weekLabel(start);
      const weekId=randomUUID(),now=new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try{
        const existing=get('SELECT id FROM canteen_weeks WHERE week_start=?',weekStart);
        const id=existing?existing.id:weekId;
        if(existing)run('UPDATE canteen_weeks SET label=?,created_at=?,created_by=? WHERE id=?',label,now,user.id,id);
        else run('INSERT INTO canteen_weeks VALUES(?,?,?,?,?)',id,weekStart,label,now,user.id);
        const previous=all('SELECT * FROM canteen_items WHERE week_id=? ORDER BY active DESC,sort,rowid',id);
        const usedIds=new Set();
        run('UPDATE canteen_items SET active=0 WHERE week_id=?',id);
        // Keep item IDs for the same dish, so its photos and ratings survive menu edits.
        clean.forEach((it,i)=>{
          const old=previous.find(row=>row.meal===it.meal&&row.day_index===it.day&&row.name===it.name&&!usedIds.has(row.id));
          if(old){
            usedIds.add(old.id);
            run('UPDATE canteen_items SET price=?,sort=?,active=1 WHERE id=?',it.price,i,old.id);
          }else run('INSERT INTO canteen_items (id,week_id,meal,day_index,name,price,sort) VALUES(?,?,?,?,?,?,?)',randomUUID(),id,it.meal,it.day,it.name,it.price,i);
        });
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      json(res,200,menuView(user));return true;
    }
    if(path==='/api/canteen/rank'&&method==='GET'){
      const week=currentWeek();
      if(!week)return json(res,200,{red:[],black:[]});
      const items=all('SELECT * FROM canteen_items WHERE week_id=? AND active=1',week.id).map(x=>({item:x,rating:ratingSummary(x.id)})).filter(x=>x.rating.count>0);
      const view=x=>({id:x.item.id,name:x.item.name,meal:x.item.meal,day:x.item.day_index,avg:x.rating.avg,count:x.rating.count});
      const red=items.filter(x=>x.rating.avg>=4).sort((a,b)=>b.rating.avg-a.rating.avg||b.rating.count-a.rating.count).slice(0,3).map(view);
      const black=items.filter(x=>x.rating.avg<3).sort((a,b)=>a.rating.avg-b.rating.avg||b.rating.count-a.rating.count).slice(0,3).map(view);
      return json(res,200,{red,black});
    }
    const itemMatch=path.match(/^\/api\/canteen\/items\/([a-f0-9-]{36})(?:\/(rating|photos))?$/i);
    if(itemMatch){
      const item=requireItem(itemMatch[1]),action=itemMatch[2];
      if(!action&&method==='GET'){
        const photos=all('SELECT * FROM canteen_photos WHERE item_id=? AND removed_at IS NULL ORDER BY created_at DESC LIMIT 40',item.id).map(p=>photoView(p,user,true));
        json(res,200,{item:itemView(item,user),photos,myRating:get('SELECT score,comment FROM canteen_ratings WHERE item_id=? AND owner_id=?',item.id,user.id)||null});return true;
      }
      if(action==='rating'&&method==='PUT'){
        const b=await body(req);
        if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['score','comment'].includes(k)))fail(400,'INVALID_FIELD','请求字段无效');
        if(!Number.isInteger(b.score)||b.score<1||b.score>5)fail(400,'INVALID_FIELD','请选择 1–5 分');
        const comment=typeof b.comment==='string'?b.comment.trim():'';
        if(comment.length>MAX_COMMENT)fail(400,'INVALID_FIELD','评价最多 200 字');
        requirePublishing(db,user.id);
        requireItem(item.id);
        run('INSERT INTO canteen_ratings VALUES(?,?,?,?,?) ON CONFLICT(item_id,owner_id) DO UPDATE SET score=excluded.score,comment=excluded.comment,created_at=excluded.created_at',item.id,user.id,b.score,comment,new Date().toISOString());
        json(res,200,{rating:ratingSummary(item.id),myRating:{score:b.score,comment}});return true;
      }
      if(action==='photos'&&method==='POST'){
        requirePublishing(db,user.id);
        const photo=await savePhoto(req,item,user);
        json(res,201,{photo:photoView(photo,user,true),item:itemView(item,user)});return true;
      }
    }
    const photoMatch=path.match(/^\/api\/canteen\/photos\/([a-f0-9-]{36})(?:\/(image|like|comments))?$/i);
    if(photoMatch){
      const photo=get('SELECT * FROM canteen_photos WHERE id=? AND removed_at IS NULL',photoMatch[1]);
      if(!photo)fail(404,'NOT_FOUND','照片不存在');
      const action=photoMatch[2];
      if(action)requireItem(photo.item_id);
      if(action==='image'&&['GET','HEAD'].includes(method)){
        const bytes=await readFile(resolve(root,photo.storage_key));
        res.writeHead(200,{'Content-Type':'image/webp','Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
        res.end(method==='HEAD'?undefined:bytes);return true;
      }
      if(action==='like'&&method==='PUT'){
        const b=await body(req);
        if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>k!=='liked')||typeof b.liked!=='boolean')fail(400,'INVALID_FIELD','点赞状态无效');
        if(b.liked)run('INSERT OR IGNORE INTO canteen_photo_likes VALUES(?,?,?)',photo.id,user.id,new Date().toISOString());
        else run('DELETE FROM canteen_photo_likes WHERE photo_id=? AND user_id=?',photo.id,user.id);
        json(res,200,{photo:photoView(photo,user,true)});return true;
      }
      if(action==='comments'&&method==='POST'){
        const b=await body(req);
        if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>k!=='content'))fail(400,'INVALID_FIELD','请求字段无效');
        const content=typeof b.content==='string'?b.content.trim():'';
        if(!content||content.length>MAX_COMMENT)fail(400,'INVALID_FIELD','留言需要 1–200 字');
        requirePublishing(db,user.id);
        requireItem(photo.item_id);
        run('INSERT INTO canteen_photo_comments VALUES(?,?,?,?,?,NULL)',randomUUID(),photo.id,user.id,content,new Date().toISOString());
        json(res,201,{photo:photoView(photo,user,true)});return true;
      }
      if(!action&&method==='DELETE'){
        if(photo.owner_id!==user.id&&!isAdmin(user))fail(403,'FORBIDDEN','只能删除自己上传的照片');
        run('UPDATE canteen_photos SET removed_at=? WHERE id=?',new Date().toISOString(),photo.id);
        json(res,200,{ok:true});return true;
      }
    }
    return false;
  }

  seed();
  return {handle,menuView};
}
