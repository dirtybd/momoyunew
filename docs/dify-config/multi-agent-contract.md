# 多Agent第一阶段协议

## 入口#4流式扩展

新增必填office_text/care_text两个JSON字符串输入（最长60000字符），分别只包含最近8条同类型消息（每条最多2400字）、本轮要求及必要私有状态；不将员工档案、文件引用或业务令牌送入情感LLM。路由新增office_chat；hasMaterials/hasOutputs将其强制改为office，已有urgent仍强制care。

无工具文字办公和情感LLM直接绑定Answer，返回`{"version":2,"route":"office或care","result":网页协议对象}`。要求reply是result的第一个字段，后端只增量解码这个字符串为SSE reply快照；推理、元数据和内部Agent日志不作为用户正文。最终完整JSON仍严格验证，再事务保存；出错/停止不会把半成品提交为正式历史。三个LLM使用reasoning_format=separated，仅分离推理标签，不声称关闭模型思考。原version=1文件/卡片结果包继续兼容。

网页收到reply事件即可更新Markdown气泡，完整result到达后替换临时气泡。文件与制卡专业工具仍按真实节点显示进度，工具完整产物经检查后交付，不伪装成可逐字流式的文件内容。来源和发布权限不交给模型。

2026-11-05。保留原摸摸鱼Agent与DIFY_API_KEY作为legacy回退入口；Chatflow分office/card/care三个专业分支。网页后端保留身份、私密材料、发布确认、任务交付与通知权限。

## Chatflow输入

- `sys.query`：用户本轮原文。
- `context_file`：必填单个文件。后端以当前用户身份上传的UTF-8 JSON文本，含version=1、user_message、history、card、cardStyle、attachments、inputs、outputHistory、output_prefix、job_token、match_token、当前北京时间、响应JSON字段格式。必须实际下载回读，不用文件名猜内容。
- `care_context_file`：必填独立JSON文本文件，只含user_message、本人关怀history、carePreview、careSafety与beijingTime，无工作资料或业务令牌。care工具的context_file仅绑定此文件，不绑定工作上下文或sys.files。
- `route_context`：必填JSON字符串，含最近两条业务对话及careMode/careSafety/hasCard，仅供路由判断。手工测试可填`{"careMode":false,"careSafety":"support","hasCard":false,"history":[]}`，不能填自然语言段落。
- `sys.files`：只有用户允许AI阅读且非背景的本轮材料。context_file单独传入，不能与用户原件混淆。

## 专业Workflow输入和输出

办公/卡片输入：`context_file`单文件、`materials`文件数组。关怀输入仅`context_file`单文件。Start→新版Agent(version=2, agent_node_kind=dify_agent)→End。Agent task须显式引用对应上游文件变量，让系统注入可下载mapping；普通长文本变量会截断。新Agent实例沙箱不共享，跨轮修改从context_file.outputHistory的真实tool_file引用下载。

新Agent节点声明输出（三个名字均非保留字）：

- `answer_json`，string：网页协议JSON字符串。
- `deliverables`，array[file]：仅本轮实际产物，普通问答/卡片为[]。每个产物先执行dify-agent file upload，structured final_output只传`{transfer_method:"tool_file",reference:真实返回值}`。文件名必须带context_file.output_prefix；内部预览PNG不回传。
- `artifact_json`，string：卡片 Agent 当前不生成插画，始终为空字符串；旧快照仍可携带签名工件，后端核验后才展示。

办公Agent：office-file-work、document-quality-work、4个文档工具；没有制卡、匹配、发布或通知工具。普通问答直接回答，按需调用文档工具。制作/修改后回读并实际渲染/视觉检查，限制检查轮数。遇到阻塞或用户不满意可以询问是否转互助，只有明确同意才由总入口路由card。

卡片Agent：只绑定 requirement-card 技能，不挂设计、匹配、办公或文档工具。最多追问2题；用户明确转互助时从授权历史和已知文件整理需求，不擅自公开附件或推送。封面、配色和版式由后端按语境生成，Agent 不输出 design/图标/坐标。附件默认 names-only：只使用附件名称、类型和本地解析结果，不读取内容；用户明确要求查看/分析/翻译/核对附件内容时才由后端放行文件。

两个Agent的answer_json：office 返回 `{reply,intent:'help',card:null,...}`；card 只需 `{reply,card,cardStyle?,coverAttachmentId?}`，`intent`、`readyForPreview` 和省略字段由后端补全（card 文本完整时 ready=true）。来源、匿名、可见范围、积分和发布状态不能由模型指定。card完整字段及样式枚举见shared/card-style.mjs、server/dify.mjs parseDifyAnswer。

关怀Agent只返回care意图、deliverables=[]、artifact_json=""。网页协议新增可选clearCarePreview:boolean；撤回草稿为true，旧协议省略时为false。careCard是本人私有去标识预览，公开仍需网页确认及独立审核。危机状态优先清空并阻止预览/公开。关怀历史与工作历史按messages.intent分隔，详见CARE-AGENT.md。

## Chatflow分发及回包

Chatflow分类器返回office/card/care。结合当前上下文：继续修改文件→office；明确找同事/创建互助/修改普通任务卡→card；情绪倾诉、继续关怀或修改/撤回心情草稿→care；非危机时混合压力和明确办公任务→office。当下明显危险优先care，已标记urgent时Code强制care。不能因办公失败自动转card，“好/可以”须结合上一轮是否正在征求转互助同意。

office/card分支通过独立Tool节点调用对应Workflow（非另一个全能Agent自主调用），再用确定性Code节点拼包；无需LLM重写成品回复。最终唯一Answer节点输出如下JSON字符串：

```json
{"version":1,"route":"office","answer_json":"网页协议JSON字符串","files":[],"artifact_json":""}
```

`files`取Workflow工具实际文件输出（Dify File mapping，含真实url和reference），不从answer_json或模型生成的下载文字读取。专业route允许office/card/care，care必须无文件/工件。legacy回包`{"version":1,"route":"legacy"}`仍供旧版本兼容，后端使用原Agent密钥和其独立conversation_id执行原输入；不在Chatflow配置旧密钥。当前分类器不自主选择legacy，原Agent由管理员切换配置回退。

Chatflow状态只辅助路由，正式历史和文件仍以后端本人权限为准。所有返回先严格校验；文件还须有本轮前缀并通过既有签名下载、大小和格式检查，卡片图还须验签。跨任务/跨账号引用拒绝。Workflow/Agent出错不能悄悄重复整项工作；管理员可将DIFY_ENTRYPOINT切回legacy。

## 上线验收

新Agent真实工具→Workflow→Chatflow→网页：生成一份合成Word→同对话修改→旧版不变/私密下载；办公遇阻→明确同意转互助→卡片预览→用户确认发布→既有匹配通知。另测背景与材料区分、跨用户隔离、错误不覆盖和旧Agent回退。所有key仅本机.env，凭证不入DSL/提示词/截图。


### 纯文字办公快速回复（统一入口#18）

办公快速分支的Answer固定输出单行`{"version":3,"route":"office","format":"markdown"}`加真实换行，后接office_fast.text。模型只生成自然Markdown；网站固定映射为help、无卡片、无文件、无操作权限。受控头由Answer写入，不能通过正文伪造其它分支。关怀仍使用v2结果对象，文件与卡片专业工具仍使用v1，不将关怀或专业工具的无效结果降级成普通文本。


## 公司纯文本快速翻译（2026-11-13）

一个≤6000字符的完整TXT由后端安全解码，调用翻译Workflow的plain_payload_json分支，得到plain_translation，再生成私人译文；普通消息翻译走office_chat。复杂文档仍走office。后端本地产物续改时首次授权上传Dify，outputHistory逐项使用真实transfer_method：local_file或tool_file，不能把本地标记当引用。视觉复核工具与应用已移除，任何流程不得声称完成视觉验收。工程payload_json与plain_payload_json必须恰好一个非空；旧工程translations_json合同不变。
