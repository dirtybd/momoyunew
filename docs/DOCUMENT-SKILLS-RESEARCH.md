# 文档能力与 PPT Master 接入调研

检索日期：2026-11-03。范围：一手文档、上游仓库和本项目已有实现；本轮未安装第三方 Skill、未修改线上 Agent、未上传真实签证或心理资料。

本文保留实施前的调研判断。后续同日已部署Word渲染环境、四个文档工具与自建质量Skill，最新状态见[dify-workflows/README.md](dify-workflows/README.md)和[验证记录](VALIDATION.md)。PPT-MASTER仍未安装，自建Word Skill的约8KB导入包与上游PPT-MASTER发行包是不同内容。

## 结论

建议采用“Agent 负责对话和任务路由，DSL 负责结构化规划/检查，Skill 和受控文件工具负责生成，渲染后检查再交付”的组合。Computer Use 用于管理员配置 Dify、检查样例和处理没有稳定接口的个别应用，不作为每名员工每次生成文档的常规执行路径。

这是针对当前项目的设计建议：文档生成的主要瓶颈是版面控制、渲染和验证，而非缺少更多工具名称。另一个签证信息表案例可复用的是“字段设计→实际生成→导出 PDF→逐页看图→修改”，不是复制用户的签证信息、固定表格内容或整段聊天。

## Dify 已核实的能力和限制

- 新版 Agent 可以上传内含 `SKILL.md` 的 `.zip` / `.skill`，官方当前上限为 50 MB；Skill 是任务流程，不自动给模型新增工具权限。工具应另在 Agent 的工具区挂载。DSL 导入不包含 Skill 和参考文件，须补装。[Build an Agent](https://docs.dify.ai/en/cloud/use-dify/build/new-agent/build)
- Workflow 可发布为工具；Chatflow 不能。包含 Human Input 节点的 Workflow 不能由 Agent 调用，因此多轮澄清和用户确认应由外层 Agent / 网页承担，不宜塞进其工具内部。[Dify Tools](https://docs.dify.ai/en/cloud/use-dify/workspace/tools)
- 应用导出并非整套运行环境备份。运行时持久文件、服务密钥、模型/工具凭证及 Workflow/Swagger/MCP 工具等不会随普通应用导出自动迁移；需要依赖清单和单独部署说明。[Export and Import Apps](https://docs.dify.ai/en/cloud/use-dify/workspace/export-import-apps)
- Build 中安装的命令行工具可随配置保留；已发布任务里临时安装的工具只用于该运行。生产部署宜预先准备依赖，而非每份文档重新下载。[Build an Agent：Tools / File System](https://docs.dify.ai/en/cloud/use-dify/build/new-agent/build)

本项目已经实践了 `.yml` 人员匹配工作流、`office-file-work.zip`、私有办公 venv、真实文件上传事件回传。不能据此推断 Dify Code 节点与新版 Agent 沙箱共享文件系统或系统依赖；导入成功也不能证明文件渲染已可用。

## PPT Master：应采用的上游

确认的原版是 **[hugohe3/ppt-master](https://github.com/hugohe3/ppt-master)**。Skill 在 `skills/ppt-master/`；本次读取的入口元数据版本是 `6.8.0`，声明原仓库和作者 Hugo He。搜索中出现的 `huystackai/ppt-master`、`opencentra/ppt-master-skill` 等并非本次建议的原版发行源。[原版 SKILL.md](https://github.com/hugohe3/ppt-master/blob/main/skills/ppt-master/SKILL.md)

原版提供可编辑 PPTX、从现有 PPTX 延续设计的编辑路径，以及独立模板工作区。上游默认路径含确认阶段；显式 Quick 请求可使用相应路径。Skill 中的“workflow”是文件与命令驱动的工作程序，不是 Dify 的 YAML 工作流节点。[官方 Getting Started](https://hugohe3.github.io/ppt-master/docs/getting-started.html)

不能把整个仓库改后缀为 ZIP 就宣称兼容 Dify。上游 README 当前描述的完整 Skill 发行包约 56 MB，已提示可能超过 Dify 的上传限制；本次 GitHub Release API 因限流未取得实际资产大小，安装前必须以目标版本 ZIP 实测大小和内容为准。[上游 README / 安装](https://github.com/hugohe3/ppt-master#3-set-up)

### 依赖与打包判断

| 项目 | 核实结果 | 对本项目的含义 |
|---|---|---|
| Python / 主机能力 | 官方要求 Python 3.10–3.14，且宿主能读写文件和执行 shell | 仅上传说明文字不够；需验证 Dify Agent 的实际执行环境 |
| PPTX 导出 | `python-pptx`、`XlsxWriter`；原生形状能力另含 `skia-pathops`、`uharfbuzz` | 当前办公 venv 不能视为已经具备完整 PPT 管线 |
| 源文件读取 | DOCX 用 mammoth，Excel 用 openpyxl，PDF 转换可用 PyMuPDF | 用到哪条转换路径才准备哪组依赖，不笼统承诺全部格式 |
| 额外能力 | 旧格式转换可能需 Pandoc；旁白、生图、编辑预览各有独立依赖 | 首轮可以只验收静态可编辑 PPT，避免被无关能力拖慢 |

来源：[官方安装前提](https://hugohe3.github.io/ppt-master/docs/getting-started.html#set-up-the-installation-and-working-folders)、[Skill requirements.txt](https://github.com/hugohe3/ppt-master/blob/main/skills/ppt-master/requirements.txt)、[源文件转换说明](https://github.com/hugohe3/ppt-master/blob/main/skills/ppt-master/scripts/docs/conversion.md)。

上游导出包装器依赖包内其他模块，并执行归属完整性检查；不能只拿一个 `SKILL.md` 或单独 `svg_to_pptx.py` 期待可运行。PPT 原生对象输出、SVG 预览和 PowerPoint/WPS 实际显示仍是不同检查对象。[导出入口](https://github.com/hugohe3/ppt-master/blob/main/skills/ppt-master/scripts/svg_to_pptx.py)、[Generate 工作程序](https://github.com/hugohe3/ppt-master/blob/main/skills/ppt-master/workflows/generate-pptx.md)

### 许可证和采用方式

原项目 MIT，采用或再分发需要保留版权与许可；图标有各自归属。可选 PDF 转换依赖 PyMuPDF 标明 AGPL-3.0，不能把“项目 MIT”解释为打包全部依赖也只有 MIT。[LICENSE](https://github.com/hugohe3/ppt-master/blob/main/LICENSE)、[PDF 转换许可说明](https://github.com/hugohe3/ppt-master/blob/main/skills/ppt-master/scripts/docs/conversion.md#source_to_mdpdf_to_mdpy)

建议先固定一个上游 commit，在独立文件任务环境验证，再决定是否制作合规的 Dify 适配包。保留必需脚本/引用/许可和完整性机制，不擅自裁掉它的验证关卡。若包体或运行交互不适合直接挂载，可将固定版本部署为隔离的文档处理服务，由受控 API 调用；这是工程方案，尚未实施或验收。

## 当前项目的缺口

已检查本地 `docs/dify-skills/office-file-work/SKILL.md`：现有能力主要是简单 Word 新建/替换、Excel 定点修改、PDF 合并/读取和图片合 PDF，并通过本轮 `output_prefix` + `dify-agent file upload` 交付。现有回读验证不等于排版看图验收。

主会话本轮环境检测显示：Agent本地沙箱容器 `dify-local_sandbox-1` 的默认shell未发现 `soffice`、`pdftoppm`、`fc-list`（此检查不能替代逐任务执行环境验证）；不能把宿主机 Word 或本桌面环境的文档工具视为已装进 Dify。需分别核实 Agent 的私有 venv、可用字体、渲染器、图片读回能力和运行限额。

文档增强优先补以下闭环：

1. 生成前定义字段、表格分组、必填/选填、说明与填写空间，空缺事实保留待填写。
2. 通过可编辑 DOCX/XLSX/PPTX 实际生成，原件只读、另存版本。
3. 按页渲染出 PDF/图片，并检查表格跨页、截断、页边距、字体、行高和编号。
4. 结构检查和视觉检查分别报告，失败就定点修改并再次渲染。
5. 回传成品与必要的预览，不把用户材料写进全员共享的 Skill、Files 或知识库。

其中渲染可选择 Linux 的 LibreOffice + Poppler，或受控 Windows Word 工作进程；具体选型需用合成样例实测。前者与 Word 可能有字体/版面差异，后者不适合作为无人值守多用户网页的默认鼠标自动化任务。本段是本项目的建议，不代表本轮已部署。

## 建议先交付的三个可复用 DSL

| 工具 | 输入 / 输出 | 验收重点 |
|---|---|---|
| `document_plan`：材料梳理与文档设计 | 已授权的材料文本、任务目标、参考模板描述 → 字段清单、分组、版面约束、缺失信息、生成计划 | 先做“签证材料信息表”的合成案例；不编造人名/证件/政策事实 |
| `document_content_review`：内容核对与修订计划 | 原材料、确认的设计、从成品提取的文字，以及可用的渲染检查结果 → 问题清单、定位、修订建议 | 区分缺字段、与来源不符和版面问题；无图片时不能声称完成视觉验收 |
| `document_edit_plan`：局部修改规划 | 用户修改要求与当前成品文字 → 定位、修改动作、保留范围、复核清单 | 先完成Word修改闭环，PPT分镜另列下一阶段 |

这三个工具可以先只使用输入、模型、结构校验、输出节点，便于直接导入、复用与测试。它们不会凭 JSON 计划自动产生真正的 Office 文件；实际生成与渲染应调用已验证的 Skill/文档运行器，不将复杂二进制编辑硬塞进 Dify Code 节点。

## 后续心理关怀可以复用什么

可以复用任务路由、资料最小化、结构校验、私密保存、可追溯版本和失败明确返回的工程路径；不能把文档生成的确认模板直接照搬为临床诊断或治疗流程。保留已有 care 分流、紧迫风险优先现实支持、不进入员工画像与不自动公开的限制；具体专业内容需单独选择依据和评估。

## 本轮未做

未下载/安装运行 PPT Master，未测其完整导出或渲染，未验证某个发行 ZIP 能直接导入 Dify，未创建新的凭证或上传真实材料。文档内的部署路径是建议，当前可运行能力仍以项目既有配置和真实测试记录为准。

## 本轮准备包

主会话已另行准备三份文档DSL和document-quality-work Skill，具体范围、输入及待联调项见[dify-workflows/README.md](dify-workflows/README.md)。这些离线文件尚未导入或挂载到线上，不表示已安装渲染器或PPT-MASTER。
