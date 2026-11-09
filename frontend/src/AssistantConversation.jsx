import React,{useEffect,useRef,useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {FilePicker,bytesLabel} from './Attachments.jsx';
import {AgentRecommendations,AgentRecommendationFallback} from './Recommendations.jsx';
import {FILE_LIMITS} from '../../shared/attachment-limits.mjs';

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
function MarkdownContent({children}){
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{children}</ReactMarkdown></div>;
}
export function AssistantConversation({messages,busy,progress,streamReply='',onSend,onStop,hasCard,mode,careMode=false,careSafety='support',files=[],uploading=false,onFiles,onManageFiles}) {
  const [text,setText]=useState(''),[failed,setFailed]=useState('');
  const chat=useRef(),input=useRef(),stick=useRef(true);
  useEffect(()=>{if(messages.length&&stick.current&&chat.current)chat.current.scrollTop=chat.current.scrollHeight;},[messages,busy,progress,streamReply]);
  useEffect(()=>{if(!busy&&messages.length)input.current?.focus({preventScroll:true});},[busy]);
  useEffect(()=>{const el=input.current;if(el){el.style.height='auto';el.style.height=Math.min(140,Math.max(44,el.scrollHeight))+'px';}},[text]);
  async function submit(e){e?.preventDefault();const value=text.trim();if(!value||busy)return;setText('');setFailed('');stick.current=true;const ok=await onSend(value);if(!ok){setText(value);setFailed(value);}input.current?.focus({preventScroll:true});}
  const suggestions=careMode?['最近有点累，想说说','我想整理一下此刻的心情']:hasCard?['设计成日落海边的拍立得，暖橙色，保留正文','换一种更有趣的设计，发挥你的创意']:['把上传的材料整理成一份Word报告','把上传的图片合并成PDF并返回文件','帮我检查并修改表格内容'];
  const lastUser=[...messages].reverse().find(m=>m.role==='user')?.content||'';
  const lastAssistant=[...messages].reverse().find(m=>m.role!=='user');
  const showFallback=!careMode&&!busy&&!!lastUser&&!lastAssistant?.recommendations?.length;
  return <section className="conversation assistant-conversation">
    <div className="panel-head"><div className="assistant-identity"><span className="assistant-fish" aria-hidden="true">⌁</span><div><h2>摸摸鱼助手</h2><span>{mode==='dify'?(careMode?'倾听与陪伴':'直接工作 · 文件处理'):'本地引导 · AI 未连接'}</span></div></div><span className="connection-label"><i/>{busy?'处理中':mode==='dify'?'已连接':'本地模式'}</span></div>
    <div className="chat" role="log" aria-label="助手对话" aria-live="polite" ref={chat} onScroll={()=>{const el=chat.current;stick.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}}>
      {!messages.length&&<div className="chat-welcome"><div className="welcome-mark" aria-hidden="true">⌁</div><h3>{careMode?'想聊聊什么？':'想完成什么工作？'}</h3><p>{careMode?'按照自己的节奏说，不需要整理好再开口。':'可以直接交代任务，也可以上传材料。'}</p><div className="starter-list">{suggestions.map((s,i)=><button key={s} onClick={()=>{setText(s);input.current?.focus({preventScroll:true});}}><span>0{i+1}</span>{s}<b aria-hidden="true">↗</b></button>)}</div></div>}
      {messages.map((m,i)=><article className={'chat-msg '+m.role} key={i}><div className="chat-label">{m.role==='user'?'你':'摸摸鱼'}{m.role!=='user'&&<Copy text={m.content} label="复制回答"/>}</div>{m.role==='user'?<p>{m.content}</p>:<><MarkdownContent>{m.content}</MarkdownContent>{m.recommendations?.length>0&&<AgentRecommendations items={m.recommendations}/>}</>}{m.files?.length>0&&<div className="result-files">{m.files.map(f=><a className="result-file" href={f.downloadUrl} key={f.id}><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/></svg><span><strong>{f.name}</strong><small>{bytesLabel(f.size)}</small></span><b>下载 ↓</b></a>)}</div>}</article>)}
      {showFallback&&<AgentRecommendationFallback query={lastUser}/>}
      {busy&&streamReply&&<article className="chat-msg assistant is-streaming" aria-live="off"><div className="chat-label">摸摸鱼</div><MarkdownContent>{streamReply}</MarkdownContent><span className="stream-status" role="status">正在生成…</span></article>}
      {busy&&!streamReply&&<div className="agent-progress" role="status"><span className="working-dot"/><div><strong>{progress?.label||'正在理解你的描述'}</strong><span>{progress?.stage==='exporting'?'结果将作为本条回复的私人附件提供下载':progress?.stage==='reading'?'根据材料回答问题或澄清需求，背景图不参与阅读':progress?.stage==='designing'?'构图、配色与装饰正在制作中':progress?.stage==='designed'?'正在整理结果，稍后就能预览':'可以继续阅读前面的对话'}</span></div></div>}
    </div>
    {messages.length>0&&!busy&&hasCard&&!careMode&&<div className="followup-actions">{suggestions.map(s=><button key={s} onClick={()=>{setText(s);input.current?.focus({preventScroll:true});}}>{s.startsWith('换')?'换个创意':'日落拍立得'} ↗</button>)}</div>}
    <div className="chat-attachments compact-attachments"><FilePicker onFiles={onFiles} disabled={busy||uploading} label={uploading?'上传中…':'上传附件'}/><span className="attachment-limit">文件50MB · 视频200MB · AI读取≤{FILE_LIMITS.aiCount}个</span>{files.length>0&&<button type="button" className="attachment-manage-button" disabled={busy||uploading} onClick={onManageFiles}><span>{files.length} 个附件</span><span className="files-ai-count">AI阅读 {files.filter(f=>f.aiEnabled).length}/{FILE_LIMITS.aiCount}</span><span aria-hidden="true">↗</span></button>}</div>
    <form className="composer" onSubmit={submit}><label htmlFor="message">{careMode?'你的心情':hasCard?'继续沟通':'你的任务'}</label><textarea id="message" ref={input} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&!uploading){e.preventDefault();submit();}}} placeholder={careMode?(careSafety==='urgent'?'可以说说此刻的情况…':'想说什么都可以，按你的节奏来…'):hasCard?'继续处理文件，或补充互助需求…':'直接交代任务，或上传文件让我处理…'} maxLength={4000} rows="1" disabled={busy||uploading}/><div><span className="composer-shortcut">Enter 发送 · Shift+Enter 换行</span>{busy?<button key="stop" type="button" className="secondary" onClick={e=>{e.preventDefault();onStop();}}>停止响应 ■</button>:<button key="send" type="submit" className="primary" disabled={uploading||!text.trim()}>{failed&&text===failed?'重新发送':'发送'} ↑</button>}</div></form>
  </section>;
}
