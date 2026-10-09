# Mini-server per l'anteprima: come "py -m http.server",
# ma dice al browser di NON tenere copie dei file.
import http.server

class SenzaCopie(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

http.server.test(HandlerClass=SenzaCopie, port=8000, bind="127.0.0.1")