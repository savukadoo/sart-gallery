"""Authorise an additional owned TV while retaining the app's author identity."""
from pathlib import Path
import os
import secrets
import tempfile

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

from aerotizen import certs


def create_with_existing_author(duid, destination, existing_profile, auth=None):
    destination, existing_profile = Path(destination), Path(existing_profile)
    if destination.exists() and any(destination.iterdir()):
        raise RuntimeError('The destination signing profile must be empty.')
    password = (existing_profile / 'password.txt').read_text().strip().encode()
    author_key, author, author_chain = pkcs12.load_key_and_certificates(
        (existing_profile / 'author.p12').read_bytes(), password)
    if author_key is None or author is None:
        raise RuntimeError('The existing profile has no author signing identity.')
    _, old_distributor, _ = pkcs12.load_key_and_certificates(
        (existing_profile / 'distributor.p12').read_bytes(), password)
    # Retain the existing owned TV's permission in the new certificate so one
    # signed widget can be used on both TVs. The original profile is read-only.
    device_uris = [f'URN:tizen:deviceid={duid}']
    for uri in old_distributor.extensions.get_extension_for_class(
            x509.SubjectAlternativeName).value.get_values_for_type(x509.UniformResourceIdentifier):
        if uri.startswith('URN:tizen:deviceid=') and uri not in device_uris:
            device_uris.append(uri)
    auth = auth or certs.samsung_login()
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, 'TizenSDK'),
        x509.NameAttribute(NameOID.EMAIL_ADDRESS, auth.get('inputEmailID') or ''),
    ])
    csr = certs._csr(key, subject, ['URN:tizen:packageid=', *device_uris])
    fields = {'access_token': auth['access_token'], 'user_id': auth['userId'],
              'platform': 'VD', 'privilege_level': 'public', 'developer_type': 'Individual'}
    profile_xml = certs._post(certs.DIST_V1_URL, fields, 'distributor.csr', csr)
    distributor = certs._load_cert(certs._post(certs.DIST_V3_URL, fields, 'distributor.csr', csr))
    issued_uris = distributor.extensions.get_extension_for_class(
        x509.SubjectAlternativeName).value.get_values_for_type(x509.UniformResourceIdentifier)
    if not set(device_uris).issubset(issued_uris):
        raise RuntimeError('Samsung did not authorise all requested owned TVs.')
    if distributor.public_key().public_numbers() != key.public_key().public_numbers():
        raise RuntimeError('The issued distributor certificate does not match its signing key.')
    dist_ca = certs._load_cert((Path(certs.CA_DIR) / 'vd_tizen_dev_public2.crt').read_bytes())
    new_password = secrets.token_urlsafe(18)
    encryption = serialization.BestAvailableEncryption(new_password.encode())
    files = {
        'author.p12': pkcs12.serialize_key_and_certificates(
            b'author', author_key, author, author_chain, encryption),
        'distributor.p12': pkcs12.serialize_key_and_certificates(
            b'distributor', key, distributor, [dist_ca], encryption),
        'password.txt': new_password.encode(),
        'device-profile.xml': profile_xml,
    }
    _, preserved, _ = pkcs12.load_key_and_certificates(files['author.p12'], new_password.encode())
    if preserved.fingerprint(hashes.SHA256()) != author.fingerprint(hashes.SHA256()):
        raise RuntimeError('The author identity changed; refusing to save the profile.')
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix='.new-tv-profile-', dir=destination.parent) as temporary:
        staging = Path(temporary)
        for name, data in files.items():
            target = staging / name
            target.write_bytes(data)
            target.chmod(0o600)
        # Replace only an empty destination; never overwrite an existing profile.
        if destination.exists():
            destination.rmdir()
        os.rename(staging, destination)
    return destination
