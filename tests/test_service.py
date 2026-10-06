import struct
import unittest
from unittest import mock

from service import Handler, build_segment_ranges, collect_byte_ranges, inject_byte_ranges, inject_segment_ranges, parse_sidx


class ByteRangeHookDriftGuardTest(unittest.TestCase):
    def test_hook_wrapped_the_private_yt_dlp_method(self):
        # Drift guard: _install_byte_range_capture deliberately swallows failures (extraction must
        # keep working without ranges), so a yt-dlp upgrade that renames or removes
        # _extract_player_responses would silently kill seeking in the field. Importing service
        # (above) runs the install; this assertion turns that silent degradation into a CI failure
        # on the uv.lock bump that introduces it.
        from yt_dlp.extractor.youtube import YoutubeIE

        method = getattr(YoutubeIE, "_extract_player_responses", None)
        self.assertIsNotNone(method, "yt-dlp no longer has YoutubeIE._extract_player_responses - the seek byte-range hook is dead")
        self.assertEqual(getattr(method, "__name__", None), "wrapper", "the byte-range hook did not wrap _extract_player_responses - seeking will silently degrade")


class ByteRangeCaptureTest(unittest.TestCase):
    def test_collects_ranges_from_player_responses(self):
        player_responses = [
            {
                "streamingData": {
                    "adaptiveFormats": [
                        {"itag": 299, "initRange": {"start": "0", "end": "740"}, "indexRange": {"start": "741", "end": "2248"}},
                        {"itag": 140, "initRange": {"start": "0", "end": "631"}, "indexRange": {"start": "632", "end": "1571"}},
                        {"itag": 251},  # no ranges (e.g. OTF/SABR entry)
                    ]
                }
            },
            None,  # a client that returned nothing
            {"streamingData": {}},  # no adaptiveFormats
        ]
        ranges = {}
        collect_byte_ranges(player_responses, ranges)
        self.assertEqual(ranges, {"299": ("0-740", "741-2248"), "140": ("0-631", "632-1571")})

    def test_first_client_wins_on_duplicate_itags(self):
        ranges = {}
        collect_byte_ranges([{"streamingData": {"adaptiveFormats": [{"itag": 299, "initRange": {"start": "0", "end": "740"}, "indexRange": {"start": "741", "end": "2248"}}]}}], ranges)
        collect_byte_ranges([{"streamingData": {"adaptiveFormats": [{"itag": 299, "initRange": {"start": "0", "end": "999"}, "indexRange": {"start": "1000", "end": "2000"}}]}}], ranges)
        self.assertEqual(ranges["299"], ("0-740", "741-2248"))

    def test_injects_ranges_onto_matching_https_formats(self):
        info = {
            "formats": [
                {"format_id": "299", "protocol": "https", "url": "https://x/videoplayback"},
                {"format_id": "299-1", "protocol": "https", "url": "https://y/videoplayback"},  # client-suffixed duplicate
                {"format_id": "96", "protocol": "m3u8_native", "url": "https://x/hls"},  # segmented: byte ranges don't apply
                {"format_id": "18", "protocol": "https", "url": "https://x/videoplayback"},  # no captured ranges
            ]
        }
        inject_byte_ranges(info, {"299": ("0-740", "741-2248"), "96": ("0-1", "2-3")})
        self.assertEqual(info["formats"][0]["init_range"], "0-740")
        self.assertEqual(info["formats"][0]["index_range"], "741-2248")
        self.assertEqual(info["formats"][1]["init_range"], "0-740")
        self.assertNotIn("init_range", info["formats"][2])
        self.assertNotIn("init_range", info["formats"][3])

    def test_inject_handles_missing_info_or_formats(self):
        inject_byte_ranges(None, {"299": ("0-740", "741-2248")})
        inject_byte_ranges({}, {"299": ("0-740", "741-2248")})


def build_sidx(entries, timescale=44100, first_offset=0, version=0) -> bytes:
    """A SegmentIndexBox holding the given (referenced_size, subsegment_duration) entries."""
    header = struct.pack(">II", 0, timescale)
    header += struct.pack(">II", 0, first_offset) if version == 0 else struct.pack(">QQ", 0, first_offset)
    header += struct.pack(">HH", 0, len(entries))
    body = b"".join(struct.pack(">III", size, duration, 0) for size, duration in entries)
    size = 12 + len(header) + len(body)
    return struct.pack(">I4sB3s", size, b"sidx", version, b"\0\0\0") + header + body


class SidxParseTest(unittest.TestCase):
    def test_parses_a_version_0_box(self):
        timescale, first_offset, entries = parse_sidx(build_sidx([(100, 10), (200, 10)]))
        self.assertEqual((timescale, first_offset), (44100, 0))
        self.assertEqual(entries, [(100, 10), (200, 10)])

    def test_parses_a_version_1_box(self):
        timescale, first_offset, entries = parse_sidx(build_sidx([(100, 10)], version=1, first_offset=8))
        self.assertEqual((timescale, first_offset), (44100, 8))
        self.assertEqual(entries, [(100, 10)])

    def test_rejects_a_hierarchical_index(self):
        # reference_type 1 means the entry points at another sidx, so the sizes are not media
        nested = struct.pack(">I4sB3sIIIIHH", 44, b"sidx", 0, b"\0\0\0", 0, 44100, 0, 0, 0, 1) + struct.pack(">III", 1 << 31 | 100, 10, 0)
        with self.assertRaises(ValueError):
            parse_sidx(nested)

    def test_rejects_a_box_that_is_not_a_sidx(self):
        with self.assertRaises(ValueError):
            parse_sidx(struct.pack(">I4s", 8, b"moov"))


class SegmentRangeTest(unittest.TestCase):
    def _with_sidx(self, data):
        opener = mock.MagicMock()
        opener.open.return_value.__enter__.return_value.read.return_value = data
        return mock.patch("service.build_opener", return_value=opener), opener

    def test_ranges_run_from_the_end_of_the_index_to_the_end_of_the_file(self):
        patcher, _ = self._with_sidx(build_sidx([(100, 10), (200, 10), (50, 7)]))
        with patcher:
            segments = build_segment_ranges("https://x/videoplayback?clen=2286", "632-1935", None)
        assert segments is not None
        # first subsegment starts at index_end + 1 + first_offset, each one follows the previous
        self.assertEqual(segments["ranges"], ["1936-2035", "2036-2235", "2236-2285"])
        self.assertEqual((segments["timescale"], segments["duration"]), (44100, 10))

    def test_declines_when_subsegments_are_not_uniform(self):
        # a single duration attribute covers every SegmentURL, so uneven entries would drift
        patcher, _ = self._with_sidx(build_sidx([(100, 10), (200, 13), (50, 7)]))
        with patcher:
            self.assertIsNone(build_segment_ranges("https://x/videoplayback", "632-1935", None))

    def test_raises_when_the_sizes_do_not_reach_the_end_of_the_file(self):
        patcher, _ = self._with_sidx(build_sidx([(100, 10), (200, 10)]))
        with patcher, self.assertRaises(ValueError):
            build_segment_ranges("https://x/videoplayback?clen=999999", "632-1935", None)

    def test_asks_for_exactly_the_index_range(self):
        patcher, opener = self._with_sidx(build_sidx([(100, 10), (200, 10)]))
        with patcher:
            build_segment_ranges("https://x/videoplayback", "632-1935", None)
        self.assertEqual(opener.open.call_args[0][0].headers["Range"], "bytes=632-1935")


class SegmentRangeInjectionTest(unittest.TestCase):
    def test_only_touches_m4a_audio_that_has_an_index(self):
        info = {
            "formats": [
                {"format_id": "140", "vcodec": "none", "ext": "m4a", "index_range": "632-1935", "url": "https://x/a"},
                {"format_id": "251", "vcodec": "none", "ext": "webm", "index_range": "632-1935", "url": "https://x/b"},  # no sidx in matroska
                {"format_id": "137", "vcodec": "avc1", "ext": "mp4", "index_range": "632-1935", "url": "https://x/c"},  # video is not starved
                {"format_id": "139", "vcodec": "none", "ext": "m4a", "url": "https://x/d"},  # no index captured
            ]
        }
        with mock.patch("service.build_segment_ranges", return_value={"timescale": 44100, "duration": 10, "ranges": ["1936-2035"]}) as build:
            inject_segment_ranges(info, None)
        self.assertEqual([call[0][0] for call in build.call_args_list], ["https://x/a"])
        self.assertEqual(info["formats"][0]["segment_ranges"], ["1936-2035"])
        self.assertNotIn("segment_ranges", info["formats"][1])

    def test_a_failed_read_leaves_the_format_alone(self):
        info = {"formats": [{"format_id": "140", "vcodec": "none", "ext": "m4a", "index_range": "632-1935", "url": "https://x/a"}]}
        with mock.patch("service.build_segment_ranges", side_effect=OSError("timed out")):
            inject_segment_ranges(info, None)
        self.assertNotIn("segment_ranges", info["formats"][0])

    def test_handles_missing_info_or_formats(self):
        inject_segment_ranges(None, None)
        inject_segment_ranges({}, None)


class AudioTrackSelectionTest(unittest.TestCase):
    VIDEO = {"format_id": "137", "vcodec": "avc1", "acodec": "none", "quality": 5, "tbr": 2000}

    def audio(self, format_id, quality, language, language_preference):
        return {"format_id": format_id, "vcodec": "none", "acodec": "mp4a.40.2", "quality": quality, "tbr": 128,
                "language": language, "language_preference": language_preference}

    def selected(self, formats):
        handler = Handler.__new__(Handler)
        with mock.patch.object(Handler, "debug"):
            return [f["format_id"] for f in handler._ytdl_format_selector({"formats": formats})]

    def test_takes_the_original_language_over_dubs_of_the_same_quality(self):
        formats = [self.VIDEO, self.audio("140-0", 3, "ar", -1), self.audio("140-1", 3, "de-DE", -1), self.audio("140-17", 3, "en-US", 10)]
        self.assertEqual(self.selected(formats), ["137", "140-17"])

    def test_takes_the_original_language_over_a_dub_of_higher_quality(self):
        formats = [self.VIDEO, self.audio("251-0", 4, "fr-FR", -1), self.audio("140-17", 3, "en-US", 10)]
        self.assertEqual(self.selected(formats), ["137", "140-17"])

    def test_takes_the_best_quality_where_no_track_names_a_language(self):
        formats = [self.VIDEO, self.audio("139", 2, None, -1), self.audio("140", 3, None, -1)]
        self.assertEqual(self.selected(formats), ["137", "140"])

    def test_ranks_a_track_with_no_language_preference_as_unknown(self):
        unlabelled = {k: v for k, v in self.audio("140", 3, None, None).items() if k != "language_preference"}
        formats = [self.VIDEO, unlabelled, self.audio("251-0", 4, "fr-FR", -1)]
        self.assertEqual(self.selected(formats), ["137", "251-0"])

    def test_takes_the_default_language_over_a_dub_of_higher_quality(self):
        formats = [self.VIDEO, self.audio("251-0", 4, "fr-FR", -1), self.audio("140-5", 3, "en", 5)]
        self.assertEqual(self.selected(formats), ["137", "140-5"])

    def test_takes_a_dub_over_a_descriptive_track_of_higher_quality(self):
        formats = [self.VIDEO, self.audio("251-desc", 4, "en-desc", -10), self.audio("140-0", 3, "ar", -1)]
        self.assertEqual(self.selected(formats), ["137", "140-0"])


if __name__ == "__main__":
    unittest.main()
