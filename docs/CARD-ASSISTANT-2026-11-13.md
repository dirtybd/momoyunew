# 卡片助手：文档提取、LLM澄清与字段校验

后续更新：非思考模型设置现已扩展到摸摸鱼全部Agent和工作流，不再只限卡片，见 [统一配置记录](NON-THINKING-2026-11-13.md)。下文记录卡片改造阶段的验证。

2026-11-13，公司“同频”工作区；项目 `D:/AI/momoyuDify`。当前网页的卡片分支已改用固定LLM流程，原卡片Agent应用保留回退。电气、办公、关怀分支及共享模型配置不变。

## 当前链路

网站选取本轮已授权材料 → 统一Chatflow的card_materials引用 → 卡片Workflow筛选文档 → Dify文档提取器 → 有来源和长度限制的文字 → LLM澄清/补卡 → Code严格校验 → 网页私有草稿。保存、预览、封面、发布、匹配和消息仍由网页后端控制。

LLM节点没有Shell、文件执行或发布工具。`requirement-card`保留为可复用规范源码；构建器将正文编入LLM系统提示词，不在运行时依赖Skill发现或CLI加载。原Agent版及其Skill绑定只用作回退，不在当前卡片链路运行。

## 查出的具体问题

- 后端存在“允许传文件”的路径，但卡片提示词与Workflow任务说明禁止读取原件。305字节TXT附在调用里也只得到“请贴文字”的答复，未能获取只存在于文件中的设备编号。
- 临时开放原生Agent读取后，文件下载exit=0，模型却在工具结果后继续等待；65秒诊断中止。原始文件未损坏，不能归因于文件太大。
- 原模型配置采用strict兼容模式，插件不会把关闭思考的非标准参数发给上游。多文件卡片曾在输出前耗尽4096 token，原生Agent一次成功也约50–62秒。
- 父Chatflow的附件历史不等于新启动的卡片子Workflow自动持有文件。本次新增可选card_materials输入：每轮只给当前任务获准文件的缓存引用，父会话不重复挂载已递送文件，不重新上传文件字节。
- 原有截止时间合并使用null合并运算，用户明确取消日期仍保留旧值。已区分“省略字段”和“显式null”，取消日期可正确保存。

## 模型设置

卡片专用模型别名 `momoyu-card-qwen-fast-20261113` 仍指向同一个公司Qwen模型接口，并非换用外部模型；没有新建API Key，也没改共享原模型的配置。别名凭据配置 `compatibility_mode=extended`、`agent_thought_support=supported`，LLM参数 `enable_thinking=false`、`temperature=0.2`、`max_tokens=4096`。

这使关闭思考参数实际传到上游，避免简单填卡消耗大量推理额度。该别名是当前工作流依赖，不能当作临时诊断配置删除。迁移工作区时需配置等效模型；只导入DSL不会带入凭据。参数机制参考[官方插件实现](https://github.com/langgenius/dify-official-plugins/blob/main/models/openai_api_compatible/models/llm/llm.py)。

## 澄清规则与边界

先从用户描述、当前草稿、已有确认和文件文字找事实，只问决定任务如何完成的缺口，每轮最多两问。区分需求说明与真正执行用的原始资料；可明确写尚缺材料，不编造已提供、分享时间或同事权限。期限、报酬、修改轮次和数字指标不默认填写；修改交付物时保留其他事实，显式取消日期应清空。

参考了[requirements-clarity](https://github.com/softaworks/agent-toolkit/blob/main/skills/requirements-clarity/SKILL.md)的缺口识别与可检查标准，以及[doc-coauthoring](https://github.com/anthropics/skills/blob/main/skills/doc-coauthoring/SKILL.md)的利用已有材料和读者视角检查；没有照搬长PRD、90分门槛、5–10个问题或多代理审稿。

只读取AI授权文件；included=false表示不分享给接取者，不等于禁止AI分析。用户明确“不读取/仅作附件”时不提取摘要或表头。图片与视频不送语言模型识别，截图默认是任务材料，只有用户明确要求才作为背景。当前没有OCR或图像理解。

每轮最多提取5份文字文档，单份最多20MB；给模型的每份文字最多4500字符、合计12000字符，并标记截断/读取失败。支持范围以Dify提取器为准，本次实测TXT、DOCX、XLSX及文字PDF。大文件、扫描件、旧二进制格式和复杂布局不承诺全文可靠读取；文件仍可作为需求附件传递。

## 最终验收

全部使用合成资料与隔离SQLite，正式员工、消息和公屏未写入测试数据。

| 最终LLM路径 | 结果与耗时 |
|---|---|
| Workflow直接读TXT并成卡 | 5.783秒，读取MX-4827、18条、F073，区分说明与原文 |
| Workflow联合读取Word与Excel | 5.947秒，读取Word中的RZ-6712及Excel中可见数值 |
| Workflow读取文字PDF | 4.374秒，读取E207等文件事实 |
| Workflow损坏PDF | 3.676秒，提取节点降级，返回补资料追问，不编造卡片 |
| 网页→Chatflow→卡片Workflow→私有草稿 | 9.966秒，正确读取文件、填写用户指定日期；仍是草稿 |
| 网页继续修改 | 14.670秒，改为仅英文PDF、取消中文对照和截止时间，保留故障码等约束 |
| 网页损坏PDF | 7.836秒，返回两条追问，不报整轮超时 |
| 网页任务截图 | 6.269秒，说明无法识图并询问关键文字，不设为背景 |

连续两轮共用同一个Dify上传缓存记录；AI可读但included=false的材料能够分析，分享状态未改变。158项Node测试通过，包含文件引用、卡片更新、权限、AI阅读选择、材料范围、工作流代码与其他分支回归。短样本耗时不代表公司接口永不波动；未做浏览器视觉改版或大文件压力测试。

## 源码、导入与回退

- `docs/dify-config/requirement-card/SKILL.md`：规则源；同目录SOURCES.md记录参考，ZIP已同步。
- `node scripts/build-card-agent-prompt.mjs`：同时更新card-llm-prompt.txt与回退Agent提示词；改规则后要重新构建并同步LLM节点。
- `scripts/card-material-workflow.mjs`：文档筛选、Dify提取、限长和父流程引用接线。
- `scripts/card-llm-workflow.mjs`：将卡片Workflow转换为LLM＋Code，保留文件提取和回传协议。
- `docs/dify-workflows/company-card-llm.yml`：当前真实DSL导出，可导入工作室；导入后选等效模型。
- `docs/dify-workflows/company-card-published.json`：已发布图；`company-card-agent-fallback.json`：切换前Agent图备份。
- `docs/dify-workflows/multi-agent/card-ui.ifpkg`：保留的卡片Agent原生导入包，当前网站不调用它。

统一入口的卡片工具保持原名称/提供器，发布新图后已同步工具版本并确认synced=true。原有未发布草稿差异保留。主Chatflow除增加card_materials及其卡片材料绑定外不改其他分支。详细SSE、阶段备份及隔离验收结果在忽略目录work/card-assistant-audit；其中含临时文件签名，不推送远端。
