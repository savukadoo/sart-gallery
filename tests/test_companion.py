from pathlib import Path
import hashlib
import http.client
import io
import json
import sys
import tempfile
import threading
import unittest
from PIL import Image

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'companion'))
from server import Library, LibraryError, GalleryServer, Handler, normalise_photo


def fixture(size=(80,40),exif=None):
    image=Image.new('RGB',size,(84,111,93))
    data=io.BytesIO()
    image.save(data,'JPEG',exif=exif or b'')
    return data.getvalue()


class ImageTests(unittest.TestCase):
    def test_orientation_is_applied_and_original_exif_is_removed(self):
        exif=Image.Exif();exif[274]=6;exif[315]='Private photographer';exif[270]='Private description'
        data,width,height=normalise_photo(fixture(exif=exif))
        self.assertEqual((width,height),(40,80))
        with Image.open(io.BytesIO(data)) as image:
            self.assertEqual(dict(image.getexif()),{})
            self.assertEqual(image.mode,'RGB')

    def test_large_images_fit_the_tv_bounds_without_stretching(self):
        data,width,height=normalise_photo(fixture((5000,2500)))
        self.assertEqual((width,height),(3840,1920))
        self.assertLess(len(data),12*1024*1024)

    def test_non_images_are_rejected(self):
        for data in (b'',b'<svg onload="alert(1)"></svg>',b'not an image'):
            with self.assertRaises(LibraryError):normalise_photo(data)


class ServerTests(unittest.TestCase):
    def test_plain_http_lan_request_is_rejected_before_token_or_library_access(self):
        handler=Handler.__new__(Handler)
        handler.client_address=('10.20.30.80',12345)
        handler.connection=object()
        responses=[]
        handler.json_response=lambda status,body:responses.append((status,body))
        self.assertFalse(handler.permitted(token=True))
        self.assertEqual(responses[0][0],403)
        self.assertIn('HTTPS',responses[0][1]['error'])

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.library=Library(Path(self.temp.name))
        self.server=GalleryServer(('127.0.0.1',0),self.library)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()

    def request(self,method,path,body=None,headers=None,csrf=True):
        headers=dict(headers or {})
        if csrf and method in {'POST','DELETE'} and path.startswith('/api/manage/'):
            headers.setdefault('X-Sart-Management',self.server.management_token)
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
        conn.request(method,path,body=body,headers=headers)
        response=conn.getresponse();data=response.read();result=(response.status,data,dict(response.getheaders()));conn.close();return result

    def pair(self):
        code=self.library.code()
        status,data,_=self.request('POST','/api/pair',json.dumps({'code':code}),{'Content-Type':'application/json'})
        self.assertEqual(status,200)
        return json.loads(data)['token']

    def test_pair_upload_download_and_revoke_are_real_http_operations(self):
        self.assertEqual(self.request('GET','/api/library')[0],401)
        token=self.pair();headers={'Authorization':'Bearer '+token}
        status,data,_=self.request('POST','/api/manage/photos?name=My%20garden.jpg',fixture(),{'Content-Type':'application/octet-stream'})
        self.assertEqual(status,201);photo=json.loads(data);self.assertEqual(photo['title'],'My garden')
        status,data,_=self.request('GET','/api/library',headers=headers)
        self.assertEqual(status,200);self.assertEqual(len(json.loads(data)['items']),1)
        status,data,meta=self.request('GET','/api/images/'+photo['id'],headers=headers)
        self.assertEqual(status,200);self.assertEqual(meta['Content-Type'],'image/jpeg')
        self.assertEqual(hashlib.sha256(data).hexdigest(),photo['sha256'])
        self.assertEqual(self.request('DELETE','/api/manage/pairings')[0],200)
        self.assertEqual(self.request('GET','/api/library',headers=headers)[0],401)
        self.assertIsNotNone(self.library.image(photo['id']))

    def test_untrusted_origins_and_dns_rebinding_hosts_cannot_manage_photos(self):
        data=fixture()
        self.assertEqual(self.request('POST','/api/manage/photos?name=x.jpg',data,{'Origin':'https://evil.example','Content-Type':'image/jpeg'})[0],403)
        self.assertEqual(self.request('GET','/api/manage/status',headers={'Host':'evil.example'})[0],403)
        self.assertEqual(self.library.manifest(),[])

    def test_invalid_images_and_traversal_do_not_reach_the_filesystem(self):
        self.assertEqual(self.request('POST','/api/manage/photos?name=x.svg',b'<svg/>')[0],400)
        token=self.pair()
        self.assertEqual(self.request('GET','/api/images/../../library.sqlite3',headers={'Authorization':'Bearer '+token})[0],404)
        self.assertEqual(self.library.manifest(),[])

    def test_pairing_code_rotates_and_old_code_cannot_be_reused(self):
        old=self.library.code();self.pair()
        status,_,_=self.request('POST','/api/pair',json.dumps({'code':old}),{'Content-Type':'application/json'})
        self.assertEqual(status,400)
        for _ in range(5):
            self.request('POST','/api/pair',json.dumps({'code':'invalid'}),{'Content-Type':'application/json'})
        status,data,_=self.request('POST','/api/pair',json.dumps({'code':self.library.code()}),{'Content-Type':'application/json'})
        self.assertEqual(status,400);self.assertIn('Too many attempts',json.loads(data)['error'])

    def test_library_survives_server_restart_and_delete_removes_only_selected_file(self):
        one=self.library.add(fixture(),'one.jpg');two=self.library.add(fixture(),'two.jpg')
        reopened=Library(Path(self.temp.name))
        self.assertEqual(len(reopened.manifest()),2)
        self.assertTrue(reopened.remove(one['id']))
        self.assertEqual([p['id'] for p in reopened.manifest()],[two['id']])
        self.assertIsNone(reopened.image(one['id']));self.assertIsNotNone(reopened.image(two['id']))


if __name__=='__main__':unittest.main(verbosity=2)
