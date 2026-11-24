"""Exercise the local Samsung callback without contacting Samsung or a TV."""
from concurrent.futures import ThreadPoolExecutor
import contextlib
import http.client
import io
import json
from pathlib import Path
import queue
import socket
import sys
import time
import unittest
import urllib.parse
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'vendor'))
from aerotizen import certs


class SamsungLoginTests(unittest.TestCase):
    auth = {'access_token': 'test-token', 'userId': 'test-user',
            'inputEmailID': 'test@example.invalid'}

    def run_login(self, exercise, timeout=2, state=None):
        opened = queue.Queue()
        output = io.StringIO()

        def open_browser(url):
            opened.put(url)
            return True

        with patch.object(certs, 'CALLBACK_PORT', 0), \
                patch.object(certs, 'CALLBACK_READ_TIMEOUT_SECONDS', 0.2), \
                patch.object(certs.webbrowser, 'open', side_effect=open_browser), \
                contextlib.redirect_stdout(output), ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(certs.samsung_login, timeout, state=state)
            url = opened.get(timeout=2)
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            self.port = urllib.parse.urlsplit(query['redirect_uri'][0]).port
            self.state = query['state'][0]
            exercise(self.port, self.state)
            result = future.result(timeout=3)

        self.assertNotIn(self.auth['access_token'], output.getvalue())
        self.assertNotIn(self.auth['userId'], output.getvalue())
        return result

    def post(self, port, state, auth=None, headers=None, path=certs.CALLBACK_PATH):
        body = urllib.parse.urlencode({'state': state, 'code': json.dumps(
            self.auth if auth is None else auth)})
        connection = http.client.HTTPConnection('localhost', port, timeout=1)
        try:
            connection.request('POST', path, body, {
                'Content-Type': 'application/x-www-form-urlencoded', **(headers or {})})
            response = connection.getresponse()
            response.read()
            self.assertEqual(response.getheader('Cache-Control'), 'no-store')
            return response.status
        finally:
            connection.close()

    def test_invalid_callbacks_leave_the_sign_in_available(self):
        def exercise(port, state):
            self.assertEqual(self.post(port, 'wrong-state'), 400)
            for auth in ([], {'userId': 'test-user'}, {'access_token': 123, 'userId': 'test-user'},
                         {'access_token': '', 'userId': 'test-user'}):
                self.assertEqual(self.post(port, state, auth), 400)
            self.assertEqual(self.post(port, state), 200)

        self.assertEqual(self.run_login(exercise), self.auth)

    def assert_connection_closed(self, client):
        try:
            self.assertEqual(client.recv(1), b'')
        except ConnectionResetError:
            pass

    def test_bad_request_lengths_are_rejected_before_reading(self):
        def exercise(port, state):
            for length in ('-1', 'invalid', str(certs.MAX_CALLBACK_BYTES + 1)):
                self.assertEqual(self.post(port, state, headers={'Content-Length': length}), 400)
            self.assertEqual(self.post(port, state, headers={'Transfer-Encoding': 'chunked'}), 400)
            self.assertEqual(self.post(port, state), 200)

        self.assertEqual(self.run_login(exercise), self.auth)

    def test_duplicate_fields_and_malformed_json_allow_a_valid_retry(self):
        def exercise(port, state):
            bodies = [urllib.parse.urlencode({'state': state, 'code': '{'}),
                      urllib.parse.urlencode([('state', state), ('state', state),
                                              ('code', json.dumps(self.auth))])]
            for body in bodies:
                connection = http.client.HTTPConnection('localhost', port, timeout=1)
                try:
                    connection.request('POST', certs.CALLBACK_PATH, body)
                    response = connection.getresponse()
                    response.read()
                    self.assertEqual(response.status, 400)
                finally:
                    connection.close()
            self.assertEqual(self.post(port, state), 200)

        self.assertEqual(self.run_login(exercise), self.auth)

    def test_slow_body_cannot_hold_the_callback_open(self):
        def exercise(port, state):
            started = time.monotonic()
            with socket.create_connection(('localhost', port), timeout=1) as client:
                client.sendall(b'POST /signin/callback HTTP/1.1\r\nHost: localhost\r\n'
                               b'Content-Length: 1000\r\n\r\n')
                for _ in range(20):
                    try:
                        client.sendall(b'x')
                    except OSError:
                        break
                    time.sleep(0.03)
                self.assert_connection_closed(client)
            self.assertLess(time.monotonic() - started, 1)
            self.assertEqual(self.post(port, state), 200)

        self.assertEqual(self.run_login(exercise), self.auth)

    def test_incomplete_headers_do_not_block_the_session_deadline(self):
        def exercise(port, _state):
            with socket.create_connection(('localhost', port), timeout=1) as client:
                client.sendall(b'POST /signin/callback HTTP/1.1\r\nHost: local')
                self.assert_connection_closed(client)

        started = time.monotonic()
        with self.assertRaisesRegex(SystemExit, 'did not complete'):
            self.run_login(exercise, timeout=0.15)
        self.assertLess(time.monotonic() - started, 1)
        with self.assertRaises(OSError):
            socket.create_connection(('localhost', self.port), timeout=0.2)

    def test_default_sign_ins_get_different_states(self):
        def exercise(port, state):
            self.assertGreaterEqual(len(state), 32)
            self.assertEqual(self.post(port, state), 200)

        self.run_login(exercise)
        first = self.state
        self.run_login(exercise)
        self.assertNotEqual(first, self.state)

    def test_resumed_sign_in_keeps_its_explicit_state(self):
        resumed = 'a-valid-state-from-an-existing-sign-in-link'

        def exercise(port, state):
            self.assertEqual(state, resumed)
            self.assertEqual(self.post(port, state), 200)

        self.assertEqual(self.run_login(exercise, state=resumed), self.auth)

    def test_browser_failure_closes_the_listener(self):
        with patch.object(certs, 'CALLBACK_PORT', 0), \
                patch.object(certs.webbrowser, 'open', return_value=False), \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(SystemExit, 'Could not open Samsung sign-in'):
                certs.samsung_login(timeout=0.2)


if __name__ == '__main__':
    unittest.main()
