"""Fallback byte-range source for seekable manifests (VIVI-23952).

The player-response capture in service.py fails soft (a yt-dlp upgrade can kill
the private-method hook) and player responses do not always carry
initRange/indexRange. This module reads the ranges out of the file itself:
one ranged GET of the first 8 KB, then walk the mp4 boxes to locate the init
segment (ftyp+moov) and the sidx. Failures leave formats unannotated ->
non-seekable url tracks, same as no capture.
"""
import struct
from urllib.request import ProxyHandler, Request, build_opener

PROBE_HEAD_BYTES = 8192
PROBE_TIMEOUT_SEC = 10


def _fetch_file_head(url: str, proxy: str | None) -> bytes:
    """Ranged GET of a file's first bytes, via the same proxy the extraction used (the URL is IP-bound to it)."""
    request = Request(url, headers={"Range": f"bytes=0-{PROBE_HEAD_BYTES - 1}"})
    opener = build_opener(ProxyHandler({"http": proxy, "https": proxy})) if proxy else build_opener()
    with opener.open(request, timeout=PROBE_TIMEOUT_SEC) as response:
        return response.read()


def _find_byte_ranges(data: bytes) -> tuple[str, str] | None:
    """Walk top-level mp4 boxes; return ('0-<moov end>', '<sidx start>-<sidx end>') or None."""
    offset = 0
    moov_end = None
    while offset + 8 <= len(data):
        size, box_type = struct.unpack(">I4s", data[offset:offset + 8])
        if size == 1:  # 64-bit largesize
            if offset + 16 > len(data):
                return None
            size = struct.unpack(">Q", data[offset + 8:offset + 16])[0]
        if size < 8:
            return None
        box_type = box_type.decode("latin1")
        if box_type == "moov":
            moov_end = offset + size - 1
        elif box_type == "sidx" and moov_end is not None:
            return (f"0-{moov_end}", f"{offset}-{offset + size - 1}")
        elif box_type in ("moof", "mdat"):
            return None  # fragments started before any sidx - nothing to index
        offset += size
    return None


def probe_byte_ranges(info, proxy: str | None) -> None:
    """Fallback for collect_byte_ranges: read the byte ranges out of the file itself.

    The capture hook fails soft (a yt-dlp upgrade can kill it, see _install_byte_range_capture)
    and player responses do not always carry initRange/indexRange. For video-only https mp4
    formats still missing ranges after inject_byte_ranges, fetch the file's first 8 KB and locate
    the init segment (ftyp+moov) and sidx directly. Sets the same string ranges
    inject_byte_ranges would have, so index.js cannot tell the sources apart. avc1 only
    (avc1 = H.264, not AV1): boxes decode nothing else, so probing other codecs is wasted
    traffic. Failures leave formats unannotated -> non-seekable url tracks, same as no capture.
    """
    for f in (info or {}).get("formats") or []:
        if f.get("init_range") and f.get("index_range"):
            continue  # the capture already served this format
        if (
            f.get("protocol") != "https"
            or not f.get("url")
            or f.get("fragments")
            or f.get("ext") != "mp4"
            or not str(f.get("vcodec") or "").startswith("avc1")
            or f.get("acodec", "none") != "none"
        ):
            continue
        try:
            pair = _find_byte_ranges(_fetch_file_head(f["url"], proxy))
            if pair:
                f["init_range"], f["index_range"] = pair
        except Exception:
            continue  # best-effort, like the capture
