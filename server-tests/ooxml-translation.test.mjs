import {test} from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {prepareOfficeTranslation} from '../server/ooxml-translation.mjs';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',S='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const parse=text=>new DOMParser().parseFromString(text,'application/xml');
const els=(doc,ns,name)=>Array.from(doc.getElementsByTagNameNS(ns,name));
async function packageOf(files){const z=new JSZip();for(const [name,value]of Object.entries(files))z.file(name,value);return z.generateAsync({type:'nodebuffer',compression:'DEFLATE'});}
const docx=extra=>packageOf({'word/document.xml':`<w:document xmlns:w="${W}" xmlns:r="urn:rels"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>你好</w:t></w:r><w:hyperlink r:id="link1"><w:r><w:t>世界</w:t></w:r></w:hyperlink></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:t>3</w:t></w:r></w:p><w:p><w:del><w:r><w:delText>已删除</w:delText></w:r></w:del></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,'word/header1.xml':`<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>页眉</w:t></w:r></w:p></w:hdr>`,'word/media/image1.png':Buffer.from([0,3,9,255]),'word/_rels/document.xml.rels':'<Relationships><Relationship Id="link1" Target="https://example.com"/></Relationships>','word/styles.xml':'<styles>untouched</styles>',...extra});
const translated=plan=>new Map(plan.segments.map(s=>[s.id,s.text.replace('你好','Hello').replace('世界','World').replace('表格','Table').replace('页眉','Header').replace('标题','Title').replace('内联','Inline')]));

test('Word原OOXML写回保留粗体、表格、超链接、图片和页眉，字段不翻译',async()=>{
 const source=await docx(),original=Buffer.from(source),plan=await prepareOfficeTranslation({name:'test.docx',bytes:source});assert.equal(plan.format,'docx');assert.equal(plan.segments.length,3);
 assert.equal(plan.segments[0].text,'<s0>你好</s0><s1>世界</s1>');
 const out=await JSZip.loadAsync(await plan.write(translated(plan))),before=await JSZip.loadAsync(source);
 for(const path of ['word/media/image1.png','word/_rels/document.xml.rels','word/styles.xml'])assert.deepEqual(await out.file(path).async('nodebuffer'),await before.file(path).async('nodebuffer'));
 const doc=parse(await out.file('word/document.xml').async('string'));
 assert.deepEqual(els(doc,W,'t').map(n=>n.textContent),['Hello','World','Table','3']);assert.equal(els(doc,W,'b').length,1);assert.equal(els(doc,W,'hyperlink')[0].getAttribute('r:id'),'link1');assert.equal(els(doc,W,'pgSz')[0].getAttribute('w:w'),'11906');
 assert.match(await out.file('word/header1.xml').async('string'),/Header/);assert.deepEqual(source,original);
 await assert.rejects(plan.write(translated(plan)),{code:'OFFICE_ALREADY_WRITTEN'});
});

test('Excel共享富文本只改普通引用，公式结果、数字、样式和合并区域保留',async()=>{
 const source=await packageOf({'xl/workbook.xml':`<workbook xmlns="${S}"><sheets/></workbook>`,'xl/sharedStrings.xml':`<sst xmlns="${S}" count="3" uniqueCount="1"><si><r><rPr><b/></rPr><t>标题</t></r></si></sst>`,'xl/worksheets/sheet1.xml':`<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" s="7" t="s"><v>0</v></c><c r="B1" t="s"><f>A1</f><v>0</v></c><c r="C1" t="n"><v>42</v></c><c r="D1" s="2"><v>45000</v></c><c r="E1" t="inlineStr"><is><t>内联</t></is></c></row></sheetData><mergeCells count="1"><mergeCell ref="A2:B2"/></mergeCells></worksheet>`,'xl/styles.xml':'styles-original','xl/charts/chart1.xml':'chart-original'});
 const plan=await prepareOfficeTranslation({name:'test.xlsx',bytes:source});assert.equal(plan.segments.length,2);
 const out=await JSZip.loadAsync(await plan.write(translated(plan))),sheet=parse(await out.file('xl/worksheets/sheet1.xml').async('string')),cells=els(sheet,S,'c');
 assert.equal(els(cells[0],S,'v')[0].textContent,'1');assert.equal(cells[0].getAttribute('s'),'7');assert.equal(els(cells[1],S,'f')[0].textContent,'A1');assert.equal(els(cells[1],S,'v')[0].textContent,'0');assert.equal(els(cells[2],S,'v')[0].textContent,'42');assert.equal(els(cells[3],S,'v')[0].textContent,'45000');assert.equal(els(cells[4],S,'t')[0].textContent,'Inline');assert.equal(els(sheet,S,'mergeCell')[0].getAttribute('ref'),'A2:B2');
 const shared=parse(await out.file('xl/sharedStrings.xml').async('string'));assert.deepEqual(els(shared,S,'t').map(n=>n.textContent),['标题','Title']);assert.equal(els(shared,S,'b').length,2);assert.equal(shared.documentElement.getAttribute('uniqueCount'),'2');
 assert.equal(await out.file('xl/styles.xml').async('string'),'styles-original');assert.equal(await out.file('xl/charts/chart1.xml').async('string'),'chart-original');
});

test('嵌套文本框段落不重复提取',async()=>{
 const source=await docx({'word/document.xml':`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>外部</w:t></w:r><w:txbxContent><w:p><w:r><w:t>内部</w:t></w:r></w:p></w:txbxContent></w:p></w:body></w:document>`});
 const plan=await prepareOfficeTranslation({name:'test.docx',bytes:source});assert.equal(plan.segments.length,3);assert.equal(plan.segments[0].text,'<s0>外部</s0>');assert.equal(plan.segments[1].text,'<s0>内部</s0>');
});

test('模型不能缺条、注入XML或更改格式标记，失败不修改计划',async()=>{
 const plan=await prepareOfficeTranslation({name:'test.docx',bytes:await docx()});
 await assert.rejects(plan.write(new Map()),{code:'OFFICE_TRANSLATION'});
 for(const value of ['<s0>Hello</s0>','<s1>World</s1><s0>Hello</s0>','<s0 x="a">Hello</s0><s1>World</s1>','<s0><b>Hello</b></s0><s1>World</s1>','<s0></s0><s1>World</s1>','<s0>Hello</s0><s1>World</s1><s1>extra</s1>']){
  const values=translated(plan);values.set(plan.segments[0].id,value);await assert.rejects(plan.write(values));
 }
 const values=translated(plan);values.delete(plan.segments[0].id);values.set('unknown','value');await assert.rejects(plan.write(values),{code:'OFFICE_TRANSLATION'});
 assert.ok((await plan.write(translated(plan))).length>0);
});

test('非支持格式返回null；损坏XML、数字签名、宏和过长段落拒绝',async()=>{
 assert.equal(await prepareOfficeTranslation({name:'test.pdf',bytes:Buffer.from('x')}),null);
 await assert.rejects(prepareOfficeTranslation({name:'test.docx',bytes:Buffer.from('notzip')}),{code:'OFFICE_ZIP'});
 await assert.rejects(prepareOfficeTranslation({name:'test.docx',bytes:await docx({'word/document.xml':'<bad>'})}),{code:'OFFICE_XML'});
 for(const file of ['word/vbaProject.bin','_xmlsignatures/sig1.xml'])await assert.rejects(prepareOfficeTranslation({name:'test.docx',bytes:await docx({[file]:'x'})}),{code:'OFFICE_UNSUPPORTED'});
 await assert.rejects(prepareOfficeTranslation({name:'test.docx',bytes:await docx({'word/document.xml':`<w:document xmlns:w="${W}"><w:p><w:r><w:t>${'长'.repeat(3001)}</w:t></w:r></w:p></w:document>`})}),{code:'OFFICE_SEGMENT_LIMIT'});
 await assert.rejects(prepareOfficeTranslation({name:'test.docx',bytes:await docx({'word/document.xml':'<!DOCTYPE x [<!ENTITY a "test">]><x/>'})}),{code:'OFFICE_XML'});
 await assert.rejects(prepareOfficeTranslation({name:'test.xlsx',bytes:await packageOf({'xl/workbook.xml':'<broken>'})}),{code:'OFFICE_XML'});
 await assert.rejects(prepareOfficeTranslation({name:'test.docx',bytes:await docx({'word/document.xml':'<document xmlns="http://purl.oclc.org/ooxml/wordprocessingml/main"/>'})}),{code:'OFFICE_UNSUPPORTED'});
});

test('ZIP条目数和解压尺寸在读取文本前受限',async()=>{
 const files={};for(let i=0;i<3001;i++)files['entry'+i]='';
 await assert.rejects(prepareOfficeTranslation({name:'test.docx',bytes:await packageOf(files)}),{code:'OFFICE_LIMIT'});
 await assert.rejects(prepareOfficeTranslation({name:'test.docx',bytes:await docx({'word/document.xml':'x'.repeat(12*1024*1024+1)})}),{code:'OFFICE_LIMIT'});
});
