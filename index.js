// constants
const EN_LIST = ['en-US', 'en-GB', 'en', 'en-AU'];
module.exports.ARGUMENTS = ['--restrict-filenames', '--write-sub', '--write-auto-sub', '--max-downloads', '1', '-f', '[height <=? 720][format_id != source]', '-j'];

class YtdlProcess {
  constructor(origin) {
    this.origin = origin;
  }

  process(output) {
    let data;
    try {
      data = JSON.parse(output.toString().trim());
    } catch (err) {
      return null;
    }

    const subtitleFile = findBestSubtitleFile(data.subtitles) || findBestSubtitleFile(data.automatic_captions);

    let subtitleUrl;
    if (subtitleFile) {
      subtitleUrl = `${this.origin}/ytdl/vtt?suburi=${encodeURIComponent(subtitleFile.subs.url)}`;
    }

    return {
      title: data.title,
      url: data.url,
      duration: data.duration,
      subtitle_url: subtitleUrl,
      cookies: data.http_headers.Cookie
    };
  }
}

module.exports = YtdlProcess;

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
