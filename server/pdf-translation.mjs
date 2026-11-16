import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const require=createRequire(import.meta.url);
const pdfjsRoot=dirname(require.resolve('pdfjs-dist/package.json'));
const MAX_BYTES=20*1024*1024,MAX_PAGES=60,MAX_TEXT=120000,SEGMENT_CHARS=2000;
const LIMITATIONS=[
  'PDF采用原页与对应译文页交替的对照副本，保留原页尺寸、图片和版式；译文另页排版，不是原位替换。',
  '仅翻译可提取文字，不识别图片中的文字，不翻译批注、附件或交互表单。',
];
const fail=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
const active=signal=>signal?.throwIfAborted();

function chunks(text){
  const out=[];let pending='';
  for(const line of text.split('\n')){
    if(line.length>SEGMENT_CHARS){if(pending.trim())out.push(pending);pending='';for(let i=0;i<line.length;i+=SEGMENT_CHARS)out.push(line.slice(i,i+SEGMENT_CHARS));continue;}
    if(pending.length+line.length+1>SEGMENT_CHARS){if(pending.trim())out.push(pending);pending='';}
    pending+=(pending?'\n':'')+line;
  }
  if(pending.trim())out.push(pending);
  return out;
}

function pageText(items){
  let out='',lastY=null,lastRight=null;
  for(const item of items){
    if(typeof item.str!=='string')continue;
    const y=item.transform?.[5],x=item.transform?.[4];
    if(lastY!==null&&Number.isFinite(y)&&Math.abs(y-lastY)>Math.max(2,Math.abs(item.height||10)*.45)&&!out.endsWith('\n'))out+='\n';
    else if(out&&!/\s$/.test(out)&&!/^\s/.test(item.str)&&Number.isFinite(x)&&Number.isFinite(lastRight)&&x-lastRight>Math.max(1,(item.height||10)*.15))out+=' ';
    out+=item.str;
    if(item.hasEOL&&!out.endsWith('\n'))out+='\n';
    lastY=y;lastRight=Number.isFinite(x)?x+(item.width||0):null;
  }
  return out.replace(/\u0000/g,'').trim();
}

async function outputFonts(doc){
  doc.registerFontkit(fontkit);
  const explicit=process.env.DOCUMENT_TRANSLATION_FONT_PATH;
  const paths=explicit?[explicit]:[
    ...(process.platform==='win32'?[join(process.env.WINDIR||'C:/Windows','Fonts','simhei.ttf'),join(process.env.WINDIR||'C:/Windows','Fonts','arial.ttf')]:[]),
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ];
  const fonts=[];
  for(const path of paths){
    if(!existsSync(path))continue;
    try{const font=await doc.embedFont(await readFile(path),{subset:true});fonts.push({font,chars:new Set(font.getCharacterSet())});}
    catch{if(explicit)throw fail('PDF_FONT','指定PDF译文字体无法加载，请配置可嵌入的TTF或OTF字体。',503);}
  }
  if(!fonts.length)throw fail('PDF_FONT','服务器缺少PDF译文字体，请配置DOCUMENT_TRANSLATION_FONT_PATH为可嵌入的TTF或OTF字体。',503);
  return fonts;
}

function textRuns(text,fonts){
  const runs=[];
  for(const character of text){
    if(/[\r\n]/.test(character))continue;
    const entry=fonts.find(f=>f.chars.has(character.codePointAt(0)));
    if(!entry)throw fail('PDF_FONT_GLYPH','当前服务器字体不支持部分译文字，无法生成完整PDF；请配置覆盖目标语言的字体。',503);
    const last=runs.at(-1);
    if(last?.font===entry.font)last.text+=character;else runs.push({font:entry.font,text:character});
  }
  return runs;
}

function wrappedLines(text,fonts,width,size){
  const lines=[];
  for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){
    if(!paragraph){lines.push([]);continue;}
    let line='',measured=0;
    for(const char of paragraph){
      const runs=textRuns(char,fonts),next=runs.reduce((sum,r)=>sum+r.font.widthOfTextAtSize(r.text,size),0);
      if(measured+next>width&&line){lines.push(textRuns(line,fonts));line='';measured=0;}
      if(next>width)throw fail('PDF_LAYOUT','译文字符超出可用页宽，无法安全排版。');
      line+=char;measured+=next;
    }
    if(line)lines.push(textRuns(line,fonts));
  }
  return lines;
}

/** PDF is a side-by-side-in-time edition: original page, then its translated page(s). */
export async function preparePdfTranslation({name,bytes,signal}={}){
  if(!/\.pdf$/i.test(name||''))return null;
  active(signal);
  if(!bytes||bytes.length>MAX_BYTES)throw fail('PDF_LIMIT','PDF翻译单个最多20MB。',413);
  const source=Buffer.from(bytes);
  let task,reader;
  const onAbort=()=>{void task?.destroy().catch(()=>{});};
  try{
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    active(signal);
    task=getDocument({data:Uint8Array.from(source),verbosity:0,isEvalSupported:false,enableXfa:false,useSystemFonts:false,disableFontFace:true,maxImageSize:20000000,cMapUrl:join(pdfjsRoot,'cmaps')+'/',cMapPacked:true,standardFontDataUrl:join(pdfjsRoot,'standard_fonts')+'/'});
    signal?.addEventListener('abort',onAbort,{once:true});
    reader=await task.promise;
    if(reader.numPages>MAX_PAGES)throw fail('PDF_LIMIT',`PDF翻译最多${MAX_PAGES}页，请先拆分。`,413);
    const permissions=await reader.getPermissions();
    if(permissions!==null)throw fail('PDF_ENCRYPTED','加密或受权限限制的PDF暂不翻译，请提供未加密副本。');
    const segments=[],pages=[];let total=0;
    for(let i=1;i<=reader.numPages;i++){
      active(signal);
      const page=await reader.getPage(i);
      const annotations=await page.getAnnotations();
      if(annotations.some(a=>a.subtype==='Widget'))throw fail('PDF_FORM','含交互表单或签名的PDF暂不自动翻译，请先提供静态副本。');
      const content=await page.getTextContent({disableNormalization:false});
      const text=pageText(content.items);
      if(!text||!/[\p{L}]/u.test(text))throw fail('PDF_OCR_REQUIRED',`第${i}页没有足够的可提取文字，可能是扫描件；当前模型不具备OCR能力，请提供文字版PDF。`);
      if(text.includes('\uFFFD')||content.items.some(item=>typeof item.str==='string'&&/[\u0000-\u0008\u000e-\u001f]/.test(item.str)))throw fail('PDF_TEXT_UNREADABLE',`第${i}页文字编码无法可靠读取，请提供可复制文字的PDF或Word文件。`);
      total+=text.length;if(total>MAX_TEXT)throw fail('PDF_LIMIT',`PDF文字超过${MAX_TEXT}字符，请先拆分。`,413);
      const ids=[];
      for(const [part,chunk] of chunks(text).entries()){const id=`pdf-p${i}-${part+1}`;segments.push({id,text:chunk});ids.push(id);}
      pages.push({ids});
      page.cleanup();
    }
    active(signal);
    // Validate the source with the same writer before spending model calls.
    let inspected;try{inspected=await PDFDocument.load(source,{updateMetadata:false});}catch{throw fail('PDF_INVALID','PDF无法可靠读取，请提供未损坏且未加密的副本。');}
    if(inspected.getPageCount()!==pages.length)throw fail('PDF_INVALID','PDF页数校验失败。');
    const fontProbe=await PDFDocument.create();await outputFonts(fontProbe);
    return {format:'pdf',segments,limitations:[...LIMITATIONS],outputMode:'parallel-pages',pageCount:pages.length,async write(translations){
      active(signal);
      if(!(translations instanceof Map)||translations.size!==segments.length||segments.some(s=>!translations.has(s.id)||typeof translations.get(s.id)!=='string'||!translations.get(s.id).trim()||translations.get(s.id).length>24000))throw fail('PDF_TRANSLATION_MISSING','PDF译文缺失或不完整，未生成结果。');
      let targetTotal=0;for(const text of translations.values())targetTotal+=text.length;
      if(targetTotal>MAX_TEXT*8)throw fail('PDF_LIMIT','PDF译文过长，请拆分翻译。',413);
      const doc=await PDFDocument.create();
      const fonts=await outputFonts(doc);
      const originals=await doc.copyPages(inspected,inspected.getPageIndices());
      const size=11,lineHeight=17,margin=42;
      for(let i=0;i<pages.length;i++){
        active(signal);
        const original=originals[i];doc.addPage(original);
        const dimensions=original.getSize(),width=Math.max(420,Math.min(842,dimensions.width)),height=Math.max(595,Math.min(1191,dimensions.height));
        const translated=pages[i].ids.map(id=>translations.get(id)).join('\n\n');
        const lines=wrappedLines(translated,fonts,width-2*margin,size);
        let page=null,y=0,part=0;
        for(const line of lines){
          active(signal);
          if(!page||y<margin+lineHeight){
            if(doc.getPageCount()>pages.length*20+60)throw fail('PDF_LAYOUT','译文分页过多，已停止生成，避免产生失真的文件。');
            page=doc.addPage([width,height]);part++;y=height-margin;
            const title=`Translation - source page ${i+1}${part>1?' (continued)':''}`;
            let x=margin;for(const run of textRuns(title,fonts)){page.drawText(run.text,{x,y,size:10,font:run.font,color:rgb(.35,.35,.35)});x+=run.font.widthOfTextAtSize(run.text,10);}y-=30;
          }
          let x=margin;for(const run of line){page.drawText(run.text,{x,y,size,font:run.font,color:rgb(.08,.08,.08)});x+=run.font.widthOfTextAtSize(run.text,size);}y-=lineHeight;
        }
      }
      active(signal);
      const result=Buffer.from(await doc.save({useObjectStreams:false}));
      if(result.length>MAX_BYTES)throw fail('PDF_LIMIT','译文PDF超过20MB，请先拆分原文再翻译。',413);
      active(signal);
      return result;
    }};
  }catch(error){
    active(signal);
    if(error.code)throw error;
    if(error.name==='PasswordException')throw fail('PDF_ENCRYPTED','PDF已加密，请提供未加密副本。');
    throw fail('PDF_INVALID','PDF无法可靠读取，请提供未损坏且可复制文字的PDF。');
  }finally{signal?.removeEventListener('abort',onAbort);if(task)await task.destroy().catch(()=>{});}
}
