from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
os.chdir(Path(__file__).resolve().parent)
class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] not in ('/', '/index.html', '/config.json', '/firebase-app-compat.js', '/firebase-auth-compat.js'):
            self.send_error(404)
            return
        super().do_GET()
    def translate_path(self, request_path):
        name = request_path.split('?')[0].lstrip('/')
        if name in ('firebase-app-compat.js', 'firebase-auth-compat.js'):
            return str(Path(__file__).resolve().parents[2] / 'vendor' / 'firebase' / '12.15.0' / name)
        return super().translate_path(request_path)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *args):
        pass
port = int(os.environ.get('SOLS_AUTH_TEST_PORT', '8838'))
print('Open http://localhost:' + str(port) + '/ in your browser. Press Ctrl+C here to stop.')
HTTPServer(('127.0.0.1', port), Handler).serve_forever()
