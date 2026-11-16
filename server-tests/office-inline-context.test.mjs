import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {withInlineOfficeContext,withOfficeTaskParameter} from '../scripts/office-inline-context.mjs';
import vm from 'node:vm';
test('办公Workflow直接传任务正文，保留文件回退、输出声明和原任务补充要求',()=>{
 const start={id:'start',data:{type:'start',variables:[{variable:'context_file',required:true}]}},agent={id:'agent',position:{x:500,y:50},data:{type:'agent',agent_task:'请下载并读取任务上下文 {{#start.context_file#}}；保留额外约束',agent_declared_outputs:[{name:'files',type:'array'}]}};
 const graph={nodes:[start,agent],edges:[{id:'s-a',source:'start',target:'agent'}]},next=withInlineOfficeContext(graph);
 assert.deepEqual(withInlineOfficeContext(next),next);assert.equal(graph.nodes.length,2);assert.equal(next.nodes.length,3);assert.equal(next.edges.length,2);
 assert.match(next.nodes.find(n=>n.id==='agent').data.agent_task,/保留额外约束/);assert.ok(!next.nodes.find(n=>n.id==='agent').data.agent_task.includes('{{#start.context_file#}}'));
 assert.deepEqual(next.nodes.find(n=>n.id==='agent').data.agent_declared_outputs,agent.data.agent_declared_outputs);assert.match(next.nodes.find(n=>n.id==='office_task_text').data.template,/旧入口/);
 const main=JSON.parse(readFileSync(new URL('../docs/dify-workflows/company-chatflow-published.json',import.meta.url),'utf8')).graph,updated=withOfficeTaskParameter(main);
 assert.deepEqual(updated.nodes.find(n=>n.id==='office').data.tool_parameters.task_json,{type:'variable',value:['agent_image_context','office_text']});assert.deepEqual(updated.edges,main.edges);
});

test('已发布入口接收办公Agent最小答复，同时拒绝错误字段类型',()=>{
 const graph=JSON.parse(readFileSync(new URL('../docs/dify-workflows/company-chatflow-published.json',import.meta.url),'utf8')).graph;
 const source=graph.nodes.find(n=>n.id==='office_packet').data.code;
 const run=result=>JSON.parse(vm.runInNewContext(source+';main(input)',{input:{data:[{answer_json:JSON.stringify(result),artifact_json:''}],files:[]}}).packet);
 assert.equal(run({reply:'已生成'}).route,'office');
 assert.throws(()=>run({reply:4}));assert.throws(()=>run({reply:'已生成',readyForPreview:'false'}));
});
