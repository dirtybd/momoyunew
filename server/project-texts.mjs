import {createHash, randomUUID} from 'node:crypto';
import {DOMParser, XMLSerializer} from '@xmldom/xmldom';
import JSZip from 'jszip';

// TIA Portal project-text exports are XLSX workbooks with a `User Texts` sheet.
// The language columns use tags such as zh-CN, en-US, de-DE; a trailing `*`
// marks a reference column that must never be written.
export const PROJECT_TEXT_SHEET = 'User Texts';
export const LANGUAGE_HEADER = /^[a-z]{2,3}(?:-[A-Z]{2})?\*?$/;
const PREVIEW_LIMIT = 200;
const PLACEHOLDER_TEXTS = new Set(['text', '文本', 'テキスト']);
const MAX_ROWS = 5000;
const MAX_SHEET_XML = 20 * 1024 * 1024;
const MAX_SHARED_XML = 50 * 1024 * 1024;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function marker(value) {
  const cleaned = String(value ?? '').normalize('NFKC').trim();
  return cleaned === '' || cleaned === '28' || PLACEHOLDER_TEXTS.has(cleaned.toLocaleLowerCase());
}

function naturalText(value) {
  return !marker(value) && /[\p{L}\p{Script=Han}]/u.test(String(value ?? ''));
}

function sourcePriority(targetLanguage, languages) {
  const preferred = targetLanguage === 'zh-CN'
    ? ['en-US', 'de-DE']
    : targetLanguage === 'en-US'
      ? ['zh-CN', 'de-DE']
      : targetLanguage === 'de-DE'
        ? ['zh-CN', 'en-US']
        : [];
  return [...preferred, ...languages].filter((language, index, all) => language !== targetLanguage && all.indexOf(language) === index);
}

function parseXml(xml, label) {
  const errors = [];
  const document = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: message => errors.push(String(message)),
      fatalError: message => errors.push(String(message)),
    },
  }).parseFromString(xml, 'application/xml');
  if (errors.length || !document?.documentElement || document.getElementsByTagName('parsererror').length) {
    throw new Error(`${label} XML 无法解析：${errors[0] ?? '未知错误'}`);
  }
  return document;
}

function elements(document, tagName) {
  const nodes = document.getElementsByTagName('*');
  const result = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const element = nodes.item(index);
    if (element.localName === tagName || element.tagName === tagName || element.tagName.endsWith(`:${tagName}`)) result.push(element);
  }
  return result;
}

function directChild(parent, tagName) {
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const node = parent.childNodes.item(index);
    if (node?.nodeType === 1) {
      const element = node;
      if (element.localName === tagName || element.tagName === tagName || element.tagName.endsWith(`:${tagName}`)) return element;
    }
  }
  return undefined;
}

function columnNumber(reference) {
  const letters = String(reference ?? '').match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) return 0;
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value;
}

function resolveWorkbookTarget(target) {
  const cleaned = String(target ?? '').replace(/^\/+/, '');
  return cleaned.startsWith('xl/') ? cleaned : `xl/${cleaned}`;
}

async function requiredText(zip, path, limit, label) {
  const file = zip.file(path);
  if (!file) throw new Error(`工作簿缺少 ${path}`);
  const text = await file.async('string');
  if (text.length > limit) throw new Error(`${label} 过大，已拒绝解析`);
  return text;
}

async function loadProjectTextPackage(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const workbookXml = await requiredText(zip, 'xl/workbook.xml', 5 * 1024 * 1024, 'workbook.xml');
  const workbookDocument = parseXml(workbookXml, 'workbook.xml');
  const relationshipsDocument = parseXml(
    await requiredText(zip, 'xl/_rels/workbook.xml.rels', 5 * 1024 * 1024, 'workbook.xml.rels'),
    'workbook.xml.rels',
  );
  const relationships = new Map(
    elements(relationshipsDocument, 'Relationship').map(relationship => [
      relationship.getAttribute('Id') ?? '',
      relationship.getAttribute('Target') ?? '',
    ]),
  );
  const sheet = elements(workbookDocument, 'sheet').find(item =>
    item.getAttribute('name')?.toLocaleLowerCase() === PROJECT_TEXT_SHEET.toLocaleLowerCase());
  if (!sheet) throw new Error(`项目文本工作簿缺少“${PROJECT_TEXT_SHEET}”工作表`);
  const relationshipId = sheet.getAttribute('r:id')
    || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const target = relationshipId ? relationships.get(relationshipId) : undefined;
  if (!target) throw new Error('无法解析 User Texts 工作表路径');
  const sheetPath = resolveWorkbookTarget(target);
  const sheetDocument = parseXml(
    await requiredText(zip, sheetPath, MAX_SHEET_XML, 'User Texts'),
    'User Texts',
  );

  const sharedRelationship = elements(relationshipsDocument, 'Relationship')
    .find(relationship => (relationship.getAttribute('Type') ?? '').endsWith('/sharedStrings'));
  const sharedStringsPath = sharedRelationship?.getAttribute('Target')
    ? resolveWorkbookTarget(sharedRelationship.getAttribute('Target'))
    : 'xl/sharedStrings.xml';
  const sharedStringsXml = zip.file(sharedStringsPath)
    ? await requiredText(zip, sharedStringsPath, MAX_SHARED_XML, 'sharedStrings.xml')
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"></sst>';
  const sharedStringsDocument = parseXml(sharedStringsXml, 'sharedStrings.xml');
  const sharedStrings = elements(sharedStringsDocument, 'si')
    .map(item => elements(item, 't').map(text => text.textContent ?? '').join(''));

  const cellsByRow = new Map();
  let maxRow = 0;
  for (const row of elements(sheetDocument, 'row')) {
    const number = Number(row.getAttribute('r'));
    if (!Number.isInteger(number) || number < 1) continue;
    maxRow = Math.max(maxRow, number);
    const cells = new Map();
    for (const cell of elements(row, 'c')) {
      const column = columnNumber(cell.getAttribute('r') ?? '');
      if (column) cells.set(column, cell);
    }
    cellsByRow.set(number, cells);
  }
  if (maxRow > MAX_ROWS) throw new Error(`项目文本超过 ${MAX_ROWS} 行，请拆分后再翻译`);
  return {zip, sheetPath, sheetDocument, sharedStringsPath, sharedStringsDocument, sharedStrings, cellsByRow, maxRow};
}

function cellText(cell, sharedStrings) {
  if (!cell) return '';
  const type = cell.getAttribute('t');
  if (type === 'inlineStr') return elements(cell, 't').map(text => text.textContent ?? '').join('');
  const value = directChild(cell, 'v')?.textContent ?? '';
  if (type === 's') return sharedStrings[Number(value)] ?? '';
  return value;
}

export function isXlsxName(name) {
  return /\.(xlsx|xlsm)$/i.test(String(name ?? ''));
}

export async function inspectProjectTextWorkbook(displayName, bytes, {previewLimit = PREVIEW_LIMIT} = {}) {
  const workbook = await loadProjectTextPackage(bytes);
  const headerCells = workbook.cellsByRow.get(1) ?? new Map();
  const languageColumns = [];
  for (const [number, cell] of headerCells) {
    const header = cellText(cell, workbook.sharedStrings).trim();
    if (LANGUAGE_HEADER.test(header)) {
      languageColumns.push({
        language: header.replace(/\*$/, ''),
        header,
        columnNumber: number,
        reference: header.endsWith('*'),
      });
    }
  }
  languageColumns.sort((left, right) => left.columnNumber - right.columnNumber);
  const editable = languageColumns.filter(column => !column.reference);
  if (editable.length < 2) throw new Error('至少需要两个可编辑语言列，例如 zh-CN、en-US、de-DE');

  const missingCandidates = [];
  const verificationCandidates = [];
  let noSourceRows = 0;
  for (let rowNumber = 2; rowNumber <= workbook.maxRow; rowNumber += 1) {
    const cells = workbook.cellsByRow.get(rowNumber) ?? new Map();
    const values = new Map(editable.map(column => [column.language, cellText(cells.get(column.columnNumber), workbook.sharedStrings)]));
    const missingTargets = editable.filter(column => marker(values.get(column.language) ?? ''));
    const available = editable.filter(column => naturalText(values.get(column.language) ?? ''));
    if (missingTargets.length && !available.length) {
      noSourceRows += 1;
      continue;
    }
    for (const targetColumn of editable) {
      const targetMarker = values.get(targetColumn.language) ?? '';
      const targetKind = marker(targetMarker) ? 'missing' : 'existing';
      if (targetKind === 'existing' && !naturalText(targetMarker)) continue;
      const sourceLanguage = sourcePriority(targetColumn.language, editable.map(column => column.language))
        .find(language => naturalText(values.get(language) ?? ''));
      if (!sourceLanguage) continue;
      const candidate = {
        id: `${rowNumber}:${targetColumn.columnNumber}`,
        rowNumber,
        category: cellText(cells.get(1), workbook.sharedStrings),
        viewPath: cellText(cells.get(2), workbook.sharedStrings),
        sourceLanguage,
        targetLanguage: targetColumn.language,
        sourceText: values.get(sourceLanguage) ?? '',
        targetMarker,
        targetKind,
        status: 'pending',
      };
      if (targetKind === 'missing') missingCandidates.push(candidate);
      else verificationCandidates.push(candidate);
    }
  }

  const byTargetLanguage = {};
  for (const candidate of missingCandidates) {
    byTargetLanguage[candidate.targetLanguage] = (byTargetLanguage[candidate.targetLanguage] ?? 0) + 1;
  }
  const verificationByTargetLanguage = {};
  for (const candidate of verificationCandidates) {
    verificationByTargetLanguage[candidate.targetLanguage] = (verificationByTargetLanguage[candidate.targetLanguage] ?? 0) + 1;
  }
  const candidates = [...missingCandidates, ...verificationCandidates];
  const missingLanguages = new Set(Object.keys(byTargetLanguage));
  const relevantVerificationCandidates = verificationCandidates.filter(candidate => missingLanguages.has(candidate.targetLanguage));
  const uniqueRequests = new Set(
    [...missingCandidates, ...relevantVerificationCandidates]
      .map(candidate => `${candidate.sourceLanguage}\u0000${candidate.targetLanguage}\u0000${candidate.sourceText}`),
  ).size;
  const inspection = {
    schemaVersion: 1,
    id: randomUUID(),
    displayName,
    workbookSha256: sha256(bytes),
    sheetName: PROJECT_TEXT_SHEET,
    languageColumns,
    summary: {
      rows: Math.max(0, workbook.maxRow - 1),
      candidates: missingCandidates.length,
      verificationCandidates: relevantVerificationCandidates.length,
      uniqueRequests,
      byTargetLanguage,
      verificationByTargetLanguage,
      noSourceRows,
    },
    preview: missingCandidates.slice(0, previewLimit),
  };
  return {inspection, candidates};
}

/**
 * Detect a TIA Portal project-text workbook without mistaking an ordinary
 * spreadsheet or Word/PDF file for one. A workbook qualifies when it contains
 * a sheet literally named `User Texts`; the language headers are then read so
 * an invalid project workbook can be reported instead of silently sent to the
 * general document agent.
 */
export async function classifyProjectTextWorkbook(displayName, bytes) {
  if (!isXlsxName(displayName)) return {isProjectText: false, reason: 'not-xlsx'};
  try {
    const analysis = await inspectProjectTextWorkbook(displayName, bytes);
    return {isProjectText: true, analysis, reason: 'user-texts-sheet'};
  } catch (error) {
    // Load the workbook once more without requiring language columns, so a
    // `User Texts` sheet with a bad header is still routed to the electrical
    // flow and gets an actionable message.
    try {
      const zip = await JSZip.loadAsync(bytes);
      const workbook = parseXml(await requiredText(zip, 'xl/workbook.xml', 5 * 1024 * 1024, 'workbook.xml'), 'workbook.xml');
      const hasSheet = elements(workbook, 'sheet').some(sheet =>
        sheet.getAttribute('name')?.toLocaleLowerCase() === PROJECT_TEXT_SHEET.toLocaleLowerCase());
      if (hasSheet) return {isProjectText: true, reason: 'user-texts-sheet', error};
    } catch {
      // Not a readable XLSX ZIP; fall through to ordinary document handling.
    }
    return {isProjectText: false, reason: 'not-project-text', error};
  }
}

function setSharedString(cell, index) {
  cell.setAttribute('t', 's');
  for (const inline of elements(cell, 'is')) inline.parentNode?.removeChild(inline);
  let value = directChild(cell, 'v');
  if (!value) {
    value = cell.ownerDocument.createElementNS(cell.namespaceURI, cell.prefix ? `${cell.prefix}:v` : 'v');
    cell.appendChild(value);
  }
  while (value.firstChild) value.removeChild(value.firstChild);
  value.appendChild(cell.ownerDocument.createTextNode(String(index)));
}

function appendSharedString(document, text) {
  const root = document.documentElement;
  const index = elements(document, 'si').length;
  const item = document.createElementNS(root.namespaceURI, root.prefix ? `${root.prefix}:si` : 'si');
  const value = document.createElementNS(root.namespaceURI, root.prefix ? `${root.prefix}:t` : 't');
  if (/^\s|\s$|[\r\n]/.test(text)) value.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  value.appendChild(document.createTextNode(text));
  item.appendChild(value);
  root.appendChild(item);
  const currentCount = Number(root.getAttribute('count') ?? index);
  const currentUnique = Number(root.getAttribute('uniqueCount') ?? index);
  root.setAttribute('count', String(currentCount + 1));
  root.setAttribute('uniqueCount', String(currentUnique + 1));
  return index;
}

export async function applyProjectTextTranslations(bytes, analysis, translated) {
  if (sha256(bytes) !== analysis.inspection.workbookSha256) throw new Error('项目文本源文件哈希已变化，拒绝写入');
  const workbook = await loadProjectTextPackage(bytes);
  const columns = new Map(analysis.inspection.languageColumns.map(column => [column.language, column]));
  let applied = 0;
  for (const candidate of analysis.candidates) {
    const translation = translated.get(candidate.id);
    if (translation === undefined) continue;
    const column = columns.get(candidate.targetLanguage);
    if (!column || column.reference) throw new Error(`语言列不可写：${candidate.targetLanguage}`);
    const cell = workbook.cellsByRow.get(candidate.rowNumber)?.get(column.columnNumber);
    if (!cell) throw new Error(`第 ${candidate.rowNumber} 行目标单元格不存在，拒绝改变工作表结构`);
    const current = cellText(cell, workbook.sharedStrings);
    if (current !== candidate.targetMarker || (candidate.targetKind !== 'existing' && !marker(current))) {
      throw new Error(`第 ${candidate.rowNumber} 行目标单元格已变化，拒绝覆盖`);
    }
    setSharedString(cell, appendSharedString(workbook.sharedStringsDocument, translation));
    workbook.sharedStrings.push(translation);
    applied += 1;
  }
  if (!applied) throw new Error('没有可写入的成功翻译');
  const serializer = new XMLSerializer();
  workbook.zip.file(workbook.sheetPath, serializer.serializeToString(workbook.sheetDocument));
  workbook.zip.file(workbook.sharedStringsPath, serializer.serializeToString(workbook.sharedStringsDocument));
  const output = await workbook.zip.generateAsync({type: 'uint8array', compression: 'DEFLATE'});
  const verification = await inspectProjectTextWorkbook(analysis.inspection.displayName, output);
  if (verification.inspection.languageColumns.map(item => item.header).join('|')
    !== analysis.inspection.languageColumns.map(item => item.header).join('|')) {
    throw new Error('输出工作簿语言表头校验失败');
  }
  return Buffer.from(output);
}
