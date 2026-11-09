# CLAUDE.md

本文件只适用于 `D:\AI\momoyuDify` 及其子目录。不要把它复制到 `D:\AI\momoyu` 或其他项目。

## 项目定位

- 本目录是 `D:\AI\momoyu` 的独立副本，用于接入目标 Dify「同频」工作空间。
- 本目录已于 2026-11-09 初始化独立 git 仓库（分支 `main`），用于本地回退；不要把它推送到原仓库。`.env`、`data/`、`work/`、`dist/`、`node_modules/` 不纳入版本管理。
- 部署与迁移的权威说明：`迁移事项.md`
- 同步过程、工具绑定和验证记录：`work/dify-sync/`

## 当前配置

- 目标 Dify：`http://10.37.26.37`，工作空间 `同频`
- 本机端口：前端 `5174`、后端 `8788`、制卡/匹配 `8798`
- 原项目使用 `5173 / 8787 / 8792`，不要改回这些端口，避免冲突
- `.env` 保存目标 Dify 的服务 API Key，已在 `.gitignore` 中
- `DIFY_ENTRYPOINT=chatflow`
- `DIFY_API_KEY` 为空：旧「摸摸鱼」Agent 已移除，legacy 回退不可用
- 所有应用模型：`langgenius/openai_api_compatible / 电研-qwen3.8-27b`

启动：

```powershell
cd D:\AI\momoyuDify
npm run dev
```

健康检查：

- 后端：`http://127.0.0.1:8788/api/health`
- 制卡工具：`http://127.0.0.1:8798/health`

## Dify 绑定

- 自定义 API 工具：`design_card`、`preview_matches` 保留在 `同频`，地址为 `http://10.11.86.2:8798`；卡片 Agent 已不再调用它们。`recommend_agents` 已于 2026-11-09 清理（删除前确认无绑定）
- 设计/预匹配现在由后端完成：模型返回 `design` 对象，后端用 `server/card-design.mjs` 生成 SVG；卡片可预览后后端调用 `matching.preview` 计算匿名预匹配
- 工作流工具：`momoyu_card`、`momoyu_office`、`document_visual_review`、`document_plan`、`document_content_review`、`document_edit_plan`
- 统一对话入口节点：`office` → `momoyu_office`，`card` → `momoyu_card`
- `card` 节点必须保持 Agent 工作流工具，不要改成普通 LLM 节点；普通 LLM 节点会丢失 Agent Skill、文件读取和工具调用能力
- 具体工具 ID 和应用 ID 见 `work/dify-sync/TOOL-BINDING-REPORT.md`

以上绑定均已保存并发布；除非明确要求，不要重建应用或工具，优先更新现有绑定。

## 站内智能体推荐

- 数据源：`http://10.37.26.35:5173` 的公开目录 `GET /api/v1/products`（匿名可读，只取 `AGENT_API`）。
- 后端：`server/agent-catalog.mjs` 缓存目录到 `data/agent-catalog.json`，AI 办公回复无法完成或用户主动询问时，在 `/api/clarify` 响应和消息中附加 `recommendations`。
- 前端：`frontend/src/Recommendations.jsx`，由 `AssistantConversation.jsx` 渲染卡片，链接到门户 `/agents/{productId}`。
- Dify 不参与推荐实现：`recommend_agents` 已从「同频」清理（删除前确认无绑定）。本机 `scripts/card-tool.mjs` 的 `/recommend-agents` 仅保留为本地调试接口，不会创建 Dify 对象。
- **当前决定：推荐功能不使用 Dify 实现。** 目录抓取、检索和卡片注入全部在后端完成。
- 详细说明：`work/agent-recommendations.md`。

## 待办与迁移

- **模型网关阻塞**：目标 Dify 的 `电研-qwen3.8-27b` 在普通 LLM 节点可用，但 Agent 模式调用上游返回
  `The model Qwen3.5-122B-A10B-w8a8-mtp does not exist`。需要网关管理员修复模型路由或部署该模型；这不是本项目代码问题。修复前卡片 Agent 和办公 Agent 无法运行。
- 目标 Dify 的 SSRF 放行（`SSRF_PROXY_ALLOW_PRIVATE_IPS=10.11.86.2/32`）只在使用 `design_card`/`preview_matches` 自定义工具时还需要；当前卡片 Agent 和后端推荐注入都不走这条路径。
- 本机 IP 变化或迁移到其他服务器时：
  - 设计/预匹配不需要改 Dify 工具地址
  - 如果仍要手动使用两个自定义 API 工具，只修改它们的 `servers[0].url`
  - Agent 和工作流工具绑定不需要重建
  - 详细步骤见 `迁移事项.md`

## 修改约定

1. 改动 Dify 前先确认当前工作空间是「同频」。
2. 不要创建第二个同名应用或工具；优先更新现有对象。
3. 修改工作流模型并重新发布后，要重新同步六个工作流工具版本：
   ```powershell
   node work/dify-sync/resync-workflow-tools.mjs
   ```
   该脚本需要 `DST_BASE`、`DST_EMAIL`、`DST_PASSWORD` 环境变量。
4. 不要把 Dify 密码、服务 API Key 写入代码、文档、提交或输出；只通过环境变量传递。
5. 不要修改 `work/dify-sync/export/`、`manifest.json` 等同步依据，除非任务明确要求重新导出。
6. 源项目 `D:\AI\momoyu` 只读；需要对照时复制内容，不要直接改源目录。
