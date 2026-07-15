"""Fallback byte-range source for seekable manifests.

The capture in service.py fails soft (a yt-dlp upgrade can kill the private-method
hook) and player responses do not always carry initRange/indexRange. This module
reads the ranges out of the file itself: one ranged GET of the first 8 KB, then a
walk of the mp4 boxes to locate the init segment (ftyp+moov) and the sidx.
"""
import struct
from urllib.request import ProxyHandler, Request, build_opener

PROBE_HEAD_BYTES = 8192
PROBE_TIMEOUT_SEC = 10


def _fetch_file_head(url: str, proxy: str | None) -> bytes:
    """Ranged GET of the file's first bytes, via the proxy the extraction used (the URL is IP-bound to it)."""
    request = Request(url, headers={"Range": f"bytes=0-{PROBE_HEAD_BYTES - 1}"})
    opener = build_opener(ProxyHandler({"http": proxy, "https": proxy})) if proxy else build_opener()
    with opener.open(request, timeout=PROBE_TIMEOUT_SEC) as response:
        return response.read()


def _find_byte_ranges(file_head: bytes) -> tuple[str, str] | None:
    """Walk top-level mp4 boxes; return ('0-<moov end>', '<sidx start>-<sidx end>') or None."""
    offset = 0
    moov_end = None
    while offset + 8 <= len(file_head):
        box_size, box_type = struct.unpack(">I4s", file_head[offset:offset + 8])
        if box_size == 1:  # 64-bit largesize
            if offset + 16 > len(file_head):
                return None
            box_size = struct.unpack(">Q", file_head[offset + 8:offset + 16])[0]
        if box_size < 8:
            return None
        if box_type == b"moov":
            moov_end = offset + box_size - 1
        elif box_type == b"sidx" and moov_end is not None:
            return (f"0-{moov_end}", f"{offset}-{offset + box_size - 1}")
        elif box_type in (b"moof", b"mdat"):
            return None  # media started before any sidx - nothing to index
        offset += box_size
    return None


def probe_byte_ranges(info, proxy: str | None) -> None:
    """Fill init_range/index_range on formats the capture missed, by reading the file itself.

    Only video-only https mp4 with avc1 (H.264) - the one codec boxes decode, so probing
    anything else is wasted traffic. Sets the same string ranges inject_byte_ranges would,
    so downstream cannot tell the sources apart. Failures leave the format unannotated ->
    a plain non-seekable url track, same as no capture.
    """
    for fmt in (info or {}).get("formats") or []:
        if fmt.get("init_range") and fmt.get("index_range"):
            continue  # the capture already served this format
        if (
            fmt.get("protocol") != "https"
            or not fmt.get("url")
            or fmt.get("fragments")
            or fmt.get("ext") != "mp4"
            or not str(fmt.get("vcodec") or "").startswith("avc1")
            or fmt.get("acodec", "none") != "none"
        ):
            continue
        try:
            byte_ranges = _find_byte_ranges(_fetch_file_head(fmt["url"], proxy))
        except Exception:
            continue  # best-effort, like the capture
        if byte_ranges:
            fmt["init_range"], fmt["index_range"] = byte_ranges
