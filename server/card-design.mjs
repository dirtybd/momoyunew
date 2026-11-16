import {createHmac, randomUUID, timingSafeEqual, createHash} from 'node:crypto';
import {hasIcon, pickIcons, renderIconArtwork} from './card-icons.mjs';
import {normalizeScene, planSketch, renderSketch} from './card-sketch.mjs';

const hex = /^#[0-9a-f]{6}$/i;
const shapes = ['standard','ticket','polaroid','bubble'];
const layouts = ['standard','poster','note'];
const iconName = /^[a-z0-9][a-z0-9-]{0,60}$/;
const maxIcons = 3;
const bad = message => { throw Object.assign(new Error(message), {status:400,code:'INVALID_DESIGN'}); };
const sign = (text, key) => createHmac('sha256',key).update(text).digest('base64url');
const equal = (a,b) => typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));

export function createDesignJob(key) {
  if (!key) return null;
  const body=Buffer.from(JSON.stringify({nonce:randomUUID(),expires:Date.now()+600000})).toString('base64url');
  return body+'.'+sign(body,key);
}
export function verifyDesignJob(token,key) {
  if (!key || typeof token!=='string' || token.length>512) return false;
  const [body,signature,...extra]=token.split('.');
  if(extra.length || !equal(signature,sign(body,key)))return false;
  try {const data=JSON.parse(Buffer.from(body,'base64url')); return typeof data.nonce==='string' && data.expires>Date.now() && data.expires<=Date.now()+600000;}catch{return false;}
}
function color(value) { if(!hex.test(value))bad('颜色需要使用六位十六进制格式');return value.toLowerCase(); }
function number(value,min,max) {if(!Number.isFinite(value)||value<min||value>max)bad('图形坐标或尺寸超出范围');return Math.round(value*100)/100;}
function readable(background) {
  const rgb=background.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.179?'#211f1c':'#ffffff';
}
export function normalizeDesign(input, context = {}) {
  if(!input || typeof input!=='object' || Array.isArray(input))bad('需要卡片设计对象');
  const keys=['name','paper','accent','sky','shape','layout','elements','icons','objects','blue','green','gold','background'];
  if(Object.keys(input).some(k=>!keys.includes(k)))bad('不支持的设计字段');
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>60)bad('请提供简短设计名称');
  if(!shapes.includes(input.shape)||!layouts.includes(input.layout))bad('轮廓或版式无效');
  const paper=color(input.paper),accent=color(input.accent);
  const base={name:input.name.trim(),paper,accent,sky:color(input.sky),ink:readable(paper),accentInk:readable(accent),shape:input.shape,layout:input.layout};
  const hasElements=Object.hasOwn(input,'elements');
  const hasIcons=Object.hasOwn(input,'icons');
  const hasObjects=Object.hasOwn(input,'objects');
  if([hasElements,hasIcons,hasObjects].filter(Boolean).length>1)bad('卡片封面只能选择一种绘制方式');
  // v3：模型给“手绘场景对象”，后端用 Rough.js 渲染；颜色和坐标都会重新校验。
  if(hasObjects){
    let scene;
    try{scene=normalizeScene({...input,paper,accent,sky:base.sky,ink:base.ink});}
    catch(error){bad(error.message||'手绘场景无效');}
    const result={...base,paper:scene.paper,accent:scene.accent,sky:scene.sky,ink:scene.ink,
      blue:scene.blue,green:scene.green,gold:scene.gold,objects:scene.objects};
    if(scene.background)result.background=scene.background;
    return result;
  }
  // v2：模型只给配色/版式，图标由后端按卡片文本自动挑选；也可以显式给 1-3 个图标名。
  if(hasIcons||!hasElements){
    let icons=[];
    if(hasIcons){
      if(!Array.isArray(input.icons))bad('图标列表格式无效');
      for(const name of input.icons){
        if(typeof name!=='string'||!iconName.test(name)||!hasIcon(name))bad('图标名称不存在或不可用');
        if(!icons.includes(name))icons.push(name);
      }
      if(icons.length>maxIcons)bad('最多选择 3 个图标');
    }
    if(!icons.length)icons=pickIcons(context.card||{},maxIcons);
    if(!icons.length)bad('没有可用的卡片图标');
    return {...base,icons};
  }
  // v1：保留旧的 1-50 个 SVG 装饰图形协议，存量 artifact 继续可校验。
  if(!Array.isArray(input.elements)||input.elements.length<1||input.elements.length>50)bad('需要 1 到 50 个装饰图形');
  const elements=input.elements.map(e=>{
    if(!e || typeof e!=='object'||Array.isArray(e))bad('图形无效');
    const fields={circle:['cx','cy','r'],ellipse:['cx','cy','rx','ry'],rect:['x','y','width','height','rx'],line:['x1','y1','x2','y2'],path:['d']}[e.type];
    if(!fields || Object.keys(e).some(k=>!['type','fill','stroke','strokeWidth','opacity',...fields].includes(k)))bad('图形类型或属性无效');
    const out={type:e.type,fill:e.fill==='none'?'none':color(e.fill||'#ffffff'),opacity:number(e.opacity??1,0,1)};
    if(e.stroke){out.stroke=color(e.stroke);out.strokeWidth=number(e.strokeWidth??2,.1,20);}
    for(const k of fields){
      if(k==='d') {if(typeof e.d!=='string'||e.d.length>1800||!/^\s*[Mm][MmLlHhVvCcSsQqTtAaZz\d\s.,+\-eE]*$/.test(e.d)||!e.d.match(/[\d]/))bad('路径只能包含 SVG 几何命令');out.d=e.d;}
      else if(k==='rx'&&e.type==='rect')out.rx=number(e.rx??0,0,600);
      else out[k]=number(e[k],['r','rx','ry','width','height'].includes(k)?0:-1200,2400);
    }
    return out;
  });
  return {...base,elements};
}
export function renderArtwork(design) {
  if(Array.isArray(design.objects)&&design.objects.length)return renderSketch(design);
  if(Array.isArray(design.icons)&&design.icons.length)return renderIconArtwork(design,design.icons);
  const geometry=design.elements.map(({type,...attrs})=>'<'+type+' '+Object.entries(attrs).map(([k,v])=>`${k==='strokeWidth'?'stroke-width':k}="${v}"`).join(' ')+'/>').join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400"><rect width="1200" height="400" fill="${design.sky}"/>${geometry}</svg>`;
}
export function makeCardArtifact(input,job,key,context={}) {
  if(!verifyDesignJob(job,key))throw Object.assign(new Error('卡片制作凭证无效或已过期，请从网页重新发起。'),{status:401,code:'INVALID_JOB'});
  let source=input;
  // 先在本地试用的手绘模式：模型仍只返回 v2 配色，后端按卡片文本自动编排场景。
  // 未设置 CARD_COVER_STYLE 时正式卡片使用分类照片背景，不会走到这里的自动封面。
  if(process.env.CARD_COVER_STYLE==='sketch'&&input&&typeof input==='object'&&!Array.isArray(input)
    &&!Object.hasOwn(input,'objects')&&!Object.hasOwn(input,'elements')&&!Object.hasOwn(input,'icons')){
    const scene=planSketch(context.card||{},{paper:input.paper,accent:input.accent});
    source={...input,paper:scene.paper,accent:scene.accent,sky:scene.sky,
      blue:scene.blue,green:scene.green,gold:scene.gold,background:scene.background,objects:scene.objects};
  }
  const design=normalizeDesign(source,context),svg=renderArtwork(design);
  const version=Array.isArray(design.objects)?3:Array.isArray(design.icons)?2:1;
  const artifact={version,id:createHash('sha256').update(svg+JSON.stringify(design)).digest('hex').slice(0,24),design,svg};
  return {card_artifact:artifact,signature:sign(job+'\n'+JSON.stringify(artifact),key)};
}
export function readCardArtifact(value,job,key) {
  if(!value || !job || !key || !equal(value.signature,sign(job+'\n'+JSON.stringify(value.card_artifact),key)))return null;
  try {
    const a=value.card_artifact;
    if(![1,2,3].includes(a.version)||!/^[a-f0-9]{24}$/.test(a.id))return null;
    if(a.version===3?!Array.isArray(a.design.objects):a.version===2?!Array.isArray(a.design.icons):!Array.isArray(a.design.elements))return null;
    const {ink,accentInk,...input}=a.design;
    const canonical=normalizeDesign(input);
    if(JSON.stringify(canonical)!==JSON.stringify(a.design)||renderArtwork(canonical)!==a.svg)return null;
    return a;
  }catch{return null;}
}
