#!/usr/bin/env python3
"""Render one task-local DOCX into PDF and page PNGs; visual review remains a separate step."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
import zipfile
from docx_audit import audit


def command(argv, deadline, env):
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding='utf-8', errors='replace', env=env,
                               start_new_session=os.name == 'posix')
    try:
        out, err = process.communicate(timeout=max(.1, deadline - time.monotonic()))
    except subprocess.TimeoutExpired:
        if os.name == 'posix':
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        process.communicate()
        raise ValueError('渲染超时，未完成页面检查') from None
    if process.returncode:
        raise ValueError(f'{Path(argv[0]).name}失败：{(err or out)[-1200:]}')
    return out


def preflight(source, target):
    work = Path.cwd().resolve()
    if not source.is_relative_to(work) or not target.is_relative_to(work):
        raise ValueError('输入和预览目录须位于当前任务目录内，请先下载到本任务目录')
    if source.suffix.lower() != '.docx' or not source.is_file() or source.stat().st_size > 20 * 1024 * 1024:
        raise ValueError('仅接受本任务不超过20MB的DOCX文件')
    if target.exists():
        raise ValueError('预览目录已存在，请用新的版本目录以免混用旧页面')
    report = audit(source)
    with zipfile.ZipFile(source) as archive:
        for name in archive.namelist():
            lower = name.lower()
            if any(s in lower for s in ('vbaproject', 'activex/', 'embeddings/', 'afchunk')):
                raise ValueError('不渲染包含宏、嵌入对象或外部内容块的文档')
            if lower.endswith('.rels'):
                for rel in ET.fromstring(archive.read(name)):
                    if rel.get('TargetMode') == 'External' and not rel.get('Type', '').endswith('/hyperlink'):
                        raise ValueError('文档包含外部加载关系，请先使用本地材料副本')
    for tool in ('pdftoppm', 'pdftotext', 'pdfinfo', 'fc-match'):
        if not shutil.which(tool):
            raise ValueError(f'缺少渲染依赖{tool}，请管理员准备环境；尚未完成视觉验收')
    if not Path('/usr/lib/libreoffice/program/libmergedlo.so').is_file():
        raise ValueError('缺少LibreOfficeKit运行库，尚未完成视觉验收')
    return report


def render(source, target, dpi=110, max_pages=8, timeout=150):
    source, target = Path(source).resolve(), Path(target).resolve()
    if not 80 <= dpi <= 150 or not 1 <= max_pages <= 12 or not 10 <= timeout <= 180:
        raise ValueError('渲染参数超限：80–150dpi、1–12页、10–180秒')
    structure = preflight(source, target)
    original_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    deadline = time.monotonic() + timeout
    env = {k: v for k, v in os.environ.items() if k.lower() not in
           ('http_proxy', 'https_proxy', 'all_proxy', 'no_proxy')}
    env.update({'SAL_USE_VCLPLUGIN': 'svp', 'LC_ALL': 'C.UTF-8'})
    fonts = {}
    for font in ('Noto Sans CJK SC', 'Liberation Sans'):
        matched = command(['fc-match', '-f', '%{family}', font], deadline, env).strip()
        if font.lower() not in matched.lower():
            raise ValueError(f'未匹配到需要的字体{font}，实际为{matched}')
        fonts[font] = matched
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.doc-render-', dir=target.parent) as temp:
        temp = Path(temp)
        result = temp / 'result'
        result.mkdir()
        # LOK avoids the CLI's forbidden /tmp IPC socket; profile remains task-local.
        profile = temp / 'profile'
        pdf = result / (source.stem + '.pdf')
        command([sys.executable, str(Path(__file__).with_name('lok_export.py')),
                 str(source), str(pdf), str(profile)], deadline, env)
        if not pdf.is_file() or pdf.stat().st_size == 0:
            raise ValueError('渲染器未产生PDF')
        info = command(['pdfinfo', str(pdf)], deadline, env)
        match = re.search(r'^Pages:\s+(\d+)', info, re.MULTILINE)
        if not match or not 1 <= int(match[1]) <= max_pages:
            raise ValueError('实际页数超出本次检查上限，请先缩减或分批处理')
        pages = int(match[1])
        command(['pdftoppm', '-r', str(dpi), '-f', '1', '-l', str(pages), '-png',
                 str(pdf), str(result / 'page')], deadline, env)
        images = sorted(result.glob('page-*.png'), key=lambda p: int(p.stem.split('-')[-1]))
        if len(images) != pages or any(p.stat().st_size == 0 for p in images):
            raise ValueError('逐页图片数量不完整')
        command(['pdftotext', '-layout', '-enc', 'UTF-8', str(pdf), str(result / 'text.txt')], deadline, env)
        if hashlib.sha256(source.read_bytes()).hexdigest() != original_hash:
            raise ValueError('原件在渲染过程中发生变化，请重新生成并验证')
        manifest = {'scope': 'rendered_not_visually_reviewed', 'visualVerified': False,
                    'renderer': 'LibreOfficeKit',
                    'sourceSha256': original_hash, 'pages': pages, 'dpi': dpi,
                    'fonts': fonts, 'pdf': pdf.name, 'images': [p.name for p in images],
                    'text': 'text.txt', 'structure': structure,
                    'nextStep': '用图像读取工具逐页查看这些PNG，局部修改后重渲染；本报告本身不证明视觉合格。'}
        (result / 'render_report.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        # Dify's filesystem policy rejects cross-directory renames (EXDEV).
        target.mkdir()
        try:
            for artifact in result.iterdir():
                shutil.copyfile(artifact, target / artifact.name)
        except OSError:
            shutil.rmtree(target)
            raise
    return {'ok': True, 'pages': pages, 'previewDir': str(target),
            'images': [str(target / p) for p in manifest['images']], 'visualVerified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--in', dest='source', required=True)
    parser.add_argument('--out-dir', required=True)
    parser.add_argument('--dpi', type=int, default=110)
    parser.add_argument('--max-pages', type=int, default=8)
    parser.add_argument('--timeout', type=int, default=150)
    args = parser.parse_args()
    try:
        result = render(args.source, args.out_dir, args.dpi, args.max_pages, args.timeout)
    except (OSError, ValueError, zipfile.BadZipFile, ET.ParseError) as exc:
        parser.exit(1, f'渲染失败：{exc}\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
