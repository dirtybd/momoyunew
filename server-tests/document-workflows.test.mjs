import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const flow=id=>JSON.parse(fs.readFileSync(`docs/dify-workflows/${id}.yml`,'utf8'));
const run=(app,id,args)=>JSON.parse(JSON.stringify(vm.runInNewContext(app.workflow.graph.nodes.find(n=>n.id===id).data.code+'\nmain(args)',{args},{timeout:500})));
const blueprint={status:'ready',title:'申请资料表',format:'docx',sections:[{heading:'申请信息',kind:'table',fields:['姓名','计划日期'],instructions:'保留空白供填写，行高可扩展'}],missingFields:['姓名','计划日期'],questions:[],layout:{pageSize:'A4',orientation:'portrait',latinFont:'Arial',cjkFont:'Microsoft YaHei'},checks:['逐页检查表格及字体']};

test('文档DSL校验输入及规划输出，内容审核不能冒充视觉验收',()=>{
  for(const id of ['document-plan','document-content-review','document-edit-plan']){
    const app=flow(id);
    assert.equal(app.app.mode,'workflow');
    assert.throws(()=>run(app,'prepare',{task_json:JSON.stringify({goal:'设计表格',userId:'other-user'})}));
    assert.throws(()=>run(app,'prepare',{task_json:JSON.stringify({goal:'设计表格',source_text:'x'.repeat(24001)})}));
    assert.throws(()=>run(app,'validate',{text:'<think>未闭合的思考'}));
  }
  const plan=flow('document-plan');
  const providerThoughts=Array.from({length:27},(_,i)=>`<think>分段推理 ${i}</think>\n`).join('');
  assert.equal(JSON.parse(run(plan,'validate',{text:providerThoughts+JSON.stringify(blueprint)}).result_json).title,'申请资料表');
  assert.equal(JSON.parse(run(plan,'validate',{text:JSON.stringify(blueprint)}).result_json).title,'申请资料表');
  assert.throws(()=>run(plan,'validate',{text:JSON.stringify({...blueprint,downloadUrl:'https://invalid.example/document.docx'})}));
  assert.throws(()=>run(plan,'validate',{text:JSON.stringify({...blueprint,status:'needs_clarification'})}));
  const review=flow('document-content-review');
  assert.throws(()=>run(review,'prepare',{task_json:JSON.stringify({goal:'核对成品'})}));
  const result={verdict:'no_content_issue_found',scope:'content_only',visualVerified:false,issues:[],summary:'仅核对提供的文字，未检查页面图像。'};
  assert.equal(JSON.parse(run(review,'validate',{text:JSON.stringify(result)}).result_json).visualVerified,false);
  assert.throws(()=>run(review,'validate',{text:JSON.stringify({...result,visualVerified:true})}));
  assert.throws(()=>run(review,'validate',{text:JSON.stringify({...result,verdict:'revise'})}));
  const edit=flow('document-edit-plan');
  assert.throws(()=>run(edit,'validate',{text:JSON.stringify({status:'ready',scope:'edit_plan_only',questions:[],changes:[],preserve:[],checks:[]})}));
  const q={status:'needs_clarification',scope:'edit_plan_only',questions:['请提供需要修改的原文。'],changes:[],preserve:['保留原件'],checks:['取得原文后定位']};
  assert.equal(JSON.parse(run(edit,'validate',{text:JSON.stringify(q)}).result_json).status,'needs_clarification');
});
