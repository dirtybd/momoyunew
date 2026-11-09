# Dify 文档质量能力交接

更新时间：2026-11-03

当前状态：四个文档工具与自建质量Skill已发布；一页合成双语Word经网页生成、内容检查、真实渲染、图片检查、私人下载、同对话修订及旧版保留验收通过。下方按实施过程记录历史状态，以最后更新为准。两页样例已验证生成/渲染/看图，完整网页任务曾超时，不能等同于两页端到端交付已验收。PPT-MASTER未安装。

## 已导入工作流

- 文档设计规划：应用 `7fd93777-088f-4291-83f3-16896effb3a3`，已导入、未发布。合成双语资料表测试结构返回成功，但模型自行推断“因公出行”、添加未要求的必填/审批/行程字段，且提出约 11 组内容难以装入用户要求的两页 A4；已通知主会话收紧生成器。等修订 DSL 后覆盖同一应用、重测，不新建重复应用。
- 文档内容复核：应用 `daefd813-c647-40e5-ad20-c90d021be68f`，已发布为工作流工具 `document_content_review`。合成测试正确指出操作培训遗漏及双语不对应；结果 `scope=content_only`、`visualVerified=false`。
- 文档修改规划：应用 `cd9e9794-6416-43b3-bdf8-e2059991948b`，已发布为工作流工具 `document_edit_plan`。合成测试仅在电气工程师职责中增加操作培训，明确保留机械工程师内容及其他段落。
- 三个应用的节点均为 Start → 输入校验 → DeepSeek V4.1 Flash → 结构校验 → End；无新 API Key。无凭证配置截图：`docs/dify-config/document-review-workflow.jpg`。

## Agent Build 环境

只读 Build 检查报告 uid/gid 1000 dify、非 root；HOME 为 `/home/dify/01a1a021-ee04-7904-925d-a4ac7c2aecc5`，Linux WSL2 x86_64。`soffice`、`libreoffice`、`pdftoppm`、`fc-match` 不存在；`python3` 为 3.13.17，`apt-get` 存在。`$HOME/.venv-office/bin/python` 可执行，Pillow、python-docx、openpyxl、pypdf、reportlab 可导入。字体工具和系统字体缺失；尚未验证实际渲染或跨会话持久性。安装和依赖由主会话负责。

Build 检查虽要求只读，Dify 自动形成 1 项待应用的 Build 草稿 `build_note.md`。该草稿尚未应用，原有 Agent 配置未被发布修改；Build 草稿存在时配置页暂不显示添加工具/Skill 控件。需先妥善处理这项临时草稿再继续挂载，不能盲目应用覆盖现有文件。

## 待完成

- 修订并重测文档设计规划工作流，然后发布 `document_plan`；将三个工具绑定原 Agent。
- 等待主会话完成渲染脚本和依赖、更新 ZIP 后，再上传 `document-quality-work.zip`；保留既有模型、工具和 Skill。
- 补充并发布主提示词；以合成双语申请资料表验证 Word 生成、真实渲染、逐页看图和下载。当前这些均未完成。

## 进度更新

- 已根据主会话说明，取消本轮只读检查自动产生的未应用 Build 建议。Dify 确认对话框说明仅清空构建会话并丢弃未应用配置；之后已核实原有 `build_note.md` 仍在。
- `document_content_review`、`document_edit_plan` 已添加到原 Agent 的未发布配置草稿；尚未发布 Agent。设计规划工具等待主会话修订 DSL。

## 规划与 PNG 检查更新

- 主会话修订 `document-plan.yml` 后，已覆盖原规划应用并重测：返回中性“双语申请资料表”，六个分组，第一页两人基本信息及简短职责，第二页各自附件区，没有推断因公、审批或法定必填；已发布为 `document_plan` 并添加到 Agent 未发布草稿。三个工具均已在草稿中，Agent 尚未发布。
- 用真实 Agent API 做合成只读能力探测，流事件只观察到 `shell_run`/`shell_wait`。Agent 报告 Pillow 可以读取 PNG 尺寸与像素；它没有确认可用的本地图片视觉读取工具，报告 `dify-agent knowledge image` 返回 422。该探测不是逐页视觉验收，不能把像素读取等同于模型看图；真实图片投递和识别通路需进一步验证。
- 此前规划“未发布”、Build 草稿仍存在的状态已由本节及上节更新取代。

## 视觉工作流与环境更新

- 已新建并发布 `document_visual_review` 工作流和工具（应用 ID `120d58a7-97b9-4775-ab97-fa41b43895e0`），输入 `page_image`（单图文件）与 `page_context`（段落），输出严格校验的 `result_json`。DSL 导出至 `docs/dify-workflows/document-visual-review.yml`，工具已加入 Agent 未发布草稿。
- Dify 测试运行中，合成渲染 PNG 的标题与校验码“版式校验 SYNTHETIC-482”未写入文本输入，模型正确从图片读出；相同图片两次 verdict 不一致，视觉判断属于辅助结果。两份测试 PNG 校验和相同，尚不能据此证明区分不同页面。Agent 通过文件对象实际调用工作流仍待端到端验证。
- 新 Agent 会话只读检查发现 LibreOffice 7.4.7.2、Poppler 22.12.0、Noto Sans CJK SC 均可用，运行用户为 uid 1000。主提示词已在草稿追加文档路由和逐页真实视觉检查要求，保留原协议；Skill 更新、Agent 发布和完整网页测试仍待完成。

## 发布及 Agent 文件对象联调

- 四个文档工作流、`document-quality-work` Skill 和第十六节提示词均已随原 Agent 发布。上传的 Skill 以主会话最终 ZIP 为基础，临时副本仅修正两处视觉参数名为 `page_image`；源包需与此保持同步。
- 新 Agent 会话以 Pillow 生成随机校验码的合成图片，调用 `dify-agent file upload`，再将真实 ToolFile 对象传给 `document_visual_review.page_image`。工具事件返回“视觉测试 CODE-1410”，说明图片在 Agent 到视觉工作流的链路中实际被读取。该测试不是对完整 Word 成品的验收。
- 探测没有网页 output_prefix，Agent 仍自行给测试图片设置了时间戳前缀；网页成品交付必须另行核对实际前缀约束。视觉模型温度已调为 0.2 并重新发布，同步到导出 DSL。
- 不同内容的第二张真实渲染图片 `page-2-distinct.png` 已在 Workflow 测试：上下文没有标题和校验码，实际返回“附件区域 REVIEW-937”，与图一致；模型同时说明大面积留白令附件结构无法判断。原两张相同哈希是刻意重复文字的烟测，并非覆盖。
- 持久镜像切换后，新 Agent 会话只读复测确认 uid 1000、LibreOffice 7.4.7.2、Poppler 22.12.0、Noto Sans CJK SC 以及已配置 `document-quality-work` Skill 可用。

## 规划截断修复与重新发布

- 线上失败日志显示 plan 节点 prompt 538、completion 4096 tokens，finish_reason=length；输出包含长推理并在 JSON 字符串中截断。严格校验正确拦截不完整结果。
- 原三个工作流已覆盖并发布新版；真实合成双语两人资料输入复测规划成功，completion 7752、finish_reason=stop，严格校验成功。该计划的附件空间仍需通过实际渲染核验。
- 原规划工具描述已明确 task_json 字符串、format 枚举、constraints 数组和事实保留规则；Agent 增加最多一次参数纠正重试，已发布。Dify 实际发布提示词已复制至两个指定归档文件。
- 已替换并发布 6.91 KiB 精简 Word Skill；Dify 上传界面显示 ZIP 限额 50 MB。PPT-MASTER 另属后续范围，本轮未安装。

## 受限环境渲染修复与发布验证

- 真实 Agent 任务的系统调用跟踪显示 LibreOffice 命令行在 `/tmp/OSL_PIPE_*` 创建 Unix 套接字时被隔离策略拒绝（EACCES）。改用 LibreOfficeKit 导出 PDF；输出目录提交也改为创建目录并复制产物，避免受限环境下目录重命名返回 EXDEV。未修改沙箱隔离策略。
- 主会话在相同任务隔离策略下验证完整脚本生成两页 PDF、PNG、文本和报告。最终 8328 字节 Skill ZIP 已通过 Dify 上传并发布，页面确认“更改已发布”。
- 发布后新建合成 Agent 任务，拉取实际挂载 Skill 并调用一次完整渲染脚本。Dify 原始工具输出为 `ok=true`、`pages=1`、`visualVerified=false`，进程退出码 0，生成 PDF、单页 PNG、文本和报告。此测试只证明渲染成功，不代表视觉验收或完整网页任务已通过。

## 最终网页验收

- 四个文档工具在真实网页会话中均被调用：首轮document_plan、document_content_review、document_visual_review；第二轮document_edit_plan及document_visual_review。成品为一页A4中英资料表，两人的姓名/证件/日期留空、职位与真实给定职责保留。
- 已收到两轮真实Word与PDF，跨账号下载404；同一对话可恢复全部四份结果，原版重新下载字节不变。浏览器实际点击新版Word下载成功；两版下载后的原始Word又被独立渲染并逐页查看，无缺字、截断或重叠。
- XML比较确认原表完整不变，8个空白单元格保留；新版仅改英文标题并加一段双语提示。机器可读证据见document-e2e-result.json，页面截图见../screenshots/document-quality-delivery.png。
- 已修复实际模型连续27个闭合think块导致JSON解析失败的问题，三个工具快照同步新校验；未闭合输出及非法结构仍拒绝。文件对象说明明确传实际ToolFile对象，不能传字符串路径。最终Skill8408字节，含3个运行脚本；没有PPT-MASTER内容或办公库。
- 发布提示词已补充1–3句交付摘要和字体只依据实测的规则。历史测试回复保留原样，不能将其中字体自动替换、度量等同等模型推断当成已验证事实。复杂多页任务曾超出10分钟，仍需控制检查轮数；视觉模型也可能误判。
