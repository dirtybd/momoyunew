import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  isTranslationRequest,
  looksLikeCardRequest,
  looksLikeCollaborationRequest,
  looksLikeOfficeRequest,
  suggestRoute,
} from '../server/intent-routing.mjs';

test('明确的卡片/求助措辞会命中卡片路由', () => {
  for (const message of [
    '帮我设计一张求助卡',
    '我想做一张需求卡，找人帮我审阅 PLC 程序',
    '用这份表格整理成求助卡',
    '帮我设计一个求助需求，帮我完成这份文档的翻译',
    '帮我设计一张卡，翻译这份文档',
    '找同事帮忙检查一下这份程序',
    '发布一个需求，找人帮忙翻译',
  ]) assert.equal(looksLikeCardRequest(message), true, message);
  assert.equal(suggestRoute('帮我设计一张求助卡'), 'card');
  assert.equal(suggestRoute('找同事帮忙检查一下这份程序'), 'card');
});

test('普通办公文件任务不会被误判为卡片', () => {
  for (const message of [
    '把这份 Excel 表格合并成一个 PDF',
    '总结这个 Word 文档',
    '设计一个 Excel 模板',
  ]) {
    assert.equal(looksLikeCardRequest(message), false, message);
    assert.equal(looksLikeOfficeRequest(message), true, message);
  }
  assert.equal(suggestRoute('总结这个 Word 文档'), 'office');
});

test('User Texts 附件只有在明确要求翻译时才走翻译', () => {
  assert.equal(isTranslationRequest('请翻译成英文'), true);
  assert.equal(isTranslationRequest('目标语言：de-DE'), true);
  assert.equal(isTranslationRequest('把这个工作簿翻译一下'), true);
  assert.equal(isTranslationRequest('帮我翻译'), true);
  assert.equal(isTranslationRequest('翻译这份文件'), true);
  assert.equal(isTranslationRequest('帮我看看这份翻译文件有没有问题'), false);
  assert.equal(isTranslationRequest('帮我设计一张求助卡，找人审阅这份文件'), false);
  assert.equal(isTranslationRequest('帮我设计一个求助需求，帮我完成这份文档的翻译'), false);
  assert.equal(isTranslationRequest('帮我设计一张卡，翻译这份文档'), false);
  assert.equal(isTranslationRequest('这份 User Texts 文件怎么用？'), false);
});

test('只有文件翻译提示到办公文件助手，消息文字不强制文件工具', () => {
  for (const message of ['把这个工作簿翻译一下', '翻译这份文件']) {
    assert.equal(suggestRoute(message), 'office', message);
  }
  for(const message of ['请翻译成英文','把这段文字翻译成德语','翻译第 3 段'])assert.equal(suggestRoute(message),null);
  // 明确的卡片/协作措辞仍然优先，不会被翻译提示抢走。
  assert.equal(suggestRoute('帮我设计一张卡，翻译这份文档'), 'card');
  assert.equal(suggestRoute('找人帮我翻译这份文件'), 'card');
  // 只是在问文件怎么用，不自动翻译。
  assert.equal(suggestRoute('这份 User Texts 文件怎么用？'), null);
});

test('找人协作会压过自动翻译', () => {
  assert.equal(looksLikeCollaborationRequest('找人帮我翻译这份文件'), true);
  assert.equal(looksLikeCollaborationRequest('帮我翻译这份文件'), false);
  assert.equal(isTranslationRequest('找人帮我翻译这份文件'), false);
});
