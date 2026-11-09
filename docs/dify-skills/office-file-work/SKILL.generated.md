---
name: office-file-work
description: 在会话沙箱里直接生成与修改办公文件——新建/改写 Word(.docx)、改 Excel(.xlsx) 指定单元格、多张图片合并成 PDF、PDF 合并与读取、文件清单整理。原件只读、另存新版本，结果复核后用 dify-agent file upload 回传，文件名以本轮 output_prefix 开头。当用户要求做 Word、合并图片为 PDF、修改 Word/Excel 的部分内容、整理归档文件时使用。
---

# 办公文件制作（office-file-work）

## 什么时候用

- 用户要一份 Word/Excel/PDF 成品：周报、纪要、通知、清单、台账、合并材料。
- 用户要把多张图片（照片、截图、扫描件）合并成一个 PDF。
- 用户要在已有 Word/Excel 上改一部分内容：换一段文字、改一个单元格、加几行数据。
- 用户要整理文件：列清单、按类型归档、批量改名并给出对照表。

## 什么时候不用

- 只是问公式、问怎么操作、要一段可直接复制的文本 → 直接答（help），不用生成文件。
- 用户只是要卡片或需求 → 用需求相关技能，不调用本技能。
- 缺少关键输入（哪几个文件、改哪一处、目标格式）→ 先问，不要凭空造内容。

## 铁律

1. **先做，不先问要不要发需求**。能直接产出就产出，不要用"要不要发布互助需求"挡住交付。
2. **原件只读**。只在读取时打开用户材料；所有改动写入新文件（`--out` 不得等于 `--in`，脚本会拒绝）。不改名、不移动、不删除用户材料。
3. **先检查再交付**。生成后必须用工具回读复核（页数/段落/单元格/行数），不能只看"保存成功"。
4. **回传用 CLI**：`dify-agent file upload PATH`。网页会自动接收工具输出并转成私人下载，不要在 reply 里贴 `public_download_url`、`reference`、内网路径或凭证。
5. **文件名以本轮 `output_prefix` 开头**，例如 `mm-a1b2c3-周报.docx`。没有拿到前缀时用 `mm-<HHMMSS>-名称.ext`。
6. **临时文件留在会话工作目录**（`$TMPDIR` 或当前目录下的临时子目录），不写进共享资料库、不跨会话读取。

## 第 0 步：环境自检（每次任务开始跑一次）

沙箱可能没有预装库，统一用 Agent 私有 venv，**不装到系统目录、不用 sudo**：

```sh
PY=""
for c in "$HOME/.venv-office/bin/python" python3; do
  command -v "$c" >/dev/null 2>&1 && "$c" -c "import PIL,docx,openpyxl,pypdf,reportlab" 2>/dev/null && PY="$c" && break
done
if [ -z "$PY" ]; then
  python3 -m venv "$HOME/.venv-office" \
    && "$HOME/.venv-office/bin/pip" install --no-cache-dir -q pillow python-docx openpyxl pypdf reportlab \
    && PY="$HOME/.venv-office/bin/python"
fi
echo "PY=${PY:-NO_PY}"
```

- 实测可用版本：Pillow 13.0.0、python-docx（docx）、openpyxl 3.1.5、pypdf 6.21.4、reportlab 5.1.0。
- 安装需要访问官方 PyPI；装不上（离线/被墙）就如实说"沙箱缺少 docx/xlsx/pdf 处理库，本次无法生成文件"，并给替代路径（用户自己改 / 转人工），不要假装生成了文件。
- 库只在 venv 内，`python3` 系统环境保持干净；调用时始终写全 `"$PY"` 或 `"$HOME/.venv-office/bin/python"`。

## 第 1 步：准备工具脚本（幂等，只装一次）

优先用技能自带的 `scripts/office_tools.py`；找不到就用附录 A 的源码重建：

```sh
mkdir -p "$HOME/office-tools"
if [ ! -f "$HOME/office-tools/office_tools.py" ]; then
  # 若技能目录可访问：cp <技能目录>/scripts/office_tools.py "$HOME/office-tools/"
  cat > "$HOME/office-tools/office_tools.py" << 'OFFICE_TOOLS_EOF'
# 见附录 A 全文
OFFICE_TOOLS_EOF
fi
TOOL="$HOME/office-tools/office_tools.py"
"$PY" "$TOOL" --help | head -3
```

## 常用命令（均已实测）

| 需求 | 命令 |
| --- | --- |
| 多图合并 PDF | `"$PY" "$TOOL" images2pdf --out "$OUT" a.png b.jpg` |
| 合并多个 PDF | `"$PY" "$TOOL" pdf-merge --out "$OUT" 1.pdf 2.pdf` |
| 读 PDF | `"$PY" "$TOOL" pdf-read --in A.pdf --limit 5` |
| 新建 Word（含标题） | `"$PY" "$TOOL" docx-write --out "$OUT" --title "标题" --from-md body.md` |
| 读 Word 结构 | `"$PY" "$TOOL" docx-read --in A.docx --limit 50` |
| 改 Word 文字 | `"$PY" "$TOOL" docx-replace --in A.docx --out "$OUT" --find "旧" --replace "新" [--header-footer]` |
| 读 Excel | `"$PY" "$TOOL" xlsx-read --in A.xlsx --sheet 台账 --max-rows 20` |
| 改 Excel 单元格 | `"$PY" "$TOOL" xlsx-set --in A.xlsx --out "$OUT" --sheet 台账 --cell B2=已付 --cell C2=999` |
| 整理文件清单 | `"$PY" "$TOOL" organize --dir 目录 --out "$OUT.csv"` |

细节：

- `images2pdf`：一张图一页，页面尺寸=图片像素尺寸（不裁切、不压缩变形），透明 PNG 自动铺白底；输出为 JPEG 92% 内嵌，画质足够看但不适合印刷。
- `docx-replace`：按段落做文本替换，命中处保留原 run 的字体；跨 run 拆分的文字也能命中（会合并到首个 run）；`--header-footer` 同时处理页眉页脚。
- `xlsx-set`：`--cell 单元格=值` 可重复；纯数字自动转数值，`--as text` 强制文本（保留前导零、编号），`=` 开头写入公式。
- `organize`：只读遍历，输出 CSV（相对路径/类型/字节数），不移动文件；用户确认后再谈归档动作。
- 复杂排版（合并单元格样式、图表、目录域）不做自动重排；只做用户明确指出的那几处改动。

## 第 2 步：交付

```sh
OUT="$PWD/${PREFIX}-报告.docx"        # PREFIX 为本轮 output_prefix
"$PY" "$TOOL" docx-write --out "$OUT" --title "周报" --from-md body.md
dify-agent file upload "$OUT"          # 网页自动接收，不要复制返回的 URL 到 reply
```

回复只说：做了什么、文件结构（页数/段落数/单元格数）、复核结果、以及最多两个确实影响交付的待确认项。不要贴下载链接、路径、签名或脚本输出原文。

## 复核清单（必须做）

- PDF：`pdf-read` 看页数；必要时用 pypdf 打印每页 `mediabox` 确认尺寸；纯图片页提取不到文字是正常的。
- DOCX：`docx-read` 比对目标段落的新文本，并确认相邻段落未被改动；改过页眉页脚就单独打印页眉页脚文本。
- XLSX：`xlsx-read` 确认目标单元格新值、其他单元格未变、sheet 名与行列数符合预期。
- 任一复核不通过：不要上传，先修或如实说明。

## 已知限制（如实说明，不要绕过）

- 只支持 `.docx`/`.xlsx`；`.doc`/`.xls` 旧格式需要用户先另存为新格式。
- 不执行宏、文档内脚本、外部链接；不安装 Office、不做打印排版。
- 新写入的 Excel 公式没有缓存值，`data_only` 读回是 `None`，需在 Excel/WPS 打开重算后才有值。
- 不做 OCR：扫描件 PDF、图片里的文字提取不到，只能作为图片合并进 PDF。
- 不处理加密/带密码的文件；不保留 Word 修订痕迹与批注语义（文本级替换）。
- 图片格式取决于 Pillow：PNG/JPEG/BMP/GIF/TIFF 可用，HEIC/RAW/SVG 不可用。
- 版式美化有限：不套企业模板、不做复杂表格合并与图表生成。

## 什么时候建议转互助需求

只有真的做不了，或用户对结果不满意时，才建议转需求：需要人判断/签字/权限、需要现场、需要业务数据或系统访问、需要专业设计排版。建议时说明"我做不到的具体点"，用户明确同意后才创建卡片（intent=request），不擅自建卡、不擅自公开材料内容。

## 附录 A：工具脚本源码（首次安装时写入 `$HOME/office-tools/office_tools.py`）

```python
#!/usr/bin/env python3
"""office_tools.py — 摸摸鱼办公文件小工具（只读原件，另存新版本）

子命令:
  images2pdf  --out OUT.pdf [--page a4|auto] [--fit contain] IMG...
  docx-read   --in A.docx [--limit N]
  docx-replace --in A.docx --out B.docx --find 旧文本 --replace 新文本 [--header-footer]
  docx-write  --out B.docx --title "标题" --from-md TEXT.md
  xlsx-read   --in A.xlsx [--sheet 名称] [--max-rows N]
  xlsx-set    --in A.xlsx --out B.xlsx --cell B2=已付 [--cell C2=12] [--sheet 名称] [--as text|number|auto]
  pdf-merge   --out C.pdf A.pdf B.pdf
  pdf-read    --in A.pdf
  organize    --dir 目录 --out 清单.csv
依赖: pillow python-docx openpyxl pypdf reportlab
"""
import argparse
import csv
import os
import sys


def _need(mod, hint):
    try:
        return __import__(mod)
    except Exception:
        sys.exit(f"缺少依赖 {mod}，请先按 Skill 的 bootstrap 步骤安装（{hint}）")


def cmd_images2pdf(a):
    _need("PIL", "pillow")
    from PIL import Image
    out = os.path.abspath(a.out)
    pages = []
    for p in a.images:
        src = os.path.abspath(p)
        if not os.path.exists(src):
            sys.exit(f"找不到图片: {p}")
        im = Image.open(src)
        im.load()
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        pages.append(im)
    if not pages:
        sys.exit("没有可用的图片")
    first, rest = pages[0], pages[1:]
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    # 用 reportlab 生成真实 PDF，保证每图一页、保持原始分辨率
    _need("reportlab", "reportlab")
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas
    import io
    c = canvas.Canvas(out, pagesize=(first.width, first.height))
    for i, im in enumerate(pages):
        if i:
            c.setPageSize((im.width, im.height))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=92)
        buf.seek(0)
        c.drawImage(ImageReader(buf), 0, 0, width=im.width, height=im.height)
        c.showPage()
    c.save()
    print(f"OK {out} pages={len(pages)}")


def cmd_docx_read(a):
    docx = _need("docx", "python-docx")
    d = docx.Document(os.path.abspath(a.inp))
    paras = [p.text for p in d.paragraphs]
    print(f"paragraphs={len(paras)} tables={len(d.tables)}")
    for i, t in enumerate(paras[: a.limit]):
        print(f"[{i}] {t}")
    for ti, tb in enumerate(d.tables):
        print(f"table{ti} rows={len(tb.rows)} cols={len(tb.columns)}")
        for r in tb.rows[:3]:
            print("  | " + " | ".join(c.text for c in r.cells))


def _replace_in_paragraph(p, find, repl):
    """保留首个 run 的格式，把命中文本替换掉；跨 run 时退化为整段重写。"""
    if find not in p.text:
        return 0
    if find in "".join(r.text for r in p.runs):
        hits = 0
        for r in p.runs:
            if find in r.text:
                r.text = r.text.replace(find, repl)
                hits += 1
        if hits:
            return hits
    new = p.text.replace(find, repl)
    for r in p.runs[1:]:
        r.text = ""
    if p.runs:
        p.runs[0].text = new
    return 1


def cmd_docx_replace(a):
    docx = _need("docx", "python-docx")
    src = os.path.abspath(a.inp)
    dst = os.path.abspath(a.out)
    if src == dst:
        sys.exit("原件只读：--out 不能与 --in 相同")
    d = docx.Document(src)
    total = 0
    for p in d.paragraphs:
        total += _replace_in_paragraph(p, a.find, a.replace)
    for tb in d.tables:
        for row in tb.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    total += _replace_in_paragraph(p, a.find, a.replace)
    if a.header_footer:
        for sec in d.sections:
            for part in (sec.header, sec.footer, sec.first_page_header,
                         sec.first_page_footer, sec.even_page_header,
                         sec.even_page_footer):
                try:
                    for p in part.paragraphs:
                        total += _replace_in_paragraph(p, a.find, a.replace)
                    for tb in part.tables:
                        for row in tb.rows:
                            for cell in row.cells:
                                for p in cell.paragraphs:
                                    total += _replace_in_paragraph(p, a.find, a.replace)
                except Exception:
                    continue
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    d.save(dst)
    print(f"OK {dst} replaced={total}")


def cmd_docx_write(a):
    docx = _need("docx", "python-docx")
    dst = os.path.abspath(a.out)
    d = docx.Document()
    if a.title:
        d.add_heading(a.title, level=0)
    if a.from_md:
        with open(os.path.abspath(a.from_md), encoding="utf-8") as f:
            for line in f.read().splitlines():
                s = line.rstrip()
                if not s.strip():
                    continue
                if s.startswith("### "):
                    d.add_heading(s[4:].strip(), level=3)
                elif s.startswith("## "):
                    d.add_heading(s[3:].strip(), level=2)
                elif s.startswith("# "):
                    d.add_heading(s[2:].strip(), level=1)
                elif s.lstrip().startswith(("- ", "* ")):
                    d.add_paragraph(s.lstrip()[2:], style="List Bullet")
                else:
                    d.add_paragraph(s)
    for line in a.paragraph or []:
        d.add_paragraph(line)
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    d.save(dst)
    print(f"OK {dst} paragraphs={len(d.paragraphs)}")


def _load_xlsx(path):
    openpyxl = _need("openpyxl", "openpyxl")
    return openpyxl.load_workbook(path)


def cmd_xlsx_read(a):
    wb = _load_xlsx(os.path.abspath(a.inp))
    print(f"sheets={wb.sheetnames} active={wb.active.title}")
    ws = wb[a.sheet] if a.sheet else wb.active
    print(f"sheet={ws.title} dims={ws.dimensions} rows={ws.max_row} cols={ws.max_column}")
    for r in ws.iter_rows(min_row=1, max_row=min(ws.max_row, a.max_rows)):
        print(" | ".join("" if c.value is None else str(c.value) for c in r))


def _cast(value, mode):
    if mode == "text":
        return value
    try:
        return float(value) if ("." in value or "e" in value.lower()) else int(value)
    except ValueError:
        return value


def cmd_xlsx_set(a):
    openpyxl = _need("openpyxl", "openpyxl")
    src = os.path.abspath(a.inp)
    dst = os.path.abspath(a.out)
    if src == dst:
        sys.exit("原件只读：--out 不能与 --in 相同")
    pairs = []
    for item in a.cell or []:
        if "=" not in item:
            sys.exit(f"--cell 需要 单元格=值 形式: {item}")
        k, v = item.split("=", 1)
        pairs.append((k.strip(), v))
    if a.cell_ref:
        pairs.append((a.cell_ref, a.value if a.value is not None else ""))
    if not pairs:
        sys.exit("没有要修改的单元格：用 --cell B2=值 或 --cell B2 --value 值")
    wb = openpyxl.load_workbook(src)
    ws = wb[a.sheet] if a.sheet else wb.active
    done = []
    for ref, raw in pairs:
        val = _cast(raw, a.as_)
        ws[ref] = val
        done.append(f"{ref}={val!r}")
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    wb.save(dst)
    print(f"OK {dst} sheet={ws.title} " + " ".join(done))


def cmd_pdf_merge(a):
    pypdf = _need("pypdf", "pypdf")
    dst = os.path.abspath(a.out)
    if any(os.path.abspath(x) == dst for x in a.pdfs):
        sys.exit("输出不能覆盖输入文件")
    w = pypdf.PdfWriter()
    n = 0
    for f in a.pdfs:
        src = os.path.abspath(f)
        if not os.path.exists(src):
            sys.exit(f"找不到文件: {f}")
        r = pypdf.PdfReader(src)
        for pg in r.pages:
            w.add_page(pg)
            n += 1
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    with open(dst, "wb") as fh:
        w.write(fh)
    print(f"OK {dst} pages={n} sources={len(a.pdfs)}")


def cmd_pdf_read(a):
    pypdf = _need("pypdf", "pypdf")
    r = pypdf.PdfReader(os.path.abspath(a.inp))
    print(f"pages={len(r.pages)}")
    for i, pg in enumerate(r.pages[: a.limit]):
        txt = (pg.extract_text() or "").strip()
        print(f"--- page {i+1} ---")
        print(txt[:2000])


def cmd_organize(a):
    src = os.path.abspath(a.dir)
    rows = []
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in ("organized", ".cache")]
        for f in files:
            full = os.path.join(root, f)
            ext = os.path.splitext(f)[1].lower() or "(无扩展名)"
            rows.append((os.path.relpath(full, src), ext.lstrip(".") or "noext",
                         os.path.getsize(full)))
    out = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["相对路径", "类型", "字节数"])
        w.writerows(sorted(rows, key=lambda r: (r[1], r[0])))
    print(f"OK {out} files={len(rows)}")
    for r in sorted(rows, key=lambda r: (r[1], r[0]))[:50]:
        print(f"{r[1]:10s} {r[0]}")


def main():
    p = argparse.ArgumentParser(description="摸摸鱼办公文件工具")
    sp = p.add_subparsers(dest="cmd", required=True)

    s = sp.add_parser("images2pdf"); s.add_argument("--out", required=True)
    s.add_argument("--page", default="auto"); s.add_argument("--fit", default="contain")
    s.add_argument("images", nargs="+"); s.set_defaults(func=cmd_images2pdf)

    s = sp.add_parser("docx-read"); s.add_argument("--in", dest="inp", required=True)
    s.add_argument("--limit", type=int, default=50); s.set_defaults(func=cmd_docx_read)

    s = sp.add_parser("docx-replace"); s.add_argument("--in", dest="inp", required=True)
    s.add_argument("--out", required=True); s.add_argument("--find", required=True)
    s.add_argument("--replace", required=True); s.add_argument("--count", type=int, default=0)
    s.add_argument("--header-footer", dest="header_footer", action="store_true")
    s.set_defaults(func=cmd_docx_replace)

    s = sp.add_parser("docx-write"); s.add_argument("--out", required=True)
    s.add_argument("--title", default=""); s.add_argument("--from-md", default="")
    s.add_argument("--paragraph", action="append"); s.set_defaults(func=cmd_docx_write)

    s = sp.add_parser("xlsx-read"); s.add_argument("--in", dest="inp", required=True)
    s.add_argument("--sheet", default=""); s.add_argument("--max-rows", type=int, default=20)
    s.set_defaults(func=cmd_xlsx_read)

    s = sp.add_parser("xlsx-set"); s.add_argument("--in", dest="inp", required=True)
    s.add_argument("--out", required=True); s.add_argument("--sheet", default="")
    s.add_argument("--cell", action="append", metavar="B2=值")
    s.add_argument("--cell-ref", dest="cell_ref", default="")
    s.add_argument("--value", default=None)
    s.add_argument("--as", dest="as_", default="auto", choices=["auto", "text", "number"])
    s.set_defaults(func=cmd_xlsx_set)

    s = sp.add_parser("pdf-merge"); s.add_argument("--out", required=True)
    s.add_argument("pdfs", nargs="+"); s.set_defaults(func=cmd_pdf_merge)

    s = sp.add_parser("pdf-read"); s.add_argument("--in", dest="inp", required=True)
    s.add_argument("--limit", type=int, default=5); s.set_defaults(func=cmd_pdf_read)

    s = sp.add_parser("organize"); s.add_argument("--dir", required=True)
    s.add_argument("--out", required=True); s.set_defaults(func=cmd_organize)

    a = p.parse_args()
    a.func(a)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        try:
            sys.stdout.close()
        except Exception:
            pass
        os._exit(0)
    except KeyboardInterrupt:
        os._exit(130)
```

## 附录 B：最小兜底（不想装脚本时）

单个动作可以直接内联，功能与脚本等价的最短写法：

```sh
# 两图合成 PDF
"$PY" - <<'EOF'
from PIL import Image
imgs=[Image.open(p).convert("RGB") for p in ["a.png","b.jpg"]]
imgs[0].save("out.pdf", save_all=True, append_images=imgs[1:], resolution=150)
print("pages", len(imgs))
EOF
```

```sh
# 改 Excel 一个单元格（另存）
"$PY" - <<'EOF'
import openpyxl
wb=openpyxl.load_workbook("A.xlsx"); ws=wb["台账"]; ws["B2"]="已付"; wb.save("out.xlsx")
print("saved", ws["B2"].value)
EOF
```

兜底写法不保留复杂格式，正式交付优先用脚本。
