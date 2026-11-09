import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import zipfile

SCRIPTS = Path(__file__).parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('render_docx', SCRIPTS / 'render_docx.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(path, external=False):
    content_types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    relationships = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    run = '<w:r><w:rPr><w:rFonts w:ascii="Liberation Sans" w:eastAsia="Noto Sans CJK SC"/><w:sz w:val="24"/></w:rPr><w:t>版式核验 SYNTHETIC-482</w:t></w:r>'
    document = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>' + run + '</w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p>' + run + '</w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:bottom="1000" w:left="1000" w:right="1000"/></w:sectPr></w:body></w:document>'
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', content_types)
        archive.writestr('_rels/.rels', relationships)
        archive.writestr('word/document.xml', document)
        if external:
            archive.writestr('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" TargetMode="External" Target="http://127.0.0.1/private.png"/></Relationships>')


class RenderTest(unittest.TestCase):
    def setUp(self):
        self.previous = Path.cwd()
        self.temp = tempfile.TemporaryDirectory()
        os.chdir(self.temp.name)
        fixture('sample.docx')

    def tearDown(self):
        os.chdir(self.previous)
        self.temp.cleanup()

    def test_local_scope_and_active_content(self):
        with self.assertRaises(ValueError):
            module.preflight(Path('sample.docx').resolve(), Path.cwd().parent / 'escape')
        fixture('external.docx', external=True)
        with self.assertRaisesRegex(ValueError, '外部加载'):
            module.preflight(Path('external.docx').resolve(), Path('previews').resolve())

    @unittest.skipUnless(Path('/usr/lib/libreoffice/program/libmergedlo.so').is_file() and shutil.which('pdftoppm'), '需要Linux渲染依赖')
    def test_real_render_page_limit_and_concurrent_profiles(self):
        before = Path('sample.docx').read_bytes()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda name: module.render('sample.docx', name, dpi=100, max_pages=2), ['one', 'two']))
        for result in results:
            self.assertEqual(result['pages'], 2)
            self.assertFalse(result['visualVerified'])
            self.assertEqual(len(result['images']), 2)
            report = json.loads((Path(result['previewDir']) / 'render_report.json').read_text('utf-8'))
            self.assertEqual(report['scope'], 'rendered_not_visually_reviewed')
            self.assertIn('版式核验', (Path(result['previewDir']) / 'text.txt').read_text('utf-8'))
        self.assertEqual(Path('sample.docx').read_bytes(), before)
        with self.assertRaisesRegex(ValueError, '页数'):
            module.render('sample.docx', 'too-many', max_pages=1)
        self.assertFalse(Path('too-many').exists())


if __name__ == '__main__':
    unittest.main()
