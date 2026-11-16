import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import JSZip from 'jszip';import {withDocumentReading} from '../scripts/document-reading-workflow.mjs';
test('只读文件概览进快速问答，保留关怀/卡片优先且构建幂等',()=>{
 const graph=JSON.parse(readFileSync(new URL('../docs/dify-workflows/company-chatflow-published.json',import.meta.url),'utf8')).graph;
 const next=withDocumentReading(graph);assert.deepEqual(withDocumentReading(next),next);assert.deepEqual(next.edges,graph.edges);
 const code=next.nodes.find(n=>n.id==='route').data.code;
 const run=(text,hints)=>vm.runInNewContext(code+';main(args)',{args:{text,route_context:JSON.stringify(hints)}},{timeout:500}).route;
 assert.equal(run('{"route":"office"}',{readOnlyDocuments:true,hasMaterials:true}),'office_chat');assert.equal(run('{"route":"care"}',{readOnlyDocuments:true}),'care');assert.equal(run('{"route":"card"}',{readOnlyDocuments:true,forceRoute:'card'}),'card');
 assert.match(next.nodes.find(n=>n.id==='office_fast').data.prompt_template[0].text,/documentReading.documents/);
});
test('Dify Skill包保留同一归纳规范，快速分支复用源码而非另写简化规则',async()=>{
 const root=new URL('../docs/dify-skills/',import.meta.url),quality=readFileSync(new URL('document-quality-work/SKILL.md',root),'utf8');
 const summary=quality.match(/## 只读归纳\s*([\s\S]*?)\n## 制作与检查/)[1].trim();
 const graph=JSON.parse(readFileSync(new URL('../docs/dify-workflows/company-chatflow-published.json',import.meta.url),'utf8')).graph;
 assert.ok(withDocumentReading(graph).nodes.find(n=>n.id==='office_fast').data.prompt_template[0].text.includes(summary));
 for(const name of ['office-file-work','document-quality-work']){const zip=await JSZip.loadAsync(readFileSync(new URL(name+'.zip',root)));for(const path of Object.keys(zip.files))if(!zip.files[path].dir)assert.deepEqual(await zip.file(path).async('nodebuffer'),readFileSync(new URL(name+'/'+path,root)));}
 const script=readFileSync(new URL('office-file-work/scripts/office_tools.py',root),'utf8');assert.match(script,/def _emit_read\(lines, limit=12000\)/);assert.doesNotMatch(script,/请先按 Skill 的 bootstrap 步骤安装/);
});
