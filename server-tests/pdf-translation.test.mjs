import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {preparePdfTranslation} from '../server/pdf-translation.mjs';
import sharp from 'sharp';

async function fixture({scan=false,mixed=false,form=false}={}){
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
  const image=await doc.embedPng(await sharp({create:{width:30,height:20,channels:3,background:'#2376be'}}).png().toBuffer());
  const page=doc.addPage([500,700]);
  page.drawRectangle({x:20,y:20,width:460,height:660,borderWidth:2,borderColor:rgb(.2,.4,.6)});
  page.drawImage(image,{x:50,y:400,width:100,height:60});
  if(!scan){page.drawText('Operating instructions',{x:50,y:620,size:16,font});page.drawText('Check emergency stop before starting.',{x:50,y:580,size:12,font});}
  if(mixed){const second=doc.addPage([500,700]);second.drawImage(image,{x:0,y:0,width:500,height:700});}
  if(form)doc.getForm().createTextField('name').addToPage(page,{x:50,y:200,width:100,height:20});
  return Buffer.from(await doc.save());
}

async function inspect(bytes){
  const task=getDocument({data:Uint8Array.from(bytes),isEvalSupported:false});
  try{const doc=await task.promise,items=[];for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),content=await page.getTextContent(),ops=await page.getOperatorList();items.push({text:content.items.map(x=>x.str||'').join(' '),images:ops.fnArray.filter(x=>[OPS.paintImageXObject,OPS.paintInlineImageXObject].includes(x)).length,size:page.getViewport({scale:1})});}return items;}
  finally{await task.destroy();}
}

test('PDF后端提取与对照生成：原页文字、图片、尺寸保留，中文译文独立排版',async()=>{
  const source=await fixture(),copy=Buffer.from(source),plan=await preparePdfTranslation({name:'manual.pdf',bytes:source});
  assert.equal(plan.format,'pdf');assert.equal(plan.outputMode,'parallel-pages');assert.match(plan.limitations.join(''),/不是原位替换/);assert.ok(plan.segments.some(x=>x.text.includes('emergency stop')));
  const values=new Map(plan.segments.map(x=>[x.id,'操作说明\n启动之前，请检查急停按钮。']));
  const out=await plan.write(values);assert.deepEqual(source,copy);
  const original=await inspect(source),translated=await inspect(out);
  assert.equal(translated.length,2);assert.equal(translated[0].text,original[0].text);assert.equal(translated[0].images,original[0].images);assert.equal(translated[0].size.width,500);assert.equal(translated[0].size.height,700);assert.match(translated[1].text,/操作说明/);assert.match(translated[1].text,/急停按钮/);
});

test('PDF扫描页、混合扫描、表单、损坏文件、超限与取消不伪造完整翻译',async()=>{
  assert.equal(await preparePdfTranslation({name:'notes.txt',bytes:Buffer.from('x')}),null);
  await assert.rejects(preparePdfTranslation({name:'scan.pdf',bytes:await fixture({scan:true})}),{code:'PDF_OCR_REQUIRED'});
  await assert.rejects(preparePdfTranslation({name:'mixed.pdf',bytes:await fixture({mixed:true})}),{code:'PDF_OCR_REQUIRED'});
  await assert.rejects(preparePdfTranslation({name:'form.pdf',bytes:await fixture({form:true})}),{code:'PDF_FORM'});
  await assert.rejects(preparePdfTranslation({name:'broken.pdf',bytes:Buffer.from('%PDF-bad')}),{code:'PDF_INVALID'});
  await assert.rejects(preparePdfTranslation({name:'large.pdf',bytes:Buffer.alloc(20*1024*1024+1)}),{code:'PDF_LIMIT'});
  await assert.rejects(preparePdfTranslation({name:'cancel.pdf',bytes:await fixture(),signal:AbortSignal.abort()}),{name:'AbortError'});
});

test('PDF缺译文与缺目标语言字体时拒绝交付，长译文安全分页而不缩成小字',async()=>{
  const plan=await preparePdfTranslation({name:'manual.pdf',bytes:await fixture()});
  await assert.rejects(plan.write(new Map()),{code:'PDF_TRANSLATION_MISSING'});
  await assert.rejects(plan.write(new Map(plan.segments.map(s=>[s.id,' ']))),{code:'PDF_TRANSLATION_MISSING'});
  const previous=process.env.DOCUMENT_TRANSLATION_FONT_PATH;
  process.env.DOCUMENT_TRANSLATION_FONT_PATH='Z:/missing/synthetic-font.ttf';
  try{await assert.rejects(plan.write(new Map(plan.segments.map(s=>[s.id,'Translated text']))),{code:'PDF_FONT'});}finally{if(previous===undefined)delete process.env.DOCUMENT_TRANSLATION_FONT_PATH;else process.env.DOCUMENT_TRANSLATION_FONT_PATH=previous;}
  const output=await plan.write(new Map(plan.segments.map(s=>[s.id,Array.from({length:300},(_,i)=>`Line ${i+1}: translated operating instructions.`).join('\n')])));
  const pages=await inspect(output);assert.ok(pages.length>2);assert.match(pages.at(-1).text,/Line 300/);
});
