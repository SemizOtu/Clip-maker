#!/usr/bin/env python3
"""Yerel sunucu — Reels Klip Düzenleyici'yi kendi bilgisayarında çalıştırmak için.

Kullanım:
    python dev/serve.py            # http://localhost:8642 açılır
    python dev/serve.py 9000       # farklı port

COOP/COEP başlıklarını gerçek sunucu seviyesinde gönderir; böylece ffmpeg.wasm
çok çekirdekli (hızlı) modda çalışır. İnternet bağlantısı gerekmez.
"""
import http.server
import os
import sys
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):  # sessiz mod: yalnızca hatalar
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    addr = ("127.0.0.1", PORT)
    httpd = http.server.ThreadingHTTPServer(addr, Handler)
    url = f"http://localhost:{PORT}/"
    print(f"🎬 Reels Klip Düzenleyici: {url}  (durdurmak için Ctrl+C)")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nkapatıldı")
