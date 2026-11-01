"""Validate the public source, including the standalone Git staging boundary."""
from pathlib import Path
import argparse
import json
import subprocess
import re
from public_files import ROOT, public_files
from check_public_privacy import check_privacy


def check_repository(root=ROOT, tracked=False):
    root = Path(root).resolve()
    result = check_privacy(root)
    def pins(name):
        return dict(re.findall(r'^([A-Za-z0-9_.-]+)==([^\s\\]+)',(root/name).read_text(),re.M))
    locked = pins('requirements.lock')
    for name, version in pins('requirements.txt').items():
        if locked.get(name) != version:
            raise RuntimeError('Python dependency and lockfile disagree: ' + name)
    if tracked:
        top = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=root, text=True).strip()
        if Path(top).resolve() != root:
            raise RuntimeError('Use a standalone SART repository; do not publish surrounding workspace history')
        names = subprocess.check_output(['git', 'ls-files', '--cached', '-z'], cwd=root).decode().split('\0')
        allowed = {p.relative_to(root).as_posix() for p in public_files(root)}
        unexpected = sorted(set(filter(None, names)) - allowed)
        if unexpected:
            raise RuntimeError('Tracked files outside the public boundary: ' + ', '.join(unexpected))
        result['trackedFilesChecked'] = len(set(filter(None, names)))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tracked', action='store_true')
    print(json.dumps(check_repository(tracked=parser.parse_args().tracked), indent=2))
