import React,{useEffect,useRef,useState} from 'react';
import {VideoPlayer,VideoThumb,isVideoFile} from './Media.jsx';
import {FILE_LIMITS} from '../../shared/attachment-limits.mjs';
import {FilePicker} from './Attachments.jsx';
import {DEMO_CARE_POSTS} from '../../shared/demo-care-posts.mjs';
import './Care.css';
import './CareDetail.css';
import './CareBento.css';
import {CanteenBoard,GamesBoard} from './Canteen.jsx';

const kinds={vent:'吐槽',moment:'随手拍',mood:'心情'};
const bentoVariants=['feature','photo','note','photo2','quote','note2'];
const detailLayouts={auto:'自动（按帖子选择）',polaroid:'拍立得',stage:'表情包舞台',magazine:'杂志跨页'};
const detailLayoutKeys=['polaroid','stage','magazine'];
const date=v=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric'}).format(new Date(v));
const publicNotice='文字与媒体对同事可见。匿名只隐藏身份，请检查画面中的人脸、工牌和文件；文字会经过 AI 审核。';
const blank=()=>({title:'',content:'',kind:'vent',photos:[],commentsEnabled:true,detailLayout:'auto'});
const payload=value=>({title:value.title.trim()||value.content.trim().split('\n')[0].slice(0,40)||'今天的随手拍',content:value.content.trim(),kind:value.kind||'mood',mediaIds:(value.photos||[]).map(p=>p.id),commentsEnabled:value.commentsEnabled!==false,detailLayout:value.detailLayout||'auto',confirmed:true});
const isVideo=p=>p.kind==='video';
function stableHash(value=''){let h=0;for(let i=0;i<value.length;i++)h=(h*31+value.charCodeAt(i))|0;return Math.abs(h);}
export function resolveCareLayout(post){
  const explicit=post?.detailLayout||post?.detail_layout;
  const photos=post?.photos||[],hasMedia=photos.length>0,imageFirst=hasMedia&&!isVideo(photos[0]);
  const auto=!hasMedia?'magazine':post.kind==='vent'?(imageFirst?'stage':'magazine'):post.kind==='moment'?'polaroid':detailLayoutKeys[stableHash(String(post.id||''))%detailLayoutKeys.length];
  const layout=detailLayoutKeys.includes(explicit)?explicit:auto;
  return layout==='stage'&&!imageFirst?'magazine':layout;
}

function MediaThumb({media,alt}){return isVideo(media)?<VideoThumb/>:<img src={media.url} alt={alt} loading="lazy"/>}
function MediaNotice({photos=[]}){return <><p className="field-hint">{publicNotice}</p>{photos.some(isVideo)&&<p className="field-hint">视频不供AI读取，也不做画面审核，请自行检查将公开的内容。</p>}</>}
function PhotoPicker({photos=[],onChange,disabled=false,onBusy}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[library,setLibrary]=useState(null);
  async function upload(files){
    setError('');if(photos.length+files.length>FILE_LIMITS.careMediaCount){setError('每条最多9项图片或视频。');return;}if(photos.filter(isVideo).length+files.filter(isVideoFile).length>FILE_LIMITS.careVideoCount){setError('每条最多3个视频。');return;}if(files.some(f=>f.size>(isVideoFile(f)?FILE_LIMITS.careVideoBytes:FILE_LIMITS.careImageBytes))){setError('图片最多20MB，视频最多200MB。');return;}
    setBusy(true);onBusy?.(true);let next=[...photos];
    try{for(const file of files){const form=new FormData();form.append('file',file);const r=await fetch('/api/care/media',{method:'POST',body:form,credentials:'same-origin'});const d=await r.json();if(!r.ok)throw Error(d.error?.message||'上传失败');next=[...next,d.media];onChange(next);}}catch(e){setError(e.message);}finally{setBusy(false);onBusy?.(false);}
  }
  async function showLibrary(){try{const r=await fetch('/api/care/media',{credentials:'same-origin'});const d=await r.json();if(!r.ok)throw Error(d.error?.message||'读取失败');setLibrary(d.items);}catch(e){setError(e.message);}}
  async function removeUnused(id){try{const r=await fetch('/api/care/media/'+id,{method:'DELETE',headers:{'content-type':'application/json'}});if(!r.ok)throw Error('移除失败');setLibrary(items=>items.filter(p=>p.id!==id));}catch(e){setError(e.message);}}
  return <div className="care-photo-picker">
    <div className="care-photo-controls"><FilePicker mediaOnly onFiles={upload} disabled={disabled||busy||photos.length>=9} label={busy?'上传中…':'添加图片或视频'}/><span>图片20MB · 视频200MB · 共9项/视频最多3项</span><button type="button" className="text-button" disabled={busy||disabled} onClick={()=>library===null?showLibrary():setLibrary(null)}>未发布媒体</button></div>
    {!!photos.length&&<div className="care-photo-selection">{photos.map((p,i)=><div key={p.id}><MediaThumb media={p} alt={'待发布媒体 '+(i+1)}/><button type="button" disabled={busy||disabled} aria-label={'移除媒体 '+(i+1)} onClick={()=>onChange(photos.filter(x=>x.id!==p.id))}>×</button>{i===0&&<span>封面</span>}</div>)}</div>}
    {library!==null&&<div className="care-photo-library"><div><strong>仅自己可见</strong><button type="button" className="text-button" onClick={()=>setLibrary(null)}>收起</button></div>{library.length?<div className="care-photo-selection">{library.map(p=><div key={p.id}><button className="care-library-choice" type="button" disabled={disabled||busy||photos.length>=9||photos.some(x=>x.id===p.id)||(isVideo(p)&&photos.filter(isVideo).length>=3)} onClick={()=>onChange([...photos,p])}><MediaThumb media={p} alt="选择未发布媒体"/></button>{!photos.some(x=>x.id===p.id)&&<button type="button" aria-label="移除未发布媒体" onClick={()=>removeUnused(p.id)}>×</button>}</div>)}</div>:<p>暂无未发布媒体。</p>}</div>}
    {error&&<p className="inline-error" role="alert">{error}</p>}
  </div>;
}

function PostFields({value,onChange,disabled,onBusy,compact=false}){
  return <div className={'care-post-fields'+(compact?' is-compact':'')}>
    <div className="care-post-meta-row">
      <div className="care-kind-picker" role="group" aria-label="帖子分类">{Object.entries(kinds).map(([key,label])=><button type="button" aria-pressed={(value.kind||'mood')===key} disabled={disabled} key={key} onClick={()=>onChange({...value,kind:key})}>{label}</button>)}</div>
      {!compact&&<label className="care-layout-field">展开样式<select disabled={disabled} value={value.detailLayout||'auto'} onChange={e=>onChange({...value,detailLayout:e.target.value})}>{Object.entries(detailLayouts).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
    </div>
    <label className="field">标题（可选）<input maxLength={120} value={value.title} disabled={disabled} onChange={e=>onChange({...value,title:e.target.value})} placeholder="给今天起个标题"/></label>
    <label className="field">想说的话<textarea rows={compact?3:5} maxLength={1500} value={value.content} disabled={disabled} onChange={e=>onChange({...value,content:e.target.value})} placeholder="吐个槽，记件小事，或留一段此刻的心情…"/></label>
    <PhotoPicker photos={value.photos} onChange={photos=>onChange({...value,photos})} disabled={disabled} onBusy={onBusy}/>
    <label className="check"><input type="checkbox" disabled={disabled} checked={value.commentsEnabled!==false} onChange={e=>onChange({...value,commentsEnabled:e.target.checked})}/> 允许鼓励留言</label>
    {compact?<p className="field-hint care-compact-notice">照片会公开；匿名不替照片脱敏；照片不做画面审核。</p>:<MediaNotice photos={value.photos}/>}
  </div>;
}

function PublishPreview({value}){
  return <div className="care-publish-preview"><h3>{payload(value).title}</h3>{value.content&&<p>{value.content}</p>}{!!value.photos?.length&&<div className="care-publish-photos">{value.photos.map((p,i)=>isVideo(p)?<VideoPlayer key={p.id} src={p.url} label={'将公开的视频 '+(i+1)}/>:<img key={p.id} src={p.url} alt={'将公开的照片 '+(i+1)}/>)}</div>}<p>{value.commentsEnabled===false?'留言已关闭':'允许鼓励留言'}</p></div>;
}

function PostComposer({initial,initialValue,api,Modal,onClose,onDone}){
  const editing=!!initial?.id;
  const [value,setValue]=useState(()=>initial?{...initial,photos:initial.photos||[],detailLayout:initial.detailLayout||initial.detail_layout||'auto'}:initialValue?{...initialValue,photos:initialValue.photos||[],detailLayout:initialValue.detailLayout||'auto'}:blank()),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState('');
  async function publish(){setBusy(true);setError('');try{const d=await api(editing?'/care/posts/'+initial.id:'/care/posts',{method:editing?'PATCH':'POST',body:payload(value)});onDone(d.post);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <Modal title={review?'确认发布':editing?'编辑帖子':'发一条'} className="care-composer-dialog" onClose={()=>!busy&&!uploading&&onClose()}>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    {review?<><MediaNotice photos={value.photos}/><PublishPreview value={value}/></>:<PostFields value={value} onChange={setValue} disabled={busy||uploading} onBusy={setUploading}/>}
    <div className="dialog-actions"><button className="secondary" disabled={busy||uploading} onClick={()=>review?setReview(false):onClose()}>{review?'返回修改':'取消'}</button><button className="primary" disabled={busy||uploading||(!value.content.trim()&&!value.photos.length)} onClick={()=>review?publish():setReview(true)}>{busy?'正在审核并发布…':review?'确认发布':'预览'}</button></div>
  </Modal>;
}

function PhotoGallery({photos,title}){
  const [index,setIndex]=useState(0),touch=useRef(null);useEffect(()=>setIndex(0),[photos]);
  const move=delta=>setIndex(i=>(i+delta+photos.length)%photos.length);
  if(!photos.length)return <div className="care-text-cover"><span>留在这里的一点心情</span><p>{title}</p><i aria-hidden="true">⌁</i></div>;
  const active=photos[Math.min(index,photos.length-1)];
  return <div className="care-gallery" tabIndex="0" aria-label="帖子媒体" onKeyDown={e=>{if(photos.length>1&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();move(e.key==='ArrowRight'?1:-1);}}} onTouchStart={e=>touch.current=[e.touches[0].clientX,e.touches[0].clientY]} onTouchEnd={e=>{const start=touch.current;touch.current=null;if(start&&photos.length>1){const dx=e.changedTouches[0].clientX-start[0],dy=e.changedTouches[0].clientY-start[1];if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy))move(dx<0?1:-1);}}}>
    {isVideo(active)?<VideoPlayer key={active.id} src={active.url} label={title+' · 视频 '+(index+1)}/>:<img src={active.url} alt={title+' · 照片 '+(index+1)}/>}
    {photos.length>1&&<><button className="care-gallery-prev" aria-label="上一项媒体" onClick={()=>move(-1)}>‹</button><button className="care-gallery-next" aria-label="下一项媒体" onClick={()=>move(1)}>›</button><div className="care-gallery-count">{index+1} / {photos.length}</div><div className="care-gallery-dots">{photos.map((p,i)=><button key={p.id} aria-label={'查看媒体 '+(i+1)} aria-current={i===index?'true':undefined} onClick={()=>setIndex(i)}/>)}</div></>}
  </div>;
}

function LikeButton({post,user,onLogin,api,onChanged}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <div className="care-like-control"><button type="button" className={'care-like-button'+(post.liked?' is-liked':'')} aria-pressed={!!post.liked} aria-label={post.isDemo?'演示帖不参与点赞':post.liked?'取消点赞':'点赞'} disabled={busy||post.isDemo} onClick={async()=>{if(!user){onLogin();return}setBusy(true);setError('');try{const d=await api('/care/posts/'+post.id+'/like',{method:'PUT',body:{liked:!post.liked}});onChanged(d.post)}catch(e){setError(e.message)}finally{setBusy(false)}}}><span className="care-like-icon" aria-hidden="true">{post.liked?'♥':'♡'}</span><span className="care-like-word">赞</span><span className="care-like-count">{post.likeCount||0}</span></button>{error&&<span className="inline-error" role="alert">{error}</span>}</div>;
}
function PostReader({post,items,api,Modal,onClose,onSelect,onChanged,onEdit,onLogin,user}){
  const [comments,setComments]=useState([]),[cursor,setCursor]=useState(null),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(null),[reason,setReason]=useState(''),[notice,setNotice]=useState('');
  const index=items.findIndex(p=>p.id===post.id),demo=!!post.isDemo,isAdmin=['admin','primary_admin'].includes(user?.role);
  async function load(next=false){const d=await api('/care/posts/'+post.id+'/comments'+(next&&cursor?'?cursor='+cursor:''));setComments(old=>next?[...old,...d.items]:d.items);setCursor(d.nextCursor);}
  useEffect(()=>{setComments([]);setCursor(null);setText('');setError('');setConfirm(null);setNotice('');if(!demo)load().catch(e=>setError(e.message));},[post.id]);
  async function act(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
  const photos=post.photos||[],layout=resolveCareLayout(post),imageFirst=photos.length>0&&!isVideo(photos[0]),hasVideo=photos.some(isVideo);
  const gallery=<PhotoGallery photos={photos} title={post.title}/>;
  const likeButton=<LikeButton post={post} user={user} onLogin={onLogin} api={api} onChanged={onChanged}/>;
  const media=layout==='polaroid'
    ?<div className="care-reader-media care-polaroid-stage"><figure className={'care-polaroid'+(hasVideo?' is-video':'')}>{imageFirst&&<span className="care-polaroid-tape" aria-hidden="true"/>}{photos.length>1&&<span className="care-polaroid-count">{photos.length} 项</span>}{imageFirst&&<span className="care-media-badge">用户上传 · 表情包</span>}<div className="care-polaroid-photo">{gallery}</div><figcaption className="care-polaroid-caption" aria-hidden="true"><span className="care-hand">{post.title}</span>{imageFirst&&<span className="care-save-chip">存图 ↓</span>}</figcaption></figure></div>
    :layout==='stage'
    ?<div className="care-reader-media care-stage-media"><span className="care-stage-corner">摸鱼空间 · 表情包专场{photos.length>1?' · '+photos.length+' 项':''}</span><span className="care-media-badge">用户上传 · 表情包</span><div className="care-stage-bubble" aria-hidden="true"><h3>{post.title}</h3>{post.content&&<p>{post.content.trim().split('\n')[0].slice(0,80)}</p>}</div><div className="care-stage-sticker">{gallery}</div><div className="care-stage-reactions">{likeButton}<span className="care-save-chip">存图 ↓</span></div></div>
    :<div className="care-reader-media care-magazine-media"><div className="care-magazine-frame">{gallery}</div>{photos.length>0&&<span className="care-detail-count">{photos.length} 项媒体</span>}<span className="care-magazine-pageno" aria-hidden="true">{String((index>=0?index:0)+1).padStart(2,'0')} / {String(Math.max(items.length,1)).padStart(2,'0')}</span></div>;
  return <Modal title={demo?'图文示例':'摸鱼空间 · 帖子'} className="care-reader-dialog" onClose={onClose}><div className={'care-reader care-reader--'+layout} data-layout={layout}>
    {media}
    <div className={'care-reader-copy care-copy--'+layout}><div className="care-post-byline"><span className="care-author-mark" aria-hidden="true">⌁</span><div><strong>{demo?'图文示例':'匿名同事'}</strong><span>{kinds[post.kind]||'心情'} · {date(post.createdAt)}</span></div></div>
      <article className="care-post-body"><h3>{post.title}</h3><p>{post.content}</p></article>{layout!=='stage'&&likeButton}
      {demo&&<p className="field-hint">示例内容，不代表真实员工动态。你也可以发一条自己的图文。</p>}
      {post.isMine&&!demo&&<div className="care-actions"><button className="text-button" disabled={busy||user?.muted} onClick={()=>onEdit(post)}>编辑</button><button className="text-button" disabled={busy} onClick={()=>setConfirm({type:'comments'})}>{post.commentsEnabled?'关闭留言':'开启留言'}</button>{!isAdmin&&<button className="text-button" onClick={()=>setConfirm({type:'archive'})}>移除帖子</button>}</div>}
      {isAdmin&&!demo&&<div className="care-actions"><button className="text-button" disabled={busy} onClick={()=>{setReason('');setConfirm({type:'admin-archive'})}}>删除帖子</button></div>}
      {error&&<p className="inline-error" role="alert">{error}</p>}{notice&&<p className="care-success" role="status">{notice}</p>}
      <section className="care-comments"><h3>鼓励留言{!demo&&<span>{post.commentCount||0}</span>}</h3>{comments.map(c=><div className="care-comment" key={c.id}><div><strong>{c.authorLabel}</strong><span>{date(c.createdAt)}</span></div><p>{c.content}</p><div className="care-actions">{c.canRemove&&<button className="text-button" onClick={()=>{setReason('');setConfirm({type:isAdmin?'admin-remove':'remove',comment:c})}}>{isAdmin?'删除留言':'移除'}</button>}<button className="text-button" onClick={()=>{setReason('');setConfirm({type:'report',comment:c});}}>反馈不适</button></div></div>)}{!comments.length&&<p className="care-comment-empty">{demo?'示例不接收真实留言。':'还没有留言，留一句温柔的话吧。'}</p>}{cursor&&<button className="text-button" disabled={busy} onClick={()=>act(()=>load(true))}>更多留言</button>}
        {!demo&&user?.muted&&<p className="field-hint">账号已禁言，暂不能发表或编辑公开内容；仍可私下聊聊。</p>}{!demo&&post.commentsEnabled&&!user?.muted&&<form onSubmit={e=>{e.preventDefault();act(async()=>{await api('/care/posts/'+post.id+'/comments',{method:'POST',body:{content:text.trim()}});setText('');await load();onChanged({...post,commentCount:(post.commentCount||0)+1});});}}><label htmlFor="care-comment">写一句鼓励</label><textarea id="care-comment" rows="2" maxLength={500} value={text} onChange={e=>setText(e.target.value)} required/><div className="care-comment-footer"><span>同事可见 · AI 审核</span><button className="primary" disabled={busy||!text.trim()}>{busy?'审核中…':'发表留言'}</button></div></form>}
        {!demo&&!post.commentsEnabled&&<p className="field-hint">发布者已关闭留言。</p>}
      </section>
      {confirm&&<div className="care-confirm" role="group" aria-label="确认操作">{confirm.type==='report'?<><label>反馈原因<textarea maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label><p className="field-hint">记录为待处理，不代表即时人工响应。</p></>:['admin-archive','admin-remove'].includes(confirm.type)?<><p>确认删除{confirm.type==='admin-archive'?'这条帖子':'这条留言'}？可在管理后台的内容管理中恢复。</p><label>处理说明（选填）<textarea maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label></>:<p>{confirm.type==='archive'?'移除后帖子和媒体不再对同事可见。确认移除？':confirm.type==='remove'?'确认移除这条留言？':post.commentsEnabled?'确认关闭留言？':'确认开启留言？'}</p>}<div className="dialog-actions"><button className="secondary" disabled={busy} onClick={()=>setConfirm(null)}>取消</button><button className="primary" disabled={busy||(confirm.type==='report'&&!reason.trim())} onClick={()=>act(async()=>{if(confirm.type==='admin-archive'){await api('/admin/content/posts/'+post.id+'/archive',{method:'POST',body:{confirmed:true,reason:reason.trim()}});onClose();onChanged();return;}if(confirm.type==='admin-remove'){await api('/admin/content/comments/'+confirm.comment.id+'/archive',{method:'POST',body:{confirmed:true,reason:reason.trim()}});await load();onChanged({...post,commentCount:Math.max(0,(post.commentCount||0)-1)});}if(confirm.type==='archive'){await api('/care/posts/'+post.id+'/archive',{method:'POST',body:{confirmed:true}});onClose();onChanged();return;}if(confirm.type==='comments'){const d=await api('/care/posts/'+post.id,{method:'PATCH',body:{commentsEnabled:!post.commentsEnabled,confirmed:true}});onChanged(d.post);}if(confirm.type==='remove'){await api('/care/comments/'+confirm.comment.id+'/remove',{method:'POST',body:{confirmed:true}});await load();onChanged({...post,commentCount:Math.max(0,(post.commentCount||0)-1)});}if(confirm.type==='report'){await api('/care/comments/'+confirm.comment.id+'/report',{method:'POST',body:{reason:reason.trim()}});setNotice('反馈已记录为待处理。');}setConfirm(null);})}>确认</button></div></div>}
    </div>
  </div><div className="care-reader-navigation"><button className="secondary" disabled={index<=0||busy} onClick={()=>onSelect(items[index-1])}>← 上一篇</button><span>{demo?'示例':'匿名分享'}</span><button className="secondary" disabled={index<0||index>=items.length-1||busy} onClick={()=>onSelect(items[index+1])}>下一篇 →</button></div></Modal>;
}

function BentoCard({post,variant,user,onOpen,onLogin,api,onLiked}){
  const photos=post.photos||[],hasMedia=photos.length>0,demo=post.isDemo,kind=kinds[post.kind]||'心情';
  const meme=hasMedia&&/meme|card-backgrounds\/meme/i.test(photos[0]?.url||'');
  const accent=variant==='quote'?' is-quote':variant==='note2'?' is-daily':'';
  const meta=<div className="care-bento-meta"><span>{demo?'示例':'匿名同事'} · {kind}</span></div>;
  let body;
  if(hasMedia){
    body=<>
      {variant==='feature'&&<span className="care-bento-feature-badge">{meme?'表情包 · 今日份':'今日份'}</span>}
      <div className="care-bento-media">{photos.length>1&&<span className="care-bento-count">{photos.length} 项</span>}<MediaThumb media={photos[0]} alt={post.title}/></div>
      <div className="care-bento-caption"><strong>{post.title}</strong>{variant==='feature'&&post.content?<p>{post.content}</p>:null}{meta}</div>
    </>;
  }else if(variant==='quote'){
    body=<><div className="care-bento-quote"><span className="care-quote-mark" aria-hidden="true">“</span><h3>{post.title}</h3><p>{post.content}</p></div><div className="care-bento-caption is-text">{meta}</div></>;
  }else if(variant==='note2'){
    body=<><div className="care-bento-daily"><span className="care-bento-kind">今日份 · {kind}</span><h3>{post.title}</h3><p>{post.content}</p></div><div className="care-bento-caption is-text">{meta}</div></>;
  }else{
    body=<><div className="care-bento-note"><span className="care-bento-kind">{kind}</span><h3>{post.title}</h3><p>{post.content}</p></div><div className="care-bento-caption is-text">{meta}</div></>;
  }
  return <article className={'care-bento-card bento-'+variant+(hasMedia?' has-media':' is-text')+(meme?' is-meme':'')+accent} data-kind={post.kind}>
    <button type="button" className="care-bento-open" onClick={()=>onOpen(post)} title={post.title}>{body}</button>
    <div className="care-bento-actions"><LikeButton post={post} user={user} onLogin={onLogin} api={api} onChanged={onLiked}/><button type="button" className="care-bento-comment" onClick={()=>onOpen(post)} aria-label={`查看 ${post.commentCount||0} 条鼓励留言`}><svg className="care-comment-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5h10v6.5H8.2L5 13v-3H3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg><span>{post.commentCount||0}</span></button></div>
  </article>;
}

export function CareBoard({user,sessionReady,onLogin,onStartCare,api,Modal}){
  const [items,setItems]=useState([]),[cursor,setCursor]=useState(null),[channel,setChannel]=useState('feed'),[loading,setLoading]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState(null),[composer,setComposer]=useState(null),[notice,setNotice]=useState('');
  async function load(next=false,quiet=false){if(!user)return;if(!quiet)setLoading(true);setError('');try{const params=new URLSearchParams();if(next&&cursor)params.set('cursor',cursor);const d=await api('/care/posts?'+params);setItems(old=>next?[...old,...d.items.filter(x=>!old.some(y=>y.id===x.id))]:d.items);setCursor(d.nextCursor);}catch(e){setError(e.message);}finally{setLoading(false);}}
  useEffect(()=>{setItems([]);setCursor(null);if(user)load();},[user?.id]);
  useEffect(()=>{if(!user||selected||composer||channel!=='feed')return;const id=setInterval(()=>{if(document.visibilityState==='visible')load(false,true);},30000);return()=>clearInterval(id);},[user?.id,!!selected,!!composer,channel]);
  const sampleOrder=['demo-care-fish','demo-care-coast','demo-care-vent','demo-care-mountain','demo-care-mood','demo-care-small'];
  const samples=[...DEMO_CARE_POSTS].sort((a,b)=>sampleOrder.indexOf(a.id)-sampleOrder.indexOf(b.id)),all=[...items,...samples.slice(0,Math.max(0,6-items.length))];
  async function open(item){setError('');if(item.isDemo){setSelected(item);return;}try{setSelected((await api('/care/posts/'+item.id)).post);}catch(e){setError(e.message);}}
  const changed=post=>{if(post){setSelected(post);setItems(old=>old.map(p=>p.id===post.id?post:p));}else load();};
  const liked=post=>{setItems(old=>old.map(p=>p.id===post.id?post:p));setSelected(old=>old?.id===post.id?post:old)};
  const startPost=()=>{if(!user){onLogin();return;}if(user.muted){setError('账号已禁言，暂不能公开发帖或留言；仍可私下聊聊。');return;}setComposer({});};
  return <section className="care-board community-feed" aria-label="摸鱼空间">
    <header className="care-feed-heading"><div><h1>摸鱼空间</h1><p>吐槽、随手拍、心情都放在这里。工作之外的一小会儿，留给生活。</p></div><div><button className="secondary care-header-private" onClick={()=>user?onStartCare():onLogin()}>私下聊聊</button><button className="primary care-header-compose" disabled={!sessionReady} onClick={startPost}>＋ 发一条</button></div></header>
    <div className="care-channel-tabs" role="tablist" aria-label="摸鱼空间频道">
      <button type="button" role="tab" aria-selected={channel==='feed'} className={channel==='feed'?'is-on':''} onClick={()=>setChannel('feed')}>动态</button>
      <button type="button" role="tab" aria-selected={channel==='canteen'} className={channel==='canteen'?'is-on':''} onClick={()=>setChannel('canteen')}>食堂菜单</button>
      <button type="button" role="tab" aria-selected={channel==='games'} className={channel==='games'?'is-on':''} onClick={()=>setChannel('games')}>真的摸鱼</button>
    </div>
    {channel==='feed'&&<>
      {error&&<p className="inline-error" role="alert">{error} <button className="text-button" onClick={()=>load()}>重试</button></p>}{notice&&<p className="care-success" role="status">{notice}</p>}
      <div className="care-bento-layout is-full">
        <div className="care-bento-main">
          {loading&&!items.length?<div className="care-feed-loading" role="status">正在看看大家的新动态…</div>:<div className="care-bento-grid">{all.map((post,i)=><BentoCard key={post.id} post={post} variant={bentoVariants[i%bentoVariants.length]} user={user} onOpen={open} onLogin={onLogin} api={api} onLiked={liked}/>)}</div>}
          <div className="care-bento-more">{loading?'正在加载…':cursor?<button type="button" className="secondary" onClick={()=>load(true)}>加载更多动态</button>:<span>已经到底了</span>}<span className="care-bento-total">已显示 {all.length} 条</span></div>
        </div>
      </div>
    </>}
    {channel==='canteen'&&<CanteenBoard user={user} api={api} Modal={Modal} onLogin={onLogin}/>}
    {channel==='games'&&<GamesBoard/>}
    {selected&&<PostReader post={selected} items={all} api={api} Modal={Modal} user={user} onLogin={onLogin} onClose={()=>setSelected(null)} onSelect={open} onChanged={changed} onEdit={p=>{setSelected(null);setComposer(p);}}/>}
    {composer&&<PostComposer initial={composer.id?composer:null} initialValue={composer.id?null:composer} api={api} Modal={Modal} onClose={()=>setComposer(null)} onDone={post=>{setComposer(null);setNotice('已发布到摸鱼空间。');setItems(old=>[post,...old.filter(p=>p.id!==post.id)]);}}/>}
  </section>;
}

export function careBlank(){return {title:'',content:'',kind:'vent',photos:[],commentsEnabled:true,detailLayout:'auto'};}
export function CareStudio({value,onChange,onClose,onPublish,busy}){
  const [uploading,setUploading]=useState(false);
  const photos=value.photos||[];
  const patch=next=>onChange({...value,...next});
  const ready=Boolean(String(value.content||'').trim()||photos.length);
  const kindLabel=kinds[value.kind]||'心情';
  return <section className="card-studio care-studio" aria-label="倾诉卡设计">
    <header className="cs-head">
      <div className="cs-title"><span className="cs-mark care-mark" aria-hidden="true">〰</span><div><h2>倾诉卡设计</h2><small>{busy?'AI 正在整理…':'匿名展示 · 确认后才会发布'}</small></div></div>
      <button type="button" className="cs-close" aria-label="收起倾诉卡" onClick={onClose}>×</button>
    </header>
    <div className="cs-body">
      <article className="live-card card-canvas cs-card care-card card-theme-mint card-layout-standard card-radius-soft card-emphasis-normal card-background-none card-shape-standard">
        <div className="live-top cs-meta">
          <span className="cs-meta-left"><b className="cs-kind cs-kind-care">{kindLabel}</b><i className="cs-dot" aria-hidden="true"/><span>匿名展示</span></span>
          <span>{photos.length?`${photos.length} 项照片`:'仅文字'}</span>
        </div>
        <label className="cs-card-field cs-card-title"><span>标题</span><textarea rows="1" maxLength="120" disabled={busy||uploading} value={value.title||''} onChange={e=>patch({title:e.target.value.replace(/\n/g,' ')})} placeholder="给今天起个标题（可选）"/></label>
        <label className="cs-card-field"><span>想说的话</span><textarea rows="4" maxLength="1500" disabled={busy||uploading} value={value.content||''} onChange={e=>patch({content:e.target.value})} placeholder="吐个槽，记件小事，或留一段此刻的心情…"/></label>
        {photos.length>0&&<div className="care-card-photos">{photos.map((p,i)=><figure key={p.id}><MediaThumb media={p} alt={'待发布媒体 '+(i+1)}/>{i===0&&<figcaption>封面</figcaption>}</figure>)}</div>}
        <div className="live-bottom cs-tags"><span className="cs-tag accent">{kindLabel}</span><span className={'cs-tag '+(value.commentsEnabled===false?'muted':'mint')}>{value.commentsEnabled===false?'关闭留言':'允许鼓励'}</span>{value.detailLayout&&value.detailLayout!=='auto'&&<span className="cs-tag muted">{detailLayouts[value.detailLayout]}</span>}</div>
      </article>

      <div className="cs-style-card">
        <div className="cs-style-row"><span className="cs-label">分类</span><div className="cs-chips">{Object.entries(kinds).map(([key,label])=><button key={key} type="button" disabled={busy} className={value.kind===key?'on':''} onClick={()=>patch({kind:key})}>{label}</button>)}</div></div>
        <div className="cs-style-row"><span className="cs-label">版式</span><div className="cs-chips">{Object.entries(detailLayouts).map(([key,label])=><button key={key} type="button" disabled={busy} className={(value.detailLayout||'auto')===key?'on':''} onClick={()=>patch({detailLayout:key})}>{label.replace(/（.*?）/,'')}</button>)}</div></div>
        <div className="cs-style-row"><span className="cs-label">留言</span><label className="cs-check"><input type="checkbox" disabled={busy||uploading} checked={value.commentsEnabled!==false} onChange={e=>patch({commentsEnabled:e.target.checked})}/>允许同事留下鼓励</label></div>
      </div>

      <div className="care-studio-photos"><PhotoPicker photos={photos} onChange={list=>patch({photos:list})} disabled={busy} onBusy={setUploading}/></div>
      <p className="cs-hint">匿名只隐藏身份，照片里的人脸、工牌和文件不会被自动遮挡；文字会经过 AI 审核。</p>
    </div>
    <footer className="cs-foot">
      <button type="button" className="secondary cs-save" onClick={onClose}>取消</button>
      <button type="button" className="primary cs-publish" disabled={busy||uploading||!ready} onClick={onPublish}>{busy?'正在审核并发布…':'预览并发布 →'}</button>
    </footer>
  </section>;
}
export function CarePublish({value,conversationId,api,Modal,onClose,onDone}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');return <Modal title="确认发布心情帖" className="care-composer-dialog" onClose={()=>!busy&&onClose()}><MediaNotice photos={value.photos}/><PublishPreview value={value}/>{error&&<p className="inline-error" role="alert">{error}</p>}<div className="dialog-actions"><button className="secondary" disabled={busy} onClick={onClose}>返回修改</button><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await api('/care/posts',{method:'POST',body:{...payload(value),...(conversationId?{conversationId}:{})}});onDone();}catch(e){setError(e.message);}finally{setBusy(false);}}}>{busy?'正在审核并发布…':'确认发布'}</button></div></Modal>;
}
