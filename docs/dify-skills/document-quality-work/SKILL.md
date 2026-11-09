---
name: document-quality-work
description: 生成双语Word表单、资料表或报告，局部修改后回读、渲染并逐页检查，通过office-file-work交付真实文件。
---

# 文档制作与检查

1. 沿用用户模板和真实事实，缺少填写值留空。新表单先调用document_plan；多处修改用document_edit_plan；实际成品文字用document_content_review。工具只返回计划或内容检查，不生成文件。参数错误最多纠正重试一次；其他失败如实报告，保留原件，不循环缩减或丢弃用户事实。
2. 使用office-file-work私有venv和本轮output_prefix，生成真实Word表格并另存新版。正文10.5–11pt，表格先调列宽再缩字号；Latin用Liberation Sans、eastAsia用Noto Sans CJK SC并写入w:rFonts。标题黑色无默认边框，行高可扩展，跨页重复表头。按指定页数先分配信息和附件空间；用途、必填规则仅用用户明确提供的内容。
3. 在当前任务目录执行 `dify-agent config skills pull document-quality-work --to "$PWD/.doc-quality" --json`，以返回目录赋给SKILL。用 `PY="$HOME/.venv-office/bin/python"` 执行：

```sh
"$PY" "$SKILL/scripts/docx_audit.py" --in "$OUT" --out audit.json
"$PY" "$SKILL/scripts/render_docx.py" --in "$OUT" --out-dir "$PWD/preview-v1" --max-pages 8
```

输入和预览均在当前任务目录；每次改版用新的预览目录。回读文字、字段和职责，核对原件未变。脚本输出PDF、page-N.png、text.txt与报告；visualVerified=false代表还需看图。
4. 每页PNG实际运行 `dify-agent file upload`，将返回对象原样作为document_visual_review的page_image，例如 `{"transfer_method":"tool_file","reference":"上传返回的真实引用"}`；page_context说明预期内容及检查重点。page_image必传对象，不是引用字符串、文件路径或数组。内部PNG不加output_prefix。逐页核对缺字、截断、边界、分页和附件空间；revise则局部修正后重新渲染检查，最多两轮。unreadable/失败须说明未完成视觉检查，不用像素读取或结构报告代替看图，不编造文件ID。
5. 按office-file-work上传实际成品，最终遵守主Agent JSON协议，intent=help、card=null；简述交付与检查范围。保留旧版，仅在用户同意后转互助。LibreOffice和模型辅助检查不保证所有Office版本显示一致。

## 工作流输入

三个文字工具的task_json必须是JSON字符串，只含下列字段；format仅选docx/xlsx/pptx，页数写进constraints数组。复核另加draft_text，必须来自实际成品回读；修改用实际原文定位。

```json
{"goal":"制作两人双语资料表","format":"docx","source_text":"授权事实，个人信息留空","template_notes":"参考布局","constraints":["A4两页","原件不覆盖"]}
```

只有goal必填，其他字段可省略；文字型字段用字符串，constraints用字符串数组。goal≤4000字，source_text/draft_text各≤24000字，template_notes≤2000字，constraints≤16项且每项≤400字。超长材料说明实际处理范围。内容复核scope=content_only，不能当作视觉验收；PPT执行能力另行配置。
