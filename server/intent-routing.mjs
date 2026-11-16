// Lightweight intent hints used before the Dify task classifier.
//
// The classifier is a language model and occasionally confuses a card-design
// request with an office task when the wording also mentions a file or table.
// These rules only cover *unambiguous* phrasing. Everything else is still
// decided by the Chatflow classifier, so adding a new hint must not turn into
// a second, hidden router.

const CARD_NOUN = /(求助卡|需求卡|互助卡|卡片|求助请求|互助请求|求助需求|互助需求|需求说明|\bcard\b)/i;
const CARD_ACTION = /(做|制作|设计|创建|新建|生成|整理|修改|编辑|更新|发布|下架|换|重画|调整|预览|确认)/;
const COLLEAGUE = /(找人|请人|同事|谁能|谁可以|谁有空|求助|互助|认领|接取)/;
const REVIEW_ACTION = /(帮忙|协助|审阅|校对|复核|检查|看看|评估|处理|翻译|整理|review)/i;
const OFFICE_FILE = /(文件|文档|表格|Excel|Word|PPT|PDF|压缩包|图片|数据|报告)/i;
const OFFICE_ACTION = /(处理|整理|转换|合并|拆分|提取|总结|分析|翻译|排版|生成|修改|读取|制作|填写|设计)/i;

/**
 * A request that clearly asks for a help/request card, or clearly asks a
 * colleague to review/handle something. Used to (a) force the card branch and
 * (b) keep a `User Texts` workbook from being translated when the user only
 * wants to publish it as material for a help card.
 */
export function looksLikeCardRequest(message) {
  const text = String(message ?? '').normalize('NFKC');
  if (!text.trim()) return false;
  if (/(求助卡|需求卡|互助卡)/.test(text)) return true;
  if (/(设计|制作|创建|新建|生成|整理|做|发布|修改|编辑|更新|换|重画)[^，。；！？,.;!?\n]{0,12}卡片?(?:[，。；、！？!?,.;\s]|$)/.test(text)) return true;
  if (CARD_NOUN.test(text) && CARD_ACTION.test(text)) return true;
  if (COLLEAGUE.test(text) && REVIEW_ACTION.test(text)) return true;
  if (/(发布|创建|新建|发起|提交).{0,8}(需求|求助|互助任务)/.test(text)) return true;
  if (/(把|将).{0,24}(整理|转|变成|做成|发布).{0,8}(需求|求助|互助)/.test(text)) return true;
  return false;
}

/**
 * Clear file-processing task. Kept for the routing hint payload and tests;
 * translation tasks are also forced to the office branch by `suggestRoute`.
 */
export function looksLikeOfficeRequest(message) {
  const text = String(message ?? '').normalize('NFKC');
  if (!text.trim()) return false;
  if (looksLikeCardRequest(text)) return false;
  return OFFICE_FILE.test(text) && OFFICE_ACTION.test(text);
}

/**
 * True when the user wants another person to review/handle something rather
 * than asking the assistant to translate a file. In that case a `User Texts`
 * workbook is material, not an automatic translation job.
 */
export function looksLikeCollaborationRequest(message) {
  const text = String(message ?? '').normalize('NFKC');
  if (looksLikeCardRequest(text)) return true;
  return COLLEAGUE.test(text) && REVIEW_ACTION.test(text);
}

/**
 * Translation must be requested explicitly. A workbook named `User Texts` is
 * not enough: the user may want to attach it to a help card, ask for review,
 * or ask an electrical question about it. Review/校对 wording also wins over a
 * bare "翻译文件" phrase.
 */
export function isTranslationRequest(message) {
  const text = String(message ?? '').normalize('NFKC');
  if (!text.trim()) return false;
  if (looksLikeCollaborationRequest(text)) return false;
  const explicitTarget = /(目标语言|目标语种|target\s*language)/i.test(text)
    || /(翻译|译|转|转换)(?:成|为|到|至)\s*[A-Za-z一-龥]/.test(text)
    || /\btranslate\b/i.test(text);
  const reviewOnly = /(审阅|校对|复核|检查|看看|看一下|review|纠错|挑错|有没有问题|是否正确)/i.test(text);
  if (reviewOnly && !explicitTarget) return false;
  if (explicitTarget) return true;
  if (/^(请|帮我|麻烦)?\s*(翻译|译)(一下|这个|这份|文件|表格|内容|工作簿)?[。.!！]?$/.test(text)) return true;
  if (/(把|将).{0,32}(翻译|译成|译为|转换成|转成)/.test(text)) return true;
  if (/(翻译|译)(第\s*\d+\s*(段|页|节|章|行|列)|指定|以下|下面|上面|整篇|全文|这几?|那几?)/.test(text)) return true;
  if (/(翻译|译)(一下|这|该|本|这个|这份|文件|表格|内容|工作簿|文本)/.test(text)) return true;
  return false;
}

export function suggestRoute(message) {
  if (looksLikeCardRequest(message)) return 'card';
  // Message-only translations do not need a sandbox or file tools.
  if (isTranslationRequest(message)) return /(文件|附件|文档|工作簿|Excel|Word|PDF|PPT|TXT|Markdown|CSV)/i.test(message)?'office':null;
  if (looksLikeOfficeRequest(message)) return 'office';
  return null;
}
