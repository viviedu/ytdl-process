import unittest

from service import collect_byte_ranges, inject_byte_ranges


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


if __name__ == "__main__":
    unittest.main()
