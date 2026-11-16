import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {HelpPreferences} from './Inbox.jsx';
import './Profile.css';

const MALL_REWARDS=[
  {key:'coffee',name:'咖啡券',cost:30,note:'园区咖啡吧'},
  {key:'tea',name:'下午茶',cost:50,note:'部门下午茶一份'},
  {key:'gift',name:'摸摸鱼周边',cost:80,note:'贴纸与帆布袋'},
];
const DEFAULT_PREFERENCES={weekdays:[],start:'12:00',end:'13:00',weeklyMinutes:60,maxActive:2,notifications:true};
const number=n=>new Intl.NumberFormat('zh-CN').format(Number.isFinite(Number(n))?Number(n):0);
const dateLabel=value=>{
  if(!value)return '';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '';
  return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'}).format(date);
};
const monthLabel=()=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric'}).format(new Date());

function RewardIcon({type}){
  if(type==='coffee')return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h12v8.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 17.5V9Z"/><path d="M4 6.5h14V9H4zM9.5 6.5v12M9.5 10.5c2.2 0 3.3-1.2 3.3-2.6-1.8 0-3.3.9-3.3 2.6Z"/></svg>;
  if(type==='tea')return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18.5h14M7 18.5v-3.2c0-3 2-5.3 5-5.3s5 2.3 5 5.3v3.2"/><path d="M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M9 14.5h6"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 11H6L5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/><path d="M9.5 12h5"/></svg>;
}
function RecordIcon({index=0}){
  if(index===1)return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3.5h9l3 3V17H4V3.5Z"/><path d="M12.5 3.5V7H16M7 10h6M7 13h4"/></svg>;
  if(index===2)return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="1.5"/><circle cx="7.2" cy="8" r="1.3"/><path d="m4 15 4-3.5 3 2.5 2.5-2L16 15"/></svg>;
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 16.5V9M8 16.5V6M13 16.5V3.5M18 16.5V11"/></svg>;
}
function Avatar({user,size='md'}){
  const initial=(user?.displayName||'鱼').trim().slice(0,1)||'鱼';
  return <span className={`pf-avatar ${size}`+(user?.avatar?' has-photo':'')} role="img" aria-label={`${user?.displayName||'同事'}的头像`}>
    {user?.avatar&&<img src={user.avatar} alt="" onError={e=>{e.currentTarget.style.display='none';}}/>}
    <span className="pf-avatar-fallback" aria-hidden="true">{initial}</span>
  </span>;
}
function Drawer({title,onClose,children,footer,className=''}){
  const ref=useRef(),closeRef=useRef(onClose);
  closeRef.current=onClose;
  useEffect(()=>{
    const old=document.activeElement,previousOverflow=document.body.style.overflow,el=ref.current;
    document.body.style.overflow='hidden';
    const frame=requestAnimationFrame(()=>el?.focus());
    const key=e=>{
      if(e.key==='Escape'){e.preventDefault();closeRef.current?.();}
      if(e.key==='Tab'){
        const list=[...el.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex]:not([tabindex="-1"])')].filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
        if(!list.length)return;
        if(e.shiftKey&&document.activeElement===list[0]){e.preventDefault();list.at(-1).focus();}
        else if(!e.shiftKey&&document.activeElement===list.at(-1)){e.preventDefault();list[0].focus();}
      }
    };
    document.addEventListener('keydown',key);
    return()=>{cancelAnimationFrame(frame);document.removeEventListener('keydown',key);document.body.style.overflow=previousOverflow;old?.focus?.();};
  },[]);
  return createPortal(<div className="pf-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section className={`pf-drawer ${className}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex="-1">
      <header className="pf-drawer-head"><h2>{title}</h2><button type="button" className="pf-close" onClick={onClose} aria-label="关闭">×</button></header>
      <div className="pf-drawer-body">{children}</div>
      {footer&&<footer className="pf-drawer-foot">{footer}</footer>}
    </section>
  </div>,document.body);
}

export function Profile({user,api,setUser,setNotice,setError,go}){
  const [overview,setOverview]=useState(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[drawer,setDrawer]=useState(''),[toggleBusy,setToggleBusy]=useState(false);
  const loadOverview=()=>{
    let live=true;
    setLoading(true);setLoadError('');
    api('/me/profile-overview').then(d=>{if(live)setOverview(d);}).catch(e=>{if(live)setLoadError(e.message);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  };
  useEffect(()=>{if(user)return loadOverview();},[user?.id]);

  if(!user)return null;
  const skills=Array.isArray(user.skills)?user.skills.filter(Boolean):[];
  const totalPoints=overview?.totalPoints;
  const stat=(value,suffix='')=>loading||!overview?'—':`${number(value)}${suffix}`;
  const toggleAccepting=async()=>{
    if(toggleBusy)return;
    const next=!user.acceptingHelp;
    setToggleBusy(true);
    setUser({...user,acceptingHelp:next});
    try{
      const d=await api('/profile',{method:'PUT',body:{acceptingHelp:next}});
      setUser(d.user);
      setNotice(next?'已开启互助邀请。':'已关闭互助邀请。');
    }catch(e){
      setUser({...user,acceptingHelp:!next});
      setError(e.message);
    }finally{setToggleBusy(false);}
  };
  return <div className="pf-page">
    <section className="pf-cover" aria-hidden="true">
      <svg className="pf-cover-art" viewBox="0 0 760 170" preserveAspectRatio="xMaxYMid slice">
        <g fill="none" stroke="#b9783d" strokeLinecap="round">
          <circle cx="610" cy="118" r="82" opacity=".16"/><circle cx="610" cy="118" r="112" opacity=".11"/><circle cx="610" cy="118" r="142" opacity=".07"/>
          <path d="M442 118c53-58 120-58 173 0-53 58-120 58-173 0Z" opacity=".34" strokeWidth="1.2"/>
          <path d="M616 118l28-24v48l-28-24Z" opacity=".34" strokeWidth="1.2"/>
          <path d="M478 118h.2M493 106c8 4 8 20 0 24M510 101c11 6 11 28 0 34" opacity=".5" strokeWidth="1.2"/>
          <path d="M0 142c76-30 134 20 216-2s134-34 214-6 146 16 214-10 96-14 116-4" opacity=".18"/>
          <path d="M0 156c90-24 150 18 236-2s146-26 220 0 150 12 214-12" opacity=".11"/>
        </g>
      </svg>
    </section>
    <div className="pf-body">
      <div className="pf-identity">
        <div className="pf-avatar-wrap">
          <Avatar user={user} size="xl"/>
          <button type="button" className="pf-cam" onClick={()=>setDrawer('edit')} aria-label="更换头像"><svg viewBox="0 0 20 20"><path d="M3 6.5h3l1.2-1.7h5.6L14 6.5h3v9H3v-9Z"/><circle cx="10" cy="10.7" r="3"/></svg></button>
        </div>
        <div className="pf-who"><h1>{user.displayName}</h1><p>{user.department}{user.acceptingHelp?' · 愿意在空闲时搭把手':' · 暂不接受互助邀请'}</p></div>
        <div className="pf-actions">
          <button type="button" className="pf-btn" onClick={()=>setDrawer('mall')}>积分商城 <span className="pf-pill accent">即将上线</span></button>
          <button type="button" className="primary" onClick={()=>setDrawer('edit')}>编辑档案</button>
        </div>
      </div>
      <p className="pf-bio">{user.bio?.trim()||'还没有个人简介。'}</p>
      {loadError&&<div className="pf-load-error" role="alert">{loadError}<button type="button" onClick={loadOverview}>重试</button></div>}
      <div className="pf-stats">
        <div><span>累计获得积分</span><strong>{stat(totalPoints)}</strong><small>积分商城即将上线</small></div>
        <div><span>完成互助</span><strong>{stat(overview?.completedCount)}<em>次</em></strong><small>{loading?'正在统计…':!overview?'暂时无法统计':`本月 ${number(overview.monthCompleted)} 次`}</small></div>
        <div><span>本月获得积分</span><strong>{stat(overview?.monthPoints)}</strong><small>{loading?'正在统计…':!overview?'暂时无法统计':`来自 ${number(overview.monthCompleted)} 次互助`}</small></div>
        <div><span>互助榜</span><strong>{loading||!overview?'—':overview.rank?overview.rank:'—'}{overview?.rank&&<em>名</em>}</strong><small>{loading?'正在统计…':!overview?'暂时无法统计':overview.rank?`本月互助榜 · ${number(overview.rankParticipants)} 位参与者`:'本月还没有已验收记录'}</small></div>
      </div>
      <div className="pf-grid">
        <div className="pf-main">
          <section className="pf-panel pf-mall">
            <div className="pf-panel-head"><div><h2>积分商城</h2><p>用每一次搭把手，换一点小确幸。</p></div><span className="pf-pill accent">即将上线</span></div>
            <div className="pf-balance"><div><span>当前积分</span><strong>{loading||!overview?'—':number(totalPoints)}</strong></div><button type="button" className="primary" onClick={()=>setDrawer('mall')}>看看能换什么</button></div>
            <div className="pf-rewards">{MALL_REWARDS.map(reward=><div className="pf-reward" key={reward.key}><span className="pf-reward-icon"><RewardIcon type={reward.key}/></span><div><b>{reward.name}</b><small>{reward.cost} 积分</small></div></div>)}</div>
            <p className="pf-fine">兑换内容为示意，正式上线后以积分商城页面为准。</p>
          </section>
          <section className="pf-panel">
            <div className="pf-panel-head"><h2>最近完成的互助</h2><button type="button" className="pf-link" onClick={()=>setDrawer('records')}>全部记录 →</button></div>
            {loading?<div className="pf-empty">正在读取互助记录…</div>:overview?.recent?.length?overview.recent.map((record,index)=><div className="pf-record" key={record.requestId}>
              <span className="pf-record-icon"><RecordIcon index={index}/></span>
              <div className="pf-record-copy"><b>{record.title}</b><span>{[...(record.skills||[]),dateLabel(record.awardedAt)].filter(Boolean).join(' · ')||'已完成互助'}</span></div>
              <div className="pf-record-point"><strong>+{record.points}</strong><small>积分</small></div>
            </div>):<div className="pf-empty">完成第一次互助后，积分和记录会出现在这里。</div>}
          </section>
        </div>
        <aside className="pf-side">
          <section className="pf-panel">
            <div className="pf-panel-head"><h2>擅长的事</h2><button type="button" className="pf-link" onClick={()=>setDrawer('edit')}>编辑</button></div>
            <div className="pf-tags">{skills.length?skills.map((skill,index)=><span className={`pf-tag${index===0?' accent':''}`} key={`${skill}-${index}`}>{skill}</span>):<span className="pf-muted">还没有填写技能</span>}</div>
            <p className="pf-hint">技能会用于匹配同事的互助需求。</p>
          </section>
          <section className="pf-panel">
            <div className="pf-panel-head"><h2>互助状态</h2></div>
            <div className="pf-switch-row"><div><b>接受互助邀请</b><span>{user.availability||'还没有填写空闲时间'}</span></div><button type="button" className={'pf-switch'+(user.acceptingHelp?' on':'')} onClick={toggleAccepting} disabled={toggleBusy} aria-pressed={!!user.acceptingHelp} aria-label="接受互助邀请"></button></div>
            <p className="pf-hint">关闭后，你仍可以主动接取公屏上的需求。</p>
          </section>
          <section className="pf-panel">
            <div className="pf-panel-head"><h2>本月小结</h2><span className="pf-pill">{monthLabel()}</span></div>
            <div className="pf-summary-row"><span>完成互助</span><b>{loading||!overview?'—':`${number(overview.monthCompleted)} 次`}</b></div>
            <div className="pf-summary-row"><span>获得积分</span><b>{loading||!overview?'—':`${number(overview.monthPoints)} 分`}</b></div>
            <div className="pf-summary-row"><span>帮助同事</span><b>{loading||!overview?'—':`${number(overview.monthOwners)} 位`}</b></div>
            {go&&<button type="button" className="pf-link pf-summary-link" onClick={()=>go('leaderboard')}>看看互助榜 →</button>}
          </section>
        </aside>
      </div>
    </div>
    {drawer==='edit'&&<ProfileEditor user={user} api={api} setUser={setUser} setNotice={setNotice} onClose={()=>setDrawer('')}/>}
    {drawer==='mall'&&<MallDrawer points={totalPoints} loading={loading} onClose={()=>setDrawer('')}/>}
    {drawer==='records'&&<RecordsDrawer api={api} onClose={()=>setDrawer('')}/>}
  </div>;
}

function ProfileEditor({user,api,setUser,setNotice,onClose}){
  const [form,setForm]=useState(()=>({
    displayName:user.displayName||'',department:user.department||'',bio:user.bio||'',
    skills:[...(user.skills||[])],
    availability:user.availability||'',acceptingHelp:!!user.acceptingHelp,
    skillDescription:user.skillDescription||'',
    helpPreferences:user.helpPreferences||DEFAULT_PREFERENCES,
  }));
  const [skill,setSkill]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[avatarBusy,setAvatarBusy]=useState(false),[avatarError,setAvatarError]=useState('');
  const change=(key,value)=>setForm(current=>({...current,[key]:value}));
  const addSkill=()=>{
    const value=skill.trim();
    if(!value)return;
    if(value.length>500){setError('技能名称最多 500 个字符。');return;}
    if(form.skills.includes(value)){setSkill('');return;}
    if(form.skills.length>=20){setError('最多填写 20 项技能。');return;}
    setForm(current=>({...current,skills:[...current.skills,value]}));
    setSkill('');
  };
  const removeSkill=value=>setForm(current=>({...current,skills:current.skills.filter(item=>item!==value)}));
  const uploadAvatar=async event=>{
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    if(!file.type.startsWith('image/')){setAvatarError('请选择图片文件。');return;}
    setAvatarBusy(true);setAvatarError('');
    try{
      const data=new FormData();data.append('file',file,file.name||'avatar.png');
      const response=await fetch('/api/profile/avatar',{method:'POST',credentials:'same-origin',body:data});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error?.message||'头像上传失败，请重试。');
      setUser(result.user);setNotice('头像已更新。');
    }catch(e){setAvatarError(e.message);}
    finally{setAvatarBusy(false);}
  };
  const removeAvatar=async()=>{
    setAvatarBusy(true);setAvatarError('');
    try{
      const response=await fetch('/api/profile/avatar',{method:'DELETE',credentials:'same-origin',headers:{'Content-Type':'application/json'}});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error?.message||'头像移除失败，请重试。');
      setUser(result.user);setNotice('已使用默认头像。');
    }catch(e){setAvatarError(e.message);}
    finally{setAvatarBusy(false);}
  };
  const save=async()=>{
    if(!form.displayName.trim()||!form.department.trim()){setError('姓名和部门不能为空。');return;}
    setBusy(true);setError('');
    try{
      const data=await api('/profile',{method:'PUT',body:{displayName:form.displayName.trim(),department:form.department.trim(),bio:form.bio.trim(),skills:form.skills,availability:form.availability.trim(),acceptingHelp:form.acceptingHelp,skillDescription:form.skillDescription.trim(),helpPreferences:form.helpPreferences}});
      setUser(data.user);setNotice('档案已保存。');onClose();
    }catch(e){setError(e.message);}
    finally{setBusy(false);}
  };
  return <Drawer title="编辑档案" onClose={onClose} footer={<><button type="button" className="secondary" onClick={onClose} disabled={busy}>取消</button><button type="button" className="primary" onClick={save} disabled={busy}>{busy?'保存中…':'保存档案'}</button></>}>
    <div className="pf-edit-avatar-row">
      <Avatar user={user} size="xl"/>
      <div className="pf-edit-avatar-copy">
        <div className="pf-edit-actions">
          <label className={'pf-upload'+(avatarBusy?' is-busy':'')}><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={uploadAvatar} disabled={avatarBusy}/>{avatarBusy?'上传中…':'上传头像'}</label>
          <button type="button" className="pf-small-btn" onClick={removeAvatar} disabled={avatarBusy||!user.avatar}>使用默认头像</button>
        </div>
        <span className="pf-sub">JPG、PNG、WebP，建议正方形；上传后会立即保存。</span>
        {avatarError&&<span className="pf-inline-error" role="alert">{avatarError}</span>}
      </div>
    </div>
    <div className="pf-field-row">
      <label className="pf-field">姓名<input value={form.displayName} maxLength={100} onChange={e=>change('displayName',e.target.value)}/></label>
      <label className="pf-field">部门<input value={form.department} maxLength={100} onChange={e=>change('department',e.target.value)}/></label>
    </div>
    <label className="pf-field">个人简介<textarea rows="3" value={form.bio} maxLength={2000} onChange={e=>change('bio',e.target.value)}/></label>
    <div className="pf-field"><span className="pf-label">擅长技能</span><div className="pf-skill-editor">{form.skills.map(item=><span className="pf-skill-chip" key={item}>{item}<button type="button" onClick={()=>removeSkill(item)} aria-label={`移除${item}`}>×</button></span>)}<input value={skill} placeholder="输入后按回车添加" onChange={e=>setSkill(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addSkill();}}}/></div><span className="pf-sub">技能会用于匹配同事的需求。</span></div>
    <label className="pf-field">空闲时间<input value={form.availability} maxLength={2000} onChange={e=>change('availability',e.target.value)}/></label>
    <div className="pf-toggle-field"><div><b>接受互助邀请</b><span>关闭后，你仍可以主动接取公屏上的需求。</span></div><button type="button" className={'pf-switch'+(form.acceptingHelp?' on':'')} onClick={()=>change('acceptingHelp',!form.acceptingHelp)} aria-pressed={!!form.acceptingHelp} aria-label="接受互助邀请"></button></div>
    <label className="pf-field">技能与经验说明<textarea rows="4" value={form.skillDescription} maxLength={2000} onChange={e=>change('skillDescription',e.target.value)}/><span className="pf-sub">仅用于匹配互助需求，不会显示在公开档案。</span></label>
    <HelpPreferences value={form.helpPreferences} onChange={value=>change('helpPreferences',value)}/>
    {error&&<p className="pf-inline-error" role="alert">{error}</p>}
  </Drawer>;
}

function MallDrawer({points,loading,onClose}){
  return <Drawer title="积分商城" onClose={onClose} footer={<><button type="button" className="secondary" onClick={onClose}>知道了</button><button type="button" className="primary" disabled>去兑换</button></>}>
    <div className="pf-mall-balance"><div><span>当前积分</span><strong>{loading?'—':number(points)}</strong></div><p>商城上线后<br/>可直接兑换</p></div>
    <div className="pf-mall-list">{MALL_REWARDS.map(reward=><div className="pf-mall-row" key={reward.key}><span className="pf-reward-icon"><RewardIcon type={reward.key}/></span><div><b>{reward.name}</b><small>{reward.note}</small></div><span className="pf-mall-cost">{reward.cost} 积分</span></div>)}</div>
    <p className="pf-note">积分在任务验收通过后按难度一次性发放，不扣发布者余额。兑换内容为示意，正式上线后以商城页面为准。</p>
  </Drawer>;
}

function RecordsDrawer({api,onClose}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{let live=true;setData(null);setError('');api('/me/points?limit=200').then(result=>{if(live)setData(result);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[reload]);
  return <Drawer title="互助与积分记录" onClose={onClose} footer={<button type="button" className="primary" onClick={onClose}>关闭</button>}>
    {error?<div className="pf-inline-error" role="alert">{error}<button type="button" className="pf-link" onClick={()=>setReload(value=>value+1)}>重试</button></div>:!data?<div className="pf-empty">正在读取积分记录…</div>:data.items.length?<><p className="pf-record-total">共 {number(data.total)} 条记录</p>{data.items.map((record,index)=><div className="pf-record" key={record.requestId}><span className="pf-record-icon"><RecordIcon index={index}/></span><div className="pf-record-copy"><b>{record.title}</b><span>{[...(record.skills||[]),dateLabel(record.awardedAt)].filter(Boolean).join(' · ')||'已完成互助'}</span></div><div className="pf-record-point"><strong>+{record.points}</strong><small>积分</small></div></div>)}</>:<div className="pf-empty">还没有已验收的互助记录。</div>}
  </Drawer>;
}
