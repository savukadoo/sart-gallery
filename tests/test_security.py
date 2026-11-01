from pathlib import Path
from datetime import datetime,timedelta,timezone
import sys,unittest,tempfile,threading,socket,ssl,io,json,uuid,base64
from unittest.mock import patch
from PIL import Image
from cryptography import x509
from cryptography.x509.verification import PolicyBuilder,Store,VerificationError
from cryptography.hazmat.primitives import serialization,hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID,NameOID
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import test_companion as fixture_tests
from server import GalleryServer,Library,LibraryError,normalise_photo
from https_certificate import issue

class ManagementSecurityTests(unittest.TestCase):
    setUp=fixture_tests.ServerTests.setUp
    tearDown=fixture_tests.ServerTests.tearDown
    request=fixture_tests.ServerTests.request

    def test_opaque_file_and_cross_site_management_requests_are_denied(self):
        photo=self.library.add(fixture_tests.fixture(),'original.jpg')
        for headers in [{'Origin':'null'},{'Origin':'file://'},{'Origin':'app://SartGal001.evil'},{'Sec-Fetch-Site':'cross-site'},{'Sec-Fetch-Site':'same-site'}]:
            with self.subTest(headers=headers):
                self.assertEqual(self.request('GET','/api/manage/status',headers=headers)[0],403)
                self.assertEqual(self.request('DELETE','/api/manage/photos/'+photo['id'],headers=headers)[0],403)
        self.assertIsNotNone(self.library.image(photo['id']))

    def test_management_mutation_requires_current_nonce_and_bootstrap_works(self):
        status,page,_=self.request('GET','/');self.assertEqual(status,200);self.assertIn(self.server.management_token.encode(),page)
        photo=self.library.add(fixture_tests.fixture(),'original.jpg')
        self.assertEqual(self.request('DELETE','/api/manage/photos/'+photo['id'],csrf=False)[0],403)
        self.assertEqual(self.request('DELETE','/api/manage/photos/'+photo['id'],headers={'X-Sart-Management':'old-token'})[0],403)
        self.assertIsNotNone(self.library.image(photo['id']))
        self.assertEqual(self.request('DELETE','/api/manage/photos/'+photo['id'])[0],200)

    def test_old_pillow_is_refused_before_any_decoder_runs(self):
        with patch('server.PILLOW_VERSION','12.3.0'),patch('server.Image.open') as opening:
            with self.assertRaisesRegex(LibraryError,'requirements.lock'):normalise_photo(fixture_tests.fixture())
            opening.assert_not_called()

    def test_image_formats_are_restricted_before_plugins_parse_and_all_supported_formats_work(self):
        for kind in ['JPEG','PNG','WEBP']:
            data=io.BytesIO();Image.new('RGB',(4,3),'blue').save(data,kind)
            original=Image.open
            with patch('server.Image.open',wraps=original) as opening:
                result,w,h=normalise_photo(data.getvalue())
                self.assertEqual(opening.call_args.kwargs['formats'],['JPEG','PNG','WEBP'])
                self.assertEqual((w,h),(4,3));self.assertTrue(result.startswith(b'\xff\xd8'))

class CertificateSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.key=ec.generate_private_key(ec.SECP256R1())
        self.request={'id':str(uuid.uuid4()),'spki':base64.b64encode(self.key.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)).decode()}
        self.directory,self.identity=issue(self.request,'192.168.50.10',self.temp.name)
        self.root=x509.load_der_x509_certificate((self.directory/'SART-TV-Trust.cer').read_bytes())
    def tearDown(self):self.temp.cleanup()
    def leaf(self,name):
        authority=serialization.load_pem_private_key((self.directory/'authority-private.key').read_bytes(),None);now=datetime.now(timezone.utc)
        return (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'fixture')])).issuer_name(self.root.subject).public_key(self.key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(days=1)).add_extension(x509.SubjectAlternativeName([name]),False).add_extension(x509.BasicConstraints(False,None),True).add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(authority.public_key()),False).add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),False).add_extension(x509.KeyUsage(True,False,False,False,False,False,False,False,False),True).sign(authority,hashes.SHA256()))
    def test_ip_works_but_unrelated_dns_and_wrong_ip_fail(self):
        import ipaddress
        store=Store([self.root]);ip=x509.IPAddress(ipaddress.ip_address('192.168.50.10'))
        leaf=x509.load_der_x509_certificate(base64.b64decode(self.identity['certificate']))
        self.assertEqual(len(PolicyBuilder().store(store).build_server_verifier(ip).verify(leaf,[])),2)
        for name in [x509.DNSName('example.com'),x509.IPAddress(ipaddress.ip_address('192.168.50.11'))]:
            with self.assertRaises(VerificationError):PolicyBuilder().store(store).build_server_verifier(name).verify(self.leaf(name),[])
        before=(self.directory/'SART-TV-Trust.cer').read_bytes();issue(self.request,'192.168.50.10',self.temp.name);self.assertEqual((self.directory/'SART-TV-Trust.cer').read_bytes(),before)
    def test_legacy_authority_is_rejected_without_overwriting_existing_files(self):
        import ipaddress
        authority=serialization.load_pem_private_key((self.directory/'authority-private.key').read_bytes(),None)
        builder=(x509.CertificateBuilder().subject_name(self.root.subject).issuer_name(self.root.issuer).public_key(self.root.public_key()).serial_number(self.root.serial_number).not_valid_before(self.root.not_valid_before_utc).not_valid_after(self.root.not_valid_after_utc))
        for extension in self.root.extensions:
            value=x509.NameConstraints([x509.IPAddress(ipaddress.ip_network('192.168.50.10/32'))],None) if isinstance(extension.value,x509.NameConstraints) else extension.value
            builder=builder.add_extension(value,extension.critical)
        (self.directory/'SART-TV-Trust.cer').write_bytes(builder.sign(authority,hashes.SHA256()).public_bytes(serialization.Encoding.DER))
        before={p.name:p.read_bytes() for p in self.directory.iterdir() if p.is_file()}
        with self.assertRaisesRegex(ValueError,'legacy authority needs migration'):issue(self.request,'192.168.50.10',self.temp.name)
        self.assertEqual(before,{p.name:p.read_bytes() for p in self.directory.iterdir() if p.is_file()})
    def test_idle_handshake_does_not_block_other_clients_and_expires(self):
        keyfile=Path(self.temp.name)/'leaf.key';keyfile.write_bytes(self.key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        certfile=Path(self.temp.name)/'leaf.pem';certfile.write_text(ssl.DER_cert_to_PEM_cert((self.directory/'server-public.cer').read_bytes()))
        server=GalleryServer(('127.0.0.1',0),Library(Path(self.temp.name)/'library'));server.enable_tls(certfile,keyfile);server.handshake_timeout=.3
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();raw=socket.create_connection(server.server_address,timeout=1)
        try:
            trust=ssl.create_default_context(cafile=str(self.directory/'SART-TV-Trust.pem'))
            with trust.wrap_socket(socket.create_connection(server.server_address,timeout=2),server_hostname='192.168.50.10') as good:
                good.sendall(('GET /api/manage/status HTTP/1.1\r\nHost: 127.0.0.1:'+str(server.server_port)+'\r\n\r\n').encode())
                self.assertIn(b'200 OK',good.recv(4096))
            raw.settimeout(2);self.assertEqual(raw.recv(1),b'')
        finally:raw.close();server.shutdown();server.server_close();thread.join(timeout=2)

if __name__=='__main__':unittest.main()
