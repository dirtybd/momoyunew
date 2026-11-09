import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import vm from 'node:vm';
import fs from 'node:fs';
import {rankSnapshot,defaultPreferences} from '../server/matching.mjs';
import {reviewCareContent} from '../server/content-review.mjs';

const now=Date.parse('2026-11-03T10:00:00+08:00');
const request={title:'自动核对两份清单',problem:'需要脚本按ID比对两份xlsx并生成差异文件',desiredOutcome:'可重复运行的数据核对',deliverables:['批处理脚本和差异表'],skills:['数据核对'],deadlineEnd:Date.parse('2026-11-03T23:59:59+08:00')};
const person=(id,extra={})=>({id,skills:['程序开发'],skillDescription:'使用pandas读取xlsx，按唯一编号合并与比对数据并导出报告',acceptingHelp:true,preferences:defaultPreferences(),activeCount:0,...extra});
async function mock(t,respond){
  const seen=[];const s=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);seen.push(b);const answer=await respond(b,seen.length);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(answer));});s.listen(0,'127.0.0.1');await once(s,'listening');t.after(()=>{s.closeAllConnections();s.close();});return {seen,config:{base:'http://127.0.0.1:'+s.address().port+'/v1',key:'test-only',policy:'semantic-test'}};
}
const result=rows=>({data:{status:'succeeded',outputs:{matches_json:JSON.stringify(rows)}}});

test('语义匹配不按标签淘汰，时间/意愿/负载先过滤，真实证据与缓存可验证',async t=>{
  const m=await mock(t,body=>{const s=JSON.parse(body.inputs.snapshot_json);assert.deepEqual(s.candidates.map(c=>c.id),['transferable','unrelated']);return result([{candidateId:'transferable',score:91,reason:'有脚本处理表格和比对编号的经验',evidence:'使用pandas读取xlsx'}]);});
  const data={now,request,privateChat:'never-send-private-chat',candidates:[person('transferable',{bio:'never-send-bio',displayName:'never-send-name'}),person('unrelated',{skills:['平面设计'],skillDescription:'只会海报排版'}),person('opt-out',{acceptingHelp:false}),person('busy',{activeCount:2}),person('muted',{preferences:{...defaultPreferences(),notifications:false}}),person('time-conflict',{preferences:{...defaultPreferences(),weekdays:[3]}})]};
  const entries=new Map(),cache={get:k=>entries.get(k),set:(k,v)=>entries.set(k,v)};
  const ranked=await rankSnapshot(data,m.config,{cache});assert.equal(ranked.method,'semantic');assert.deepEqual(ranked.matches.map(c=>c.candidateId),['transferable']);assert.equal(ranked.matches[0].timeStatus,'unconfirmed');assert.ok(!JSON.stringify(m.seen).includes('never-send'));
  await rankSnapshot({...data,now:now+30000},m.config,{cache});assert.equal(m.seen.length,1,'只复用能力判断，仍重新检查硬限制');
  const changed=structuredClone(data);changed.candidates[0].skillDescription='仅会录入，不会开发';await assert.rejects(()=>rankSnapshot(changed,m.config,{cache}));assert.equal(m.seen.length,2,'技能说明变化不能复用旧依据');
});

test('模型不能编造人员、证据或忽略阈值，并行分批不漏员工',async t=>{
  let behavior='unknown';const m=await mock(t,b=>{const s=JSON.parse(b.inputs.snapshot_json);if(behavior==='unknown')return result([{candidateId:'outsider',score:100,reason:'伪造',evidence:'pandas'}]);if(behavior==='invent')return result([{candidateId:s.candidates[0].id,score:99,reason:'伪造技能',evidence:'拥有注册心理医生资格'}]);if(behavior==='low')return result([{candidateId:s.candidates[0].id,score:30,reason:'能力不足',evidence:'pandas'}]);return result(s.candidates.map(c=>({candidateId:c.id,score:85,reason:'数据脚本经验相关',evidence:'pandas'})));});
  const data={now,request,candidates:[person('p1')]};await assert.rejects(()=>rankSnapshot(data,m.config));behavior='invent';await assert.rejects(()=>rankSnapshot(data,m.config));behavior='low';assert.equal((await rankSnapshot(data,m.config)).matches.length,0);
  behavior='many';const many=await rankSnapshot({...data,candidates:Array.from({length:50},(_,i)=>person('p'+i))},m.config);assert.equal(many.matches.length,50);assert.equal(new Set(many.matches.map(m=>m.candidateId)).size,50);assert.ok(m.seen.every(b=>JSON.parse(b.inputs.snapshot_json).candidates.length<=24));
});

test('内容审核严格布尔、危机优先与不可用时拒绝写入',async t=>{
  let output={allow:true,urgent:false,reason:'普通压力倾诉可以分享'};
  const m=await mock(t,b=>{assert.equal(b.inputs.snapshot_json,'');const r=JSON.parse(b.inputs.review_json);assert.equal(r.content,'最近项目很赶，想说说感受');assert.equal(r.privateHistory,undefined);return {data:{status:'succeeded',outputs:{review_result_json:JSON.stringify(output)}}};});
  const input={type:'care_post',title:'想被听见',content:'最近项目很赶，想说说感受'};
  assert.equal((await reviewCareContent(input,m.config)).allow,true);output={allow:true,urgent:true,reason:'先在私密支持中照顾当前安全'};const urgent=await reviewCareContent(input,m.config);assert.equal(urgent.allow,false);assert.equal(urgent.urgent,true);
  output={allow:'true',urgent:false,reason:'invalid'};await assert.rejects(()=>reviewCareContent(input,m.config),{status:503});await assert.rejects(()=>reviewCareContent(input,null),{status:503});
});

test('导出工作流的代码节点能运行，真实依据与审核结构验证不放水',()=>{
  const d=JSON.parse(fs.readFileSync('docs/dify-matching-workflow.yml','utf8'));const run=(id,args)=>{const code=d.workflow.graph.nodes.find(n=>n.id===id).data.code;return vm.runInNewContext(code+';main('+JSON.stringify(args)+')');};
  const prepared=run('match_prepare',{snapshot_json:JSON.stringify({now,request,candidates:[person('valid'),person('busy',{activeCount:2})]})});assert.equal(JSON.parse(prepared.candidates_json).length,1);
  const valid=run('match_validate',{text:JSON.stringify({matches:[{candidateId:'valid',score:90,reason:'表格脚本经验相关',evidence:'pandas'}]}),allowed_json:prepared.allowed_json});assert.equal(JSON.parse(valid.matches_json).length,1);
  assert.throws(()=>run('match_validate',{text:JSON.stringify({matches:[{candidateId:'valid',score:99,reason:'捏造',evidence:'不存在的技能'}]}),allowed_json:prepared.allowed_json}));
  assert.equal(JSON.parse(run('review_validate',{text:'{"allow":true,"urgent":true,"reason":"先私密支持"}'}).review_result_json).allow,false);
  assert.throws(()=>run('review_validate',{text:'{"allow":"yes","urgent":false,"reason":"拒绝错误类型"}'}));
});
