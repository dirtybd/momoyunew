import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {CARD_RESULT_CODE,withCardLLM} from '../scripts/card-llm-workflow.mjs';
test('卡片LLM输出严格校验，空草稿、部分修订和取消日期可用，权限字段不可写',()=>{
 const run=text=>JSON.parse(JSON.stringify(vm.runInNewContext(CARD_RESULT_CODE+';main({text:input})',{input:text})));
 assert.deepEqual(run('{"reply":"要交什么？","card":null}'),{answer_json:'{"reply":"要交什么？","card":null}',deliverables:[],artifact_json:''});
 assert.equal(JSON.parse(run('```json\n{"reply":"已更新","card":{"deadline":null}}\n```').answer_json).card.deadline,null);
 for(const x of [{reply:'x',card:{owner_id:'x'}},{reply:'x',card:{skills:'bad'}},{reply:'x',published:true},{reply:'x',card:{deadline:4}}])assert.throws(()=>run(JSON.stringify(x)));
});
test('卡片工作流使用固定LLM与校验，无Agent工具回合，保留材料提取及回传协议',()=>{
 const graph=JSON.parse(readFileSync(new URL('../docs/dify-workflows/company-card-published.json',import.meta.url),'utf8')).graph,next=withCardLLM(graph);
 assert.deepEqual(withCardLLM(next),next);assert.ok(!next.nodes.some(n=>n.data.type==='agent'||n.data.type==='tool'));assert.ok(next.nodes.some(n=>n.id==='card_extract'));
 const llm=next.nodes.find(n=>n.id==='card_llm').data;assert.equal(llm.model.completion_params.enable_thinking,false);assert.ok(!llm.prompt_template[0].text.includes('final_output'));
 assert.equal(next.nodes.find(n=>n.data.type==='end').data.outputs[0].value_selector[0],'card_fields');
});
