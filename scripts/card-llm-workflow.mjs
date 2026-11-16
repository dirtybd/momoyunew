import {withCardMaterialReading} from './card-material-workflow.mjs';
import {cardLLMPrompt} from './build-card-agent-prompt.mjs';
import {FAST_MODEL} from './non-thinking-models.mjs';
import {withImageVision} from './image-vision-workflow.mjs';

export const CARD_RESULT_CODE=String.raw`function main({text}){
 let value=text.trim();const fence=String.fromCharCode(96).repeat(3);
 if(value.startsWith(fence)&&value.endsWith(fence)){value=value.slice(3,-3).trim();if(value.toLowerCase().startsWith('json'))value=value.slice(4).trim();}
 const result=JSON.parse(value),allowed=['reply','card','cardStyle','coverAttachmentId'];
 if(!result||Array.isArray(result)||typeof result.reply!=='string'||!result.reply.trim()||result.reply.length>12000||Object.keys(result).some(k=>!allowed.includes(k)))throw Error('卡片答复格式无效');
 const card=result.card??null;
 if(card!==null){
  const strings={title:200,problem:2000,desiredOutcome:2000},arrays=['deliverables','acceptanceCriteria','materials','constraints','skills'];
  if(typeof card!=='object'||Array.isArray(card)||Object.keys(card).some(k=>!Object.hasOwn(strings,k)&&!arrays.includes(k)&&k!=='deadline'))throw Error('卡片字段无效');
  for(const k of Object.keys(strings))if(card[k]!==undefined&&(typeof card[k]!=='string'||card[k].length>strings[k]))throw Error('卡片文字字段无效');
  for(const k of arrays)if(card[k]!==undefined&&(!Array.isArray(card[k])||card[k].length>20||card[k].some(x=>typeof x!=='string'||x.length>500)))throw Error('卡片列表字段无效');
  if(card.deadline!==undefined&&card.deadline!==null&&(typeof card.deadline!=='string'||card.deadline.length>100))throw Error('卡片时间字段无效');
 }
 return {answer_json:JSON.stringify({...result,card}),deliverables:[],artifact_json:''};
}`;

export function withCardLLM(graph,{model=FAST_MODEL}={}){
 const next=graph.nodes.some(n=>n.data.type==='agent')?withCardMaterialReading(graph):structuredClone(graph);
 const agent=next.nodes.find(n=>n.data.type==='agent'),end=next.nodes.find(n=>n.data.type==='end');
 if(!end||!next.nodes.some(n=>n.id==='card_material_context'))throw Error('卡片工作流缺少材料整理或结束节点');
 const remove=new Set([agent?.id,'card_llm','card_fields','card_images']);next.nodes=next.nodes.filter(n=>!remove.has(n.id));next.edges=next.edges.filter(e=>!remove.has(e.source)&&!remove.has(e.target));
 const make=(id,type,title,x,data)=>({id,type:'custom',position:{x,y:280},data:{type,title,desc:'',...data}});
 next.nodes.push(make('card_llm','llm','澄清需求与整理卡片',1440,{model:{provider:'langgenius/openai_api_compatible/openai_api_compatible',name:model,mode:'chat',completion_params:{temperature:0.2,max_tokens:4096,enable_thinking:false}},prompt_template:[{role:'system',text:cardLLMPrompt()},{role:'user',text:'{{#card_material_context.text#}}'}],context:{enabled:false,variable_selector:[]},vision:{enabled:false},structured_output_enabled:false,reasoning_format:'separated',retry_config:{retry_enabled:true,max_retries:1,retry_interval:1000}}));
 next.nodes.push(make('card_fields','code','校验卡片字段',1720,{code_language:'javascript',code:CARD_RESULT_CODE,variables:[{variable:'text',value_selector:['card_llm','text'],value_type:'string'}],outputs:{answer_json:{type:'string',children:null},deliverables:{type:'array[object]',children:null},artifact_json:{type:'string',children:null}}}));
 end.data.outputs=['answer_json','deliverables','artifact_json'].map(variable=>({variable,value_selector:['card_fields',variable],value_type:variable==='deliverables'?'array[object]':'string'}));end.position={x:2000,y:280};
 const edge=(source,target,sourceType,targetType)=>({id:source+'-'+target,source,target,sourceHandle:'source',targetHandle:'target',type:'custom',data:{sourceType,targetType}});
 next.edges.push(edge('card_material_context','card_llm','code','llm'),edge('card_llm','card_fields','llm','code'),edge('card_fields',end.id,'code','end'));
 return withImageVision(next,'card');
}
