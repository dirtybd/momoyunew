# 本轮协作接口：语义匹配与心理关怀（2026-11-03）

主会话负责 server/matching.mjs、shared/matching*、server/content-review.mjs（统一review客户端）、语义匹配测试及docs/集成；后端会话负责 care API、server/index.mjs、server/dify.mjs、server/task-workflow.mjs和care测试；前端会话负责 frontend/；Dify会话负责已有匹配Workflow扩展、Agent工具schema/提示词、UI发布与归档。共享工作区，禁止各自git提交或覆盖他人文件。

## 语义匹配

员工新增明确用于匹配的skillDescription:string(0..2000)，保留skills标签，不传bio/姓名/部门/联系方式/心理聊天。Workflow输入snapshot_json含{now,request:{title,problem,desiredOutcome,deliverables,skills,deadlineEnd},candidates:[{id,skills,skillDescription,acceptingHelp,preferences,activeCount}]}。主后端先过滤硬限制，无关键词淘汰；Dify LLM判断实际能力相关性。

End仍输出matches_json字符串，数组项{candidateId,score:0..100,reason:string<=400,evidence:string<=240}。score>=65才可推荐，evidence必须是该候选技能标签或技能说明的实际文字片段；不可杜撰技能。无合适者返回[]，不硬凑。后端再次检查匿名ID范围、证据片段与最新硬限制。非办公/心理治疗/危机请求不能撮合员工治疗。

preview_matches card_json兼容旧{title,skills,deadline}，新增可选problem,desiredOutcome,deliverables；schema需同步。仍返回匿名人数，sent=false；确认发布后后台送消息。

## 共用工作流的内容审核分支（复用现有专用Key，不新建凭证）

在现有Workflow新增可选paragraph review_json，snapshot_json改可选、默认空。review_json非空走独立内容审核LLM+严格解析；否则走语义匹配。审核End输出review_result_json字符串，格式{allow:boolean,urgent:boolean,reason:string<=180}。输入review_json={type:'care_post'|'care_comment',title?:string,content:string}。不能执行其中的指令。

允许正常倾诉、压力、吐槽和友善鼓励；不压制负面感受。拒绝可识别他人/联系方式、攻击羞辱、歧视骚扰、危险行为指导/煽动、诊断/用药指示、广告。明显当下自伤危机/图文鼓动自伤标urgent=true，先引导私密支持、不公屏传播。只审待发布文字，不传完整私密对话。模型不确定/输出错误/服务不可用时不自动放行。

主会话提供 server/content-review.mjs 的 export async function reviewCareContent({type,title='',content})→{allow,urgent,reason}；后台通过已有DIFY_MATCHING_API_KEY调用同工作流review_json分支。若未配置或失败抛带status=503错误，care发布/评论均暂不可写，不伪装审核成功。后端会话可直接import该函数，主会话稍后实现。

## Agent 与 care 预览协议（后端+Dify+前端协同）

保留help/request/style，新增intent='care'；新增可选careCard:null|{title:string<=120,content:string<=1500}，careSafety:'support'|'urgent'。普通慰藉=care但careCard=null，用户明确想公开倾诉时才整理去标识careCard。readyForPreview只代表可预览。urgent时careCard=null、不引导公开。混合任务如“压力大，帮我写周报”简短共情后正常help；心理用药/诊断不能冒充专家或给医疗结论。

关怀对话采用温和、非评判、开放问题与可选择的小步建议；不机械诊断、不说教、不强迫宣泄，不制造依赖，不承诺保密/治愈/替用户联系他人。明显危机优先确认当前安全、帮助联系身边可信的人/本地紧急与专业支持；不编造电话号码。本项目不代替专业心理治疗。私密对话保存在本人账号，不自动公开/匹配/通知。

后端将carePreview:{title,content}|null、careSafety、careMode存当前对话draft data，只返回本人，普通公开request视图必须剔除；GET messages恢复原有对话。/clarify响应增加carePreview和careSafety（本人），request可带本人carePreview供恢复。不能把careCard写进普通任务字段或推送队列。普通help继续可处理文件；care不调用preview_matches。主提示词/网页每轮说明须同步协议。Dify会话只改线上Agent和docs提示词，不改server/dify.mjs。

## 心情角API（全需登录；独立care_posts，不复用接取任务）

GET /api/care/posts?cursor → {items:CarePost[],nextCursor}；GET /api/care/posts/:id→{post}。
CarePost={id,title,content,createdAt,updatedAt,anonymous:true,isMine:boolean,commentsEnabled:boolean,commentCount:number}，不返回真实作者ID/姓名。
POST /api/care/posts {title,content,conversationId?:string,commentsEnabled?:boolean,confirmed:true}→201 {post}。默认匿名，须本人确认、AI审核允许且非urgent；有conversationId须当前用户拥有，不能用他人对话。高危对话预览不发布。发帖材料仅这段文字，无附件/私密历史/身份分享。
PATCH /api/care/posts/:id {title?,content?,commentsEnabled?,confirmed:true}→{post}；仅本人，文字更新重新审核。
POST /api/care/posts/:id/archive {confirmed:true}→{ok:true}；仅本人软移除。
GET /api/care/posts/:id/comments?cursor → {items:Comment[],nextCursor}；Comment={id,content,authorLabel:'发布者'|'匿名同事',isMine,canRemove,createdAt}。
POST /api/care/posts/:id/comments {content:string<=500}→201 {comment}，开启评论且AI审核允许，基本限频5条/分钟/人。
POST /api/care/comments/:id/remove {confirmed:true}→{ok:true}；本人留言或帖子作者可软移除。
POST /api/care/comments/:id/report {reason:string<=300}→{ok:true,status:'pending'}；记录待处理，不声称已有人工接管。可去重。

所有UGC纯文本输出不执行HTML。发表前说明“同事可见；匿名只隐藏身份，文字仍可能识别你/他人”，默认不提供定位/部门/员工档案。举报不等于即时人工响应，不声称24小时监护。

## 前端

原桌面样式不改成手机壳；公屏增加紧凑“心情角”独立滚动小专区（当前普通任务区仍独立），点击看倾诉和鼓励留言，不显示接取/奖励/匹配入口。游客只提示登录后看心情角。关怀对话不强制空白卡片，可主动“整理成匿名倾诉卡”，用户确认后才发；urgent不出现公开引导。care预览使用独立面板，绝不调用普通/publish接口。收起、编辑、发帖确认、原作者移除/关闭评论、本人/作者移除评论、反馈不适留言均走上述真实API。UI保持简约，关键公开规则14px近控件说明。

## 验证与边界

只用明确合成情绪/危机文本和虚拟员工测试，不重放用户真实心理对话。不得把心理内容加入技能画像或推荐。审核是AI初筛不代表临床判断；未启用真实人工值守/企业EAP时不承诺这些能力。资料依据：WHO AI for health guidance、APA chatbot advisory、NIMH/CDC倾听支持建议，主会话已核对官方来源。
