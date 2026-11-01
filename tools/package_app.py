"""Create the self-contained Tizen widget and reproducible unsigned package."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import re
import shutil
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT/'package.json').read_text())['version']
APP = ROOT/'app'
DIST = ROOT/'dist'
MODULES = ('compat.mjs','response-limits.mjs','core.mjs','storage.mjs','platform.mjs','assets/catalog.mjs','mobile-shared.mjs','native-art-library.mjs','native-composition.mjs','native-art.mjs','native-art-manager.mjs','uploads-manager.mjs','mobile-http.mjs','mobile-setup.mjs','mobile-identity.mjs','mobile-host.mjs','slideshow.mjs','find-art-sources.mjs','find-art.mjs','find-sources-manager.mjs','find-art-batch.mjs','help.mjs','main.mjs')

def script_source(path):
    content=path.read_text()
    content=re.sub(r'^import .+;\s*$', '',content,flags=re.M)
    return re.sub(r'\bexport (?=(?:const|let|function|async function|class)\b)','',content)


def build(library_url=None):
    widget = DIST/'widget'
    widget.mkdir(parents=True,exist_ok=True)
    source=[]
    for module in MODULES:
        content=(APP/module).read_text()
        content=re.sub(r'^import .+;\s*$', '',content,flags=re.M)
        content=re.sub(r'\bexport (?=(?:const|let|function|async function|class)\b)','',content)
        source.append('// '+module+'\n'+content)
    (widget/'bundle.js').write_text(f"/* SART Gallery {VERSION} — bundled locally; no runtime dependencies.\n * SPDX-License-Identifier: AGPL-3.0-only\n * See LICENSE, NOTICE and ARTWORK-RIGHTS.md for scope and third-party terms.\n */\n(function(){{\n'use strict';\n"+'\n'.join(source)+'\n})();\n')
    phone_js=script_source(APP/'mobile-shared.mjs')+'\n'+script_source(ROOT/'mobile/mobile.mjs')
    mobile_assets={'/':{'body':(ROOT/'mobile/index.html').read_text(),'type':'text/html'},
                   '/mobile.css':{'body':(ROOT/'mobile/mobile.css').read_text(),'type':'text/css'},
                   '/mobile.js':{'body':'(function(){\n'+phone_js+'\n})();','type':'text/javascript'},
                   '/icon.png':{'base64':base64.b64encode((APP/'icon.png').read_bytes()).decode(),'type':'image/png'}}
    worker='const MOBILE_ASSETS='+json.dumps(mobile_assets)+';\n'+script_source(APP/'compat.mjs')+'\n'+script_source(APP/'mobile-http.mjs')+'\n'+script_source(APP/'mobile-setup.mjs')+'\n'+script_source(APP/'mobile-tls.mjs')+'\n'+script_source(APP/'mobile-native.mjs')
    (widget/'mobile-worker.js').write_text(worker)
    (widget/'native-art-worker.js').write_text(script_source(APP/'native-art-library.mjs')+'\n'+script_source(APP/'native-art-tls.mjs')+'\n'+script_source(APP/'native-art-worker.mjs'))
    shutil.copy2(APP/'native-art-tls.wasm',widget/'native-art-tls.wasm')
    for name in ('index.html','security-policy.js','styles.css','config.xml','icon.png','runtime-config.js','qr-vendor.js','tls.wasm','tls-LICENSE.txt'):
        shutil.copy2(APP/name,widget/name)
    for name in ('LICENSE','NOTICE','ARTWORK-RIGHTS.md'):
        shutil.copy2(ROOT/name,widget/name)
    shutil.copytree(ROOT/'LICENSES',widget/'LICENSES',dirs_exist_ok=True)
    if library_url:
        (widget/'runtime-config.js').write_text('window.SART_CONFIG = '+json.dumps({'libraryUrl':library_url,'version':VERSION})+';\n')
    assets=widget/'assets'
    assets.mkdir(exist_ok=True)
    expected_assets={file.name for file in (APP/'assets').iterdir() if file.suffix in {'.jpg','.json'}}
    for old in assets.iterdir():
        if old.is_file() and old.suffix in {'.jpg','.json'} and old.name not in expected_assets:
            old.unlink()
    for file in (APP/'assets').iterdir():
        if file.suffix in {'.jpg','.json'}:
            shutil.copy2(file,assets/file.name)
    if ET.parse(widget/'config.xml').getroot().get('version') != VERSION:
        raise RuntimeError('Widget version must match package.json')
    target=DIST/f'SART-Gallery-{VERSION}-unsigned.wgt'
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(widget.rglob('*')):
            if file.is_file():
                info=zipfile.ZipInfo(file.relative_to(widget).as_posix(),date_time=(2026,10,28,0,0,0))
                info.compress_type=zipfile.ZIP_DEFLATED
                archive.writestr(info,file.read_bytes())
    manifest={'name':'SART Gallery','version':VERSION,'license':'AGPL-3.0-only','appId':'SartGal001.Gallery','packageId':'SartGal001',
              'minimumTizen':'6.5','javascriptSyntaxBaseline':'ES2020','platformPackaging':'One shared web widget; optional features detected at runtime',
              'signed':False,'file':target.name,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
              'requirements':'Samsung-issued author/distributor signing profile including the target TV DUID before installation',
              'files':[{ 'path':f.relative_to(widget).as_posix(),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(widget.rglob('*')) if f.is_file()]}
    (DIST/'build.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({key:manifest[key] for key in ('name','version','signed','file','bytes','sha256')},indent=2))
    return target


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--library-url')
    args=parser.parse_args()
    build(args.library_url)
