"""Disposable loopback fixture for security-browser.mjs; never uses a real library."""
from pathlib import Path
import sys,tempfile,threading,json,io
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'companion'))
from server import GalleryServer,Library
import time
output=ROOT/'.local/qa/security-fixes-0.18.0';output.mkdir(parents=True,exist_ok=True)
stop=output/'fixture-server.stop';stop.unlink(missing_ok=True)
from PIL import Image
with tempfile.TemporaryDirectory(prefix='sart-security-browser-') as t:
 lib=Library(Path(t));b=io.BytesIO();Image.new('RGB',(4,3),'blue').save(b,'JPEG');photo=lib.add(b.getvalue(),'Protected fixture.jpg');server=GalleryServer(('127.0.0.1',0),lib)
 (output/'browser-fixture.json').write_text(json.dumps({'port':server.server_port,'photoId':photo['id']}))
 def watch():
  while not stop.exists():time.sleep(.1)
  server.shutdown()
 threading.Thread(target=watch,daemon=True).start()
 print(json.dumps({'port':server.server_port}),flush=True)
 try:server.serve_forever()
 except KeyboardInterrupt:pass
 finally:server.server_close()
