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
test('videoTrackSort prefers English tracks', () => {
  const a = { url: 'https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1739180187/ei/O3SpZ-PoOoH54t4P8qW78Aw/ip/34.87.198.86/id/d36135e3af127478/itag/96/source/youtube/requiressl/yes/ratebypass/yes/pfa/1/sgoap/clen%3D19279506%3Bdur%3D1191.206%3Bgir%3Dyes%3Bitag%3D140%3Blmt%3D1726255321649374%3Bxtags%3Dacont%3Ddubbed:lang%3Des/sgovp/clen%3D110776328%3Bdur%3D1191.160%3Bgir%3Dyes%3Bitag%3D137%3Blmt%3D1726272768106614/rqh/1/hls_chunk_host/rr5---sn-ntqe6n7k.googlevideo.com/xpc/EgVo2aDSNQ%3D%3D/met/1739158587,/mh/Go/mm/31,29/mn/sn-ntqe6n7k,sn-ntq7yner/ms/au,rdu/mv/m/mvi/5/pl/20/rms/au,au/bui/AUWDL3zFIr3grgLqhA07qaSlpwnCVmCUsq8b0YsqdScC3PwiOO7D9x0eW9lKVQLmCUGKxRjJ682Rye2m/spc/RjZbSdRzGV7OcAS771Eh7hvyV1fU6vpm9pGlxT6YC4FQy-hlFHa5DGb2WfI-rqhtlg/vprv/1/playlist_type/CLEAN/dover/11/txp/4532434/mt/1739158125/fvip/5/keepalive/yes/fexp/51326932,51355912,51371294/sparams/expire,ei,ip,id,itag,source,requiressl,ratebypass,pfa,sgoap,sgovp,rqh,xpc,bui,spc,vprv,playlist_type/sig/AJfQdSswRgIhAK8rtfLvsQI0e44sfVQqYGV6-n0pxlylLNsQw_ed4SBrAiEA05gR89lBygk4A-Bv6p5rnIPNKrjpNIANyLvxUZ_LJ18%3D/lsparams/hls_chunk_host,met,mh,mm,mn,ms,mv,mvi,pl,rms/lsig/AGluJ3MwRAIgaH6jpXt2TQB3-YjY863Q7Yn81mH5IaBaOUtFRgbWjrQCIFWY0i3e_la00xwxKX1ieOTgAvtX7JzP_nQIOtkQ9zBG/playlist/index.m3u8' };
  const b = { url: 'https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1739180141/ei/DXSpZ6aSFb6W4t4PnP_H0Ak/ip/34.34.245.45/id/d36135e3af127478/itag/96/source/youtube/requiressl/yes/ratebypass/yes/pfa/1/sgoap/clen%3D19279564%3Bdur%3D1191.230%3Bgir%3Dyes%3Bitag%3D140%3Blmt%3D1726262000529578%3Bxtags%3Dacont%3Doriginal:lang%3Den/sgovp/clen%3D110776328%3Bdur%3D1191.160%3Bgir%3Dyes%3Bitag%3D137%3Blmt%3D1726272768106614/rqh/1/hls_chunk_host/rr5---sn-ntq7yner.googlevideo.com/xpc/EgVo2aDSNQ%3D%3D/met/1739158541,/mh/Go/mm/31,26/mn/sn-ntq7yner,sn-a5msenes/ms/au,onr/mv/u/mvi/5/pl/28/rms/au,au/bui/AUWDL3ypUvQClf0ER1VCXf4FPmbrVen_2p9PCGlo8EJzemtSumIYcXmzXq7yKWNZbIBCDd3tfD02wbKa/spc/RjZbSbJU3sERhlAOepzIK3r18iKG3sdjqOIqP5G9DGr4fvzsHzOnTHav3TqM89HOHg/vprv/1/playlist_type/CLEAN/dover/11/txp/4532434/mt/1739157710/fvip/4/keepalive/yes/fexp/51326932,51355912,51371294,51387516/sparams/expire,ei,ip,id,itag,source,requiressl,ratebypass,pfa,sgoap,sgovp,rqh,xpc,bui,spc,vprv,playlist_type/sig/AJfQdSswRAIgHm4F3lLDHTyDw4xfjh8R3AFkKCqUtELmfmzmwu3MeUgCIB551r4-0QUQI3mcRJas89gin3XP84zSKqXY0jRP18Eh/lsparams/hls_chunk_host,met,mh,mm,mn,ms,mv,mvi,pl,rms/lsig/AGluJ3MwRAIgfHdMYgOAu3R0S_fAbXu1GH9magPouPzK62z7A5B6ZDUCIHddkhheIKMI8y677o_6-EdPS7O6Ii2z6zs59_6l_7wx/playlist/index.m3u8' };
  expect([a, b].sort(videoTrackSort)[0]).toBe(b);
  expect([b, a].sort(videoTrackSort)[0]).toBe(b);
});

test('videoTrackSort prefers higher resolutions', () => {
  const a = { format_id: 'hls-akfire_interconnect_quic_sep-2519', height: 720, acodec: 'opus', protocol: 'm3u8', tbr: 1000 };
  const b = { format_id: 'hls-akfire_interconnect_quic-2325', height: 2180, acodec: 'none', protocol: 'dash', tbr: 3000 };
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
  const b = { format_id: '22', height: 1080, acodec: 'opus', protocol: 'm3u8', tbr: 3000 };
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

test('filterAudioFormatCodecs filters out https/mp4a tracks for v3 (returnMultiple=false), but not for v4 (returnMultiple=true)', () => {
  const good1 = { format_id: '250', acodec: 'opus', protocol: 'https', abr: 64000 };
  expect(Boolean(filterAudioFormatCodecs(good1, false))).toBe(true);

  const good2 = { format_id: '250', acodec: 'mp4a.40.3', protocol: 'm3u8_native', abr: 64000 };
  expect(Boolean(filterAudioFormatCodecs(good2, false))).toBe(true);

  const good3 = { format_id: '250', protocol: 'm3u8_native', abr: 64000 };
  expect(Boolean(filterAudioFormatCodecs(good3, false))).toBe(true);

  const bad = { format_id: '250', acodec: 'mp4a.40.5', protocol: 'https', abr: 64000 };
  expect(Boolean(filterAudioFormatCodecs(bad, false))).toBe(false);
  expect(Boolean(filterAudioFormatCodecs(bad, true))).toBe(true);
  
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
