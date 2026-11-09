#!/usr/bin/env python3
"""Inspect explicit DOCX structure only; never certify layout or execute document content."""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
NS = {'w': W[1:-1]}


def audit(path):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [item.filename for item in entries]
        if (len(entries) > 2000 or len(set(names)) != len(names)
                or sum(item.file_size for item in entries) > 64 * 1024 * 1024):
            raise ValueError('文档结构过大或包含重复条目')
        if 'word/document.xml' not in names:
            raise ValueError('不是可识别的DOCX文档')
        document = ET.fromstring(archive.read('word/document.xml'))
        roots = [document]
        if 'word/styles.xml' in names:
            roots.append(ET.fromstring(archive.read('word/styles.xml')))
    fonts = sorted({font for root in roots for item in root.iter(W + 'rFonts')
                    for key in ('ascii', 'hAnsi', 'eastAsia', 'cs')
                    if (font := item.get(W + key))})
    sections = []
    for section in document.iter(W + 'sectPr'):
        size, margins = section.find('w:pgSz', NS), section.find('w:pgMar', NS)
        sections.append({
            'pageSizeTwips': {k: size.get(W + k) for k in ('w', 'h', 'orient')} if size is not None else {},
            'marginsTwips': {k: margins.get(W + k) for k in ('top', 'bottom', 'left', 'right')} if margins is not None else {},
        })
    tables = []
    warnings = []
    for index, table in enumerate(document.iter(W + 'tbl')):
        rows = table.findall('w:tr', NS)
        exact = [i + 1 for i, row in enumerate(rows)
                 if any(h.get(W + 'hRule') == 'exact' for h in row.findall('w:trPr/w:trHeight', NS))]
        if exact:
            warnings.append(f'表格{index + 1}的行{exact}使用固定行高，需渲染检查截断')
        tables.append({'rows': len(rows), 'gridColumns': len(table.findall('w:tblGrid/w:gridCol', NS)),
                       'exactHeightRows': exact,
                       'repeatHeader': bool(rows and rows[0].find('w:trPr/w:tblHeader', NS) is not None)})
    if not fonts:
        warnings.append('未找到显式字体声明，可能依赖主题和运行环境')
    return {'scope': 'structure_only', 'visualVerified': False,
            'paragraphCount': sum(1 for _ in document.iter(W + 'p')),
            'tableCount': len(tables), 'tables': tables, 'sections': sections,
            'explicitFonts': fonts, 'warnings': warnings,
            'note': '不计算真实页数，不判断缺字、字体实际可用性、视觉截断或分页；仍需逐页渲染看图。'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--in', dest='source', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    source, target = Path(args.source).resolve(), Path(args.out).resolve()
    if source == target:
        parser.error('审核报告不能覆盖原件')
    try:
        report = audit(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    except (OSError, ValueError, zipfile.BadZipFile, ET.ParseError) as exc:
        parser.exit(1, f'结构检查失败：{exc}\n')
    print(json.dumps({'ok': True, 'scope': report['scope'], 'visualVerified': False,
                      'tableCount': report['tableCount'], 'warningCount': len(report['warnings'])}))


if __name__ == '__main__':
    main()
