import React,{useEffect,useRef,useState} from 'react';
import './InboxChat.css';

const dayFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'});
const clockFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'});
const asDate=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?null:date;};
const listTime=value=>{const date=asDate(value);return date?`${dayFormat.format(date)} ${clockFormat.format(date)}`:'';};
const messageTime=value=>{const date=asDate(value);return date?clockFormat.format(date):'';};
const messageTitle=value=>{const date=asDate(value);return date?`${dayFormat.format(date)} ${clockFormat.format(date)}`:'';};
const excerpt=value=>{const text=String(value||'').replace(/\s+/g,' ').trim();return text.length>72?text.slice(0,72)+'…':text;};

export function InboxChat({api,threads=[],loading=false,error='',selectedId=null,onSelect,onReload,onDeleted,onThreadChanged}){
  const [thread,setThread]=useState(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('');
  const [detailReload,setDetailReload]=useState(0);
  const [draft,setDraft]=useState(''),[sending,setSending]=useState(false),[sendError,setSendError]=useState('');
  const [confirm,setConfirm]=useState(null),[deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState('');
  const listRef=useRef(null),inputRef=useRef(null),cancelRef=useRef(null),composing=useRef(false);
  const current=threads.find(t=>t.id===selectedId)||null;
  const headingTitle=thread?.requestTitle||current?.requestTitle||'会话';
  const headingOther=thread?.otherLabel||current?.otherLabel||thread?.askerLabel||'';
  const messages=Array.isArray(thread?.messages)?thread.messages:[];

  useEffect(()=>{
    if(!selectedId){setThread(null);setDetailError('');setDetailLoading(false);return;}
    let active=true;
    setThread(null);setDetailLoading(true);setDetailError('');
    api('/interactions/threads/'+selectedId).then(r=>{
      if(!active)return;
      setThread(r.thread||null);
      onReload?.();
    }).catch(e=>{if(active)setDetailError(e.message);}).finally(()=>{if(active)setDetailLoading(false);});
    return()=>{active=false;};
  },[selectedId,detailReload]);

  useEffect(()=>{const el=listRef.current;if(el)el.scrollTop=el.scrollHeight;},[thread?.id,thread?.messages?.length,detailLoading]);

  useEffect(()=>{
    if(!confirm)return;
    cancelRef.current?.focus();
    const key=e=>{if(e.key==='Escape'&&!deleting)setConfirm(null);};
    document.addEventListener('keydown',key);
    return()=>document.removeEventListener('keydown',key);
  },[confirm,deleting]);

  async function send(){
    const content=draft.trim();
    if(!content||sending||!selectedId||detailLoading||detailError)return;
    setSending(true);setSendError('');
    try{
      const r=await api('/interactions/threads/'+selectedId+'/messages',{method:'POST',body:{content}});
      const next=r.thread||null;
      if(next&&Array.isArray(next.messages))setThread(next);
      else setThread(old=>old?{...old,messages:[...(old.messages||[]),{id:'sent-'+Date.now(),authorLabel:'我',content,createdAt:new Date().toISOString(),mine:true}]}:old);
      const sent=next?.messages?.[next.messages.length-1]||null;
      const patch={id:next?.id||selectedId,lastMessage:sent?.content??content,updatedAt:sent?.createdAt??next?.updatedAt??new Date().toISOString(),unread:0};
      ['requestId','requestTitle','otherLabel'].forEach(key=>{if(next?.[key]!==undefined)patch[key]=next[key];});
      onThreadChanged?.(patch);
      setDraft('');
      onReload?.();
      requestAnimationFrame(()=>{const el=listRef.current;if(el)el.scrollTop=el.scrollHeight;inputRef.current?.focus();});
    }catch(e){setSendError(e.message);}
    finally{setSending(false);}
  }

  async function remove(){
    if(!confirm||deleting)return;
    setDeleting(true);setDeleteError('');
    try{
      await api('/interactions/threads/'+confirm.id+'/delete',{method:'POST',body:{}});
      const id=confirm.id;
      setConfirm(null);
      onDeleted?.(id);
    }catch(e){setDeleteError(e.message);}
    finally{setDeleting(false);}
  }

  function askDelete(id){
    if(!id)return;
    const item=threads.find(t=>t.id===id);
    setDeleteError('');
    setConfirm({id,title:item?.requestTitle||'这个会话'});
  }

  const onKeyDown=e=>{
    if(e.key!=='Enter'||e.shiftKey)return;
    if(composing.current||e.nativeEvent?.isComposing)return;
    e.preventDefault();
    send();
  };

  return <div className={'inbox-chat'+(selectedId?' has-selection':'')}>
    <div className="inbox-chat-list" aria-label="私聊会话">
      {error&&<div className="inline-error inbox-chat-list-error" role="alert">{error}<button type="button" className="text-button" onClick={()=>onReload?.()}>重试</button></div>}
      {loading&&!threads.length&&<p className="quiet-empty inbox-chat-list-state" role="status">正在读取会话…</p>}
      {!loading&&!error&&!threads.length&&<div className="empty inbox-chat-list-state">暂时没有私聊。围绕需求的提问和回复会出现在这里。</div>}
      {threads.map(t=>{
        const unread=Number(t.unread)||0;
        return <div key={t.id} className={'inbox-thread-row'+(unread>0?' is-unread':'')+(t.id===selectedId?' is-active':'')}>
          <button type="button" className="inbox-thread-main" aria-current={t.id===selectedId?'true':undefined} onClick={()=>onSelect?.(t.id)}>
            <span className="inbox-thread-top"><span className="inbox-thread-title">{t.requestTitle||'未命名需求'}</span>{unread>0&&<span className={'inbox-thread-unread'+(unread>1?' has-count':'')} aria-label={`${unread}条未读`}>{unread>1?unread:''}</span>}</span>
            <span className="inbox-thread-other">{t.otherLabel||'对方'}</span>
            <span className="inbox-thread-last">{excerpt(t.lastMessage)||'还没有消息'}</span>
            <span className="inbox-thread-time">{listTime(t.updatedAt)}</span>
          </button>
          <button type="button" className="inbox-thread-delete" aria-label={`删除与${t.otherLabel||'对方'}的会话`} onClick={()=>askDelete(t.id)}>删除</button>
        </div>;
      })}
    </div>
    <section className="inbox-chat-panel" aria-label="会话消息">
      {selectedId?<>
        <header className="inbox-chat-head">
          <button type="button" className="text-button inbox-chat-back" onClick={()=>onSelect?.(null)}>← 返回</button>
          <div className="inbox-chat-heading"><h2>{headingTitle}</h2>{headingOther&&<span>{headingOther}</span>}</div>
          <button type="button" className="text-button inbox-chat-delete" onClick={()=>askDelete(selectedId)}>删除</button>
        </header>
        <div className="inbox-chat-messages" ref={listRef} aria-label="消息记录">
          {detailLoading&&<p className="quiet-empty" role="status">正在读取会话…</p>}
          {!detailLoading&&detailError&&<div className="inline-error" role="alert">{detailError}<button type="button" className="text-button" onClick={()=>setDetailReload(k=>k+1)}>重试</button></div>}
          {!detailLoading&&!detailError&&!messages.length&&<div className="empty">还没有消息。可以先打个招呼，说明你想了解的内容。</div>}
          {!detailError&&messages.map(m=><div key={m.id} className={'inbox-msg '+(m.mine?'is-mine':'is-other')}>
            <span className="inbox-msg-author">{m.authorLabel||(m.mine?'我':'对方')}</span>
            <div className="inbox-msg-bubble">{m.content}</div>
            <time className="inbox-msg-time" dateTime={m.createdAt} title={messageTitle(m.createdAt)}>{messageTime(m.createdAt)}</time>
          </div>)}
        </div>
        {sendError&&<div className="inline-error inbox-send-error" role="alert">{sendError}</div>}
        <div className="inbox-composer">
          <textarea ref={inputRef} aria-label="输入消息" rows="2" value={draft} maxLength={1000} placeholder={detailLoading?'正在读取会话…':'输入消息'} disabled={sending||detailLoading||!!detailError} onChange={e=>setDraft(e.target.value)} onKeyDown={onKeyDown} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}/>
          <div className="inbox-composer-foot"><span className="inbox-composer-hint">Enter 发送 · Shift+Enter 换行</span><button type="button" className="primary" onClick={send} disabled={sending||detailLoading||!!detailError||!draft.trim()}>{sending?'发送中…':'发送'}</button></div>
        </div>
      </>:<div className="inbox-chat-placeholder">选择一个会话查看消息。</div>}
    </section>
    {confirm&&<div className="inbox-confirm-layer" onMouseDown={e=>{if(e.target===e.currentTarget&&!deleting)setConfirm(null);}}>
      <div className="inbox-confirm" role="dialog" aria-modal="true" aria-labelledby="inbox-confirm-title">
        <h2 id="inbox-confirm-title">删除会话？</h2>
        <p>「{confirm.title}」会从你的私聊列表移除，对方仍保留会话记录。</p>
        {deleteError&&<div className="inline-error" role="alert">{deleteError}</div>}
        <div className="inbox-confirm-actions">
          <button type="button" className="secondary" ref={cancelRef} onClick={()=>setConfirm(null)} disabled={deleting}>取消</button>
          <button type="button" className="primary" onClick={remove} disabled={deleting}>{deleting?'删除中…':'删除'}</button>
        </div>
      </div>
    </div>}
  </div>;
}
