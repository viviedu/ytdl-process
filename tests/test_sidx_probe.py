import unittest
from unittest.mock import patch

from sidx_probe import _find_byte_ranges, probe_byte_ranges


class ByteRangeProbeFallbackTest(unittest.TestCase):
    @staticmethod
    def _box(box_type: str, size: int) -> bytes:
        return size.to_bytes(4, "big") + box_type.encode("latin1") + b"\x00" * (size - 8)

    def test_finds_ranges_in_an_fmp4_head(self):
        head = self._box("ftyp", 28) + self._box("moov", 714) + self._box("sidx", 188) + self._box("moof", 64)
        self.assertEqual(_find_byte_ranges(head), ("0-741", "742-929"))

    def test_no_sidx_before_fragments_means_not_indexable(self):
        head = self._box("ftyp", 28) + self._box("moov", 714) + self._box("moof", 64)
        self.assertIsNone(_find_byte_ranges(head))

    def test_probe_fills_only_formats_the_capture_missed(self):
        info = {
            "formats": [
                # capture already served this one: probe must not touch it (or waste a fetch on it)
                {"format_id": "299", "protocol": "https", "url": "https://x/videoplayback", "ext": "mp4", "vcodec": "avc1.64", "acodec": "none", "init_range": "0-740", "index_range": "741-2248"},
                # capture missed this one: probe fills it
                {"format_id": "137", "protocol": "https", "url": "https://x/videoplayback2", "ext": "mp4", "vcodec": "avc1.64", "acodec": "none"},
                # ineligible: not avc1 (avc1 = H.264; av01 = AV1, boxes can't decode it)
                {"format_id": "399", "protocol": "https", "url": "https://x/videoplayback3", "ext": "mp4", "vcodec": "av01.0", "acodec": "none"},
                # ineligible: audio
                {"format_id": "140", "protocol": "https", "url": "https://x/videoplayback4", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2"},
            ]
        }
        head = self._box("ftyp", 28) + self._box("moov", 714) + self._box("sidx", 188) + self._box("moof", 64)
        with patch("sidx_probe._fetch_file_head", return_value=head) as fetch:
            probe_byte_ranges(info, proxy=None)
        fetch.assert_called_once_with("https://x/videoplayback2", None)
        self.assertEqual(info["formats"][1]["init_range"], "0-741")
        self.assertEqual(info["formats"][1]["index_range"], "742-929")
        self.assertEqual(info["formats"][0]["init_range"], "0-740")  # untouched
        self.assertNotIn("init_range", info["formats"][2])
        self.assertNotIn("init_range", info["formats"][3])

    def test_probe_failure_leaves_format_unannotated(self):
        info = {"formats": [{"format_id": "137", "protocol": "https", "url": "https://x/vp", "ext": "mp4", "vcodec": "avc1.64", "acodec": "none"}]}
        with patch("sidx_probe._fetch_file_head", side_effect=OSError("proxy down")):
            probe_byte_ranges(info, proxy="http://proxy:1")
        self.assertNotIn("init_range", info["formats"][0])


if __name__ == "__main__":
    unittest.main()
