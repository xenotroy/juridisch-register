"""Loopback-only static preview, sharing raw sources without duplicate copies."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from download import ROOT

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parsed = unquote(urlparse(path).path)
        if parsed.startswith('/raw/'):
            base = (ROOT / 'data/raw').resolve()
            target = (base / parsed.removeprefix('/raw/')).resolve()
        else:
            base = (ROOT / 'app/dist').resolve()
            target = (base / parsed.lstrip('/')).resolve()
        if not target.is_relative_to(base):
            return str(ROOT / '__forbidden__')
        return str(target)
    def list_directory(self, path):
        self.send_error(403, 'Directory listings disabled')
        return None
    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Cache-Control','no-cache')
        super().end_headers()

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8846);p.add_argument('--open',action='store_true');args=p.parse_args()
    if not (ROOT / 'app/dist/index.html').exists():
        p.error('Build app first: npm run build in app/')
    url=f'http://127.0.0.1:{args.port}'
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'Juridisch register: {url}',flush=True)
    if args.open:
        import webbrowser
        webbrowser.open(url)
    server.serve_forever()
