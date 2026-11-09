import {normalizeCardStyle} from './card-style.mjs';

const examples = [
  {
    title:'示例：Excel 数据整理',
    problem:'两份项目人员名单分别由不同同事维护，工号格式不统一，人工核对容易遗漏。希望以 A 表为基准，找出 A 表有、B 表没有的记录。',
    desiredOutcome:'得到一份能回查来源的差异清单，下次更新名单时也能重复使用这套核对方法。',
    deliverables:['Excel 差异清单，包含工号、姓名、来源行号','一段简短的公式或操作步骤说明'],
    acceptanceCriteria:['先去除工号前后空格，再按工号匹配','漏项总数与明细行数一致','保留两份原始表，不直接覆盖'],
    materials:['示例 A、B 两份人员表，实际文件接取后再由双方确认'],
    constraints:['仅使用演示数据，不包含真实员工资料','预计需要 20–30 分钟，具体时间协商'],
    deadline:'双方协商', skills:['Excel','数据核对'], rewardPoints:3,
    cardStyle:{theme:'orange',layout:'poster',shape:'polaroid',background:'mountain'}
  },
  {
    title:'示例：演示文稿排版',
    problem:'一份 8 页的项目复盘 PPT 内容已经齐全，但标题层级、图表大小和页间留白不统一，分享时重点不够突出。',
    desiredOutcome:'保留原有结论与数据，让听众一眼看懂项目结果、问题和下一步行动。',
    deliverables:['可编辑的 8 页 PPT','一页可继续复用的版式样例'],
    acceptanceCriteria:['统一字体与标题层级，每页只有一个主要信息','图表标注清楚，数字和结论不被改写','在普通办公电脑上打开不缺字、不溢出'],
    materials:['演示 PPT 草稿与现有公司模板，均为示例材料'],
    constraints:['以排版为主，不重新编造项目结论','预计需要 30 分钟，可先调整 2 页确认方向'],
    deadline:'本周内协商',skills:['PPT','信息排版'],rewardPoints:4,
    cardStyle:{theme:'sky',layout:'standard',shape:'polaroid',background:'coast'}
  },
  {
    title:'示例：新同事入门答疑',
    problem:'新同事第一次使用公司常用办公工具，对会议预约、共享文件命名和资料归档还有几个具体疑问，希望有人用真实操作演示一次。',
    desiredOutcome:'答疑后能独立完成一次会议预约，并把示例文件放到正确目录。',
    deliverables:['一次约 15 分钟的线上或现场答疑','一份不超过 5 条的操作备忘'],
    acceptanceCriteria:['由提问者自己完成一次完整操作','不共享他人账号或绕过系统权限','无法确定的流程注明需要咨询的负责岗位'],
    materials:['问题清单和可公开的工具界面截图'],
    constraints:['时间由双方约定，不要求在休息时间响应'],
    deadline:'工作间隙协商',skills:['办公工具','沟通'],rewardPoints:2,
    cardStyle:{theme:'orange',layout:'note',shape:'bubble',background:'meme'}
  },
  {
    title:'示例：设备说明文字校对',
    problem:'一份约 1200 字的设备操作说明准备内部试读，想请另一位同事检查错别字、步骤顺序和容易误解的说法。',
    desiredOutcome:'让第一次接触设备的人也能读懂准备条件和操作顺序，技术结论由原负责人确认。',
    deliverables:['带修改痕迹的文稿','需要技术负责人确认的问题列表'],
    acceptanceCriteria:['语言修改与技术疑问分别标注','保留原稿，不擅自更改参数、安全要求或操作权限','每个疑问能定位到具体段落'],
    materials:['去除客户信息的示例说明稿'],
    constraints:['只做文字与表达检查，不替代技术或安全审核'],
    deadline:'双方协商',skills:['文字编辑','说明文写作'],rewardPoints:3,
    cardStyle:{theme:'sand',layout:'note',shape:'ticket',background:'none'}
  },
  {
    title:'示例：把流程画清楚',
    problem:'一个跨岗位的小流程目前靠口头说明，新同事不清楚谁提供输入、谁确认结果，以及异常应该退回哪一步。',
    desiredOutcome:'把 6–8 个步骤整理成一张可讨论的流程图，减少来回问人。',
    deliverables:['一张可编辑流程图','各步骤输入、输出和责任岗位的简表'],
    acceptanceCriteria:['正常路径与退回路径均能读懂','岗位写职责，不编造具体人员姓名','仍有争议的环节标记待确认'],
    materials:['一段示例流程描述，接取后可先进行 10 分钟沟通'],
    constraints:['不把演示流程当作公司的正式制度'],
    deadline:'下次沟通前协商',skills:['流程图','信息整理'],rewardPoints:3,
    cardStyle:{theme:'ink',layout:'poster',shape:'ticket',background:'mountain'}
  },
  {
    title:'示例：英文邮件帮我把把关',
    problem:'准备给海外合作方发一封进度确认邮件，中文要点已经写好，希望检查英文是否清楚、礼貌，是否遗漏了需要对方确认的事项。',
    desiredOutcome:'得到一封可由发起者检查后自行发送的英文邮件，不改变交付承诺。',
    deliverables:['英文邮件正文与主题','两三条容易产生歧义的表达说明'],
    acceptanceCriteria:['保留原文的日期、范围和责任边界','待确认事项与行动请求清楚','只提供草稿，不代替发起者发送'],
    materials:['不含真实收件人、客户或订单信息的示例要点'],
    constraints:['具体商务承诺由发起者最终确认'],
    deadline:'工作时间协商',skills:['英文写作','邮件沟通'],rewardPoints:2,
    cardStyle:{theme:'rose',layout:'standard',shape:'bubble',background:'coast'}
  },
  {
    title:'示例：办公区域维护公告',source:'official',kind:'announcement',
    problem:'这是一条官方公告样例，用来展示维护通知应如何说明影响范围、安排和联系渠道，不代表实际维护计划。',
    desiredOutcome:'让员工在真正的维护通知中快速找到影响区域、开始结束时间和应对方式。',
    deliverables:['维护区域、时段与可能影响','异常反馈的负责岗位或渠道'],
    acceptanceCriteria:['时间和影响范围确认后再由管理员正式发布','公告与员工互助内容清楚区分'],
    constraints:['演示信息，请勿据此安排实际停机或搬迁'],skills:[],
    cardStyle:{theme:'orange',layout:'note',shape:'ticket'}
  },
  {
    title:'示例：安全培训公告',source:'official',kind:'announcement',
    problem:'这是一条培训公告样例，演示如何说明培训主题、适用人员和参加方式，不代表已经安排了真实培训。',
    desiredOutcome:'员工看到正式公告时，能判断是否需要参加、何时参加、需要准备什么。',
    deliverables:['主题与适用岗位','正式时间、地点或会议入口','参加方式与补训说明'],
    acceptanceCriteria:['培训信息经负责岗位确认','不公开员工个人信息'],
    constraints:['实际安排以公司正式通知为准'],skills:[],
    cardStyle:{theme:'sky',layout:'standard',shape:'polaroid',background:'mountain'}
  },
  {
    title:'示例：自动化脚本悬赏',source:'official',kind:'bounty',
    problem:'每周都要把几份格式一致的演示 CSV 合并并检查重复记录，希望把重复操作变成可复用的小工具。',
    desiredOutcome:'普通同事按照说明即可运行，输出合并表与重复项报告。',
    deliverables:['可运行的脚本和依赖说明','示例输入与预期输出','简短使用说明'],
    acceptanceCriteria:['相同输入得到相同输出','输入缺列或格式异常时给出明确提示','不覆盖原文件，不上传数据到外部服务'],
    materials:['只含虚构数据的示例 CSV'],constraints:['奖励仅为演示积分意向，尚未接入结算'],
    deadline:'接取后协商',skills:['Python','CSV'],rewardPoints:5,
    cardStyle:{theme:'ink',layout:'poster',shape:'ticket',background:'none'}
  },
  {
    title:'示例：流程图绘制悬赏',source:'official',kind:'bounty',
    problem:'希望把一份演示流程整理成面向全员的图示，让接收资料、处理任务和确认完成的过程更容易理解。',
    desiredOutcome:'形成一张清楚、可编辑、便于后续维护的流程图。',
    deliverables:['流程图源文件','便于预览的图片','待确认问题清单'],
    acceptanceCriteria:['各步骤与原文对应','关键责任与交接点清楚','未知环节标记待确认，不能自行编造'],
    materials:['一份演示流程文字稿'],constraints:['奖励仅为演示意向，不代表实际兑换或发放'],
    deadline:'接取后协商',skills:['流程图','版式设计'],rewardPoints:5,
    cardStyle:{theme:'orange',layout:'poster',shape:'polaroid',background:'coast'}
  }
];

export const DEMO_REQUESTS = examples.map(entry=>({
  materials:[],constraints:[],deadline:null,rewardPoints:1,
  source:'employee',kind:'request',...entry,
  cardStyle:normalizeCardStyle(entry.cardStyle)
}));
