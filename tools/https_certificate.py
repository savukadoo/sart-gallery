"""Issue a public TV certificate. The TV private key is never sent to this tool."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
import argparse
import base64
import ipaddress
import json
import os
import uuid
from cryptography import x509
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID,ExtendedKeyUsageOID

def authority_names(identity, address):
    namespace=identity+'.tv.sart.invalid'
    return [x509.IPAddress(ipaddress.ip_network(str(address)+'/32')),x509.DNSName(namespace),
            x509.RFC822Name(namespace),x509.UniformResourceIdentifier(namespace)]

def issue(request,ip,directory):
    identity=str(uuid.UUID(request['id']))
    address=ipaddress.IPv4Address(ip)
    if not address.is_private or address.is_loopback: raise ValueError('Use the TV’s private LAN IPv4 address')
    public=serialization.load_der_public_key(base64.b64decode(request['spki'],validate=True))
    if not isinstance(public,ec.EllipticCurvePublicKey) or public.curve.name!='secp256r1':raise ValueError('Expected a TV-generated P-256 public key')
    directory=Path(directory)/identity;directory.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(directory,0o700)
    private_path=directory/'authority-private.key';root_path=directory/'SART-TV-Trust.cer'
    now=datetime.now(timezone.utc)
    if private_path.exists():
        authority=serialization.load_pem_private_key(private_path.read_bytes(),None)
        root=x509.load_der_x509_certificate(root_path.read_bytes())
        constraints=root.extensions.get_extension_for_class(x509.NameConstraints).value
        if constraints.permitted_subtrees!=authority_names(identity,address) or constraints.excluded_subtrees is not None:
            raise ValueError('This legacy authority needs migration. Use a new authority directory and install the replacement public certificate; existing TV trust is unchanged.')
        if root.not_valid_after_utc<now+timedelta(days=398):raise ValueError('The TV authority needs renewal')
        if root.public_key().public_numbers()!=authority.public_key().public_numbers():raise ValueError('Authority key does not match its certificate')
    else:
        authority=ec.generate_private_key(ec.SECP256R1())
        subject=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'SART TV '+identity[:8]+' Local Authority')])
        root=(x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(authority.public_key())
              .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=3650))
              .add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True)
              .add_extension(x509.KeyUsage(False,False,False,False,False,True,True,False,False),critical=True)
              .add_extension(x509.NameConstraints(authority_names(identity,address),None),critical=True)
              .add_extension(x509.SubjectKeyIdentifier.from_public_key(authority.public_key()),critical=False)
              .sign(authority,hashes.SHA256()))
        descriptor=os.open(private_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(descriptor,'wb') as output:output.write(authority.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        root_path.write_bytes(root.public_bytes(serialization.Encoding.DER))
    os.chmod(private_path,0o600)
    name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'SART Gallery TV '+identity[:8])])
    leaf=(x509.CertificateBuilder().subject_name(name).issuer_name(root.subject).public_key(public)
          .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=397))
          .add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True)
          .add_extension(x509.SubjectAlternativeName([x509.IPAddress(address)]),critical=False)
          .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),critical=False)
          .add_extension(x509.KeyUsage(True,False,False,False,False,False,False,False,False),critical=True)
          .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(authority.public_key()),critical=False)
          .sign(authority,hashes.SHA256()))
    leaf.verify_directly_issued_by(root)
    fingerprint=root.fingerprint(hashes.SHA256()).hex().upper()
    public_identity={**request,'ip':ip,'certificate':base64.b64encode(leaf.public_bytes(serialization.Encoding.DER)).decode(),
                     'authorityPolicyVersion':2,
                     'notBefore':int(leaf.not_valid_before_utc.timestamp()*1000),'notAfter':int(leaf.not_valid_after_utc.timestamp()*1000),
                     'rootFingerprint':':'.join(fingerprint[i:i+2] for i in range(0,len(fingerprint),2))}
    (directory/'provision.json').write_text(json.dumps(public_identity,indent=2)+'\n')
    (directory/'server-public.cer').write_bytes(leaf.public_bytes(serialization.Encoding.DER))
    (directory/'SART-TV-Trust.pem').write_bytes(root.public_bytes(serialization.Encoding.PEM))
    return directory,public_identity

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--request',type=Path,required=True)
    parser.add_argument('--ip',required=True)
    parser.add_argument('--directory',type=Path,default=Path(__file__).resolve().parents[1]/'.local/https-v2')
    args=parser.parse_args()
    directory,public=issue(json.loads(args.request.read_text()),args.ip,args.directory)
    print(json.dumps({'publicCertificate':str(directory/'SART-TV-Trust.cer'),'provision':str(directory/'provision.json'),
                      'rootFingerprint':public['rootFingerprint'],'expires':public['notAfter'],'privateKeyExportedFromTV':False},indent=2))
if __name__=='__main__':main()
