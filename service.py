#!/usr/bin/env python3

import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from sys import stderr
from urllib.parse import parse_qs, urlparse

from yt_dlp import YoutubeDL

from generate_filtered_extractors import generate_filtered_extractors

MAX_DOWNLOAD_BIT_RATE_KB = "8000"  # 8Mbps same as in the media lambda


class Handler(BaseHTTPRequestHandler):
    def debug(self, msg: str, level="debug", extra_info: dict | None = None):
        log = {"message": msg, "level": level}
        if extra_info:
            log.update(extra_info)
        print(json.dumps(log), file=stderr)

    def warning(self, msg: str, extra_info: dict | None = None):
        self.debug(msg, "warning", extra_info)

    def error(self, msg: str, extra_info: dict | None = None):
        self.debug(msg, "error", extra_info)

    def respond(self, status: int, msg: object):
        # create our own response rather than using send_success/send_error to
        # avoid bloating response with HTML wrapping
        response_bytes = json.dumps(msg).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

    def ytdl_request(self, ytdl_opts, url):
        try:
            with YoutubeDL(ytdl_opts) as ydl:
                info = ydl.extract_info(url, download=False)

            self.respond(200, ydl.sanitize_info(info))
        except Exception as ex:
            self.respond(500, {"message": "ydl exception: {}".format(repr(ex))})
            return

    def download_split_tracks(self, ytdl_opts: dict, url: str, filename: str):
        ytdl_opts["format"] = "bestvideo,bestaudio"

        try:
            with YoutubeDL(ytdl_opts) as ydl:
                info = ydl.extract_info(url, download=True)

            self.debug("split track downloaded successfully", extra_info=info)
            id = info["id"]
            requested_downloads = info["requested_downloads"]
            if len(requested_downloads) != 2:
                self.warning(f"expected 2 tracks, got {len(requested_downloads)}", extra_info={"url": url})
                return False

            video_file = requested_downloads[0] if requested_downloads[0]["video_ext"] != "none" else requested_downloads[1]
            audio_file = requested_downloads[1] if requested_downloads[0]["video_ext"] != "none" else requested_downloads[0]

            video_filename_with_ext = f"{filename}/{id}_{video_file['format_id']}.{video_file['ext']}"
            audio_filename_with_ext = f"{filename}/{id}_{audio_file['format_id']}.{audio_file['ext']}"

            if not os.path.exists(audio_filename_with_ext):
                self.warning("audio file cannot be found after downloading", extra_info={"url": url})
                return False

            if not os.path.exists(video_filename_with_ext):
                self.warning("video file cannot be found after downloading", extra_info={"url": url})
                return False

            return {"video": video_filename_with_ext, "audio": audio_filename_with_ext}
        except Exception as e:
            self.warning(str(e), extra_info={"url": url})
            return False

    def download_combined_track(self, ytdl_opts: dict, url: str, filename: str):
        ytdl_opts["format"] = "best[acodec!=none][vcodec!=none]"

        try:
            with YoutubeDL(ytdl_opts) as ydl:
                info = ydl.extract_info(url, download=True)

            self.debug("combined track downloaded successfully", extra_info=info)
            id = info["id"]
            requested_downloads = info["requested_downloads"]
            if len(requested_downloads) != 1:
                self.warning(f"expected 1 tracks, got {len(requested_downloads)}", extra_info={"url": url})
                return False

            video_file = requested_downloads[0]
            video_filename_with_ext = f"{filename}/{id}_{video_file['format_id']}.{video_file['ext']}"

            if not os.path.exists(video_filename_with_ext):
                self.warning("video file cannot be found after downloading", extra_info={"url": url})
                return False

            return {"video": video_filename_with_ext}
        except Exception as e:
            self.warning(str(e), extra_info={"url": url})
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
            ydl_opts["noplaylist"] = True
            ydl_opts["cachedir"] = False
            ydl_opts["simulate"] = False
            ydl_opts["outtmpl"] = f"{filename}/%(id)s_%(format_id)s.%(ext)s"
            ydl_opts["sleep_requests"] = 2  # 2s between HTTP requests
            ydl_opts["socket_timeout"] = 120
            ydl_opts["retries"] = float("inf")  # I know this looks like a lot but we have the fragment tries limit below that we want to use
            ydl_opts["fragment_retries"] = 5

            download_res = self.download_combined_track(ydl_opts, qs["url"][0], filename)
            if not download_res:
                download_res = self.download_split_tracks(ydl_opts, qs["url"][0], filename)

            if download_res:
                self.respond(200, download_res)
            else:
                self.respond(500, {"message": "failed all downloads"})
        else:
            self.respond(500, {"message": "no matching path", "url": url.path})


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 4444), Handler)
    server.serve_forever()
