import React,{useEffect,useRef,useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {FilePicker,bytesLabel} from './Attachments.jsx';
import {AgentRecommendations,AgentRecommendationFallback} from './Recommendations.jsx';
import './AssistantConversation.css';

function Copy({text,label='复制'}) {
  const [status,setStatus]=useState('');
  return <button type="button" className="copy-action" onClick={async()=>{try{await navigator.clipboard.writeText(text);setStatus('已复制');}catch{setStatus('请选择文字复制');}}}>{status||label}</button>;
}
function CodeBlock({children}) {
  const code=React.Children.toArray(children).map(c=>typeof c==='string'?c:c.props?.children||'').join('');
  return <div className="code-block"><div><span>可复制内容</span><Copy text={code}/></div><pre>{children}</pre></div>;
}
const markdownComponents={
  pre:CodeBlock,
  table:({children})=><div className="markdown-table" role="region" aria-label="回复表格，可横向滚动" tabIndex={0}><table>{children}</table></div>,
  a:({href,children})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
};
// 这些说明只显示在输入框的“/”菜单里，不写入对话正文。
// 后端在 server/electrical-agent.mjs 解析同样的命令别名。
const SLASH_COMMANDS=[
  {command:'/办公',label:'办公助手',description:'文件、文档、表格、PDF 处理；输入后直接进入办公分支'},
  {command:'/卡片',label:'卡片助手',description:'互助需求卡、任务设计；输入后直接进入卡片分支'},
  {command:'/电气',label:'电气专家',description:'TIA/PLC/变频器/选型与知识库问答；翻译请直接上传文件交给办公助手'},
];
function MarkdownContent({children}){
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{children}</ReactMarkdown></div>;
}
function AttachmentIcon({file}){
  return <svg className="chat-file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{file.isVideo?<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/></>:file.isImage?<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>:<><path d="M5 3h9l5 5v13H5ZM14 3v6h5M8 13h8M8 17h6"/></>}</svg>;
}
function MessageAttachments({files}){
  if(!files?.length)return null;
  return <div className="chat-file-row">{files.map(f=>f.unavailable||!f.downloadUrl?<span className="chat-file-chip unavailable" key={f.id}><AttachmentIcon file={f}/><b title={f.name}>{f.name}</b><small>已移除</small></span>:<a className="chat-file-chip" href={f.downloadUrl} key={f.id}><AttachmentIcon file={f}/><b title={f.name}>{f.name}</b><small>{bytesLabel(f.size)}</small>{f.aiEnabled===false&&<span className="file-saved-only" title="未提供给 AI 阅读">仅保存</span>}</a>)}</div>;
}
// 进度条的第二行：优先说明当前助手在做什么，避免一直停留在“分配助手”。
function progressHint(progress){
  if(progress?.action==='electrical'){
    if(String(progress.label||'').includes('检索'))return '正在「常见问题」「变频器故障处理」两个知识库里查找依据';
    if(String(progress.label||'').includes('翻译'))return '保留变量标记，只填写空白的目标语言列';
    return '知识库问答和故障排查由电气专家完成；翻译由办公文件助手处理';
  }
  if(progress?.action==='packet')return '马上就把结果发给你';
  if(progress?.stage==='exporting')return '结果将作为本条回复的私人附件提供下载';
  if(progress?.stage==='reading')return '根据材料回答问题或澄清需求，背景图不参与阅读';
  if(progress?.stage==='designing')return '构图、配色与装饰正在制作中';
  if(progress?.stage==='designed')return '正在整理结果，稍后就能预览';
  return '可以继续阅读前面的对话';
}
export function AssistantConversation({messages,busy,progress,streamReply='',onSend,onStop,hasCard,mode,careMode=false,careSafety='support',files=[],pendingFiles=[],onRemovePending,uploading=false,onFiles,onManageFiles}) {
  const [text,setText]=useState(''),[failed,setFailed]=useState(''),[dragging,setDragging]=useState(false);
  const chat=useRef(),input=useRef(),stick=useRef(true),dragDepth=useRef(0);
  useEffect(()=>{if(messages.length&&stick.current&&chat.current)chat.current.scrollTop=chat.current.scrollHeight;},[messages,busy,progress,streamReply]);
  useEffect(()=>{if(!busy&&messages.length)input.current?.focus({preventScroll:true});},[busy]);
  useEffect(()=>{const el=input.current;if(el){el.style.height='auto';el.style.height=Math.min(140,Math.max(44,el.scrollHeight))+'px';}},[text]);
  useEffect(()=>{if(busy||uploading){dragDepth.current=0;setDragging(false);}},[busy,uploading]);
  async function submit(e){e?.preventDefault();const original=text,value=original.trim();if(!value||busy||uploading)return;setText('');setFailed('');stick.current=true;const ok=await onSend(value);if(!ok){setText(original);setFailed(original);}input.current?.focus({preventScroll:true});}
  const isFileDrag=e=>Array.from(e.dataTransfer.types||[]).includes('Files');
  function dragEnter(e){if(!isFileDrag(e))return;e.preventDefault();dragDepth.current++;if(!busy&&!uploading)setDragging(true);}
  function dragOver(e){if(!isFileDrag(e))return;e.preventDefault();e.dataTransfer.dropEffect=busy||uploading?'none':'copy';}
  function dragLeave(){dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false);}
  function dropFiles(e){if(!isFileDrag(e))return;e.preventDefault();dragDepth.current=0;setDragging(false);if(busy||uploading)return;const dropped=Array.from(e.dataTransfer.files||[]);if(dropped.length)onFiles(dropped);}
  const suggestions=careMode?[
    {label:'最近有点累，想说说',prompt:'最近有点累，主要是……，想找个人说说，暂时不需要建议。'},
    {label:'我想整理一下此刻的心情',prompt:'我想整理一下此刻的心情：现在最强烈的感受是……，因为……，我希望……。'}
  ]:hasCard?[
    {label:'日落拍立得',prompt:'把卡片改成日落海边风格：拍立得版式，暖橙色为主，保留现有标题和正文不变。'},
    {label:'换个创意',prompt:'换一种更……（轻松 / 专业 / 温暖）的设计，发挥你的创意，保留正文和已上传的背景。'}
  ]:[
    {label:'发布一条互助请求，找人帮忙',prompt:'帮我发布一条互助请求'},
    {label:'翻译上传的项目文本（TIA / 博途）',prompt:'我上传了 TIA / 博途项目文本，请帮我翻译：目标语言是……，只填写空白的目标语言列，已有译文和变量标记保持不变，完成后返回 XLSX 副本。'},
    {label:'把上传的材料整理成一份 Word 报告',prompt:'请把我上传的材料整理成一份 Word 报告：主题是……，重点包含……，面向……，完成后把文件发给我。'}
  ];
  const slashQuery=!busy&&!careMode&&text.startsWith('/')&&!text.includes(' ')?text.slice(1).toLowerCase():null;
  const slashItems=slashQuery===null?[]:SLASH_COMMANDS.filter(item=>item.command.slice(1).toLowerCase().includes(slashQuery));
  const lastUser=[...messages].reverse().find(m=>m.role==='user')?.content||'';
  const lastAssistant=[...messages].reverse().find(m=>m.role!=='user');
  const showFallback=!careMode&&!busy&&!!lastUser&&lastAssistant?.intent==='help'&&!lastAssistant?.recommendations?.length;
  return <section className={'conversation assistant-conversation'+(dragging?' is-file-dragover':'')} onDragEnter={dragEnter} onDragOver={dragOver} onDragLeave={dragLeave} onDrop={dropFiles} onDragEnd={()=>{dragDepth.current=0;setDragging(false);}}>
    {dragging&&<div className="chat-drop-target" role="status">松开以添加附件</div>}
    <div className="panel-head chat-head"><div><h2>对话</h2><span className="chat-sub">{careMode?'心情陪伴':'工作与材料'}</span></div><span className={'chat-status'+(busy?' busy':'')}>{busy?'处理中':careMode?'陪伴中':hasCard?'已整理':mode==='dify'?'已连接':'本地模式'}</span></div>
    <div className="chat" role="log" aria-label="助手对话" aria-live="polite" ref={chat} onScroll={()=>{const el=chat.current;stick.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}}>
      {!messages.length&&<div className="chat-welcome"><div className="welcome-mark" aria-hidden="true">⌁</div><h3>{careMode?'想聊聊什么？':'想完成什么工作？'}</h3><p>{careMode?'按照自己的节奏说，不需要整理好再开口。':'可以直接交代任务，也可以上传材料。'}</p><div className="starter-list">{suggestions.map((s,i)=><button key={s.label} onClick={()=>{setText(s.prompt);input.current?.focus({preventScroll:true});}}><span>0{i+1}</span>{s.label}<b aria-hidden="true">↗</b></button>)}</div></div>}
      {messages.map((m,i)=><article className={'chat-msg '+m.role} key={i}><div className="chat-label">{m.role==='user'?'你':'摸摸鱼'}{m.role!=='user'&&<Copy text={m.content} label="复制回答"/>}</div>{m.role==='user'?<p>{m.content}</p>:<><MarkdownContent>{m.content}</MarkdownContent>{m.recommendations?.length>0&&<AgentRecommendations items={m.recommendations}/>}</>}{m.role==='user'&&<MessageAttachments files={m.attachments}/>}{m.files?.length>0&&<div className="result-files">{m.files.map(f=><a className="result-file" href={f.downloadUrl} key={f.id}><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/></svg><span><strong>{f.name}</strong><small>{bytesLabel(f.size)}</small></span><b>下载 ↓</b></a>)}</div>}</article>)}
      {showFallback&&<AgentRecommendationFallback query={lastUser}/>}
      {messages.length>0&&hasCard&&!careMode&&<div className="chat-note">卡片和对话各自保留；关掉工作台不会丢失已填内容。</div>}
      {busy&&streamReply&&<article className="chat-msg assistant is-streaming" aria-live="off"><div className="chat-label">摸摸鱼</div><MarkdownContent>{streamReply}</MarkdownContent><span className="stream-status" role="status">正在生成…</span></article>}
      {busy&&!streamReply&&<div className="agent-progress" role="status"><span className="working-dot"/><div><strong>{progress?.label||'正在理解你的描述'}</strong><span>{progressHint(progress)}</span></div></div>}
    </div>
    {messages.length>0&&!busy&&hasCard&&!careMode&&<div className="followup-actions">{suggestions.map(s=><button key={s.label} onClick={()=>{setText(s.prompt);input.current?.focus({preventScroll:true});}}>{s.label} ↗</button>)}</div>}
    <div className="chat-composer-area">
    <div className="chat-attachments compact-attachments"><FilePicker onFiles={onFiles} disabled={busy||uploading} label={uploading?'上传中…':'上传文件'}/><span className="attachment-limit">文件 ≤50MB · 视频 ≤200MB</span>{files.length>0&&<button type="button" className="attachment-manage-button" disabled={busy||uploading} onClick={onManageFiles}>管理附件（{files.length}）</button>}</div>
    {pendingFiles.length>0&&<div className="chat-pending-files" role="group" aria-label="待发送附件"><span className="pending-files-label">待发送 {pendingFiles.length}</span><div className="chat-file-row">{pendingFiles.map(f=><div className="chat-file-chip pending" key={f.id}><button type="button" className="pending-file-info" aria-label={'管理附件 '+f.name} onClick={onManageFiles} disabled={busy||uploading}><AttachmentIcon file={f}/><b title={f.name}>{f.name}</b><small>{bytesLabel(f.size)}</small>{!f.aiEnabled&&<span className="file-saved-only" title="未提供给 AI 阅读，可在管理附件中调整">仅保存</span>}</button><button type="button" className="pending-file-remove" aria-label={'移除待发送附件 '+f.name} onClick={()=>onRemovePending(f)} disabled={busy||uploading}>×</button></div>)}</div></div>}
    {slashItems.length>0&&<div className="slash-menu" role="listbox" aria-label="能力命令">{slashItems.map(item=><button type="button" role="option" aria-selected="false" key={item.command} onClick={()=>{setText(item.command+' ');input.current?.focus({preventScroll:true});}}><strong>{item.command}</strong><span>{item.label} · {item.description}</span></button>)}</div>}
    <form className="composer" onSubmit={submit}><label htmlFor="message">{careMode?'你的心情':hasCard?'继续沟通':'你的任务'}</label><textarea id="message" ref={input} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&!uploading){e.preventDefault();submit();}}} placeholder={careMode?(careSafety==='urgent'?'可以说说此刻的情况…':'想说什么都可以，按你的节奏来…'):hasCard?'继续处理文件，或补充互助需求…':'直接交代任务，也可拖入文件…'} maxLength={4000} rows="1" disabled={busy||uploading}/><div><span className="composer-shortcut">{careMode ? 'Enter 发送 · Shift+Enter 换行' : 'Enter 发送 · 输入 /，选择专业助手'}</span>{busy?<button key="stop" type="button" className="secondary" onClick={e=>{e.preventDefault();onStop();}}>停止响应 ■</button>:<button key="send" type="submit" className="primary" disabled={uploading||!text.trim()}>{failed&&text===failed?'重新发送':'发送'} ↑</button>}</div></form>
    </div>
  </section>;
}
