const { spawn } = require('child_process');
const { join } = require('path');

// constants
const EN_LIST = ['en-US', 'en-GB', 'en', 'en-AU'];

// public

module.exports.ARGUMENTS = ['--restrict-filenames', '--write-sub', '--write-auto-sub', '--no-playlist', '-f', '[height <=? 720][format_id != source]', '-j'];

module.exports.PLAYLIST_ARGUMENTS = ['--flat-playlist', '-j'];

module.exports.isPlaylist = (url) => {
  return url.startsWith('https://www.youtube.com/playlist?list=');
};

module.exports.process = (output, origin) => {
  const data = JSON.parse(output.toString().trim());
  const { url } = data;
  if (!url) {
    throw 'no url';
  }

  const subtitleFile = findBestSubtitleFile(data.subtitles) || findBestSubtitleFile(data.automatic_captions);
  const subtitleUrl = subtitleFile ? `${origin}/ytdl/vtt?suburi=${encodeURIComponent(subtitleFile.subs.url)}` : '';

  return {
    title: data.title || '',
    url,
    duration: data.duration || 0,
    subtitle_url: subtitleUrl,
    cookies: data.http_headers.Cookie || ''
  };
};

module.exports.processPlaylist = (output) => {
  return output.toString().trim().split('\n').map((string) => {
    const video = JSON.parse(string);
    return `https://www.youtube.com/watch?v=${video.id}`;
  });
};

module.exports.spawnPythonService = () => {
  return spawn(join(__dirname, 'service.py'));
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
