import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {withDocumentTranslation} from '../scripts/document-translation-workflow.mjs';
const source=JSON.parse(readFileSync(new URL('../docs/dify-workflows/company-translation-published.json',import.meta.url),'utf8')).graph;
const graph=source.nodes.some(n=>n.id==='document_prepare')?source:withDocumentTranslation(source);
const run=(id,args)=>JSON.parse(JSON.stringify(vm.runInNewContext(graph.nodes.find(n=>n.id===id).data.code+';main(args)',{args},{timeout:500})));
const task={targetLanguage:'en-US',items:[{id:'p0',text:'<s0>你好</s0>'},{id:'p1',text:'设备'}]};

test('公司文档翻译分支Code可运行，三种输入严格互斥',()=>{
 for(const n of graph.nodes.filter(n=>n.data.type==='code'))assert.doesNotThrow(()=>new vm.Script(n.data.code));
 for(const [key,mode]of [['payload_json','project'],['plain_payload_json','plain'],['document_payload_json','document']])assert.equal(run('translation_mode',{[key]:'{}'}).mode,mode);
 for(const args of [{},{payload_json:'{}',document_payload_json:'{}'},{plain_payload_json:'{}',document_payload_json:'{}'},{payload_json:'{}',plain_payload_json:'{}'}])assert.throws(()=>run('translation_mode',args));
 assert.throws(()=>withDocumentTranslation(graph));
 const branch=graph.nodes.find(n=>n.id==='translation_branch');assert.ok(branch.data.cases.some(c=>c.case_id==='document'));
 assert.ok(graph.edges.some(e=>e.source==='translation_branch'&&e.sourceHandle==='document'&&e.target==='document_prepare'));
});

test('文档批次保留格式标记，限制语言、12条及3000字符',()=>{
 assert.deepEqual(JSON.parse(run('document_prepare',{document_payload_json:JSON.stringify(task)}).task),task);
 for(const bad of [{...task,targetLanguage:'unknown'},{...task,items:[]},{...task,items:Array.from({length:13},(_,i)=>({id:String(i),text:'x'}))},{...task,items:[{id:'a',text:'x'.repeat(3001)}]},{...task,items:[{id:'a',text:'x'.repeat(1501)},{id:'b',text:'x'.repeat(1500)}]},{...task,items:[{id:'a',text:'x'},{id:'a',text:'y'}]},{...task,items:[{id:'',text:'x'}]},{...task,extra:true}])assert.throws(()=>run('document_prepare',{document_payload_json:JSON.stringify(bad)}));
});

test('文档译文拒绝缺条、重复、未知ID、空文、思考正文和扩展字段',()=>{
 const result={translations:[{id:'p0',text:'<s0>Hello</s0>'},{id:'p1',text:'Equipment'}]},input=JSON.stringify(task);
 for(const prefix of ['', '<think>hidden</think>', '```json\n']){
  const suffix=prefix.startsWith('```')?'\n```':'';
  assert.deepEqual(JSON.parse(run('document_validate',{text:prefix+JSON.stringify(result)+suffix,task:input}).document_translations_json),result);
 }
 for(const bad of [{translations:[result.translations[0]]},{translations:[result.translations[0],result.translations[0]]},{translations:[result.translations[0],{id:'unknown',text:'x'}]},{translations:[result.translations[0],{id:'p1',text:''}]},{translations:[result.translations[0],{id:'p1',text:'<think>secret</think>'}]},{translations:[result.translations[0],{id:'p1',text:'bad </think>'}]},{translations:[result.translations[0],{id:'p1',text:'x',action:'publish'}]},{...result,publish:true}])assert.throws(()=>run('document_validate',{text:JSON.stringify(bad),task:input}));
});
