import React,{useEffect,useState} from 'react';
import {TaskEconomy,rewardRule} from './TaskEconomy.jsx';
import {FileList,FilePicker,uploadAttachment} from './Attachments.jsx';

async function call(path,body) {
  const r=await fetch('/api'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const d=await r.json();if(!r.ok)throw new Error(d.error?.message||'操作失败');return d;
}
export function TaskDetail({request,onChanged,children}) {
  const participant=request.isMine||request.isClaimedByMe;
  const [tab,setTab]=useState(participant&&(request.isClaimedByMe||['submitted','changes_requested','completed'].includes(request.status))?'work':'brief');
  const brief=<>{children}{!participant&&request.materialFileCount>0&&<p className="field-hint">有 {request.materialFileCount} 个需求附件，接取后可下载。</p>}</>;
  if(!participant)return brief;
  return <><div className="task-detail-tabs"><button type="button" aria-pressed={tab==='brief'} onClick={()=>setTab('brief')}>需求详情</button><button type="button" aria-pressed={tab==='work'} onClick={()=>setTab('work')}>材料与交付{request.canReview?' · 待验收':request.canSubmit?' · 可提交':''}</button></div>{tab==='brief'?brief:<TaskWorkspace request={request} onChanged={onChanged}/>}</>;
}
function TaskWorkspace({request,onChanged}) {
  const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[feedback,setFeedback]=useState('');
  useEffect(()=>{let live=true;call('/requests/'+request.id+'/workspace').then(d=>{if(live)setData(d);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false};},[request.id,request.status]);
  const accept=d=>{setData(d);onChanged(d.request);};
  const act=async fn=>{setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const upload=files=>act(async()=>{for(const file of files)accept(await uploadAttachment(request.id,file));});
  const remove=f=>act(async()=>{const r=await fetch(`/api/requests/${request.id}/attachments/${f.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'}});const d=await r.json();if(!r.ok)throw new Error(d.error?.message||'移除失败');accept(d);});
  const include=(f,included)=>act(async()=>{const r=await fetch(`/api/requests/${request.id}/attachments/${f.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({included})});const d=await r.json();if(!r.ok)throw new Error(d.error?.message||'设置失败');accept(d);});
  const submit=e=>{e.preventDefault();act(async()=>{accept(await call('/requests/'+request.id+'/submit',{note,attachmentIds:data.pendingFiles.map(f=>f.id)}));setNote('');});};
  const review=decision=>act(async()=>{accept(await call('/requests/'+request.id+'/review',{submissionId:data.submissions[0].id,decision,feedback,confirmed:decision==='approve'}));setFeedback('');});
  return <div className="task-workspace">{error&&<p className="inline-error" role="alert">{error}</p>}{!data?<p>正在加载任务材料…</p>:<>
    <header className="delivery-heading"><h3>{request.title}</h3><span className={'delivery-status status-'+request.status}>{({open:'待接取',claimed:'进行中',submitted:'待发布者验收',changes_requested:'需要修改',completed:'已验收完成'})[request.status]||'草稿'}</span></header>
    <TaskEconomy request={data.request||request}/>{request.status==='completed'&&<p className="task-completed-note">交付记录与积分在下架后仍保留。</p>}
    <section><div className="delivery-section-head"><h3>原始材料</h3>{request.isMine&&!request.deletedAt&&!['completed','cancelled'].includes(request.status)&&<FilePicker onFiles={upload} disabled={busy} label={busy?'上传中…':'补充材料'}/>}</div><p className="field-hint">仅发布者和接取者可下载。{['draft','open'].includes(request.status)?'接取前可勾选要提供的原件；图片默认不提供。':'接取后补充的材料（含图片）直接提供给接取者；此前未共享的背景原图仍仅自己可见。'}</p><FileList files={data.materials.filter(f=>request.isMine||f.included)} showSharing={request.isMine} editable={request.isMine&&!request.deletedAt&&['draft','open'].includes(request.status)} disabled={busy} onInclude={include} onRemove={remove}/>{!data.materials.length&&<p className="quiet-empty">暂无材料附件，可按需求说明与对方确认。</p>}</section>
    {request.canSubmit&&<section><h3>{request.status==='changes_requested'?'修改后再次提交':'提交你的成果'}</h3><p className="field-hint">先上传文件，再点击提交。提交前仅自己可见，提交后发布者可下载；历次版本会保留。文件50MB，视频200MB；视频仅供双方查看，不供AI读取。</p><FilePicker onFiles={upload} disabled={busy} label={busy?'上传中…':'上传成果文件'}/><FileList files={data.pendingFiles} editable disabled={busy} onRemove={remove}/><form className="delivery-form" onSubmit={submit}><label htmlFor="delivery-note">成果说明</label><textarea id="delivery-note" rows="4" maxLength={4000} value={note} onChange={e=>setNote(e.target.value)} placeholder="说明完成了什么、文件如何使用，或还有哪些需要确认。"/><p className="field-hint">说明和成果文件至少提供一项。本次最多提交20个文件。</p><button className="primary" disabled={busy||(!note.trim()&&!data.pendingFiles.length)}>{busy?'处理中…':'提交给发布者验收'}</button></form></section>}
    {request.canReview&&data.submissions[0]&&<section className="review-section"><h3>验收本次成果</h3><p className="field-hint">下载下方最新提交，核对交付物和完成标准。确认完成后任务结束，材料与历史成果仍可下载。{rewardRule}</p><label htmlFor="review-feedback">验收反馈</label><textarea id="review-feedback" rows="3" maxLength={2000} value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="退回修改时，请写清需要调整的地方。"/><div className="delivery-actions"><button type="button" className="secondary" disabled={busy||!feedback.trim()} onClick={()=>review('changes_requested')}>退回修改</button><button type="button" className="primary" disabled={busy} onClick={()=>review('approve')}>确认验收完成</button></div></section>}
    <section><h3>提交记录</h3>{!data.submissions.length?<p className="quiet-empty">尚未提交成果。</p>:data.submissions.map((s,i)=><details className="submission-version" key={s.id} open={i===0}><summary><strong>第 {s.version} 次提交</strong><span>{s.decision==='approve'?'已通过':s.decision==='changes_requested'?'已退回修改':'待验收'}</span></summary><div><p className="submission-note">{s.note||'本次以附件交付'}</p><FileList files={s.files}/>{s.feedback&&<div className="review-feedback"><strong>发布者反馈</strong><p>{s.feedback}</p></div>}<p className="submission-time">{new Date(s.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</p></div></details>)}</section>
  </>}</div>;
}
