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
import re


def _need(mod, hint):
    try:
        return __import__(mod)
    except Exception:
        sys.exit(f"缺少依赖 {mod}，请先按 Skill 的 bootstrap 步骤安装（{hint}）")


def cmd_images2pdf(a):
    _need("PIL", "pillow")
    from PIL import Image
    out = os.path.abspath(a.out)
    if any(os.path.realpath(p) == os.path.realpath(out) for p in a.images):
        sys.exit("原件只读：输出不能覆盖输入")
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


def _replace_in_paragraph(p, find, repl, limit=0):
    """只编辑命中的 run 范围，保留前后文字及其格式。"""
    if not find:
        raise ValueError("查找内容不能为空")
    runs = list(p.runs)
    text = "".join(r.text for r in runs)
    matches = list(re.finditer(re.escape(find), text))
    if limit:
        matches = matches[:limit]
    offsets, offset = [], 0
    for run in runs:
        offsets.append(offset)
        offset += len(run.text)
    for match in reversed(matches):
        first = next(i for i,r in enumerate(runs) if offsets[i] <= match.start() < offsets[i]+len(r.text))
        last = next(i for i,r in enumerate(runs) if offsets[i] < match.end() <= offsets[i]+len(r.text))
        head = runs[first].text[:match.start()-offsets[first]]
        tail = runs[last].text[match.end()-offsets[last]:]
        runs[first].text = head + repl + (tail if first == last else "")
        for i in range(first+1,last):
            runs[i].text = ""
        if first != last:
            runs[last].text = tail
    return len(matches)


def cmd_docx_replace(a):
    docx = _need("docx", "python-docx")
    src = os.path.abspath(a.inp)
    dst = os.path.abspath(a.out)
    if os.path.realpath(src) == os.path.realpath(dst):
        sys.exit("原件只读：--out 不能与 --in 相同")
    d = docx.Document(src)
    total = 0
    visited = set()
    def replace(p):
        nonlocal total
        if p._p in visited or (a.count and total >= a.count):
            return
        visited.add(p._p)
        total += _replace_in_paragraph(p, a.find, a.replace, a.count-total if a.count else 0)
    for p in d.paragraphs:
        replace(p)
    for tb in d.tables:
        for row in tb.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    replace(p)
    if a.header_footer:
        for sec in d.sections:
            for part in (sec.header, sec.footer, sec.first_page_header,
                         sec.first_page_footer, sec.even_page_header,
                         sec.even_page_footer):
                try:
                    for p in part.paragraphs:
                        replace(p)
                    for tb in part.tables:
                        for row in tb.rows:
                            for cell in row.cells:
                                for p in cell.paragraphs:
                                    replace(p)
                except Exception:
                    continue
    if not total:
        sys.exit("未找到指定文字，未生成修改版；请确认原文与位置")
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
    if os.path.realpath(src) == os.path.realpath(dst):
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
