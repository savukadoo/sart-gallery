"""Read-only publication evidence collector. Writes only local audit artefacts."""
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
import argparse
import base64
import hashlib
import json
import re
import subprocess
import urllib.parse
import urllib.request
import zipfile

from lxml import etree, html
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text())['version']
OUT=ROOT/'.local'/f'publication-audit-{VERSION}'
SOURCES={
 'publication':'https://developer.samsung.com/tv-seller-office/application-publication-process.html',
 'launch':'https://developer.samsung.com/tv-seller-office/checklists-for-distribution/launch-checklist.html',
 'registration':'https://developer.samsung.com/tv-seller-office/guides/applications/registering-application.html',
 'information':'https://developer.samsung.com/tv-seller-office/guides/applications/entering-application-information.html',
 'ui-description':'https://developer.samsung.com/tv-seller-office/checklists-for-distribution/application-ui-description.html',
 'store-images':'https://developer.samsung.com/smarttv/design/app-icons-and-screenshots.html',
 'mandatory':'https://developer.samsung.com/smarttv/develop/development-checklist/mandatory-features.html',
 'common':'https://developer.samsung.com/smarttv/develop/development-checklist/common.html',
 'security':'https://developer.samsung.com/smarttv/develop/guides/fundamentals/application-security.html',
 'screensaver':'https://developer.samsung.com/smarttv/develop/guides/fundamentals/setting-screensaver.html',
 'web-engines':'https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html',
 'network-api':'https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/network-api.html',
 'sockets-api':'https://developer.samsung.com/smarttv/develop/extension-libraries/webassembly/api-reference/tizen-sockets-extension.html',
 'sockets-overview':'https://developer.samsung.com/smarttv/develop/extension-libraries/webassembly/tizen-sockets-extension/tizen-sockets-extension.html',
 'application-accessibility':'https://developer.samsung.com/smarttv/develop/guides/fundamentals/accessibility.html',
 'multitasking':'https://developer.samsung.com/smarttv/develop/guides/fundamentals/multitasking.html',
 'termination':'https://developer.samsung.com/smarttv/develop/guides/fundamentals/terminating-applications.html',
 'certificates':'https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html',
 'abort-signal-data':'https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/AbortSignal.json',
}
NS={'d':'http://www.w3.org/2000/09/xmldsig#'}
def digest(data):return hashlib.sha256(data).hexdigest()
def c14n(element):return etree.tostring(element,method='c14n',exclusive=True,with_comments=False)
def signature(archive,name):
 root=etree.fromstring(archive.read(name),etree.XMLParser(resolve_entities=False,no_network=True))
 certificate=x509.load_der_x509_certificate(base64.b64decode(root.find('.//d:X509Certificate',NS).text))
 signed=root.find('d:SignedInfo',NS)
 certificate.public_key().verify(base64.b64decode(root.find('d:SignatureValue',NS).text),c14n(signed),padding.PKCS1v15(),hashes.SHA512())
 references=[]
 for reference in signed.findall('d:Reference',NS):
  uri=reference.get('URI')
  if uri.startswith('#'):
   nodes=root.xpath('//*[@Id=$id]',id=uri[1:]);assert len(nodes)==1
   transforms=reference.findall('d:Transforms/d:Transform',NS)
   assert [t.get('Algorithm') for t in transforms]==['http://www.w3.org/2006/12/xml-c14n11']
   data=subprocess.run(['/usr/bin/xmllint','--c14n11','-'],input=etree.tostring(nodes[0]),capture_output=True,check=True).stdout
  else:data=archive.read(urllib.parse.unquote(uri))
  assert hashlib.sha512(data).digest()==base64.b64decode(reference.find('d:DigestValue',NS).text),uri
  references.append(uri)
 now=datetime.now(timezone.utc)
 return {'file':name,'rsaSignatureValid':True,'allReferenceDigestsValid':True,'references':len(references),
         'certificateValidNow':certificate.not_valid_before_utc<=now<=certificate.not_valid_after_utc,
         'certificateExpires':certificate.not_valid_after_utc.isoformat(),
         'certificateSha256':certificate.fingerprint(hashes.SHA256()).hex(),
         'trustChainRevocationAndSellerOfficeAcceptanceVerified':False}
def article_text(data):
 doc=html.fromstring(data)
 for element in doc.xpath('//script|//style|//head|//footer'):element.drop_tree()
 headings=doc.xpath('//h1')
 if headings:
  node=headings[0]
  while node.getparent() is not None:
   parent=node.getparent()
   for sibling in list(node.itersiblings(preceding=True)):parent.remove(sibling)
   parent.text='';node=parent
 text='\n'.join(line.strip() for line in doc.text_content().splitlines() if line.strip())
 for marker in ('Supported Devices','Quick Link','Manage Your Cookies','SAMSUNG and Cookies'):
  if marker in text:text=text.split(marker,1)[0]
 return text
def collect_sources(keys=None):
 folder=OUT/'sources';folder.mkdir(parents=True,exist_ok=True)
 def fetch(item):
  key,url=item
  try:
   request=urllib.request.Request(url,headers={'User-Agent':'SART Gallery publication evidence review'})
   with urllib.request.urlopen(request,timeout=25) as response:data=response.read();resolved=response.url
   (folder/(key+('.json' if key.endswith('-data') else '.html'))).write_bytes(data)
   if key.endswith('-data'):text=data.decode()
   else:text=article_text(data)
   (folder/(key+'.txt')).write_text(text)
   return key,{'url':url,'resolvedUrl':resolved,'fetched':True,'bytes':len(data),'sha256':digest(data),'textFile':str((folder/(key+'.txt')).relative_to(ROOT))}
  except Exception as error:return key,{'url':url,'fetched':False,'error':str(error)}
 index=OUT/'source-index.json'
 records=json.loads(index.read_text()) if keys and index.exists() else {}
 with ThreadPoolExecutor(max_workers=4) as pool:
  for future in as_completed([pool.submit(fetch,item) for item in SOURCES.items() if not keys or item[0] in keys]):
   key,value=future.result();records[key]=value
 return records
def local_evidence():
 signed_path=ROOT/'dist'/f'SART-Gallery-{VERSION}-signed.wgt'
 unsigned_path=ROOT/'dist'/f'SART-Gallery-{VERSION}-unsigned.wgt'
 with zipfile.ZipFile(signed_path) as signed,zipfile.ZipFile(unsigned_path) as unsigned:
  assert signed.testzip() is None and unsigned.testzip() is None
  names=signed.namelist();assert len(names)==len(set(names))
  signatures=[signature(signed,name) for name in ('author-signature.xml','signature1.xml')]
  payload=[name for name in names if name not in ('author-signature.xml','signature1.xml')]
  assert set(payload)==set(unsigned.namelist())
  assert all(signed.read(name)==unsigned.read(name) for name in payload)
  assert all((ROOT/'dist/widget'/name).read_bytes()==signed.read(name) for name in payload)
  config=etree.fromstring(signed.read('config.xml'));widget_ns={'w':'http://www.w3.org/ns/widgets','t':'http://tizen.org/ns/widgets'}
  app=config.find('t:application',widget_ns)
  configuration={'version':config.get('version'),'application':dict(app.attrib),'name':config.find('w:name',widget_ns).text,
    'features':[dict(e.attrib) for e in config.findall('w:feature',widget_ns)],'privileges':[e.get('name') for e in config.findall('t:privilege',widget_ns)],
    'settings':[dict(e.attrib) for e in config.findall('t:setting',widget_ns)],'access':[dict(e.attrib) for e in config.findall('w:access',widget_ns)]}
  assert configuration['version']==VERSION
  # Compare source payload without rebuilding or changing the signed package.
  direct=['index.html','styles.css','config.xml','icon.png','runtime-config.js','qr-vendor.js']
  source_match={name:(ROOT/'app'/name).read_bytes()==signed.read(name) for name in direct}
  import importlib.util
  spec=importlib.util.spec_from_file_location('sart_package_audit',ROOT/'tools/package_app.py');packager=importlib.util.module_from_spec(spec);spec.loader.exec_module(packager)
  module_source='\n'.join('// '+module+'\n'+packager.script_source(ROOT/'app'/module) for module in packager.MODULES)
  expected=f'/* SART Gallery {VERSION} — bundled locally; no runtime dependencies. */\n(function(){{\n\'use strict\';\n'+module_source+'\n})();\n'
  source_match['bundle.js']=expected.encode()==signed.read('bundle.js')
  phone_js=packager.script_source(ROOT/'app/mobile-shared.mjs')+'\n'+packager.script_source(ROOT/'mobile/mobile.mjs')
  mobile_assets={'/':{'body':(ROOT/'mobile/index.html').read_text(),'type':'text/html'},
    '/mobile.css':{'body':(ROOT/'mobile/mobile.css').read_text(),'type':'text/css'},
    '/mobile.js':{'body':'(function(){\n'+phone_js+'\n})();','type':'text/javascript'},
    '/icon.png':{'base64':base64.b64encode((ROOT/'app/icon.png').read_bytes()).decode(),'type':'image/png'}}
  worker='const MOBILE_ASSETS='+json.dumps(mobile_assets)+';\n'+packager.script_source(ROOT/'app/mobile-http.mjs')+'\n'+packager.script_source(ROOT/'app/mobile-native.mjs')
  source_match['mobile-worker.js']=worker.encode()==signed.read('mobile-worker.js')
  source_match['bundled-assets']=all((ROOT/'app'/name).is_file() and (ROOT/'app'/name).read_bytes()==signed.read(name) for name in payload if name.startswith('assets/'))
  with Image.open(ROOT/'app/icon.png') as icon:embedded_icon={'dimensions':list(icon.size),'mode':icon.mode,'bytes':(ROOT/'app/icon.png').stat().st_size}
  inventory=[]
  for folder in ('app','design','.local/qa'):
   for path in (ROOT/folder).rglob('*'):
    if path.suffix.lower() not in {'.png','.jpg','.jpeg','.pptx'}:continue
    row={'path':str(path.relative_to(ROOT)),'bytes':path.stat().st_size,'suffix':path.suffix.lower()}
    if path.suffix.lower()!='.pptx':
     try:
      with Image.open(path) as image:row.update(dimensions=list(image.size),mode=image.mode,format=image.format)
     except OSError:continue
    inventory.append(row)
  asset_sources=json.loads((ROOT/'app/assets/provenance.json').read_text())
  installation=json.loads((ROOT/'.local/installation.json').read_text())
  report={'version':VERSION,'package':{'path':str(signed_path.relative_to(ROOT)),'bytes':signed_path.stat().st_size,'sha256':digest(signed_path.read_bytes()),
   'zipIntegrity':True,'uniqueEntries':True,'entries':len(names),'requiredFilesPresent':True,'signedPayloadMatchesUnsigned':True,'payloadMatchesDist':True,
   'submissionFilenameConforms':bool(re.fullmatch(r'[A-Za-z0-9_ ]{1,96}\.wgt',signed_path.name))},
   'signatures':signatures,'configuration':configuration,'sourceMatchesSignedWidget':source_match,'embeddedIcon':embedded_icon,
   'assetInventory':inventory,'uiDescriptionPptx':[row for row in inventory if row['suffix']=='.pptx'],
   'storeIconDimensionCandidates':[row for row in inventory if row.get('dimensions') in ([512,423],[1920,1080]) and row['suffix']=='.png' and row['bytes']<=300000],
   'screenshotJpegCandidates':[row for row in inventory if row.get('dimensions') in ([1280,720],[1920,1080]) and row['suffix'] in ('.jpg','.jpeg') and row['bytes']<=500000],
   'installation':installation,'installedArchiveMatches':installation['packageSha256']==digest(signed_path.read_bytes()),
   'provenanceType':type(asset_sources).__name__}
  return report
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--fetch-sources',action='store_true');parser.add_argument('--source',action='append',choices=list(SOURCES));args=parser.parse_args()
 OUT.mkdir(parents=True,exist_ok=True)
 report=local_evidence();report['checkedUtc']=datetime.now(timezone.utc).isoformat()
 if args.fetch_sources or args.source:
  report['sources']=collect_sources(args.source);(OUT/'source-index.json').write_text(json.dumps(report['sources'],indent=2)+'\n')
 (OUT/'evidence.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'version':VERSION,'signedPackageVerified':all(s['rsaSignatureValid'] for s in report['signatures']),
  'sourceMatches':all(report['sourceMatchesSignedWidget'].values()),'installedArchiveMatches':report['installedArchiveMatches'],
  'pptx':len(report['uiDescriptionPptx']),'screenshotJpegCandidates':len(report['screenshotJpegCandidates']),
  'sourcesFetched':sum(s['fetched'] for s in report.get('sources',{}).values()),'evidence':str((OUT/'evidence.json').relative_to(ROOT))},indent=2))
if __name__=='__main__':main()
