import hashlib
import importlib.util
import pathlib
import subprocess
import sys
import tempfile
import unittest

from docx import Document
from PIL import Image
from openpyxl import Workbook, load_workbook
from pypdf import PdfReader

tool = pathlib.Path(sys.argv.pop(1)).resolve()
spec = importlib.util.spec_from_file_location("office_tools", tool)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OfficeToolsTests(unittest.TestCase):
    def run_tool(self, *args):
        return subprocess.run([sys.executable, str(tool), *map(str, args)], capture_output=True, text=True)

    def test_word_cross_runs_preserve_surrounding_format(self):
        doc = Document()
        p = doc.add_paragraph()
        p.add_run("保留粗体 ").bold = True
        p.add_run("旧").italic = True
        p.add_run("文字 和旧文字")
        p.add_run(" 保留下划线").underline = True
        self.assertEqual(module._replace_in_paragraph(p, "旧文字", "已更新"), 2)
        self.assertEqual(p.text, "保留粗体 已更新 和已更新 保留下划线")
        self.assertTrue(p.runs[0].bold)
        self.assertTrue(p.runs[-1].underline)
        self.assertTrue(p.runs[1].italic)

    def test_word_count_and_missing_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = pathlib.Path(tmp)/"input.docx", pathlib.Path(tmp)/"out.docx"
            d = Document(); d.add_paragraph("旧 旧"); d.add_paragraph("邻段不变"); d.save(src)
            self.assertEqual(self.run_tool("docx-replace", "--in", src, "--out", dst, "--find", "旧", "--replace", "新", "--count", "1").returncode, 0)
            self.assertEqual([p.text for p in Document(dst).paragraphs], ["新 旧", "邻段不变"])
            self.assertNotEqual(self.run_tool("docx-replace", "--in", src, "--out", dst, "--find", "不存在", "--replace", "新").returncode, 0)

    def test_images_and_excel_originals_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp); a=root/"a.png"; b=root/"b.png"; pdf=root/"out.pdf"
            Image.new("RGB", (320,200), "red").save(a); Image.new("RGB", (200,320), "blue").save(b)
            original=hashlib.sha256(a.read_bytes()).digest()
            self.assertEqual(self.run_tool("images2pdf", "--out", pdf, a, b).returncode, 0)
            self.assertEqual(len(PdfReader(pdf).pages), 2)
            self.assertEqual(hashlib.sha256(a.read_bytes()).digest(), original)
            self.assertNotEqual(self.run_tool("images2pdf", "--out", a, a, b).returncode, 0)
            src=root/"a.xlsx"; dst=root/"b.xlsx"; wb=Workbook(); ws=wb.active; ws["A1"]="保留"; ws["B2"]=12; ws["C2"]="=B2*2"; wb.save(src)
            before=hashlib.sha256(src.read_bytes()).digest()
            self.assertEqual(self.run_tool("xlsx-set", "--in", src, "--out", dst, "--cell", "B2=99").returncode,0)
            out=load_workbook(dst); self.assertEqual(out.active["B2"].value,99); self.assertEqual(out.active["A1"].value,"保留"); self.assertEqual(out.active["C2"].value,"=B2*2")
            self.assertEqual(hashlib.sha256(src.read_bytes()).digest(),before)


if __name__ == "__main__":
    unittest.main()
