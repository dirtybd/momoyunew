import {test} from 'node:test';import assert from 'node:assert/strict';import {FAST_MODEL,MODEL_PROVIDER,nonThinkingModel,withoutThinking} from '../scripts/non-thinking-models.mjs';
test('公司模型真正切到扩展兼容配置，关闭思考并保留生成参数',()=>{
 const source={provider:MODEL_PROVIDER,name:'电研-qwen3.8-27b ',mode:'chat',completion_params:{temperature:0.1,max_tokens:8192,enable_thinking:true,reasoning_effort:'high'}};
 const result=nonThinkingModel(source);assert.equal(result.name,FAST_MODEL);assert.deepEqual(result.completion_params,{temperature:0.1,max_tokens:8192,enable_thinking:false});assert.equal(source.completion_params.enable_thinking,true);assert.deepEqual(nonThinkingModel(result),result);
 const agent=nonThinkingModel({plugin_id:'langgenius/openai_api_compatible',model_provider:MODEL_PROVIDER,model:'电研-qwen3.8-27b ',model_settings:{max_tokens:4096,thinking:{type:'enabled'}}});assert.equal(agent.model,FAST_MODEL);assert.deepEqual(agent.model_settings,{max_tokens:4096,enable_thinking:false});
 assert.throws(()=>nonThinkingModel({...source,name:'unknown-model'}));
});
test('只改模型与指定Agent快照，不动提示词、检索、路由、权限及连线',()=>{
 const graph={nodes:[{id:'llm',data:{type:'llm',model:{provider:MODEL_PROVIDER,name:FAST_MODEL,completion_params:{enable_thinking:false}},prompt_template:[{role:'system',text:'保留事实'}]}},{id:'agent',data:{type:'agent',agent_binding:{agent_id:'a',current_snapshot_id:'old'},agent_task:'原任务'}},{id:'knowledge',data:{type:'knowledge-retrieval',dataset_ids:['private']}},{id:'code',data:{type:'code',code:'权限校验'}}],edges:[{source:'knowledge',target:'llm'}]};
 const next=withoutThinking(graph,{a:'new'});assert.equal(next.nodes[1].data.agent_binding.current_snapshot_id,'new');assert.equal(graph.nodes[1].data.agent_binding.current_snapshot_id,'old');assert.deepEqual(next.nodes[0].data.prompt_template,graph.nodes[0].data.prompt_template);assert.deepEqual(next.nodes.slice(2),graph.nodes.slice(2));assert.deepEqual(next.edges,graph.edges);assert.deepEqual(withoutThinking(next,{a:'new'}),next);
});
