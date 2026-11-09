# 心情角与情绪支持

定位为情绪支持与陪伴：倾听、共情、帮助梳理感受与可选择的小步行动，不冒充持证心理医生、不提供诊断/用药，不承诺治愈、永久在线或实时人工监护。普通工作压力与明确办公任务并存时，简短共情后继续办公，不把所有负面词汇都当成危机。

这种边界参考[WHO健康AI指导](https://www.who.int/publications/i/item/9789240084759)与[APA AI心理关怀建议](https://www.apa.org/topics/artificial-intelligence-machine-learning/health-advisory-ai-chatbots-wellness-apps-mental-health.pdf)。倾听、开放提问和协助连接现实支持参考[CDC支持性交流建议](https://www.cdc.gov/emotional-well-being/conversations-matter/)及[NIMH危机支持步骤](https://www.nimh.nih.gov/health/publications/5-action-steps-to-help-someone-having-thoughts-of-suicide)。这些是设计依据，不代表本应用经过临床验证。

## 对话分流

- 办公：保持原help/request/style、文件工作与互助卡。
- 情绪支持：intent=care、careSafety=support，先倾听；用户说只想倾诉时不安排练习。默认没有卡片，也不自动共享。
- 明确想公开：用户要求后才生成去标识careCard私密预览，忠实于原话，不添加经历、原因或症状；本人可以编辑、选择是否留言并再次确认公开。
- 明显当下危机：careSafety=urgent、careCard=null，不显示发布引导。优先确认当前安全，建议联系身边可信任的人和当地紧急/专业支持，不编造号码，不承诺替用户联系或有人值守。该会话的危机公开限制保留，后续普通模型回复不能解除；新主题可另开对话，不将此标记写入员工档案。

普通对话仍保存在本人账号，界面不会自动公开；不能承诺对系统管理员或模型服务商绝对不可见。心理对话、风险状态、care预览不进入员工画像、技能匹配或站内推荐；普通公开任务视图剔除care私密字段。

## 匿名倾诉与鼓励

独立care_posts/care_comments，不复用普通任务，不出现接取/积分/匹配。全部接口需登录；游客只看到登录入口。心情角是独立小卡片区，溢出时低速往返，悬停/键盘焦点/手动暂停/详情打开/减弱动效时停止。

发布者确认后，将且仅将这段待发布文字送到已配置Dify与模型供应商审核，审核通过才出现。留言同样先审核。普通难过、抱怨、想辞职等感受允许表达；攻击骚扰、隐私泄漏、危险指导、诊断/用药指示和广告会被拒绝；明显紧迫危机优先私密支持。模型错误、未启用审核或网络失败时不自动放行，输入保留供修改重试。

公开前正常字号提示：同事可见；匿名只隐藏身份，文字仍可能识别个人，提交文字由AI服务审核。匿名不等于自动脱敏，用户须自行核对，不上传身份、医疗文件或他人信息到心情卡；卡片不会自动附带私密聊天或附件。

本人可编辑、关闭留言、软移除倾诉；留言本人或帖子作者可移除留言。反馈不适记录为pending，不声称有人工已接手。每人每分钟分别最多5次发帖/修改与评论尝试（含失败），减少刷屏和滥用。

## 配置与存储

Agent主提示词及网页query都包含care协议；输出JSON新增intent care、careCard、careSafety，兼容原办公协议。carePreview和安全状态存私密对话草稿，仅本人视图返回，可恢复。发布另用care API及confirmation，不能调用普通任务publish。

已有Dify人员匹配Workflow新增review_json分支，复用本机专用Key，输出review_result_json。`server/content-review.mjs`是唯一审核客户端，输入只含type/title/content，不含完整私密历史或员工身份。Schema、模型及严格解析节点由生成器归档；不完整思考标签/非法JSON无法放行。

SQLite新增care_posts、care_comments、care_reports、care_rate；另有私密requests.data中的care字段。备份时和普通聊天一样保护数据库，不把它们放入公开仓库。实际公司使用仍需身份校验、保留/删除政策和明确人工处置流程。

## 验证范围

只用虚拟账号与合成情绪/危机文本测试，未重放用户真实心理记录。已验证真实Agent四类分流、Workflow普通/攻击/危机审核、匿名发布/留言、编辑/关闭/移除、举报待处理与权限。测试不证明危机识别或审核完美；本项目没有临床诊疗或全天候紧急响应服务。
