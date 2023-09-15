#!/usr/bin/python3 -u

from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from sys import stderr
from urllib.parse import parse_qs, urlparse
from yt_dlp import YoutubeDL
import json

class Handler(BaseHTTPRequestHandler):
    def debug(self, msg):
        print("ydl debug: {}".format(msg), file=stderr)

    def warning(self, msg):
        print("ydl warning: {}".format(msg), file=stderr)

        # 429 responses that come through as warnings fail to
        # be caught by the ytdl service, so we must escalate them
        # to errors
        if '429' in msg or 'Too Many Request' in msg:
            self.fail(msg)
        pass

    def error(self, msg):
        print("ydl error: {}".format(msg), file=stderr)
        pass

    def fail(self, msg):
        print(msg, file=stderr)
        # create our own error response rather than using send_error to
        # avoid bloating response with HTML wrapping
        response_bytes = msg.encode()
        self.send_response(500)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', len(response_bytes))
        self.end_headers()
        self.wfile.write(response_bytes)



    def do_GET(self):
        url = urlparse(self.path)
        qs = parse_qs(url.query)
        version = qs.get('version')

        ydl_opts = {
            'forcejson': True,
            'logger': self,
            'quiet': True,
            'simulate': True
        }
        if url.path == '/process':
            ydl_opts['format'] = f'{"bestaudio" if version and version[0] == "3" else "(best[height = 1080][fps <= 30]/best[height <=? 720])"}[format_id!=source][vcodec!*=av01][vcodec!*=vp9]'
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
        response = ""
        try:
            info = ydl.extract_info(qs['url'][0], download=False)
            response = json.dumps(ydl.sanitize_info(info))
        except Exception as ex:
            self.fail("ydl exception: {}".format(repr(ex)))
            return

        response_bytes = response.encode()
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
