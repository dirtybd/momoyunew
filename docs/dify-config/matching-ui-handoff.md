# Dify 人员匹配交接

更新时间：2026-11-03

- 工作流“摸摸鱼·人员匹配”已发布，应用 ID：`1bec7c6f-88ec-4518-a33d-98f5e26f4dc9`。Start 必填 paragraph `snapshot_json`（DSL max_length 500000）→ JavaScript Code → End 字符串 `matches_json`；无 LLM、联网、数据库和通知节点。
- 已同步 `shared/matching-rules.mjs` 的无截止日期说明并发布。Dify UI 样例和使用本机 .env 密钥直接调用已发布 workflow API 均成功（HTTP 200 / succeeded）；合成 Excel 候选返回 1 项、score 100，说明为“未来一周有登记的空闲时段，交付日期待确认”。此前测试亦确认不匹配技能被排除、未登记时间返回 unconfirmed。
- 按用户当场确认已创建该工作流专用 API Key，写入本机 `.env` 的 `DIFY_MATCHING_API_KEY`，并设置 `DIFY_MATCHING_BASE_URL=http://127.0.0.1:8080/v1`；未在此文件记录密钥。主服务如已启动，需要重新加载环境变量。
- 自定义工具“摸摸鱼人员预匹配”已创建并绑定 Agent `01a18a67-3f52-759f-9409-75bda6e070ef`，目标 `http://host.docker.internal:8792/match-preview`，操作 `preview_matches`；第十二节提示词要求本轮 token、只报告实际匿名统计、草稿不通知。Agent 配置发布为版本 11。
- 进入 Agent 时已有未发布草稿，版本 11 已一并发布。现已通过 Dify 只读版本 10 和 11 比较：本次以外的提示词差异有两处，分别加强注册/员工档案不得写入知识库及共享存储的规则，以及增加知识库只读、不得精确检索员工档案且未确认绑定的说明。保留这些改动，未发现其它提示词段落的增删。版本 10 和 11 的模型同为 DeepSeek V4.1 Flash；Skill 均为 requirement-clarification、requirement-card、tool-capability-check、office-file-work；文件均为 build_note.md；已有工具均为代码解释器、时间、网页抓取、摸摸鱼卡片制作。版本 11 额外添加人员预匹配工具；两个版本均显示 Agent 知识库功能未启用、未绑定知识。此比较基于界面显示的清单，未逐项比较隐藏的模型参数或 Skill 内容。
- 预匹配工具和 Agent 的实际端到端调用尚待主会话提供合成验收授权并确认服务已加载新配置；不使用真实员工数据。

## 联调完成（2026-11-03）

- 真实 Agent 首次调用 `preview_matches` 时被 Dify SSRF 代理拒绝；已在本机 Dify 部署的 `ssrf_proxy/squid.conf.template` 增加仅限 `client_localnet`、POST、`host.docker.internal:8792/match-preview` 的精确放行，在私网拒绝规则之前；原有 `/design-card` 放行及其他私网阻断保持。已展开配置、执行 `squid -k parse` 并重载。迁移规则同步至 `docs/dify-card-tool.squid.conf`。
- 使用主会话提供的合成私密草稿，通过网页后端 `/api/clarify` 驱动真实 Agent：第一次如实报告代理拦截；放行后重试返回匿名候选 1、空闲待确认 1、未通知。响应显示 intent=request、readyForPreview=true、mode=dify，卡片 status=draft、visibility=private；未发布 QA 卡。该结果为 Agent 回复和接口状态，尚未单独从 Dify UI 导出原始工具事件。
- 最终 Code 节点已从最新 `shared/matching-rules.mjs` 完整同步（仅去掉 export），复制回读与源文件一致并发布。Dify UI 测试和发布后的真实工作流 API 测试均通过：`Excel 数据核对 / 透视表` 匹配、`Excelling` 不匹配，HTTP 200 / succeeded。
- 已从 Dify 已发布配置复制归档主提示词到 `docs/DIFY-AGENT-PROMPT.txt` 与 `docs/dify-config/prompt-published.txt`。

## 最终核验补充

- 主会话已独立核查该合成会话的 Dify `message_agent_thoughts`：实际工具事件为 `preview_matches`，返回 `count=1`、`timeUnconfirmed=1`、`sent=false`。脱敏摘要位于 `work/matching-agent-receipts-summary.json`，因此上文关于尚未核实原始工具事件的描述已由此结果更新。
- 主会话报告：正式服务已重启并加载最新规则；隔离测试库验证了匹配与消息持久化，18 项测试和生产构建通过。
- 已保存不含凭证的工作流配置截图：`docs/dify-config/matching-workflow.jpg`。
