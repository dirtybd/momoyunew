# 摸摸鱼本地版本 · 接口约定 v1

前端负责 frontend/，后端负责 server/；管理员维护根目录配置、scripts/、docs/与集成测试。Node 24 ESM，后端使用 node:sqlite 持久保存，前端 React + Vite。不部署到公网。

## 请求通则

同源 `/api`，除附件和头像上传使用 multipart/form-data 外均为 JSON请求，cookie登录态（HttpOnly + SameSite）。失败返回 `{error:{code,message}}`，有效HTTP状态码。浏览器不保存Dify密钥。localStorage不作为身份认证。没有Dify密钥时明确使用本地规则；配置密钥后使用真实 Agent，调用失败不假装本地回复来自模型。

## 数据

User = `{id,username,displayName,department,skills:string[],skillDescription:string,availability:string,acceptingHelp:boolean,bio:string,helpPreferences,avatar:string|null,role:'employee'|'admin'}`。skillDescription为明确用于AI匹配的经验说明，最多2000字；旧档案默认为空，不从私人bio迁移。avatar为`/api/avatars/...`地址，无上传时为空。helpPreferences见文末人员匹配接口。
Request = `{id,title,problem,desiredOutcome,deliverables:string[],acceptanceCriteria:string[],materials:string[],constraints:string[],deadline:string|null,skills:string[],rewardPoints:number,anonymous:boolean,visibility:'company'|'private',fallbackToBoard:boolean,source:'employee'|'official',kind:'request'|'announcement'|'bounty',status:'draft'|'open'|'claimed'|'submitted'|'changes_requested'|'completed'|'cancelled',owner:{displayName,department}|null,isMine:boolean,isClaimedByMe:boolean,claimerLabel:string|null,createdAt,updatedAt,isDemo:boolean}`。

公开匿名卡片 owner=null，不返回员工账号/内部ownerId/聊天/原始材料。附件原件只向参与双方提供；未提供的背景原图仅本人可下载，公开封面为去元数据预览图。官方权限由服务端判定，注册/编辑档案不能提权。演示数据标 isDemo=true；不将样例数说成真实平台业绩。

Request 额外返回 `cardStyle`，枚举以 `shared/card-style.mjs` 为准：theme、layout、radius、emphasis、background、shape。旧四、五字段记录读取时补默认值。API 不接受 CSS、图片 URL 或任意 clip-path。

## 认证与档案

- `GET /api/health` → `{ok:true,mode:'local'|'dify',difyConfigured:boolean}`；不泄露密钥。
- `GET /api/session` → `{user:User|null}`。
- `POST /api/auth/register` body `{username,password,displayName,department,skills,availability,acceptingHelp,bio}` → `{user}`；注册和首次建档一体完成。password至少8字符，username唯一。必须注册成功后才显示登录成功。
- `POST /api/auth/login` body `{username,password}` → `{user}`。
- `POST /api/auth/logout` → `{ok:true}`。
- `PUT /api/profile` body `{displayName,department,skills,availability,acceptingHelp,bio,skillDescription,helpPreferences}` → `{user}`；不会改动头像。
- `GET /api/me/profile-overview` → `{user,totalPoints,completedCount,monthPoints,monthCompleted,monthOwners,rank,rankParticipants,recent:[{requestId,title,skills,points,awardedAt}]}`；需要登录。累计与本月数据来自`task_points`，月份按北京时间；只返回最近3条完成记录，不返回对方身份。
- `GET /api/me/points?limit=200&offset=0` → `{items:[...],total,limit,offset}`；需要登录，返回本人的完整互助与积分记录，上限500条。
- `POST /api/profile/avatar` multipart 字段`file` → `{user}`；需要登录。支持PNG/JPG/WebP/GIF，最大5MB，服务端旋转并裁成512×512 WebP，旧头像文件自动删除。
- `DELETE /api/profile/avatar` → `{user}`；需要登录，移除头像并删除文件。
- `GET /api/avatars/:file`：返回头像WebP；文件名由服务端随机生成，可匿名读取，缺失时404。

## 需求和澄清

- `GET /api/requests?source=all|employee|official&q=...` → `{requests:Request[],total}`；匿名可浏览本地演示公屏；仅返回company、已发布需求。
- `GET /api/requests/:id` → `{request}`；草稿/私密需求只有本人能看，无权限返回404。
- `GET /api/me/requests` → `{requests:Request[],claimed:Request[],drafts:Request[],archived:Request[]}`；需要登录。
- `POST /api/clarify` body `{requestId?:string,message:string}` → `{request:Request,messages:{role:'user'|'assistant',content:string}[],reply:string,intent:'help'|'request'|'style',hasCard:boolean,readyForPreview:boolean,mode:'local'|'dify',warnings:string[]}`；需要登录；首次建立draft作为对话ID并保存对话。普通问答 intent=help，不强制生成卡片；样式修改 intent=style；互助需求 intent=request，最多追问两项。有消息或材料的对话均列入本人的 drafts，可通过 conversationTitle 恢复普通办公对话。完全空白的对话不列入。前端仍保留 request.id 以续聊，本地模式明确未调用AI。
- `GET /api/requests/:id/messages` → `{messages:[...]}`；仅本人查看。
- `PATCH /api/requests/:id` body 允许 `{title,problem,desiredOutcome,deliverables,acceptanceCriteria,materials,constraints,deadline,skills,rewardPoints,anonymous,visibility,fallbackToBoard,cardStyle}` → `{request}`；仅本人未移除的 draft/open 可改；open 必须额外 confirmed=true，接取后不能改原需求；严格校验类型和长度。cardStyle 从安全枚举验证，兼容旧版本更新时保留已有背景和形状。source/kind/owner/status/role不接受用户修改。悬赏为1～5整数、默认1，接取后锁定，验收后由平台一次性结算。
- `POST /api/requests/:id/publish` body `{confirmed:true}` → `{request,matches:[],matching:{status,mode,notified},publishedToBoard:boolean}`。明确确认后发布company；private维持draft，返回清晰错误引导修改范围。必须有title/problem/desiredOutcome且有效交付物或完成标准。发布后进入持久匹配队列，异步发送站内推荐；不再在响应返回其他员工身份，不声明站外通知成功。公屏显示受用户明确发布操作约束；fallbackToBoard为后续分发意向，不伪造推送。
- `POST /api/requests/:id/claim` → `{request}`；需要已建档用户。仅open、非本人、非announcement且company可接；并发仅一个接取成功；第二人409。任务详情需显示已接取状态。

## Dify 接入

服务端配置 `DIFY_BASE_URL`、`DIFY_API_KEY`、`DIFY_TIMEOUT_MS`。使用新版 Agent 的 `POST /chat-messages` SSE 接口，按草稿保存远程 conversation_id，远程用户标识为本地账号的不可读 ID。API 不返回远程会话 ID、密钥或模型思考事件。

`/api/clarify` 等待本轮远程生成后统一返回。无配置时 mode=local，有配置时 mode=dify；health 的 mode 表示配置模式，不代表实时探活。Dify 输出只可更新文字和安全样式，无法更改隐私、奖励、来源与状态。远程结果 card=null 时保留原卡片；明确提出样式意图才应用 cardStyle，普通 help 回答不修改样式。

远程认证/格式/断流错误返回 502，连接或限流返回 503，超时返回 504；同草稿并发或等待期间草稿已被修改返回 409。失败不追加伪回复、不覆盖原草稿；用户可保留输入重试。

## 范围

当前完成注册档案→澄清对话→上传/编辑卡片→预览→发布公屏→其他账号接取→下载材料→提交成果→发布者验收/退回修改。官方公告与悬赏以明确标记的本地样例展示，普通账号不得创建官方内容。积分显示意向，不做兑换、支付、验收奖励。站外推送不接，不伪装完成。时间使用ISO存储，前端以Asia/Shanghai显示。

## 启动约定

`npm run dev`同时启动server/index.mjs（127.0.0.1:8787）与Vite（127.0.0.1:5173）。Vite代理/api到8787。`npm run build`生成dist/；`npm start`启动同一后端并服务dist/。后端用`PORT`、`HOST`、`DATA_DIR`环境变量，测试使用临时目录和随机端口。
# 自主卡片与实时对话补充（2026-11-02）

`POST /api/clarify` 请求保持不变；`Accept: text/event-stream` 返回 `event: status`（stage/label）、`event: result`（原 JSON 结果）、`event: error`（message）。默认仍返回 JSON。中断连接会取消本轮上游读取，未完成结果不覆盖草稿。

需求视图新增只读 `cardArtwork`，为空或 `{id,design:{name,paper,ink,accent,accentInk,shape,layout,icons}}`（`icons` 为后端按卡片内容挑选的本地图标名，v2 设计不再返回 `elements`）。不接受通过普通 PATCH 或模型最终 JSON 写入成品。只有本轮工具事件中的已验签结果可更新它。用户明确把上传图片设为背景时，后端保留 `cardCover`，不生成也不覆盖 `cardArtwork`。

`GET /api/requests/:id/artwork.svg` 返回制作工具生成的 SVG。草稿与私密需求只对本人开放，不可见时返回 404；公开需求按现有公屏范围读取。响应为私有不缓存，使用 CSP sandbox 与 nosniff。

工具契约、部署与权限细节见 [DIFY-CARD-TOOL.md](DIFY-CARD-TOOL.md)。

## 上传、交付与卡片管理（2026-11-02）

- `POST /api/requests` body `{}` → `{request}`，建立空草稿，支持先上传再对话。
- `POST /api/requests/:id/attachments`：multipart 单个 `file` → `{attachment,request,materials,pendingFiles,submissions}`。发布者上传材料；接取者仅进行中/退回时上传待提交成果。草稿/待接取图片材料默认 included=false，文档默认 true；接取后补充材料（含图片）默认 true。可选查询参数 `?purpose=cover|reward` 表示图片专用于卡片背景或报酬展示：服务端立即设为对应展示图，并同时关闭 `included` 和 AI 阅读，图片不会作为材料上传给 Dify。
- `PATCH /api/requests/:id/attachments/:fileId` body `{included:boolean}`；`DELETE` 同地址软移除本人附件。原始材料在接取后锁定，已提交成果也锁定；可补充新文件。
- `POST /api/requests/:id/cover` body `{attachmentId:string|null}`：仅本人草稿，选择本需求本人上传图片；null 恢复插画/默认背景。
- 公开卡片 `PATCH /api/requests/:id` 可带 `coverAttachmentId:string|null`，与 confirmed=true 一并确认后更换背景。
- `GET /api/requests/:id/cover`：封面 WebP 预览（无图片时可回退 SVG）。草稿/私密/已移除仅本人可看，公开需求按公屏权限读取。
- `GET /api/attachments/:id` 下载原件；`GET /api/attachments/:id/preview` 读取去元数据预览。未经授权返回404。
- `GET /api/requests/:id/workspace` → `{request,materials,pendingFiles,submissions}`，仅发布者/接取者。pendingFiles 仅接取者自己可见；每个提交包含版本、说明、文件、反馈和决定。
- `POST /api/requests/:id/submit` body `{note,attachmentIds:[]}`，仅接取者。说明或文件至少一项；生成不可改写的提交版本，状态转 submitted。
- `POST /api/requests/:id/review` body `{submissionId,decision:'approve'|'changes_requested',feedback,confirmed}`，仅发布者。退回须写反馈；通过须 confirmed=true。必须验收最新未处理版本，分别转 completed/changes_requested。
- `POST /api/requests/:id/archive` 或 `/restore` body `{confirmed:true}`，仅本人未接取 draft/open；软移除可从 archived 恢复。已接取任务保留协作记录。

Request 增加 `cardCover`、本人 `selectedCoverId`、`materialFileCount`、参与者 `materialFiles`、操作标志 canEdit/canArchive/canSubmit/canReview，移除后有 deletedAt。未参与用户只获得附件计数，不获得下载权限。

单文件50MB，个人原件合计1GB（包括软移除文件）；每需求最多100个材料、本次成果最多20个。文件类型与备份规则见 [文件交付说明](FILE-DELIVERY.md)。Dify 接收附件元数据；选中AI阅读的材料通过原生文件接口传入内容，选择背景返回 coverAttachmentId。暂无照片生图、站外推送或积分结算。Agent生成的结果通过下述私人文件接口回传。


## AI材料阅读（2026-11-02）

附件视图增加 `aiReadable:boolean`、`aiEnabled:boolean`；旧记录迁移时默认为 false，新上传本人草稿的可读材料默认 true。`PATCH /api/requests/:id/attachments/:fileId` 可传 `{aiEnabled:boolean}`，与 included 分开校验。仅本人草稿可设置AI阅读；当前背景不能同时开启阅读。设为背景会关闭阅读，移除背景后须手动重新开启。

`POST /api/clarify` 请求不变，服务端仅选本人当前草稿 aiEnabled 的材料；本轮最多10个，文档最多50MB，图片预览最多10MB，合计最多100MB。新上传超出10个的附件保留但不自动启用，手动启用超限返回AI_FILE_LIMIT。先以同一 `momoyu-<user-id>` 上传到Dify `/files/upload`，再通过 `files:[{type,transfer_method:'local_file',upload_file_id}]` 发给 `/chat-messages`。引用缓存按附件、密钥/地址scope、用户三重隔离，缓存不返回网页。Dify更换应用配置后自动使用新scope。所有输入读取完成后才发起模型请求；数量、大小或上游失败不追加消息，不覆盖草稿。

明确上传背景指令不向模型传入图片内容；“根据截图内容整理卡片”不构成背景授权，模型未获授权返回的coverAttachmentId被忽略。当前已选背景也不参与阅读。材料、背景及仅交付附件的用途会写入提示词。取消阅读仅限制未来传入，不能收回当前Dify会话中已读取的内容。卡片分支默认只接收文件名、附件信息和本地生成的 `attachmentDigests` 摘要（文本/Word/PPT/Excel 最多240字，图片只给尺寸，视频和二进制不给内容），后端不上传附件字节；只有用户明确要求查看、读取、分析、翻译或核对附件内容时才放行文件并通过卡片工具的 `materials` 传入。需要按内容生成译文或文件时由办公文件助手处理。

可读类型当前为图片、PDF、DOC/DOCX、XLS/XLSX、PPT/PPTX、TXT/CSV/MD/JSON/XML。格式解析与视觉能力依赖Dify配置；加密、扫描和模糊材料应明确报告限制。既有SVG制卡与任务交付权限保持独立。

## AI办公结果文件（2026-11-02）

`GET /api/requests/:id/messages` 与 `/api/clarify` 的 `messages` 中，助手消息可带 `files: Attachment[]`，每项含 id/name/size/mime/downloadUrl。无结果时省略 files。`GET /api/attachments/:id` 下载仅本人有权读取的结果，其他账号及游客返回404；任务接取者也不自动获得私人AI结果。用户可自行下载后作为任务材料上传。

`/api/clarify` 在调用 Dify 前先用 `server/translation-routing.mjs` 区分翻译任务：含 `User Texts` 工作表且至少两个可编辑语言列的 XLSX 是 `project-text`；Word、PDF、TXT、Markdown、PPT、普通 XLSX 是 `document`；无附件是 `text`；附件不可翻译是 `unsupported`。只有用户明确要求翻译（如“翻译成英文”“目标语言：de-DE”“把第 3 段翻译一下”）才进入翻译流程，卡片/协作/审阅措辞优先。`document`、`text` 和 `unsupported` 强制走办公文件助手；`project-text` 仍由后端直接调用工作流，按语言列只填空单元格，已有译文和 `*` 参考列不动，结果写回 XLSX 副本并通过 `messages[].files` 返回。目标语言优先取用户消息；未说明时按表头推断，恰好一个可编辑列仍有空单元格时使用该列，多个空列时列出表头并追问。同时有项目文本和其他文档时项目文本优先，回复会注明其余文件未按列写回。工作流配置见 `DIFY_TRANSLATION_BASE_URL`、`DIFY_TRANSLATION_API_KEY`。

消息以 `/电气` 或 `/电气专家` 开头时，后端直接调用电气专家 Agent，跳过统一入口的任务分发；`/电气` 现在是电气问答和知识库入口，翻译任务若没有项目文本工作簿会转交办公文件助手。`/办公`、`/卡片` 会通过 `forceRoute` 强制进入统一 Chatflow 的办公/卡片分支；本地还会把明确的卡片/求助措辞强制到卡片分支、把明确翻译措辞强制到办公分支。命令说明只显示在 `/` 菜单，不写入对话正文。配置见 `DIFY_ELECTRICAL_BASE_URL`、`DIFY_ELECTRICAL_API_KEY`。

结果仅从实际 `agent_thought` 工具事件里的 public_download_url 收集，最终回复中的链接不作为文件凭据。服务端固定Dify下载主机、禁止重定向、检查签名参数、文件头和本轮随机前缀，再复制到本地私人存储；不向网页返回上游签名或内部引用。每轮最多5份、单份20MB、合计50MB；计入本人250MB空间。

结果另存，旧版本保留。消息、附件记录在同一事务提交，失败回滚暂存文件；并发修改与停止不覆盖原对话。本对话最近8份结果的内部引用用于后续修改，不跨用户/需求传递。输入图片即使模型已有视觉内容，也提供本轮实际上传记录的原生下载引用供沙箱处理；included只控制双方共享，不控制AI阅读。

## 人员匹配、空闲时间与站内消息（2026-11-03）

注册及PUT profile可选新增 `helpPreferences:{weekdays:number[],start:'HH:mm',end:'HH:mm',weeklyMinutes:number,maxActive:number,notifications:boolean}`，必须整对象提交。weekdays为1周一至7周日、不重复；start/end为北京时间同一天，end必须晚于start；weeklyMinutes=0..2400（0暂停），maxActive=1..20。旧档案默认 `{weekdays:[],start:'12:00',end:'13:00',weeklyMinutes:60,maxActive:2,notifications:true}`；未指定日期不推断具体空闲时段。原availability是协商说明；acceptingHelp=false或notifications=false不再接收新推荐。

- `GET /api/notifications?cursor=<rowid>`：需登录，返回`{items:[{id,requestId,title,reason,status,available,createdAt,readAt}],unread,nextCursor}`，每页30条，只能取本人消息。未读数为本人总数。已不再公开的需求仅返回失效说明。cursor由上页nextCursor提供。
- `POST /api/notifications/:id/read` body `{}`：需登录，只标记本人此条消息；不存在/不属于本人也返回`{ok:true}`避免探测。
- `POST /api/notifications/read-all` body `{}`：需登录，标记本人全部消息已读。
- 本人需求视图可带`matching:{status:'pending'|'running'|'done',mode:'dify'|'local'|null,notified:number}`。此为真实队列状态与累计发送人数；处理未完成不能宣称已送达。公开接口不提供候选员工身份或推送名单。
- `POST /api/internal/match-preview` 供本机Dify工具网关调用，body `{match_token,card_json}`，不使用用户自由指定的人员ID或查询条件。10分钟HMAC凭证绑定本人当前草稿；card_json含`title,skills,deadline`，可选`problem,desiredOutcome,deliverables`。返回`{count,timeUnconfirmed,mode,sent:false,summary}`，不写消息/发布状态。心情及紧急会话不允许预匹配。无凭证或跨范围403，非法摘要400。

`POST /api/clarify`已向Agent提供本轮match_token，制卡准备好时调用preview_matches。后台发布和15分钟定时补查使用同一匹配Workflow。当前已有服务启动的5秒重试tick与15分钟补查，无隐藏聊天。站内页面15秒自动拉取，非系统通知。每人每日最多3条，同人同需求不重复、单轮最多5人；失败保留任务重试。详见[MATCHING.md](MATCHING.md)。

## 情绪支持与摸鱼空间（2026-11-03）

`POST /api/clarify`的intent新增`care`，返回`careSafety:'support'|'urgent'`和`carePreview:{title,content}|null`。这些字段及careMode只出现在本人私密草稿，不进入其他员工的任务视图。一般倾听无预览；明确要求公开才生成，仍未发布。urgent预览恒为null，该对话禁止两种公开发布。help/request可回办公，但不能清除该会话已有风险公开限制。

以下接口全部需登录。帖子与留言对同事隐藏作者ID和姓名；匿名不意味着系统不保存内部归属。

- `GET /api/care/posts?cursor=<rowid>` → `{items,nextCursor}`，20条/页。
- `GET /api/care/posts/:id` → `{post}`，含id/title/content/createdAt/updatedAt/anonymous/isMine/commentsEnabled/commentCount。
- `POST /api/care/posts` body `{title,content,conversationId?,commentsEnabled?,confirmed:true}`，标题1–120字、内容1–1500字。若提供conversationId，须为本人未移除私密草稿；审核前后都复核权限与风险状态。仅待发布文字送AI审核。
- `PATCH /api/care/posts/:id` body `{title?,content?,commentsEnabled?,confirmed:true}`，仅作者；改文字须重新审核，并发变化返回409。单改留言开关无需模型审核。
- `POST /api/care/posts/:id/archive` body `{confirmed:true}`，仅作者，软移除并停止公开。
- `GET /api/care/posts/:id/comments?cursor=<rowid>` → `{items,nextCursor}`，20条/页。留言含id/content/authorLabel/isMine/canRemove/createdAt，不含作者ID。
- `POST /api/care/posts/:id/comments` body `{content}`，1–500字，先审核并复核帖子未移除、留言未关闭。
- `POST /api/care/comments/:id/remove` body `{confirmed:true}`，留言本人或帖子作者可软移除。
- `POST /api/care/comments/:id/report` body `{reason}`，必填1–300字；同人同留言去重，返回`{ok:true,status:'pending'}`，没有即时人工响应承诺。

每用户每分钟最多5次发帖/改文尝试及5次留言尝试，失败也计数。审核拒绝或紧迫风险返回422，未配置/故障/格式无效返回503 CARE_REVIEW_UNAVAILABLE，均不写入公开内容。摸鱼空间不调用任务接取、人员推荐或积分流程。详见[CARE.md](CARE.md)。


2026-11-06 增补：

- `GET/POST /api/admin/official/media`：管理员自己的待发布图片列表/单文件multipart上传，响应`media:{id,url,width,height,size}`；`DELETE /api/admin/official/media/:id`仅本人未绑定图片。`GET/HEAD /api/official/media/:id`按暂存/发布状态鉴权。官方POST/PATCH接受`cardStyle`、`coverMediaId`，返回`coverUrl`，公屏摘要返回`cardCover.url`。
- 视频材料/成果仍用原attachments端点，增加`isVideo/aiReadable/playbackUrl`；`GET/HEAD /api/attachments/:id/play`与下载共享参与者授权，支持Range。视频不能打开AI阅读或作为卡片背景。
- care媒体上传仍用`/api/care/media`，支持MP4/WebM/MOV，`photos`项目增加`kind:'image'|'video'`；GET/HEAD视频支持Range。
- `PATCH /api/admin/users/:id`增加`muted:boolean`；用户列表增加`muted/deletedAt`。`POST /api/admin/users/:id/archive|restore`须`{confirmed:true}`；恢复不启用登录。
- `POST /api/admin/content/posts|comments/:id/archive|restore`须`{confirmed:true,reason?:string}`，审计并软删除/恢复。`GET /api/admin/content?type=posts|comments&removed=true`列出已删除内容。


2026-11-06 点赞、五分悬赏、难度与名额：

- `PUT /api/care/posts/:id/like {liked:boolean}`：幂等设置本人点赞，返回`{post}`；post增加`likeCount`和`liked`。移除/下架内容不可点赞，不返回点赞人名单。
- `GET /api/me/task-limits`：本人`publishing:{used,limit:5}`、`claiming:{used,limit:3}`。发布、接取和恢复公开卡在服务端事务内核验，公告与草稿不计，进行/待验收/退回修改占名额。
- 需求摘要增加`difficulty:{status:'pending'|'scored'|'unavailable',score:null|1..5,reason:string}`及`awardedPoints:null|number`。新卡`rewardPoints`严格1～5整数、默认1，`rewardPolicy`由服务端赋值、客户端不能写。
- 现有`review`接口approve时在同一事务写积分流水，request_id唯一，重复验收/旧提交不重复给分；changes_requested须反馈并保留版本。完成后本人可archive，积分和双方workspace保留，接取者不能restore。
- `GET /api/leaderboard?period=month|all`：登录后查看；返回`{period,items:[{rank,userId,displayName,department,points,completedCount,difficultyTotal}],me,totalParticipants}`，最多前100人且另含本人记录，不返回任务ID/私密资料。月份按北京时间，奖励同分按完成数与难度累计排，相同指标并列。


### 2026-11-13 对话附件与本地文档翻译

POST /api/clarify新增可选attachmentIds:string[]，最多100个且唯一，必须是本任务本人上传的material，背景/报酬图不能作为本轮新材料。空数组表示没有新增附件，已成功发送的授权引用仍可用于续问；省略为兼容旧客户端。messages中user条目可有attachments快照，待发送附件不属于任何已发消息；删除后快照标为unavailable。失败/取消不写入新消息/递送标记。

完整DOCX/XLSX/文字PDF翻译优先走后端提取及写回，返回仍是assistant消息files私人下载。模型仅接受document_payload_json分批文字，格式及限制见DOCUMENT-TRANSLATION.md。

新上传附件默认开启独立材料范围，续问延续当前任务；明确点名旧文件、补充或对比时可使用相关旧材料。原件与旧成果保留，不默认合并所有已发附件。只读内容概览后端提取文本并经Chatflow快速问答，失败、截断和支持范围见DOCUMENT-TRANSLATION.md。

原生文件Agent路径：office_text包含本轮inputs、outputHistory和output_prefix，经办公Workflow工具的task_json直接交给Agent；原件下载、编辑、回读、上传仍在Dify执行。dify-file-ref统一采用带填充URL-safe Base64，旧引用续改时规范化；输出仍复制到本机私有存储并鉴权下载。修改办公Workflow发布版本后须同步工作流工具，避免网页执行缓存旧版。

卡片分支已改为Dify文档提取→LLM→字段校验，原卡片Agent保留回退。统一入口新增可选card_materials（当前任务授权文档引用，最多5份），子工作流每轮复用缓存引用，父会话不重复挂载已递送文件，不上传历史任务文件。included与aiEnabled独立，禁止读取、仅保存、背景图片及当前无能力理解的图片/视频不进入文档提取。卡片显式deadline:null会清空旧日期。范围与实测见CARD-ASSISTANT-2026-11-13.md。
