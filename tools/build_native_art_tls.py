"""Build a separate pinned TLS client without changing the phone HTTPS server."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import hashlib,json,subprocess
from build_tls import ROOT,PIN

archive=Path('/private/tmp/sart-mbedtls.tar.bz2')
assert hashlib.sha256(archive.read_bytes()).hexdigest()==PIN,'Mbed TLS archive changed'
source=ROOT/'.local/tls-build/mbedtls/mbedtls-3.6.7'
clang=ROOT/'.local/tls-build/wasi/wasi-sdk-34.0-arm64-macos/bin/clang'
out=ROOT/'.local/tls-build/native-art-objects';out.mkdir(parents=True,exist_ok=True)
flags=['-Oz','-fvisibility=hidden','-fno-ident','-ffunction-sections','-fdata-sections','-mno-sign-ext','-mno-nontrapping-fptoint','-mno-reference-types','-mno-multivalue','-DMBEDTLS_CONFIG_FILE="native-client-config.h"','-I'+str(ROOT/'tools/tls'),'-I'+str(source/'include'),'-I'+str(source/'library')]
def compile_source(file):
 target=out/(file.stem+'.o');subprocess.run([str(clang),*flags,'-c',str(file),'-o',str(target)],check=True);return target
with ThreadPoolExecutor(max_workers=4) as pool:objects=list(pool.map(compile_source,[*sorted((source/'library').glob('*.c')),ROOT/'tools/tls/native-client.c']))
target=ROOT/'app/native-art-tls.wasm'
exports=['malloc','free','sart_init','sart_destroy','sart_feed','sart_drain','sart_handshake','sart_write','sart_read','sart_notify']
subprocess.run([str(clang),*flags,'-mexec-model=reactor',*map(str,objects),'-Wl,--gc-sections','-Wl,--strip-all','-Wl,--compress-relocations','-Wl,--initial-memory=2097152','-Wl,--max-memory=16777216',*['-Wl,--export='+name for name in exports],'-o',str(target)],check=True)
result={'name':'Mbed TLS native Art client','version':'3.6.7','license':'Apache-2.0','source':'https://github.com/Mbed-TLS/mbedtls/releases/tag/mbedtls-3.6.7','archiveSha256':PIN,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size,'protocol':'TLS 1.2 ECDHE AES-GCM','authentication':'Exact Samsung Content Sharing Service certificate pin; validity checked by host','runtimeDownloads':False}
(ROOT/'app/assets/native-art-tls-license.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
