var { _private_testing } = require('./../index');

var assert = require('assert');

// Results must adhere to https://en.wikipedia.org/wiki/ISO_8601#Durations
describe('generateDurationString' , function() {
    it('works' , function() {
        const generateDurationString = _private_testing.generateDurationString;
        assert.equal(generateDurationString(11309), "PT3H8M29S");
        assert.equal(generateDurationString(3601), "PT1H1S");
        assert.equal(generateDurationString(3600), "PT1H0S");
        assert.equal(generateDurationString(60), "PT1M0S");
        assert.equal(generateDurationString(1), "PT1S");
        assert.equal(generateDurationString(0), "PT0S");
    });
});

// Ensure sorting criteria works as we expect
describe('videoTrackSort' , function() {
    const videoTrackSort = _private_testing.videoTrackSort;

    it('prefer higher resolution' , function() {
        const a = { format_id: 'aaa', height: 720, acodec: 'opus', protocol: 'm3u8', tbr: 1000 };
        const b = { format_id: 'bbb', height: 2180, acodec: 'none', protocol: 'dash', tbr: 3000 };

        assert.equal([a, b].sort(videoTrackSort)[0], b);
        assert.equal([b, a].sort(videoTrackSort)[0], b);
    });

    it('prefer combined tracks' , function() {
        const a = { format_id: 'aaa', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 1000 };
        const b = { format_id: 'bbb', height: 1080, acodec: 'none', protocol: 'm3u8', tbr: 3000 };

        assert.equal([a, b].sort(videoTrackSort)[0], a);
        assert.equal([b, a].sort(videoTrackSort)[0], a);

        const c = { format_id: 'ccc', height: 1080, acodec: 'none', protocol: 'dash', tbr: 1000 };
        const d = { format_id: 'ddd', height: 1080, acodec: 'opus', protocol: 'm3u8', tbr: 3000 };

        assert.equal([c, d].sort(videoTrackSort)[0], d);
        assert.equal([c, d].sort(videoTrackSort)[0], d);
    });

    it('prefer non-dash tracks' , function() {
        const a = { format_id: 'aaa', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 1000 };
        const b = { format_id: 'bbb', height: 1080, acodec: 'opus', protocol: 'm3u8', tbr: 3000 };

        assert.equal([a, b].sort(videoTrackSort)[0], b);
        assert.equal([b, a].sort(videoTrackSort)[0], b);

        const c = { format_id: 'ccc', height: 1080, acodec: 'none', protocol: 'm3u8', tbr: 3000 };
        const d = { format_id: 'ddd', height: 1080, acodec: 'none', protocol: 'dash', tbr: 3000 };

        assert.equal([c, d].sort(videoTrackSort)[0], c);
        assert.equal([c, d].sort(videoTrackSort)[0], c);
    });

    it('prefer lower tbr' , function() {
        const a = { format_id: 'aaa', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 3000 };
        const b = { format_id: 'bbb', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 1000 };

        assert.equal([a, b].sort(videoTrackSort)[0], b);
        assert.equal([b, a].sort(videoTrackSort)[0], b);

        const c = { format_id: 'ccc', height: 1080, acodec: 'none', protocol: 'm3u8', tbr: 1000 };
        const d = { format_id: 'ddd', height: 1080, acodec: 'none', protocol: 'm3u8', tbr: 3000 };

        assert.equal([c, d].sort(videoTrackSort)[0], c);
        assert.equal([c, d].sort(videoTrackSort)[0], c);
    });

    it('tiebreaker on format_id' , function() {
        const a = { format_id: 'aaa', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 3000 };
        const b = { format_id: 'bbb', height: 1080, acodec: 'opus', protocol: 'dash', tbr: 3000 };

        assert.equal([a, b].sort(videoTrackSort)[0], a);
        assert.equal([b, a].sort(videoTrackSort)[0], a);
    });
});

describe('filterFormatCodecs' , function() {
    const filterFormatCodecs = _private_testing.filterFormatCodecs;

    it('reject bad format_ids' , function() {
        const bad1 = { format_id: 'source', vcodec: 'avc1', acodec: 'opus', protocol: 'https' };
        const bad2 = { format_id: 'http-something-something', vcodec: 'avc1', acodec: 'opus', protocol: 'm3u8' };

        assert.equal(false, Boolean(filterFormatCodecs(bad1)));
        assert.equal(false, Boolean(filterFormatCodecs(bad2)));
    });

    it('reject tracks with no video' , function() {
        const bad1 = { format_id: '22', vcodec: 'none', acodec: 'opus', protocol: 'https' };
        const bad2 = { format_id: '520', acodec: 'opus', protocol: 'm3u8' };
        assert.equal(false, Boolean(filterFormatCodecs(bad1)));
        assert.equal(false, Boolean(filterFormatCodecs(bad2)));
    });

    it('reject bad codecs' , function() {
        const bad1 = { format_id: '22', vcodec: 'av01', acodec: 'opus', protocol: 'https' };
        const bad2 = { format_id: '520', vcodec: 'vp09', acodec: 'opus', protocol: 'm3u8' };
        const bad3 = { format_id: '520', vcodec: 'vp9', acodec: 'opus', protocol: 'm3u8' };

        assert.equal(false, Boolean(filterFormatCodecs(bad1)));
        assert.equal(false, Boolean(filterFormatCodecs(bad2)));
        assert.equal(false, Boolean(filterFormatCodecs(bad3)));
    });

    it('reject video-only https tracks' , function() {
        const bad1 = { format_id: '22', vcodec: 'avc1', acodec: 'none', protocol: 'https' };
        assert.equal(false, Boolean(filterFormatCodecs(bad1)));
    });

    it('allows good tracks' , function() {
        const good1 = { format_id: '22', vcodec: 'avc1', acodec: 'opus', protocol: 'https' };
        const good2 = { format_id: '520', vcodec: 'avc1', acodec: 'none', protocol: 'm3u8' };
        assert.equal(true, Boolean(filterFormatCodecs(good1)));
        assert.equal(true, Boolean(filterFormatCodecs(good2)));
    });
});
