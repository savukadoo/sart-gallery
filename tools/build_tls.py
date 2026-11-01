"""Build the pinned, locally bundled TLS engine; no runtime downloads.

Download the two official release archives documented in design/https.md first.
Only public library code and build metadata enter app/. Private identities do not.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse
import hashlib
import json
import shutil
import subprocess

ROOT=Path(__file__).resolve().parents[1]
PIN='a7e8bcbec0e6f761b4af24f25677626b35f762f68eef79c08677a363212d11f6'
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--sdk',type=Path,default=ROOT/'.local/tls-build/wasi/wasi-sdk-34.0-arm64-macos')
    parser.add_argument('--source',type=Path,default=ROOT/'.local/tls-build/mbedtls/mbedtls-3.6.7')
    parser.add_argument('--archive',type=Path,default=Path('/private/tmp/sart-mbedtls.tar.bz2'))
    args=parser.parse_args()
    if hashlib.sha256(args.archive.read_bytes()).hexdigest()!=PIN: raise RuntimeError('Mbed TLS archive hash mismatch')
    out=ROOT/'.local/tls-build/objects';out.mkdir(parents=True,exist_ok=True)
    clang=args.sdk.resolve()/'bin/clang'
    flags=['-Oz','-fvisibility=hidden','-fno-ident','-ffunction-sections','-fdata-sections','-mno-sign-ext','-mno-nontrapping-fptoint','-mno-reference-types','-mno-multivalue',
           '-DMBEDTLS_CONFIG_FILE="config.h"','-I'+str(ROOT/'tools/tls'),'-I'+str(args.source.resolve()/'include'),'-I'+str(args.source.resolve()/'library')]
    sources=sorted((args.source/'library').glob('*.c'))+[ROOT/'tools/tls/server.c']
    def compile_one(src):
        obj=out/(src.stem+'.o');subprocess.run([str(clang),*flags,'-c',str(src),'-o',str(obj)],check=True);return obj
    with ThreadPoolExecutor(max_workers=4) as pool: objects=list(pool.map(compile_one,sources))
    target=ROOT/'app/tls.wasm'
    exports=['malloc','free','sart_init','sart_destroy','sart_open','sart_close','sart_feed','sart_drain','sart_handshake','sart_read','sart_write','sart_notify']
    subprocess.run([str(clang),*flags,'-mexec-model=reactor',*map(str,objects),'-Wl,--gc-sections','-Wl,--strip-all','-Wl,--compress-relocations',
                    '-Wl,--initial-memory=2097152','-Wl,--max-memory=33554432',*['-Wl,--export='+name for name in exports],'-o',str(target)],check=True)
    license_dir=ROOT/'vendor/mbedtls';license_dir.mkdir(parents=True,exist_ok=True)
    shutil.copy2(args.source/'LICENSE',license_dir/'LICENSE.txt')
    metadata={'name':'Mbed TLS','version':'3.6.7','license':'Apache-2.0','source':'https://github.com/Mbed-TLS/mbedtls/releases/tag/mbedtls-3.6.7',
              'archiveSha256':PIN,'wasmSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size,
              'protocol':'TLS 1.2','cipher':'ECDHE-ECDSA-AES128-GCM-SHA256','entropy':'WebCrypto getRandomValues','runtimeDownloads':False}
    (ROOT/'app/assets/tls-license.json').write_text(json.dumps(metadata,indent=2)+'\n')
    shutil.copy2(license_dir/'LICENSE.txt',ROOT/'app/tls-LICENSE.txt')
    print(json.dumps(metadata,indent=2))
if __name__=='__main__':main()
