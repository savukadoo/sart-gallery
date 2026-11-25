"""Prepare Samsung's public CA certificates from the official SDK download."""
from pathlib import Path
import argparse
import hashlib
import io
import json
import os
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '2.0.75'
URL = f'https://download.tizen.org/sdk/extensions/tizen-certificate-extension_{VERSION}.zip'
ARCHIVE_SHA256 = '49f1aa8697e1c98a70a47c4ed232a29538340167bd9cceb121c7bea755045303'
MANIFEST = 'pkg_list_ubuntu-64'
MANIFEST_SHA256 = '3b35686e05c0297248650c11e49dc56634bc8199542056d66d460416b98c6cf9'
PACKAGE = f'binary/cert-add-on_{VERSION}_ubuntu-64.zip'
PLUGIN = 'data/tools/certificate-manager/plugins/org.tizen.common.cert_1.0.0.202510211036.jar'
CERTIFICATES = {
    'vd_tizen_dev_author_ca.cer': 'cdb3fe1ec045513d86fa9257c27b18871f2dd5bdc2a0d65c0c8fdacfa63f44f3',
    'vd_tizen_dev_public2.crt': '64a9295e8676f902253cc00112b51d58fa099aa5f33d33b2050bb55b0caeedbd',
}
MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
MAX_CERTIFICATE_BYTES = 16 * 1024
RECEIPT = 'source.json'
LICENCE = 'Samsung-Certificate-Extension-package.txt'


def official_url(url):
    try:
        value = urllib.parse.urlsplit(url)
        return (value.scheme == 'https' and value.hostname == 'download.tizen.org'
                and value.port in (None, 443) and not value.username and not value.password)
    except ValueError:
        return False


class OfficialRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        if not official_url(newurl):
            raise RuntimeError('Samsung certificate download redirected outside its official HTTPS host.')
        return super().redirect_request(request, fp, code, message, headers, newurl)


def bounded_read(stream, limit):
    data = bytearray()
    deadline = time.monotonic() + 120
    while True:
        if time.monotonic() > deadline:
            raise RuntimeError('Samsung certificate download exceeded its time limit.')
        chunk = stream.read(min(64 * 1024, limit - len(data) + 1))
        if not chunk:
            return bytes(data)
        data.extend(chunk)
        if len(data) > limit:
            raise RuntimeError('Samsung certificate data exceeds its size limit.')


def download_archive():
    print(f'Downloading Samsung Certificate Extension {VERSION} (about 44 MB)…',
          file=sys.stderr, flush=True)
    opener = urllib.request.build_opener(OfficialRedirects())
    request = urllib.request.Request(URL, headers={'User-Agent': 'SART-Gallery-build'})
    try:
        with opener.open(request, timeout=20) as response:
            if not official_url(response.geturl()):
                raise RuntimeError('Samsung certificate download must use its official HTTPS host.')
            length = response.headers.get('Content-Length')
            if length and (not length.isdigit() or int(length) > MAX_ARCHIVE_BYTES):
                raise RuntimeError('Samsung certificate download has an invalid size.')
            return bounded_read(response, MAX_ARCHIVE_BYTES)
    except OSError as error:
        raise RuntimeError(
            'Could not download Samsung certificates. Check the connection, or use '
            'tools/samsung_ca.py --archive with the official 2.0.75 ZIP.') from error


def checked_member(archive, name, limit):
    matches = [info for info in archive.infolist() if info.filename == name]
    if len(matches) != 1 or matches[0].file_size > limit:
        raise RuntimeError('Missing, duplicate or oversized Samsung archive member: ' + name)
    with archive.open(matches[0]) as stream:
        return bounded_read(stream, limit)


def extract_certificates(data):
    if len(data) > MAX_ARCHIVE_BYTES or hashlib.sha256(data).hexdigest() != ARCHIVE_SHA256:
        raise RuntimeError('Samsung Certificate Extension archive checksum does not match the pinned version.')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as outer:
            manifest = checked_member(outer, MANIFEST, 64 * 1024)
            if hashlib.sha256(manifest).hexdigest() != MANIFEST_SHA256:
                raise RuntimeError('Samsung Certificate Extension licence manifest checksum mismatch.')
            package = checked_member(outer, PACKAGE, 20 * 1024 * 1024)
        with zipfile.ZipFile(io.BytesIO(package)) as inner:
            plugin = checked_member(inner, PLUGIN, 10 * 1024 * 1024)
        with zipfile.ZipFile(io.BytesIO(plugin)) as jar:
            files = {name: checked_member(jar, 'res/ca/' + name, MAX_CERTIFICATE_BYTES)
                     for name in CERTIFICATES}
        for name, expected in CERTIFICATES.items():
            if hashlib.sha256(files[name]).hexdigest() != expected:
                raise RuntimeError('Samsung CA certificate checksum mismatch: ' + name)
    except (zipfile.BadZipFile, EOFError, NotImplementedError) as error:
        raise RuntimeError('Invalid Samsung Certificate Extension archive.') from error
    return {**files, LICENCE: manifest}


def cache_directory(root):
    root = Path(root).resolve()
    folders = (root / '.local', root / '.local/samsung-ca', root / '.local/samsung-ca' / VERSION)
    if any(folder.is_symlink() for folder in folders):
        raise RuntimeError('Samsung CA cache must not use symlinked directories.')
    return folders[-1]


def source_record():
    return {'version': VERSION, 'url': URL, 'archiveSha256': ARCHIVE_SHA256,
            'licenceManifestSha256': MANIFEST_SHA256, 'certificates': CERTIFICATES}


def verify_cache(root=ROOT):
    cache = cache_directory(root)
    hashes = {**CERTIFICATES, LICENCE: MANIFEST_SHA256}
    try:
        for name in (*hashes, RECEIPT):
            file = cache / name
            if file.is_symlink() or not file.is_file() or file.stat().st_size > 64 * 1024:
                raise ValueError('Missing or invalid cache file')
        if json.loads((cache / RECEIPT).read_text()) != source_record():
            raise ValueError('Unexpected source record')
        for name, expected in hashes.items():
            if hashlib.sha256((cache / name).read_bytes()).hexdigest() != expected:
                raise ValueError('Checksum mismatch')
    except (OSError, ValueError) as error:
        raise RuntimeError(
            'Samsung CA prerequisite is missing or invalid. Run '
            'python tools/samsung_ca.py --refresh (or --archive with the official ZIP).') from error
    return cache


def prepare_samsung_ca(root=ROOT, *, archive=None, refresh=False):
    cache = cache_directory(root)
    if cache.exists() and archive is None and not refresh:
        return verify_cache(root)
    if archive is None:
        data = download_archive()
    else:
        with Path(archive).open('rb') as stream:
            data = bounded_read(stream, MAX_ARCHIVE_BYTES)
    files = extract_certificates(data)
    # No SDK code is executed or installed. Only verified public data is saved;
    # retained vendor copies are deliberately never a fallback.
    cache.mkdir(parents=True, exist_ok=True)
    files[RECEIPT] = (json.dumps(source_record(), indent=2) + '\n').encode()
    for name, data in files.items():
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=cache, delete=False) as target:
                temporary = Path(target.name)
                target.write(data)
            os.replace(temporary, cache / name)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return verify_cache(root)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--archive', type=Path, help='Use a previously downloaded official 2.0.75 ZIP')
    mode.add_argument('--check', action='store_true', help='Verify the existing cache without downloading')
    mode.add_argument('--refresh', action='store_true', help='Download again and replace the local public CA cache')
    args = parser.parse_args(argv)
    cache = verify_cache() if args.check else prepare_samsung_ca(archive=args.archive, refresh=args.refresh)
    print(json.dumps({'verified': True, 'version': VERSION, 'directory': str(cache.relative_to(ROOT)),
                      'source': URL, 'certificates': list(CERTIFICATES)}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
