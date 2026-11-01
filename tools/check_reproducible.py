"""Build twice and compare unsigned package bytes; never signs or installs."""
import hashlib
from package_app import build


if __name__ == '__main__':
    target = build()
    first = hashlib.sha256(target.read_bytes()).hexdigest()
    target = build()
    second = hashlib.sha256(target.read_bytes()).hexdigest()
    if first != second:
        raise RuntimeError('Unsigned widget changed between identical builds')
    print('Reproducible unsigned widget: ' + first)
