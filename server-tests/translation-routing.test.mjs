import {test} from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  classifyTranslationTask,
  translationScope,
  translationSummary,
} from '../server/translation-routing.mjs';

function xmlCell(reference, value) {
  const escaped = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<c r="${reference}" t="inlineStr"><is><t>${escaped}</t></is></c>`;
}

async function workbook({sheetName = 'User Texts', rows = []} = {}) {
  const sheetRows = rows.map((values, index) =>
    `<row r="${index + 1}">${values.map((value, column) => {
      const reference = String.fromCharCode(65 + column) + (index + 1);
      return value === null || value === undefined ? '' : xmlCell(reference, value);
    }).join('')}</row>`).join('');
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`);
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`);
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"></sst>`);
  return zip.generateAsync({type: 'nodebuffer'});
}

const projectRows = [
  ['Category', 'zh-CN', 'en-US', 'de-DE*'],
  ['Valve', '打开阀门 %I0.0', '', 'Ventil öffnen %I0.0'],
];

test('User Texts 工作簿识别为按语言列补译，而不是整文档翻译', async () => {
  const project = await workbook({rows: projectRows});
  const task = await classifyTranslationTask({
    message: '请把这个工作簿翻译成英文',
    files: [{name: '项目文本.xlsx', bytes: project}],
  });
  assert.equal(task.isTranslation, true);
  assert.equal(task.mode, 'project-text');
  assert.equal(task.project.length, 1);
  assert.equal(task.project[0].file.name, '项目文本.xlsx');
  assert.equal(task.documents.length, 0);
});

test('普通 Excel、Word、PDF、纯文本与图片分别归到正确任务', async () => {
  const ordinary = await classifyTranslationTask({
    message: '把这几个列翻译成英文',
    files: [{name: '普通台账.xlsx', bytes: Buffer.from('not a workbook')}],
  });
  assert.equal(ordinary.mode, 'document');

  const word = await classifyTranslationTask({
    message: '整篇翻译成英文',
    files: [{name: '说明.docx', bytes: Buffer.from('docx')}],
  });
  assert.equal(word.mode, 'document');
  assert.equal(word.scope, 'whole');

  const pdf = await classifyTranslationTask({
    message: '翻译第 3 节',
    files: [{name: '手册.pdf', bytes: Buffer.from('pdf')}],
  });
  assert.equal(pdf.mode, 'document');
  assert.equal(pdf.scope, 'requested');

  const text = await classifyTranslationTask({message: '帮我把这段话翻译成英文', files: []});
  assert.equal(text.mode, 'text');

  const image = await classifyTranslationTask({
    message: '翻译这张图',
    files: [{name: '截图.png', bytes: Buffer.from('png')}],
  });
  assert.equal(image.mode, 'unsupported');
  assert.equal(image.ignored.length, 1);
});

test('没有明确翻译意图时不做任何翻译', async () => {
  const project = await workbook({rows: projectRows});
  for (const message of [
    '这份 User Texts 文件怎么用？',
    '帮我看看这份翻译文件有没有问题',
    '帮我设计一张求助卡，找人审阅这份文件',
    '找人帮我翻译这份文件',
  ]) {
    const task = await classifyTranslationTask({message, files: [{name: '项目文本.xlsx', bytes: project}]});
    assert.equal(task.isTranslation, false, message);
    assert.equal(task.mode, 'none', message);
    assert.equal(translationSummary(task), null, message);
  }
});

test('同时有项目文本和普通文档时，项目文本优先并保留其余文件名', async () => {
  const project = await workbook({rows: projectRows});
  const task = await classifyTranslationTask({
    message: '翻译成英文',
    files: [
      {name: '项目文本.xlsx', bytes: project},
      {name: '说明.docx', bytes: Buffer.from('docx')},
    ],
  });
  assert.equal(task.mode, 'project-text');
  assert.deepEqual(task.documents.map(file => file.name), ['说明.docx']);
  const summary = translationSummary(task);
  assert.deepEqual(summary, {
    mode: 'project-text',
    scope: 'auto',
    projectTextFiles: ['项目文本.xlsx'],
    documentFiles: ['说明.docx'],
    ignoredFiles: [],
  });
  assert.ok(!JSON.stringify(summary).includes('bytes'));
});

test('整篇、按要求和不限范围能区分', () => {
  assert.equal(translationScope('把整个文档翻译成英文'), 'whole');
  assert.equal(translationScope('全文翻译'), 'whole');
  assert.equal(translationScope('只翻译第 3 段'), 'requested');
  assert.equal(translationScope('按我的术语表翻译'), 'requested');
  assert.equal(translationScope('翻译成英文'), 'auto');
});
