# CLAUDE.md

本文件只适用于 `D:\AI\momoyuDify` 及其子目录。不要把它复制到 `D:\AI\momoyu` 或其他项目。

## 项目定位

- 本目录是 `D:\AI\momoyu` 的独立副本，用于接入目标 Dify「同频」工作空间。
- 本目录已于 2026-11-09 初始化独立 git 仓库（分支 `main`），用于本地回退；不要把它推送到原仓库。`.env`、`data/`、`work/`、`dist/`、`node_modules/` 不纳入版本管理。
- 部署与迁移的权威说明：`迁移事项.md`
- 同步过程、工具绑定和验证记录：`work/dify-sync/`

## 当前配置

- 目标 Dify：`http://10.37.26.37`，工作空间 `同频`
- 本机端口：前端 `5174`、后端 `8788`、制卡/匹配 `8798`
- 原项目使用 `5173 / 8787 / 8792`，不要改回这些端口，避免冲突
- `.env` 保存目标 Dify 的服务 API Key，已在 `.gitignore` 中
- `DIFY_ENTRYPOINT=chatflow`
- `DIFY_API_KEY` 为空：旧「摸摸鱼」Agent 已移除，legacy 回退不可用
- `ARCHIVE_RETENTION_DAYS=7`：已移除的 Agent 对话/草稿保留 7 天后自动删除；验收完成后卡片自动下架，已完成任务和积分记录不自动删除
- `DIFY_TRANSLATION_API_KEY`：电气项目文本翻译工作流的服务端 Key，只放在本机 `.env`；未配置时项目文本文件不会被送去普通文档翻译
- `DIFY_ELECTRICAL_API_KEY`：电气专家 Agent 的服务端 Key，用于统一入口的 `/电气` 命令；也只放在本机 `.env`
- 模型：普通 LLM 节点和电气翻译工作流使用 `langgenius/openai_api_compatible / 电研-qwen3.8-27b`；卡片 Agent 和办公 Agent 使用同 provider 的 `集团-deepseek-v4-flash-不可联网`（qwen 在 Agent 模式会被网关路由到不存在的 `Qwen3.5-122B-A10B-w8a8-mtp`，见「待办与迁移」）

启动：

```powershell
cd D:\AI\momoyuDify
npm run dev
```

健康检查：

- 后端：`http://127.0.0.1:8788/api/health`
- 制卡工具：`http://127.0.0.1:8798/health`

同一内网访问：前端监听 `0.0.0.0:5174`（`MOMOYU_HOST` 可覆盖），启动时终端会打印本机内网地址；后端仍只监听 `127.0.0.1:8788`，通过 Vite 代理访问。防火墙规则用 `scripts/lan-access.ps1` 添加/删除（入站 TCP 5174，限本地子网）。

## Dify 绑定

- 自定义 API 工具：`design_card`、`preview_matches` 保留在 `同频`，地址为 `http://10.11.86.2:8798`；卡片 Agent 已不再调用它们。`recommend_agents` 已于 2026-11-09 清理（删除前确认无绑定）
- 设计/预匹配现在由后端完成：卡片 Agent 只填内容，只返回 `reply`、`card` 和可选的 `cardStyle`/`coverAttachmentId`，不返回 `intent`、`readyForPreview`、`design`、图标或配色；`server/dify.mjs` 的 `parseDifyAnswer` 按路由补全 `intent`，按卡片完整性推断 `readyForPreview`，省略字段沿用当前草稿或补默认值。卡片首次可预览且没有上传背景时，后端用 `autoCardDesign` 按标题/问题/技能挑配色，再由 `server/card-design.mjs` 生成 SVG；卡片可预览后后端调用 `matching.preview` 计算匿名预匹配。`design` v2（`name/paper/accent/sky/shape/layout`）和 v3（`objects`）协议仍保留给显式设计、重放校验和旧快照；旧的 `elements` v1 也兼容。用户明确把上传图片设为背景时，模型返回 `coverAttachmentId`，后端保留 `cardCover`、不生成插画
- 工作流工具：`momoyu_card`、`momoyu_office`、`document_visual_review`、`document_plan`、`document_content_review`、`document_edit_plan`
- 统一对话入口节点：`office` → `momoyu_office`，`card` → `momoyu_card`
- 卡片工作流为 `start → document-extractor → 卡片 Agent`：任务上下文先转成文本再注入任务说明，Agent 不再读取 `context_file`；卡片 Agent 只绑定合并后的 `requirement-card` 技能（2026-11-11 合并，旧三技能已删除），源文件在 `docs/dify-config/requirement-card/SKILL.md`
- 制卡默认只传文件名和摘要，明确要求读内容时才传附件：`server/dify.mjs` 的 `cardMaterialPolicy` 默认返回 `names-only`、`passFiles=false`；只有用户明确要求查看/读取/分析/翻译/核对附件内容时才返回 `read` 并放行文件（上传图片作背景但未要求读取时仍不传）。`forceRoute=card` 且 `names-only` 时后端既不把文件传给 Dify，也不上传附件字节；`context.attachmentDigests` 由 `server/attachment-digest.mjs` 在本地生成（txt/docx/pptx/xlsx 最多 240 字，图片只给尺寸，视频和二进制不给内容），再配合 `projectTextWorkbooks`、附件名称和类型供卡片 Agent 使用。统一 Chatflow 的卡片工具节点保留 `materials: sys.files`，但只有后端放行文件时才有内容。需要按内容翻译/分析/核对且不想放行给卡片助手时，由办公文件助手处理。办公/文档 Agent 的常规文件解读不受影响
- `card` 节点必须保持 Agent 工作流工具，不要改成普通 LLM 节点；普通 LLM 节点会丢失 Agent Skill、文件读取和工具调用能力
- 本地 `server/intent-routing.mjs` 对明确的卡片/求助措辞（如“设计一张求助卡”“设计求助需求”“找人帮忙审阅”）直接设 `forceRoute=card`，避免分类器把卡片需求误判成办公任务或电气翻译；明确翻译措辞会设 `forceRoute=office`，`suggestedRoute` 同时为 `office`。Chatflow 还会用 `forceRoute`/`suggestedRoute` 覆盖 `office`、`office_chat` 和 `electrical` 的分类结果，其他消息仍由分类器判断
- 具体工具 ID 和应用 ID 见 `work/dify-sync/TOOL-BINDING-REPORT.md`

以上绑定均已保存并发布；除非明确要求，不要重建应用或工具，优先更新现有绑定。

## 卡片图标素材库

- 素材来源 Lucide（`https://github.com/lucide-icons/lucide`，ISC），已导出到 `assets/icons/catalog.json`（2350 个图标，24×24 viewBox，圆头线条），运行时不再访问网络；许可说明见 `assets/icons/LICENSES.md` 和 `LUCIDE-LICENSE.txt`。
- `server/card-icons.mjs`：加载素材库、按卡片标题/问题/技能匹配 `assets/icons/keywords.json` 的关键词、渲染图标 SVG（内联 `<g>`，不引用外部文件）。封面构图固定为「左侧纸色大圆主图标 + 中间纸色低透明度小贴纸 + 右侧强调色大圆徽章」；不足 3 个图标时自动省略贴纸，只剩 1 个时用三个圆点补位。
- `server/card-design.mjs`：`design` v2 为 `{name,paper,accent,sky,shape,layout,icons?}`，可省略 `elements`；未给 `icons` 时后端自动挑 1–3 个，输出 1200×400 封面。artifact v1（elements）和 v2（icons）都可通过验签。
- 重建素材库：先把 `lucide-static` 解压到 `work/icon-src/lucide`（命令见 `scripts/build-icon-catalog.mjs` 顶部），再执行 `npm run icons:build`；脚本会校验 `keywords.json` 里的图标名是否都存在。预览：`npm run icons:preview`，输出到 `work/icon-prototype/`。
- 改动图标选择逻辑时同步更新 `server-tests/card-icons.test.mjs`；不要手改 `catalog.json`，重新生成。

## 手绘卡片封面（试验）

- `server/card-sketch.mjs` 使用 Rough.js（MIT）把受控的「场景对象」渲染成手绘线稿：`document`、`cabinet`、`magnifier`、`badge`、`cup`、`speech`、`globe`、`presentation`、`book`、`chart`、`folder`、`person`、`arrow`、`plant`、`sparkle`。只接受这些对象和数值，不执行模型代码。
- 场景为 `design` v3：`{name,paper,accent,sky,shape,layout,background?,objects:[...]}`，1–14 个对象；固定 seed，签名后重放渲染完全一致；artifact v3 与 v1/v2 兼容。
- `background` 可选 `hills`、`mountains`、`sea`、`forest`、`city`、`industrial`、`fields`：包含渐变天空、太阳、云、山/海/城市/厂房/风车、鸟和前景桌面。`planSketch` 会按卡片类型自动选：电气→厂房，翻译→海景，培训→树林，数据→田野，协作→城市，审阅→山脉。前景统一落在桌面线附近，放大镜和徽章压住主体边缘，协作场景人物落在地面并重组对话气泡。
- 默认封面使用下面的分类照片背景。卡片 Agent 不返回 `design` 时，后端不再自动生成 SVG 图标封面；仅当设置 `CARD_COVER_STYLE=icon` 或 `sketch` 时，`autoCardDesign` 才会生成图标或手绘场景封面（试验/旧数据重放用），不设置时保持照片背景。
- 预览：`npm run sketch:preview`，输出到 `work/icon-prototype/sketch/`（含 320×74 缩略图）。
- 卡片 Agent 当前不返回 `objects`；若以后要模型直接编排场景，先与【前后端】协调提示词与快照。测试见 `server-tests/card-sketch.test.mjs`。
- 需求卡照片背景库：`frontend/public/card-backgrounds/` 下 18 张 1200×400 PNG，对应枚举 `general`、`translate`、`review`、`safety`、`electrical`、`it`、`hr`、`finance`、`procurement`、`training`、`meeting`、`design`、`support`、`legal`、`kb`、`data`、`docs`、`promo`；分类、关键词和旧 id 别名集中在 `shared/card-backgrounds.mjs`。卡片内容按「翻译/审阅 → 安全 → 领域」的顺序匹配关键词，匹配不到用 `general`（通用互助）；旧 id `mountain`/`coast`/`meme` 继续映射到 `general`/`review`/`translate`。后端在 Dify 返回需求卡后自动挑选背景，用户手动改过背景或上传了封面图则不覆盖。源图在 `work/photo/`，由 `work/photo-categories.mjs` 裁切压缩；`mountain.png`/`coast.png`/`meme.png` 仍供摸鱼空间演示图使用，不要覆盖。改背景图时同步 `shared/card-backgrounds.mjs`、`frontend/src/style.css`、`BoardCards.coverUrl` 和样式选择器；测试见 `server-tests/card-backgrounds.test.mjs`。
- 卡片工作室上传背景/报酬图时带 `?purpose=cover|reward`；`server/task-workflow.mjs` 立即把它设为展示图，并关闭 `included` 和 AI 阅读，避免与普通材料一起上传给 Dify。普通聊天上传的图片仍需显式说“用作背景”才走 `uploadedBackgroundRequested` 的背景分支。

## 翻译任务与电气项目文本

- 所有翻译任务默认归办公文件助手（统一入口 `office` 分支 / `momoyu_office`）：普通 Word/PDF/TXT/Markdown/PPT/普通 XLSX 的整篇或按指定范围翻译，由办公助手读取文件并交付译文副本；纯文字翻译也走该入口。`server/intent-routing.mjs` 的 `suggestRoute` 对明确翻译措辞返回 `office`，`server/index.mjs` 同时设 `forceRoute=office`。明确卡片/协作措辞仍优先。电气专家也保留博图/TIA 项目文本翻译能力，见下一条。
- 文件类型先于路由区分：`server/translation-routing.mjs` 的 `classifyTranslationTask` 把本轮分成 `project-text`（含 `User Texts` 的 `.xlsx/.xlsm`）、`document`（普通可翻译文档）、`text`（无附件）、`unsupported`（附件不可翻译）和 `none`（未明确要求翻译）；`translationScope` 再区分 `whole`（整篇/全文/逐段）和 `requested`（只翻第几段/指定列/按术语）。摘要通过 `translation` 字段写入 Dify 上下文，不传文件字节。
- 博图/TIA 项目文本仍由后端直接调用翻译工作流，不交给 Agent 读文件：`.xlsx/.xlsm` 含 `User Texts` 工作表、用户明确要求翻译、至少两个可编辑语言列。只翻译目标语言列中为空的单元格；已有译文不覆盖，参考列（`*`）不写入；结果写回 XLSX 副本并作为附件返回。同时有其他文档时，项目文本优先，回复会注明其余文件未按列写回。
- 工作流应用：`摸摸鱼·电气项目文本翻译`（`f8786866-073a-4146-a6e3-1e9950b4d991`），服务 API Key 存于 `.env` 的 `DIFY_TRANSLATION_API_KEY`。工作流工具 `electrical_translation`（`b2d0bddf-32f0-4608-8512-80d352e3f8c7`）只接收 `payload_json`，工作流本身单批最多 24 条、12000 字，翻译后二次审校并保护 `%I0.0`、`Q0.1`、`%DB`、`#Var`、`{{...}}` 等标记；办公/电气 Agent 提示词要求按 12 条、6000 字符分批，超时再减半重试。该工具同时绑定在 `摸摸鱼·办公助手`（快照 `01a1d2a5-f8be-76db-ad07-e36f369c9b7d`）和 `摸摸鱼·电气专家`（快照 `01a1d2a5-0647-74fa-b5a9-aebee03d20c8`）。
- 办公 Agent 的翻译优先顺序：先看文件结构——`.xlsx/.xlsm` 含 `User Texts` 工作表或语言表头就是项目文本，即使 `translation.mode=document`、`projectTextWorkbooks` 为空也只能用 `electrical_translation`，禁止用 `office-file-work` 整表翻译；普通文档才用 `office-file-work`；纯文本直接翻译。提示词源文件 `docs/dify-config/office-agent-prompt.txt`。
- 电气知识库问答：应用 `摸摸鱼·电气知识库问答`（`dbb12404-802a-4c78-b48d-83deb79c2b21`），检索「常见问题」（`d75692de-76c7-4836-bfc4-efb45fe00177`）和「变频器故障处理」（`1d1e78f7-2b0b-41a8-a993-d58fd15b53e9`），返回 `answer`；工作流工具 `electrical_knowledge`（`fed95159-f5e8-4194-8946-0e5d84096282`），参数只有 `query`。提示词源文件 `docs/dify-config/electrical-agent-prompt.txt`，已改为把翻译转交办公文件助手。
- 统一会话输入 `/电气` 或 `/电气专家` 时，后端直接调用电气专家 Agent，对话按 `electrical` scope 单独保存。若 `/电气` 后是翻译请求且没有项目文本工作簿，后端改走办公分支；有项目文本工作簿则仍走本地按列翻译。输入框键入 `/` 会出现命令菜单，未选择命令的普通对话仍走统一入口。
- 统一 Chatflow 已有 `electrical` 分支，节点是 `roster_agent` 绑定的「摸摸鱼·电气专家」（Agent ID `01a1c474-578c-7231-b39a-77fdcc106678`，快照 `01a1d2a5-0647-74fa-b5a9-aebee03d20c8`），**不是 LLM 节点**；普通电气文字问题由分类器进入该分支。
- `/办公`、`/卡片` 命令通过 `route_context.forceRoute` 强制进入 Chatflow 的 office/card 分支；命令说明只显示在 `/` 菜单，不写入对话正文。
- 目标语言优先取用户说明；未说明时按表头推断：恰好一个可编辑列仍有空单元格且其他列有原文时，该列即目标列；多个空列时列出表头并追问，不猜测。卡片/办公 Agent 也会收到后端读取的 `projectTextWorkbooks`；办公 Agent 还收到 `translation`（mode/scope/文件名）。
- 翻译 Skill：`docs/dify-skills/translation-work/SKILL.md`（打包 `translation-work.zip`），区分项目文本按列补译、普通文档整篇翻译、普通文档按要求局部翻译、纯文本翻译，并规定术语、占位符、交付和失败边界。办公 Agent 提示词源文件 `docs/dify-config/office-agent-prompt.txt`。
- 实现：`server/translation-routing.mjs`（文件类型与范围识别）、`server/project-texts.mjs`（识别/解析/写回）、`server/electrical-translation.mjs`（语言识别、批处理、调用工作流）；单元测试 `server-tests/translation-routing.test.mjs`、`server-tests/project-text.test.mjs`、`server-tests/intent-routing.test.mjs`。

## 站内智能体推荐

- 数据源：`http://10.37.26.35:5173` 的公开目录 `GET /api/v1/products`（匿名可读，只取 `AGENT_API`）。
- 后端：`server/agent-catalog.mjs` 缓存目录到 `data/agent-catalog.json`，AI 办公回复无法完成或用户主动询问时，在 `/api/clarify` 响应和消息中附加 `recommendations`。
- 前端：`frontend/src/Recommendations.jsx`，由 `AssistantConversation.jsx` 渲染卡片，链接到门户 `/agents/{productId}`。
- Dify 不参与推荐实现：`recommend_agents` 已从「同频」清理（删除前确认无绑定）。本机 `scripts/card-tool.mjs` 的 `/recommend-agents` 仅保留为本地调试接口，不会创建 Dify 对象。
- **当前决定：推荐功能不使用 Dify 实现。** 目录抓取、检索和卡片注入全部在后端完成。
- 详细说明：`work/agent-recommendations.md`。

## 站内改进意见

- 入口：`站内消息` 第三个标签「改进意见」；员工提交并查看自己的意见，管理员查看全部、未读和已读。
- 后端：`server/feedback.mjs`（`/api/feedback`、已读接口、管理员通知）；`server/mailer.mjs`（SMTP 邮件）。
- 管理员私信：反馈会写入管理员的 `notifications`（type=`feedback`）并显示在站内消息未读徽标中，不经过 Dify。
- 钉钉：配置 `FEEDBACK_DINGTALK_WEBHOOK`（加签时再配 `FEEDBACK_DINGTALK_SECRET`）后，反馈提交时由本地后端直接发送钉钉群文本消息；不经过 Dify。实际 webhook 已验证发送成功。
- 邮件：默认收件人 `gdirtybd@gmail.com`；配置 `FEEDBACK_SMTP_*` 后发送。未配置 SMTP 时意见仍保存并进入管理员站内消息，状态为“未配置邮件”。不要把 Gmail 登录密码写入仓库，使用应用专用密码或企业 SMTP。
- 前端：`frontend/src/InboxFeedback.jsx`、`InboxFeedback.css`、`Inbox.jsx`；切换标签时保持标签栏位置稳定，仅在标签栏滚出视口时平滑滚回。
- 详细说明：`迁移事项.md` 第七节。

## 待办与迁移

- **翻译能力改绑已完成（2026-11-12，2026-11-13 调整）**：线上「同频」已把 `electrical_translation` 绑定到 `摸摸鱼·办公助手` Agent、上传 `translation-work` 技能、同步办公/电气提示词，并修正统一 Chatflow 路由对 `forceRoute`/`suggestedRoute` 的处理后重新发布。2026-11-13 又按“项目文本结构优先”重写办公提示词（12 条/6000 字符分批，超时减半）、更新 `translation-work` 技能，并让电气专家重新绑定 `electrical_translation`、保留项目文本翻译能力且把 Chatflow 电气节点指向新快照。报告和备份在 `work/dify-sync/backup-translation-owner-2026-11-12/`、`backup-electrical-translation-2026-11-13/` 等目录；重跑脚本用 `apply-translation-owner.mjs`、`apply-electrical-translation.mjs`、`sync-office-prompt.mjs`、`sync-translation-skill.mjs`。控制台凭据用 `.env` 的 `DIFY_CONSOLE_*`（为空回退 `DST_*`），密码含 `#` 时脚本按文件原文读取；不要用服务 API Key 代替控制台登录，也不要打印密钥。
- **模型网关阻塞（qwen Agent 模式）**：目标 Dify 的 `电研-qwen3.8-27b` 在普通 LLM 节点可用，但 Agent 模式调用上游返回
  `The model Qwen3.5-122B-A10B-w8a8-mtp does not exist`（404），或表现为 `504 stream timeout`。需要网关管理员修复模型路由或部署该模型；这不是本项目代码问题。卡片/办公 Agent 已于 2026-11-11 切到 `集团-deepseek-v4-flash-不可联网`，制卡已恢复；除非网关修复，不要把这两个 Agent 切回 qwen。纯文字 qwen 节点和电气翻译工作流不受影响。deepseek Agent 输出较慢（带插画的卡片约 2–8 分钟），之后由 design v2 让后端按本地图标素材生成插画，减少模型输出 token。
- 目标 Dify 的 SSRF 放行（`SSRF_PROXY_ALLOW_PRIVATE_IPS=10.11.86.2/32`）只在使用 `design_card`/`preview_matches` 自定义工具时还需要；当前卡片 Agent 和后端推荐注入都不走这条路径。
- 本机 IP 变化或迁移到其他服务器时：
  - 设计/预匹配不需要改 Dify 工具地址
  - 如果仍要手动使用两个自定义 API 工具，只修改它们的 `servers[0].url`
  - 电气项目文本翻译只需要保留 `DIFY_TRANSLATION_BASE_URL` 和 `DIFY_TRANSLATION_API_KEY`；工作流和 Agent 不需要重建
  - Agent 和工作流工具绑定不需要重建
  - 详细步骤见 `迁移事项.md`

## 修改约定

1. 改动 Dify 前先确认当前工作空间是「同频」。
2. 不要创建第二个同名应用或工具；优先更新现有对象。
3. 修改工作流模型并重新发布后，要重新同步六个工作流工具版本：
   ```powershell
   node work/dify-sync/resync-workflow-tools.mjs
   ```
   该脚本需要 `DST_BASE`、`DST_EMAIL`、`DST_PASSWORD` 环境变量。
4. 不要把 Dify 密码、服务 API Key 写入代码、文档、提交或输出；只通过环境变量传递。
5. 不要修改 `work/dify-sync/export/`、`manifest.json` 等同步依据，除非任务明确要求重新导出。
6. 源项目 `D:\AI\momoyu` 只读；需要对照时复制内容，不要直接改源目录。
