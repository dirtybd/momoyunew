// Shared with the published company's Code node; user/model text never grants actions.
export const AGENT_ROUTE_CODE=String.raw`function main({text,route_context}){
  const hints=JSON.parse(route_context);
  if(hints.careSafety==='urgent')return {route:'care'};
  const clean=String(text||'').trim().replace(/^(?:<think>[\s\S]*?<\/think>\s*)+/i,'').replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'');
  const value=JSON.parse(clean);
  if(!value||Object.keys(value).length!==1||!['office','card','care','office_chat','electrical'].includes(value.route))throw Error('路由结果无效');
  if(value.route==='care')return {route:'care'};
  if(hints.readOnlyDocuments&&hints.forceRoute!=='card'&&hints.suggestedRoute!=='card')return {route:'office_chat'};
  if(hints.readOnlyImages&&hints.forceRoute!=='card'&&hints.forceRoute!=='electrical'&&hints.suggestedRoute!=='card'&&(value.route!=='electrical'||hints.forceRoute==='office'))return {route:'office_chat'};
  if(['office','card','electrical'].includes(hints.forceRoute))return {route:hints.forceRoute};
  let selected=value.route;
  if(hints.suggestedRoute==='card'&&['office','office_chat','electrical'].includes(selected))selected='card';
  else if(hints.suggestedRoute==='office'&&['office_chat','electrical'].includes(selected)&&!(selected==='electrical'&&hints.readOnlyImages))selected='office';
  return {route:selected==='office_chat'&&hints.translationMode!=='text'&&(hints.hasMaterials||hints.hasOutputs)?'office':selected};
}`;
