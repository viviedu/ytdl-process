import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as net from 'net';
import { join } from 'path';
import { arrayP, numberP, objectP, optionalP, recordP, stringP, validate } from '@viviedu/type-proxy';

// constants
const EN_LIST = ['en-us', 'en-gb', 'en', 'en-au'];
const LOCALES: string[][] = [['en-GB'], ['en-US'], ['fr-FR'], ['pt-PT'], ['de-DE']];

// types

interface Fragment {
  path: string;
  duration?: number;
}

interface Format {
  acodec?: string;
  vcodec?: string;
  format_id: string;
  height?: number;
  fps?: number;
  protocol: string;
  audio_ext?: string;
  abr?: number;
  tbr?: number;
  url?: string;
  ext?: string;
  fragments?: Fragment[];
  fragment_base_url?: string;
  language?: string;
}

interface SubtitleFile {
  ext: string;
  protocol: string;
  url: string;
}

type SubtitleMap = Record<string, SubtitleFile[]>;

interface YtdlData {
  automatic_captions?: SubtitleMap;
  subtitles?: SubtitleMap;
  url?: string;
  http_headers?: { Cookie?: string };
  duration?: number;
  title?: string;
  thumbnail?: string;
  formats?: Format[];
  fragments?: Fragment[];
  fragment_base_url?: string;
  ext?: string;
  format_id?: string;
}

interface ManifestInput {
  duration?: number;
  ext?: string;
  format_id?: string;
  fragments?: Fragment[];
  fragment_base_url?: string;
}

interface SubtitleMatch {
  lang: string;
  subs: SubtitleFile;
  priority: number;
}

type VideoTrack =
  | { type: 'manifest'; manifest: string; height?: number; combined: boolean; format_id: string; protocol: string }
  | { type: 'url'; url?: string; height?: number; combined: boolean; format_id: string; protocol: string };

type AudioTrack =
  | { type: 'manifest'; acodec?: string; manifest: string; format_id: string; protocol: string; language: string }
  | { type: 'url'; acodec?: string; url?: string; format_id: string; protocol: string; language: string };

interface PlaylistEntry {
  id: string;
}

interface PlaylistData {
  entries?: PlaylistEntry[];
}

// Type-proxy validators for data crossing the socket boundary.
const fragmentP = objectP<Fragment>({
  path: stringP,
  duration: optionalP(numberP)
});

const formatP = objectP<Format>({
  acodec: optionalP(stringP),
  vcodec: optionalP(stringP),
  format_id: stringP,
  height: optionalP(numberP),
  fps: optionalP(numberP),
  protocol: stringP,
  audio_ext: optionalP(stringP),
  abr: optionalP(numberP),
  tbr: optionalP(numberP),
  url: optionalP(stringP),
  ext: optionalP(stringP),
  fragments: optionalP(arrayP(fragmentP)),
  fragment_base_url: optionalP(stringP),
  language: optionalP(stringP)
});

const subtitleFileP = objectP<SubtitleFile>({
  ext: stringP,
  protocol: stringP,
  url: stringP
});

const subtitleMapP = recordP(arrayP(subtitleFileP));

const ytdlDataP = objectP<YtdlData>({
  automatic_captions: optionalP(subtitleMapP),
  subtitles: optionalP(subtitleMapP),
  url: stringP,
  http_headers: optionalP(objectP<{ Cookie?: string }>({
    Cookie: optionalP(stringP)
  })),
  duration: optionalP(numberP),
  title: optionalP(stringP),
  thumbnail: optionalP(stringP),
  formats: optionalP(arrayP(formatP)),
  fragments: optionalP(arrayP(fragmentP)),
  fragment_base_url: optionalP(stringP),
  ext: optionalP(stringP),
  format_id: optionalP(stringP)
});

const playlistEntryP = objectP<PlaylistEntry>({ id: stringP });

const playlistDataP = objectP<PlaylistData>({
  entries: arrayP(playlistEntryP)
});

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

export const ARGUMENTS: string[] = [
  '--restrict-filenames',
  '--write-sub',
  '--write-auto-sub',
  '--no-playlist',
  '-f', `(${formatPreferences})${commonProperties}`,
  '-J'
];

export const ARGUMENTS_MULTI_FORMAT: string[] = [
  '--restrict-filenames',
  '--write-sub',
  '--write-auto-sub',
  '--no-playlist',
  '--extractor-args', 'youtube:player-client=ios,web_creator,web_safari',
  '-J'
];

export const PLAYLIST_ARGUMENTS: string[] = ['--flat-playlist', '-J'];

const timescale = 48000;

const generateDurationString = (totalSeconds: number): string => {
  const secondsString = `${totalSeconds % 60}S`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const minutesString = minutes > 0 ? `${minutes}M` : '';

  const hours = Math.floor(totalMinutes / 60);
  const hoursString = hours > 0 ? `${hours}H` : '';

  return `PT${hoursString}${minutesString}${secondsString}`;
};

const generateManifest = (data: ManifestInput, isAudio = false): string => {
  const { duration, ext, format_id, fragments, fragment_base_url } = data;
  const durationString = generateDurationString(duration || 0);
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
              ${(fragments || []).map((fragment) => {
      const path = fragment.path.replace('&', '&amp;');
      return `<SegmentURL media="${path}" />`;
    }).join('')}
              <SegmentTimeline>
                ${(fragments || []).map((fragment) => {
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

export const isPlaylist = (url: string): boolean => {
  return url.startsWith('https://www.youtube.com/playlist?list=');
};

const DEFAULT_SOCKET_PATH = '/tmp/ytdl';

type Transport = 'http' | 'stdio';

export interface PythonServiceCallbacks {
  onStderr?: (line: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onSpawn?: (pid: number | undefined) => void;
}

export interface PythonServiceOpts {
  socketPath?: string;
  restartDelayMs?: number;
  requestTimeoutMs?: number;
}

interface ProcessParams {
  url: string;
  version: number | string;
  proxyUrl?: string;
}

interface ProcessAllVersionsParams {
  url: string;
  version: number | string;
  origin: string;
  proxyUrl?: string;
  locales?: string[];
}

interface PlaylistOrDownloadParams {
  url: string;
  proxyUrl?: string;
}

// PythonService manages a long-lived ytdl-process child running in `stdio`
// transport, which creates a Unix domain socket at `socketPath`. Each request
// opens a new connection, sends an HTTP-style GET request, and reads the
// response until the connection closes.
//
// Usage:
//   const service = new PythonService({}, { onStderr: (line) => log(line) }).start();
//   const info = await service.process({ url, version: 4, proxyUrl });
//
// The child is respawned automatically if it exits.
export class PythonService {
  readonly socketPath: string;
  readonly env: NodeJS.ProcessEnv;
  readonly restartDelayMs: number;
  // 0 disables the per-request timeout. Downloads can take several minutes,
  // so callers that mix downloads and processing should leave this off (or
  // set a generous value) to avoid killing legitimate long downloads.
  readonly requestTimeoutMs: number;
  readonly onStderr?: (line: string) => void;
  readonly onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  readonly onSpawn?: (pid: number | undefined) => void;

  private _child: ChildProcessWithoutNullStreams | null = null;
  private _stopped = false;

  constructor(env: NodeJS.ProcessEnv = {}, callbacks: PythonServiceCallbacks = {}, opts: PythonServiceOpts = {}) {
    this.socketPath = opts.socketPath ?? DEFAULT_SOCKET_PATH;
    this.env = { ...env, YTDL_SOCKET: this.socketPath };
    this.onStderr = callbacks.onStderr;
    this.onExit = callbacks.onExit;
    this.onSpawn = callbacks.onSpawn;
    this.restartDelayMs = opts.restartDelayMs ?? 1000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 0;
  }

  start(): this {
    this._stopped = false;
    this._spawn();
    return this;
  }

  stop(): void {
    this._stopped = true;
    if (this._child) {
      this._child.kill();
    }
  }

  get pid(): number | undefined {
    return this._child ? this._child.pid : undefined;
  }

  static spawnPythonService(additionalEnv: NodeJS.ProcessEnv = {}, transport: Transport = 'http'): ChildProcessWithoutNullStreams {
    return spawn('python3', ['-u', join(__dirname, 'service.py')], {
      env: { ...global.process.env, YTDL_TRANSPORT: transport, ...additionalEnv }
    });
  }

  process({ url, version, proxyUrl = '' }: ProcessParams): Promise<unknown> {
    return this._request('/process', { url, version, proxy_url: proxyUrl });
  }

  async processAllVersions({ url, version, origin, proxyUrl = '', locales: _locales = [] }: ProcessAllVersionsParams) {
    const data = validate(await this._request('/process', { url, version, proxy_url: proxyUrl }), ytdlDataP);
    const { automatic_captions, formats, subtitles, url: dataUrl } = data;

    const cookies = (data.http_headers && data.http_headers.Cookie) || '';
    const duration = data.duration || 0;
    const title = data.title || '';
    const thumbnail = data.thumbnail || '';

    // V1/V2 use a single best-subtitle pick
    const subtitleFile = findBestSubtitleFile(subtitles) || findBestSubtitleFile(automatic_captions);
    const subtitle_url = subtitleFile ? `${origin}/ytdl/vtt?suburi=${encodeURIComponent(subtitleFile.subs.url)}` : '';

    // V3/V4 surface subtitles per locale
    const subtitlesForAllLocales = getSubtitlesForAllLocales(origin, subtitles, automatic_captions);

    // V1: the "old" shape. Will sometimes yield DASH manifests (problematic on iMX <2.8.5; use v2 there).
    const v1 = { cookies, duration, subtitle_url, thumbnail, title, url: dataUrl };

    // V2: fake-manifest variant. Safe for iMX 2.8.5+; returns a manifest if fragments are present, else a plain URL.
    const v2 = data.fragments
      ? { cookies, duration, manifest: generateManifest(data), subtitle_url, title, type: 'manifest' as const }
      : { cookies, duration, subtitle_url, title, type: 'url' as const, url: dataUrl };

    // V3/V4 share video track selection
    const processedVideoTracks = processVideoFormats(formats || [], !data.duration);
    const video_tracks: VideoTrack[] = processedVideoTracks.map((formatInfo) => {
      if (formatInfo.fragments) {
        const manifest = generateManifest({ ...formatInfo, duration });
        return { type: 'manifest', manifest, height: formatInfo.height, combined: formatInfo.acodec !== 'none', format_id: formatInfo.format_id, protocol: formatInfo.protocol };
      } else {
        return { type: 'url', url: formatInfo.url, height: formatInfo.height, combined: formatInfo.acodec !== 'none', format_id: formatInfo.format_id, protocol: formatInfo.protocol };
      }
    });

    // V3: one audio track (we pick), plus a list of video tracks.
    // Previously yt-dlp auto-picked the best opus track. We do our own selection now so we can
    // fall back when no opus tracks exist and handle multi-language tracks deliberately.
    const v3AudioPick = processAudioFormats(formats || []);
    let v3_audio: AudioTrack | null = null;
    let v3_silent_video = false;
    if (v3AudioPick != null) {
      const { fragments: audio_fragments, url: audio_url, format_id: audio_format, abr: audio_bitrate, protocol: audio_protocol, language } = v3AudioPick;
      const audio_language = language || 'unknown';
      if (audio_fragments || audio_url) {
        if (isSilentVideo(audio_bitrate)) {
          v3_silent_video = true;
        } else if (audio_fragments) {
          const audioManifest = generateManifest({ ...v3AudioPick, duration }, true);
          v3_audio = { type: 'manifest', manifest: audioManifest, format_id: audio_format, protocol: audio_protocol, language: audio_language };
        } else {
          v3_audio = { type: 'url', url: audio_url, format_id: audio_format, protocol: audio_protocol, language: audio_language };
        }
      }
    }
    const v3 = {
      audio: v3_audio,
      cookies,
      duration,
      silent_video: v3_silent_video,
      subtitles: subtitlesForAllLocales,
      thumbnail,
      title,
      video: video_tracks
    };

    // V4: return all eligible audio tracks; vivi-box picks based on device class.
    // Three common kinds:
    //  1) proto=https acodec=opus  — works everywhere (preferred)
    //  2) proto=https acodec=mp4a  — Vivi Display only, not physical devices
    //  3) proto=m3u8 acodec=unknown — physical devices only, not Vivi Display
    const v4AudioPicks = processAudioFormats(formats || [], true);
    const v4_audio: AudioTrack[] = v4AudioPicks.map((audioTrack): AudioTrack | undefined => {
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
    }).filter((t): t is AudioTrack => Boolean(t));
    const v4 = {
      audio: v4_audio,
      cookies,
      duration,
      silent_video: v4_audio.length === 0,
      subtitles: subtitlesForAllLocales,
      thumbnail,
      title,
      video: video_tracks
    };

    return { versions: { v1, v2, v3, v4 } };
  }

  async processPlaylist({ url, proxyUrl = '' }: PlaylistOrDownloadParams): Promise<string[]> {
    const data = validate(await this._request('/process_playlist', { url, proxy_url: proxyUrl }), playlistDataP);
    if (data.entries) {
      return data.entries.map((video) => `https://www.youtube.com/watch?v=${video.id}`);
    }
    return [];
  }

  download({ url, proxyUrl = '' }: PlaylistOrDownloadParams): Promise<unknown> {
    return this._request('/download', { url, proxy_url: proxyUrl });
  }

  private _spawn(): void {
    const child = PythonService.spawnPythonService(this.env, 'stdio');
    this._child = child;

    child.stderr.on('data', (data: Buffer) => {
      if (!this.onStderr) {
        return;
      }
      for (const line of data.toString().split('\n')) {
        if (line.trim()) {
          this.onStderr(line);
        }
      }
    });

    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this._child = null;
      if (this.onExit) {
        this.onExit(code, signal);
      }
      if (!this._stopped) {
        setTimeout(() => this._spawn(), this.restartDelayMs);
      }
    });

    if (this.onSpawn) {
      this.onSpawn(child.pid);
    }
  }

  private _request(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this._child) {
        reject(new Error('python service is not running'));
        return;
      }

      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== '' && value !== null && value !== undefined) {
          query.set(key, String(value));
        }
      }
      const queryStr = query.toString();
      const fullPath = queryStr ? `${path}?${queryStr}` : path;

      let timer: NodeJS.Timeout | null = null;
      const sock = net.createConnection(this.socketPath);

      if (this.requestTimeoutMs > 0) {
        timer = setTimeout(() => {
          sock.destroy();
          reject(new Error(`ytdl-process request timed out after ${this.requestTimeoutMs}ms`));
        }, this.requestTimeoutMs);
      }

      let responseData = '';

      sock.on('connect', () => {
        sock.write(`GET ${fullPath} HTTP/1.1\r\n\r\n`);
      });

      sock.on('data', (chunk: Buffer) => {
        responseData += chunk.toString();
      });

      sock.on('end', () => {
        if (timer) clearTimeout(timer);
        try {
          const parsed = JSON.parse(responseData);
          if (parsed && typeof parsed === 'object' && 'error' in parsed) {
            reject(new Error(parsed.error));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`failed to parse response: ${responseData.slice(0, 200)}`));
        }
      });

      sock.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }
}

// private

function findBestSubtitleFile(list?: SubtitleMap, locales: string[] = []): SubtitleMatch | undefined {
  // favor locales but some subtitles just have the language code, zip it to keep the ordering
  const localesAndLanguages = locales.map((locale) => [locale.toLowerCase(), locale.substring(0, 2)]).flat();
  const languages = [...localesAndLanguages, ...EN_LIST];
  // unfound languages will have a priority of -1, so reversing the list here
  const uniqueLanguages = languages.filter((x, index) => languages.indexOf(x) === index).reverse();
  return Object.keys(list || {})
    .map((lang): { lang: string; subs: SubtitleFile | undefined; priority: number } => ({
      lang,
      subs: (list as SubtitleMap)[lang].find((x) => (x.ext === 'vtt' && x.protocol !== 'http_dash_segments' && x.protocol !== 'm3u8_native')),
      priority: uniqueLanguages.indexOf(lang.toLowerCase())
    }))
    .filter((x): x is SubtitleMatch => Boolean(x.subs))
    .sort((x, y) => y.priority - x.priority)[0];
}

function isSilentVideo(audio_bitrate?: number): boolean {
  return Boolean(audio_bitrate && audio_bitrate <= 10);
}

function processVideoFormats(formats: Format[], isStream: boolean): Format[] {
  // Filter out tracks that are not suitable (see comments below)
  const filteredFormats = formats.filter((format) => filterVideoFormatCodecs(format) && filterVideoFormatFps(format));

  // Sort the tracks because .find will return the first match
  filteredFormats.sort(videoTrackSort);

  // If you change track selection, then all permutations of the following should ideally be tested:
  //    - signage, play content
  //    - youtube livestream, youtube regular video
  //    - real device (IMX or GF, either is fine), vivi anywhere
  //
  // So the above results in 8x permutations
  // Also, check that:
  //  - subtitles still work
  //  - play/pausing and seeking in play content still works
  const tracks: (Format | undefined)[] = [];

  if (isStream) {
    // Livestreams will always have a combined m3u8 track, return this.
    // (For a livestream, ALL its tracks are m3u8. This means if we decide to return split tracks for
    // a livestream, it will be a m3u8 audio track and a m3u8 video track.)
    tracks.push(filteredFormats.find((format) => ((format.height ?? 0) <= 2160 && (format.height ?? 0) > 1080 && format.acodec !== 'none')));
    tracks.push(filteredFormats.find((format) => ((format.height ?? 0) <= 1080 && (format.height ?? 0) > 720 && format.acodec !== 'none')));
    tracks.push(filteredFormats.find((format) => ((format.height ?? 0) <= 720 && format.acodec !== 'none')));
  } else {
    // Non-livestreams

    // Find the best combined and split track for each quality level
    tracks.push(filteredFormats.find((format) => ((format.height ?? 0) <= 2160 && (format.height ?? 0) > 1080 && format.acodec !== 'none')));
    tracks.push(filteredFormats.find((format) => ((format.height ?? 0) <= 2160 && (format.height ?? 0) > 1080 && format.acodec === 'none')));

    tracks.push(filteredFormats.find((format) => ((format.height ?? 0) <= 1080 && (format.height ?? 0) > 720 && format.acodec !== 'none')));
    tracks.push(filteredFormats.find((format) => ((format.height ?? 0) <= 1080 && (format.height ?? 0) > 720 && format.acodec === 'none')));

    tracks.push(filteredFormats.find((format) => ((format.height ?? 0) <= 720 && format.acodec !== 'none')));
    tracks.push(filteredFormats.find((format) => ((format.height ?? 0) <= 720 && format.acodec === 'none')));
  }

  return tracks.filter((t): t is Format => Boolean(t));
}

// Return > 0 if b is preferred
// Return < 0 if a is preferred
// Never return 0, we want track selection to be deterministic!
function videoTrackSort(a: Format, b: Format): number {
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
    return (b.height ?? 0) - (a.height ?? 0);
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
    return (a.tbr ?? 0) - (b.tbr ?? 0);
  }

  // Sort on format_id, which is guaranteed to be unique per track
  return a.format_id < b.format_id ? -1 : 1;
}

function filterVideoFormatCodecs(format: Format): boolean {
  const { acodec, format_id, protocol, vcodec } = format;
  return format_id !== 'source' && !format_id.startsWith('http')
    // ignore tracks with no video
    && Boolean(vcodec) && vcodec !== 'none'
    // boxes can't play vp9 or av01
    && !vcodec!.includes('av01') && !vcodec!.includes('vp9') && !vcodec!.includes('vp09')
    // In our gstreamer pipeline, seeking breaks for video only tracks that have protocol=https
    // I couldn't figure out why. Therefore we take tracks with protocol=m3u8 or protocol=dash
    && (acodec !== 'none' || (acodec === 'none' && !protocol.includes('https')));
}

function filterVideoFormatFps(format: Format): boolean {
  const { fps, height } = format;
  return (((height ?? 0) >= 1080 && (fps ?? 0) <= 30) || (height ?? 0) < 1080);
}

function processAudioFormats(formats: Format[], returnMultiple: true): Format[];
function processAudioFormats(formats: Format[], returnMultiple?: false): Format | null;
function processAudioFormats(formats: Format[], returnMultiple = false): Format[] | Format | null {
  // Filter out tracks that are not suitable (see comments below)
  const filteredFormats = formats.filter((format) => filterAudioFormatCodecs(format, returnMultiple));
  // Sort the tracks because .find will return the first match
  filteredFormats.sort(audioTrackSort);

  if (returnMultiple) {
    return filteredFormats;
  }

  return filteredFormats.length ? filteredFormats[0] : null;
}

function filterAudioFormatCodecs(format: Format, returnMultiple: boolean): boolean {
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
function audioTrackSort(a: Format, b: Format): number {
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

function getSubtitlesForAllLocales(origin: string, subtitles?: SubtitleMap, automatic_captions?: SubtitleMap, useEmptyLocale = false): Record<string, string> {
  const subtitlesForAllLocales: Record<string, string> = {};
  for (const locale of LOCALES) {
    const subtitleLocale = useEmptyLocale ? [] : locale;
    const subtitleFile = findBestSubtitleFile(subtitles, subtitleLocale) || findBestSubtitleFile(automatic_captions, subtitleLocale);
    const subtitleUrl = subtitleFile ? `${origin}/ytdl/vtt?suburi=${encodeURIComponent(subtitleFile.subs.url)}` : '';
    subtitlesForAllLocales[locale[0]] = subtitleUrl;
  }
  return subtitlesForAllLocales;
}

export const _private_testing = {
  generateDurationString,
  audioTrackSort,
  videoTrackSort,
  filterVideoFormatCodecs,
  filterAudioFormatCodecs,
  processVideoFormats,
  processAudioFormats
};
