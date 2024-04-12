const { _private_testing } = require('./../index');

const filterFormatCodecs = _private_testing.filterFormatCodecs;
const generateDurationString = _private_testing.generateDurationString;
const videoTrackSort = _private_testing.videoTrackSort;

// Results must adhere to https://en.wikipedia.org/wiki/ISO_8601#Durations
test('generateDurationString generates correct strings', () => {
    expect(generateDurationString(11309)).toBe("PT3H8M29S");
    expect(generateDurationString(3601)).toBe("PT1H1S");
    expect(generateDurationString(3600)).toBe("PT1H0S");
    expect(generateDurationString(60)).toBe("PT1M0S");
    expect(generateDurationString(1)).toBe("PT1S");
    expect(generateDurationString(0)).toBe("PT0S");
});

// Ensure sorting criteria works as we expect
test('videoTrackSort prefers higher resolutions', () => {
    const a = { format_id: 'aaa', height: 720, acodec: 'opus', protocol: 'm3u8', tbr: 1000 };
    const b = { format_id: 'bbb', height: 2180, acodec: 'none', protocol: 'dash', tbr: 3000 };
    expect([a, b].sort(videoTrackSort)[0]).toBe(b);
    expect([b, a].sort(videoTrackSort)[0]).toBe(b);
});

test('videoTrackSort prefers combined video/audio tracks', () => {
    const a = { format_id: 'aaa', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 1000 };
    const b = { format_id: 'bbb', height: 1080, acodec: 'none', protocol: 'm3u8', tbr: 3000 };
    expect([a, b].sort(videoTrackSort)[0]).toBe(a);
    expect([b, a].sort(videoTrackSort)[0]).toBe(a);

    const c = { format_id: 'ccc', height: 1080, acodec: 'none', protocol: 'dash', tbr: 1000 };
    const d = { format_id: 'ddd', height: 1080, acodec: 'opus', protocol: 'm3u8', tbr: 3000 };
    expect([c, d].sort(videoTrackSort)[0]).toBe(d);
    expect([d, c].sort(videoTrackSort)[0]).toBe(d);
});

test('videoTrackSort prefers url tracks over dash tracks', () => {
    const a = { format_id: 'aaa', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 1000 };
    const b = { format_id: 'bbb', height: 1080, acodec: 'opus', protocol: 'm3u8', tbr: 3000 };
    expect([a, b].sort(videoTrackSort)[0]).toBe(b);
    expect([b, a].sort(videoTrackSort)[0]).toBe(b);

    const c = { format_id: 'ccc', height: 1080, acodec: 'none', protocol: 'm3u8', tbr: 3000 };
    const d = { format_id: 'ddd', height: 1080, acodec: 'none', protocol: 'dash', tbr: 3000 };
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

test('filterFormatCodecs rejects bad format_ids', () => {
    const bad1 = { format_id: 'source', vcodec: 'avc1', acodec: 'opus', protocol: 'https' };
    expect(Boolean(filterFormatCodecs(bad1))).toBe(false);

    const bad2 = { format_id: 'http-something-something', vcodec: 'avc1', acodec: 'opus', protocol: 'm3u8' };
    expect(Boolean(filterFormatCodecs(bad2))).toBe(false);
});

test('filterFormatCodecs rejects tracks with no video', () => {
    const bad1 = { format_id: '22', vcodec: 'none', acodec: 'opus', protocol: 'https' };
    expect(Boolean(filterFormatCodecs(bad1))).toBe(false);

    const bad2 = { format_id: '520', acodec: 'opus', protocol: 'm3u8' };
    expect(Boolean(filterFormatCodecs(bad2))).toBe(false);
});

test('filterFormatCodecs rejects tracks with bad codecs', () => {
    const bad1 = { format_id: '22', vcodec: 'av01', acodec: 'opus', protocol: 'https' };
    expect(Boolean(filterFormatCodecs(bad1))).toBe(false);

    const bad2 = { format_id: '520', vcodec: 'vp09', acodec: 'opus', protocol: 'm3u8' };
    expect(Boolean(filterFormatCodecs(bad2))).toBe(false);

    const bad3 = { format_id: '520', vcodec: 'vp9', acodec: 'opus', protocol: 'm3u8' };
    expect(Boolean(filterFormatCodecs(bad3))).toBe(false);
});

test('filterFormatCodecs rejects video-only https tracks', () => {
    const bad1 = { format_id: '22', vcodec: 'avc1', acodec: 'none', protocol: 'https' };
    expect(Boolean(filterFormatCodecs(bad1))).toBe(false);
});

test('filterFormatCodecs allows good tracks', () => {
    const good1 = { format_id: '22', vcodec: 'avc1', acodec: 'opus', protocol: 'https' };
    expect(Boolean(filterFormatCodecs(good1))).toBe(true);

    const good2 = { format_id: '520', vcodec: 'avc1', acodec: 'none', protocol: 'm3u8' };
    expect(Boolean(filterFormatCodecs(good2))).toBe(true);
});
