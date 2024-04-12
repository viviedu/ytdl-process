const { spawn } = require('child_process');
const { join } = require('path');

// constants
const EN_LIST = ['en-us', 'en-gb', 'en', 'en-au'];

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
  '-f', `bestaudio[acodec=opus]/bestaudio`,
  '-J'
];

module.exports.PLAYLIST_ARGUMENTS = ['--flat-playlist', '-J'];

const timescale = 48000;

const generateDurationString = (totalSeconds) => {
  const secondsString = `${totalSeconds % 60}S`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const minutesString = minutes > 0 ? `${minutes}M` : '';

  const hours = Math.floor(totalMinutes / 60);
  const hoursString = hours > 0 ? `${hours}H` : '';

  return `PT${hoursString}${minutesString}${secondsString}`;
}

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
          <Representation id="${format_id}" bandwidth="4382360">
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

module.exports.isPlaylist = (url) => {
  return url.startsWith('https://www.youtube.com/playlist?list=');
};

// The "old" process method. It will sometimes return DASH manifests. These
// manifests may be more than what iMX can handle, so use `processV2` for
// boxes on version 2.8.5 or later.
module.exports.process = (output, origin) => {
  const data = JSON.parse(output.toString().trim());
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
      title,
      url,
      thumbnail
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
  const data = JSON.parse(output.toString().trim());
  const { automatic_captions, subtitles, url } = data;

  const cookies = data.http_headers && data.http_headers.Cookie || '';
  const duration = data.duration || 0;
  const subtitleFile = findBestSubtitleFile(subtitles) || findBestSubtitleFile(automatic_captions);
  const subtitleUrl = subtitleFile ? `${origin}/ytdl/vtt?suburi=${encodeURIComponent(subtitleFile.subs.url)}` : '';
  const title = data.title || '';

  if (data.fragments) {
    return {
      type: 'manifest',
      cookies,
      duration,
      manifest: generateManifest(data),
      subtitle_url: subtitleUrl,
      title,
    };
  }

  if (url) {
    return {
      type: 'url',
      cookies,
      duration,
      subtitle_url: subtitleUrl,
      title,
      url
    };
  }

  throw 'no url';
};

module.exports.processV3 = (output, origin, locales = []) => {
  const data = JSON.parse(output.toString().trim());
  const { automatic_captions, formats, subtitles } = data;
  const { fragments: audio_fragments, url: audio_url, format_id: audio_format, abr: audio_bitrate } = data;

  const cookies = data.http_headers && data.http_headers.Cookie || '';
  const duration = data.duration || 0;
  const subtitleFile = findBestSubtitleFile(subtitles, locales) || findBestSubtitleFile(automatic_captions, locales);
  const subtitleUrl = subtitleFile ? `${origin}/ytdl/vtt?suburi=${encodeURIComponent(subtitleFile.subs.url)}` : '';
  const title = data.title || '';
  const processedData = processFormats(formats);
  const thumbnail = data.thumbnail || '';

  const video_tracks = processedData.map((formatInfo) => {
    if (formatInfo.fragments) {
      const manifest = generateManifest({ ...formatInfo, duration });
      return { type: 'manifest', manifest, height: formatInfo.height, combined: formatInfo.acodec !== 'none', format_id: formatInfo.format_id };
    } else {
      return { type: 'url', url: formatInfo.url, height: formatInfo.height, combined: formatInfo.acodec !== 'none', format_id: formatInfo.format_id };
    }
  });

  let audio_track = null;
  let silent_video = false;
  if (audio_fragments || audio_url) {
    if (audio_bitrate === 0 || (audio_bitrate && audio_bitrate <= 10)) {
      // YouTube will return an empty audio track for silent videos.
      // This track has an extremely low ABR (<10k) and our gstreamer pipeline fails to play it.
      // If we get one of these, let the box know that this is a silent video.
      // Typical ABR: mp3 is 96k-320k, spotify is 96k-160k, very bad audio can be as low as 30k)
      //
      // If abr exists (is not null or undefined) and is <= 10, then don't return this audio track
      silent_video = true;
    } else if (audio_fragments) {
      const audioManifest = generateManifest(data, true);
      audio_track = { type: 'manifest', manifest: audioManifest, format_id: audio_format };
    } else {
      audio_track = { type: 'url', url: audio_url, format_id: audio_format };
    }
  }

  return {
    cookies,
    duration,
    subtitle_url: subtitleUrl,
    title,
    thumbnail,
    audio: audio_track,
    video: video_tracks,
    silent_video
  };
};

module.exports.processPlaylist = (output) => {
  const outputJSON = JSON.parse(output)
  if (outputJSON["entries"]) {
    return outputJSON["entries"].map((video) => `https://www.youtube.com/watch?v=${video.id}`);
  }
  return [];
};

module.exports.spawnPythonService = (additionalEnv = {}) => {
  return spawn('python3', ['-u', join(__dirname, 'service.py')], { env: { ...process.env, ...additionalEnv } });
}

// private

function findBestSubtitleFile(list, locales = []) {
  // favor locales but some subtitles just have the language code, zip it to keep the ordering
  const localesAndLanguages = locales.map((locale) => [locale.toLowerCase(), locale.substring(0, 2)]).flat();
  // unfound languages will have a priority of -1, so reversing the list here
  const languages = [...localesAndLanguages, ...EN_LIST].reverse();
  const uniqueLanguages = languages.filter((x, index) => languages.indexOf(x) === index);
  return Object.keys(list || {})
    .map((lang) => ({
      lang,
      subs: list[lang].find((x) => (x.ext === 'vtt' && x.protocol !== 'http_dash_segments' && x.protocol !== 'm3u8_native')),
      priority: uniqueLanguages.indexOf(lang.toLowerCase())
    }))
    .filter((x) => x.subs)
    .sort((x, y) => y.priority - x.priority)[0];
}

function processFormats(formats) {
  // Filter out tracks that are not suitable (see comments below)
  const filteredFormats = formats.filter((format) => filterFormatCodecs(format) && filterFormatFps(format));
  filteredFormats.sort(videoTrackSort)

  const selected4K = filteredFormats.find((format) => (format.height === 2160 && format.acodec !== 'none')) || filteredFormats.find((format) => format.height === 2160);
  const selected1080p = filteredFormats.find((format) => (format.height === 1080 && format.acodec !== 'none')) || filteredFormats.find((format) => format.height === 1080);
  const selectedLowQuality = filteredFormats.find((format) => (format.height === 720 && format.acodec !== 'none')) || filteredFormats.find((format) => format.height === 720) || filteredFormats.find((format) => (format.height <= 720 && format.acodec !== 'none')) || filteredFormats.find((format) => (format.height <= 720));

  return [selected4K, selected1080p, selectedLowQuality].filter(Boolean);
}

// Return > 0 if b is preferred
// Return < 0 if a is preferred
// Never return 1, we want track selection to be deterministic!
function videoTrackSort(a, b) {
  // Prefer tracks with higher resolution
  if (a.height !== b.height) {
    return b.height - a.height;
  }

  // Then prefer combined tracks over video-only tracks
  if (a.acodec !== 'none' && b.acodec === 'none') {
    return -1;
  }

  if (a.acodec === 'none' && b.acodec !== 'none') {
    return 1;
  }

  // Then prefer non-dash tracks. (Dash = manifest xml. Non-dash = a link that can be easily tested in a browser)
  if (a.protocol !== 'dash' && b.protocol === 'dash') {
    return -1;
  }
  
  if (a.protocol === 'dash' && b.protocol !== 'dash') {
    return 1;
  }

  // Then prefer lower total bit rate
  if (a.tbr != b.tbr) {
    return a.tbr - b.tbr;
  }

  // Sort on format_id, which is guaranteed to be unique per track
  return a.format_id < b.format_id ? -1 : 1;
}

function filterFormatCodecs(format) {
  const { acodec, format_id, protocol, vcodec } = format;
  return format_id !== 'source' && !format_id.startsWith('http')
    // ignore tracks with no video
    && vcodec && vcodec !== 'none'
    // boxes can't play vp9 or av01
    && !vcodec.includes('av01') && !vcodec.includes('vp9') && !vcodec.includes('vp09')
    // In our gstreamer pipeline, seeking breaks for video only tracks that have protocol=https
    // I couldn't figure out why. Therefore we take tracks with protocol=m3u8 or protocol=dash
    && (acodec !== 'none' || (acodec === 'none' && !protocol.includes('https')));
}

function filterFormatFps(format) {
  const { fps, height } = format;
  return ((height >= 1080 && fps <= 30) || height < 1080);
}

module.exports._private_testing = {
  generateDurationString,
  videoTrackSort,
  filterFormatCodecs
}
