import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import JSZip from 'jszip';import {CARD_MATERIAL_CODE,withCardMaterialReading,withCardMaterialsInput} from '../scripts/card-material-workflow.mjs';import {cardAgentPrompt} from '../scripts/build-card-agent-prompt.mjs';
const run=(ctx,files,texts)=>JSON.parse(vm.runInNewContext(CARD_MATERIAL_CODE+';main(input)',{input:{context_text:JSON.stringify(ctx),files,texts}}).text);
test('卡片材料提取保留来源、限制内容，不向Agent暴露下载引用',()=>{
 const context={user_message:'根据附件写卡',inputs:[{reference:'private'}],outputHistory:[{name:'私有成果',reference:'private'}],attachmentDigests:[]};
 const out=run(context,[{filename:'甲.docx'},{filename:'乙.txt'},{filename:'丙.pdf'}],['甲'.repeat(8000),'乙'.repeat(8000),'丙'.repeat(8000)]);
 assert.equal(out.materialReadings.reduce((n,d)=>n+d.text.length,0),12000);assert.ok(out.materialReadings.every(d=>d.truncated));assert.deepEqual(out.inputs,[]);assert.deepEqual(out.outputHistory,[{name:'私有成果'}]);assert.ok(!JSON.stringify(out).includes('private'));
 const unread=run(context,[{filename:'坏文件.pdf'}],['__CARD_READ_FAILED__']);assert.equal(unread.materialReadings[0].status,'unreadable');assert.equal(unread.attachmentDigests.length,0);
 assert.deepEqual(run(context,[],[]).materialReadings,[]);
});
test('卡片专用引用输入不改其他分支；Skill正文实际进入提示词且ZIP一致',async()=>{
 const g=JSON.parse(readFileSync(new URL('../docs/dify-workflows/company-chatflow-published.json',import.meta.url),'utf8')).graph,next=withCardMaterialsInput(g);
 assert.deepEqual(withCardMaterialsInput(next),next);assert.deepEqual(next.edges,g.edges);
 for(const n of g.nodes.filter(n=>!['start','card'].includes(n.id)))assert.deepEqual(next.nodes.find(x=>x.id===n.id),n);
 assert.deepEqual(next.nodes.find(n=>n.id==='card').data.tool_parameters.materials.value,['start','card_materials']);
 const prompt=readFileSync(new URL('../docs/dify-config/card-agent-prompt.txt',import.meta.url),'utf8');assert.equal(prompt,cardAgentPrompt());assert.match(prompt,/截止时间、报酬、修改轮次/);assert.match(prompt,/included=false/);assert.match(prompt,/用户本轮明确更正/);
 const z=await JSZip.loadAsync(readFileSync(new URL('../docs/dify-config/requirement-card.zip',import.meta.url)));assert.deepEqual(await z.file('SKILL.md').async('nodebuffer'),readFileSync(new URL('../docs/dify-config/requirement-card/SKILL.md',import.meta.url)));
});
test('卡片工作流幂等增量添加Dify提取节点，保留Agent输出声明和其他节点',()=>{
 const graph={nodes:[{id:'start',data:{type:'start'}},{id:'extract',data:{type:'document-extractor',variable_selector:['start','context_file']}},{id:'agent',data:{type:'agent',agent_task:'上下文{{#extract.text#}}',agent_declared_outputs:[{name:'answer_json'}]}}],edges:[{source:'start',target:'extract'},{source:'extract',target:'agent'}]};
 const next=withCardMaterialReading(graph);assert.deepEqual(withCardMaterialReading(next),next);assert.equal(graph.nodes.length,3);assert.equal(next.nodes.length,6);assert.deepEqual(next.nodes.find(n=>n.id==='agent').data.agent_declared_outputs,graph.nodes[2].data.agent_declared_outputs);assert.match(next.nodes.find(n=>n.id==='agent').data.agent_task,/card_material_context.text/);
});
