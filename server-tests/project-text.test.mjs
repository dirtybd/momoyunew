import {test} from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  applyProjectTextTranslations,
  classifyProjectTextWorkbook,
  inspectProjectTextWorkbook,
} from '../server/project-texts.mjs';
import {
  detectTargetLanguage,
  inferTargetLanguages,
  translateProjectTextWorkbook,
} from '../server/electrical-translation.mjs';

function xmlCell(reference, value, type = 'inlineStr') {
  const escaped = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return type === 'inlineStr'
    ? `<c r="${reference}" t="inlineStr"><is><t>${escaped}</t></is></c>`
    : `<c r="${reference}" t="s"><v>${value}</v></c>`;
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
  ['Valve', '打开阀门 %I0.0', 'Open valve %I0.0', 'Ventil öffnen %I0.0'],
  ['Stop', '急停按钮 %I0.1 为常闭触点', '', 'Not-Aus %I0.1 ist Öffner'],
];

test('识别 User Texts 工作表并按语言列生成候选', async () => {
  const bytes = await workbook({rows: projectRows});
  const detected = await classifyProjectTextWorkbook('项目文本.xlsx', bytes);
  assert.equal(detected.isProjectText, true);
  const analysis = detected.analysis;
  assert.equal(analysis.inspection.sheetName, 'User Texts');
  assert.deepEqual(analysis.inspection.languageColumns.map(column => column.language), ['zh-CN', 'en-US', 'de-DE']);
  assert.deepEqual(analysis.inspection.languageColumns.map(column => column.reference), [false, false, true]);
  const missing = analysis.candidates.filter(candidate => candidate.targetKind === 'missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].rowNumber, 3);
  assert.equal(missing[0].targetLanguage, 'en-US');
  assert.match(missing[0].sourceText, /%I0\.1/);
});

test('普通 XLSX 不会误判为博图项目文本', async () => {
  const bytes = await workbook({sheetName: 'Sheet1', rows: [['名称', '数量'], ['阀门', '2']]});
  const detected = await classifyProjectTextWorkbook('普通表格.xlsx', bytes);
  assert.equal(detected.isProjectText, false);
  assert.equal(detected.reason, 'not-project-text');
  const docx = await classifyProjectTextWorkbook('说明.docx', Buffer.from('not a workbook'));
  assert.equal(docx.isProjectText, false);
});

test('写回译文并保留工程标记和参考列', async () => {
  const bytes = await workbook({rows: projectRows});
  const analysis = await inspectProjectTextWorkbook('项目文本.xlsx', bytes);
  const target = analysis.candidates.find(candidate => candidate.targetKind === 'missing');
  const output = await applyProjectTextTranslations(bytes, analysis, new Map([
    [target.id, 'E-stop button %I0.1 is a normally closed contact'],
  ]));
  const verified = await inspectProjectTextWorkbook('输出.xlsx', output);
  const row3 = verified.candidates.find(candidate => candidate.rowNumber === 3 && candidate.targetLanguage === 'en-US');
  assert.equal(row3.targetKind, 'existing');
  assert.equal(row3.targetMarker, 'E-stop button %I0.1 is a normally closed contact');
  assert.equal(
    verified.candidates.find(candidate => candidate.rowNumber === 2 && candidate.targetLanguage === 'en-US').targetMarker,
    'Open valve %I0.0',
  );
});

test('识别目标语言，不会把源语言当成目标语言', () => {
  assert.equal(detectTargetLanguage('请翻译成英文'), 'en-US');
  assert.equal(detectTargetLanguage('目标语言：de-DE'), 'de-DE');
  assert.equal(detectTargetLanguage('把英文翻译成中文'), 'zh-CN');
  assert.equal(detectTargetLanguage('帮我把这个项目文本翻译一下'), null);
});

test('未说明目标语言时，按表头推断唯一空列', async () => {
  const bytes = await workbook({rows: projectRows});
  const analysis = await inspectProjectTextWorkbook('项目文本.xlsx', bytes);
  assert.deepEqual(inferTargetLanguages(analysis), {editable: ['zh-CN', 'en-US'], missing: ['en-US']});

  const ambiguous = await workbook({rows: [
    ['Category', 'zh-CN', 'en-US', 'fr-FR'],
    ['Valve', '打开阀门 %I0.0', '', ''],
  ]});
  const ambiguousAnalysis = await inspectProjectTextWorkbook('项目文本.xlsx', ambiguous);
  assert.deepEqual(inferTargetLanguages(ambiguousAnalysis), {editable: ['zh-CN', 'en-US', 'fr-FR'], missing: ['en-US', 'fr-FR']});
});

test('只翻译空的目标单元格，并通过工作流批量写回', async () => {
  const bytes = await workbook({rows: projectRows});
  const calls = [];
  const result = await translateProjectTextWorkbook({
    name: '项目文本.xlsx',
    bytes,
    targetLanguage: 'en-US',
    config: {base: 'http://dify.test/v1', key: 'test-key'},
    maxRequests: 24,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const items = JSON.parse(body.inputs.payload_json).items;
      calls.push(items);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            data: {
              status: 'succeeded',
              outputs: {
                translations_json: JSON.stringify({
                  translations: items.map(item => ({id: item.id, text: `EN ${item.sourceText}`})),
                }),
              },
            },
          });
        },
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1);
  assert.equal(result.stats.translated, 1);
  assert.equal(result.stats.existingUntranslated, 1);
  assert.equal(result.targetLanguage, 'en-US');
  assert.match(result.name, /_en-US\.xlsx$/);
  const verified = await inspectProjectTextWorkbook(result.name, result.bytes);
  const translated = verified.candidates.find(candidate => candidate.rowNumber === 3 && candidate.targetLanguage === 'en-US');
  assert.match(translated.targetMarker, /^EN /);
  assert.match(translated.targetMarker, /%I0\.1/);
  assert.equal(
    verified.candidates.find(candidate => candidate.rowNumber === 2 && candidate.targetLanguage === 'en-US').targetMarker,
    'Open valve %I0.0',
  );
});
