"""Check official CA acquisition, offline builds and rejection of unverified data."""
from contextlib import contextmanager
from pathlib import Path
import hashlib
import io
import json
import sys
import tempfile
import unittest
import urllib.request
import warnings
import zipfile
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import samsung_ca as ca
import package_app


def zipped(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return stream.getvalue()


MANIFEST = b'Fixture Samsung package licence, for tests only.\n'
FILES = {name: ('Public test certificate: ' + name).encode() for name in ca.CERTIFICATES}


def fixture_archive(certificates=FILES, manifest=MANIFEST):
    jar = zipped({**{'res/ca/' + name: data for name, data in certificates.items()},
                  '../../outside.txt': b'must not be extracted'})
    package = zipped({ca.PLUGIN: jar, 'data/unneeded-tool': b'must not be installed'})
    return zipped({ca.MANIFEST: manifest, ca.PACKAGE: package})


@contextmanager
def fixture_pins(archive):
    with patch.multiple(ca, ARCHIVE_SHA256=hashlib.sha256(archive).hexdigest(),
                        MANIFEST_SHA256=hashlib.sha256(MANIFEST).hexdigest(),
                        CERTIFICATES={name: hashlib.sha256(data).hexdigest()
                                      for name, data in FILES.items()}):
        yield


class SamsungCaTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.archive = self.root / 'official-fixture.zip'
        self.data = fixture_archive()
        self.archive.write_bytes(self.data)

    def test_official_archive_prepares_only_public_certificates_licence_and_source(self):
        with fixture_pins(self.data):
            cache = ca.prepare_samsung_ca(self.root, archive=self.archive)
            self.assertEqual(ca.verify_cache(self.root), cache)
            self.assertEqual(set(p.name for p in cache.iterdir()),
                             {*FILES, ca.LICENCE, ca.RECEIPT})
            self.assertEqual((cache / ca.LICENCE).read_bytes(), MANIFEST)
            self.assertEqual(json.loads((cache / ca.RECEIPT).read_text())['url'], ca.URL)
            for name, expected in FILES.items():
                self.assertEqual((cache / name).read_bytes(), expected)
        self.assertFalse((self.root / 'outside.txt').exists())

    def test_first_build_downloads_once_and_valid_cache_works_offline(self):
        with fixture_pins(self.data), patch.object(ca, 'download_archive', return_value=self.data) as download:
            cache = ca.prepare_samsung_ca(self.root)
            download.assert_called_once_with()
            download.side_effect = AssertionError('Cached builds must not contact the network')
            self.assertEqual(ca.prepare_samsung_ca(self.root), cache)

    def test_missing_cache_never_falls_back_to_retained_vendor_copies(self):
        vendor = self.root / 'vendor/aerotizen/ca'
        vendor.mkdir(parents=True)
        for name, data in FILES.items():
            (vendor / name).write_bytes(data)
        with fixture_pins(self.data), patch.object(ca, 'download_archive', side_effect=RuntimeError('Offline')):
            with self.assertRaisesRegex(RuntimeError, 'Offline'):
                ca.prepare_samsung_ca(self.root)
        self.assertFalse(ca.cache_directory(self.root).exists())

    def test_corrupt_cached_certificate_stops_the_build_without_network_fallback(self):
        with fixture_pins(self.data):
            cache = ca.prepare_samsung_ca(self.root, archive=self.archive)
            (cache / next(iter(FILES))).write_bytes(b'Changed certificate')
            with patch.object(ca, 'download_archive') as download:
                with self.assertRaisesRegex(RuntimeError, 'missing or invalid'):
                    ca.prepare_samsung_ca(self.root)
                download.assert_not_called()

    def test_invalid_archive_cannot_replace_a_working_cache(self):
        with fixture_pins(self.data):
            cache = ca.prepare_samsung_ca(self.root, archive=self.archive)
            before = {p.name: p.read_bytes() for p in cache.iterdir()}
            self.archive.write_bytes(self.data + b'Unexpected change')
            with self.assertRaisesRegex(RuntimeError, 'archive checksum'):
                ca.prepare_samsung_ca(self.root, archive=self.archive)
            self.assertEqual(before, {p.name: p.read_bytes() for p in cache.iterdir()})

    def test_certificates_and_licence_are_verified_individually(self):
        variants = (fixture_archive({**FILES, next(iter(FILES)): b'Wrong certificate'}),
                    fixture_archive(manifest=b'Wrong licence manifest'))
        for data, expected in zip(variants, ('certificate checksum', 'manifest checksum')):
            with self.subTest(expected=expected), fixture_pins(data):
                self.archive.write_bytes(data)
                with self.assertRaisesRegex(RuntimeError, expected):
                    ca.prepare_samsung_ca(self.root, archive=self.archive)
                self.assertFalse(ca.cache_directory(self.root).exists())

    def test_missing_source_record_and_symlinked_certificates_are_rejected(self):
        with fixture_pins(self.data):
            cache = ca.prepare_samsung_ca(self.root, archive=self.archive)
            receipt = (cache / ca.RECEIPT).read_bytes()
            (cache / ca.RECEIPT).write_text('{}')
            with self.assertRaisesRegex(RuntimeError, 'missing or invalid'):
                ca.verify_cache(self.root)
            (cache / ca.RECEIPT).unlink()
            with self.assertRaisesRegex(RuntimeError, 'missing or invalid'):
                ca.verify_cache(self.root)
            (cache / ca.RECEIPT).write_bytes(receipt)
            name = next(iter(FILES))
            (self.root / 'external.cer').write_bytes(FILES[name])
            (cache / name).unlink()
            (cache / name).symlink_to(self.root / 'external.cer')
            with self.assertRaisesRegex(RuntimeError, 'missing or invalid'):
                ca.verify_cache(self.root)

    def test_archive_members_and_streams_have_size_and_duplicate_limits(self):
        with self.assertRaisesRegex(RuntimeError, 'size limit'):
            ca.bounded_read(io.BytesIO(b'1234'), 3)
        with zipfile.ZipFile(io.BytesIO(zipped({'member': b'1234'}))) as archive:
            with self.assertRaisesRegex(RuntimeError, 'oversized'):
                ca.checked_member(archive, 'member', 3)
        stream = io.BytesIO()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(stream, 'w') as archive:
                archive.writestr('member', b'one')
                archive.writestr('member', b'two')
        with zipfile.ZipFile(io.BytesIO(stream.getvalue())) as archive:
            with self.assertRaisesRegex(RuntimeError, 'duplicate'):
                ca.checked_member(archive, 'member', 10)
        with patch.object(ca.time, 'monotonic', side_effect=[0, 121]):
            with self.assertRaisesRegex(RuntimeError, 'time limit'):
                ca.bounded_read(io.BytesIO(b''), 3)

    def test_download_refuses_unofficial_and_insecure_redirects(self):
        handler = ca.OfficialRedirects()
        request = urllib.request.Request(ca.URL)
        for url in ('http://download.tizen.org/file.zip', 'https://evil.example/file.zip',
                    'https://download.tizen.org.evil.example/file.zip',
                    'https://user@download.tizen.org/file.zip',
                    'https://download.tizen.org:444/file.zip',
                    'https://download.tizen.org:invalid/file.zip'):
            with self.subTest(url=url), self.assertRaisesRegex(RuntimeError, 'official HTTPS host'):
                handler.redirect_request(request, None, 302, 'Found', {}, url)

    def test_download_rejects_oversized_responses_and_unexpected_final_hosts(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.geturl.return_value = ca.URL
        response.headers = {'Content-Length': str(ca.MAX_ARCHIVE_BYTES + 1)}
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(ca.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaisesRegex(RuntimeError, 'invalid size'):
                ca.download_archive()
            response.geturl.return_value = 'https://evil.example/file.zip'
            with self.assertRaisesRegex(RuntimeError, 'official HTTPS host'):
                ca.download_archive()

    def test_build_checks_prerequisite_before_writing_any_package_files(self):
        with patch.object(package_app, 'ROOT', self.root), \
                patch.object(package_app, 'DIST', self.root / 'dist'), \
                patch.object(package_app, 'prepare_samsung_ca',
                             side_effect=RuntimeError('Prerequisite failed')) as prepare:
            with self.assertRaisesRegex(RuntimeError, 'Prerequisite failed'):
                package_app.build()
            prepare.assert_called_once_with(self.root)
        self.assertFalse((self.root / 'dist').exists())


if __name__ == '__main__':
    unittest.main()
