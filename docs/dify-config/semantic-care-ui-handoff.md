# Dify 语义匹配与心情角交接

更新时间：2026-11-03

## 线上配置

- 在原应用 `1bec7c6f-88ec-4518-a33d-98f5e26f4dc9` 导入并发布新工作流，继续使用原专用 Key；旧版备份 `docs/dify-config/matching-before-semantic.ifpkg`。Start 可选 `snapshot_json` 和 `review_json`，有审核输入走独立审核分支，否则走匹配分支。两个 End 分别输出 `matches_json` 和 `review_result_json` 字符串，无发布或消息写入节点。
- 两个 LLM 节点使用既有 OpenCode Go：`provider=langgenius/opencode_go/opencode_go`、`name=deepseek-v4.1-flash`、`mode=chat`、temperature 0.1。该服务是外部模型服务；匹配输入限定匿名 ID、技能和明确技能描述及需求，审核输入仅是待发布文字，不包含完整心理对话或身份。
- 生成器 `scripts/build-matching-workflow.mjs` 和 `docs/dify-matching-workflow.yml` 与线上同步。测试发现模型有时在 JSON 前输出 `<think>`；两个校验节点现在仅剥离完整闭合的开头思考标签和完整代码围栏，再严格 JSON.parse。未闭合、格式错误、未知 ID、证据不符均失败，不自动放行。
- Agent `01a18a67-3f52-759f-9409-75bda6e070ef` 已发布 care 分流和 `careCard`/`careSafety` 协议；保留原有工具、四个 Skill、文件工作和普通需求协议。已从线上归档 `docs/DIFY-AGENT-PROMPT.txt` 和 `docs/dify-config/prompt-published.txt`。
- `preview_matches` 在线 Schema 已回读确认，旧的 title/skills/deadline 保持兼容，可附 problem/desiredOutcome/deliverables；同步 `docs/dify-matching-tool.openapi.json`。工具地址、网络限制和短期凭证保持不变。

## 合成数据验证

- Dify 画布语义匹配：需求是核对清单，候选用 Excel 和本人描述的设备清单核对经验获得 88 分，绘画候选未返回；evidence 为本人描述中的真实片段。
- 已发布 Workflow 的真实 API：跨标签设备清单核对候选返回 score 90 和真实 evidence，绘画候选未返回；只会录入且明确不会 Python 的候选对编程任务返回空；心理治疗需求返回空。
- 审核 API：普通压力倾诉 allow=true/urgent=false；明确当下危机 allow=false/urgent=true；辱骂留言 allow=false/urgent=false；夹带指令的辱骂也被拒绝。初始测试曾因模型思考标签触发安全失败，修正后复测通过。
- 已发布 Agent 的真实流式 API：普通倾诉返回 care/support、无 careCard；明确要求匿名公开返回 care/support、非空 careCard 和可预览；当下危机返回 care/urgent、careCard=null、不可预览；“压力大，帮我写周报”返回 help、无 careCard。仅使用合成文字，未发布测试卡。
- 本项测试是有限样例，不保证审核或危机识别完美；后端仍应按契约进行硬过滤、证据复核和审核失败关闭。完整网站端的交互与后端链路由主会话及协作会话继续验证。

- 已发布的双分支画布截图：`docs/dify-config/semantic-care-workflow.jpg`，不含凭证。

## 倾听和危机回应收尾

- Agent 提示词已补充全局长度要求、care 默认 2–5 句且最多一个开放问题、只想倾诉时不布置练习，只有用户想听建议时提供 1–2 个可选小步；不重复冗长医疗边界说明。
- 明确禁止承诺持续在线或监护；未确认所在地和号码来源时不输出具体电话号码。发布后已重新归档两个提示词文件。
- 合成实测：只想说说、不安排任务的输入返回 care/support、无卡、不可预览，回复三句且一个开放问题，无练习；当下危机输入返回 care/urgent、无卡、不可预览，建议联系现实中可立即陪伴的人及当地紧急服务，不承诺持续在线，也未输出具体号码。样例不能保证模型所有回复均符合要求。

## 匿名倾诉卡忠实性收尾

- 已发布提示词补充：careCard 只概括用户明确表达的事实、感受和意愿，不新增原因、经历、持续时间、症状、健康或风险；材料少时允许短于通常字数，并保留不需要建议的偏好，不引导公众诊断。
- 合成原文“今天有点沮丧，想被听见，先不用建议”要求整理为匿名卡：真实 Agent 返回 care/support、ready=true；卡片正文为“今天有点沮丧。想被听见。先不用建议。”，未扩写情境或症状。该单例不保证所有生成均忠实，发布前仍由用户确认。
