import {
  applyProjectTextTranslations,
  inspectProjectTextWorkbook,
  isXlsxName,
} from './project-texts.mjs';

// 批次比工作流上限更保守：项目文本常见几十到几百条，小批次能显著降低
// 上游 504/stream timeout 的概率；超时后调用方还会再按更小批次重试。
const MAX_BATCH_ITEMS = 12;
const MAX_BATCH_CHARACTERS = 6000;
const MAX_REQUESTS_PER_RUN = 240;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const LANGUAGE_ALIASES = new Map(Object.entries({
  '中文': 'zh-CN', '简体中文': 'zh-CN', '汉语': 'zh-CN', '普通话': 'zh-CN',
  '繁体中文': 'zh-TW', '繁體中文': 'zh-TW',
  '英文': 'en-US', '英语': 'en-US', '英語': 'en-US',
  '德文': 'de-DE', '德语': 'de-DE', '德語': 'de-DE',
  '日文': 'ja-JP', '日语': 'ja-JP', '日語': 'ja-JP',
  '韩文': 'ko-KR', '韩语': 'ko-KR', '韓語': 'ko-KR',
  '法文': 'fr-FR', '法语': 'fr-FR', '法語': 'fr-FR',
  '西班牙文': 'es-ES', '西班牙语': 'es-ES',
  '葡萄牙文': 'pt-BR', '葡萄牙语': 'pt-BR',
  '俄文': 'ru-RU', '俄语': 'ru-RU',
  '意大利文': 'it-IT', '意大利语': 'it-IT',
  '土耳其文': 'tr-TR', '土耳其语': 'tr-TR',
  '波兰文': 'pl-PL', '波兰语': 'pl-PL',
  '捷克文': 'cs-CZ', '捷克语': 'cs-CZ',
  '荷兰文': 'nl-NL', '荷兰语': 'nl-NL',
}));

const fail = (status, code, message) => {
  throw Object.assign(new Error(message), {status, code});
};

export function translationConfig(env = process.env) {
  const key = env.DIFY_TRANSLATION_API_KEY?.trim();
  if (!key) return null;
  const base = (env.DIFY_TRANSLATION_BASE_URL || env.DIFY_BASE_URL || '').trim().replace(/\/+$/, '');
  let url;
  try {
    url = new URL(base);
  } catch {
    fail(503, 'TRANSLATION_CONFIG', '电气翻译工作流地址无效。');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    fail(503, 'TRANSLATION_CONFIG', '电气翻译工作流地址无效。');
  }
  return {base, key};
}

/**
 * Only an explicit target language starts an automatic file translation.
 * The caller must ask instead of guessing when this returns null.
 */
export function detectTargetLanguage(message) {
  const text = String(message ?? '').normalize('NFKC');
  const aliases = [...LANGUAGE_ALIASES.keys()].sort((left, right) => right.length - left.length);
  const aliasPattern = aliases.join('|');
  const patterns = [
    new RegExp(`(?:目标语言|目标语种|target\\s*language)\\s*(?:是|为|:|：)?\\s*([A-Za-z]{2,3}(?:-[A-Za-z]{2})?|${aliasPattern})`, 'i'),
    new RegExp(`(?:翻译|译)(?:成|为|到|至)\\s*([A-Za-z]{2,3}(?:-[A-Za-z]{2})?|${aliasPattern})`, 'i'),
    new RegExp(`(?:转成|转换为|改成|换成)\\s*((?:英文|英语|${aliasPattern}))\\s*(?:版|版本)?`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const raw = match?.[1]?.trim();
    if (!raw) continue;
    if (LANGUAGE_ALIASES.has(raw)) return LANGUAGE_ALIASES.get(raw);
    const code = raw.replace(/_/g, '-');
    if (/^[a-z]{2,3}(?:-[A-Za-z]{2})?$/i.test(code)) {
      const [language, region] = code.split('-');
      if (!region) {
        const defaults = {zh: 'zh-CN', en: 'en-US', de: 'de-DE', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', es: 'es-ES', pt: 'pt-BR', ru: 'ru-RU'};
        return defaults[language.toLowerCase()] ?? null;
      }
      return `${language.toLowerCase()}-${region.toUpperCase()}`;
    }
  }
  return null;
}

export function describeLanguageColumns(analysis) {
  return analysis.inspection.languageColumns
    .filter(column => !column.reference)
    .map(column => column.language)
    .join('、');
}

/**
 * Read the sheet headers to decide which language is the translation target.
 *
 * TIA exports usually carry a filled source column (for example zh-CN) and one
 * or more empty target columns (en-US, de-DE). When exactly one editable
 * column still has empty cells, that column is the target and the user does
 * not have to repeat “翻译成英文”. If several columns are empty the caller
 * must ask instead of guessing; `*` reference columns are never targets.
 */
export function inferTargetLanguages(analysis) {
  const columns = analysis?.inspection?.languageColumns ?? [];
  const editable = columns.filter(column => !column.reference).map(column => column.language);
  const counts = analysis?.inspection?.summary?.byTargetLanguage ?? {};
  const missing = editable.filter(language => (counts[language] ?? 0) > 0);
  return {editable, missing};
}

function batchRequests(requests) {
  const batches = [];
  let current = [];
  let characters = 0;
  let pair = null;
  for (const item of requests) {
    const itemPair = `${item.sourceLanguage}\u0000${item.targetLanguage}`;
    const nextCharacters = characters + item.sourceText.length;
    if (current.length && (current.length >= MAX_BATCH_ITEMS || nextCharacters > MAX_BATCH_CHARACTERS || itemPair !== pair)) {
      batches.push(current);
      current = [];
      characters = 0;
      pair = null;
    }
    if (!current.length) pair = itemPair;
    current.push(item);
    characters += item.sourceText.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function runWorkflowBatch(config, items, {fetchImpl = fetch} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(config.base + '/workflows/run', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(180000),
        headers: {authorization: 'Bearer ' + config.key, 'content-type': 'application/json', connection: 'close'},
        body: JSON.stringify({
          inputs: {payload_json: JSON.stringify({
            items: items.map(item => ({
              id: item.id,
              sourceText: item.sourceText,
              sourceLanguage: item.sourceLanguage,
              targetLanguage: item.targetLanguage,
            })),
          })},
          response_mode: 'blocking',
          user: 'momoyu-project-text-translation',
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`电气翻译工作流 HTTP ${response.status}`);
      }
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new Error('电气翻译工作流返回内容过大');
      const result = JSON.parse(text);
      if (result.data?.status !== 'succeeded') throw new Error('电气翻译工作流执行失败');
      const translations = JSON.parse(result.data.outputs?.translations_json);
      if (!translations || !Array.isArray(translations.translations)) throw new Error('电气翻译工作流返回格式无效');
      const expected = new Set(items.map(item => item.id));
      const map = new Map();
      for (const item of translations.translations) {
        if (!item || typeof item.id !== 'string' || typeof item.text !== 'string' || !item.text.trim()) {
          throw new Error('电气翻译工作流返回了无效条目');
        }
        if (!expected.has(item.id) || map.has(item.id)) throw new Error('电气翻译工作流返回了未知或重复条目');
        map.set(item.id, item.text.trim());
      }
      if (map.size !== expected.size) throw new Error('电气翻译工作流返回条目不完整');
      return map;
    } catch (error) {
      lastError = error;
      if (attempt === 1) await new Promise(resolve => setTimeout(resolve, 800));
    }
  }
  throw lastError;
}

/**
 * Inspect a TIA project workbook, translate only empty target cells through the
 * Dify electrical workflow, then write the results back into a copy of the XLSX.
 * Existing translations are left untouched.
 */
export async function translateProjectTextWorkbook({
  name,
  bytes,
  targetLanguage,
  config,
  onProgress = () => {},
  maxRequests = MAX_REQUESTS_PER_RUN,
  fetchImpl = fetch,
}) {
  if (!config) fail(503, 'TRANSLATION_NOT_CONFIGURED', '电气翻译工作流尚未配置服务端密钥，请联系管理员。');
  if (!isXlsxName(name)) fail(415, 'NOT_PROJECT_TEXT', '只有 .xlsx/.xlsm 项目文本工作簿可以自动翻译。');
  if (!targetLanguage) fail(400, 'TARGET_LANGUAGE_REQUIRED', '请先说明目标语言，例如“翻译成英文”。');
  onProgress({stage: 'inspecting', label: '正在识别博图项目文本工作簿'});
  const analysis = await inspectProjectTextWorkbook(name, bytes);
  const target = analysis.inspection.languageColumns.find(column => column.language === targetLanguage);
  if (!target) {
    fail(400, 'LANGUAGE_COLUMN_MISSING', `工作簿没有 ${targetLanguage} 语言列。可用的可编辑语言列：${describeLanguageColumns(analysis)}。`);
  }
  if (target.reference) fail(400, 'LANGUAGE_COLUMN_REFERENCE', `${targetLanguage} 是参考列，不能写入译文。`);

  const missing = analysis.candidates.filter(candidate =>
    candidate.targetLanguage === targetLanguage && candidate.targetKind === 'missing');
  if (!missing.length) {
    fail(409, 'NO_MISSING_TRANSLATIONS', `${targetLanguage} 列没有待翻译的空单元格；已有译文未改动。`);
  }

  // Same source text in several rows only needs one workflow request. Keep
  // row order so a rerun continues from the same place if the run is capped.
  const byKey = new Map();
  for (const candidate of missing) {
    const key = `${candidate.sourceLanguage}\u0000${candidate.targetLanguage}\u0000${candidate.sourceText}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: `item-${byKey.size + 1}`,
        sourceLanguage: candidate.sourceLanguage,
        targetLanguage: candidate.targetLanguage,
        sourceText: candidate.sourceText,
        candidateIds: [],
      });
    }
    byKey.get(key).candidateIds.push(candidate.id);
  }
  const allRequests = [...byKey.values()];
  const requests = allRequests.slice(0, Math.max(1, maxRequests));
  const skipped = allRequests.length - requests.length;
  if (!requests.length) fail(409, 'NO_TRANSLATABLE_TEXT', '没有找到可翻译的文本。');

  const batches = batchRequests(requests);
  const translated = new Map();
  let processed = 0;
  for (const batch of batches) {
    onProgress({
      stage: 'translating',
      label: `正在翻译 ${processed + 1}–${processed + batch.length} / ${requests.length} 条`,
      done: processed,
      total: requests.length,
    });
    const map = await runWorkflowBatch(config, batch, {fetchImpl});
    for (const request of batch) {
      const text = map.get(request.id);
      for (const candidateId of request.candidateIds) translated.set(candidateId, text);
    }
    processed += batch.length;
  }
  onProgress({stage: 'writing', label: '正在写回工作簿', done: requests.length, total: requests.length});
  const output = await applyProjectTextTranslations(bytes, analysis, translated);
  const baseName = name.replace(/\.(xlsx|xlsm)$/i, '');
  const extension = name.match(/\.(xlsx|xlsm)$/i)?.[0] ?? '.xlsx';
  return {
    name: `${baseName}_${targetLanguage}${extension}`,
    mime: /\.xlsm$/i.test(extension)
      ? 'application/vnd.ms-excel.sheet.macroEnabled.12'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: output,
    targetLanguage,
    languageColumns: analysis.inspection.languageColumns,
    stats: {
      missing: missing.length,
      uniqueRequests: allRequests.length,
      translated: translated.size,
      applied: translated.size,
      skipped,
      existingUntranslated: analysis.candidates.filter(candidate =>
        candidate.targetLanguage === targetLanguage && candidate.targetKind === 'existing').length,
      batches: batches.length,
    },
  };
}
