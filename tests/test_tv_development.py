"""Guard owned-TV targeting and preserve the author when adding a test TV."""
from pathlib import Path
import datetime
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT / 'vendor'))
import tv
import tv_signing
import tv_inspector
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID


class DevelopmentIdentityTests(unittest.TestCase):
    def test_malformed_frame_app_status_does_not_break_sdk_cleanup(self):
        with patch.object(tv_inspector.urllib.request, 'urlopen',
                          side_effect=tv_inspector.http.client.BadStatusLine('HTTP/1.1 65535')):
            self.assertIsNone(tv_inspector.app_request('192.0.2.1', 'GET'))

    def test_wrong_model_closes_connection(self):
        connection = MagicMock(banner='device::UA50DU7700WXXY::0')
        with patch.object(tv, 'Sdb') as client:
            client.return_value.connect.return_value = connection
            with self.assertRaisesRegex(RuntimeError, 'identity does not match'):
                tv.device('192.0.2.1', 'QA55LS03BAWXXY')
        connection.close.assert_called_once()

    def test_unregistered_model_never_connects(self):
        with patch.object(tv, 'Sdb') as client:
            with self.assertRaisesRegex(RuntimeError, 'not registered'):
                tv.device('192.0.2.1', 'unregistered')
        client.assert_not_called()

    def test_registered_frame_connects(self):
        connection = MagicMock(banner='device::QA55LS03BAWXXY::0')
        with patch.object(tv, 'Sdb') as client:
            client.return_value.connect.return_value = connection
            self.assertIs(tv.device('192.0.2.1', 'QA55LS03BAWXXY'), connection)

    def test_failed_inspector_identity_never_stops_or_launches_app(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary); (base / '.local').mkdir()
            with patch.object(tv_inspector, 'ROOT', base), \
                    patch.object(sys, 'argv', ['tv_inspector.py', '--tv', '192.0.2.1', '--model', 'QA55LS03BAWXXY']), \
                    patch.object(tv_inspector, 'device', side_effect=RuntimeError('Wrong identity')), \
                    patch.object(tv_inspector, 'app_request') as app:
                with self.assertRaisesRegex(RuntimeError, 'Wrong identity'):
                    tv_inspector.main()
            app.assert_not_called()

    def test_existing_author_and_both_device_permissions_are_preserved(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Test author')])
        now = datetime.datetime.now(datetime.timezone.utc)
        def issue(public_key, subject, uris):
            return (x509.CertificateBuilder().subject_name(subject).issuer_name(name)
                    .public_key(public_key).serial_number(x509.random_serial_number())
                    .not_valid_before(now - datetime.timedelta(minutes=1))
                    .not_valid_after(now + datetime.timedelta(days=1))
                    .add_extension(x509.SubjectAlternativeName([
                        x509.UniformResourceIdentifier(uri) for uri in uris]), False)
                    .sign(key, hashes.SHA256()))
        original = issue(key.public_key(), name, ['URN:tizen:deviceid=owned-crystal'])
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary); source = base / 'existing'; source.mkdir()
            source.joinpath('password.txt').write_text('test-password')
            blob = pkcs12.serialize_key_and_certificates(b'test', key, original, [],
                serialization.BestAvailableEncryption(b'test-password'))
            for file in ('author.p12', 'distributor.p12'):
                source.joinpath(file).write_bytes(blob)
            before = {file.name: file.read_bytes() for file in source.iterdir()}
            requests = []
            def post(url, fields, filename, csr_bytes):
                requests.append(url)
                if url == tv_signing.certs.DIST_V1_URL:
                    return b'<profile />'
                csr = x509.load_pem_x509_csr(csr_bytes)
                uris = csr.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
                return issue(csr.public_key(), csr.subject, uris.get_values_for_type(
                    x509.UniformResourceIdentifier)).public_bytes(serialization.Encoding.PEM)
            with patch.object(tv_signing.certs, '_post', side_effect=post):
                destination = tv_signing.create_with_existing_author('owned-frame', base / 'frame', source,
                    {'access_token': 'test-token', 'userId': 'test-user', 'inputEmailID': 'test@example.invalid'})
            self.assertNotIn(tv_signing.certs.AUTHOR_URL, requests)
            self.assertEqual(before, {file.name: file.read_bytes() for file in source.iterdir()})
            password = destination.joinpath('password.txt').read_bytes()
            _, author, _ = pkcs12.load_key_and_certificates(destination.joinpath('author.p12').read_bytes(), password)
            _, distributor, _ = pkcs12.load_key_and_certificates(destination.joinpath('distributor.p12').read_bytes(), password)
            self.assertEqual(author.fingerprint(hashes.SHA256()), original.fingerprint(hashes.SHA256()))
            self.assertEqual(set(distributor.extensions.get_extension_for_class(x509.SubjectAlternativeName)
                .value.get_values_for_type(x509.UniformResourceIdentifier)), {
                    'URN:tizen:packageid=', 'URN:tizen:deviceid=owned-frame', 'URN:tizen:deviceid=owned-crystal'})
            with patch.object(tv_signing.certs, 'samsung_login') as login:
                with self.assertRaisesRegex(RuntimeError, 'must be empty'):
                    tv_signing.create_with_existing_author('owned-frame', destination, source)
            login.assert_not_called()


if __name__ == '__main__':
    unittest.main()
