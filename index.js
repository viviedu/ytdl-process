// constants
const EN_LIST = ['en-US', 'en-GB', 'en', 'en-AU'];

// public

module.exports.ARGUMENTS = ['--restrict-filenames', '--write-sub', '--write-auto-sub', '--max-downloads', '1', '-f', '[height <=? 720][format_id != source]', '-j'];
module.exports.process = (output, origin) => {
  const data = JSON.parse(output.toString().trim());
  const subtitleFile = findBestSubtitleFile(data.subtitles) || findBestSubtitleFile(data.automatic_captions);

  let subtitleUrl;
  if (subtitleFile) {
    subtitleUrl = `${origin}/ytdl/vtt?suburi=${encodeURIComponent(subtitleFile.subs.url)}`;
  }

  const { url } = data;
  if (!url) {
    throw 'no url';
  }

  return {
    title: data.title || 'Unknown',
    url,
    duration: data.duration,
    subtitle_url: subtitleUrl || '',
    cookies: data.http_headers.Cookie || ''
  };
};

// private

function findBestSubtitleFile(list = {}) {
  return Object.keys(list)
    .filter((lang) => lang.toString().substring(0,2) === 'en')
    .map((lang) => ({
      lang,
      subs: list[lang].find((x) => x.ext === 'vtt'),
      priority: EN_LIST.indexOf(lang)
    }))
    .filter((x) => x.subs)
    .sort((x, y) => x.priority > y.priority)[0];
}
