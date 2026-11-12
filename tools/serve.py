# ローカル確認用サーバー: _site を配信し、ないパスは 404.html を返す（GitHub Pages と同じ動き）
import http.server, os, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '_site')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8812
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path) and not os.path.exists(os.path.join(path, 'index.html')) or not os.path.exists(path):
            self.send_response(404); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers()
            return open(os.path.join(ROOT, '404.html'), 'rb')
        return super().send_head()
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
