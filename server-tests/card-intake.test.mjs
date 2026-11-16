import {test} from 'node:test';import assert from 'node:assert/strict';import {isEmptyCardStart,initialCardClarification,CARD_INTAKE_REPLY} from '../server/card-intake.mjs';
const template='帮我发布一条互助请求：关于……（要解决的问题），希望达成……，交付物是……，截止时间是……，需要具备……经验的同事帮忙。';
test('空白互助开场直接专业追问，不生成卡片或进入匹配',()=>{
 for(const text of [template,template.replaceAll('……','......'),'帮我发布一条互助请求','请创建一张求助卡','/卡片 帮我发布一条互助请求']){
  assert.ok(isEmptyCardStart(text),text);const result=initialCardClarification(text);assert.equal(result.reply,CARD_INTAKE_REPLY);assert.equal(result.card,null);assert.equal(result.ready,false);assert.ok(result.suppressRecommendations);assert.doesNotMatch(result.reply,/占位|字段|模板|格式错误/);
 }
});
test('有真实事项、材料、旧任务或私密倾诉时交回正常澄清，不丢上下文',()=>{
 for(const text of ['帮我发布一条互助请求：关于PLC程序审阅，希望达成……，交付物是……','帮我发布一条互助请求，分析“……”符号的用法','我想找同事帮忙检查Excel公式','今天很难过，想倾诉'])assert.equal(initialCardClarification(text),null,text);
 for(const context of [{card:{title:'已有任务'}},{card:{problem:'旧问题'}},{history:[{role:'user',content:'需要汇总六家门店的周报'}]},{attachmentCount:1},{outputCount:1},{card:{careMode:true}},{card:{careSafety:'urgent'}}])assert.equal(initialCardClarification(template,context),null);
});
