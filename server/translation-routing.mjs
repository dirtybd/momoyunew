import { isTranslationRequest } from './intent-routing.mjs';
import { classifyProjectTextWorkbook, isXlsxName } from './project-texts.mjs';

// Files the file-processing assistant can translate as ordinary documents.
// A `User Texts` workbook is checked first and never falls into this group.
export const TRANSLATABLE_DOCUMENT = /\.(?:docx?|pdf|pptx?|txt|md|csv|tsv|rtf|odt|ods|xlsx|xlsm)$/i;

/**
 * "Whole document" vs. "only what I asked for". This is a wording hint for the
 * office Agent and for tests; it never changes the actual file content.
 */
export function translationScope(message) {
  const text = String(message ?? '').normalize('NFKC');
  if (/(整篇|整份|整本|全文|通篇|全部翻译|逐段|逐页|整个文档|整个文件)/.test(text)) return 'whole';
  if (/(只|仅|部分|第\s*\d+\s*(段|页|节|行|列|章)|这(一|几)?(段|页|节|部分)|指定|按(我的|要求|术语)|摘要|标题|目录)/.test(text)) return 'requested';
  return 'auto';
}

/**
 * Decide which translation task a turn belongs to before any Dify routing:
 *
 * - `project-text`: 博图/TIA `User Texts` workbook, translated column by column
 *   by the local workflow. Existing translations and `*` reference columns are
 *   never overwritten.
 * - `document`: Word/PDF/TXT/ordinary XLSX; the office (file) assistant reads
 *   the file and produces a translated copy, either whole or as requested.
 * - `text`: no attached file; the request is about the text in the message.
 * - `unsupported`: files were attached but none can be translated as a file.
 * - `none`: the user did not explicitly ask for translation.
 *
 * A workbook with a `User Texts` sheet wins over other attachments because the
 * column write-back rules are materially different from whole-document
 * translation. Callers should mention any ignored/mixed files instead of
 * silently treating them as project text.
 */
export async function classifyTranslationTask({ message, files = [] } = {}) {
  if (!isTranslationRequest(message)) {
    return { isTranslation: false, mode: 'none', scope: 'auto', project: [], documents: [], ignored: [] };
  }
  const project = [];
  const documents = [];
  const ignored = [];
  for (const file of files || []) {
    if (isXlsxName(file.name)) {
      const classification = await classifyProjectTextWorkbook(file.name, file.bytes);
      if (classification.isProjectText) {
        project.push({ file, classification });
        continue;
      }
    }
    if (TRANSLATABLE_DOCUMENT.test(String(file.name ?? ''))) documents.push(file);
    else ignored.push(file);
  }
  const mode = project.length
    ? 'project-text'
    : documents.length
      ? 'document'
      : ignored.length
        ? 'unsupported'
        : 'text';
  return { isTranslation: true, mode, scope: translationScope(message), project, documents, ignored };
}

/**
 * Compact, JSON-safe summary for the Dify context file. File bytes are never
 * included; only names and the chosen mode.
 */
export function translationSummary(task) {
  if (!task?.isTranslation) return null;
  return {
    mode: task.mode,
    scope: task.scope,
    projectTextFiles: task.project.map(item => item.file.name),
    documentFiles: task.documents.map(file => file.name),
    ignoredFiles: task.ignored.map(file => file.name),
  };
}
