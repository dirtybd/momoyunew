// Card cover backgrounds that ship with the web app. The backend matches card
// text to a category and falls back to `general` when nothing fits. Keep the
// keyword order intentional: specific creative actions win over generic review
// words (e.g. delivery acceptance), and safety wins over electrical.
export const CARD_BACKGROUNDS = Object.freeze({
  translate: {label: '翻译', file: 'translate', keywords: ['翻译', '译成', '译为', '译文', '英译', '中译', '本地化', 'target language', 'en-us', 'de-de', 'zh-cn']},
  automation: {label: '自动化脚本', file: 'automation', keywords: ['自动化脚本', '办公自动化', '批处理', '脚本编写', '编写脚本', '开发脚本', '写脚本', '程序开发', '编程', 'python', 'powershell', 'vba', 'rpa', '智能体', '问答机器人', '聊天机器人', 'agent', 'dify', 'coze', '扣子', 'n8n', 'langchain', 'langgraph', 'chatflow', '工作流搭建', '工作流开发', '工作流编排']},
  modeling: {label: '3D建模设计', file: 'modeling', keywords: ['3d建模', '3d模型', '三维建模', '三维设计', '三维模型', '机械设计', 'cad', 'solidworks', 'blender', 'sketchup', 'creo', 'catia', 'rhino', 'fusion 360', '3d modeling', '3d modelling']},
  writing: {label: '文案写作', file: 'writing', keywords: ['文案', '写作', '撰稿', '宣传稿', '新闻稿', '推文', '公众号', '演讲稿', '发言稿', '广告语', '润色', '改写', '文章', '拍摄脚本', '视频脚本', 'copywriting']},
  photography: {label: '摄影拍摄', file: 'photography', keywords: ['摄影', '拍摄', '拍照', '产品照', '人像', '活动跟拍', '摄影棚', 'photography', 'photoshoot']},
  grading: {label: '图片调色', file: 'grading', keywords: ['调色', '修图', '修色', '色彩校正', '色彩分级', '照片处理', 'color grading', 'colour grading', 'color correction', 'lightroom', 'lut']},
  voice: {label: '配音', file: 'voice', keywords: ['配音', '旁白', '录音', '音频剪辑', '音频处理', '降噪', '播音', '有声', 'voiceover', 'voice over', 'dubbing', 'audition']},
  video: {label: '视频剪辑', file: 'video', keywords: ['视频剪辑', '剪视频', '视频制作', '剪辑', '短视频', '片头', '片尾', '后期制作', 'video editing', 'premiere', '剪映', 'final cut']},
  review: {label: '审阅', file: 'review', keywords: ['审阅', '审核', '校对', '复核', '复查', '检查', '纠错', '挑错', '把关', '验收']},
  safety: {label: '安全巡检', file: 'safety', keywords: ['安全', '巡检', '隐患', '消防', 'ehs', '防护', '事故', '应急', '检查表', '整改']},
  electrical: {label: '电气工业', file: 'electrical', keywords: ['电气', '配电', 'plc', 'tia', '博途', '变频器', '电机', '图纸', '回路', '断路器', '电缆', 'profinet', '仪表', '工控']},
  it: {label: 'IT/系统', file: 'it', keywords: ['系统', '网络', '服务器', '软件', '账号', '权限', '登录', '故障', '电脑', '打印机', '数据库', '接口', 'api', 'vpn', '密码']},
  hr: {label: '人事招聘', file: 'hr', keywords: ['招聘', '面试', '人事', '入职', '离职', '考勤', '绩效', '薪酬', '简历', '编制']},
  finance: {label: '财务报销', file: 'finance', keywords: ['财务', '报销', '发票', '预算', '费用', '付款', '核算', '成本', '税务', '对账']},
  procurement: {label: '采购物流', file: 'procurement', keywords: ['采购', '物流', '供应商', '订单', '到货', '库存', '仓库', '发货', '物料', '收货']},
  training: {label: '培训教学', file: 'training', keywords: ['培训', '教学', '教程', '课程', '讲义', '授课', '新人', '上岗', 'sop', '操作手册', '学习']},
  meeting: {label: '协作会议', file: 'meeting', keywords: ['会议', '开会', '纪要', '讨论', '评审会', '例会', '汇报', '跨部门', '协作']},
  design: {label: '设计创意', file: 'design', keywords: ['设计', '创意', '海报', '配图', '视觉', 'ui', '美化', '排版设计', 'ppt']},
  support: {label: '人工客服', file: 'support', keywords: ['客服', '客户', '咨询', '答疑', '投诉', '售后', '接待', '热线', '工单']},
  legal: {label: '法务合规', file: 'legal', keywords: ['法务', '合同', '合规', '条款', '协议', '审批', '法律', '授权']},
  kb: {label: '知识库检索', file: 'kb', keywords: ['知识库', '检索', '查询资料', '查资料', '资料查询', '问答库', '文档中心', '搜索资料']},
  data: {label: '数据报表', file: 'data', keywords: ['数据', '报表', '统计', '汇总', '表格', 'excel', 'xlsx', '图表', '指标', '看板', '台账']},
  docs: {label: '文档整理', file: 'docs', keywords: ['文档', '资料', '整理', '归档', '目录', '排版', 'word', 'pdf', '手册', '版本', '模板']},
  promo: {label: '宣传', file: 'promo', keywords: ['宣传', '推广', '活动', '公告', '招募', '发布活动']},
  general: {label: '通用互助', file: 'general', keywords: []},
});
// The generic image is the fallback, never a keyword match.
export const DEFAULT_CARD_BACKGROUND = 'general';
// Old cards stored these three ids. Keep reading them without listing them in
// the manual picker.
export const LEGACY_BACKGROUND_ALIASES = Object.freeze({mountain: 'general', coast: 'review', meme: 'translate'});
export const CARD_BACKGROUND_OPTIONS = Object.freeze([
  ['none', '无'],
  ...Object.entries(CARD_BACKGROUNDS).map(([id, item]) => [id, item.label]),
]);

export function backgroundFile(id) {
  if (!id || id === 'none') return null;
  const target = LEGACY_BACKGROUND_ALIASES[id] || id;
  return CARD_BACKGROUNDS[target]?.file || null;
}

export function backgroundLabel(id) {
  if (!id || id === 'none') return '无';
  return CARD_BACKGROUNDS[LEGACY_BACKGROUND_ALIASES[id] || id]?.label || id;
}

function keywordMatch(text, keyword) {
  // ASCII keywords must stand alone, otherwise `it` matches "wait"/"edit",
  // `tia` matches "partial", and `ui` matches "guide".
  if (!/^[a-z0-9 .+#-]+$/.test(keyword)) return text.includes(keyword);
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text);
}

export function matchBackgroundText(value = '') {
  const text = String(value).normalize('NFKC').toLowerCase();
  if (!text.trim()) return null;
  // Distinguish building a translation Agent from translating its user guide.
  const actions = [
    ['automation', /(?:搭建|构建|开发|配置|部署|创建|制作|设计|做一个|做个)[^，。！？；\n]{0,24}(?:智能体|\bagent\b|\bdify\b|\bcoze\b|扣子|\bchatflow\b|问答机器人|聊天机器人)/],
    ['writing', /(?:撰写|编写|写|润色|改写)[^，。！？；\n]{0,24}(?:文案|文章|稿件|说明书|指南|方案|报告|拍摄脚本|视频脚本)/],
    ['translate', /翻译|译成|译为/],
  ].map(([id, pattern]) => ({id, index: text.search(pattern)})).filter(item => item.index >= 0);
  if (actions.length) return actions.sort((a, b) => a.index - b.index)[0].id;
  for (const [id, item] of Object.entries(CARD_BACKGROUNDS)) {
    if (!item.keywords.length) continue;
    if (item.keywords.some(keyword => keywordMatch(text, keyword))) return id;
  }
  return null;
}

export function matchCardBackground(card = {}) {
  const list = value => Array.isArray(value) ? value : value ? [String(value)] : [];
  // The task itself should win over incidental software/material/acceptance words.
  const primary = matchBackgroundText(card.title) || matchBackgroundText(card.problem);
  if (primary) return primary;
  const fields = [card.desiredOutcome,
    ...list(card.deliverables), ...list(card.acceptanceCriteria),
    ...list(card.materials), ...list(card.constraints), ...list(card.skills)];
  return matchBackgroundText(fields.filter(Boolean).join(' '));
}
