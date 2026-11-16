import React,{useEffect,useRef,useState} from 'react';
import {TASK_LIMITS} from '../../shared/task-limits.mjs';
import {InboxChat} from './InboxChat.jsx';
import {InboxFeedback} from './InboxFeedback.jsx';

const labels={open:'待接取',claimed:'已被接取',submitted:'待验收',changes_requested:'修改中',completed:'已完成',cancelled:'已取消',unavailable:'已失效'};
const CHAT_NOTIFICATION_TYPES=new Set(['question','reply']);
const notificationStatus=n=>{
  if(n.type==='question')return n.readAt?'待回复':'新提问';
  if(n.type==='reply')return '新回复';
  if(n.type==='comment')return n.readAt?'留言':'新留言';
  return labels[n.status]||n.status||'';
};

export function Inbox({api,user,onOpen,onUnread}){
  const admin=['admin','primary_admin'].includes(user?.role);
  const [tab,setTab]=useState('recommendations');
  const [items,setItems]=useState([]),[cursor,setCursor]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [notifUnread,setNotifUnread]=useState(null);
  const [threads,setThreads]=useState([]),[threadsLoading,setThreadsLoading]=useState(false),[threadsError,setThreadsError]=useState(''),[threadsLoaded,setThreadsLoaded]=useState(false);
  const [selectedId,setSelectedId]=useState(null);
  const [hint,setHint]=useState('');
  const [feedbackItems,setFeedbackItems]=useState([]),[feedbackUnread,setFeedbackUnread]=useState(0),[feedbackLoading,setFeedbackLoading]=useState(false),[feedbackError,setFeedbackError]=useState(''),[feedbackFocus,setFeedbackFocus]=useState(null);
  const tabsRef=useRef(null);
  const threadsRequest=useRef(null),threadsLoadedRef=useRef(false),threadsMutation=useRef(0);

  const scrollToInboxTop=()=>requestAnimationFrame(()=>{const el=tabsRef.current;if(!el)return;const top=el.getBoundingClientRect().top;if(top<0||top>window.innerHeight*0.45)el.scrollIntoView({behavior:'smooth',block:'start'});});

  async function loadFeedback(){
    setFeedbackLoading(true);setFeedbackError('');
    try{const r=await api('/feedback');setFeedbackItems(Array.isArray(r.items)?r.items:[]);setFeedbackUnread(Number(r.unread)||0);return r;}
    catch(e){setFeedbackError(e.message);return null;}
    finally{setFeedbackLoading(false);}
  }

  async function load(more=false){
    setLoading(true);setError('');
    try{const r=await api('/notifications'+(more&&cursor?'?cursor='+cursor:''));setItems(old=>more?[...old,...r.items.filter(n=>!old.some(i=>i.id===n.id))]:r.items);setCursor(r.nextCursor);setNotifUnread(r.unread);}catch(e){setError(e.message);}finally{setLoading(false);}
  }

  function loadThreads(){
    if(threadsRequest.current)return threadsRequest.current;
    setThreadsLoading(true);setThreadsError('');
    const version=threadsMutation.current;
    const request=api('/interactions/threads').then(r=>{
      const list=Array.isArray(r.items)?r.items:[];
      if(version===threadsMutation.current)setThreads(list);
      setThreadsLoaded(true);threadsLoadedRef.current=true;
      return list;
    }).catch(e=>{
      if(!threadsLoadedRef.current)setThreadsError(e.message);
      return null;
    }).finally(()=>{
      threadsRequest.current=null;setThreadsLoading(false);
    });
    threadsRequest.current=request;
    return request;
  }

  useEffect(()=>{load();loadThreads();loadFeedback();let active=true;const refresh=async()=>{if(document.visibilityState!=='visible')return;try{const r=await api('/notifications');if(!active)return;setItems(old=>[...r.items,...old.filter(i=>!r.items.some(n=>n.id===i.id))]);setCursor(old=>old??r.nextCursor);setNotifUnread(r.unread);}catch{}if(threadsLoadedRef.current)loadThreads();loadFeedback();};const timer=setInterval(refresh,15000);return()=>{active=false;clearInterval(timer);};},[]);

  useEffect(()=>{if(tab==='chat'&&!threadsLoadedRef.current&&!threadsRequest.current)loadThreads();},[tab]);
  useEffect(()=>{if(tab==='feedback')loadFeedback();},[tab]);

  const threadUnread=threads.reduce((sum,t)=>sum+(Number(t.unread)||0),0);
  const threadIds=new Set(threads.map(t=>t.id)),threadRequestIds=new Set(threads.map(t=>t.requestId));
  const unlinkedNotificationUnread=items.reduce((sum,n)=>{
    if(n.readAt)return sum;
    if(!CHAT_NOTIFICATION_TYPES.has(n.type))return sum+1;
    return threadIds.has(n.threadId)||threadRequestIds.has(n.requestId)?sum:sum+1;
  },0);
  useEffect(()=>{
    if(notifUnread===null)return;
    onUnread(threadsLoaded?unlinkedNotificationUnread+threadUnread:notifUnread);
  },[notifUnread,threadsLoaded,unlinkedNotificationUnread,threadUnread,onUnread]);

  const open=async n=>{
    setHint('');
    try{
      await api('/notifications/'+n.id+'/read',{method:'POST',body:{}});
      setItems(old=>old.map(i=>i.id===n.id?{...i,readAt:i.readAt||new Date().toISOString()}:i));
      setNotifUnread(u=>u===null?u:Math.max(0,u-(n.readAt?0:1)));
      if(n.type==='feedback'){
        setTab('feedback');setFeedbackFocus(n.feedbackId||null);
        if(n.feedbackId){
          try{const r=await api('/feedback/'+n.feedbackId+'/read',{method:'POST',body:{}});setFeedbackUnread(Number(r.unread)||0);setFeedbackItems(old=>old.map(i=>i.id===n.feedbackId?{...i,readAt:i.readAt||new Date().toISOString()}:i));setItems(old=>old.map(i=>i.feedbackId===n.feedbackId?{...i,readAt:i.readAt||new Date().toISOString()}:i));}catch{}
        }
        scrollToInboxTop();return;
      }
      if(CHAT_NOTIFICATION_TYPES.has(n.type)){
        const list=await loadThreads();
        const source=list||threads;
        if(!list&&!source.length){setHint('暂时无法读取私聊会话，请稍后重试。');return;}
        const match=source.find(t=>n.threadId&&t.id===n.threadId)||source.filter(t=>t.requestId===n.requestId).sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0))[0];
        if(match){setTab('chat');setSelectedId(match.id);scrollToInboxTop();}
        else setHint('没有找到对应的私聊会话，可能已被对方删除。');
        return;
      }
      if(n.type==='comment'){
        try{const d=await api('/notifications');setNotifUnread(d.unread);}catch{}
        if(n.available)await onOpen({id:n.requestId},'interactions');
        return;
      }
      try{const d=await api('/notifications');setNotifUnread(d.unread);}catch{}
      if(n.available)await onOpen({id:n.requestId});
    }catch(e){setError(e.message);}
  };

  const readAll=async()=>{try{await api('/notifications/read-all',{method:'POST',body:{}});setItems(old=>old.map(i=>({...i,readAt:i.readAt||new Date().toISOString()})));setNotifUnread(0);if(admin){try{await api('/feedback/read-all',{method:'POST',body:{}});setFeedbackUnread(0);setFeedbackItems(old=>old.map(i=>({...i,readAt:i.readAt||new Date().toISOString()})));}catch{}}}catch(e){setError(e.message);}};

  const readFeedback=async id=>{
    const hadUnreadNotification=items.some(i=>i.feedbackId===id&&!i.readAt);
    try{const r=await api('/feedback/'+id+'/read',{method:'POST',body:{}});setFeedbackUnread(Number(r.unread)||0);setFeedbackItems(old=>old.map(i=>i.id===id?{...i,readAt:i.readAt||new Date().toISOString()}:i));setItems(old=>old.map(i=>i.feedbackId===id?{...i,readAt:i.readAt||new Date().toISOString()}:i));if(hadUnreadNotification)setNotifUnread(u=>u===null?u:Math.max(0,u-1));}
    catch(e){setFeedbackError(e.message);}
  };

  const readAllFeedback=async()=>{
    try{await api('/feedback/read-all',{method:'POST',body:{}});setFeedbackUnread(0);setFeedbackItems(old=>old.map(i=>({...i,readAt:i.readAt||new Date().toISOString()})));await load();}
    catch(e){setFeedbackError(e.message);}
  };

  const threadChanged=t=>{
    if(!t?.id)return;
    threadsMutation.current+=1;
    setThreads(old=>{
      const patch={};Object.entries(t).forEach(([key,value])=>{if(value!==undefined)patch[key]=value;});
      const next=old.some(x=>x.id===t.id)?old.map(x=>x.id===t.id?{...x,...patch}:x):[{...patch,unread:0},...old];
      return next.sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0));
    });
  };

  const threadDeleted=id=>{threadsMutation.current+=1;setThreads(old=>old.filter(t=>t.id!==id));setSelectedId(current=>current===id?null:current);};

  const recommendationItems=items.filter(n=>n.type!=='feedback');
  return <div className="content inbox-content">
    <header className="page-head"><div><h1>站内消息</h1></div><div className="inbox-actions">{tab==='recommendations'?<><button type="button" className="text-button" onClick={()=>load()} disabled={loading}>刷新</button><button type="button" className="secondary" onClick={readAll} disabled={!recommendationItems.some(i=>!i.readAt)}>全部已读</button></>:tab==='chat'?<button type="button" className="text-button" onClick={()=>loadThreads()} disabled={threadsLoading}>刷新</button>:<><button type="button" className="text-button" onClick={()=>loadFeedback()} disabled={feedbackLoading}>刷新</button>{admin&&feedbackUnread>0&&<button type="button" className="secondary" onClick={readAllFeedback}>全部已读</button>}</>}</div></header>
    <div className="inbox-tabs" role="tablist" aria-label="站内消息分类" ref={tabsRef}>
      <button type="button" role="tab" id="inbox-tab-recommendations" aria-controls="inbox-panel-recommendations" aria-selected={tab==='recommendations'} onClick={()=>{setHint('');setTab('recommendations');scrollToInboxTop();}}>推荐消息</button>
      <button type="button" role="tab" id="inbox-tab-chat" aria-controls="inbox-panel-chat" aria-selected={tab==='chat'} aria-label={threadsLoaded?`私聊，${threads.length}个会话${threadUnread>0?`，${threadUnread}条未读`:''}`:'私聊'} onClick={()=>{setHint('');setTab('chat');scrollToInboxTop();}}>私聊{threadsLoaded&&<span className="inbox-tab-count">{threads.length} 个会话{threadUnread>0?' · '+threadUnread+' 未读':''}</span>}</button>
      <button type="button" role="tab" id="inbox-tab-feedback" aria-controls="inbox-panel-feedback" aria-selected={tab==='feedback'} aria-label={feedbackUnread>0?`改进意见，${feedbackUnread}条未读`:'改进意见'} onClick={()=>{setHint('');setTab('feedback');scrollToInboxTop();}}>改进意见{feedbackUnread>0&&<span className="inbox-tab-count">{feedbackUnread} 条未读</span>}</button>
    </div>
    <p className="inbox-intro">{tab==='recommendations'?'根据你的技能、空闲时间和互助意愿推荐。是否接取，由你决定。':tab==='chat'?'与同事围绕需求的私聊。打开会话后，对方发来的消息会标记为已读。':'把使用中的问题或改进建议发给管理员；会同步到管理员站内消息，并尝试发送邮件。'}</p>
    {hint&&<div className="inbox-hint" role="status">{hint}<button type="button" className="text-button" onClick={()=>setHint('')}>知道了</button></div>}
    {tab==='recommendations'&&<div role="tabpanel" id="inbox-panel-recommendations" aria-labelledby="inbox-tab-recommendations" className="inbox-tab-panel">
      {error&&<div className="inline-error" role="alert">{error}<button type="button" className="text-button" onClick={()=>load()}>重试</button></div>}
      <div className="inbox-list">{recommendationItems.map(n=><button type="button" key={n.id} className={'inbox-row'+(!n.readAt?' is-unread':'')} onClick={()=>open(n)}><span className="inbox-dot" aria-label={n.readAt?'已读':'未读'}/><span className="inbox-body"><span className="inbox-title">{n.title}</span><span className="inbox-reason">{n.reason}</span><span className="inbox-time">{new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(n.createdAt))}</span></span><span className="inbox-status">{notificationStatus(n)}<span aria-hidden="true"> ↗</span></span></button>)}{loading&&<p className="quiet-empty" role="status">正在读取消息…</p>}{!loading&&!error&&!recommendationItems.length&&<div className="empty">暂时没有消息。有合适的互助需求时，会在这里提醒你。</div>}</div>
      {cursor&&<button type="button" className="secondary inbox-more" disabled={loading} onClick={()=>load(true)}>查看更早消息</button>}
    </div>}
    {tab==='chat'&&<div role="tabpanel" id="inbox-panel-chat" aria-labelledby="inbox-tab-chat" className="inbox-tab-panel">
      <InboxChat api={api} threads={threads} loading={threadsLoading} error={threadsError} selectedId={selectedId} onSelect={setSelectedId} onReload={loadThreads} onDeleted={threadDeleted} onThreadChanged={threadChanged}/>
    </div>}
    {tab==='feedback'&&<div role="tabpanel" id="inbox-panel-feedback" aria-labelledby="inbox-tab-feedback" className="inbox-tab-panel">
      <InboxFeedback api={api} user={user} items={feedbackItems} unread={feedbackUnread} loading={feedbackLoading} error={feedbackError} focusId={feedbackFocus} onReload={loadFeedback} onRead={readFeedback} onReadAll={readAllFeedback}/>
    </div>}
  </div>;
}

export function HelpPreferences({value,onChange}){
  const p={weekdays:[],start:'12:00',end:'13:00',weeklyMinutes:60,maxActive:2,notifications:true,...value};
  const change=(k,v)=>onChange({...p,[k]:v});
  return <details className="help-preferences"><summary>推荐设置与空闲时段</summary><label className="check"><input type="checkbox" checked={p.notifications} onChange={e=>change('notifications',e.target.checked)}/> 接收互助需求的站内推荐</label><fieldset><legend>每周空闲日（北京时间，选填）</legend><div className="weekday-options">{['一','二','三','四','五','六','日'].map((day,i)=><label key={day}><input type="checkbox" checked={p.weekdays.includes(i+1)} onChange={e=>change('weekdays',e.target.checked?[...p.weekdays,i+1].sort():p.weekdays.filter(d=>d!==i+1))}/><span>周{day}</span></label>)}</div></fieldset><div className="preference-fields"><label>开始时间<input type="time" value={p.start} required onChange={e=>change('start',e.target.value)}/></label><label>结束时间<input type="time" value={p.end} required onChange={e=>change('end',e.target.value)}/></label><label>每周最多投入（分钟）<input type="number" min="0" max="2400" value={p.weeklyMinutes} required onChange={e=>change('weeklyMinutes',Number(e.target.value))}/></label><label>个人推荐负载上限<input type="number" min="1" max="20" value={p.maxActive} required onChange={e=>change('maxActive',Number(e.target.value))}/></label></div><p className="field-hint">平台最多同时接取{TASK_LIMITS.claiming}项，推荐时按个人设置与平台上限的较小值计算。结束时间须晚于开始时间；未选择空闲日时，推荐会注明时间待确认。关闭互助意愿或站内推荐后，不再接收新的需求推荐。</p></details>;
}
