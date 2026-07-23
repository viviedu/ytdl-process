#!/usr/bin/env python3

import traceback
import shutil
import argparse
import json
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from sys import stderr
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

from yt_dlp import YoutubeDL

from generate_filtered_extractors import generate_filtered_extractors

MAX_DOWNLOAD_BIT_RATE_KB = 4000  # 4Mbps
MIN_DOWNLOAD_BIT_RATE_KB = 1000  # 1Mbps

MAX_DOWNLOAD_DURATION_SECONDS = 60 * 60  # 1 hour

# Each request is handled on its own thread, so captured ranges live in a thread-local: a fresh dict
# for the duration of each /process extraction, None otherwise.
_captured_ranges = threading.local()


def collect_byte_ranges(player_responses, ranges: dict) -> None:
    """Collect itag -> (init_range, index_range) pairs from raw YouTube player responses.

    yt-dlp drops streamingData.adaptiveFormats[].initRange/indexRange when it builds its format
    dicts, but index.js needs them to build seekable manifests. First client wins: an itag is a
    single encode, so the ranges are interchangeable between clients.
    """
    for player_response in player_responses or []:
        streaming_data = (player_response or {}).get("streamingData") or {}
        for f in streaming_data.get("adaptiveFormats") or []:
            itag = f.get("itag")
            init_range = f.get("initRange") or {}
            index_range = f.get("indexRange") or {}
            if itag is None or not init_range or not index_range:
                continue
            ranges.setdefault(str(itag), (f"{init_range.get('start')}-{init_range.get('end')}", f"{index_range.get('start')}-{index_range.get('end')}"))


def inject_byte_ranges(info, ranges: dict) -> None:
    """Attach captured byte ranges to matching single-file https formats as init_range/index_range.

    format_id for YouTube's DASH formats is the itag, suffixed (e.g. '299-1') when several clients
    return the same itag. Segmented protocols (m3u8/http_dash_segments) are skipped: byte ranges
    only make sense for single-file formats.
    """
    if not info or not ranges:
        return
    for f in info.get("formats") or []:
        if f.get("protocol") != "https":
            continue
        pair = ranges.get(str(f.get("format_id", "")).split("-")[0])
        if pair:
            f["init_range"], f["index_range"] = pair


def _install_byte_range_capture():
    """Wrap YoutubeIE._extract_player_responses to capture raw player responses per request.

    Private yt-dlp method: re-check its signature on upgrade (verified on 2026.6.9 and 2026.7.4).
    If the wrap fails we only lose seekable manifests; extraction itself keeps working.
    """
    try:
        from yt_dlp.extractor.youtube import YoutubeIE

        original = YoutubeIE._extract_player_responses

        def wrapper(self, *args, **kwargs):
            result = original(self, *args, **kwargs)
            ranges = getattr(_captured_ranges, "ranges", None)
            if ranges is not None:
                try:
                    collect_byte_ranges(result[0], ranges)
                except Exception as ex:
                    self.report_warning(f"byte-range capture failed: {ex!r}")
            return result

        # signature-agnostic on purpose so minor yt-dlp signature drift doesn't break the wrap
        YoutubeIE._extract_player_responses = wrapper  # ty: ignore[invalid-assignment]
    except Exception as ex:
        print(json.dumps({"message": "byte-range capture unavailable", "level": "warning", "extra_info": {"error": repr(ex)}}), file=stderr)


_install_byte_range_capture()


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
        _captured_ranges.ranges = {}
        try:
            with YoutubeDL(ytdl_opts) as ydl:
                info = ydl.extract_info(url, download=False)

            inject_byte_ranges(info, _captured_ranges.ranges)
            self.respond(200, ydl.sanitize_info(info))
        except Exception as ex:
            self.respond(500, {"message": "ydl exception: {}".format(repr(ex))})
            return
        finally:
            _captured_ranges.ranges = None

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

    def _duration_match_filter(self, info, *, incomplete):
        """Reject videos longer than MAX_DOWNLOAD_DURATION_SECONDS.

        Videos with unknown duration (duration missing/None) are allowed through.
        """
        duration = info.get("duration")
        if duration and duration > MAX_DOWNLOAD_DURATION_SECONDS:
            raise Exception('video_link is over 1 hour')

    def download_track(self, ytdl_opts: dict, url: str):
        # Prefer split tracks (bestvideo,bestaudio) for higher quality (e.g. YouTube caps combined at 720p),
        # fall back to best combined format when split tracks are unavailable.
        ytdl_opts["format"] = self._ytdl_format_selector

        with YoutubeDL(ytdl_opts) as ydl:
            info = ydl.extract_info(url, download=True)

        if "requested_downloads" not in info:
            raise Exception('failed to download any tracks')

        self.debug("track downloaded successfully", extra_info={ "url": url })
        requested_downloads = info["requested_downloads"]
        if len(requested_downloads) == 2:
            is_first_download_a_video: bool = requested_downloads[0]["video_ext"] != "none"
            video_file = requested_downloads[0] if is_first_download_a_video else requested_downloads[1]
            audio_file = requested_downloads[1] if is_first_download_a_video else requested_downloads[0]

            return {"video": video_file["filepath"], "audio": audio_file["filepath"]}
        elif len(requested_downloads) == 1:
            return {"video": requested_downloads[0]["filepath"]}
        else:
            msg = f"expected 1 or 2 tracks, got {len(requested_downloads)}"
            raise Exception(msg)

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
            # android_vr is also load-bearing for seeking: only its (n-less) URLs can be wrapped into
            # a seekable manifest by index.js (see isThrottledUrl). Dropping it silently kills seeking.
            ydl_opts["extractor_args"] = {"youtube": {"player_client": ["android_vr", "web_safari", "tv"]}}
            self.ytdl_request(ydl_opts, qs["url"][0])
        elif url.path == "/process_playlist":
            ydl_opts["extract_flat"] = True
            self.ytdl_request(ydl_opts, qs["url"][0])
        elif url.path == "/download":
            try:
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
                ydl_opts["match_filter"] = self._duration_match_filter

                download_res = self.download_track(ydl_opts, qs["url"][0])
                self.respond(200, download_res)
            except Exception as e:
                self.respond(500, {"error": str(e), "trace": traceback.format_exc()})
                shutil.rmtree(filename, ignore_errors=True)
        else:
            self.respond(500, {"message": "no matching path", "url": url.path})


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    pass


def cli_download(url: str, proxy: str | None = None):
    query = {"url": url}
    if proxy:
        query["proxy_url"] = proxy

    handler = Handler.__new__(Handler)
    handler.path = "/download?" + urlencode(query)

    response: dict[str, Any] = {}

    def respond(status: int, msg: object):
        response["status"] = status
        response["msg"] = msg

    handler.respond = respond
    handler.do_GET()

    if response.get("status") == 200:
        print(json.dumps(response["msg"], indent=2))
    else:
        print(json.dumps(response.get("msg")), file=sys.stderr)
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
