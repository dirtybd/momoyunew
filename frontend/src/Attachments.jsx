import React,{useId,useRef} from 'react';
import {VideoAttachment,isVideoFile} from './Media.jsx';
import {FILE_LIMITS} from '../../shared/attachment-limits.mjs';

export const bytesLabel=value=>value<1024*1024?`${Math.ceil(value/1024)} KB`:`${(value/1024/1024).toFixed(1)} MB`;
export async function uploadAttachment(requestId,file) {
  const video=isVideoFile(file);if(file.size>(video?FILE_LIMITS.videoBytes:FILE_LIMITS.uploadBytes))throw new Error(`${file.name} 超过${video?'200':'50'}MB。`);
  const body=new FormData();body.append('file',file);
  const response=await fetch(`/api/requests/${requestId}/attachments`,{method:'POST',credentials:'same-origin',body});
  const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'上传失败');return data;
}
export function FilePicker({onFiles,disabled,label='上传图片或文件',imagesOnly=false,mediaOnly=false,multiple=true}) {
  const id=useId(),input=useRef();
  return <span className="file-picker"><button type="button" className="secondary" disabled={disabled} onClick={()=>input.current?.click()}><span aria-hidden="true">＋</span> {label}</button><input id={id} ref={input} className="file-input" type="file" aria-label={label} accept={imagesOnly?'image/png,image/jpeg,image/webp,image/gif':mediaOnly?'image/png,image/jpeg,image/webp,image/gif,.mp4,.webm,.mov':'.mp4,.webm,.mov,.png,.jpg,.jpeg,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.json,.xml,.zip,.7z,.rar,.dwg,.dxf,.step,.stp,.stl,.ap20,.ap21,.zap20,.zap21'} multiple={multiple} disabled={disabled} onChange={e=>{const files=[...e.target.files];e.target.value='';if(files.length)onFiles(files);}}/></span>;
}
export function FileList({files=[],editable=false,onRemove,onInclude,onAI,onCover,coverId,rewardId,disabled=false,showSharing=false}) {
  if(!files.length)return null;
  return <ul className="attachment-list">{files.map(f=><li key={f.id}>
    {f.isImage?<img className="attachment-thumb" src={f.previewUrl} alt="上传图片预览"/>:<span className="attachment-filemark" aria-hidden="true">↧</span>}
    <div className="attachment-info"><a href={f.downloadUrl}>{f.name}</a><span>{bytesLabel(f.size)}{f.id===coverId?' · 当前背景':f.id===rewardId?' · 报酬展示':''}{showSharing?(f.included?' · 提供给接取者':' · 原件仅自己可见'):''}</span>
      <div className="attachment-options">{editable&&onAI&&(f.isVideo?<span className="attachment-purpose">视频仅传递，不供AI读取</span>:(f.id===coverId||f.id===rewardId)?<span className="attachment-purpose">展示图片 · 不供AI读取、不提供原件</span>:f.aiReadable?<label className="attachment-check"><input type="checkbox" checked={f.aiEnabled} disabled={disabled} onChange={e=>onAI(f,e.target.checked)}/> AI阅读（发给模型）</label>:<span className="attachment-purpose">仅作附件，暂不支持AI阅读</span>)}
      {editable&&onInclude&&<label className="attachment-check"><input type="checkbox" checked={f.included} disabled={disabled||f.id===coverId||f.id===rewardId} onChange={e=>onInclude(f,e.target.checked)}/> 随需求提供</label>}</div>
      {f.isVideo&&<VideoAttachment file={f}/>}
    </div><div className="attachment-actions">{editable&&f.isImage&&!f.isVideo&&onCover&&<button type="button" disabled={disabled||coverId===f.id} onClick={()=>onCover(f)}>{coverId===f.id?'已用作背景':'设为卡片背景'}</button>}{editable&&onRemove&&<button type="button" disabled={disabled} onClick={()=>onRemove(f)}>移除</button>}</div>
  </li>)}</ul>;
}
