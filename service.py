#!/usr/bin/env python3

import argparse
import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from sys import stderr
from typing import Any
from urllib.parse import parse_qs, urlparse

from yt_dlp import YoutubeDL

from generate_filtered_extractors import generate_filtered_extractors

MAX_DOWNLOAD_BIT_RATE_KB = 4000  # 4Mbps
MIN_DOWNLOAD_BIT_RATE_KB = 1000  # 1Mbps


class Handler(BaseHTTPRequestHandler):
    def debug(self, msg: str, level="debug", extra_info: dict | None = None):
        log = {"message": msg, "level": level}
        if extra_info:
            log["extra_info"] = extra_info
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

    def _ytdl_format_selector(self, ctx: Any):
        formats: list[dict[str, Any]] = ctx.get("formats", [])

        loggable_formats = [
            {"width": f.get("width"), "height": f.get("height"), "tbr": f.get("tbr"), "quality": f.get("quality"), "filesize": f.get("filesize")}
            for f in formats
        ]
        self.debug("parsed formats", {"formats": loggable_formats})

        filtered_formats = [f for f in formats if f.get("quality") is not None and MIN_DOWNLOAD_BIT_RATE_KB <= float(f.get("tbr", 0)) <= MAX_DOWNLOAD_BIT_RATE_KB]
        if len(filtered_formats) == 0:
            self.warning("failed to find video format that matches bitrate filters, picking best format", {"formats": loggable_formats})
            filtered_formats = [f for f in formats if f.get("quality") is not None]

        # The get default is set because sometimes the key is missing and other times its just equal to "none"
        video_formats = [f for f in filtered_formats if f.get("vcodec", "none") != "none"]
        best_video = max(video_formats, default=None, key=lambda f: f["quality"])

        if best_video is not None:
            self.debug("selected video format", { "video": best_video })
            yield best_video

            if best_video.get("acodec", "none") == "none":
                # we don't use the format filtering for audio only because they have low bitrates
                audio_formats = [f for f in formats if f.get("vcodec", "none") == "none" and f.get("acodec", "none") != "none"]
                best_audio = max(audio_formats, default=None, key=lambda f: f["quality"])
                self.debug("selected audio format", { "audio": best_audio })
                if best_audio is not None:
                    yield best_audio
        else:
            self.error("failed to find any valid format", {"formats": loggable_formats})

    def download_track(self, ytdl_opts: dict, url: str, filename: str):
        # Prefer split tracks (bestvideo,bestaudio) for higher quality (e.g. YouTube caps combined at 720p),
        # fall back to best combined format when split tracks are unavailable.
        ytdl_opts["format"] = self._ytdl_format_selector

        try:
            with YoutubeDL(ytdl_opts) as ydl:
                info = ydl.extract_info(url, download=True)

            self.debug("track downloaded successfully", extra_info={ "url": url })
            id = info["id"]
            requested_downloads = info["requested_downloads"]

            if len(requested_downloads) == 2:
                video_file = requested_downloads[0] if requested_downloads[0]["video_ext"] != "none" else requested_downloads[1]
                audio_file = requested_downloads[1] if requested_downloads[0]["video_ext"] != "none" else requested_downloads[0]

                video_filename_with_ext = f"{filename}/{id}_{video_file['format_id']}.{video_file['ext']}"
                audio_filename_with_ext = f"{filename}/{id}_{audio_file['format_id']}.{audio_file['ext']}"

                if not os.path.exists(video_filename_with_ext):
                    self.warning("video file cannot be found after downloading", extra_info={"url": url})
                    return False

                if not os.path.exists(audio_filename_with_ext):
                    self.warning("audio file cannot be found after downloading", extra_info={"url": url})
                    return False

                return {"video": video_filename_with_ext, "audio": audio_filename_with_ext}
            elif len(requested_downloads) == 1:
                video_file = requested_downloads[0]
                video_filename_with_ext = f"{filename}/{id}_{video_file['format_id']}.{video_file['ext']}"

                if not os.path.exists(video_filename_with_ext):
                    self.warning("video file cannot be found after downloading", extra_info={"url": url})
                    return False

                return {"video": video_filename_with_ext}
            else:
                self.warning(f"expected 1 or 2 tracks, got {len(requested_downloads)}", extra_info={"url": url})
                return False
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

            # web_creator now requires sign-in (fatal without cookies) and ios/web_safari only return
            # SABR/PO-token-gated formats with no usable URL, so those clients yield nothing playable.
            # android_vr is tokenless and still returns direct https URLs; web_safari/tv are kept as
            # non-fatal extras (can still add HLS). This option is ignored by yt-dlp for non-youtube URLs.
            ydl_opts["extractor_args"] = {"youtube": {"player_client": ["android_vr", "web_safari", "tv"]}}
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

            download_res = self.download_track(ydl_opts, qs["url"][0], filename)

            if download_res:
                self.respond(200, download_res)
            else:
                self.respond(500, {"message": "failed all downloads"})
        else:
            self.respond(500, {"message": "no matching path", "url": url.path})


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    pass


def cli_download(url: str, proxy: str | None = None):
    from generate_filtered_extractors import generate_filtered_extractors

    ydl_opts = {
        "allowed_extractors": generate_filtered_extractors(),
        "cachedir": False,
        "fragment_retries": 5,
        "js_runtimes": {"node": {}},
        "noplaylist": True,
        "quiet": True,
        "retries": float("inf"),
        "simulate": False,
        "sleep_requests": 2,
        "socket_timeout": 120,
    }

    if proxy:
        ydl_opts["proxy"] = proxy

    filename = tempfile.mkdtemp()
    ydl_opts["outtmpl"] = f"{filename}/%(id)s_%(format_id)s.%(ext)s"

    handler = Handler.__new__(Handler)
    result = handler.download_track(ydl_opts, url, filename)
    if result:
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps({"message": "failed all downloads"}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="yt-dlp download service")
    subparsers = parser.add_subparsers(dest="command")

    serve_parser = subparsers.add_parser("serve", help="Start the HTTP server (default)")

    download_parser = subparsers.add_parser("download", help="Download a URL directly")
    download_parser.add_argument("url", help="URL to download")
    download_parser.add_argument("--proxy", help="Proxy URL")

    args = parser.parse_args()

    if args.command == "download":
        cli_download(args.url, proxy=getattr(args, "proxy", None))
    else:
        server = ThreadingHTTPServer(("127.0.0.1", 4444), Handler)
        server.serve_forever()
