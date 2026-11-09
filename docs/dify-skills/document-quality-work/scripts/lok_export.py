"""Export through LibreOfficeKit inside one isolated, bounded child process.

Stable C ABI: LibreOffice include/LibreOfficeKit/LibreOfficeKit.h and Init.h.
The CLI's /tmp/OSL_PIPE socket is denied by Dify's per-task filesystem policy.
"""
import ctypes as C
import os
from pathlib import Path
import sys


class OfficeClass(C.Structure):
    _fields_ = [('size', C.c_size_t), ('destroy', C.CFUNCTYPE(None, C.c_void_p)),
                ('load', C.CFUNCTYPE(C.c_void_p, C.c_void_p, C.c_char_p)),
                ('error', C.CFUNCTYPE(C.c_void_p, C.c_void_p))]


class DocumentClass(C.Structure):
    _fields_ = [('size', C.c_size_t), ('destroy', C.CFUNCTYPE(None, C.c_void_p)),
                ('save', C.CFUNCTYPE(C.c_int, C.c_void_p, C.c_char_p, C.c_char_p, C.c_char_p))]


def vtable(pointer, structure):
    table = C.cast(pointer, C.POINTER(C.POINTER(structure))).contents.contents
    if table.size < C.sizeof(structure):
        raise ValueError('LibreOfficeKit ABI不兼容')
    return table


def export(source, pdf, profile):
    program = Path('/usr/lib/libreoffice/program')
    library = C.CDLL(str(program / 'libmergedlo.so'), mode=os.RTLD_GLOBAL)
    hook = library.libreofficekit_hook_2
    hook.argtypes, hook.restype = [C.c_char_p, C.c_char_p], C.c_void_p
    office = hook(os.fsencode(program), profile.as_uri().encode('utf-8'))
    if not office:
        raise ValueError('LibreOfficeKit初始化失败')
    table, document = vtable(office, OfficeClass), None
    try:
        document = table.load(office, source.as_uri().encode('utf-8'))
        if not document:
            raise ValueError('LibreOfficeKit无法读取文档')
        document_table = vtable(document, DocumentClass)
        try:
            if not document_table.save(document, pdf.as_uri().encode('utf-8'), b'pdf', None):
                raise ValueError('LibreOfficeKit未完成PDF导出')
        finally:
            document_table.destroy(document)
    finally:
        table.destroy(office)


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit('仅由render_docx.py调用：source pdf profile')
    try:
        export(*(Path(p).resolve() for p in sys.argv[1:]))
    except (OSError, ValueError, AttributeError) as exc:
        sys.exit(str(exc))
