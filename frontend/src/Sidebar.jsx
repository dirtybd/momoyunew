import React,{useEffect,useRef,useState} from 'react';
import './Sidebar.css';
const destinations=[['board','互助公屏','M3 4h14v12H3zM6 8h8M6 12h5'],['clarify','AI 办公','M10 3v14M3 10h14'],['care','摸鱼空间','M3 5h14v10H7l-4 3z'],['mine','我的工作','M5 3h10v14H5zM8 7h4M8 11h4'],['leaderboard','互助榜','M4 17V9h3v8M9 17V3h3v14M14 17v-6h3v6'],['inbox','站内消息','M3 5h14v11H3zM3 6l7 5 7-5']];
export function NavIcon({path}){return <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path}/></svg>}
export function Sidebar({page,go,user,sessionReady,unread,onProfile,Mark,collapsed,onCollapse,open,onClose}){
 const ref=useRef(),[narrow,setNarrow]=useState(()=>window.matchMedia('(max-width:1000px)').matches);
 useEffect(()=>{const m=window.matchMedia('(max-width:1000px)'),change=()=>setNarrow(m.matches);m.addEventListener('change',change);return()=>m.removeEventListener('change',change)},[]);
 useEffect(()=>{
  if(!open||!narrow)return;
  const old=document.activeElement===document.body?document.querySelector('.nav-menu'):document.activeElement,el=ref.current,bodyOverflow=document.body.style.overflow;
  const rest=[document.querySelector('.sheet'),document.querySelector('.topbar')].filter(Boolean);const inert=rest.map(x=>x.inert);rest.forEach(x=>x.inert=true);document.body.style.overflow='hidden';
  const first=()=>[...el.querySelectorAll('button:not(:disabled)')].filter(x=>x.getClientRects().length&&getComputedStyle(x).visibility!=='hidden');
  const frame=requestAnimationFrame(()=>first()[0]?.focus({preventScroll:true}));
  const key=e=>{if(e.key==='Escape'){e.preventDefault();onClose()}if(e.key==='Tab'){const a=first();if(!el.contains(document.activeElement)){e.preventDefault();a[0]?.focus()}else if(e.shiftKey&&document.activeElement===a[0]){e.preventDefault();a.at(-1)?.focus()}else if(!e.shiftKey&&document.activeElement===a.at(-1)){e.preventDefault();a[0]?.focus()}}};
  document.addEventListener('keydown',key);return()=>{cancelAnimationFrame(frame);document.removeEventListener('keydown',key);rest.forEach((x,i)=>x.inert=inert[i]);document.body.style.overflow=bodyOverflow;old?.focus({preventScroll:true})};
 },[open,narrow]);
 const navigate=target=>{go(target);onClose()};
 return <>{open&&narrow&&<div className="nav-backdrop" onClick={onClose} aria-hidden="true"/>}<aside id="workspace-navigation" ref={ref} className={'sidebar motion-sidebar'+(collapsed?' is-collapsed':'')+(open?' is-open':'')} role={narrow&&open?'dialog':undefined} aria-modal={narrow&&open?true:undefined} aria-label={narrow?'工作台导航':undefined} inert={narrow&&!open?true:undefined}>
 <div className="nav-brand-row"><div className="brand"><Mark/><div><strong>摸摸鱼</strong><small>工作互助空间</small></div></div><button className="nav-close icon" onClick={onClose} aria-label="关闭导航">×</button></div>
 <button className="nav-collapse" onClick={()=>onCollapse(!collapsed)} aria-label={collapsed?'展开侧栏':'收起侧栏'} aria-expanded={!collapsed}><NavIcon path="M3 4h14v12H3zM8 4v12M11 8l2 2-2 2"/><span>{collapsed?'展开':'收起侧栏'}</span></button>
 <div className="side-label">工作台</div><nav aria-label="主导航">{[...destinations,...(['primary_admin','admin'].includes(user?.role)?[['admin','管理后台','M10 2l7 3v5c0 4-7 8-7 8s-7-4-7-8V5zM7 10l2 2 4-4']]:[])].map(([target,label,path])=><button key={target} title={collapsed?label:undefined} aria-label={target==='inbox'&&unread>0?`${label}，${unread}条未读`:label} aria-current={page===target?'page':undefined} className={page===target?'active':''} disabled={!sessionReady&&target!=='board'&&target!=='care'} onClick={()=>navigate(target)}><NavIcon path={path}/><span className="nav-label">{label}</span>{target==='inbox'&&unread>0&&<b className="unread-badge">{unread>99?'99+':unread}</b>}</button>)}</nav>
 <div className="side-bottom"><div className="side-note"><span className="line-fish">〰</span><strong>有空，搭把手。</strong></div><button className="account" aria-label={user?'个人档案':'登录 / 注册'} onClick={()=>{onProfile();onClose()}} disabled={!sessionReady}><span className="avatar">{user?.displayName?.slice(0,1)||'鱼'}</span><span className="account-copy"><b>{user?.displayName||(sessionReady?'登录 / 注册':'加载中…')}</b><small>{user?.department||'登录后参与互助'}</small></span></button></div>
 </aside></>;
}
