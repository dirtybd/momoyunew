# 文档工作流与质量 Skill

状态：2026-11-03已在本机Dify导入并发布四个文档Workflow，作为工具挂到原“摸摸鱼”Agent；document-quality-work与原office-file-work配合。LibreOffice、Poppler和中文字体已部署为可重建的沙箱镜像。完整验收证据与范围以[验证记录](../VALIDATION.md)为准；PPT-MASTER尚未安装。

## 文件与职责

| 文件 | 发布为工具时的建议名称 | 功能 |
|---|---|---|
| [document-plan.yml](document-plan.yml) | document_plan | 将目标、材料和模板要求整理为字段、分组、缺项及版式计划 |
| [document-content-review.yml](document-content-review.yml) | document_content_review | 对照来源与成品文字，找遗漏、矛盾和未完成修改；不做视觉验收 |
| [document-edit-plan.yml](document-edit-plan.yml) | document_edit_plan | 定位局部修改和保留范围，形成可执行修订计划 |
| [document-visual-review.yml](document-visual-review.yml) | document_visual_review | 实际接收单页图片，返回可读内容及版面问题；须逐页调用 |
| [document-quality-work.zip](../dify-skills/document-quality-work.zip) | Skill，无需工具名 | 指导实际生成、结构回读、渲染看图、修正与真实文件交付 |

三个文字Workflow采用Dify 1.18 / DSL 0.5节点结构：Start→输入校验→LLM→结构校验→End；视觉工作流从当前Dify导出为DSL 0.7。模型为现有OpenCode Go / deepseek-v4.1-flash，不含凭证。文字节点max_tokens=16384：真实4096额度曾被推理耗尽并截断JSON，严格校验会拒绝，不能以截断结果继续执行。迁移时先选择可用模型，检查额度、实际图片输入与输出。文字DSL源码为`scripts/build-document-workflows.mjs`，视觉DSL保留真实导出。

## 导入与挂载顺序

1. 工作室→创建应用→导入DSL，分别导入四个yml；检查模型、节点连线和输出result_json。用下面的合成案例逐个测试并发布。已有同名应用应覆盖原应用并保留其ID。
2. 将每个Workflow发布为工具，使用表中的英文名，填写明确的“规划/复核，不生成文件”描述；不添加Human Input节点。多轮澄清与确认仍由外层Agent和网页负责。若实际工具名不同，同步修改Skill中的名称。
3. 摸摸鱼Agent→SKILL→添加，上传document-quality-work.zip；保留office-file-work及现有Skill。工具区另外添加四个Workflow工具，上传Skill不会自动挂载工具。工作流更新后必须在“工作流作为工具→配置”重新保存原工具，单纯发布画布不会自动更新工具的版本快照。发布Agent，再从新会话核对实际工具运行版本。
4. 在Build环境检查office私有venv、字体和文档渲染器。准备可持久化的依赖后，用合成DOCX验证逐页图片可被当前模型读取；不要把宿主机Word或容器默认shell能力当作任务环境已经具备的能力。
5. 保留现有Agent输出JSON、care分流、文件output_prefix和真实上传协议，增加文档路由规则，检查后发布。通过网页实际下载成品、改版并恢复历史，确认仍按用户/对话隔离。

同工作区发布为Workflow工具通常不需要为每个Workflow新建服务API Key；外部后端直接调用是另一种方式。本包未创建任何凭证。DSL不包含Skill、参考模板、字体、二进制依赖或完整运行环境，迁移时分别准备。

## 统一输入与输出

三个文字Workflow的Start接收字符串task_json，外层传入JSON.stringify后的对象。整个字符串最多60000字符，goal最多4000字；source_text/draft_text分别最多24000字，template_notes最多2000字；format只能是docx/xlsx/pptx，constraints必须是最多16项的字符串数组，每项最多400字。只传当前用户授权给AI处理的文字摘录；不要将护照、其他证件或完整私人聊天放进共享Skill或知识库。遇到超长材料先按任务提取必要部分，并告知范围，不能静默截掉后声称核对全文。

```json
{
  "goal": "设计可编辑的双语申请资料表，两位申请人分别有信息区和附件位置",
  "format": "docx",
  "source_text": "合成案例：一位电气工程师负责调试指导和操作培训，一位机械工程师负责安装指导。姓名、证件号和出行日期未提供。",
  "template_notes": "简洁的两页A4表单；正文可编辑；第二页分别预留附件区域",
  "constraints": ["中英文标题和字段对应", "个人信息留空供填写", "职责描述如实保留", "表格行高可扩展"]
}
```

复核时将实际从生成文件提取的文字放入draft_text；修改规划的goal写本轮修改要求，draft_text或source_text提供待定位原文。End统一返回result_json字符串。needs_clarification由外层对话提问，不能等待隐藏的人机输入；ready只说明计划足够执行。

视觉Workflow接收page_image（真实上传的单图ToolFile）和page_context（本页预期内容及检查重点），不接收task_json或裸文件路径。返回pageTitle、observedText、verdict、issues、limitations；pass要求实际可读标题和文字且issues为空，revise需要具体问题，unreadable需要限制说明。模型辅助结果可能误判，不能保证所有Office版本显示一致。

## 文件与视觉质量闭环

```mermaid
flowchart LR
  A[当前用户的目标和授权材料] --> B[Agent按需调用规划工具]
  B --> C[Skill与隔离文件工具生成可编辑文件]
  C --> D[回读结构及内容]
  D --> E[渲染器与实际中文字体]
  E --> F[逐页图片检查与局部修正]
  F --> G[真实文件上传与本人下载]
```

docx_audit.py仅用Python标准库，读取Word正文和样式中的显式字体、节设置、表格行数/重复表头及固定行高；不解压执行内容、不改变原件。执行示例：`python scripts/docx_audit.py --in 成品.docx --out 结构检查.json`。它始终报告scope=structure_only、visualVerified=false，不计算真实页数，也不证明字体实际可用。

内容复核Workflow同样始终scope=content_only、visualVerified=false。缺少渲染器或未读页面图像时，必须明确“尚未完成视觉排版验收”；不能让检查工作流替没有看图的模型盖章。

render_docx.py使用实际渲染器，每次独立profile，原件Hash检查和新预览目录避免跨任务锁及旧页混用；默认8页/110dpi/150秒，输入最多20MB，详细限制见[部署说明](../../deployment/dify-local-sandbox/README.md)。Agent每次Word任务先pull当前质量Skill，使用该脚本，逐页上传PNG供视觉工具检查，修订后重新渲染。PPT-MASTER后续单独适配固定版本，不是Word表单依赖。

## 本地检查与当前限制

- `node scripts/build-document-workflows.mjs`可重新生成三个DSL。
- `python scripts/package-dify-skills.py`重新打包两个自建Skill，只收入口和必要脚本，排除测试、缓存、构建器旧稿及运行库。质量Skill约8KB，含LibreOfficeKit导出helper；Dify本机上传UI上限50MB。它不是PPT-MASTER精简版。
- `node --test server-tests/document-workflows.test.mjs`：节点代码真实执行，校验输入范围、非法JSON、伪造文件字段、追问状态和视觉验收越界；已通过。
- `python docs/dify-skills/document-quality-work/tests/test_docx_audit.py`：合成OOXML结构读取、原件不变、格式失败与visualVerified=false；2项通过。
- `python docs/dify-skills/document-quality-work/tests/test_render_docx.py`在已装渲染依赖的Linux环境验证真实双页渲染、并发profile、页数上限、原件不变和外部关系拒绝；本机新镜像容器2项通过。
- 本地检查不等同于真实模型验收。线上配置交接见[交接记录](../dify-config/document-quality-handoff.md)。只使用合成资料，无真实护照信息；本轮未安装PPT-MASTER。

工具与运行方式的来源及PPT-MASTER评估见[调研记录](../DOCUMENT-SKILLS-RESEARCH.md)。未来心理关怀可复用路由、权限、结构校验和私密状态管理，但需单独设计依据、风险分流与评估，沿用现有[care边界](../CARE.md)，不复用为诊断或治疗流程。
