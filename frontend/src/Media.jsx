import React,{useEffect,useRef,useState} from 'react';
import './Media.css';
export const isVideoFile=f=>f.type?.startsWith('video/')||/\.(mp4|webm|mov)$/i.test(f.name||'');
export function VideoPlayer({src,downloadUrl=src,label='视频'}){
 const ref=useRef(),[failed,setFailed]=useState(false);
 useEffect(()=>{setFailed(false);const video=ref.current;return()=>video?.pause()},[src]);
 return <div className="video-player" onTouchStart={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}>{!failed&&<video ref={ref} key={src} src={src} controls playsInline preload="metadata" aria-label={label} onError={()=>setFailed(true)} onKeyDown={e=>e.stopPropagation()}/>}{failed&&<p className="field-hint">浏览器无法播放此视频，可下载后查看。</p>}<a href={downloadUrl} download>下载视频</a></div>;
}
export function VideoThumb(){return <span className="video-thumb" aria-hidden="true"><svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="5" width="28" height="22" rx="4"/><path d="m13 11 9 5-9 5z"/></svg><span>视频</span></span>}
export function VideoAttachment({file}){const [open,setOpen]=useState(false);return <details className="video-attachment" onToggle={e=>setOpen(e.currentTarget.open)}><summary>预览视频</summary>{open&&<VideoPlayer src={file.playbackUrl||file.downloadUrl} downloadUrl={file.downloadUrl} label={file.name}/>}</details>}
