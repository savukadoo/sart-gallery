"""Run layout/navigation tests with an isolated loopback gallery."""
from pathlib import Path
import argparse
import os
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'companion'))
from server import GalleryServer, Library


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--screenshots', action='store_true', help='Capture public README images instead of layout checks')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='sart-ci-gallery-') as directory:
        server = GalleryServer(('127.0.0.1', 0), Library(Path(directory)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            env = {**os.environ, 'SART_TEST_URL': 'http://127.0.0.1:' + str(server.server_port),
                   'SART_PLAYWRIGHT': 'playwright'}
            script = 'tests/documentation-screenshots.mjs' if args.screenshots else 'tests/settings-layout-browser.mjs'
            subprocess.run(['node', script], cwd=ROOT, env=env,
                           check=True, timeout=180)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
