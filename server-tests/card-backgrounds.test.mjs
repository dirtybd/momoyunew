import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_BACKGROUNDS,
  CARD_BACKGROUND_OPTIONS,
  DEFAULT_CARD_BACKGROUND,
  LEGACY_BACKGROUND_ALIASES,
  backgroundFile,
  backgroundLabel,
  matchBackgroundText,
  matchCardBackground,
} from '../shared/card-backgrounds.mjs';
import {CARD_STYLE_OPTIONS, normalizeCardStyle} from '../shared/card-style.mjs';

test('背景分类按关键词匹配，无法匹配时用通用', () => {
  assert.equal(matchBackgroundText('把这个工作簿翻译成英文'), 'translate');
  assert.equal(matchBackgroundText('请同事帮忙审阅这份材料'), 'review');
  assert.equal(matchBackgroundText('现场安全巡检发现隐患'), 'safety');
  assert.equal(matchBackgroundText('S7-1200 博途程序核对'), 'electrical');
  assert.equal(matchBackgroundText('OA 系统登录不上'), 'it');
  assert.equal(matchBackgroundText('招聘面试安排'), 'hr');
  assert.equal(matchBackgroundText('报销发票对账'), 'finance');
  assert.equal(matchBackgroundText('供应商到货和库存'), 'procurement');
  assert.equal(matchBackgroundText('新人上岗培训讲义'), 'training');
  assert.equal(matchBackgroundText('跨部门会议纪要'), 'meeting');
  assert.equal(matchBackgroundText('海报视觉设计'), 'design');
  assert.equal(matchBackgroundText('客户投诉工单'), 'support');
  assert.equal(matchBackgroundText('合同条款合规审批'), 'legal');
  assert.equal(matchBackgroundText('知识库检索资料'), 'kb');
  assert.equal(matchBackgroundText('Excel 汇总报表'), 'data');
  assert.equal(matchBackgroundText('Word 文档归档整理'), 'docs');
  assert.equal(matchBackgroundText('活动宣传推广'), 'promo');
  assert.equal(matchBackgroundText('帮我看看这个'), null);
  assert.equal(matchBackgroundText(''), null);
  assert.equal(DEFAULT_CARD_BACKGROUND, 'general');
  assert.equal(matchBackgroundText('互助'), null);
});

test('动作类关键词优先于领域，安全检查优先于电气', () => {
  assert.equal(matchBackgroundText('电气项目文本翻译'), 'translate');
  assert.equal(matchBackgroundText('电气图纸审阅'), 'review');
  assert.equal(matchBackgroundText('电气安全巡检'), 'safety');
  assert.equal(matchBackgroundText('数据报表发给客户'), 'support');
});

test('英文关键词按独立单词匹配，避免误伤 wait/edit/partial', () => {
  assert.equal(matchBackgroundText('wait for it'), null);
  assert.equal(matchBackgroundText('edit the partial file'), null);
  assert.equal(matchBackgroundText('用 Excel 打开'), 'data');
  assert.equal(matchBackgroundText('PDF 文档'), 'docs');
  assert.equal(matchBackgroundText('IT 系统权限'), 'it');
  assert.equal(matchBackgroundText('plc 程序'), 'electrical');
});

test('调色、配音和视频任务优先使用对应封面，不被材料或验收用词抢走', () => {
  assert.equal(matchBackgroundText('产品图片调色，交付后检查颜色一致性'), 'grading');
  assert.equal(matchBackgroundText('用 Lightroom 修图'), 'grading');
  assert.equal(matchBackgroundText('配音和音频剪辑，去除录音底噪'), 'voice');
  assert.equal(matchBackgroundText('中文旁白配音，用于客户培训视频'), 'voice');
  assert.equal(matchBackgroundText('用剪映剪辑安全培训短视频'), 'video');
  assert.equal(matchBackgroundText('Premiere video editing'), 'video');
  assert.equal(matchCardBackground({title: '剪辑产品演示视频', problem: '已有素材和PPT', acceptanceCriteria: ['验收检查后用于客户演示']}), 'video');
  assert.equal(matchBackgroundText('需要解决 convoluted template 问题'), null);
  for (const id of ['grading', 'voice', 'video']) {
    assert.ok(CARD_STYLE_OPTIONS.background.includes(id));
    assert.equal(normalizeCardStyle({background: id}).background, id);
    assert.equal(backgroundFile(id), id);
  }
});

test('从卡片内容挑选背景，空卡片返回 null', () => {
  assert.equal(matchCardBackground({
    title: '周报数据汇总',
    problem: '两份表格需要合并',
    deliverables: ['汇总 XLSX'],
    skills: ['Excel'],
  }), 'data');
  assert.equal(matchCardBackground({title: '资料审阅', problem: '指出遗漏和风险'}), 'review');
  assert.equal(matchCardBackground({title: '报表整理', skills: 'Excel 数据处理'}), 'data');
  assert.equal(matchCardBackground({title: '随便聊聊'}), null);
  assert.equal(matchCardBackground({}), null);
});

test('新增四类主题覆盖常见任务，软件与附带材料不会盖过标题', () => {
  assert.equal(matchBackgroundText('编写 Python 自动化脚本整理 Excel'), 'automation');
  assert.equal(matchBackgroundText('SolidWorks 三维建模设计'), 'modeling');
  assert.equal(matchBackgroundText('CAD 机械设计'), 'modeling');
  assert.equal(matchBackgroundText('为宣传短视频写一份视频脚本'), 'writing');
  assert.equal(matchBackgroundText('产品摄影拍摄'), 'photography');
  assert.equal(matchCardBackground({title: '新品摄影拍摄', problem: '后期还需要调色修图'}), 'photography');
  assert.equal(matchCardBackground({title: '修改3D模型', problem: '建模软件安装在公司电脑', acceptanceCriteria: ['审阅模型']}), 'modeling');
  assert.equal(matchCardBackground({title: '润色公众号文案', problem: '客户培训的宣传稿', materials: ['Word 文档']}), 'writing');
  for (const id of ['automation', 'modeling', 'writing', 'photography']) {
    assert.ok(CARD_STYLE_OPTIONS.background.includes(id));
    assert.equal(normalizeCardStyle({background: id}).background, id);
    assert.equal(backgroundFile(id), id);
  }
});

test('搭建智能体归入自动化，不被客服、知识库、接口和验收措辞抢走', () => {
  const cards = [
    {title: '求同事帮忙搭建一个智能体'},
    {title: '用 Dify 搭建公司知识库问答智能体', problem: '需要接入API接口和上传文档'},
    {title: '想搭建客服 Agent', skills: ['Dify', '工作流编排']},
    {title: '帮忙搭建一个AI智能体', acceptanceCriteria: ['检查后可以正常使用']},
    {title: '搭建智能体', problem: '把上传的文档翻译成英文'},
    {title: '配置 Coze 工作流'},
    {title: '帮忙搭建一个翻译智能体'},
    {title: '用Dify制作文案写作智能体'},
  ];
  for (const card of cards) assert.equal(matchCardBackground(card), 'automation', card.title);
  assert.equal(matchCardBackground({title: '翻译智能体配置指南'}), 'translate');
  assert.equal(matchCardBackground({title: '写一份智能体宣传文案'}), 'writing');
  assert.equal(matchCardBackground({title: '翻译这份搭建智能体的指南'}), 'translate');
  assert.equal(matchBackgroundText('Investigate the agenda'), null);
});

test('背景枚举、旧 id 兼容和文件映射', () => {
  const ids = CARD_BACKGROUND_OPTIONS.map(([id]) => id);
  assert.deepEqual(ids, ['none', ...Object.keys(CARD_BACKGROUNDS)]);
  assert.ok(CARD_STYLE_OPTIONS.background.includes('general'));
  assert.ok(CARD_STYLE_OPTIONS.background.includes('mountain'));
  assert.equal(normalizeCardStyle({theme: 'orange', layout: 'standard', radius: 'soft', emphasis: 'normal', shape: 'standard', background: 'safety'}).background, 'safety');
  assert.equal(normalizeCardStyle({background: 'not-a-background'}).background, 'none');
  for (const [legacy, target] of Object.entries(LEGACY_BACKGROUND_ALIASES)) {
    assert.equal(backgroundFile(legacy), CARD_BACKGROUNDS[target].file);
    assert.equal(backgroundLabel(legacy), CARD_BACKGROUNDS[target].label);
  }
  assert.equal(backgroundFile('none'), null);
  assert.equal(backgroundFile('general'), 'general');
  assert.equal(backgroundLabel('general'), '通用互助');
});
