import test from 'node:test';
import assert from 'node:assert/strict';
import {planSketch, renderSketch, normalizeScene} from '../server/card-sketch.mjs';

const electricCard = {
  title: '低压配电柜二次回路图纸审阅',
  problem: '新人画的二次回路图，需要按规范审阅接线和标注。',
  skills: ['电气', '图纸审阅']
};
const translationCard = {
  title: '设备操作手册翻译成英文',
  problem: '把操作手册翻译成英文，术语要统一。',
  skills: ['翻译', '文档']
};
const trainingCard = {
  title: '新员工 PLC 基础培训',
  problem: '给新同事做 PLC 基础培训，需要课程材料和练习。',
  skills: ['培训', 'PLC']
};

test('电气审阅卡片会生成控制柜、文档和放大镜场景', () => {
  const scene = planSketch(electricCard, {});
  const kinds = scene.objects.map(object => object.kind);
  assert.ok(kinds.includes('cabinet'));
  assert.ok(kinds.includes('document'));
  assert.ok(kinds.includes('magnifier'));
  assert.equal(scene.background, 'industrial');
  assert.ok(kinds.length <= 14);
});
test('翻译卡片会生成文档、对话气泡和地球', () => {
  const scene = planSketch(translationCard, {});
  const kinds = scene.objects.map(object => object.kind);
  assert.ok(kinds.includes('document'));
  assert.ok(kinds.includes('speech'));
  assert.ok(kinds.includes('globe'));
  assert.equal(scene.background, 'sea');
});
test('培训卡片会生成白板、书和植物', () => {
  const scene = planSketch(trainingCard, {});
  const kinds = scene.objects.map(object => object.kind);
  assert.ok(kinds.includes('presentation'));
  assert.ok(kinds.includes('book'));
  assert.ok(kinds.includes('plant'));
  assert.equal(scene.background, 'forest');
});
test('场景渲染包含风景背景和前景桌面', () => {
  const svg = renderSketch(planSketch(electricCard, {}));
  assert.match(svg, /<linearGradient id="sky"/);
  assert.match(svg, /fill="url\(#sky\)"/);
  assert.match(svg, /filter="url\(#paper\)"/);
  assert.match(svg, /opacity="0\.96"/);
});
test('场景渲染是确定性的，便于签名后重放校验', () => {
  const scene = planSketch(electricCard, {});
  const a = renderSketch(scene);
  const b = renderSketch(scene);
  assert.equal(a, b);
  assert.match(a, /viewBox="0 0 1200 400"/);
});
test('渲染结果不包含脚本、事件属性或外部引用', () => {
  const svg = renderSketch(planSketch(electricCard, {}));
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(svg, /href=/i);
  assert.doesNotMatch(svg, /<foreignObject/i);
});
test('场景校验会拒绝未知对象并限制坐标', () => {
  assert.throws(() => normalizeScene({objects: [{kind: 'unknown'}]}), /对象类型无效/);
  assert.throws(() => normalizeScene({objects: []}), /1 到 14 个对象/);
  assert.throws(() => normalizeScene({objects: [{kind: 'document'}], background: 'space'}), /背景类型无效/);
  const scene = normalizeScene({objects: [{kind: 'document', x: -9999, y: 9999, width: 230}]});
  assert.equal(scene.objects[0].x, -1200);
  assert.equal(scene.objects[0].y, 2400);
});
