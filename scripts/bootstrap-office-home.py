"""Install the reviewed offline wheels into this Agent's private Home.

Run once in Dify Build mode, then Apply and publish the captured Home Snapshot.
No pip/uv cache, cross-mount rename, or global Python changes are required.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import platform
import subprocess
import sys
import venv
import zipfile


def safe_parts(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name:
        raise ValueError('Unsafe wheel path')
    return path.parts


def install(bundle):
    if sys.platform != 'linux' or sys.version_info[:2] != (3, 12) or platform.machine() != 'x86_64':
        raise RuntimeError('This bundle requires Linux x86_64 / CPython 3.12')
    home = Path.home().resolve()
    target = (home / '.venv-office').resolve()
    if target.parent != home:
        raise RuntimeError('Office runtime must stay directly in this Agent Home')
    with zipfile.ZipFile(bundle) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        wheels = []
        for item in manifest['wheels']:
            safe_parts(item['name'])
            data = archive.read('wheels/' + item['name'])
            if hashlib.sha256(data).hexdigest() != item['sha256']:
                raise ValueError('Wheel checksum mismatch')
            wheels.append(data)
    venv.EnvBuilder(with_pip=False, symlinks=False).create(target)
    python = target / 'bin' / 'python'
    site = target / 'lib' / 'python3.12' / 'site-packages'
    site.mkdir(parents=True, exist_ok=True)
    total = 0
    for data in wheels:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if len(archive.infolist()) > 5000:
                raise ValueError('Too many wheel entries')
            for entry in archive.infolist():
                parts = safe_parts(entry.filename)
                if not parts or entry.is_dir():
                    continue
                if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('Wheel symlinks are not supported')
                if parts[0].endswith('.data'):
                    if len(parts) < 3 or parts[1] not in ('purelib', 'platlib'):
                        continue
                    parts = parts[2:]
                total += entry.file_size
                if total > 200 * 1024 * 1024:
                    raise ValueError('Expanded runtime too large')
                out = site.joinpath(*parts)
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(archive.read(entry))
    probe = "import docx,openpyxl,pypdf,PIL,reportlab,lxml; print('OFFICE_RUNTIME_READY')"
    subprocess.run([str(python), '-c', probe], check=True, timeout=30)
    (home / '.office-runtime-manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    print('private_home_runtime_bytes=' + str(total))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path, required=True)
    install(parser.parse_args().bundle)
