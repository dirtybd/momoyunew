import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

tool = Path(__file__).resolve().parents[1] / 'scripts' / 'office_tools.py'
spec = importlib.util.spec_from_file_location('office_tools', tool)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReadLimitsTests(unittest.TestCase):
    def test_output_bound_does_not_read_remaining_lines(self):
        def lines():
            yield 'x' * 20000
            raise AssertionError('截断后仍继续读取')
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            module._emit_read(lines())
        self.assertLess(len(out.getvalue()), 12100)
        self.assertIn('output_truncated=true', out.getvalue())

    @unittest.skipUnless(importlib.util.find_spec('openpyxl'), 'requires openpyxl')
    def test_xlsx_read_bounded_and_original_unchanged(self):
        from openpyxl import Workbook
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'source.xlsx'
            book = Workbook()
            book.active['A1'] = '证据' * 10000
            book.active['B2'] = '=1+2'
            book.active['AA1'] = '不在本轮列范围'
            book.save(path)
            before = hashlib.sha256(path.read_bytes()).digest()
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                module.cmd_xlsx_read(SimpleNamespace(inp=str(path), sheet='', max_rows=20))
            self.assertLess(len(out.getvalue()), 12100)
            self.assertIn('output_truncated=true', out.getvalue())
            self.assertIn('前24列', out.getvalue())
            self.assertNotIn('不在本轮列范围', out.getvalue())
            self.assertEqual(before, hashlib.sha256(path.read_bytes()).digest())


if __name__ == '__main__':
    unittest.main()
