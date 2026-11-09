// Explicit local fallback when no AI workflow is configured; never presented as semantic matching.
export function main({snapshot_json}) {
  const s=JSON.parse(snapshot_json),now=s.now;
  if(!Number.isFinite(now)||!Array.isArray(s.candidates)||s.candidates.length>2000)throw new Error('Invalid matching snapshot');
  const aliases=[['excel','电子表格','数据核对','数据整理','wps表格'],['word','文档排版','文字排版'],['ppt','powerpoint','演示文稿','幻灯片'],['python','python编程'],['plc','plc编程','博图','tia portal','siemens plc'],['电气图纸','eplan','电气设计'],['英语','英文','英文写作','翻译'],['photoshop','ps修图','图片处理'],['cad','autocad','机械制图'],['文案','文字编辑','文字校对'],['流程图','visio'],['视频剪辑','剪映']];
  const norm=v=>String(v).toLowerCase().normalize('NFKC').replace(/\s+/g,' ').trim();
  const parts=v=>norm(v).split(/[/、,，;；|]+/).filter(Boolean);
  const groups=v=>{const p=parts(v);return aliases.map((a,i)=>p.some(t=>a.some(x=>t===x||(/^[a-z]/.test(x)&&new RegExp('(^|[^a-z0-9])'+x+'(?=$|[^a-z0-9])').test(t))))?i:-1).filter(i=>i>=0);};
  const equivalent=(a,b)=>parts(a).some(x=>parts(b).includes(x))||groups(a).some(g=>groups(b).includes(g));
  const needed=(s.request.skills||[]).filter(x=>typeof x==='string'&&x.trim());
  const deadline=s.request.deadlineEnd;
  if(!needed.length||(Number.isFinite(deadline)&&deadline<=now))return {matches_json:'[]'};
  const matches=[];
  for(const c of s.candidates){
    const p=c.preferences||{},active=c.activeCount||0;
    if(!c.acceptingHelp||p.notifications===false||p.weeklyMinutes===0||active>=(p.maxActive??2))continue;
    const hits=needed.filter(n=>(c.skills||[]).some(k=>equivalent(n,k)));
    if(!hits.length)continue;
    let minutes=null,nextAt=null;
    if(p.weekdays?.length){
      minutes=0;
      const time=v=>Number(v.slice(0,2))*60+Number(v.slice(3));
      const from=time(p.start),to=time(p.end);
      const china=new Date(now+8*3600000);
      const midnight=Date.UTC(china.getUTCFullYear(),china.getUTCMonth(),china.getUTCDate())-8*3600000;
      for(let i=0;i<8;i++){
        const day=midnight+i*86400000,weekday=new Date(day+8*3600000).getUTCDay()||7;
        if(!p.weekdays.includes(weekday))continue;
        const begin=Math.max(now,day+from*60000),end=Math.min(deadline??now+7*86400000,day+to*60000);
        if(end>begin){minutes+=(end-begin)/60000;if(nextAt===null)nextAt=begin;}
      }
      minutes=Math.floor(Math.min(minutes,p.weeklyMinutes??minutes));
      if(minutes<15)continue;
    }
    const score=Math.round(70*hits.length/needed.length+(minutes===null?5:20)+Math.max(0,10-active*3));
    matches.push({candidateId:c.id,score,skills:hits,reason:'技能相符：'+hits.join('、')+'；'+(minutes===null?'空闲时间待双方确认':deadline!==null?'截止前有登记的空闲时段':'未来一周有登记的空闲时段，交付日期待确认')+'；当前接取'+active+'项',timeStatus:minutes===null?'unconfirmed':'available',nextAt});
  }
  matches.sort((a,b)=>b.score-a.score||(a.nextAt??Infinity)-(b.nextAt??Infinity)||a.candidateId.localeCompare(b.candidateId));
  return {matches_json:JSON.stringify(matches)};
}
