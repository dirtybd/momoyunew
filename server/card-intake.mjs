export const CARD_INTAKE_REPLY='可以，我先了解这次需要协助的事项，整理成求助卡后由你确认发布。\n\n1. 你目前遇到了什么具体问题？\n2. 希望同事帮你完成什么、交付什么结果？';

export function isEmptyCardStart(message){
 const text=String(message||'').normalize('NFKC').trim().replace(/^\/卡片\s*/, '');
 const start=/^(?:(?:请|帮我|麻烦|我想|我希望|我要|想要|需要|先|我)\s*)*(?:发布|发起|创建|新建|整理|制作|做|提交|发)(?:一条|一张|一个|一下|条|张)?(?:互助请求|互助需求|求助请求|求助需求|求助卡|需求卡|互助卡)/.exec(text);
 if(!start)return false;
 const remainder=text.slice(start[0].length)
  .replace(/(?:要解决的问题|希望达成的结果|期望结果|交付物|截止时间|所需经验)/g,'')
  .replace(/(?:关于|希望达成|希望得到|需要具备|经验的同事帮忙|同事帮忙|是|为)/g,'')
  .replace(/[\s.…，。,:：;；!！?？_—()（）\[\]【】{}<>《》-]/g,'');
 return !remainder;
}

export function initialCardClarification(message,{card={},history=[],attachmentCount=0,outputCount=0}={}){
 if(card.title||card.problem||card.desiredOutcome||card.careMode||card.careSafety==='urgent'||attachmentCount||outputCount||!isEmptyCardStart(message))return null;
 if(history.some(m=>m.role==='user'&&!isEmptyCardStart(m.content)))return null;
 return {intent:'request',reply:CARD_INTAKE_REPLY,card:null,ready:false,suppressRecommendations:true,conversations:[],outputFiles:[]};
}
