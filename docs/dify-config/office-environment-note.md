2026-11-13 公司“同频”办公 Agent 环境实测：Linux x86_64 / CPython 3.12.14。本 Agent 的 Home Snapshot 已预置 `$HOME/.venv-office/bin/python`，包含 python-docx 1.2.0、openpyxl 3.1.5、pypdf 7.0.1、Pillow 13.0.0、reportlab 5.1.0、lxml 6.1.3。已在全新会话导入验证。

办公操作使用该私有解释器。只检查当前操作所需库一次；若缺失，报告环境限制。避免任务中临时在线安装，当前公司沙箱的 uv 缓存跨挂载重命名曾报 Invalid cross-device link。

每轮工作目录独立，旧任务文件不保证存在；续改从本轮 outputHistory 的真实引用重新下载。使用实际 transfer_method（local_file 或 tool_file）。本轮任务正文已直接提供；只在旧入口未提供正文时下载 context_file。

当前未验证 LibreOffice、中文字体或渲染器可用，不能沿用旧平台 Python 3.13、soffice 已就绪等结论。入口已接入原生图片识别；本文件工具的尺寸、编码和结构读取不等于图像内容识别，也不等于生成文档的视觉验收。只有本轮实际取得图像或明确视觉结果才能据其回答；不能断言平台或模型没有视觉能力。原生导出包不包含本次 Home 的 Python 库，迁移环境需先按部署说明准备运行环境，再发布快照。
