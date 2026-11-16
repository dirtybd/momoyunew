import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {AGENT_ROUTE_CODE} from '../shared/agent-routing.mjs';
import {withPlainTextTranslation} from '../scripts/plain-text-workflow.mjs';
const graph=JSON.parse(readFileSync(new URL('../docs/dify-workflows/company-translation-published.json',import.meta.url),'utf8')).graph;
const run=(id,args)=>JSON.parse(JSON.stringify(vm.runInNewContext(graph.nodes.find(n=>n.id===id).data.code+';main(args)',{args},{timeout:500})));

test('公司实际路由：关怀优先于手动分流，消息翻译不强制文件Agent',()=>{
 const route=(text,hints={})=>vm.runInNewContext(AGENT_ROUTE_CODE+';main(args)',{args:{text,route_context:JSON.stringify(hints)}},{timeout:500}).route;
 for(const forceRoute of ['card','office','electrical'])assert.equal(route('{"route":"care"}',{forceRoute}),'care');
 assert.equal(route('invalid',{careSafety:'urgent',forceRoute:'card'}),'care');
 assert.equal(route('{"route":"office_chat"}',{hasOutputs:true,translationMode:'text'}),'office_chat');
 assert.equal(route('{"route":"office_chat"}',{hasOutputs:true,translationMode:'document'}),'office');
 assert.equal(route('{"route":"office"}',{readOnlyDocuments:true,hasMaterials:true,forceRoute:'office'}),'office_chat');
 assert.equal(route('{"route":"care"}',{readOnlyDocuments:true}),'care');
 assert.equal(route('{"route":"card"}',{readOnlyDocuments:true,forceRoute:'card'}),'card');
 assert.throws(()=>route('{"route":"other"}'));
});

test('公司纯TXT分支：入口互斥、单次LLM、工程审校严格拒绝无效译文',()=>{
 assert.equal(run('translation_mode',{payload_json:'',plain_payload_json:'{}'}).mode,'plain');
 assert.throws(()=>run('translation_mode',{payload_json:'{}',plain_payload_json:'{}'}));
 assert.throws(()=>run('translation_mode',{payload_json:'',plain_payload_json:''}));
 assert.throws(()=>run('plain_prepare',{plain_payload_json:JSON.stringify({text:'x'.repeat(6001),targetLanguage:'en-US'})}));
 assert.throws(()=>run('plain_prepare',{plain_payload_json:'{"text":"hello","targetLanguage":"unknown"}'}));
 assert.throws(()=>run('plain_prepare',{plain_payload_json:'{"text":"hello","targetLanguage":"en-US","publish":true}'}));
 assert.equal(JSON.parse(run('plain_prepare',{plain_payload_json:'{"text":"hello","targetLanguage":"en-US"}'}).task).text,'hello');
 assert.equal(run('plain_validate',{text:'译文'}).plain_translation,'译文');
 for(const text of ['','<think>秘密</think>正文','x'.repeat(48001)])assert.throws(()=>run('plain_validate',{text}));
 for(const item of [{id:'1',text:'',valid:true},{id:'1',text:'text',valid:false},{id:'1',text:'text'}])assert.throws(()=>run('finalize',{text:JSON.stringify({validations:[item]}),tokens_json:'{"1":[]}'}));
 const good=run('finalize',{text:'{"validations":[{"id":"1","text":"Stop __PORTALAI_TOKEN_000__","valid":true}]}',tokens_json:'{"1":["%I0.0"]}'});
 assert.equal(JSON.parse(good.translations_json).translations[0].text,'Stop %I0.0');
 assert.throws(()=>run('finalize',{text:'{"validations":[{"id":"1","text":"__PORTALAI_TOKEN_000__ __PORTALAI_TOKEN_000__","valid":true}]}',tokens_json:'{"1":["%I0.0"]}'}));
 const llms=graph.nodes.filter(n=>['plain_prepare','plain_translate','plain_validate','plain_end'].includes(n.id)&&n.data.type==='llm');assert.equal(llms.length,1);
 assert.throws(()=>withPlainTextTranslation(graph));
});
