const { _private_testing } = require('./../index');

const filterVideoFormatCodecs = _private_testing.filterVideoFormatCodecs;
const filterAudioFormatCodecs = _private_testing.filterAudioFormatCodecs;
const generateDurationString = _private_testing.generateDurationString;
const videoTrackSort = _private_testing.videoTrackSort;
const audioTrackSort = _private_testing.audioTrackSort;

// Results must adhere to https://en.wikipedia.org/wiki/ISO_8601#Durations
test('generateDurationString generates correct strings', () => {
  expect(generateDurationString(11309)).toBe('PT3H8M29S');
  expect(generateDurationString(3601)).toBe('PT1H1S');
  expect(generateDurationString(3600)).toBe('PT1H0S');
  expect(generateDurationString(60)).toBe('PT1M0S');
  expect(generateDurationString(1)).toBe('PT1S');
  expect(generateDurationString(0)).toBe('PT0S');
});

// Ensure sorting criteria works as we expect
test('videoTrackSort prefers higher resolutions', () => {
  const a = { format_id: 'hls-akfire_interconnect_quic_sep-2519', height: 720, acodec: 'opus', protocol: 'm3u8', tbr: 1000 };
  const b = { format_id: 'hls-akfire_interconnect_quic-2325', height: 2180, acodec: 'none', protocol: 'm3u8', tbr: 3000 };
  expect([a, b].sort(videoTrackSort)[0]).toBe(b);
  expect([b, a].sort(videoTrackSort)[0]).toBe(b);
});

test('videoTrackSort prefers combined video/audio tracks', () => {
  const a = { format_id: 'hls-akfire_interconnect_quic-2325', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 1000 };
  const b = { format_id: 'hls-akfire_interconnect_quic_sep-2519', height: 1080, acodec: 'none', protocol: 'dash', tbr: 3000 };
  expect([a, b].sort(videoTrackSort)[0]).toBe(a);
  expect([b, a].sort(videoTrackSort)[0]).toBe(a);

  const c = { format_id: 'hls-akfire_interconnect_quic-2325', height: 1080, acodec: 'none', protocol: 'dash', tbr: 1000 };
  const d = { format_id: 'hls-akfire_interconnect_quic_sep-2519', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 3000 };
  expect([c, d].sort(videoTrackSort)[0]).toBe(d);
  expect([d, c].sort(videoTrackSort)[0]).toBe(d);
});

test('videoTrackSort prefers vimeo tracks with "_sep" in its format_id', () => {
  const a = { format_id: 'hls-akfire_interconnect_quic_sep-2519', height: 1080, acodec: 'none', protocol: 'm3u8', tbr: 1000 };
  const b = { format_id: 'hls-akfire_interconnect_quic-2325', height: 1080, acodec: 'none', protocol: 'm3u8', tbr: 3000 };
  expect([a, b].sort(videoTrackSort)[0]).toBe(a);
  expect([b, a].sort(videoTrackSort)[0]).toBe(a);
});

test('videoTrackSort prefers url tracks over dash tracks', () => {
  const a = { format_id: '22', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 1000 };
  const b = { format_id: '22', height: 720, acodec: 'opus', protocol: 'm3u8', tbr: 3000 };
  expect([a, b].sort(videoTrackSort)[0]).toBe(b);
  expect([b, a].sort(videoTrackSort)[0]).toBe(b);

  const c = { format_id: 'hls-akfire_interconnect_quic-2325', height: 1080, acodec: 'none', protocol: 'm3u8', tbr: 3000 };
  const d = { format_id: 'hls-akfire_interconnect_quic-2325', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 3000 };
  expect([c, d].sort(videoTrackSort)[0]).toBe(c);
  expect([d, c].sort(videoTrackSort)[0]).toBe(c);
});

test('videoTrackSort prefers lower tbrs', () => {
  const a = { format_id: 'aaa', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 3000 };
  const b = { format_id: 'bbb', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 1000 };
  expect([a, b].sort(videoTrackSort)[0]).toBe(b);
  expect([b, a].sort(videoTrackSort)[0]).toBe(b);

  const c = { format_id: 'ccc', height: 1080, acodec: 'none', protocol: 'm3u8', tbr: 1000 };
  const d = { format_id: 'ddd', height: 1080, acodec: 'none', protocol: 'm3u8', tbr: 3000 };
  expect([c, d].sort(videoTrackSort)[0]).toBe(c);
  expect([d, c].sort(videoTrackSort)[0]).toBe(c);
});

test('videoTrackSort uses format_id as tiebreaker for identical tracks', () => {
  const a = { format_id: 'aaa', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 3000 };
  const b = { format_id: 'bbb', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 3000 };
  expect([a, b].sort(videoTrackSort)[0]).toBe(a);
  expect([b, a].sort(videoTrackSort)[0]).toBe(a);
});

test('filterVideoFormatCodecs rejects bad format_ids', () => {
  const bad1 = { format_id: 'source', vcodec: 'avc1', acodec: 'opus', protocol: 'https' };
  expect(Boolean(filterVideoFormatCodecs(bad1))).toBe(false);

  const bad2 = { format_id: 'http-something-something', vcodec: 'avc1', acodec: 'opus', protocol: 'm3u8' };
  expect(Boolean(filterVideoFormatCodecs(bad2))).toBe(false);
});

test('filterVideoFormatCodecs rejects tracks with no video', () => {
  const bad1 = { format_id: '22', vcodec: 'none', acodec: 'opus', protocol: 'https' };
  expect(Boolean(filterVideoFormatCodecs(bad1))).toBe(false);

  const bad2 = { format_id: '520', acodec: 'opus', protocol: 'm3u8' };
  expect(Boolean(filterVideoFormatCodecs(bad2))).toBe(false);
});

test('filterVideoFormatCodecs rejects tracks with bad codecs', () => {
  const bad1 = { format_id: '22', vcodec: 'av01', acodec: 'opus', protocol: 'https' };
  expect(Boolean(filterVideoFormatCodecs(bad1))).toBe(false);

  const bad2 = { format_id: '520', vcodec: 'vp09', acodec: 'opus', protocol: 'm3u8' };
  expect(Boolean(filterVideoFormatCodecs(bad2))).toBe(false);

  const bad3 = { format_id: '520', vcodec: 'vp9', acodec: 'opus', protocol: 'm3u8' };
  expect(Boolean(filterVideoFormatCodecs(bad3))).toBe(false);
});

test('filterVideoFormatCodecs rejects video-only https tracks', () => {
  const bad1 = { format_id: '22', vcodec: 'avc1', acodec: 'none', protocol: 'https' };
  expect(Boolean(filterVideoFormatCodecs(bad1))).toBe(false);
});

test('filterVideoFormatCodecs allows good tracks', () => {
  const good1 = { format_id: '22', vcodec: 'avc1', acodec: 'opus', protocol: 'https' };
  expect(Boolean(filterVideoFormatCodecs(good1))).toBe(true);

  const good2 = { format_id: '520', vcodec: 'avc1', acodec: 'none', protocol: 'm3u8' };
  expect(Boolean(filterVideoFormatCodecs(good2))).toBe(true);
});

test('filterAudioFormatCodecs filters out non-audio tracks', () => {
  const notAudio1 = { format_id: '230', acodec: 'none', protocol: 'https', tbr: 64000 };
  expect(Boolean(filterAudioFormatCodecs(notAudio1))).toBe(false);

  const notAudio2 = { format_id: '230', acodec: 'none', protocol: 'https', abr: 64000 };
  expect(Boolean(filterAudioFormatCodecs(notAudio2))).toBe(false);

  const notAudio3 = { format_id: '230', protocol: 'https' };
  expect(Boolean(filterAudioFormatCodecs(notAudio3))).toBe(false);

  const audio1 = { format_id: '230', acodec: 'opus', protocol: 'https' };
  expect(Boolean(filterAudioFormatCodecs(audio1))).toBe(true);

  const audio2 = { format_id: '230', protocol: 'https', abr: 64000 };
  expect(Boolean(filterAudioFormatCodecs(audio2))).toBe(true);

  const audio3 = { format_id: '230', protocol: 'https', audio_ext: 'mp4' };
  expect(Boolean(filterAudioFormatCodecs(audio3))).toBe(true);
});

test('filterAudioFormatCodecs filters out https/mp4a tracks', () => {
  const good1 = { format_id: '250', acodec: 'opus', protocol: 'https', abr: 64000 };
  expect(Boolean(filterAudioFormatCodecs(good1))).toBe(true);

  const good2 = { format_id: '250', acodec: 'mp4a.40.3', protocol: 'm3u8_native', abr: 64000 };
  expect(Boolean(filterAudioFormatCodecs(good2))).toBe(true);

  const good3 = { format_id: '250', protocol: 'm3u8_native', abr: 64000 };
  expect(Boolean(filterAudioFormatCodecs(good3))).toBe(true);

  const bad = { format_id: '250', acodec: 'mp4a.40.5', protocol: 'https', abr: 64000 };
  expect(Boolean(filterAudioFormatCodecs(bad))).toBe(false);
});

test('audioTrackSort prefers opus', () => {
  const a = { format_id: '250', acodec: 'opus', protocol: 'https', abr: 49000 };
  const b = { format_id: '140', acodec: undefined, protocol: 'm3u8_native', abr: 64000 };
  expect([a, b].sort(audioTrackSort)[0]).toBe(a);
  expect([b, a].sort(audioTrackSort)[0]).toBe(a);

  const c = { format_id: '250', acodec: 'opus', protocol: 'https', abr: null };
  const d = { format_id: '140', acodec: 'mp4a.4.3', protocol: 'https', abr: 49000 };
  expect([c, d].sort(audioTrackSort)[0]).toBe(c);
  expect([d, c].sort(audioTrackSort)[0]).toBe(c);
});

test('audioTrackSort prefers higher bitrates', () => {
  const a = { format_id: '250', acodec: 'opus', language: 'en', protocol: 'https', abr: 64000 };
  const b = { format_id: '250', acodec: 'opus', language: undefined, protocol: 'https', abr: 49000 };
  expect([a, b].sort(audioTrackSort)[0]).toBe(a);
  expect([b, a].sort(audioTrackSort)[0]).toBe(a);

  const c = { format_id: '250', acodec: 'opus', language: 'en-us', protocol: 'https' };
  const d = { format_id: '250', acodec: 'opus', language: undefined, protocol: 'https', abr: 49000 };
  expect([c, d].sort(audioTrackSort)[0]).toBe(d);
  expect([d, c].sort(audioTrackSort)[0]).toBe(d);
});

test('filterAudioFormatCodecs de-prefers non-english tracks', () => {
  const a = { format_id: '250', acodec: 'opus', language: 'es', protocol: 'https', abr: 49000 };
  const b = { format_id: '250', protocol: 'm3u8_native', abr: 49000 };
  expect([a, b].sort(audioTrackSort)[0]).toBe(b);
  expect([b, a].sort(audioTrackSort)[0]).toBe(b);

  const c = { format_id: '250', language: 'en-GB', protocol: 'm3u8_native', abr: 49000 };
  const d = { format_id: '250', language: 'es', protocol: 'm3u8_native', abr: 64000 };
  expect([c, d].sort(audioTrackSort)[0]).toBe(c);
  expect([d, c].sort(audioTrackSort)[0]).toBe(c);
});
