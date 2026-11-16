# 公司 Dify 文件 Agent 运行环境

最新模型策略：办公Agent现与项目其他调用共用非思考Qwen别名，见 [统一配置记录](../docs/NON-THINKING-2026-11-13.md)。这只改变模型模式，不改变下面的私有Python环境及迁移要求。

2026-11-13：公司 Linux x86_64 / CPython 3.12.14。办公 Agent 的 Home Snapshot 已准备独立 `.venv-office`，在新会话验证导入，并用于真实 Word/Excel 文件处理。未改公司共享模型、系统 Python 或其他 Agent。

`docs/dify-workflows/multi-agent/office-ui.ifpkg` 包含提示词和三个 Skill，**不包含这次准备的 Home Python 库**（实际导出只有 app.yaml、manifest.yaml 和三个 Skill ZIP）。导入其他平台前必须准备环境，不能只凭导入包中的说明认定环境就绪。

## 当前部署与迁移

1. 在目标 Agent Build 模式检查 `python3` 版本与架构。以下离线轮子仅适用于 Linux x86_64 / CPython 3.12，其他环境重新选择匹配版本，不强装。
2. 在可联网的准备机下载审核过的轮子。锁定版本及 SHA256 在 `office-runtime-wheels.json`；本机现有离线包在项目忽略目录 `work/runtime-compat-check/office-runtime.zip`（约15.7MB），不需要重复下载。
3. ZIP 内应包含 `manifest.json`、`bootstrap_office_home.py`（源码为 `scripts/bootstrap-office-home.py`）与 `wheels/` 下的九个轮子。校验各轮子 SHA256，禁止塞入用户文档、账号或密钥。
4. 将 ZIP 上传给这个 Agent 的 Build 会话，下载到本次工作目录，取出 bootstrap，运行 `python3 bootstrap_office_home.py --bundle office-runtime.zip`。脚本通过标准库建立私有 venv，验证轮子路径和哈希后直接解包；不用 pip/uv 缓存、硬链接或跨挂载重命名，不联网安装。
5. 看到 `OFFICE_RUNTIME_READY` 后 Apply，保存 Home Snapshot，再发布 Agent 和其 Workflow 绑定。新建独立会话执行 `$HOME/.venv-office/bin/python -c 'import docx,openpyxl,pypdf,PIL,reportlab,lxml; print("READY")'`，成功后才标记环境可用。
6. 环境说明使用 `docs/dify-config/office-environment-note.md`；不要带入旧平台 Python 3.13、LibreOffice 已就绪等未经验证的结论。不要让普通文件任务重复安装依赖。

当前库：python-docx 1.2.0、openpyxl 3.1.5、pypdf 7.0.1、Pillow 13.0.0、reportlab 5.1.0、lxml 6.1.3 及三项依赖。此运行环境没有宣称支持 PPT、OCR、公式重算或 Word 视觉验收。

## 接线与回退

统一入口 `office_text` → 办公工具 `task_json` → `office_task_text` 模板 → 原生文件 Agent。正文直接传任务元数据；原始文件仍由 Dify Agent 的 CLI/Shell 下载、读写、验证、上传。历史 `context_file` 输入保留，旧调用可以回退下载上下文。`materials` 保持原生文件数组。

本地规范文件引用采用带 `=` 填充的 URL-safe Base64；不要使用 Node 不带填充的 `base64url` 直接构造。生成与历史修复使用 `server/dify-file-reference.mjs`。依据 Dify [规范引用实现](https://github.com/langgenius/dify/blob/main/api/core/workflow/file_reference.py)。

`scripts/office-inline-context.mjs` 提供幂等增量变换，保留公司现有分支；不要用旧的全量 Chatflow 构建器覆盖线上电气等分支。办公结果只要求 `reply`，`readyForPreview` 可省略；存在时仍必须为布尔值，真实文件和私密权限校验保持不变。

**每次更新办公 Workflow 已发布图后，还要在“发布为工具”同步最新版本，确认 synced=true。** 仅发布工作流不一定更新工具缓存的图；本次已实际遇到网页继续执行旧Qwen快照、而调试用新版DeepSeek的情况。验收要查看网页真实run的图版本和effective model，不能只看编辑器下拉框。DeepSeek候选虽完成PDF合并，整链Word续改仍失败；最终恢复原Qwen文件模型，保留环境和接线修复，其他分支模型不变。

旧快照 `01a1d30e-c1e1-7343-b7f1-d9415043a513` 保留。每次更改前的已发布图、未发布草稿、Agent 配置和合成运行证据保存在本机忽略目录 `work/runtime-compat-check`。恢复草稿不能覆盖其他人的未发布修改；还原 Agent 快照时也要还原对应的 Home 和 Workflow 绑定。
