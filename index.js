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
  '--extractor-args', `youtube:player-client=ios,web_creator,mediaconnect`,
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

  const cookies = data.http_headers && data.http_headers.Cookie || '';
  const duration = data.duration || 0;
  const subtitleFile = findBestSubtitleFile(subtitles, locales) || findBestSubtitleFile(automatic_captions, locales);
  const subtitleUrl = subtitleFile ? `${origin}/ytdl/vtt?suburi=${encodeURIComponent(subtitleFile.subs.url)}` : '';
  const title = data.title || '';
  const processedVideoTracks = processVideoFormats(formats, !data.duration);
  const thumbnail = data.thumbnail || '';

  // Previously, we let yt-dlp auto pick a single audio track for us. It picks the best opus track. Not sure how it picks when there are no opus tracks.
  // Now, we do our own selection. This lets us:
  //  - pick a sensible fallback option when there are no opus tracks
  //  - make a sensible selection when there are audio tracks of multiple languages available
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

  if (audioTrack != null) {
    const { fragments: audio_fragments, url: audio_url, format_id: audio_format, abr: audio_bitrate, protocol: audio_protocol, language } = audioTrack;
    const audio_language = language || 'unknown';
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
        audio_track = { type: 'manifest', manifest: audioManifest, format_id: audio_format, protocol: audio_protocol, language: audio_language };
      } else {
        audio_track = { type: 'url', url: audio_url, format_id: audio_format, protocol: audio_protocol, language: audio_language };
      }
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

module.exports.processV4 = (output, origin, locales = []) => {
  const data = JSON.parse(output.toString().trim());
  const { automatic_captions, formats, subtitles } = data;

  const cookies = data.http_headers && data.http_headers.Cookie || '';
  const duration = data.duration || 0;
  const subtitleFile = findBestSubtitleFile(subtitles, locales) || findBestSubtitleFile(automatic_captions, locales);
  const subtitleUrl = subtitleFile ? `${origin}/ytdl/vtt?suburi=${encodeURIComponent(subtitleFile.subs.url)}` : '';
  const title = data.title || '';
  const processedVideoTracks = processVideoFormats(formats, !data.duration);
  const thumbnail = data.thumbnail || '';

  // Previously, we let yt-dlp auto pick a single audio track for us. It picks the best opus track. Not sure how it picks when there are no opus tracks.
  // Now, we do our own selection. This lets us:
  //  - pick a sensible fallback option when there are no opus tracks
  //  - make a sensible selection when there are audio tracks of multiple languages available
  const audioTracks = processAudioFormats(formats);

  const video_tracks = processedVideoTracks.map((formatInfo) => {
    if (formatInfo.fragments) {
      const manifest = generateManifest({ ...formatInfo, duration });
      return { type: 'manifest', manifest, height: formatInfo.height, combined: formatInfo.acodec !== 'none', format_id: formatInfo.format_id, protocol: formatInfo.protocol };
    } else {
      return { type: 'url', url: formatInfo.url, height: formatInfo.height, combined: formatInfo.acodec !== 'none', format_id: formatInfo.format_id, protocol: formatInfo.protocol };
    }
  });

  let silent_video = false;
  const formatttedTracks = audioTracks.map((audioTrack) => {
    const { fragments: audio_fragments, url: audio_url, format_id: audio_format, abr: audio_bitrate, protocol: audio_protocol, language } = audioTrack;
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
      return { type: 'manifest', manifest: audioManifest, format_id: audio_format, protocol: audio_protocol, language: audio_language };
    } else {
      return { type: 'url', url: audio_url, format_id: audio_format, protocol: audio_protocol, language: audio_language };
    }
  });
  console.warn('audio tracks', formatttedTracks);

  return {
    cookies,
    duration,
    subtitle_url: subtitleUrl,
    title,
    thumbnail,
    audio: formatttedTracks,
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

function processVideoFormats(formats, isStream) {
  // Filter out tracks that are not suitable (see comments below)
  const filteredFormats = formats.filter((format) => filterVideoFormatCodecs(format) && filterVideoFormatFps(format));

  // Sort the tracks because .find will return the first match
  filteredFormats.sort(videoTrackSort)

  // If you change track selection, then all permutations of the following should ideally be tested:
  //    - signage, play content
  //    - youtube livestream, youtube regular video
  //    - real device (IMX or GF, either is fine), vivi anywhere
  //
  // So the above results in 8x permutations
  // Also, check that:
  //  - subtitles still work
  //  - play/pausing and seeking in play content still works

  const tracks = []

  if (isStream) {
    // Livestreams will always have a combined m3u8 track, return this.
    // (For a livestream, ALL its tracks are m3u8. This means if we decide to return split tracks for
    // a livestream, it will be a m3u8 audio track and a m3u8 video track.)
    for (const quality of [2160, 1080, 720]) {
      tracks.push(filteredFormats.find((format) => (format.height === quality && format.acodec !== 'none')));
    }
  } else {
    // Non-livestreams
        
    // Find the best split track for each quality level
    for (const quality of [2160, 1080, 720]) {
      tracks.push(filteredFormats.find((format) => (format.height === quality && format.acodec === 'none')));
    }

    // VA can only play non-m3u8 combined tracks. Find the best track that VA can play
    const vaTrack = filteredFormats.find((format) => (format.height <= 1080 && format.acodec !== 'none' && format.protocol === 'https'));
    
    if (vaTrack) {
      tracks.push(vaTrack);
    } else {
      // Too bad, there are no combined non-m3u8 tracks :(
      // We will return the best combined m3u8 track for each quality level.
      for (const quality of [2160, 1080, 720]) {
        tracks.push(filteredFormats.find((format) => (format.height === quality && format.acodec !== 'none')));
      }
    }
  }

  return tracks.filter(Boolean);
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

function filterVideoFormatCodecs(format) {
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

function filterVideoFormatFps(format) {
  const { fps, height } = format;
  return ((height >= 1080 && fps <= 30) || height < 1080);
}

function processAudioFormats(formats, returnMultiple = false) {
  // Filter out tracks that are not suitable (see comments below)
  const filteredFormats = formats.filter((format) => filterAudioFormatCodecs(format));
  // Sort the tracks because .find will return the first match
  filteredFormats.sort(audioTrackSort)

  if (returnMultiple) {
    return filteredFormats;
  }

  return filteredFormats.length ? filteredFormats[0] : null;
}

function filterAudioFormatCodecs(format) {
  const { acodec, audio_ext, abr, protocol, language } = format;

  // Audio tracks that are m3u8 have audio_ext set, but acodec and abr are undefined. For some reason yt-dlp can't determine acodec and abr in these situations
  if (acodec && acodec === 'none') {
    // not an audio track
    return false;
  }

  if (!acodec && !audio_ext && !abr) {
    // not an audio track
    return false;
  }

  // Tracks with protocol=https and acodec=mp4a are no good, because our gstreamer split playing pipeline
  // can't seek on these tracks. I don't know why, seek succeeds but nothing happens.
  if (protocol.includes('https') && acodec && acodec.includes('mp4a')) {
    return false;
  }

  return true;
}

// Return > 0 if b is preferred
// Return < 0 if a is preferred
// Never return 1, we want track selection to be deterministic!
function audioTrackSort(a, b) {
  // We can't filter out non-english tracks, because a teacher may be playing a non-english video (e.g. second language class).
  // Right now, we de-prioritize non-english tracks. In future, we may want to decide based on the video's original language and/or
  // the user's locale setting.
  //
  // This is good enough for now, because I think very few videos will have multiple language options. The ones I have found have
  // all been videos where the user has uploaded a dubbed audio track.
  a_non_english = a.language && !a.language.startsWith('en');
  b_non_english = b.language && !b.language.startsWith('en');
  if (a_non_english && !b_non_english) {
    return 1;
  }
  
  if (!a_non_english && b_non_english) {
    return -1;
  }

  // Prefer opus tracks
  a_acodec = a.acodec ? a.acodec : 'unknown';
  b_bcodec = b.acodec ? b.acodec : 'unknown';
  if (a_acodec.includes('opus') && !b_bcodec.includes('opus')) {
    return -1;
  }
  
  if (!a_acodec.includes('opus') && b_bcodec.includes('opus')) {
    return 1;
  }

  // prefer higher bit rate
  a_abr = a.abr ? a.abr : 0;
  b_abr = b.abr ? b.abr : 0;
  if (a_abr != b_abr) {
    return b_abr - a_abr;
  }
  
  // Sort on format_id, which is guaranteed to be unique per track
  return a.format_id < b.format_id ? -1 : 1;
}

module.exports._private_testing = {
  generateDurationString,
  audioTrackSort,
  videoTrackSort,
  filterVideoFormatCodecs,
  filterAudioFormatCodecs
}
