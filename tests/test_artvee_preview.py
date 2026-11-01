from pathlib import Path
import io
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'companion'))
from server import LibraryError, artvee_preview_resource

class ArtveePreviewTests(unittest.TestCase):
    def test_rejects_non_artvee_insecure_private_paid_and_redirector_paths_before_network(self):
        for address in ['http://artvee.com/','https://10.20.30.80/','https://artvee.com.evil.test/','https://user@artvee.com/','https://artvee.com:443/','https://artvee.com/lg/','https://mdl.artvee.com/hdl/paid.jpg','https://artvee.com/dl/../lg/','file:///tmp/example']:
            with self.subTest(address=address), patch('urllib.request.build_opener') as opener:
                with self.assertRaises(LibraryError):artvee_preview_resource(address)
                opener.assert_not_called()

    def test_remote_html_is_returned_only_as_plain_text_and_redirects_are_disabled(self):
        class Reply(io.BytesIO):
            headers={}
        with patch('urllib.request.build_opener') as build:
            build.return_value.open.return_value=Reply(b'<script>untrusted()</script>')
            data,kind=artvee_preview_resource('https://artvee.com/?s=monet&posts_per_page=8&paged=1')
            self.assertEqual(kind,'text/plain; charset=utf-8')
            self.assertIn(b'<script>',data)
            self.assertIsNone(build.call_args.args[0].redirect_request(None,None,None,None,None,None))
            request=build.return_value.open.call_args.args[0]
            self.assertNotIn('Cookie',request.headers)
            self.assertNotIn('Authorization',request.headers)

    def test_caps_streamed_bytes_without_content_length(self):
        class Reply(io.BytesIO):
            headers={}
        with patch('urllib.request.build_opener') as build:
            build.return_value.open.return_value=Reply(b'x'*(512*1024+1))
            with self.assertRaises(LibraryError):artvee_preview_resource('https://artvee.com/?s=monet')

if __name__=='__main__':unittest.main()
