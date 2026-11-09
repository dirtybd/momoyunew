// Hard constraints never depend on a model's suitability judgement.
export function eligibleCandidates(snapshot){
  const now=snapshot.now,deadline=snapshot.request.deadlineEnd;
  if(!Number.isFinite(now)||(Number.isFinite(deadline)&&deadline<=now))return [];
  const out=[];
  for(const c of snapshot.candidates){
    const p=c.preferences||{},active=c.activeCount||0;
    if(!c.acceptingHelp||p.notifications===false||p.weeklyMinutes===0||active>=(p.maxActive??2))continue;
    let minutes=null,nextAt=null;
    if(p.weekdays?.length){
      minutes=0;
      const time=v=>Number(v.slice(0,2))*60+Number(v.slice(3));
      const from=time(p.start),to=time(p.end),china=new Date(now+28800000);
      const midnight=Date.UTC(china.getUTCFullYear(),china.getUTCMonth(),china.getUTCDate())-28800000;
      for(let i=0;i<8;i++){
        const day=midnight+i*86400000,weekday=new Date(day+28800000).getUTCDay()||7;
        if(!p.weekdays.includes(weekday))continue;
        const begin=Math.max(now,day+from*60000),end=Math.min(deadline??now+7*86400000,day+to*60000);
        if(end>begin){minutes+=(end-begin)/60000;if(nextAt===null)nextAt=begin;}
      }
      minutes=Math.floor(Math.min(minutes,p.weeklyMinutes??minutes));
      if(minutes<15)continue;
    }
    out.push({candidateId:c.id,timeStatus:minutes===null?'unconfirmed':'available',nextAt,activeCount:active});
  }
  return out;
}
