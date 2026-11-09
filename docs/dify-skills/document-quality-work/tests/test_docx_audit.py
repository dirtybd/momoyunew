import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

MODULE = Path(__file__).parents[1] / 'scripts' / 'docx_audit.py'
spec = importlib.util.spec_from_file_location('docx_audit', MODULE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StructureAuditTest(unittest.TestCase):
    def test_structure_report_is_never_a_visual_pass(self):
        xml = '''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Noto Sans CJK SC"/></w:rPr><w:t>合成内容</w:t></w:r></w:p><w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/><w:trHeight w:val="120" w:hRule="exact"/></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="1000" w:right="1000"/></w:sectPr></w:body></w:document>'''
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic.docx'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('word/document.xml', xml)
            before = path.read_bytes()
            result = module.audit(path)
            self.assertEqual(result['tableCount'], 1)
            self.assertTrue(result['tables'][0]['repeatHeader'])
            self.assertEqual(result['tables'][0]['exactHeightRows'], [1])
            self.assertIn('Noto Sans CJK SC', result['explicitFonts'])
            self.assertEqual(result['scope'], 'structure_only')
            self.assertFalse(result['visualVerified'])
            self.assertTrue(result['warnings'])
            self.assertEqual(path.read_bytes(), before)

    def test_non_document_zip_and_invalid_xml_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'invalid.docx'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('other.txt', 'not a document')
            with self.assertRaises(ValueError):
                module.audit(path)
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('word/document.xml', '<broken')
            with self.assertRaises(module.ET.ParseError):
                module.audit(path)


if __name__ == '__main__':
    unittest.main()
