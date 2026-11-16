import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const S='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const MAX_XML=12*1024*1024,MAX_SEGMENTS=2000,MAX_TEXT=160000;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code,status:422});};
const children=(node,ns,name)=>Array.from(node.getElementsByTagNameNS(ns,name));
const direct=(node,ns,name)=>Array.from(node.childNodes).find(n=>n.nodeType===1&&n.namespaceURI===ns&&n.localName===name);
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function parse(text,label){
  if(/<!DOCTYPE|<!ENTITY/i.test(text))fail('OFFICE_XML','文件含不支持的XML实体声明');
  const errors=[];
  const doc=new DOMParser({errorHandler:{warning:m=>errors.push(m),error:m=>errors.push(m),fatalError:m=>errors.push(m)}}).parseFromString(text,'application/xml');
  if(errors.length||!doc.documentElement||doc.getElementsByTagName('parsererror').length)fail('OFFICE_XML',`${label}结构损坏，未生成译文`);
  return doc;
}
function ancestor(node,ns,name){for(let p=node.parentNode;p;p=p.parentNode)if(p.namespaceURI===ns&&p.localName===name)return p;return null;}
async function load(bytes){
  if(!bytes||bytes.length>50*1024*1024)fail('OFFICE_LIMIT','文件过大，最多50MB');
  let zip;try{zip=await JSZip.loadAsync(bytes,{checkCRC32:false});}catch{fail('OFFICE_ZIP','文件无法读取，请提供有效的DOCX或XLSX');}
  const entries=Object.values(zip.files);if(entries.length>3000)fail('OFFICE_LIMIT','文件部件过多，请拆分后翻译');
  let size=0;
  for(const e of entries){
    const name=e.unsafeOriginalName||e.name;
    if(/(^[\\/]|^[A-Za-z]:|(?:^|[\\/])\.\.(?:[\\/]|$))/.test(name))fail('OFFICE_ZIP','压缩包路径无效');
    const n=e._data?.uncompressedSize||0;size+=n;
    if(n>60*1024*1024||size>120*1024*1024||/\.xml$/i.test(e.name)&&n>MAX_XML)fail('OFFICE_LIMIT','解压后内容过大，请拆分后翻译');
    if(/(?:^|\/)(?:vbaProject\.bin|_xmlsignatures)(?:\/|$)/i.test(e.name))fail('OFFICE_UNSUPPORTED','含宏或数字签名的文件不做自动写回，请提供无宏、无签名副本');
  }
  return zip;
}

export async function readOfficeContent({name,bytes}){
  if(!/\.(?:docx|xlsx)$/i.test(name||''))return null;
  const zip=await load(bytes),read=async path=>{const entry=zip.file(path);if(!entry)fail('OFFICE_PACKAGE',`缺少${path}，文件结构不完整`);return parse(await entry.async('string'),path);};
  let remaining=14000,truncated=false;
  const take=text=>{const value=String(text);if(value.length>remaining)truncated=true;const out=value.slice(0,remaining);remaining-=out.length;return out;};
  if(/\.docx$/i.test(name)){
    const doc=await read('word/document.xml');
    if(doc.documentElement.namespaceURI!==W)fail('OFFICE_UNSUPPORTED','请提供标准DOCX文件');
    const paragraphs=children(doc,W,'p').map(p=>children(p,W,'t').filter(n=>ancestor(n,W,'p')===p&&!ancestor(n,W,'del')).map(n=>n.textContent).join('')).filter(Boolean);
    return {format:'docx',text:take(paragraphs.join('\n')),truncated,coverage:'正文与表格文字，不含图片内文字、批注及版式判断'};
  }
  const workbook=await read('xl/workbook.xml');
  if(workbook.documentElement.namespaceURI!==S)fail('OFFICE_UNSUPPORTED','请提供标准XLSX文件');
  const strings=zip.file('xl/sharedStrings.xml')?children(await read('xl/sharedStrings.xml'),S,'si').map(n=>children(n,S,'t').filter(t=>!ancestor(t,S,'rPh')).map(t=>t.textContent).join('')):[];
  const relations=zip.file('xl/_rels/workbook.xml.rels')?Array.from((await read('xl/_rels/workbook.xml.rels')).getElementsByTagName('*')).filter(n=>n.localName==='Relationship'):[];
  const sheets=[];
  for(const [i,sheet] of children(workbook,S,'sheet').entries()){
    const rel=relations.find(r=>r.getAttribute('Id')===sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'));
    const target=rel?.getAttribute('Target'),path=target?(target.startsWith('/xl/')?target.slice(1):'xl/'+target):`xl/worksheets/sheet${i+1}.xml`;
    if(!/^xl\/worksheets\/[^/]+\.xml$/.test(path)||rel?.getAttribute('TargetMode')==='External')fail('OFFICE_PACKAGE','工作表关系无效');
    const doc=await read(path);if(doc.documentElement.namespaceURI!==S)fail('OFFICE_PACKAGE','工作表结构无效');
    const rows=children(doc,S,'row'),sample=[];let nonemptyRows=0;
    for(const row of rows){
      const sourceCells=children(row,S,'c');
      if(!sourceCells.some(c=>direct(c,S,'v')?.textContent||children(c,S,'t').some(n=>n.textContent)||direct(c,S,'f')))continue;
      nonemptyRows++;
      if(sample.length>=30||remaining<=0){truncated=true;continue;}
      const cells=sourceCells.slice(0,24).map(c=>{
        const v=direct(c,S,'v')?.textContent||'',type=c.getAttribute('t'),formula=direct(c,S,'f')?.textContent;
        if(type==='s'&&(!/^\d+$/.test(v)||strings[Number(v)]===undefined))fail('OFFICE_PACKAGE','共享字符串引用无效');
        const value=type==='s'?strings[Number(v)]??'':type==='inlineStr'?children(c,S,'t').map(n=>n.textContent).join(''):v;
        return {cell:c.getAttribute('r'),value:take(value),...(formula?{formula:take(formula),cached:true}:{})};
      }).filter(c=>c.value||c.formula);
      if(cells.length)sample.push(cells);
      if(sourceCells.length>24)truncated=true;
    }
    sheets.push({name:sheet.getAttribute('name'),nonemptyRows,sample});
    if(remaining<=0){truncated=true;break;}
    if(sheets.length>=10){truncated=sheets.length<children(workbook,S,'sheet').length||truncated;break;}
  }
  return {format:'xlsx',sheets,truncated,coverage:'每表最多30个非空行、每行24格的样本；公式值为文件缓存，未重算；日期可能为Excel序列号，不据样本推算全表总计'};
}

export async function prepareOfficeTranslation({name,bytes}){
  const format=/\.docx$/i.test(name||'')?'docx':/\.xlsx$/i.test(name||'')?'xlsx':null;
  if(!format)return null;
  const zip=await load(bytes),parts=new Map(),segments=[],jobs=[];
  let total=0;
  async function part(path,editable=true){
    const entry=zip.file(path);if(!entry)fail('OFFICE_PACKAGE',`缺少${path}，文件结构不完整`);
    const text=await entry.async('string');if(text.length>MAX_XML)fail('OFFICE_LIMIT','XML内容过大，请拆分后翻译');
    const doc=parse(text,path);if(editable)parts.set(path,doc);return doc;
  }
  function add(nodes,id,commit){
    if(!nodes.length||!/[\p{L}]/u.test(nodes.map(n=>n.textContent).join('')))return;
    const text=nodes.map((n,i)=>`<s${i}>${escape(n.textContent)}</s${i}>`).join('');
    if(text.length>3000)fail('OFFICE_SEGMENT_LIMIT','单个段落或单元格过长，请拆分后翻译');
    total+=text.length;
    if(segments.length>=MAX_SEGMENTS||total>MAX_TEXT)fail('OFFICE_LIMIT','待翻译内容过多，请拆分文件后翻译');
    segments.push({id,text});jobs.push({id,nodes,commit});
  }
  const limitations=[];
  if(format==='docx'){
    if(!zip.file('word/document.xml'))fail('OFFICE_PACKAGE','Word文件缺少正文');
    for(const path of Object.keys(zip.files).filter(p=>/^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(p))){
      const doc=await part(path),paragraphs=children(doc,W,'p');
      if(doc.documentElement.namespaceURI!==W)fail('OFFICE_UNSUPPORTED','此Word使用不支持的XML格式，请另存为标准DOCX');
      for(let i=0;i<paragraphs.length;i++){
        const p=paragraphs[i];
        if(ancestor(p,W,'del')||children(p,W,'instrText').length||children(p,W,'fldChar').length)continue;
        const nodes=children(p,W,'t').filter(n=>ancestor(n,W,'p')===p&&!ancestor(n,W,'del')&&!ancestor(n,W,'fldSimple'));
        add(nodes,`docx:${path}:${i}`);
      }
    }
    limitations.push('保留原段落、表格、样式和图片；译文长度可能改变换行或分页。域代码及删除修订不翻译。');
  }else{
    if(!zip.file('xl/workbook.xml'))fail('OFFICE_PACKAGE','Excel文件缺少工作簿结构');
    const workbook=await part('xl/workbook.xml',false);
    if(workbook.documentElement.namespaceURI!==S||workbook.documentElement.localName!=='workbook')fail('OFFICE_UNSUPPORTED','此Excel使用不支持的XML格式，请另存为标准XLSX');
    // Copy translated strings instead of changing a shared entry used by formula caches.
    let shared=null,items=[];const translatedShared=new Map();
    if(zip.file('xl/sharedStrings.xml')){shared=await part('xl/sharedStrings.xml');if(shared.documentElement.namespaceURI!==S||shared.documentElement.localName!=='sst')fail('OFFICE_PACKAGE','共享字符串结构无效');items=children(shared,S,'si');}
    for(const path of Object.keys(zip.files).filter(p=>/^xl\/worksheets\/sheet\d+\.xml$/.test(p))){
      const doc=await part(path);if(doc.documentElement.namespaceURI!==S||doc.documentElement.localName!=='worksheet')fail('OFFICE_PACKAGE','工作表结构无效');let index=0;
      for(const cell of children(doc,S,'c')){
        index++;
        if(direct(cell,S,'f'))continue;
        const type=cell.getAttribute('t');
        if(type==='s'){
          const v=direct(cell,S,'v');
          if(!v||!/^\d+$/.test(v.textContent)||!items[Number(v.textContent)])fail('OFFICE_PACKAGE','共享字符串引用无效');
          const key=Number(v.textContent);
          let item=translatedShared.get(key);
          if(!item){
            const clone=items[key].cloneNode(true),nodes=children(clone,S,'t').filter(n=>!ancestor(n,S,'rPh'));
            item={clone,values:[],translatedIndex:null};translatedShared.set(key,item);
            add(nodes,`xlsx:shared:${key}`,()=>{
              // Phonetic annotations refer to the original spelling, not the translation.
              for(const n of children(clone,S,'rPh'))n.parentNode.removeChild(n);
              const count=children(shared,S,'si').length;shared.documentElement.appendChild(clone);item.translatedIndex=count;
              shared.documentElement.setAttribute('uniqueCount',String(count+1));
              for(const value of item.values)value.textContent=String(count);
            });
          }
          item.values.push(v);
        }else if(type==='inlineStr'){
          const content=direct(cell,S,'is');if(content)add(children(content,S,'t').filter(n=>!ancestor(n,S,'rPh')),`xlsx:${path}:${index}`);
        }else if(type==='str'){
          // A text result without a formula is a literal string; formula results were skipped.
          const v=direct(cell,S,'v');if(v)add([v],`xlsx:${path}:${index}`);
        }
      }
    }
    limitations.push('仅翻译文字单元格；公式、数字、日期、样式、合并区域和图表保留。公式计算结果、图表内文字及工作表名不翻译。');
  }
  let written=false;
  return {format,segments,limitations,async write(translations){
    if(written)fail('OFFICE_ALREADY_WRITTEN','此翻译计划已经写回，请重新读取原件');
    if(!(translations instanceof Map)||translations.size!==jobs.length||jobs.some(j=>!translations.has(j.id)))fail('OFFICE_TRANSLATION','译文条目缺失或含未知条目');
    const values=jobs.map(job=>{
      const text=translations.get(job.id);
      if(typeof text!=='string'||text.length>24000)fail('OFFICE_TRANSLATION','译文条目无效');
      const doc=parse('<root>'+text+'</root>','译文标记'),nodes=Array.from(doc.documentElement.childNodes).filter(n=>!(n.nodeType===3&&!n.nodeValue.trim()));
      if(nodes.length!==job.nodes.length)fail('OFFICE_TRANSLATION','译文格式标记缺失或重复');
      return nodes.map((node,i)=>{
        if(node.nodeType!==1||node.tagName!==`s${i}`||node.attributes.length||Array.from(node.childNodes).some(n=>n.nodeType!==3&&n.nodeType!==4))fail('OFFICE_TRANSLATION','译文格式标记被修改');
        if(job.nodes[i].textContent.trim()&&!node.textContent.trim())fail('OFFICE_TRANSLATION','译文内容为空');
        return node.textContent;
      });
    });
    written=true;
    for(let i=0;i<jobs.length;i++){
      jobs[i].nodes.forEach((node,n)=>{node.textContent=values[i][n];if(node.namespaceURI===W||node.namespaceURI===S&&node.localName==='t')node.setAttribute('xml:space','preserve');});
      jobs[i].commit?.();
    }
    const serializer=new XMLSerializer();for(const [path,doc]of parts)zip.file(path,serializer.serializeToString(doc));
    // Only parsed text parts are serialized; binary assets and relationships are not edited.
    return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  }};
}
