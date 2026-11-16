import fs from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {OFFICE_MARKDOWN_HEADER} from '../server/streaming-reply.mjs';
import {AGENT_ROUTE_CODE} from '../shared/agent-routing.mjs';
import {withCardMaterialsInput} from './card-material-workflow.mjs';
import {fastWorkflowModel} from './non-thinking-models.mjs';
import {withImageVision} from './image-vision-workflow.mjs';

export function makeChatflow(tools){
  const roles=['office','card'],branches=[...roles,'care','office_chat'];
  for(const role of roles)if(!tools[role]?.providerId||!tools[role]?.toolName)throw Error('请提供已发布的 '+role+' Workflow工具标识');
  const node=(id,type,title,x,y,data)=>({id,type:'custom',position:{x,y},positionAbsolute:{x,y},width:244,height:98,sourcePosition:'right',targetPosition:'left',data:{type,title,desc:'',...data}});
  const edge=(source,target,sourceType,targetType,handle='source')=>({id:source+'-'+target,type:'custom',source,target,sourceHandle:handle,targetHandle:'target',data:{sourceType,targetType,isInIteration:false,isInLoop:false}});
  // 注意：线上「同频」的统一 Chatflow 已比本构建函数多一个 electrical 分支
  // （roster_agent `01a1c474-…` + 专用 packet 节点），且工具 ID 也已变化。
  // 在把 electrical 分支和最新工具 ID 补进来之前，不要用本脚本重新发布线上 Chatflow。
  const routeCode=AGENT_ROUTE_CODE;
  const packetCode=role=>String.raw`function main({data,files}){
    if(!Array.isArray(data)||data.length!==1||!data[0]||typeof data[0].answer_json!=='string'||typeof data[0].artifact_json!=='string')throw Error('专业工作流结果无效');
    const result=JSON.parse(data[0].answer_json);
    if(!result||typeof result.reply!=='string'||(result.readyForPreview!==undefined&&typeof result.readyForPreview!=='boolean'))throw Error('专业助手回复无效');
    const actualFiles=files||[];
    if(!Array.isArray(actualFiles)||actualFiles.length>5)throw Error('成果文件过多');
    if('${role}'==='care'&&(result.intent!=='care'||actualFiles.length||data[0].artifact_json!==''))throw Error('情感助手结果越界');
    return {packet:JSON.stringify({version:1,route:'${role}',answer_json:data[0].answer_json,files:actualFiles,artifact_json:data[0].artifact_json})};
  }`;
  const variable=(variable,selector,type)=>({variable,value_selector:selector,value_type:type});
  const code=(source,variables,output)=>({code_language:'javascript',code:source,variables,outputs:{[output]:{type:'string',children:null}}});
  const nodes=[
    node('start','start','本轮对话与私密上下文',0,220,{variables:[...['context_file','care_context_file'].map(variable=>({variable,label:variable==='care_context_file'?'私密关怀上下文':'工作上下文',type:'file',required:true,allowed_file_types:['document'],allowed_file_extensions:['.txt','.json'],allowed_file_upload_methods:['local_file']})),...['office_text','care_text'].map(variable=>({variable,label:variable==='care_text'?'关怀对话':'办公对话',type:'paragraph',required:true,max_length:60000,default:''})),{variable:'route_context',label:'路由上下文',type:'paragraph',required:true,max_length:6000,default:''}]}),
    node('classify','llm','识别当前任务',320,220,{model:fastWorkflowModel({temperature:0.1,max_tokens:4096}),
      prompt_template:[{role:'system',text:fs.readFileSync(new URL('../docs/dify-config/routing-prompt.txt',import.meta.url),'utf8')},
        {role:'user',text:'当前分支：{{#conversation.active_route#}}\n最近任务状态及对话：{{#start.route_context#}}\n本轮用户原文：{{#sys.query#}}'}],context:{enabled:false,variable_selector:[]},vision:{enabled:false},reasoning_format:'separated',structured_output_enabled:false,retry_config:{max_retries:1,retry_enabled:true,retry_interval:1000}}),
    node('route','code','校验分发结果',640,220,code(routeCode,[variable('text',['classify','text'],'string'),variable('route_context',['start','route_context'],'string')],'route')),
    node('state','assigner','记录当前任务分支',960,220,{version:'2',items:[{variable_selector:['conversation','active_route'],input_type:'variable',operation:'over-write',value:['route','route']}]}),
    node('branch','if-else','选择专业助手',1280,220,{cases:branches.map(role=>({case_id:role,logical_operator:'and',conditions:[{id:role,varType:'string',variable_selector:['route','route'],comparison_operator:'is',value:role}]}))}),
  ];
  const edges=[edge('start','classify','start','llm'),edge('classify','route','llm','code'),edge('route','state','code','assigner'),edge('state','branch','assigner','if-else')];
  for(const [index,role] of roles.entries()){
    const title=({office:'办公任务',card:'卡片任务',care:'情感支持'})[role],tool=tools[role],y=index*250;
    const parameters={context_file:{type:'variable',value:['start',role==='care'?'care_context_file':'context_file']},...(role==='care'?{}:{materials:{type:'variable',value:['sys','files']}}),...(role==='office'?{task_json:{type:'variable',value:['start','office_text']}}:{})};
    nodes.push(node(role,'tool',title,1600,y,{provider_id:tool.providerId,provider_type:'workflow',provider_name:tool.label||title,tool_name:tool.toolName,tool_label:tool.label||title,tool_node_version:'2',tool_configurations:parameters,is_team_authorization:true,tool_parameters:parameters}));
    nodes.push(node(role+'_packet','code','整理'+title+'结果',1920,y,code(packetCode(role),[variable('data',[role,'json'],'array[object]'),variable('files',[role,'files'],'array[file]')],'packet')));
    nodes.push(node(role+'_answer','answer','返回'+title+'结果',2240,y,{answer:'{{#'+role+'_packet.packet#}}'}));
    edges.push(edge('branch',role,'if-else','tool',role),edge(role,role+'_packet','tool','code'),edge(role+'_packet',role+'_answer','code','answer'));
  }
  for(const [index,role] of ['care','office_chat'].entries()){
    const id=role==='care'?'care_fast':'office_fast',title=role==='care'?'情感流式回答':'办公流式回答',prompt=role==='care'?'care-fast-prompt.txt':'office-fast-prompt.txt';
    nodes.push(node(id,'llm',title,1600,500+index*250,{model:fastWorkflowModel({temperature:0.3,max_tokens:4096}),prompt_template:[{role:'system',text:fs.readFileSync(new URL('../docs/dify-config/'+prompt,import.meta.url),'utf8')},{role:'user',text:'{{#start.'+(role==='care'?'care_text':'office_text')+'#}}'}],context:{enabled:false,variable_selector:[]},vision:{enabled:false},reasoning_format:'separated',structured_output_enabled:false}));
    nodes.push(node(role+'_answer','answer','流式返回'+title,1920,500+index*250,{answer:role==='care'?'{"version":2,"route":"care","result":{{#care_fast.text#}}}':OFFICE_MARKDOWN_HEADER+'{{#office_fast.text#}}'}));
    edges.push(edge('branch',id,'if-else','llm',role),edge(id,role+'_answer','llm','answer'));
  }
  nodes.push(node('legacy_answer','answer','委派原助手',1600,1000,{answer:'{"version":1,"route":"legacy"}'}));
  edges.push(edge('branch','legacy_answer','if-else','answer','false'));
  const app={version:'0.7.0',kind:'app',app:{name:'摸摸鱼·统一对话入口',mode:'advanced-chat',icon:'🐟',icon_background:'#FFF1E6',description:'办公、互助卡与独立情感支持分发；权限和发布由网站校验。',use_icon_as_answer_icon:false},dependencies:[],
    workflow:{environment_variables:[],conversation_variables:[{id:'5edb8b6e-e23a-4877-a620-372b61cefb41',name:'active_route',value_type:'string',value:'office',description:'当前任务分支，只辅助路由；正式任务状态由网站后端维护。',selector:['conversation','active_route']}],features:{file_upload:{enabled:true,number_limits:10,allowed_file_types:['document','image'],allowed_file_extensions:[],allowed_file_upload_methods:['local_file'],image:{enabled:true}},opening_statement:'',retriever_resource:{enabled:false},sensitive_word_avoidance:{enabled:false},speech_to_text:{enabled:false},suggested_questions:[],suggested_questions_after_answer:{enabled:false},text_to_speech:{enabled:false}},graph:{nodes,edges,viewport:{x:0,y:0,zoom:.6}}}};
  app.workflow.graph=withImageVision(withCardMaterialsInput(app.workflow.graph),'main');
  return app;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const apps=JSON.parse(fs.readFileSync('docs/dify-config/multi-agent-apps.json','utf8'));
  const app=makeChatflow(apps.tools);
  fs.mkdirSync('docs/dify-workflows/multi-agent',{recursive:true});
  fs.writeFileSync('docs/dify-workflows/multi-agent/chatflow-entry.yml',JSON.stringify(app,null,2)+'\n');
  console.log('Prepared Chatflow DSL using the published specialist Workflow tools.');
}
