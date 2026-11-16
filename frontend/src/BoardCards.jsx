import React from 'react';
import {backgroundFile} from '../../shared/card-backgrounds.mjs';

const statusLabels={open:'待接取',claimed:'进行中',submitted:'待验收',changes_requested:'需要修改',completed:'已完成',cancelled:'已取消'};
const statusClass={open:'open',claimed:'claimed',submitted:'submitted',changes_requested:'changes',completed:'done',cancelled:'muted'};
const dateLabel=value=>{
 if(!value)return '时间待商量';
 const date=new Date(value);
 return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'short',day:'numeric'}).format(date);
};
export const coverUrl=request=>{
 if(request.cardCover?.url)return request.cardCover.url;
 if(request.cardArtwork?.id)return `/api/requests/${encodeURIComponent(request.id)}/artwork.svg?v=${request.cardArtwork.id}`;
 const preset=backgroundFile(request.cardStyle?.background);
 if(preset)return `/card-backgrounds/${preset}.png`;
 return null;
};
export const themeOf=request=>['orange','ink','mint','sand','rose','sky'].includes(request.cardStyle?.theme)?request.cardStyle.theme:(request.source==='official'?'ink':'orange');
export const isNewRequest=request=>!request.isDemo&&request.status==='open'&&request.createdAt&&Date.now()-new Date(request.createdAt).getTime()<24*60*60*1000;

function DifficultyMeter({score}){
 if(!Number.isInteger(score))return <span className="demand-difficulty is-pending">难度待评估</span>;
 return <span className="demand-difficulty" aria-label={`难度 ${score}/5`}>难度<span className="demand-meter" aria-hidden="true">{Array.from({length:5},(_,i)=><i key={i} className={i<score?'on':''}/>)}</span>{score}/5</span>;
}

export function DemandCard({request,onOpen,isNew=false}){
 const cover=coverUrl(request),theme=themeOf(request);
 const points=Number.isInteger(request.rewardPoints)?request.rewardPoints:null;
 const score=request.difficulty?.status==='scored'?request.difficulty.score:null;
 const label=request.kind==='announcement'?'公告':(statusLabels[request.status]||request.status);
 const tone=request.kind==='announcement'?'muted':(statusClass[request.status]||'open');
 return <button type="button" className="demand-card" onClick={()=>onOpen(request)} title={request.title}>
  <span className="demand-top"><span className="demand-source"><i className={'demand-dot tone-'+theme}/>{request.source==='official'?'官方发布':'员工互助'}{isNew&&<em className="demand-new">新</em>}{request.isDemo&&<em className="demand-demo">演示</em>}</span><span className={'demand-status is-'+tone}>{label}</span></span>
  <span className="demand-body"><span className={'demand-thumb '+(cover?'has-image':'tone-'+theme)} style={cover?{backgroundImage:`url("${cover}")`}:undefined} aria-hidden="true">{cover?null:'⌁'}</span><span className="demand-copy"><strong>{request.title}</strong><span>{request.problem||'详情待补充'}</span></span></span>
  <span className="demand-meta"><span className="demand-owner">{request.anonymous?'匿名同事':request.owner?request.owner.displayName:'同事'}</span><span>{dateLabel(request.deadline)}</span><span className="demand-views">{request.viewCount||0} 人看过</span>{(request.skills||[]).slice(0,3).map(skill=><em className="demand-chip" key={skill}>{skill}</em>)}{!(request.skills||[]).length&&<em className="demand-chip is-muted">技能待补充</em>}</span>
  <span className="demand-foot"><span className="demand-points"><span>验收积分</span><b>{points??'—'}</b>{points===null&&<em>评估中</em>}{!request.isDemo&&Number.isInteger(score)&&<DifficultyMeter score={score}/>}</span><span className="demand-open">查看详情 ↗</span></span>
 </button>;
}

export function DemandGrid({requests,onOpen}){
 return <div className="demand-grid">{requests.map(request=><DemandCard key={request.id} request={request} onOpen={onOpen} isNew={isNewRequest(request)}/>)}</div>;
}

export function BoardOverview({requests}){
 const open=requests.filter(r=>r.source==='employee'&&r.status==='open'&&r.kind!=='announcement').length;
 const claimed=requests.filter(r=>r.source==='employee'&&r.status==='claimed').length;
 const completed=requests.filter(r=>r.source==='employee'&&r.status==='completed').length;
 const latestCompleted=requests.find(r=>r.source==='employee'&&r.status==='completed');
 return <section className="rail-card board-overview" aria-label="公屏概览">
  <h3>公屏概览</h3>
  <div className="rail-stats"><div><b>{open}</b><span>待接取</span></div><div><b>{claimed}</b><span>进行中</span></div><div><b>{completed}</b><span>已完成</span></div></div>
  {latestCompleted&&<div className="rail-recent"><span>最近完成</span><b>{latestCompleted.title}</b></div>}
 </section>;
}

export function OfficialRail({items,onOpen}){
 return <section className="rail-card rail-official" aria-label="官方发布">
  <div className="rail-head"><h3>官方发布</h3><span>{items.length} 条</span></div>
  {items.slice(0,4).map(request=><button type="button" className="rail-official-row" key={request.id} onClick={()=>onOpen(request)} title={request.title}><span className="rail-tag">{request.kind==='announcement'?'公告':'悬赏'}</span><strong>{request.title}</strong><small>{dateLabel(request.createdAt)} · 查看 ↗</small></button>)}
  {!items.length&&<p className="rail-empty">暂无官方发布。</p>}
 </section>;
}
