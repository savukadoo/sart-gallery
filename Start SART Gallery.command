#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"
sart_python="${SART_PYTHON:-}"
if [[ -z "$sart_python" && -x .venv/bin/python3 ]]; then sart_python="$PWD/.venv/bin/python3"; fi
if [[ -z "$sart_python" ]]; then sart_python="$(command -v python3)"; fi
"$sart_python" -c 'import sys, PIL; assert sys.version_info >= (3,11) and int(PIL.__version__.split(".")[0]) >= 13' || { print 'Use Python 3.11+ and install: python3 -m pip install --require-hashes -r requirements.lock'; exit 1; }
exec "$sart_python" companion/server.py --open
