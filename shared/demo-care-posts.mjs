const photo=(name,id)=>({id,url:'/card-backgrounds/'+name+'.png'});
const base={isDemo:true,anonymous:true,isMine:false,commentsEnabled:false,commentCount:0,createdAt:'2026-11-05T04:00:00.000Z'};
export const DEMO_CARE_POSTS=[
  {...base,id:'demo-care-coast',kind:'moment',title:'忙完以后，想看看远处的风景',content:'事情一件接一件的时候，容易觉得世界只剩下眼前的进度。\n\n给自己留一点远眺的时间，不一定要去很远的地方。走到窗边、绕一段路、看看天，也算是今天照顾过自己了。',photos:[photo('coast','demo-coast'),photo('mountain','demo-mountain')]},
  {...base,id:'demo-care-vent',kind:'vent',title:'今天的待办，怎么又自己长出来了',content:'刚划掉一项，转头又多了两项。今天最想拥有的技能，是让“顺便再改一下”自动排到明天。\n\n吐槽归吐槽，还是决定先做完最重要的那件事。剩下的，和明天的自己商量。',photos:[]},
  {...base,id:'demo-care-mood',kind:'mood',title:'有件小事，值得记下来',content:'卡了半天的问题，换个角度终于想通了。没有多么惊天动地，但那一刻真的松了一口气。\n\n想把这个小小的完成感留在这里。也希望你今天有一件能让自己说“还不错”的事。',photos:[]},
  {...base,id:'demo-care-mountain',kind:'moment',title:'把视线从屏幕移开一会儿',content:'偶尔抬头，才发现远处的光已经变了。\n\n工作可以认真，休息也可以认真。今天的小目标：给自己留一段不用急着回复消息的时间。',photos:[photo('mountain','demo-mountain-2'),photo('coast','demo-coast-2')]},
  {...base,id:'demo-care-fish',kind:'vent',title:'脑子：收到。身体：再缓缓。',content:'今日状态如图。不是不想努力，是希望努力之前能先充一会儿电。\n\n允许自己有一点低电量，再从最小的那一步开始。',photos:[photo('meme','demo-meme')]},
  {...base,id:'demo-care-small',kind:'mood',title:'准时收工，也是一种完成',content:'今天没有把所有事情都做完，但把轻重缓急说清楚了，也为明天留好了接着做的位置。\n\n好好吃饭、好好休息，不需要等所有待办都清零。',photos:[]},
];
