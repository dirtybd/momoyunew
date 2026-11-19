import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import './Canteen.css';

const MEALS=[['breakfast','早餐'],['lunch','午餐'],['takeout','外卖']];
const MEAL_LABEL={breakfast:'早餐',lunch:'午餐',takeout:'外卖'};
const TIMES={breakfast:'6:30 – 9:00',lunch:'11:30 – 13:00',takeout:'10:30 – 12:30'};

function todayIndex(weekStart){
  if(!weekStart)return -1;
  const start=new Date(weekStart+'T00:00:00');
  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const diff=Math.floor((today-start)/86400000);
  return diff>=0&&diff<5?diff:-1;
}

function PhotoCard({photo,onLike,onThread,onRemove}){
  return <figure className="canteen-photo">
    <img src={photo.url} alt="菜品实拍" loading="lazy"/>
    <figcaption>
      <b>{photo.by} · {new Date(photo.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</b>
      <span>
        <button type="button" className={'canteen-photo-action'+(photo.liked?' is-on':'')} onClick={()=>onLike(photo)} aria-pressed={photo.liked}>👍 {photo.likeCount}</button>
        <button type="button" className="canteen-photo-action" onClick={()=>onThread(photo)}>💬 {photo.commentCount}</button>
        {onRemove&&<button type="button" className="canteen-photo-action" onClick={()=>onRemove(photo)}>删除实拍</button>}
      </span>
    </figcaption>
  </figure>;
}

function DishPanel({item,photos,myRating,onUpload,onLike,onRate,onThread,onRemove,canAdmin,busy}){
  const [score,setScore]=useState(myRating?.score||0),[comment,setComment]=useState(myRating?.comment||''),[saving,setSaving]=useState(false);
  useEffect(()=>{setScore(myRating?.score||0);setComment(myRating?.comment||'');},[item?.id,myRating?.score,myRating?.comment]);
  if(!item)return null;
  const rating=item.rating||{avg:null,count:0,dist:[0,0,0,0,0]};
  const max=Math.max(1,...rating.dist);
  const avg=rating.avg===null?'—':rating.avg.toFixed(1);
  return <section className="canteen-dish" aria-label={item.name}>
    <header className="canteen-dish-head">
      <div><h3>{item.name}<span>{item.dayLabel} · {MEAL_LABEL[item.meal]}</span></h3><p>{photos.length?`今天 ${photos.length} 位同事传了实拍，平均 ${avg} 分`:'还没有人传实拍，来做第一个'}</p></div>
      <label className="primary canteen-upload">＋ 上传这道菜的实拍<input type="file" accept="image/*" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)onUpload(f);}}/></label>
    </header>
    <div className="canteen-photo-wall">
      {photos.map(p=><PhotoCard key={p.id} photo={p} onLike={onLike} onThread={onThread} onRemove={p.isMine||canAdmin?onRemove:undefined}/>)}
      <label className="canteen-photo-add">＋<span>上传这道菜的实拍</span><input type="file" accept="image/*" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)onUpload(f);}}/></label>
    </div>
    <aside className="canteen-rating">
      <div className="canteen-rating-big"><b>{avg}</b><span>{rating.count} 人打分</span></div>
      <div className="canteen-bars">{[5,4,3,2,1].map(star=><div className="canteen-bar" key={star}><span>{star}★</span><i><b style={{width:(rating.dist[star-1]/max*100)+'%'}}/></i><span>{rating.dist[star-1]}</span></div>)}</div>
      <div className="canteen-rate">
        <div className="canteen-stars" role="group" aria-label="给这道菜打分">{[1,2,3,4,5].map(n=><button key={n} type="button" className={score>=n?'is-on':''} aria-label={`${n} 分`} aria-pressed={score===n} onClick={()=>setScore(n)}>★</button>)}</div>
        <input value={comment} maxLength={200} placeholder="吐槽或赞赏一句（可选）" onChange={e=>setComment(e.target.value)}/>
        <button type="button" className="secondary" disabled={!score||saving} onClick={async()=>{setSaving(true);try{await onRate(score,comment);}finally{setSaving(false);}}}>{saving?'提交中…':myRating?'更新评分':'提交评分'}</button>
      </div>
      <p>评分匿名汇总，所有人都能上传和评价。</p>
    </aside>
  </section>;
}

export function CanteenBoard({user,api,Modal,onLogin}){
  const [menu,setMenu]=useState(null),[rank,setRank]=useState({red:[],black:[]}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [selected,setSelected]=useState(null),[detail,setDetail]=useState(null),[detailBusy,setDetailBusy]=useState(false),[thread,setThread]=useState(null),[threadText,setThreadText]=useState('');
  const [adminOpen,setAdminOpen]=useState(false);
  const [removing,setRemoving]=useState(null),[removeBusy,setRemoveBusy]=useState(false),[removeError,setRemoveError]=useState('');
  const canAdmin=!!user&&(user.role==='admin'||user.role==='primary_admin');
  const today=useMemo(()=>todayIndex(menu?.week?.weekStart),[menu?.week?.weekStart]);

  const load=useCallback(async()=>{setLoading(true);setError('');try{const d=await api('/canteen/menu');setMenu(d);}catch(e){setError(e.message);}finally{setLoading(false);}}, [api]);
  useEffect(()=>{if(!user)return;load();api('/canteen/rank').then(setRank).catch(()=>{});},[user?.id,load,api]);
  useEffect(()=>{
    if(!menu?.week)return;
    const items=Object.values(menu.meals).flat();
    if(items.some(item=>item.id===selected))return;
    const idx=today>=0?today:0;
    const pick=menu.meals.lunch.find(item=>item.day===idx)||items.find(item=>item.day===idx)||items[0];
    setSelected(pick?.id??null);
    setThread(null);
  },[menu,selected,today]);
  useEffect(()=>{if(!selected)return;let alive=true;setDetailBusy(true);api('/canteen/items/'+selected).then(d=>{if(alive)setDetail(d);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setDetailBusy(false);});return()=>{alive=false;};},[selected,api]);

  const openItem=item=>{if(item.id===selected)return;setThread(null);setDetail(null);setSelected(item.id);};
  const refreshCounts=()=>{load();api('/canteen/rank').then(setRank).catch(()=>{});};

  async function upload(file){
    if(!selected)return;
    setDetailBusy(true);setError('');
    try{
      const fd=new FormData();fd.append('file',file);
      const res=await fetch('/api/canteen/items/'+selected+'/photos',{method:'POST',credentials:'same-origin',body:fd});
      const data=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(data.error?.message||'上传失败，请重试');
      setDetail(d=>d?.item.id===data.item.id?{...d,photos:[data.photo,...d.photos],item:data.item}:d);
      setNotice('实拍已上传，登录同事可以看到和评价。');refreshCounts();
    }catch(e){setError(e.message);}finally{setDetailBusy(false);}
  }
  async function like(photo){
    try{const d=await api('/canteen/photos/'+photo.id+'/like',{method:'PUT',body:{liked:!photo.liked}});setDetail(cur=>cur?{...cur,photos:cur.photos.map(p=>p.id===d.photo.id?d.photo:p)}:cur);}catch(e){setError(e.message);}
  }
  async function rate(score,comment){
    try{const d=await api('/canteen/items/'+selected+'/rating',{method:'PUT',body:{score,comment}});setDetail(cur=>cur?.item.id===selected?{...cur,item:{...cur.item,rating:d.rating},myRating:d.myRating}:cur);refreshCounts();setNotice('评分已记录，匿名汇总。');}catch(e){setError(e.message);}
  }
  async function sendComment(){
    if(!thread||!threadText.trim())return;
    try{const d=await api('/canteen/photos/'+thread.id+'/comments',{method:'POST',body:{content:threadText.trim()}});setDetail(cur=>cur?{...cur,photos:cur.photos.map(p=>p.id===d.photo.id?d.photo:p)}:cur);setThread(d.photo);setThreadText('');}catch(e){setError(e.message);}
  }
  async function removePhoto(){
    setRemoveBusy(true);
    setRemoveError('');
    try{
      await api('/canteen/photos/'+removing.id,{method:'DELETE',body:{}});
      setDetail(current=>current?{...current,photos:current.photos.filter(photo=>photo.id!==removing.id)}:current);
      setThread(current=>current?.id===removing.id?null:current);
      setRemoving(null);
      refreshCounts();
    }catch(e){setRemoveError(e.message);}finally{setRemoveBusy(false);}
  }

  if(!user)return <section className="canteen-board canteen-guest"><h2>食堂本周菜单</h2><p>登录后可以查看每周菜单、上传菜品实拍并打分。</p><button type="button" className="primary" onClick={onLogin}>登录 / 注册</button></section>;

  const currentItem=detail?.item.id===selected?detail.item:null;
  const currentPhotos=detail?.photos||[];

  return <section className="canteen-board" aria-label="食堂菜单">
    <header className="canteen-head">
      <div><h2>本周菜单</h2><small>{menu?.week?`${menu.week.label} · 每周一更新 · 点菜名看实拍`:'每周一更新 · 点菜名看实拍'}</small></div>
      <div className="canteen-actions">
        {canAdmin&&<button type="button" className="primary" onClick={()=>setAdminOpen(true)}>上传本周菜单</button>}
      </div>
    </header>
    {error&&<p className="inline-error" role="alert">{error}</p>}{notice&&<p className="care-success" role="status">{notice}</p>}
    {loading&&!menu?<div className="canteen-loading" role="status">正在加载本周菜单…</div>:null}
    {menu&&!menu.week?<div className="canteen-empty"><strong>本周菜单还没发布</strong><p>等管理员上传后，这里会显示早餐、午餐和外卖；每道菜都可以上传实拍和打分。</p></div>:null}
    {menu?.week?<>
      <div className="canteen-meals">
        {MEALS.map(([key,label])=><section className="canteen-meal" key={key}>
          <header><b>{label}</b><span>{TIMES[key]}</span></header>
          <div className="canteen-days">
            {menu.days.map(day=><div className={'canteen-day'+(day.index===today?' is-today':'')} key={day.index}>
              <b>{day.label} <small>{day.date}</small></b>
              <ul>{menu.meals[key].filter(x=>x.day===day.index).map(item=><li key={item.id} className={'canteen-dish-row'+(selected===item.id?' is-selected':'')}>
                <button type="button" onClick={()=>openItem(item)}>{item.name}</button>
                {item.price!==null&&<b>{item.price}元</b>}
                {item.photoCount>0&&<em title={`${item.photoCount} 张实拍`}>{item.photoCount}</em>}
              </li>)}</ul>
            </div>)}
          </div>
        </section>)}
      </div>
      {selected&&!detail?<div className="canteen-dish canteen-dish-loading">正在加载菜品实拍…</div>:null}
      {currentItem?<DishPanel item={{...currentItem,dayLabel:menu.days.find(d=>d.index===currentItem.day)?.label||''}} photos={currentPhotos} myRating={detail.myRating} onUpload={upload} onLike={like} onRate={rate} onThread={p=>{setThread(p);setThreadText('');}} onRemove={p=>{setRemoveError('');setRemoving(p);}} canAdmin={canAdmin} busy={detailBusy}/>:null}
      {thread&&<section className="canteen-thread"><header><b>{thread.by} 的实拍 · 留言</b><button type="button" className="text-button" onClick={()=>setThread(null)}>收起</button></header>
        {thread.comments?.length?thread.comments.map(c=><p key={c.id}><b>{c.by}</b> {c.content}</p>):<p className="canteen-thread-empty">还没有留言，说一句吧。</p>}
        <div className="canteen-thread-form"><input value={threadText} maxLength={200} placeholder="留一句吐槽或赞赏…" onChange={e=>setThreadText(e.target.value)}/><button type="button" className="secondary" disabled={!threadText.trim()} onClick={sendComment}>发送</button></div>
      </section>}
      <div className="canteen-rank">
        <b>红榜</b>
        {rank.red.length?rank.red.map(x=><span className="canteen-chip" key={x.id}>{x.name} <b>{x.avg.toFixed(1)}</b><em>{x.count} 人</em></span>):<span className="canteen-chip is-empty">还没有人打分</span>}
        <b className="is-black">黑榜</b>
        {rank.black.length?rank.black.map(x=><span className="canteen-chip" key={x.id}>{x.name} <b>{x.avg.toFixed(1)}</b><em>{x.count} 人</em></span>):<span className="canteen-chip is-empty">暂无</span>}
      </div>
    </>:null}
    {adminOpen&&<AdminMenuDialog Modal={Modal} api={api} menu={menu} onClose={()=>setAdminOpen(false)} onSaved={d=>{setMenu(d);setAdminOpen(false);setNotice('本周菜单已发布。');refreshCounts();}} onError={setError}/>}
    {removing&&<Modal title="删除实拍" onClose={()=>!removeBusy&&setRemoving(null)}>
      <p>删除后，同事将无法查看这张照片及其留言。</p>
      {removeError&&<p className="inline-error" role="alert">{removeError}</p>}
      <div className="dialog-actions"><button type="button" className="secondary" disabled={removeBusy} onClick={()=>setRemoving(null)}>取消</button><button type="button" className="primary" disabled={removeBusy} onClick={removePhoto}>{removeBusy?'删除中…':'确认删除'}</button></div>
    </Modal>}
  </section>;
}

function AdminMenuDialog({Modal,api,menu,onClose,onSaved,onError}){
  const initial=useMemo(()=>{
    const draft={};
    for(const [meal] of MEALS){draft[meal]=menu?.days?.map((day,i)=>(menu.meals[meal]||[]).filter(x=>x.day===i).map(x=>x.name+(x.price!==null?` ${x.price}`:'')).join('\n'))||['','','','',''];}
    return draft;
  },[menu]);
  const [draft,setDraft]=useState(initial),[saving,setSaving]=useState(false);
  const save=async()=>{
    setSaving(true);
    try{
      const items=[];
      for(const [meal] of MEALS)for(let day=0;day<5;day++){
        for(const line of (draft[meal][day]||'').split('\n')){
          const t=line.trim();if(!t)continue;
          const m=t.match(/^(.*?)(?:\s+(\d+(?:\.\d+)?))?$/);
          const name=(m?.[1]||t).trim(),price=m?.[2]?Number(m[2]):null;
          if(name)items.push({meal,day,name,price});
        }
      }
      const d=await api('/canteen/menu',{method:'PUT',body:{items}});
      onSaved(d);
    }catch(e){onError(e.message);}finally{setSaving(false);}
  };
  return <Modal title="上传本周菜单" onClose={onClose} className="canteen-admin-dialog">
    <p className="canteen-admin-tip">按「菜名 价格」逐行填写，价格可省略。发布后，登录同事可查看菜单、上传实拍和评分。</p>
    <div className="canteen-admin-grid">
      {MEALS.map(([meal,label])=><section key={meal}><h3>{label}</h3>
        {['周一','周二','周三','周四','周五'].map((day,i)=><label key={day}><span>{day}</span><textarea rows={4} value={draft[meal][i]} onChange={e=>setDraft(d=>({...d,[meal]:d[meal].map((v,idx)=>idx===i?e.target.value:v)}))}/></label>)}
      </section>)}
    </div>
    <div className="canteen-admin-actions"><button type="button" className="secondary" onClick={onClose} disabled={saving}>取消</button><button type="button" className="primary" onClick={save} disabled={saving}>{saving?'发布中…':'确认发布并同步'}</button></div>
  </Modal>;
}

const GAME_LIST=[
  {id:'poke',icon:'🐟',title:'戳鱼 30 秒',copy:'小鱼从水面冒头，点它得分，金色锦鲤值三分。',meta:'30 秒 · 反应'},
  {id:'memory',icon:'🫧',title:'摸鱼记忆',copy:'把成对的摸鱼表情翻出来，别记太久。',meta:'4 × 4 · 记忆'},
  {id:'catch',icon:'🧺',title:'接住小鱼',copy:'左右移动篮子接鱼，漏掉几条也没关系。',meta:'30 秒 · 反应'},
  {id:'breathe',icon:'🌙',title:'发呆一分钟',copy:'跟着圆点呼吸，什么都不用做。',meta:'60 秒 · 休息'}
];
const readBest=key=>{try{return Number(localStorage.getItem('momoyu-'+key+'-best')||0)}catch{return 0}};
const writeBest=(key,value)=>{try{localStorage.setItem('momoyu-'+key+'-best',String(value))}catch{}};
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

export function GamesBoard(){
  const [active,setActive]=useState(null);
  const [bests,setBests]=useState(()=>({poke:readBest('poke'),memory:readBest('memory'),catch:readBest('catch'),breathe:readBest('breathe')}));
  const onBest=(key,value)=>{
    setBests(b=>{const next={...b,[key]:key==='memory'?(b[key]?Math.min(b[key],value):value):Math.max(b[key]||0,value)};writeBest(key,next[key]);return next;});
  };
  const bestLabel=g=>{
    if(g.id==='memory')return bests.memory?`最佳 ${bests.memory} 步`:'开始 ↗';
    if(g.id==='poke')return `最高 ${bests.poke||0} 分`;
    if(g.id==='catch')return `最高 ${bests.catch||0} 条`;
    return '开始 ↗';
  };
  return <section className="canteen-board games-board" aria-label="真的摸鱼">
    <section className="games-pond">
      <div><span className="games-kicker">DON'T WORK, JUST FISH</span><h2>今天想怎么摸？</h2><p>戳鱼、翻牌、接小鱼，或者什么都不做一分钟。选一个，不用有负罪感。</p><button type="button" className="primary" onClick={()=>setActive('draw')}>摸鱼抽签 →</button></div>
      <span className="games-fish" aria-hidden="true"><svg viewBox="0 0 190 120"><path d="M18 62c28-40 66-40 100 0-34 40-72 40-100 0Z" fill="rgba(255,255,255,.9)" stroke="#0e3a32" strokeWidth="2.4" strokeLinejoin="round"/><path d="M118 62l26-22v44l-26-22Z" fill="#e8b86a" stroke="#0e3a32" strokeWidth="2.4" strokeLinejoin="round"/><circle cx="50" cy="56" r="4" fill="#0e3a32"/><path d="M76 40c8-9 18-9 24 0M74 86c8 8 18 8 24 0" fill="none" stroke="#0e3a32" strokeWidth="2.2" strokeLinecap="round"/></svg></span>
    </section>
    <div className="games-grid">{GAME_LIST.map(g=><button type="button" className="games-card" key={g.id} onClick={()=>setActive(g.id)}><span className="games-icon" aria-hidden="true">{g.icon}</span><h3>{g.title}</h3><p>{g.copy}</p><div><span>{g.meta}</span><b>{bestLabel(g)}</b></div></button>)}</div>
    <div className="games-bottom">
      <section><h3>摸鱼守则</h3><ol><li>不打扰同事，不带声音外放。</li><li>一局不超过五分钟，回来记得搭把手。</li><li>游戏只在这里，不进入工作对话和互助卡。</li></ol></section>
      <section className="games-note"><h3>记录</h3><p>最高分只保存在这台电脑的浏览器里，不上传、不参与考核，换台电脑就重新开始。</p></section>
    </div>
    {active&&<GameOverlay id={active} bests={bests} onBest={onBest} onClose={()=>setActive(null)}/>}
  </section>;
}

function GameOverlay({id,bests,onBest,onClose}){
  const meta={poke:['小游戏','戳鱼 30 秒'],memory:['小游戏','摸鱼记忆'],catch:['小游戏','接住小鱼'],breathe:['休息','发呆一分钟'],draw:['摸鱼签','今天怎么摸']}[id]||['小游戏','真的摸鱼'];
  return <div className="game-overlay" role="dialog" aria-modal="true" aria-label={meta[1]} onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="game-modal">
      <header className="game-modal-head"><div><span>{meta[0]}</span><h2>{meta[1]}</h2></div><button type="button" onClick={onClose} aria-label="关闭">×</button></header>
      {id==='poke'&&<PokeGame best={bests.poke||0} onBest={v=>onBest('poke',v)} onClose={onClose}/>}
      {id==='memory'&&<MemoryGame best={bests.memory||0} onBest={v=>onBest('memory',v)} onClose={onClose}/>}
      {id==='catch'&&<CatchGame best={bests.catch||0} onBest={v=>onBest('catch',v)} onClose={onClose}/>}
      {id==='breathe'&&<BreatheGame onBest={v=>onBest('breathe',v)} onClose={onClose}/>}
      {id==='draw'&&<DrawGame onClose={onClose}/>}
    </div>
  </div>;
}

function GameResult({kicker,value,text,onAgain,onClose}){
  return <div className="game-result"><span>{kicker}</span><strong>{value}</strong><p>{text}</p><div className="game-result-actions"><button type="button" className="primary" onClick={onAgain}>再来一局</button><button type="button" className="secondary" onClick={onClose}>收工</button></div></div>;
}

function PokeGame({best,onBest,onClose}){
  const [phase,setPhase]=useState('ready'),[score,setScore]=useState(0),[time,setTime]=useState(30),[fish,setFish]=useState([]);
  const scoreRef=useRef(0);
  useEffect(()=>{scoreRef.current=score},[score]);
  useEffect(()=>{if(phase!=='playing')return;const t=setInterval(()=>setTime(v=>v-1),1000);return()=>clearInterval(t)},[phase]);
  useEffect(()=>{if(phase==='playing'&&time<=0){setPhase('done');setFish([]);onBest(scoreRef.current);}},[time,phase]);
  useEffect(()=>{if(phase!=='playing')return;const spawn=setInterval(()=>{const id=Math.random().toString(36).slice(2),golden=Math.random()<.12;setFish(f=>[...f,{id,x:8+Math.random()*78,y:12+Math.random()*70,golden}]);setTimeout(()=>setFish(f=>f.filter(x=>x.id!==id)),1100+Math.random()*500);},620);return()=>clearInterval(spawn)},[phase]);
  const restart=()=>{setScore(0);setTime(30);setFish([]);setPhase('playing')};
  return <>
    <div className="game-hud"><div><span>得分</span><b>{score}</b></div><div><span>时间</span><b>{Math.max(0,time)}</b></div><div><span>最高</span><b>{best}</b></div></div>
    {phase==='ready'&&<div className="game-start"><h3>戳鱼 30 秒</h3><p>点击冒头的小鱼。金色锦鲤 +3，普通小鱼 +1。别追太久，它们会缩回去。</p><button type="button" className="primary" onClick={restart}>开始</button></div>}
    {phase==='playing'&&<div className="poke-area">{fish.map(f=><button key={f.id} type="button" className={'poke-fish'+(f.golden?' is-golden':'')} style={{left:f.x+'%',top:f.y+'%'}} aria-label={f.golden?'金色锦鲤':'小鱼'} onClick={()=>{setFish(l=>l.filter(x=>x.id!==f.id));setScore(s=>s+(f.golden?3:1));}}>{f.golden?'🐠':'🐟'}</button>)}</div>}
    {phase==='done'&&<GameResult kicker="本轮结束" value={score} text={`条小鱼。最高 ${Math.max(best,score)} 分。手速不错，回来记得搭把手。`} onAgain={restart} onClose={onClose}/>}
  </>;
}

function MemoryGame({best,onBest,onClose}){
  const emojis=['🐟','🫧','☕','🌿','🐠','🍜','🎧','🌙'];
  const makeDeck=()=>shuffle([...emojis,...emojis]).map((emoji,id)=>({id,emoji,flipped:false,matched:false}));
  const [deck,setDeck]=useState(makeDeck),[first,setFirst]=useState(null),[lock,setLock]=useState(false),[moves,setMoves]=useState(0),[seconds,setSeconds]=useState(0),[done,setDone]=useState(false);
  useEffect(()=>{if(done)return;const t=setInterval(()=>setSeconds(s=>s+1),1000);return()=>clearInterval(t)},[done]);
  useEffect(()=>{if(!done&&deck.every(c=>c.matched)){setDone(true);onBest(moves);}},[deck,done]);
  const flip=idx=>{
    if(lock||done)return;
    const card=deck[idx];if(card.flipped||card.matched)return;
    setDeck(d=>d.map((c,i)=>i===idx?{...c,flipped:true}:c));
    if(first===null){setFirst(idx);return;}
    setMoves(m=>m+1);
    if(deck[first].emoji===card.emoji){
      setDeck(d=>d.map((c,i)=>i===first||i===idx?{...c,matched:true,flipped:true}:c));
      setFirst(null);
    }else{
      setLock(true);const a=first;
      setTimeout(()=>{setDeck(d=>d.map((c,i)=>i===a||i===idx?{...c,flipped:false}:c));setFirst(null);setLock(false);},650);
    }
  };
  const restart=()=>{setDeck(makeDeck());setFirst(null);setLock(false);setMoves(0);setSeconds(0);setDone(false)};
  return <>
    <div className="game-hud"><div><span>步数</span><b>{moves}</b></div><div><span>时间</span><b>{seconds}</b></div><div><span>最佳</span><b>{best||'—'}</b></div></div>
    {!done?<div className="mem-grid">{deck.map((c,i)=><button key={c.id} type="button" className={'mem-card'+(c.flipped||c.matched?' is-flipped':'')+(c.matched?' is-matched':'')} onClick={()=>flip(i)} aria-label={c.flipped||c.matched?c.emoji:'未翻开的卡片'}><span className="mem-inner"><span className="mem-face mem-back">〰</span><span className="mem-face mem-front">{c.emoji}</span></span></button>)}</div>
    :<GameResult kicker="全部找到" value={moves} text={`步 · ${seconds} 秒。最佳 ${best?Math.min(best,moves):moves} 步。脑子还在，放心。`} onAgain={restart} onClose={onClose}/>}
  </>;
}

function CatchGame({best,onBest,onClose}){
  const [phase,setPhase]=useState('ready'),[score,setScore]=useState(0),[time,setTime]=useState(30),[basket,setBasket]=useState(50);
  const fishRef=useRef([]),basketRef=useRef(50),scoreRef=useRef(0),[,force]=useState(0);
  useEffect(()=>{if(phase!=='playing')return;const t=setInterval(()=>setTime(v=>v-1),1000);return()=>clearInterval(t)},[phase]);
  useEffect(()=>{if(phase==='playing'&&time<=0){setPhase('done');fishRef.current=[];onBest(scoreRef.current);}},[time,phase]);
  useEffect(()=>{if(phase!=='playing')return;const s=setInterval(()=>{fishRef.current.push({id:Math.random().toString(36).slice(2),x:8+Math.random()*84,y:-6,speed:42+Math.random()*34,golden:Math.random()<.15});},560);return()=>clearInterval(s)},[phase]);
  useEffect(()=>{
    if(phase!=='playing')return;let raf,last=performance.now();
    const loop=now=>{
      const dt=Math.min(50,now-last)/1000;last=now;
      fishRef.current=fishRef.current.filter(f=>{
        f.y+=f.speed*dt;
        if(f.y>84&&f.y<94&&Math.abs(f.x-basketRef.current)<9){scoreRef.current+=f.golden?2:1;setScore(scoreRef.current);return false;}
        return f.y<104;
      });
      force(n=>n+1);raf=requestAnimationFrame(loop);
    };
    raf=requestAnimationFrame(loop);return()=>cancelAnimationFrame(raf);
  },[phase]);
  useEffect(()=>{
    if(phase!=='playing')return;
    const key=e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();const next=Math.max(6,Math.min(94,basketRef.current+(e.key==='ArrowLeft'?-5:5)));basketRef.current=next;setBasket(next);};
    document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
  },[phase]);
  const move=e=>{const r=e.currentTarget.getBoundingClientRect();const next=Math.max(6,Math.min(94,(e.clientX-r.left)/r.width*100));basketRef.current=next;setBasket(next);};
  const restart=()=>{fishRef.current=[];scoreRef.current=0;setScore(0);setTime(30);setPhase('playing')};
  return <>
    <div className="game-hud"><div><span>接住</span><b>{score}</b></div><div><span>时间</span><b>{Math.max(0,time)}</b></div><div><span>最高</span><b>{best}</b></div></div>
    {phase==='ready'&&<div className="game-start"><h3>接住小鱼</h3><p>左右移动鼠标或按 ← → 移动篮子。接住掉下来的小鱼，漏掉也没关系。</p><button type="button" className="primary" onClick={restart}>开始</button></div>}
    {phase==='playing'&&<div className="catch-area" onMouseMove={move}>{fishRef.current.map(f=><span key={f.id} className={'catch-fish'+(f.golden?' is-golden':'')} style={{left:f.x+'%',top:f.y+'%'}}>{f.golden?'🐠':'🐟'}</span>)}<span className="catch-basket" style={{left:basket+'%'}}>🧺</span></div>}
    {phase==='done'&&<GameResult kicker="本轮结束" value={score} text={`条小鱼。最高 ${Math.max(best,score)} 条。今天的手很稳。`} onAgain={restart} onClose={onClose}/>}
  </>;
}

function BreatheGame({onBest,onClose}){
  const [phase,setPhase]=useState('ready'),[time,setTime]=useState(60);
  useEffect(()=>{if(phase!=='playing')return;const t=setInterval(()=>setTime(v=>v-1),1000);return()=>clearInterval(t)},[phase]);
  useEffect(()=>{if(phase==='playing'&&time<=0){setPhase('done');onBest(1);}},[time,phase]);
  const restart=()=>{setTime(60);setPhase('playing')};
  return <>
    <div className="game-hud"><div><span>状态</span><b>{phase==='playing'?'休息中':phase==='done'?'完成':'准备'}</b></div><div><span>剩余</span><b>{Math.max(0,time)}</b></div><div><span>完成</span><b>{phase==='done'?'1':'—'}</b></div></div>
    {phase==='ready'&&<div className="game-start"><div className="breathe-circle"/><h3>跟着圆点，慢慢呼吸</h3><p>吸气的时候看它变大，呼气的时候看它变小。什么都不用做，一分钟就好。</p><button type="button" className="primary" onClick={restart}>开始 60 秒</button></div>}
    {phase==='playing'&&<div className="breathe-wrap"><div className="breathe-circle is-live"/><h3>跟着圆点，慢慢呼吸</h3><p>吸气的时候看它变大，呼气的时候看它变小。<br/>什么都不用做，一分钟就好。</p></div>}
    {phase==='done'&&<GameResult kicker="完成" value={60} text="秒。你刚刚认真休息了一分钟。现在，回到工作里也没关系。" onAgain={restart} onClose={onClose}/>}
  </>;
}

function DrawGame({onClose}){
  const ideas=['去接一杯水，顺便看看窗外','站起来走两分钟，回来再决定','把待办里最小的一件划掉','给桌上的植物浇点水','闭眼听一首歌，什么都不想','去摸鱼空间发一条今天的随手拍','把椅子往后推，伸个懒腰','允许自己再发五分钟呆'];
  const [idea,setIdea]=useState(()=>ideas[Math.floor(Math.random()*ideas.length)]);
  return <div className="draw-card"><span>今日摸鱼签</span><h3>{idea}</h3><p>不用做更多。抽到哪件，就做哪件。</p><div className="game-result-actions"><button type="button" className="primary" onClick={()=>setIdea(ideas[Math.floor(Math.random()*ideas.length)])}>再抽一次</button><button type="button" className="secondary" onClick={onClose}>收工</button></div></div>;
}
