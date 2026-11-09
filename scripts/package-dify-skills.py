"""Package only the reviewed instructions and runtime scripts for Dify."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1] / 'docs' / 'dify-skills'
packages = {
    'office-file-work': ['SKILL.md', 'scripts/office_tools.py'],
    'document-quality-work': ['SKILL.md', 'scripts/docx_audit.py', 'scripts/render_docx.py', 'scripts/lok_export.py'],
}
for name, files in packages.items():
    source = root / name
    target = root / (name + '.zip')
    for item in files:
        path = source / item
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Missing regular source file: {path}')
    with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
        for item in files:
            archive.write(source / item, item)
    with ZipFile(target) as archive:
        assert archive.namelist() == files
        assert archive.testzip() is None
        assert all(archive.read(item) == (source / item).read_bytes() for item in files)
    print(f'{target.name}: {target.stat().st_size} bytes, {len(files)} runtime files')
