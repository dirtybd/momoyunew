import React,{useEffect,useRef,useState} from 'react';
import './InboxFeedback.css';

const CATEGORIES=['功能建议','使用问题','内容问题','其他'];
const dateFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});

export function InboxFeedback({api,user,items=[],unread=0,loading=false,error='',focusId=null,onReload,onRead,onReadAll}){
  const admin=['admin','primary_admin'].includes(user?.role);
  const [category,setCategory]=useState('功能建议');
  const [content,setContent]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [formError,setFormError]=useState('');
  const noticeTimer=useRef(null);

  useEffect(()=>{if(!focusId)return;const id=requestAnimationFrame(()=>document.getElementById('feedback-'+focusId)?.scrollIntoView({behavior:'smooth',block:'center'}));return()=>cancelAnimationFrame(id);},[focusId,items.length]);

  async function submit(e){
    e.preventDefault();
    const text=content.trim();
    if(text.length<5){setFormError('请至少写 5 个字，方便管理员理解你的建议。');return;}
    if(busy)return;
    setBusy(true);setFormError('');setNotice('');
    try{
      const r=await api('/feedback',{method:'POST',body:{content:text,category}});
      const emailStatus=r?.email?.status, notifyStatus=r?.notify?.status;
      const channels=[];
      if(notifyStatus==='sent')channels.push('钉钉群');
      if(emailStatus==='sent')channels.push('管理员邮箱');
      if(channels.length)setNotice(`已提交，已发送到${channels.join('和')}，并同步到管理员站内消息。`);
      else{
        const failures=[];
        if(notifyStatus==='failed')failures.push('钉钉');
        if(emailStatus==='failed')failures.push('邮件');
        setNotice(failures.length
          ? `已提交并同步到管理员站内消息；${failures.join('和')}通知发送失败，请检查配置。`
          : '已提交并同步到管理员站内消息；钉钉和邮件通知尚未配置。');
      }
      setContent('');
      onReload?.();
      clearTimeout(noticeTimer.current);
      noticeTimer.current=setTimeout(()=>setNotice(''),8000);
    }catch(err){setFormError(err.message||'提交失败，请稍后重试。');}
    finally{setBusy(false);}
  }

  return <div className="inbox-feedback">
    <form className="feedback-form" onSubmit={submit}>
      <div className="feedback-form-head"><div><h2>改进意见</h2><p>页面、协作流程或 AI 办公的问题都可以写在这里。</p></div><label className="field">分类<select value={category} onChange={e=>setCategory(e.target.value)}>{CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label></div>
      <label className="field feedback-content">意见内容<textarea rows="5" minLength="5" maxLength="2000" required value={content} onChange={e=>setContent(e.target.value)} placeholder="例如：推荐消息切到私聊时页面会跳动；或者希望增加某个功能……"/></label>
      <div className="feedback-form-foot"><span className="field-hint">会同步到管理员站内消息，并尝试发送到管理员邮箱。请勿填写密码、证件号等敏感信息。</span><span className="feedback-count">{content.length}/2000</span><button className="primary" disabled={busy||content.trim().length<5}>{busy?'提交中…':'提交意见'}</button></div>
      {formError&&<div className="inline-error" role="alert">{formError}</div>}
      {notice&&<div className="feedback-notice" role="status">{notice}</div>}
    </form>

    <section className="feedback-list" aria-label={admin?'收到的改进意见':'我的改进意见'}>
      <div className="feedback-list-head"><div><h2>{admin?'收到的改进意见':'我的意见'}</h2><p>{admin?'按提交时间倒序显示；打开后可以标记已读。':'你提交的意见和邮件通知状态。'}</p></div>{admin&&unread>0&&<button type="button" className="secondary" onClick={onReadAll}>全部已读</button>}</div>
      {error&&<div className="inline-error" role="alert">{error}<button type="button" className="text-button" onClick={onReload}>重试</button></div>}
      {loading&&!items.length&&<p className="quiet-empty" role="status">正在读取意见…</p>}
      {!loading&&!error&&!items.length&&<div className="empty">{admin?'暂时没有收到改进意见。':'还没有提交过意见。'}</div>}
      {items.map(item=><article id={'feedback-'+item.id} key={item.id} className={'feedback-item'+(item.readAt?'':' is-unread')}>
        <div className="feedback-meta">
          <span className="feedback-category">{item.category}</span>
          {admin&&<span className="feedback-person">{item.displayName||'员工'}{item.department?` · ${item.department}`:''}</span>}
          <time className="feedback-time" dateTime={item.createdAt}>{dateFormat.format(new Date(item.createdAt))}</time>
          <span className={'feedback-notify is-'+item.notifyStatus}>{item.notifyLabel}</span>
          <span className={'feedback-email is-'+item.emailStatus}>{item.emailLabel}</span>
          {admin&&!item.readAt&&<button type="button" className="text-button feedback-read" onClick={()=>onRead?.(item.id)}>标记已读</button>}
        </div>
        <p className="feedback-text">{item.content}</p>
      </article>)}
    </section>
  </div>;
}
