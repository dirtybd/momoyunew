export function withInlineOfficeContext(graph){
  const next=structuredClone(graph),start=next.nodes.find(n=>n.data.type==='start'),agent=next.nodes.find(n=>n.data.type==='agent');
  if(!start||!agent)throw Error('办公工作流缺少Start或Agent');
  const id='office_task_text';
  if(!start.data.variables.some(v=>v.variable==='task_json'))start.data.variables.push({variable:'task_json',label:'本轮任务正文JSON',type:'paragraph',required:false,max_length:128000,default:'',options:[],hide:false});
  if(!next.nodes.some(n=>n.id===id)){
    next.nodes.push({id,type:'custom',position:{x:agent.position.x-240,y:agent.position.y},data:{type:'template-transform',title:'直接传递任务正文',desc:'仅拼接任务元数据，文件操作仍由Agent执行',variables:[],template:''}});
    for(const edge of next.edges)if(edge.source===start.id&&edge.target===agent.id){edge.target=id;edge.id=start.id+'-'+id;edge.data={...edge.data,targetType:'template-transform'};}
    next.edges.push({id:id+'-'+agent.id,source:id,target:agent.id,sourceHandle:'source',targetHandle:'target',type:'custom',data:{sourceType:'template-transform',targetType:'agent'}});
  }
  const transport=next.nodes.find(n=>n.id===id);
  transport.data.variables=[{variable:'task_json',value_selector:[start.id,'task_json']},{variable:'legacy_id',value_selector:[start.id,'context_file','related_id']}];
  transport.data.template='{% if task_json %}{{ task_json }}{% else %}旧入口未提供任务正文。上下文是local_file，record_id={{ legacy_id }}；使用Python生成带填充的规范dify-file-ref，再下载读取该上下文。{% endif %}';
  agent.data.agent_task=agent.data.agent_task.replaceAll(`{{#${start.id}.context_file#}}`,`{{#${id}.output#}}`).replace('请下载并读取任务上下文','本轮任务正文如下；直接阅读文字，仅在明确给出旧入口回退说明时下载上下文文件');
  return next;
}

export function withOfficeTaskParameter(graph){
  const next=structuredClone(graph),office=next.nodes.find(n=>n.id==='office'&&n.data.type==='tool');
  if(!office)throw Error('统一入口缺少办公Workflow工具节点');
  office.data.tool_parameters.task_json={type:'variable',value:[next.nodes.some(n=>n.id==='agent_image_context')?'agent_image_context':'start','office_text']};
  if(office.data.tool_configurations?.task_json)office.data.tool_configurations.task_json=structuredClone(office.data.tool_parameters.task_json);
  return next;
}

export function withOfficePacketContract(graph){
  const next=structuredClone(graph),packet=next.nodes.find(n=>n.id==='office_packet'&&n.data.type==='code');
  if(!packet)throw Error('统一入口缺少办公结果校验');
  const old="typeof result.readyForPreview!=='boolean'",optional="(result.readyForPreview!==undefined&&typeof result.readyForPreview!=='boolean')";
  if(!packet.data.code.includes(optional)){
    if(!packet.data.code.includes(old))throw Error('办公结果校验与预期不符，请人工核对');
    packet.data.code=packet.data.code.replace(old,optional);
  }
  return next;
}
