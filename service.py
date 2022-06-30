#!/usr/bin/python3 -u

from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from sys import stderr
from urllib.parse import parse_qs, urlparse
from yt_dlp import YoutubeDL
import json

class Handler(BaseHTTPRequestHandler):
    error_message_format = '%(explain)s'

    def __init__(self, *args, **kwargs):
        self.response = ''
        # this actually calls do_GET, so do our own stuff first
        super().__init__(*args, **kwargs)

    def debug(self, msg):
        if msg[:1] == '{' and msg[-1:] == '}':
            self.response += "{}\n".format(msg)
        else:
            print("ydl debug: {}".format(msg), file=stderr)

    def warning(self, msg):
        print("ydl warning: {}".format(msg), file=stderr)
        pass

    def error(self, msg):
        print("ydl error: {}".format(msg), file=stderr)
        pass

    def fail(self, msg):
        print(msg, file=stderr)
        self.send_error(500, explain=msg)

    def do_GET(self):
        url = urlparse(self.path)
        qs = parse_qs(url.query)

        ydl_opts = {
            'forcejson': True,
            'logger': self,
            'quiet': True,
            'simulate': True
        }
        if url.path == '/process':
            ydl_opts['format'] = '(best[height = 1080][fps <= 30]/best[height <=? 720])[format_id!=source][vcodec!*=av01][vcodec!*=vp9]'
            ydl_opts['noplaylist'] = True
            ydl_opts['restrictfilenames'] = True
            ydl_opts['writeautomaticsub'] = True
            ydl_opts['writesubtitles'] = True
        elif url.path == '/process_playlist':
            ydl_opts['extract_flat'] = True
        else:
            self.fail("no matching path: {}".format(url.path))
            return

        ydl = YoutubeDL(ydl_opts)
        try:
            info = ydl.extract_info(qs['url'][0], download=False)
            self.response = json.dumps(ydl.sanitize_info(info))
        except Exception as ex:
            self.fail("ydl exception: {}".format(repr(ex)))
            return

        response_bytes = self.response.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', len(response_bytes))
        self.end_headers()
        self.wfile.write(response_bytes)

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    pass

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 4444), Handler)
    server.serve_forever()
