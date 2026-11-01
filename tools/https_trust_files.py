"""Create public manual-trust files. Never install or change device trust."""
from pathlib import Path
from datetime import datetime,timezone
import html
import argparse
import json
import plistlib
import uuid
ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--directory',type=Path,default=ROOT/'dist/TV-certificate')
    directory=parser.parse_args().directory
    info=json.loads((directory/'certificate-info.json').read_text())
    name='SART TV '+info['id'][:8]+' Local Authority'
    profile={'PayloadType':'Configuration','PayloadVersion':1,'PayloadIdentifier':'gallery.sart.tv-trust.'+info['id'],
             'PayloadUUID':str(uuid.uuid4()).upper(),'PayloadDisplayName':'SART Gallery TV certificate',
             'PayloadDescription':'Only the public certificate authority for your SART Gallery TV at '+info['ip']+'. No management, VPN or accounts.',
             'PayloadRemovalDisallowed':False,'PayloadContent':[{'PayloadType':'com.apple.security.root','PayloadVersion':1,
             'PayloadIdentifier':'gallery.sart.root.'+info['id'],'PayloadUUID':str(uuid.uuid4()).upper(),'PayloadDisplayName':name,
             'PayloadCertificateFileName':'SART-TV-Trust.cer','PayloadContent':(directory/'SART-TV-Trust.cer').read_bytes()}]}
    (directory/'SART-TV-Trust.mobileconfig').write_bytes(plistlib.dumps(profile))
    text=(ROOT/'design/https-setup.html').read_text()
    for key,value in {'TV_IP':info['ip'],'CERT_NAME':name,'FINGERPRINT':info['rootFingerprint'],
                      'EXPIRY':datetime.fromtimestamp(info['notAfter']/1000,timezone.utc).strftime('%d %B %Y')}.items():
        text=text.replace('{{'+key+'}}',html.escape(value))
    (directory/'setup.html').write_text(text)
if __name__=='__main__':main()
