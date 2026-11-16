import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDesignJob, makeCardArtifact, readCardArtifact} from '../server/card-design.mjs';
import {hasIcon, loadCatalog, pickIcons, renderIconArtwork} from '../server/card-icons.mjs';

const key = 'test-only-card-design-key-0123456789';
const v2 = {name: '配电柜图纸审阅', paper: '#f4ead8', accent: '#c4553d', sky: '#163b34', shape: 'standard', layout: 'poster'};
const card = {title: '配电柜二次回路图纸审阅', problem: '按规范审阅接线和安全问题', skills: ['电气', '图纸审阅']};

test('图标素材库可加载且包含常用图标', () => {
  const catalog = loadCatalog();
  assert.ok(catalog.icons.length > 500);
  assert.ok(hasIcon('file-check'));
  assert.ok(hasIcon('zap'));
  assert.equal(hasIcon('not-a-real-icon'), false);
  for (const icon of catalog.icons) {
    assert.equal(icon.viewBox, '0 0 24 24');
    assert.ok(icon.body.length > 0 && icon.body.length < 8000);
  }
});

test('按卡片文本挑选图标，避免同组重复', () => {
  const picked = pickIcons(card, 3);
  assert.ok(picked.includes('zap'));
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked).size, 3);
  assert.deepEqual(pickIcons({}, 3), ['circle-help', 'users', 'sparkles']);
});

test('design v2 省略 elements 时自动选图标并可通过验签和重读', () => {
  const job = createDesignJob(key);
  const artifact = makeCardArtifact(v2, job, key, {card});
  assert.equal(artifact.card_artifact.version, 2);
  assert.ok(artifact.card_artifact.design.icons.includes('zap'));
  assert.equal(artifact.card_artifact.design.elements, undefined);
  assert.match(artifact.card_artifact.svg, /<svg[^>]+viewBox="0 0 1200 400"/);
  assert.match(artifact.card_artifact.svg, /<circle cx="300" cy="200" r="205" fill="#f4ead8"/);
  assert.match(artifact.card_artifact.svg, /<circle cx="1040" cy="210" r="230" fill="#c4553d"/);
  assert.match(artifact.card_artifact.svg, /<rect x="560" y="150" width="120" height="100" rx="18"/);
  assert.equal(artifact.card_artifact.svg, renderIconArtwork(artifact.card_artifact.design, artifact.card_artifact.design.icons));
  const read = readCardArtifact(artifact, job, key);
  assert.deepEqual(read.design.icons, artifact.card_artifact.design.icons);
  assert.equal(readCardArtifact(artifact, createDesignJob(key), key), null);
});

test('design v2 支持显式图标并拒绝未知/超量图标', () => {
  const job = createDesignJob(key);
  const explicit = makeCardArtifact({...v2, icons: ['file-text', 'users']}, job, key);
  assert.deepEqual(explicit.card_artifact.design.icons, ['file-text', 'users']);
  assert.equal(readCardArtifact(explicit, job, key).design.icons.length, 2);
  assert.throws(() => makeCardArtifact({...v2, icons: ['not-a-real-icon']}, job, key), {code: 'INVALID_DESIGN'});
  assert.throws(() => makeCardArtifact({...v2, icons: ['file-text', 'users', 'help', 'search']}, job, key), {code: 'INVALID_DESIGN'});
});

test('design v3 手绘场景可通过验签和重读', () => {
  const job = createDesignJob(key);
  const design = {...v2, objects: [
    {kind: 'cabinet', x: 78, y: 58, width: 300, height: 286},
    {kind: 'document', x: 480, y: 48, width: 238, height: 296, lines: 9, checks: 3, marks: 2},
    {kind: 'magnifier', x: 796, y: 168, r: 57}
  ]};
  const artifact = makeCardArtifact(design, job, key);
  assert.equal(artifact.card_artifact.version, 3);
  assert.equal(artifact.card_artifact.design.objects.length, 3);
  assert.match(artifact.card_artifact.svg, /filter="url\(#paper\)"/);
  assert.doesNotMatch(artifact.card_artifact.svg, /<script/i);
  const read = readCardArtifact(artifact, job, key);
  assert.deepEqual(read.design.objects, artifact.card_artifact.design.objects);
  assert.throws(() => makeCardArtifact({...v2, objects: [{kind: 'script'}]}, job, key), {code: 'INVALID_DESIGN'});
  assert.throws(() => makeCardArtifact({...v2, objects: Array.from({length: 15}, () => ({kind: 'document'}))}, job, key), {code: 'INVALID_DESIGN'});
});

test('CARD_COVER_STYLE=sketch 时 v2 自动编排手绘场景', () => {
  const job = createDesignJob(key);
  const previous = process.env.CARD_COVER_STYLE;
  process.env.CARD_COVER_STYLE = 'sketch';
  try {
    const artifact = makeCardArtifact(v2, job, key, {card});
    assert.equal(artifact.card_artifact.version, 3);
    assert.ok(artifact.card_artifact.design.objects.some(object => object.kind === 'cabinet'));
    assert.ok(readCardArtifact(artifact, job, key));
  } finally {
    if (previous === undefined) delete process.env.CARD_COVER_STYLE;
    else process.env.CARD_COVER_STYLE = previous;
  }
});

test('封面按图标数量降级：3 个有中间贴纸，2 个只留主图和徽章，1 个用圆点补位', () => {
  const three = renderIconArtwork(v2, ['file-text', 'users', 'cpu']);
  assert.match(three, /<rect x="560" y="150"/);
  const two = renderIconArtwork(v2, ['file-text', 'users']);
  assert.doesNotMatch(two, /<rect x="560"/);
  assert.doesNotMatch(two, /r="8"/);
  const one = renderIconArtwork(v2, ['file-text']);
  assert.match(one, /<circle cx="1000" cy="200" r="8"/);
  assert.equal(renderIconArtwork(v2, []), renderIconArtwork(v2, ['not-a-real-icon']));
});

test('旧 v1 elements 设计仍然按原协议渲染，不受图标库影响', () => {
  const job = createDesignJob(key);
  const v1 = {name: '旧设计', paper: '#fff8ef', accent: '#c75b21', sky: '#ffe0b6', shape: 'polaroid', layout: 'poster',
    elements: [{type: 'circle', cx: 900, cy: 140, r: 70, fill: '#f18b40'}]};
  const artifact = makeCardArtifact(v1, job, key);
  assert.equal(artifact.card_artifact.version, 1);
  assert.equal(artifact.card_artifact.design.icons, undefined);
  assert.match(artifact.card_artifact.svg, /<circle [^>]*cx="900"/);
  assert.ok(readCardArtifact(artifact, job, key));
});
