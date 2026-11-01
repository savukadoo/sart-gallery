"""Explicit public source boundary; local hardware evidence is never exported."""
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PRIVATE_TOOLS={'tools/render_engineering_handover.py','tools/render_publication_audit.py',
               'tools/render_security_remediation.py','tools/discover_frame.py'}
TOP_LEVEL=('README.md','CONTRIBUTING.md','SECURITY.md','SUPPORT.md',
           'LICENSE','NOTICE','ARTWORK-RIGHTS.md','package.json',
           'package-lock.json','requirements.txt','requirements.lock',
           'Start SART Gallery.command','.gitignore','.gitattributes')

def public_files(root=ROOT):
    root=Path(root)
    files=[root/name for name in TOP_LEVEL]
    for folder in ('app','mobile','companion','tools','tests','vendor','LICENSES','design','.github'):
        if (root/folder).is_symlink():
            raise RuntimeError('Symlink in public source: '+folder)
        for file in (root/folder).rglob('*'):
            relative=file.relative_to(root).as_posix()
            if file.is_symlink():
                raise RuntimeError('Symlink in public source: '+relative)
            if not file.is_file() or '__pycache__' in file.parts or file.name.startswith('.'):
                continue
            if relative in PRIVATE_TOOLS or (folder=='tests' and file.name.startswith('tv-')):
                continue
            if file.suffix.lower() in {'.p12','.pem','.key','.sqlite3','.pyc'}:
                raise RuntimeError('Private file in public source: '+relative)
            files.append(file)
    for file in files:
        if file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):
            raise RuntimeError('Symlink in public source: '+file.relative_to(root).as_posix())
    return sorted(set(files))
