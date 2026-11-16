import React,{useEffect,useId,useState} from 'react';
import {coverUrl,themeOf} from './BoardCards.jsx';
import './DemandDetail.css';

export const detailLayoutOptions=[['auto','自动（按需求选择）'],['dossier','分栏档案'],['pinboard','便笺拼贴'],['chat','对话式']];
const layoutIds=['dossier','pinboard','chat'];
const statusLabels={draft:'草稿',open:'待接取',claimed:'进行中',submitted:'待验收',changes_requested:'需要修改',completed:'已完成',cancelled:'已取消'};
const statusLabel=request=>request.deletedAt?'已移除':statusLabels[request.status]||request.status||'';
const sourceLabel=request=>request.source==='official'?'官方发布':'员工互助';

const textOf=value=>Array.isArray(value)?value.filter(Boolean).join('\n'):(value||'');
const listOf=value=>Array.isArray(value)
 ? value.map(item=>typeof item==='string'?item:(item?.name||item?.title||'')).filter(Boolean)
 : (value?String(value).split(/[,，\n]/).map(item=>item.trim()).filter(Boolean):[]);

function stableHash(value){
 let hash=2166136261;
 const text=String(value??'');
 for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
 return hash>>>0;
}

export function resolveDemandLayout(request={}){
 if(layoutIds.includes(request.detailLayout))return request.detailLayout;
 const bodyLength=['problem','desiredOutcome','deliverables','acceptanceCriteria'].reduce((total,key)=>total+textOf(request[key]).length,0);
 if(request.source==='official'||request.kind==='announcement'||listOf(request.materials).length>0||request.materialFileCount>0||bodyLength>150)return 'dossier';
 return layoutIds[stableHash(request.id)%layoutIds.length];
}

const fmt=value=>{
 if(!value)return '时间待商量';
 const date=new Date(value);
 return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'short',day:'numeric'}).format(date);
};
const pointsOf=request=>Number.isInteger(request.rewardPoints)?request.rewardPoints:null;
const difficultyOf=request=>request.difficulty?.status==='scored'&&Number.isInteger(request.difficulty.score)?request.difficulty.score:null;
const ownerName=request=>request.anonymous?'匿名同事':request.owner?.displayName||(request.source==='official'?'官方':'同事');
const ownerDepartment=request=>request.anonymous?'':request.owner?.department||'';
const ownerInitial=request=>request.anonymous?'匿':(ownerName(request)||'同').slice(0,1);
const rewardImage=request=>request.rewardImage?.url||request.rewardUrl||'';
const rewardText=request=>request.rewardText||'';

function Meter({score}){
 return <span className="dd-meter" aria-hidden="true">{Array.from({length:5},(_,i)=><i key={i} className={i<score?'on':''}/>)}</span>;
}
function Difficulty({request}){
 if(request.kind==='announcement')return null;
 const score=difficultyOf(request);
 return <span className="dd-difficulty" aria-label={score?`难度 ${score}/5`:'难度待评估'}>难度{score?<><Meter score={score}/>{score}/5</>:request.difficulty?.status==='pending'?'评估中':'待评估'}</span>;
}
function Views({request}){return <span className="dd-views">{request.viewCount||0} 人看过</span>;}
function Chips({items}){return <div className="dd-chips">{items.length?items.map(item=><span className="dd-chip" key={item}>{item}</span>):<span className="dd-muted">待补充</span>}</div>;}
function Cover({request,children}){
 const image=coverUrl(request),theme=themeOf(request);
 return <div className={'dd-cover'+(image?'':' is-empty tone-'+theme)} style={image?{backgroundImage:`url("${image}")`}:undefined}>
  {!image&&<span className="dd-cover-mark" aria-hidden="true">⌁</span>}
  {children}
 </div>;
}
function RewardNote({request}){
 const text=rewardText(request),image=rewardImage(request);
 if(!text&&!image)return null;
 return <div className="dd-note"><div className="dd-label">发布人报酬</div>{text&&<p>{text}</p>}{image&&<img className="dd-reward-image" src={image} alt="发布人提供的报酬图片" loading="lazy"/>}</div>;
}
function MaterialNote({request}){
 const materials=listOf(request.materials),count=request.materialFileCount||0;
 if(!materials.length&&!count)return null;
 return <div className="dd-note"><div className="dd-label">已有材料</div>{materials.length>0&&<ul>{materials.map((item,i)=><li key={i}>{item}</li>)}</ul>}{count>0&&<p className="dd-note-hint">{count} 个附件，接取后可下载原件。</p>}</div>;
}
function Fact({label,children}){return <div className="dd-fact"><div className="dd-label">{label}</div>{children}</div>;}
function AskButton({onAsk,className='dd-ask',children='先问问'}){
 if(!onAsk)return null;
 return <button type="button" className={className} onClick={onAsk}>{children}</button>;
}

function Dossier({request,onAsk}){
 const deliverables=listOf(request.deliverables),acceptance=listOf(request.acceptanceCriteria),skills=listOf(request.skills),constraints=listOf(request.constraints);
 const problem=request.problem||'',desired=request.desiredOutcome||'',points=pointsOf(request);
 const hasFacts=deliverables.length>0||acceptance.length>0||skills.length>0||!!request.deadline;
 return <div className="dd-layout dd-dossier">
  <aside className="dd-dossier-side">
   <Cover request={request}>
    {request.deadline&&<span className="dd-cover-deadline">{fmt(request.deadline)}</span>}
    {points!==null&&request.kind!=='announcement'&&<span className="dd-cover-sticker"><b>{points}</b><span>验收积分</span></span>}
    {request.kind!=='announcement'&&<span className="dd-cover-diff"><Difficulty request={request}/></span>}
   </Cover>
   <div className="dd-person"><span className="dd-avatar">{ownerInitial(request)}</span><div className="dd-who"><strong>{ownerName(request)}</strong><span>{[ownerDepartment(request),fmt(request.createdAt)].filter(Boolean).join(' · ')}</span></div></div>
   <RewardNote request={request}/>
   <MaterialNote request={request}/>
  </aside>
  <div className="dd-dossier-main">
   <div className="dd-kicker-row"><span className="dd-kicker">{sourceLabel(request)} · {statusLabel(request)}</span><div className="dd-kicker-actions"><AskButton onAsk={onAsk}/></div></div>
   <h1 className="dd-title">{request.title||'需求详情'}</h1>
   {problem&&<div className="dd-summary-block"><div className="dd-label">遇到的困扰</div><p className="dd-summary">{problem}</p></div>}
   {hasFacts&&<div className="dd-facts">
    {deliverables.length>0&&<Fact label="交付物"><p>{deliverables.join('；')}</p></Fact>}
    {acceptance.length>0&&<Fact label="完成标准"><p>{acceptance.join('；')}</p></Fact>}
    {skills.length>0&&<Fact label="所需技能"><Chips items={skills}/></Fact>}
    {request.deadline&&<Fact label="截止时间"><p>{fmt(request.deadline)}</p></Fact>}
   </div>}
   {(desired||constraints.length>0)&&<div className="dd-story">
    {desired&&<div className="dd-story-card goal"><div className="dd-label">希望达成</div><p>{desired}</p></div>}
    {constraints.length>0&&<div className="dd-story-card constraints"><div className="dd-label">限制条件</div><p>{constraints.join('；')}</p></div>}
   </div>}
   <div className="dd-footline"><span>{request.viewCount||0} 人看过</span><span>{fmt(request.createdAt)} 发布</span>{request.materialFileCount>0&&<span>{request.materialFileCount} 个附件</span>}</div>
  </div>
 </div>;
}

function Pinboard({request,onAsk}){
 const deliverables=listOf(request.deliverables),acceptance=listOf(request.acceptanceCriteria),materials=listOf(request.materials),skills=listOf(request.skills),constraints=listOf(request.constraints);
 const problem=request.problem||'',desired=request.desiredOutcome||'',points=pointsOf(request);
 return <div className="dd-layout dd-pinboard">
  <article className="dd-note-main">
   <span className="dd-tape" aria-hidden="true"/>
   <div className="dd-kicker-row"><span className="dd-kicker">{sourceLabel(request)} · {statusLabel(request)}</span></div>
   <h1 className="dd-note-title">{request.title||'需求详情'}</h1>
   {problem&&<p className="dd-note-summary">{problem}</p>}
   {(desired||constraints.length>0)&&<div className="dd-note-story">
    {desired&&<div><div className="dd-label">希望达成</div><p>{desired}</p></div>}
    {constraints.length>0&&<div><div className="dd-label">限制条件</div><p>{constraints.join('；')}</p></div>}
   </div>}
   <div className="dd-note-foot"><span className="dd-avatar">{ownerInitial(request)}</span><div className="dd-who"><strong>{ownerName(request)}</strong><span>{[ownerDepartment(request),fmt(request.createdAt)].filter(Boolean).join(' · ')}</span></div><div className="dd-chips">{skills.slice(0,3).map(skill=><span className="dd-chip" key={skill}>{skill}</span>)}</div></div>
  </article>
  <aside className="dd-pin-side">
   {deliverables.length>0&&<section className="dd-side-note deliver"><div className="dd-label">交付物</div><h3>做完要给我什么</h3><ul>{deliverables.map((item,i)=><li key={i}>{item}</li>)}</ul></section>}
   {acceptance.length>0&&<section className="dd-side-note accept"><div className="dd-label">完成标准</div><h3>怎样算做好</h3><ul>{acceptance.map((item,i)=><li key={i}>{item}</li>)}</ul></section>}
   {materials.length>0&&<section className="dd-side-note materials"><div className="dd-label">已有材料</div><h3>可以先看</h3><ul>{materials.map((item,i)=><li key={i}>{item}</li>)}</ul>{request.materialFileCount>0&&<p>{request.materialFileCount} 个附件，接取后可下载原件。</p>}</section>}
   {rewardText(request)&&<section className="dd-side-note reward"><div className="dd-label">发布人报酬</div><p>{rewardText(request)}</p></section>}
   {request.kind!=='announcement'&&<div className="dd-ticket"><div><div className="dd-label">验收积分</div><div className="dd-ticket-num">{points??'—'}</div></div><Difficulty request={request}/></div>}
   <div className="dd-pin-foot"><Views request={request}/><span>{fmt(request.deadline)}</span></div>
   <AskButton onAsk={onAsk} className="dd-ask-wide" children="先问问发布者"/>
  </aside>
 </div>;
}

function Chat({request,onAsk}){
 const deliverables=listOf(request.deliverables),acceptance=listOf(request.acceptanceCriteria),materials=listOf(request.materials),skills=listOf(request.skills),constraints=listOf(request.constraints);
 const problem=request.problem||'',desired=request.desiredOutcome||'',points=pointsOf(request);
 const bubbles=[
  problem&&{label:'想请你帮忙',body:problem},
  desired&&{label:'希望达成',body:desired},
  deliverables.length>0&&{label:'交付物',list:deliverables},
  acceptance.length>0&&{label:'完成标准',list:acceptance},
  constraints.length>0&&{label:'限制条件',list:constraints}
 ].filter(Boolean);
 return <div className="dd-layout dd-chat">
  <section className="dd-chat-card">
   <div className="dd-chat-top"><span className="dd-avatar">{ownerInitial(request)}</span><div className="dd-who"><strong>{ownerName(request)}</strong><span>{[ownerDepartment(request),fmt(request.createdAt)].filter(Boolean).join(' · ')}</span></div>{request.deadline&&<span className="dd-pill">{fmt(request.deadline)}</span>}</div>
   <div className="dd-chat-thread">
    {bubbles.length?bubbles.map((bubble,i)=><div className="dd-msg" key={i}><div className="dd-name">{ownerName(request)}</div><div className="dd-bubble"><div className="dd-label">{bubble.label}</div>{bubble.body&&<p>{bubble.body}</p>}{bubble.list&&<ul>{bubble.list.map((item,n)=><li key={n}>{item}</li>)}</ul>}{bubble.label==='想请你帮忙'&&(materials.length>0||request.materialFileCount>0)&&<div className="dd-attach"><span className="dd-paper" aria-hidden="true">↧</span><span><b>{materials.length?`${materials.length} 项材料`:'需求附件'}</b><br/>{request.materialFileCount>0?`${request.materialFileCount} 个附件，接取后可下载原件`:'接取后与发布者确认'}</span></div>}</div></div>):<p className="dd-muted">发布者还没有补充正文。</p>}
   </div>
   <div className="dd-composer">{onAsk?<><span>先问一句…</span><button type="button" className="dd-send" onClick={onAsk} aria-label="转到提问与留言">↑</button></>:<span>{request.kind==='announcement'?'官方发布':'可在「提问与留言」中联系发布者。'}</span>}</div>
  </section>
  <aside className="dd-rail">
   <section className="dd-rail-card"><h3>这件事</h3>{request.kind!=='announcement'&&<div className="dd-points-row"><div><div className="dd-label">验收积分</div><div className="dd-points-num">{points??'—'}</div></div><Difficulty request={request}/></div>}{skills.length>0&&<Chips items={skills}/>}</section>
   <section className="dd-rail-card"><h3>时间与材料</h3><div className="dd-rail-line"><span>截止</span><b>{fmt(request.deadline)}</b></div><div className="dd-rail-line"><span>材料</span><b>{materials.length?`${materials.length} 项`:'暂无'}</b></div><div className="dd-rail-line"><span>浏览</span><b>{request.viewCount||0} 人看过</b></div><div className="dd-owner-mini"><span className="dd-avatar">{ownerInitial(request)}</span><div className="dd-who"><strong>{ownerName(request)}</strong><span>{ownerDepartment(request)||sourceLabel(request)}</span></div></div></section>
   <AskButton onAsk={onAsk} className="dd-ask-wide" children="先问问发布者"/>
  </aside>
 </div>;
}

export function DemandDetailBrief({request,onAsk}){
 if(!request)return null;
 const layout=resolveDemandLayout(request),ask=request.isMine?undefined:onAsk;
 return <div className={'dd-brief dd-brief-'+layout} data-layout={layout}>
  {layout==='pinboard'?<Pinboard request={request} onAsk={ask}/>:layout==='chat'?<Chat request={request} onAsk={ask}/>:<Dossier request={request} onAsk={ask}/>}
 </div>;
}

async function call(path,body){
 const response=await fetch('/api'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error?.message||'操作失败，请重试');
 return data;
}
const stamp=value=>{
 if(!value)return '';
 const date=new Date(value);
 return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);
};
const authorOf=item=>{const author=item?.author||item?.question?.author;return typeof author==='string'?{displayName:author}:(author||item||{});};
const authorName=item=>item?.askerLabel||authorOf(item)?.authorLabel||authorOf(item)?.displayName||authorOf(item)?.authorName||(authorOf(item)?.anonymous?'匿名同事':'同事');
const isMine=(item,user)=>item?.isMine===true||item?.mine===true||(!!user&&(authorOf(item)?.id===user.id||item?.authorId===user.id||item?.ownerId===user.id));
const canRemove=(item,user)=>item?.canRemove===true||isMine(item,user);
const threadText=thread=>thread?.content||(typeof thread?.question==='string'?thread.question:thread?.question?.content)||thread?.title||thread?.body||threadMessages(thread).slice(-1)[0]?.content||'';
const threadMessages=thread=>thread?.messages||thread?.replies||[];
const messageText=message=>message?.content||message?.body||'';

export function DemandInteractions({request,user,onChanged}){
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [text,setText]=useState(''),[visibility,setVisibility]=useState('private'),[replies,setReplies]=useState({}),[removing,setRemoving]=useState(''),[openThreads,setOpenThreads]=useState({});
 const fieldId=useId();
 const apply=result=>setData({views:result.views||0,comments:result.comments||[],threads:result.threads||[]});
 useEffect(()=>{
  let live=true;
  setLoading(true);setError('');
  call('/requests/'+request.id+'/interactions').then(result=>{if(live)apply(result);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[request.id,request.status]);
 async function refresh(){apply(await call('/requests/'+request.id+'/interactions'));}
 async function act(action){
  setBusy(true);setError('');
  try{await action();await refresh();onChanged?.();}
  catch(e){setError(e.message);}
  finally{setBusy(false);}
 }
 const submitQuestion=event=>{
  event.preventDefault();
  const content=text.trim();
  if(!content||busy)return;
  act(async()=>{await call('/requests/'+request.id+'/questions',{content,visibility});setText('');});
 };
 const reply=threadId=>{
  const content=(replies[threadId]||'').trim();
  if(!content||busy)return;
  act(async()=>{await call('/interactions/threads/'+threadId+'/messages',{content});setReplies(current=>({...current,[threadId]:''}));});
 };
 const removeComment=commentId=>{
  if(removing!==commentId){setRemoving(commentId);return;}
  act(async()=>{await call('/interactions/comments/'+commentId+'/remove',{confirmed:true});setRemoving('');});
 };
 if(request.kind==='announcement')return null;
 const threads=data?.threads||[];
 const comments=data?.comments||[];
 const canAsk=!request.isMine&&!!user;
 return <section className="dd-interactions">
  {error&&<p className="inline-error" role="alert">{error} <button type="button" className="text-button" onClick={()=>{setError('');setLoading(true);refresh().catch(e=>setError(e.message)).finally(()=>setLoading(false));}}>重试</button></p>}
  {loading&&!data?<p className="dd-status" role="status">正在加载提问与留言…</p>:!data?null:<>
   {!user&&!request.isMine&&<p className="dd-status">登录后可以私聊提问或公开留言。</p>}
   {canAsk&&<form className="dd-ask-box" onSubmit={submitQuestion}>
    <div className="dd-visibility" role="group" aria-label="留言方式">
     <button type="button" aria-pressed={visibility==='private'} onClick={()=>setVisibility('private')}>私聊提问</button>
     <button type="button" aria-pressed={visibility==='public'} onClick={()=>setVisibility('public')}>公开留言</button>
    </div>
    <label className="dd-sr-only" htmlFor={fieldId}>提问内容</label>
    <textarea id={fieldId} rows="3" maxLength={500} value={text} onChange={e=>setText(e.target.value)} placeholder={visibility==='private'?'只有你和发布者能看到…':'会显示在需求详情，并通知发布者…'}/>
    <div className="dd-ask-foot"><p className="dd-interactions-note">{visibility==='private'?'私聊只有双方可见。':'公开留言会出现在详情，并通知发布者。'}站内消息会收到提醒。{user?.muted&&' 账号已禁言，暂不能发送。'}</p><button className="primary" disabled={busy||!text.trim()||user?.muted}>{busy?'发送中…':visibility==='private'?'发送私聊提问':'发布留言'}</button></div>
   </form>}
   <section className="dd-interactions-section">
    <h3>提问与私聊{threads.length?` · ${threads.length}`:''}</h3>
    {threads.length?threads.map(thread=>{
     const messages=threadMessages(thread),mine=messages.some(message=>isMine(message,user));
     return <details className="dd-thread" key={thread.id} open={openThreads[thread.id]??threads.length===1} onToggle={e=>{const open=e.currentTarget.open;setOpenThreads(current=>current[thread.id]===open?current:{...current,[thread.id]:open});}}>
      <summary><span className="dd-thread-badge">私聊</span><span className="dd-thread-text">{threadText(thread)||'私聊提问'}</span><span className="dd-thread-author">{authorName(thread)}{mine?' · 你':''}</span><span className="dd-thread-count">{messages.length} 条</span></summary>
      <div className="dd-thread-body">
       {messages.length?messages.map(message=><div className={'dd-message'+(isMine(message,user)?' is-mine':'')} key={message.id||`${message.createdAt}-${messageText(message)}`}><div className="dd-message-head"><strong>{authorName(message)}</strong><span>{stamp(message.createdAt)}</span></div><p>{messageText(message)}</p></div>):<p className="dd-muted">还没有回复。</p>}
       <form className="dd-reply" onSubmit={e=>{e.preventDefault();reply(thread.id);}}>
        <label className="dd-sr-only" htmlFor={fieldId+'-reply-'+thread.id}>回复私聊</label>
        <textarea id={fieldId+'-reply-'+thread.id} rows="2" maxLength={500} value={replies[thread.id]||''} onChange={e=>setReplies(current=>({...current,[thread.id]:e.target.value}))} placeholder="回复这条私聊…"/>
        <button className="secondary" disabled={busy||!(replies[thread.id]||'').trim()}>发送回复</button>
       </form>
      </div>
     </details>;
    }):<p className="dd-muted">还没有私聊提问。</p>}
   </section>
   <section className="dd-interactions-section">
    <h3>公开留言{comments.length?` · ${comments.length}`:''}</h3>
    {comments.length?comments.map(comment=><article className="dd-comment" key={comment.id}><div className="dd-comment-head"><strong>{authorName(comment)}</strong><span>{stamp(comment.createdAt)}</span>{canRemove(comment,user)&&<span className="dd-comment-actions">{removing===comment.id&&<button type="button" className="text-button" onClick={()=>setRemoving('')}>取消</button>}<button type="button" className="text-button" disabled={busy} onClick={()=>removeComment(comment.id)}>{removing===comment.id?'确认删除':'删除'}</button></span>}</div><p>{comment.content}</p></article>):<p className="dd-muted">还没有公开留言。</p>}
   </section>
  </>}
 </section>;
}
