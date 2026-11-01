"""SART Gallery's local photo library. No cloud service or root connection."""
from __future__ import annotations

import argparse
from collections import defaultdict, deque
import hashlib
import hmac
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import ipaddress
import json
from pathlib import Path
import re
import secrets
import socket
import ssl
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
import uuid
import warnings
import webbrowser

from PIL import Image, ImageCms, ImageOps, __version__ as PILLOW_VERSION

PROJECT = Path(__file__).resolve().parents[1]
MAX_UPLOAD = 25 * 1024 * 1024
MAX_LIBRARY = 200 * 1024 * 1024
MAX_PHOTOS = 200
Image.MAX_IMAGE_PIXELS = 60_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)
ID_PATTERN = re.compile(r'^[a-f0-9-]{36}$')


class LibraryError(Exception):
    pass


def artvee_preview_resource(address):
    """Loopback preview only: the packaged TV fetches these public URLs itself."""
    if not isinstance(address, str) or len(address) > 4096:
        raise LibraryError('Unsupported Artvee address.')
    parts = urllib.parse.urlsplit(address)
    image = parts.hostname == 'mdl.artvee.com'
    path_ok = bool(re.fullmatch(r'/(sdl|sftb|ft)/[a-zA-Z0-9_-]+\.jpg', parts.path)) if image else parts.path == '/' or bool(re.fullmatch(r'/dl/[a-z0-9-]+/', parts.path))
    if parts.scheme != 'https' or parts.hostname not in {'artvee.com', 'mdl.artvee.com'} or parts.netloc != parts.hostname or parts.fragment or not path_ok:
        raise LibraryError('Unsupported Artvee address.')
    maximum = 12*1024*1024 if image else 512*1024
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args):
            return None
    request = urllib.request.Request(address, headers={'User-Agent':'SART-Gallery/0.13.0 (local preview)', 'Accept':'image/jpeg' if image else 'text/html'})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
        if int(response.headers.get('Content-Length', '0')) > maximum:
            raise LibraryError('Artvee response is too large.')
        data = response.read(maximum+1)
        if len(data) > maximum:
            raise LibraryError('Artvee response is too large.')
        # Never serve remote HTML as executable content from the preview origin.
        return data, 'image/jpeg' if image else 'text/plain; charset=utf-8'


def normalise_photo(data: bytes) -> tuple[bytes, int, int]:
    if int(PILLOW_VERSION.split('.')[0]) < 13:
        raise LibraryError('Update SART’s Python environment using requirements.lock before importing photos.')
    if not data or len(data) > MAX_UPLOAD:
        raise LibraryError('Choose an image smaller than 25 MB.')
    try:
        with Image.open(io.BytesIO(data), formats=['JPEG', 'PNG', 'WEBP']) as original:
            if original.format not in {'JPEG', 'PNG', 'WEBP'}:
                raise LibraryError('Choose a JPEG, PNG or WebP image.')
            original.load()
            image = ImageOps.exif_transpose(original)
            profile = original.info.get('icc_profile')
            if profile:
                try:
                    image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(io.BytesIO(profile)), ImageCms.createProfile('sRGB'), outputMode='RGB')
                except (ImageCms.PyCMSError, ValueError, TypeError):
                    image = image.convert('RGB')
            elif image.mode in {'RGBA', 'LA'} or (image.mode == 'P' and 'transparency' in image.info):
                rgba = image.convert('RGBA')
                background = Image.new('RGB', rgba.size, (248, 246, 241))
                background.paste(rgba, mask=rgba.getchannel('A'))
                image = background
            else:
                image = image.convert('RGB')
            image.thumbnail((3840, 2160), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            # Save only pixels: EXIF, GPS, comments and original filenames are omitted.
            image.save(output, 'JPEG', quality=90, optimize=True)
            return output.getvalue(), image.width, image.height
    except LibraryError:
        raise
    except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise LibraryError('That image could not be read. Export it as JPEG, PNG or WebP and try again.') from exc


class Library:
    def __init__(self, folder: Path):
        self.folder = folder.resolve()
        self.folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.images = self.folder / 'photos'
        self.images.mkdir(exist_ok=True, mode=0o700)
        self.database = self.folder / 'library.sqlite3'
        self.lock = threading.RLock()
        self.attempts = defaultdict(deque)
        self.pair_code = ''
        self.pair_expires = 0.0
        with self.db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, title TEXT NOT NULL,
                    bytes INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
                    sha256 TEXT NOT NULL, added_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS tokens (digest TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
            ''')

    def db(self):
        return sqlite3.connect(self.database, timeout=10)

    def _rotate_code(self):
        self.pair_code = f'{secrets.randbelow(1_000_000):06d}'
        self.pair_expires = time.monotonic() + 600

    def code(self):
        with self.lock:
            if time.monotonic() >= self.pair_expires:
                self._rotate_code()
            return self.pair_code

    def pair(self, code: str, peer: str):
        with self.lock:
            now = time.monotonic()
            attempts = self.attempts[peer]
            while attempts and attempts[0] < now - 60:
                attempts.popleft()
            if len(attempts) >= 5:
                raise LibraryError('Too many attempts. Wait a minute and enter the code shown on your PC.')
            attempts.append(now)
            if now >= self.pair_expires or not re.fullmatch(r'\d{6}', code) or not hmac.compare_digest(code, self.pair_code):
                raise LibraryError('That code does not match. Use the current six-digit code on your PC.')
            token = secrets.token_urlsafe(32)
            with self.db() as db:
                db.execute('INSERT INTO tokens VALUES (?, ?)', (hashlib.sha256(token.encode()).hexdigest(), int(time.time())))
            self._rotate_code()
            return token

    def authorised(self, token):
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{40,100}', token):
            return False
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.db() as db:
            return db.execute('SELECT 1 FROM tokens WHERE digest=?', (digest,)).fetchone() is not None

    def revoke(self):
        with self.lock, self.db() as db:
            db.execute('DELETE FROM tokens')
            self._rotate_code()

    def manifest(self):
        with self.db() as db:
            rows = db.execute('SELECT id,title,bytes,width,height,sha256,added_at FROM photos ORDER BY added_at DESC,id').fetchall()
        return [{'id': r[0], 'title': r[1], 'bytes': r[2], 'width': r[3], 'height': r[4], 'sha256': r[5], 'addedAt': r[6]} for r in rows]

    def add(self, data, name):
        jpeg, width, height = normalise_photo(data)
        title = Path(name.replace('\\', '/')).stem
        title = ''.join(c for c in title if c.isprintable())[:200].strip() or 'Untitled photograph'
        with self.lock:
            existing = self.manifest()
            if len(existing) >= MAX_PHOTOS or sum(item['bytes'] for item in existing) + len(jpeg) > MAX_LIBRARY:
                raise LibraryError('Your PC library is full. Remove some photos before adding more.')
            photo_id = str(uuid.uuid4())
            destination = self.images / (photo_id + '.jpg')
            destination.write_bytes(jpeg)
            try:
                with self.db() as db:
                    db.execute('INSERT INTO photos VALUES (?,?,?,?,?,?,?)',
                               (photo_id, title, len(jpeg), width, height, hashlib.sha256(jpeg).hexdigest(), int(time.time()*1000)))
            except Exception:
                destination.unlink(missing_ok=True)
                raise
        return next(item for item in self.manifest() if item['id'] == photo_id)

    def image(self, photo_id):
        if not ID_PATTERN.fullmatch(photo_id):
            return None
        with self.db() as db:
            present = db.execute('SELECT 1 FROM photos WHERE id=?', (photo_id,)).fetchone()
        path = self.images / (photo_id + '.jpg')
        return path if present and path.is_file() else None

    def remove(self, photo_id):
        path = self.image(photo_id)
        if not path:
            return False
        with self.lock, self.db() as db:
            db.execute('DELETE FROM photos WHERE id=?', (photo_id,))
            path.unlink(missing_ok=True)
        return True


def configured_tv_ips():
    path=PROJECT/'.local/developer-targets.json'
    return json.loads(path.read_text()).get('allowedTvIps',[]) if path.exists() else []


def local_addresses():
    addresses = {'127.0.0.1'}
    try:
        for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addresses.add(item[4][0])
    except OSError:
        pass
    try:
        # UDP connect selects a route; it sends no packets.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            targets=configured_tv_ips()
            if targets:
                sock.connect((targets[0], 26101))
                addresses.add(sock.getsockname()[0])
    except OSError:
        pass
    return addresses


class GalleryServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, library, tv_ips=None):
        super().__init__(address, Handler)
        self.library = library
        self.tv_ips = set(configured_tv_ips() if tv_ips is None else tv_ips)
        self.hosts = local_addresses() | {'localhost'}
        self.widget = PROJECT / 'dist' / 'widget'
        self.companion = PROJECT / 'companion'
        self.management_token = secrets.token_urlsafe(32)
        self.tls_context = None
        self.handshake_timeout = 5
        self.connection_slots = threading.BoundedSemaphore(16)

    def enable_tls(self, certificate, key):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(certificate, key)
        self.tls_context = context

    def process_request(self, request, client_address):
        if not self.connection_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.connection_slots.release()
            self.shutdown_request(request)
            raise

    def process_request_thread(self, request, client_address):
        try:
            if self.tls_context is not None:
                request = self.tls_context.wrap_socket(request, server_side=True, do_handshake_on_connect=False)
                request.settimeout(self.handshake_timeout)
                request.do_handshake()
            super().process_request_thread(request, client_address)
        except (OSError, ssl.SSLError):
            self.shutdown_request(request)
        finally:
            self.connection_slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = 'SARTGallery/0.1'

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def log_message(self, *_args):
        pass  # Do not log pairing codes, authorisation tokens or photo titles.

    @property
    def loopback(self):
        return ipaddress.ip_address(self.client_address[0]).is_loopback

    def allowed_origin(self, management=False):
        origin = self.headers.get('Origin')
        scheme = 'https' if self.server.tls_context is not None else 'http'
        if management:
            if self.headers.get('Sec-Fetch-Site') not in {None, 'none', 'same-origin'}:
                return False
            return origin is None or origin == f"{scheme}://{self.headers.get('Host', '')}"
        if not origin or origin == 'null':
            return True
        parsed = urllib.parse.urlsplit(origin)
        if parsed.scheme == 'file' or (parsed.scheme in {'app', 'widget'} and parsed.netloc == 'SartGal001'):
            return True
        port = self.server.server_port
        return origin in {f'{scheme}://{host}:{port}' for host in self.server.hosts}

    def permitted(self, management=False, token=False):
        if not self.loopback and not isinstance(self.connection,ssl.SSLSocket):
            self.json_response(403, {'error':'HTTPS is required. Use the TV’s Connect to my PC option for direct uploads.'})
            return False
        host = self.headers.get('Host', '').split(':')[0].lower()
        if host not in self.server.hosts or not self.allowed_origin(management):
            self.json_response(403, {'error': 'This request is not allowed.'})
            return False
        if management and not self.loopback:
            self.json_response(403, {'error': 'Open the upload page directly on your PC.'})
            return False
        if management and self.command in {'POST', 'DELETE'}:
            supplied = self.headers.get('X-Sart-Management', '')
            if not hmac.compare_digest(supplied, self.server.management_token):
                self.json_response(403, {'error': 'Reopen the local PC library page and try again.'})
                return False
        if not self.loopback and self.client_address[0] not in self.server.tv_ips:
            self.json_response(403, {'error': 'This TV is not registered with this PC library.'})
            return False
        if token:
            auth = self.headers.get('Authorization', '')
            if not auth.startswith('Bearer ') or not self.server.library.authorised(auth[7:]):
                self.json_response(401, {'error': 'Reconnect this TV using the code on your PC.'})
                return False
        return True

    def respond(self, status, data=b'', content_type='application/json; charset=utf-8', cache=False):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'private, max-age=3600' if cache else 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        origin = self.headers.get('Origin')
        management = urllib.parse.urlsplit(self.path).path.startswith('/api/manage/')
        if origin and self.allowed_origin(management):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        if self.command == 'OPTIONS':
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Sart-Management')
        self.end_headers()
        if self.command != 'HEAD':
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def json_response(self, status, data):
        self.respond(status, json.dumps(data).encode())

    def read_body(self, maximum):
        if self.headers.get('Transfer-Encoding'):
            raise LibraryError('This upload format is not supported.')
        length = self.headers.get('Content-Length', '')
        if not length.isdigit() or not 0 < int(length) <= maximum:
            raise LibraryError('The upload is empty or too large.')
        data = self.rfile.read(int(length))
        if len(data) != int(length):
            raise LibraryError('The upload did not finish. Please try again.')
        return data

    def static_file(self, root, relative):
        path = (root / urllib.parse.unquote(relative)).resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file():
            self.json_response(404, {'error': 'Not found.'})
            return
        types = {'.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.jpg':'image/jpeg', '.png':'image/png', '.json':'application/json', '.wasm':'application/wasm'}
        if path.suffix not in types:
            self.json_response(404, {'error': 'Not found.'})
            return
        self.respond(200, path.read_bytes(), types[path.suffix])

    def do_OPTIONS(self):
        if self.permitted(management=self.path.startswith('/api/manage/')):
            self.respond(204)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        management = path.startswith('/api/manage/') or path in {'/', '/manage.mjs', '/manage.css'} or path.startswith('/preview/')
        if not self.permitted(management=management, token=path.startswith(('/api/library', '/api/images/'))):
            return
        if path == '/':
            page = (self.server.companion / 'index.html').read_text().replace('__SART_MANAGEMENT_TOKEN__', html.escape(self.server.management_token))
            self.respond(200, page.encode(), 'text/html; charset=utf-8')
        elif path in {'/manage.mjs', '/manage.css'}:
            self.static_file(self.server.companion, path[1:])
        elif path.startswith('/preview/'):
            if path == '/preview/runtime-config.js':
                config = (self.server.widget/'runtime-config.js').read_text()
                self.respond(200, (config+'\nwindow.SART_CONFIG.artveePreviewProxy = true;\n').encode(), 'text/javascript; charset=utf-8')
            else:
                self.static_file(self.server.widget, path[len('/preview/'):] or 'index.html')
        elif path == '/api/manage/artvee':
            try:
                address = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get('url', [''])[0]
                data, content_type = artvee_preview_resource(address)
                self.respond(200, data, content_type)
            except (LibraryError, OSError, ValueError):
                self.json_response(502, {'error':'Artvee could not be reached. Try again.'})
        elif path == '/api/manage/status':
            items = self.server.library.manifest()
            private_ranges = [ipaddress.ip_network(cidr) for cidr in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')]
            scheme='https' if self.server.tls_context is not None else 'http'
            addresses = [f'{scheme}://{host}:{self.server.server_port}' for host in sorted(self.server.hosts)
                         if host not in {'localhost','127.0.0.1'} and any(ipaddress.ip_address(host) in network for network in private_ranges)]
            if scheme=='http': addresses=[]  # Plain HTTP is for local management/preview only.
            self.json_response(200, {'items':items, 'code':self.server.library.code(), 'addresses':addresses, 'limit':MAX_LIBRARY, 'tvIps':sorted(self.server.tv_ips)})
        elif path == '/api/library':
            self.json_response(200, {'items': self.server.library.manifest(), 'version':1})
        elif path.startswith(('/api/images/', '/api/manage/images/')):
            image = self.server.library.image(path.rsplit('/', 1)[-1])
            if image:
                self.respond(200, image.read_bytes(), 'image/jpeg')
            else:
                self.json_response(404, {'error':'Photo not found.'})
        else:
            self.json_response(404, {'error':'Not found.'})

    def do_POST(self):
        parsed = urllib.parse.urlsplit(self.path)
        if not self.permitted(management=parsed.path.startswith('/api/manage/')):
            return
        try:
            if parsed.path == '/api/pair':
                body = json.loads(self.read_body(1024))
                if not isinstance(body, dict) or not isinstance(body.get('code'), str):
                    raise LibraryError('Enter the six-digit code shown on your PC.')
                token = self.server.library.pair(body['code'], self.client_address[0])
                self.json_response(200, {'token':token})
            elif parsed.path == '/api/manage/photos':
                name = urllib.parse.parse_qs(parsed.query).get('name', ['Untitled'])[0]
                photo = self.server.library.add(self.read_body(MAX_UPLOAD), name)
                self.json_response(201, photo)
            else:
                self.json_response(404, {'error':'Not found.'})
        except (LibraryError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            self.json_response(400, {'error': str(exc)})
        except (TimeoutError, socket.timeout):
            self.json_response(408, {'error':'The upload timed out. Please try again.'})

    def do_DELETE(self):
        path = urllib.parse.urlsplit(self.path).path
        if not self.permitted(management=True):
            return
        if path.startswith('/api/manage/photos/'):
            if self.server.library.remove(path.rsplit('/',1)[-1]):
                self.json_response(200, {'removed':True})
            else:
                self.json_response(404, {'error':'Photo not found.'})
        elif path == '/api/manage/pairings':
            self.server.library.revoke()
            self.json_response(200, {'revoked':True})
        else:
            self.json_response(404, {'error':'Not found.'})


def main():
    parser = argparse.ArgumentParser(description='Run SART Gallery’s local PC photo library.')
    parser.add_argument('--host', help='Default: loopback for local HTTP; all interfaces only with TLS')
    parser.add_argument('--port', default=8767, type=int)
    parser.add_argument('--tv-ip', action='append', default=None)
    parser.add_argument('--data', type=Path, default=PROJECT/'.local'/'library')
    parser.add_argument('--open', action='store_true', help='Open the local upload page in your browser')
    parser.add_argument('--tls-cert',type=Path,help='Server certificate chain trusted by the TV')
    parser.add_argument('--tls-key',type=Path,help='Private server key; keep outside the package')
    args = parser.parse_args()
    if bool(args.tls_cert)!=bool(args.tls_key):parser.error('Provide both --tls-cert and --tls-key')
    if args.open and not args.tls_cert:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{args.port}/api/manage/status',timeout=2) as response:
                already_running=response.headers.get('Server','').startswith('SARTGallery/')
            if already_running:
                webbrowser.open(f'http://127.0.0.1:{args.port}')
                print('SART Gallery is already running. Opened your local library.',flush=True)
                return
        except OSError:
            pass
    for tv in (configured_tv_ips() if args.tv_ip is None else args.tv_ip):
        ipaddress.IPv4Address(tv)
    server = GalleryServer((args.host or ('0.0.0.0' if args.tls_cert else '127.0.0.1'),args.port), Library(args.data), args.tv_ip)
    if args.tls_cert:
        server.enable_tls(args.tls_cert, args.tls_key)
    scheme='https' if args.tls_cert else 'http'
    print(f'SART Gallery upload page: {scheme}://127.0.0.1:{server.server_port}', flush=True)
    print(f'TV preview: {scheme}://127.0.0.1:{server.server_port}/preview/', flush=True)
    print('TV clients: '+', '.join(sorted(server.tv_ips)), flush=True)
    if args.open:
        webbrowser.open(f'{scheme}://127.0.0.1:{server.server_port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
