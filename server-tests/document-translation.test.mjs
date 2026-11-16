import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import JSZip from 'jszip';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {translateDocuments,translateDocumentSegments} from '../server/document-translation.mjs';
import {resumePlainTranslationMessage} from '../server/plain-text-translation.mjs';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',S='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const config={base:'http://synthetic.test/v1',key:'synthetic'};
async function zip(files){const z=new JSZip();for(const [path,value]of Object.entries(files))z.file(path,value);return z.generateAsync({type:'nodebuffer',compression:'DEFLATE'});}
const word=()=>zip({'word/document.xml':`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>你好</w:t></w:r></w:p></w:body></w:document>`,'word/media/image.png':Buffer.from([1,2,3]),'word/styles.xml':'original-style'});
const excel=()=>zip({'xl/workbook.xml':`<workbook xmlns="${S}"><sheets/></workbook>`,'xl/worksheets/sheet1.xml':`<worksheet xmlns="${S}"><sheetData><row><c r="A1" s="3" t="inlineStr"><is><t>你好</t></is></c><c r="B1"><f>SUM(1,2)</f><v>3</v></c></row></sheetData><mergeCells><mergeCell ref="A2:B2"/></mergeCells></worksheet>`,'xl/styles.xml':'original-excel-style'});
const task=files=>({isTranslation:true,mode:'document',scope:'whole',documents:files,project:[],ignored:[]});
const packet=translations=>new Response(JSON.stringify({data:{status:'succeeded',outputs:{document_translations_json:JSON.stringify({translations})}}}),{headers:{'content-type':'application/json'}});
function fakeTranslator(calls=[]){return async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});const p=JSON.parse(body.inputs.document_payload_json);return packet(p.items.map(x=>({id:x.id,text:x.text.replaceAll('你好','Hello')})));};}

test('文档批次串行且≤12条/3000字符，单批只调用一次Workflow',async()=>{
 const items=Array.from({length:26},(_,i)=>({id:String(i),text:'文字'.repeat(150)})),calls=[];let active=0,peak=0;
 const values=await translateDocumentSegments({items,targetLanguage:'en-US',config,userId:'owner',fetchImpl:async(url,options)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));const out=await fakeTranslator(calls)(url,options);active--;return out;}});
 assert.equal(peak,1);assert.equal(calls.length,3);assert.equal(values.size,26);
 for(const c of calls){assert.equal(c.url,config.base+'/workflows/run');const p=JSON.parse(c.body.inputs.document_payload_json);assert.ok(p.items.length<=12);assert.ok(p.items.reduce((n,x)=>n+x.text.length,0)<=3000);assert.equal(c.body.inputs.payload_json,'');assert.equal(c.body.inputs.plain_payload_json,'');}
});

test('多文件共文去重，只替换Word和Excel文本，样式/公式/媒体原样保留',async()=>{
 const doc=await word(),original=Buffer.from(doc),sheet=await excel(),calls=[];
 const result=await translateDocuments({task:task([{name:'说明.docx',bytes:doc},{name:'台账.xlsx',bytes:sheet}]),message:'全文翻译成英文',config,userId:'owner',fetchImpl:fakeTranslator(calls)});
 assert.equal(calls.length,1);assert.equal(JSON.parse(calls[0].body.inputs.document_payload_json).items.length,1,'跨文件相同带标记文本只译一次');assert.equal(result.outputFiles.length,2);
 const w=await JSZip.loadAsync(result.outputFiles[0].bytes),x=await JSZip.loadAsync(result.outputFiles[1].bytes);
 assert.match(await w.file('word/document.xml').async('string'),/Hello/);assert.match(await w.file('word/document.xml').async('string'),/<w:b/);assert.deepEqual(await w.file('word/media/image.png').async('nodebuffer'),Buffer.from([1,2,3]));assert.equal(await w.file('word/styles.xml').async('string'),'original-style');
 const xml=await x.file('xl/worksheets/sheet1.xml').async('string');assert.match(xml,/Hello/);assert.match(xml,/SUM\(1,2\)/);assert.match(xml,/s="3"/);assert.match(xml,/A2:B2/);assert.equal(await x.file('xl/styles.xml').async('string'),'original-excel-style');assert.deepEqual(doc,original);
});

test('缺语言不调用模型，下一轮短答可用；局部/混合不擅自处理，最多5文件',async()=>{
 const file={name:'说明.docx',bytes:await word()},noCall=()=>assert.fail('不应调用模型');
 const question=await translateDocuments({task:task([file]),message:'翻译这个文件',config,userId:'owner',fetchImpl:noCall});assert.equal(question.outputFiles.length,0);assert.match(question.reply,/哪种语言/);
 const message=resumePlainTranslationMessage('英文',question.reply);const translated=await translateDocuments({task:task([file]),message,config,userId:'owner',fetchImpl:fakeTranslator()});assert.equal(translated.outputFiles.length,1);
 for(const input of [{...task([file]),scope:'requested'},{...task([file]),project:[{}]},{...task([file]),ignored:[{}]},task([file,{name:'note.txt',bytes:Buffer.from('hello')}])])assert.equal(await translateDocuments({task:input,message:'翻译成英文',config,userId:'owner',fetchImpl:noCall}),null);
 await assert.rejects(translateDocuments({task:task(Array.from({length:6},()=>file)),message:'翻译成英文',config,userId:'owner',fetchImpl:noCall}),{code:'DOCUMENT_LIMIT'});
});

test('缺译文、未知/重复ID、标签注入均拒绝，不交付半成品',async()=>{
 const file={name:'说明.docx',bytes:await word()};
 for(const change of [()=>[],()=>[{id:'foreign',text:'x'}],items=>[{id:items[0].id,text:''}],items=>[{id:items[0].id,text:'<think>hidden</think>'}],items=>[{id:items[0].id,text:'bad </think>'}],items=>[{id:items[0].id,text:'<s0><script>bad</script></s0>'}]])await assert.rejects(translateDocuments({task:task([file]),message:'翻译成英文',config,userId:'owner',fetchImpl:async(_url,options)=>packet(change(JSON.parse(JSON.parse(options.body).inputs.document_payload_json).items))}));
 await assert.rejects(translateDocumentSegments({items:[{id:'a',text:'one'},{id:'b',text:'two'}],targetLanguage:'en-US',config,userId:'owner',fetchImpl:async()=>packet([{id:'a',text:'x'},{id:'a',text:'y'}])}),{code:'DOCUMENT_TRANSLATION_FORMAT'});
 await assert.rejects(translateDocumentSegments({items:[{id:'a',text:'one'},{id:'a',text:'two'}],targetLanguage:'en-US',config,userId:'owner',fetchImpl:()=>assert.fail('无效编号不应调用模型')}),{code:'DOCUMENT_SEGMENT'});
 const sourceXlsx=await JSZip.loadAsync(await excel());sourceXlsx.file('xl/worksheets/sheet1.xml',(await sourceXlsx.file('xl/worksheets/sheet1.xml').async('string')).replace('你好','第二个文件'));
 await assert.rejects(translateDocuments({task:task([file,{name:'second.xlsx',bytes:await sourceXlsx.generateAsync({type:'nodebuffer'})}]),message:'翻译成英文',config,userId:'owner',fetchImpl:async(_url,options)=>packet(JSON.parse(JSON.parse(options.body).inputs.document_payload_json).items.map((x,i)=>({id:x.id,text:i===0?'<s0>Hello</s0>':'<bad>broken</bad>'})))}),{code:'OFFICE_TRANSLATION'});
});

test('后续批次断联或超时取消不重跑，原件不变',async()=>{
 let calls=0;const items=Array.from({length:13},(_,i)=>({id:String(i),text:'source'+i}));
 await assert.rejects(translateDocumentSegments({items,targetLanguage:'en-US',config,userId:'owner',fetchImpl:async(_url,options)=>{calls++;if(calls===2)throw new TypeError('network');return packet(JSON.parse(JSON.parse(options.body).inputs.document_payload_json).items);}}),{code:'DOCUMENT_TRANSLATION_UNAVAILABLE'});assert.equal(calls,2);
 const keep=setTimeout(()=>{},100);
 try{await assert.rejects(translateDocumentSegments({items:items.slice(0,1),targetLanguage:'en-US',config,userId:'owner',timeoutMs:5,fetchImpl:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}),{code:'DOCUMENT_TRANSLATION_TIMEOUT'});}finally{clearTimeout(keep);}
 let called=false;await assert.rejects(translateDocumentSegments({items:items.slice(0,1),targetLanguage:'en-US',config,userId:'owner',signal:AbortSignal.abort(),fetchImpl:async()=>{called=true;}}),{name:'AbortError'});assert.equal(called,false);
});

test('混合扫描PDF在任何模型调用前拒绝，避免只翻文字页冒充完整',async()=>{
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage().drawText('Text page',{font});pdf.addPage();
 await assert.rejects(translateDocuments({task:task([{name:'text.docx',bytes:await word()},{name:'mixed.pdf',bytes:Buffer.from(await pdf.save())}]),message:'全文翻译成英文',config,userId:'owner',fetchImpl:()=>assert.fail('不应调用模型')}),{code:'PDF_OCR_REQUIRED'});
});

test('HTTP文档翻译无Agent/上传回合、按语言追问续跑、私人下载与失败保护',async t=>{
 const paths=[];let failNext=false;
 const mock=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);if(!req.url.startsWith('/v1/')){res.setHeader('content-type','application/json');res.end('{"data":[]}');return;}paths.push(req.url);if(req.url!=='/v1/workflows/run'){res.writeHead(500);res.end('unexpected');return;}res.setHeader('content-type','application/json');if(failNext){res.writeHead(503);res.end('{}');return;}const p=JSON.parse(JSON.parse(Buffer.concat(chunks)).inputs.document_payload_json);res.end(JSON.stringify({data:{status:'succeeded',outputs:{document_translations_json:JSON.stringify({translations:p.items.map(x=>({id:x.id,text:x.text.replaceAll('你好','Hello')}))})}}}));});
 mock.listen(0,'127.0.0.1');await once(mock,'listening');const remote='http://127.0.0.1:'+mock.address().port,dir=mkdtempSync(join(tmpdir(),'momoyu-doc-translation-'));
 const child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1',DIFY_ENTRYPOINT:'legacy',DIFY_API_KEY:'synthetic',DIFY_BASE_URL:remote+'/v1',DIFY_CHATFLOW_API_KEY:'',DIFY_MATCHING_API_KEY:'',DIFY_TRANSLATION_BASE_URL:remote+'/v1',DIFY_TRANSLATION_API_KEY:'synthetic',MATCHING_SCHEDULER:'off',AGENT_PORTAL_BASE_URL:remote},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}mock.closeAllConnections();await new Promise(r=>mock.close(r));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
 let base;for await(const c of child.stdout){const m=String(c).match(/"port":(\d+)/);if(m){base='http://127.0.0.1:'+m[1];break;}}assert.ok(base);
 const call=async(path,method='GET',body,cookie)=>{const r=await fetch(base+'/api'+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const register=async username=>(await call('/auth/register','POST',{username,password:'Synthetic2026!',displayName:username,department:'合成测试'})).cookie;
 const owner=await register('doc-owner'),other=await register('doc-other'),id=(await call('/requests','POST',{},owner)).data.request.id,source=await word();
 const form=new FormData();form.append('file',new Blob([source]),'说明.docx');const up=await fetch(base+'/api/requests/'+id+'/attachments',{method:'POST',headers:{cookie:owner},body:form});assert.equal(up.status,201);const original=(await up.json()).attachment;
 const question=await call('/clarify','POST',{requestId:id,message:'翻译这个文件'},owner);assert.equal(question.status,200);assert.match(question.data.reply,/哪种语言/);assert.equal(paths.length,0);
 const translated=await call('/clarify','POST',{requestId:id,message:'英文'},owner);assert.equal(translated.status,200);assert.deepEqual(paths,['/v1/workflows/run']);const output=translated.data.messages.at(-1).files[0];assert.match(output.name,/\.docx$/);
 const saved=Buffer.from(await (await fetch(base+output.downloadUrl,{headers:{cookie:owner}})).arrayBuffer()),zipOut=await JSZip.loadAsync(saved);assert.match(await zipOut.file('word/document.xml').async('string'),/Hello/);
 assert.equal((await fetch(base+output.downloadUrl,{headers:{cookie:other}})).status,404);assert.equal((await fetch(base+output.downloadUrl)).status,404);assert.deepEqual(Buffer.from(await (await fetch(base+original.downloadUrl,{headers:{cookie:owner}})).arrayBuffer()),source);
 const before=(await call('/requests/'+id+'/messages','GET',undefined,owner)).data.messages.length;failNext=true;
 const failed=await call('/clarify','POST',{requestId:id,message:'全文翻译成英文'},owner);assert.equal(failed.status,502);assert.equal(paths.length,2);assert.equal((await call('/requests/'+id+'/messages','GET',undefined,owner)).data.messages.length,before);assert.deepEqual(Buffer.from(await (await fetch(base+output.downloadUrl,{headers:{cookie:owner}})).arrayBuffer()),saved);
});
