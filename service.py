#!/usr/bin/env python3

import os
import tempfile
from generate_filtered_extractors import generate_filtered_extractors
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from sys import stderr
from urllib.parse import parse_qs, urlparse
from yt_dlp import YoutubeDL
import json

MAX_FILE_SIZE = "5000M"


class Handler(BaseHTTPRequestHandler):
    def debug(self, msg):
        print("ydl debug: {}".format(msg), file=stderr)

    def warning(self, msg):
        print("ydl warning: {}".format(msg), file=stderr)

        # 429 responses that come through as warnings fail to
        # be caught by the ytdl service, so we must escalate them
        # to errors
        if "429" in msg or "Too Many Request" in msg:
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
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

    def ytdl_request(self, ytdl_opts, url):
        try:
            with YoutubeDL(ytdl_opts) as ydl:
                info = ydl.extract_info(url, download=False)

            response = json.dumps(ydl.sanitize_info(info))
            response_bytes = response.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(response_bytes)))
            self.end_headers()
            self.wfile.write(response_bytes)
        except Exception as ex:
            self.fail("ydl exception: {}".format(repr(ex)))
            return

    def download_split_tracks(self, ytdl_opts, url, filename):
        ytdl_opts["format"] = f"bestvideo[filesize_approx<{MAX_FILE_SIZE}],bestaudio"

        try:
            with YoutubeDL(ytdl_opts) as ydl:
                info = ydl.extract_info(url, download=True)

            id = info["id"]
            requested_downloads = info["requested_downloads"]
            if len(requested_downloads) != 2:
                self.warning(f"expected 2 tracks, got {len(requested_downloads)}: url={url}")
                return False

            video_file = requested_downloads[0] if requested_downloads[0]["video_ext"] != "none" else requested_downloads[1]
            audio_file = requested_downloads[1] if requested_downloads[0]["video_ext"] != "none" else requested_downloads[0]

            video_filename_with_ext = f"{filename}/{id}_{video_file['format_id']}.{video_file['ext']}"
            audio_filename_with_ext = f"{filename}/{id}_{audio_file['format_id']}.{audio_file['ext']}"

            if not os.path.exists(audio_filename_with_ext):
                self.warning(f"audio file cannot be found after downloading: url={url}")
                return False

            if not os.path.exists(video_filename_with_ext):
                self.warning(f"video file cannot be found after downloading: url={url}")
                return False

            self.debug(f"audio and video downloaded successfully: url={url}, audio={audio_filename_with_ext}, video={video_filename_with_ext}")

            return {"video": video_filename_with_ext, "audio": audio_filename_with_ext}
        except Exception as e:
            self.warning(f"error: {str(e)}, url={url}")
            return False

    def download_combined_track(self, ytdl_opts, url, filename):
        ytdl_opts["format"] = f"best[acodec!=none][vcodec!=none][filesize_approx<{MAX_FILE_SIZE}]"

        try:
            with YoutubeDL(ytdl_opts) as ydl:
                info = ydl.extract_info(url, download=True)

            id = info["id"]
            requested_downloads = info["requested_downloads"]
            if len(requested_downloads) != 1:
                self.warning(f"expected 1 tracks, got {len(requested_downloads)}: url={url}")
                return False

            video_file = requested_downloads[0]
            video_filename_with_ext = f"{filename}/{id}_{video_file['format_id']}.{video_file['ext']}"

            if not os.path.exists(video_filename_with_ext):
                self.warning(f"video file cannot be found after downloading: url={url}")
                return False

            self.debug(f"audio and video downloaded successfully: url={url}, video={video_filename_with_ext}")

            return {"video": video_filename_with_ext}
        except Exception as e:
            self.warning(f"error: {str(e)}, url={url}")
            return False

    def do_GET(self):
        url = urlparse(self.path)
        qs = parse_qs(url.query)
        proxy_url = qs.get("proxy_url")
        version = qs.get("version", "2")

        ydl_opts = {
            "allowed_extractors": generate_filtered_extractors(),
            "forcejson": True,
            "js_runtimes": {"node": {}},
            "logger": self,
            "quiet": True,
            "simulate": True,
        }

        if url.path == "/process":
            if proxy_url and proxy_url[0] != "":
                ydl_opts["proxy"] = proxy_url[0]

            # Version 2 and 1: use a format specifier that asks for the best 1080p or 720p video.
            # Version 3 and 4: don't use this arg. javascript code will look through all available tracks and pick
            if version[0] == "2" or version[0] == "1":
                ydl_opts["format"] = "(best[height = 1080][fps <= 30]/best[height <=? 720])[format_id!=source][vcodec!*=av01][vcodec!*=vp9]"

            ydl_opts["noplaylist"] = True
            ydl_opts["restrictfilenames"] = True
            ydl_opts["writeautomaticsub"] = True
            ydl_opts["writesubtitles"] = True

            # by default, yt-dlp queries each url twice, once as an ios client and once as a web client. Youtube returns different tracks to
            # different clients. We add 'web_safari' to the list, because this causes youtube to return combined 720p/1080p m3u8 tracks which
            # are handy to have. More clients = hitting youtube more times. This option is ignored by yt-dlp for URLs that are not youtube.
            ydl_opts["extractor_args"] = {"youtube": {"player_client": ["ios", "web_creator", "web_safari"]}}
            self.ytdl_request(ydl_opts, qs["url"][0])
        elif url.path == "/process_playlist":
            ydl_opts["extract_flat"] = True
            self.ytdl_request(ydl_opts, qs["url"][0])
        elif url.path == "/download":
            if proxy_url and proxy_url[0] != "":
                ydl_opts["proxy"] = proxy_url[0]
            
            filename = tempfile.mkdtemp()
            ydl_opts["cachedir"] = False
            ydl_opts["simulate"] = False
            ydl_opts["outtmpl"] = f"{filename}/%(id)s_%(format_id)s.%(ext)s"
            ydl_opts["sleep_requests"] = 2 # 2s between HTTP requests
            ydl_opts["socket_timeout"] = 120
            ydl_opts["retries"] = 5
            ydl_opts["fragment_retries"] = 5
    
            download_res = self.download_combined_track(ydl_opts, qs["url"][0], filename)
            if not download_res:
                download_res = self.download_split_tracks(ydl_opts, qs["url"][0], filename)

            if download_res:
                response = json.dumps(download_res)
                response_bytes = response.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(response_bytes)))
                self.end_headers()
                self.wfile.write(response_bytes)
            else:
                self.fail("failed all downloads")
        else:
            self.fail("no matching path: {}".format(url.path))


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 4444), Handler)
    server.serve_forever()
