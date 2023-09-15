const { spawn } = require('child_process');
const { join } = require('path');

// constants
const EN_LIST = ['en-US', 'en-GB', 'en', 'en-AU'];

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
  '-f', `bestaudio${commonProperties}`,
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

const generateManifest = (data) => {
  const { duration, ext, format_id, fragments, fragment_base_url } = data;
  const durationString = generateDurationString(duration);
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
        <AdaptationSet mimeType="video/${ext}">
          <Representation id="${format_id}" bandwidth="4382360">
            <SegmentList timescale="${timescale}">
              ${fragments.map((fragment) => `<SegmentURL media="${fragment.path}" />`).join('')}
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

module.exports.processV3 = (output, origin) => {
  const data = JSON.parse(output.toString().trim());
  const { automatic_captions, formats, fragments, subtitles, url: audio } = data;

  const cookies = data.http_headers && data.http_headers.Cookie || '';
  const duration = data.duration || 0;
  const subtitleFile = findBestSubtitleFile(subtitles) || findBestSubtitleFile(automatic_captions);
  const subtitleUrl = subtitleFile ? `${origin}/ytdl/vtt?suburi=${encodeURIComponent(subtitleFile.subs.url)}` : '';
  const title = data.title || '';
  const processedData = processFormats(formats);

  Object.keys(processedData).forEach((format) => {
    const formatInfo = processedData[format];
    if (formatInfo.type === 'manifest') {
      const manifest = generateManifest({ ...formatInfo, duration });
      processedData[format] = { type: 'manifest', manifest };
    } else {
      processedData[format] = { type: 'url', url: formatInfo.url }
    }
  });

  if (fragments) {
    const audioManifest = generateManifest(data);
    processedData.audio = { type: 'manifest', manifest: audioManifest };
  } else {
    processedData.audio = { type: 'url', url: audio };
  }

  return {
    cookies,
    duration,
    subtitle_url: subtitleUrl,
    title,
    ...processedData
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
  return spawn(join(__dirname, 'service.py'), [], { env: { ...process.env, ...additionalEnv } });
}

// private

function findBestSubtitleFile(list) {
  return Object.keys(list || {})
    .filter((lang) => lang.toString().substring(0,2) === 'en')
    .map((lang) => ({
      lang,
      subs: list[lang].find((x) => x.ext === 'vtt'),
      priority: EN_LIST.indexOf(lang)
    }))
    .filter((x) => x.subs)
    .sort((x, y) => x.priority > y.priority)[0];
}

function processFormats(formats) {
  // Formats are first filtered by video codec. So vp9 and av01 are filtered out as they aren't supported.
  // Formats filtered based on resolution and fps. Formats that are 1080p or higher and at the most 30fps or less than 1080p with any fps are retained.
  const filteredFormats = formats.filter(({ format_id, fps, height, vcodec }) => filterFormatCodecs(format_id, vcodec) && filterFormatFps(fps, height))
  .sort((prevFormat, nextFormat) => nextFormat.tbr - prevFormat.tbr);

  const selected4K = filteredFormats.find((format) => (format.height === 2160 && format.acodec !== 'none')) || filteredFormats.find((format) => format.height === 2160);
  const selected1080p = filteredFormats.find((format) => (format.height === 1080 && format.acodec !== 'none')) || filteredFormats.find((format) => format.height === 1080);
  const selectedLowQuality = filteredFormats.find((format) => (format.height === 720 && format.acodec !== 'none')) || filteredFormats.find((format) => format.height === 720) || filteredFormats.find((format) => (format.height <= 720 && format.acodec !== 'none')) || filteredFormats.find((format) => (format.height <= 720));

  const selectedFormats = [selected4K, selected1080p, selectedLowQuality].filter(Boolean).reduce((acc, format) => {
    const type = format.fragments ? 'manifest' : 'url';
    const assignedData = { type, ...format, url: format.url };

    if (format.height === 2160) {
      acc[`${format.acodec !== 'none' ? 'combined_4k' : '4k_video'}`] = assignedData;
    }

    if (format.height === 1080) {
      acc[`${format.acodec !== 'none' ? 'combined_hd' : 'hd_video'}`] = assignedData;
    }

    if (format.height <= 720) {
      acc[`${format.acodec !== 'none' ? 'combined_720p' : '720p_video'}`] = assignedData;
    }

    return acc;
  }, {});

  return selectedFormats;
}

function filterFormatCodecs(format_id, vcodec) {
  return format_id !== 'source' && !format_id.startsWith('http') && vcodec && vcodec !== 'none' && !vcodec.includes('av01') && !vcodec.includes('vp9') && !vcodec.includes('vp09');
}

function filterFormatFps(fps, height) {
  return ((height >= 1080 && fps <= 30) || height < 1080);
}
