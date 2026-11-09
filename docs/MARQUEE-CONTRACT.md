# 本轮协作接口

保留原 API，新增每张需求的 cardStyle：`{theme:'orange'|'mint'|'ink'|'sand'|'rose'|'sky',layout:'standard'|'poster'|'note',radius:'soft'|'square',emphasis:'normal'|'bold'}`。共享定义位于 shared/card-style.mjs，前端可从 ../../shared/card-style.mjs 导入。用户追加明确偏好：品牌和默认卡片以鲜明橙调为主，DEFAULT_CARD_STYLE.theme=orange。颜色与布局由前端映射，不接受 HTML/CSS/JS。

- 所有 Request 返回规范化 cardStyle，老记录补默认值；PATCH 本人草稿可修改 cardStyle，其他权限边界保持。
- Dify JSON 结果为 `{reply,intent:'help'|'request'|'style',card:原文字卡片结构|null,cardStyle:上述完整结构|null,readyForPreview:boolean}`。intent/cardStyle 缺失时兼容旧结构，默认 request。
- `/api/clarify` 继续返回 request、messages、reply、mode、warnings，额外返回 intent、hasCard。request 始终存在（同时用作本轮对话的持久标识）；普通 help 允许 card=null，不强行补一张需求。
- card=null 保留已有需求文字。cardStyle=null/缺失保留当前样式；只有本人 draft 可更新。隐私、状态、积分等字段不接受模型改写。样式由当前卡片保存并在发布后展示，不全局改变其他需求。
- hasCard 表示文字卡片已有标题或问题等内容。空的问答/样式对话不列入“我的草稿”；样式可先预览，发布仍需要原有必填内容和本人明确确认。
- 前端发送后保留 request.id 以续聊，即使 hasCard=false；没有 fields 时 saveDraft 不应崩溃。回复普通答案时保留已有卡片。
- 本地模式可解释有限样式关键词；普通问题明确提示未连接AI，不伪装回答；现有标签式需求流程保持可用。

用户进一步要求：背景可为风景图、表情包。cardStyle 新增 background:'none'|'mountain'|'coast'|'meme'，默认 none；兼容旧的四字段样式。图片由前端本地资源映射，不接收任意外部 URL。root生成并保存 frontend/public/card-backgrounds/mountain.png、coast.png、meme.png，frontend负责实际背景呈现与可读文字底板。关键词“山景/山峰”→mountain，“海边/海岸”→coast，“表情包/摸鱼表情”→meme，“去掉背景图/纯色”→none。

用户又追加形状个性化：新增 shape:'standard'|'ticket'|'polaroid'|'bubble'，默认standard，旧4/5字段继续兼容。图形由前端映射，不接受任意clip-path；关键词票根/车票→ticket，拍立得/照片框→polaroid，气泡/对话框→bubble，标准轮廓→standard。以海边拍立得、山景票根、摸鱼表情气泡组合展示。

前端 owns frontend/；后端 owns server/ 与 server-tests/。管理员 owns shared/、docs/、integration-tests/、启动和总体测试。
