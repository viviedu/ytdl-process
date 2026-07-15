const { spawn } = require('child_process');
const { join } = require('path');

// constants
const EN_LIST = ['en-us', 'en-gb', 'en', 'en-au'];
const LOCALES = [['en-GB'], ['en-US'], ['fr-FR'], ['pt-PT'], ['de-DE']];

// public

const commonProperties = [
  '[format_id!=source]',
  '[vcodec!*=av01]',
  '[vcodec!*=vp9]'
].join('');

const formatPreferences = [
  'best[height = 1080][fps <= 30]',
  'best[height <=? 720]'
].join('/');

module.exports.ARGUMENTS = [
  '--restrict-filenames',
  '--write-sub',
  '--write-auto-sub',
  '--no-playlist',
  '-f', `(${formatPreferences})${commonProperties}`,
  '-J'
];

module.exports.ARGUMENTS_MULTI_FORMAT = [
  '--restrict-filenames',
  '--write-sub',
  '--write-auto-sub',
  '--no-playlist',
  '--extractor-args', 'youtube:player-client=android_vr,web_safari,tv',
  '-J'
];

module.exports.PLAYLIST_ARGUMENTS = ['--flat-playlist', '-J'];

const timescale = 48000;

// Fallback bandwidth when yt-dlp reports no usable tbr.
const DEFAULT_BANDWIDTH = 4382360;

const generateDurationString = (totalSeconds) => {
  const secondsString = `${totalSeconds % 60}S`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const minutesString = minutes > 0 ? `${minutes}M` : '';

  const hours = Math.floor(totalMinutes / 60);
  const hoursString = hours > 0 ? `${hours}H` : '';

  return `PT${hoursString}${minutesString}${secondsString}`;
};

const generateManifest = (data, isAudio = false) => {
  const { duration, ext, format_id, fragments, fragment_base_url } = data;
  const durationString = generateDurationString(duration);
  const type = isAudio ? 'audio' : 'video';
  const realExt = (isAudio && ext === 'm4a') ? 'mp4' : ext; // m4a is audio only mp4. gstreamer needs 'mp4' here
  let time = 0;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>
    <MPD
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xmlns="urn:mpeg:dash:schema:mpd:2011"
      profiles="urn:mpeg:dash:profile:isoff-live:2011"
      mediaPresentationDuration="${durationString}"
      type="static"
    >
      <BaseURL><![CDATA[${fragment_base_url || ''}]]></BaseURL>
      <Period start="PT0.000S" duration="${durationString}">
        <AdaptationSet mimeType="${type}/${realExt}">
          <Representation id="${format_id}" bandwidth="${DEFAULT_BANDWIDTH}">
            <SegmentList timescale="${timescale}">
              ${fragments.map((fragment) => {
      const path = fragment.path.replace('&', '&amp;');
      return `<SegmentURL media="${path}" />`;
    }).join('')}
              <SegmentTimeline>
                ${fragments.map((fragment) => {
      const duration = (fragment.duration || 0.01) * timescale;
      const segment = `<S t="${time}" d="${duration}"/>`;
      time += duration;
      return segment;
    }).join('')}
              </SegmentTimeline>
            </SegmentList>
          </Representation>
        </AdaptationSet>
      </Period>
    </MPD>`
  );
};

// yt-dlp does not sanitize format_id/vcodec/ext/url, so escape them before interpolating into XML attributes.
const escapeXmlAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// googlevideo URLs carry the file's total size in `clen`; used as the media byte-range end.
const parseContentLength = (url) => {
  const match = /[?&]clen=(\d+)/.exec(url || '');
  return match ? parseInt(match[1], 10) : null;
};
// Fallback media-range end when clen is absent; googlevideo clamps an over-long range to the real length.
const SEGMENT_END_SENTINEL = 9999999999;

// YouTube video tracks are now single-file `https` URLs with no fragments; gstreamer can't seek them
// as a raw URL (qtdemux rejects the flushing seek in push mode). Wrapping in a DASH manifest routes
// them through dashdemux, which seeks via byte-range requests. Uses a single-segment SegmentList, not
// SegmentBase/BaseURL: the box's legacy dashdemux drops the query string from <BaseURL>, and YouTube
// URLs are all query, so a stripped BaseURL 404s. The full url in SegmentURL attributes preserves it.
// Seeking works because the sidx sits at the front of the media range. init_range comes from service.py.
const generateSegmentListManifest = ({ url, format_id, vcodec, width, height, tbr, ext, duration, init_range }) => {
  const durationString = generateDurationString(duration);
  const bandwidth = Math.round((tbr || 0) * 1000) || DEFAULT_BANDWIDTH;
  const codecsAttr = vcodec && vcodec !== 'none' ? ` codecs="${escapeXmlAttr(vcodec)}"` : '';
  const sizeAttrs = (width && height) ? ` width="${width}" height="${height}"` : '';
  const initEnd = parseInt(String(init_range).split('-')[1], 10);
  const mediaStart = Number.isFinite(initEnd) ? initEnd + 1 : 0;
  const clen = parseContentLength(url);
  const mediaEnd = clen ? clen - 1 : SEGMENT_END_SENTINEL;
  const urlAttr = escapeXmlAttr(url);

  return (
    `<?xml version="1.0" encoding="UTF-8"?>
    <MPD
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xmlns="urn:mpeg:dash:schema:mpd:2011"
      profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
      mediaPresentationDuration="${durationString}"
      minBufferTime="PT2S"
      type="static"
    >
      <Period duration="${durationString}">
        <AdaptationSet mimeType="video/${escapeXmlAttr(ext || 'mp4')}" contentType="video" subsegmentAlignment="true">
          <Representation id="${escapeXmlAttr(format_id)}"${codecsAttr}${sizeAttrs} bandwidth="${bandwidth}">
            <SegmentList duration="${Math.max(1, Math.round(duration))}">
              <Initialization sourceURL="${urlAttr}" range="${init_range}"/>
              <SegmentURL media="${urlAttr}" mediaRange="${mediaStart}-${mediaEnd}"/>
            </SegmentList>
          </Representation>
        </AdaptationSet>
      </Period>
    </MPD>`
  );
};

// Throttled googlevideo URLs (those with an `n` param, from web/tv clients) ignore deep Range requests
// and serve from offset 0, which breaks seeking - so we only wrap un-throttled (android_vr) URLs.
// Scoped to googlevideo: an `n` param on another CDN says nothing about throttling.
function isThrottledUrl(url) {
  if (typeof url !== 'string' || !/[?&]n=/.test(url)) {
    return false;
  }
  try {
    const { hostname } = new URL(url);
    return hostname === 'googlevideo.com' || hostname.endsWith('.googlevideo.com');
  } catch {
    return false;
  }
}

module.exports.isPlaylist = (url) => {
  return url.startsWith('https://www.youtube.com/playlist?list=');
};

const parseYtdlOutput = (output) => {
  let data;
  try {
    data = JSON.parse(output.toString().trim());
  } catch (e) {
    throw new Error(`Failed to parse yt-dlp output as JSON: ${e.message}`);
  }
  if (data === null) {
    throw new Error('Failed to parse yt-dlp output as JSON: output was null');
  }
  return data;
};

// The "old" process method. It will sometimes return DASH manifests. These
// manifests may be more than what iMX can handle, so use `processV2` for
// boxes on version 2.8.5 or later.
module.exports.process = (output, origin) => {
  const data = parseYtdlOutput(output);

  const { automatic_captions, subtitles, url } = data;

  const cookies = data.http_headers && data.http_headers.Cookie || '';
  const duration = data.duration || 0;
  const subtitleFile = findBestSubtitleFile(subtitles) || findBestSubtitleFile(automatic_captions);
  const subtitleUrl = subtitleFile ? `${origin}/ytdl/vtt?suburi=${encodeURIComponent(subtitleFile.subs.url)}` : '';
  const title = data.title || '';
  const thumbnail = data.thumbnail || '';

  if (url) {
    return {
      cookies,
      duration,
      subtitle_url: subtitleUrl,
      thumbnail,
      title,
      url
    };
  }

  throw 'no url';
};

// Creates fake manifests for DASH. Should be used on iMX after version 2.8.5
// not suitable for previous versions since they have a bug that prevents these
// fake manifests from being played
// We may need a v3 process if we want to support higher resolutions on
// Android. Mixed iMX and Android multi display rooms will need to have two
// ytdl requests to get both resolutions
module.exports.processV2 = (output, origin) => {
  const data = parseYtdlOutput(output);
  const { automatic_captions, subtitles, url } = data;

  const cookies = data.http_headers && data.http_headers.Cookie || '';
  const duration = data.duration || 0;
  const subtitleFile = findBestSubtitleFile(subtitles) || findBestSubtitleFile(automatic_captions);
  const subtitleUrl = subtitleFile ? `${origin}/ytdl/vtt?suburi=${encodeURIComponent(subtitleFile.subs.url)}` : '';
  const title = data.title || '';

  if (data.fragments) {
    return {
      cookies,
      duration,
      manifest: generateManifest(data),
      subtitle_url: subtitleUrl,
      title,
      type: 'manifest'
    };
  }

  if (url) {
    return {
      cookies,
      duration,
      subtitle_url: subtitleUrl,
      title,
      type: 'url',
      url
    };
  }

  throw 'no url';
};

// processV3 returns a list of video tracks instead of a single one
module.exports.processV3 = (output, origin, locales = []) => {
  const data = parseYtdlOutput(output);
  const { automatic_captions, formats, subtitles } = data;

  const cookies = data.http_headers && data.http_headers.Cookie || '';
  const duration = data.duration || 0;
  const subtitlesForAllLocales = getSubtitlesForAllLocales(origin, subtitles, automatic_captions);
  const title = data.title || '';
  const processedVideoTracks = processVideoFormats(formats, !data.duration);
  const thumbnail = data.thumbnail || '';

  const audioTrack = processAudioFormats(formats);

  const video_tracks = processedVideoTracks.map((formatInfo) => {
    if (formatInfo.fragments) {
      const manifest = generateManifest({ ...formatInfo, duration });
      return { type: 'manifest', manifest, height: formatInfo.height, combined: formatInfo.acodec !== 'none', format_id: formatInfo.format_id, protocol: formatInfo.protocol };
    } else {
      return { type: 'url', url: formatInfo.url, height: formatInfo.height, combined: formatInfo.acodec !== 'none', format_id: formatInfo.format_id, protocol: formatInfo.protocol };
    }
  });

  let audio_track = null;
  let silent_video = false;

  // Previously, we let yt-dlp auto pick a single audio track for us. It picks the best opus track. Not sure how it picks when there are no opus tracks.
  // Now, we do our own selection. This lets us:
  //  - pick a sensible fallback option when there are no opus tracks
  //  - make a sensible selection when there are audio tracks of multiple languages available
  if (audioTrack != null) {
    const { fragments: audio_fragments, url: audio_url, format_id: audio_format, abr: audio_bitrate, protocol: audio_protocol, language } = audioTrack;
    const audio_language = language || 'unknown';
    if (audio_fragments || audio_url) {
      if (isSilentVideo(audio_bitrate)) {
        silent_video = true;
      } else if (audio_fragments) {
        const audioManifest = generateManifest({ ...audioTrack, duration }, true);
        audio_track = { type: 'manifest', manifest: audioManifest, format_id: audio_format, protocol: audio_protocol, language: audio_language };
      } else {
        audio_track = { type: 'url', url: audio_url, format_id: audio_format, protocol: audio_protocol, language: audio_language };
      }
    }
  }

  return {
    audio: audio_track,
    cookies,
    duration,
    silent_video,
    subtitles: subtitlesForAllLocales,
    thumbnail,
    title,
    video: video_tracks
  };
};

// processV4 returns a list of video tracks and a list of audio tracks
module.exports.processV4 = (output, origin, locales = []) => {
  const data = parseYtdlOutput(output);
  const { automatic_captions, formats, subtitles } = data;
  const cookies = data.http_headers && data.http_headers.Cookie || '';
  const duration = data.duration || 0;
  const subtitlesForAllLocales = getSubtitlesForAllLocales(origin, subtitles, automatic_captions);
  const title = data.title || '';
  const processedVideoTracks = processVideoFormats(formats, !data.duration, true);
  const thumbnail = data.thumbnail || '';

  const audioTracks = processAudioFormats(formats, true);

  const video_tracks = processedVideoTracks.map(formatInfo => {
    const combined = formatInfo.acodec !== 'none';
    const track = { height: formatInfo.height, combined, format_id: formatInfo.format_id, protocol: formatInfo.protocol };
    if (formatInfo.fragments) {
      const manifest = generateManifest({ ...formatInfo, duration });
      return { type: 'manifest', manifest, ...track };
    }

    // Wrap single-file https video-only tracks in a SegmentList manifest so they seek via dashdemux
    // (see generateSegmentListManifest). Throttled URLs are excluded (they ignore Range, see
    // isThrottledUrl); tracks without ranges fall back to a plain, non-seekable url. Combined tracks
    // stay plain urls - un-throttled ones seek via qtdemux, throttled ones have no seekable form.
    if (!combined && formatInfo.url && formatInfo.protocol && formatInfo.protocol.includes('https') && !isThrottledUrl(formatInfo.url) && formatInfo.init_range && formatInfo.index_range) {
      const manifest = generateSegmentListManifest({ ...formatInfo, duration });
      // Keep the plain url alongside the manifest: type:'manifest' + protocol:'https' is new, so a
      // consumer that branches on protocol can still fall back to the (non-seekable) url.
      return { type: 'manifest', manifest, url: formatInfo.url, ...track };
    }

    return { type: 'url', url: formatInfo.url, ...track };
  });

  // In V4 we just return all the eligible audio tracks and let the box pick.
  //
  // The three most common kinds of audio tracks:
  //  1) proto=https acodec=opus: ok on Vivi Display, ok on physical devices
  //  2) proto=https acodec=mp4a: ok on Vivi Display, cannot be played on physical devices
  //  3) proto=m3u8 acodec=unknown: cannot be played on Vivi Display, ok on phyiscal devices
  //
  // Type 1 is the best. There are (very rarely) youtube videos that do not have this kind of track.
  // Just return everything and let vivi-box pick, it knows whether it's on a Vivi Display or on a physical device
  const formattedTracks = audioTracks.map(audioTrack => {
    const { acodec, fragments: audio_fragments, url: audio_url, format_id: audio_format, abr: audio_bitrate, protocol: audio_protocol, language } = audioTrack;
    const audio_language = language || 'unknown';
    if (isSilentVideo(audio_bitrate)) {
      return;
    } else if (audio_fragments) {
      const audioManifest = generateManifest({ ...audioTrack, duration }, true);
      return { type: 'manifest', acodec, manifest: audioManifest, format_id: audio_format, protocol: audio_protocol, language: audio_language };
    } else {
      return { type: 'url', acodec, url: audio_url, format_id: audio_format, protocol: audio_protocol, language: audio_language };
    }
  }).filter(Boolean);

  return {
    audio: formattedTracks,
    cookies,
    duration,
    silent_video: formattedTracks.length === 0,
    subtitles: subtitlesForAllLocales,
    thumbnail,
    title,
    video: video_tracks
  };
};

module.exports.processPlaylist = (output) => {
  const outputJSON = JSON.parse(output);
  if (outputJSON.entries) {
    return outputJSON.entries.map((video) => `https://www.youtube.com/watch?v=${video.id}`);
  }
  return [];
};

module.exports.spawnPythonService = (additionalEnv = {}) => {
  return spawn('python3', ['-u', join(__dirname, 'service.py')], { env: { ...process.env, ...additionalEnv } });
};

// private

function findBestSubtitleFile(list, locales = []) {
  // favor locales but some subtitles just have the language code, zip it to keep the ordering
  const localesAndLanguages = locales.map((locale) => [locale.toLowerCase(), locale.substring(0, 2)]).flat();
  const languages = [...localesAndLanguages, ...EN_LIST];
  // unfound languages will have a priority of -1, so reversing the list here
  const uniqueLanguages = languages.filter((x, index) => languages.indexOf(x) === index).reverse();
  return Object.keys(list || {})
    .map((lang) => ({
      lang,
      subs: list[lang].find((x) => (x.ext === 'vtt' && x.protocol !== 'http_dash_segments' && x.protocol !== 'm3u8_native')),
      priority: uniqueLanguages.indexOf(lang.toLowerCase())
    }))
    .filter((x) => x.subs)
    .sort((x, y) => y.priority - x.priority)[0];
}

function isSilentVideo(audio_bitrate) {
  return audio_bitrate && audio_bitrate <= 10;
}

function processVideoFormats(formats, isStream, preferUnthrottled = false) {
  // Filter out tracks that are not suitable (see comments below)
  const filteredFormats = formats.filter((format) => filterVideoFormatCodecs(format) && filterVideoFormatFps(format));

  // Sort the tracks because .find will return the first match
  filteredFormats.sort(makeVideoTrackSort(preferUnthrottled));

  // If you change track selection, then all permutations of the following should ideally be tested:
  //    - signage, play content
  //    - youtube livestream, youtube regular video
  //    - real device (IMX or GF, either is fine), vivi anywhere
  //
  // So the above results in 8x permutations
  // Also, check that:
  //  - subtitles still work
  //  - play/pausing and seeking in play content still works
  const tracks = [];

  if (isStream) {
    // Livestreams will always have a combined m3u8 track, return this.
    // (For a livestream, ALL its tracks are m3u8. This means if we decide to return split tracks for
    // a livestream, it will be a m3u8 audio track and a m3u8 video track.)
    tracks.push(filteredFormats.find((format) => (format.height <= 2160 && format.height > 1080 && format.acodec !== 'none')));
    tracks.push(filteredFormats.find((format) => (format.height <= 1080 && format.height > 720 && format.acodec !== 'none')));
    tracks.push(filteredFormats.find((format) => (format.height <= 720 && format.acodec !== 'none')));
  } else {
    // Non-livestreams
        
    // Find the best combined and split track for each quality level
    tracks.push(filteredFormats.find((format) => (format.height <= 2160 && format.height > 1080 && format.acodec !== 'none')));
    tracks.push(filteredFormats.find((format) => (format.height <= 2160 && format.height > 1080 && format.acodec === 'none')));

    tracks.push(filteredFormats.find((format) => (format.height <= 1080 && format.height > 720 && format.acodec !== 'none')));
    tracks.push(filteredFormats.find((format) => (format.height <= 1080 && format.height > 720 && format.acodec === 'none')));

    tracks.push(filteredFormats.find((format) => (format.height <= 720 && format.acodec !== 'none')));
    tracks.push(filteredFormats.find((format) => (format.height <= 720 && format.acodec === 'none')));
  }

  return tracks.filter(Boolean);
}

// Return > 0 if b is preferred
// Return < 0 if a is preferred
// Never return 0, we want track selection to be deterministic!
//
// preferUnthrottled is V4-only: it prefers the un-throttled variant of a resolution so it can be
// served as a seekable manifest (see isThrottledUrl). V3 keeps its historical selection (lower bitrate).
function makeVideoTrackSort(preferUnthrottled = false) {
  return function videoTrackSort(a, b) {
    // Prefer English audio
    const englishAudioTag = 'original:lang%3Den';
    if ((a.url && a.url.includes(englishAudioTag)) && !(b.url && b.url.includes(englishAudioTag))) {
      return -1;
    }
    if (!(a.url && a.url.includes(englishAudioTag)) && (b.url && b.url.includes(englishAudioTag))) {
      return 1;
    }

    // Prefer tracks with higher resolution
    if (a.height !== b.height) {
      return b.height - a.height;
    }

    // Only compared between plain https tracks: manifest urls (m3u8/dash) never carry the n param,
    // so without this guard they would always win the throttle comparison.
    if (preferUnthrottled && a.protocol.includes('https') && b.protocol.includes('https')) {
      const aThrottled = isThrottledUrl(a.url);
      const bThrottled = isThrottledUrl(b.url);
      if (!aThrottled && bThrottled) {
        return -1;
      }
      if (aThrottled && !bThrottled) {
        return 1;
      }
    }

    // Prefer non-dash tracks. (Dash = manifest xml. Non-dash = a link that can be easily tested in a browser)
    if (!a.protocol.includes('dash') && b.protocol.includes('dash')) {
      return -1;
    }
    if (a.protocol.includes('dash') && !b.protocol.includes('dash')) {
      return 1;
    }

    // Then prefer combined tracks over video-only tracks
    if (a.acodec !== 'none' && b.acodec === 'none') {
      return -1;
    }
    if (a.acodec === 'none' && b.acodec !== 'none') {
      return 1;
    }

    if (a.format_id.includes('akfire_interconnect') || a.format_id.includes('fastly_skyfire')) {
      // Vimeo video!
      // If one has 'sep' in the format_id and one does not, we take the one with 'sep' in its format_id
      // VIVI-12238: video tracks that don't have '_sep' in its format_id are sometimes failing, reasons unknown
      if (a.format_id.includes('_sep') && !b.format_id.includes('_sep')) {
        return -1;
      }
      if (!a.format_id.includes('_sep') && b.format_id.includes('_sep')) {
        return 1;
      }
    }

    // Then prefer lower total bit rate
    if (a.tbr != b.tbr) {
      return a.tbr - b.tbr;
    }

    // Sort on format_id, which is guaranteed to be unique per track
    return a.format_id < b.format_id ? -1 : 1;
  };
}

const videoTrackSort = makeVideoTrackSort();

function filterVideoFormatCodecs(format) {
  const { format_id, vcodec } = format;
  return format_id !== 'source' && !format_id.startsWith('http')
    // ignore tracks with no video
    && vcodec && vcodec !== 'none'
    // boxes can't play vp9 or av01
    && !vcodec.includes('av01') && !vcodec.includes('vp9') && !vcodec.includes('vp09');
}

function filterVideoFormatFps(format) {
  const { fps, height } = format;
  return ((height >= 1080 && fps <= 30) || height < 1080);
}

function processAudioFormats(formats, returnMultiple = false) {
  // Filter out tracks that are not suitable (see comments below)
  const filteredFormats = formats.filter((format) => filterAudioFormatCodecs(format, returnMultiple));
  // Sort the tracks because .find will return the first match
  filteredFormats.sort(audioTrackSort);

  if (returnMultiple) {
    return filteredFormats;
  }

  return filteredFormats.length ? filteredFormats[0] : null;
}

function filterAudioFormatCodecs(format, returnMultiple) {
  const { acodec, audio_ext, abr, protocol, vcodec } = format;

  // Audio tracks that are m3u8 have audio_ext set, but acodec and abr are undefined. For some reason yt-dlp can't determine acodec and abr in these situations
  if (acodec && acodec === 'none') {
    // not an audio track
    return false;
  }

  if (!acodec && !audio_ext && !abr) {
    // not an audio track
    return false;
  }

  // Don't return combined audio/video tracks here
  // (audio tracks = audio only, video tracks = may or may not be a combined track)
  if (vcodec && vcodec !== 'none') {
    return false;
  }

  // Tracks with protocol=https and acodec=mp4a are no good on physical Vivi devices.
  // If we are V4 (returnMultiple=true), return these and vivi-box code will know not to use it for a physical device.
  if ((protocol.includes('https') && acodec && acodec.includes('mp4a')) && !returnMultiple) {
    return false;
  }

  return true;
}

// Return > 0 if b is preferred
// Return < 0 if a is preferred
// Never return 1, we want track selection to be deterministic!
function audioTrackSort(a, b) {
  // Prefer non-dash tracks. (Dash = manifest xml. Non-dash = a link that can be easily tested in a browser)
  if (!a.protocol.includes('dash') && b.protocol.includes('dash')) {
    return -1;
  }
  if (a.protocol.includes('dash') && !b.protocol.includes('dash')) {
    return 1;
  }

  // We can't filter out non-english tracks, because a teacher may be playing a non-english video (e.g. second language class).
  // Right now, we de-prioritize non-english tracks. In future, we may want to decide based on the video's original language and/or
  // the user's locale setting.
  //
  // This is good enough for now, because I think very few videos will have multiple language options. The ones I have found have
  // all been videos where the user has uploaded a dubbed audio track.
  const a_non_english = a.language && !a.language.startsWith('en');
  const b_non_english = b.language && !b.language.startsWith('en');
  if (a_non_english && !b_non_english) {
    return 1;
  }
  
  if (!a_non_english && b_non_english) {
    return -1;
  }

  // Prefer opus tracks
  const a_acodec = a.acodec ? a.acodec : 'unknown';
  const b_bcodec = b.acodec ? b.acodec : 'unknown';
  if (a_acodec.includes('opus') && !b_bcodec.includes('opus')) {
    return -1;
  }
  
  if (!a_acodec.includes('opus') && b_bcodec.includes('opus')) {
    return 1;
  }

  // prefer higher bit rate
  const a_abr = a.abr ? a.abr : 0;
  const b_abr = b.abr ? b.abr : 0;
  if (a_abr != b_abr) {
    return b_abr - a_abr;
  }
  
  // Sort on format_id, which is guaranteed to be unique per track
  return a.format_id < b.format_id ? -1 : 1;
}

function getSubtitlesForAllLocales(origin, subtitles, automatic_captions, useEmptyLocale = false) {
  const subtitlesForAllLocales = {};
  for (const locale of LOCALES) {
    const subtitleLocale = useEmptyLocale ? [] : locale;
    const subtitleFile = findBestSubtitleFile(subtitles, subtitleLocale) || findBestSubtitleFile(automatic_captions, subtitleLocale);
    const subtitleUrl = subtitleFile ? `${origin}/ytdl/vtt?suburi=${encodeURIComponent(subtitleFile.subs.url)}` : '';
    subtitlesForAllLocales[locale[0]] = subtitleUrl;
  }
  return subtitlesForAllLocales;
}

module.exports._private_testing = {
  generateDurationString,
  generateSegmentListManifest,
  isThrottledUrl,
  audioTrackSort,
  makeVideoTrackSort,
  videoTrackSort,
  filterVideoFormatCodecs,
  filterAudioFormatCodecs
};
