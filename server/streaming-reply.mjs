const header=/^\s*\{\s*"version"\s*:\s*2\s*,\s*"route"\s*:\s*"(office|care)"\s*,\s*"result"\s*:/;
export const OFFICE_MARKDOWN_HEADER='{"version":3,"route":"office","format":"markdown"}\n';
function officeMarkdown(text){
  if(!text.startsWith(OFFICE_MARKDOWN_HEADER))return null;
  let body=text.slice(OFFICE_MARKDOWN_HEADER.length).trimStart();
  while(body.startsWith('<think>')){const end=body.indexOf('</think>');if(end<0)return null;body=body.slice(end+8).trimStart();}
  if(body&&'<think>'.startsWith(body))return null;
  if(/[\uD800-\uDBFF]$/.test(body))body=body.slice(0,-1);
  return body.length<=12000?body:null;
}
function modelText(text){
  let value=text.trimStart();
  while(value.startsWith('<think>')){const end=value.indexOf('</think>');if(end<0)return null;value=value.slice(end+8).trimStart();}
  return value.replace(/^```(?:json)?\s*/i,'');
}

// The trusted Answer selects a text-only office reply or the strict v2 reply field.
export function partialReply(text){
  if(text.startsWith(OFFICE_MARKDOWN_HEADER)){const body=officeMarkdown(text);return body===null?null:{text:body,route:'office'};}
  const match=header.exec(text);if(!match)return null;
  const body=modelText(text.slice(match[0].length));if(body===null)return null;
  const start=/^\{\s*"reply"\s*:\s*"/.exec(body);if(!start)return null;
  let raw='';
  for(let i=start[0].length;i<body.length;i++){
    const c=body[i];if(c==='"')break;
    if(c==='\\'){
      if(i+1>=body.length)break;
      const next=body[i+1];
      if(next==='u'){const digits=body.slice(i+2,i+6);if(digits.length<4)break;if(!/^[0-9a-f]{4}$/i.test(digits))return null;raw+=body.slice(i,i+6);i+=5;}
      else {if(!'"\\/bfnrt'.includes(next))return null;raw+=c+next;i++;}
    }else {if(c.charCodeAt(0)<32)return null;raw+=c;}
    if(raw.length>72000)return null;
  }
  try{let value=JSON.parse('"'+raw+'"');if(/[\uD800-\uDBFF]$/.test(value))value=value.slice(0,-1);return value.length<=12000?{text:value,route:match[1]}:null;}catch{return null;}
}

export function parseFastEnvelope(text){
  if(text.startsWith(OFFICE_MARKDOWN_HEADER)){
    const reply=officeMarkdown(text);if(!reply?.trim())return null;
    return {version:3,route:'office',format:'markdown',reply:reply.trim()};
  }
  const match=header.exec(text);if(!match)return null;
  const tail=text.slice(match[0].length).trim();if(!tail.endsWith('}'))return null;
  const body=modelText(tail.slice(0,-1));if(body===null)return null;
  return {version:2,route:match[1],result:JSON.parse(body.replace(/\s*```\s*$/,''))};
}
