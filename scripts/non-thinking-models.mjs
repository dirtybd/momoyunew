// Historical alias name; now reused by every project LLM on the same company endpoint.
export const FAST_MODEL='momoyu-card-qwen-fast-20261113';
export const MODEL_PROVIDER='langgenius/openai_api_compatible/openai_api_compatible';
const parameters=value=>{
 const next={...value,enable_thinking:false};
 for(const key of ['thinking','reasoning_effort','thinking_budget','budget_tokens'])delete next[key];
 return next;
};
export const fastWorkflowModel=(completionParams={})=>({provider:MODEL_PROVIDER,name:FAST_MODEL,mode:'chat',completion_params:parameters(completionParams)});
export function nonThinkingModel(source){
 const model=structuredClone(source),agent=Object.hasOwn(model,'model_provider'),provider=agent?model.model_provider:model.provider,name=agent?model.model:model.name;
 if(provider!==MODEL_PROVIDER||!['电研-qwen3.8-27b',FAST_MODEL].includes(String(name).trim()))throw Error('模型尚未验证非思考参数，请先检查提供器兼容模式');
 if(agent){model.model=FAST_MODEL;model.model_settings=parameters(model.model_settings);}
 else {model.name=FAST_MODEL;model.completion_params=parameters(model.completion_params);}
 return model;
}
export function withoutThinking(graph,snapshots={}){
 const next=structuredClone(graph);
 for(const node of next.nodes){
  if(node.data.model)node.data.model=nonThinkingModel(node.data.model);
  const binding=node.data.agent_binding;
  if(binding?.agent_id&&snapshots[binding.agent_id])binding.current_snapshot_id=snapshots[binding.agent_id];
 }
 return next;
}
