# 后端说明

账号角色、两名管理员上限、主账号初始化和公开内容管理见 [账号与管理权限](../docs/ADMIN-ACCESS.md)。权限由服务端和数据库校验，管理员不因此获得他人的私密对话、草稿或附件读取权限。

Node 24 直接运行 `node server/index.mjs`，默认监听 127.0.0.1:8787；可设置 `HOST`、`PORT`、`DATA_DIR`。数据库为 DATA_DIR 下的 momoyu.sqlite，首次空库生成明确标记的本地示例。生产静态资源从工作目录的 dist 读取。

`DIFY_BASE_URL`、`DIFY_API_KEY`、`DIFY_TIMEOUT_MS` 在服务端 .env 配置。当前已对接本机 Dify 1.18.0 新版 Agent：POST /v1/chat-messages，response_mode=streaming；密钥本身绑定应用，不需要 Agent ID。协议根据本机容器 controllers/service_api/app/completion.py 与真实调用核对。health 的 mode 为配置的运行模式，不能当成上游健康检查。

server/dify.mjs 聚合 SSE，只使用可见答案，忽略 agent_thought；agent_message 增量和 message 最终快照分别处理，避免重复拼接。只接受合法 JSON 卡片，过滤所有非文字业务字段。远程会话存储在 dify_conversations，按草稿、账号授权和连接配置隔离，不返回前端或公屏。远程失败不回退到假 AI 回复、不覆盖本地草稿。相同草稿并行澄清返回 409，等待期间有其他修改时也返回 409，避免覆盖新版本。

密钥留空时为本地规则模式。积分仅为意向；站内推荐由匹配队列处理。快速文字分支支持流式正文，文件和卡片工具完成后交付最终结果。SSE开始后的失败会发送安全error帧；上游429显示限流说明，不泄漏原始供应商错误，不自动重跑可能已产生文件的整个Agent。

会话在服务端保存并在 30 天后失效，数据库升级前的旧会话会失效，需重新登录。写操作只接受 JSON；如果请求带 Origin，必须与请求 Host 的 HTTP 来源一致（开发代理保留浏览器原始 Host），无 Origin 的本地自动化请求仍可使用。同步 scrypt 会在注册和登录时短暂阻塞单进程事件循环，本实现仅面向本机低并发使用。

卡片样式从共享枚举验证，仅保存完整的 theme、layout、radius、emphasis，旧数据读取时补默认样式。普通问答与样式对话共用草稿 ID 和独立 Dify 会话，但没有文字卡片时不出现在草稿列表；card=null 保留已保存内容。本地模式只识别有限样式关键词，普通问题明确告知未调用 AI。模型输出不得更改权限、来源、积分或发布状态，样式仅在用户明确要求修改卡片外观时生效。

本地规则区分卡片样式与“显卡”等普通问答，深蓝、藏蓝映射墨色主题；同时提出互助需求和样式时会保留两者。Dify 的 request 或 style 结果仅在本轮明确提出样式调整时应用安全样式，help 不应用样式。写邮件、翻译、润色等本地问答会提示未连接 AI。
标签式需求字段优先解析；标题等字段中的“样式”或“卡片”不会被视为样式命令，独立的样式句仍可同时生效。

背景只保存共享枚举：mountain、coast、meme 或 none。旧四字段样式读取时补 none；不接受外部图片地址、CSS 或 HTML。

空库初始化使用 `shared/demo-requests.mjs` 的十条完整示例，不覆盖已有数据库。形状只保存 standard、ticket、polaroid、bubble；旧四、五字段样式更新会合并现有背景与形状，未提供的属性不会被重置。自然语言可同时调整背景与形状，不接受图片地址或任意 CSS。
