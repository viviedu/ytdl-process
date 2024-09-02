const { processV4, processV3, spawnPythonService } = require('./../index');
const { promisify } = require('util');
const request = require('request');

if (process.argv.length < 3) {
  console.error('\n\nERROR: Must provide one url.');
  console.error('e.g.      yarn test-track-selection https://www.youtubodybe.com/watch?v=_lsC0aXyY6g\n\n');
  process.exit(-1);
}

const doGetRequest = async (uri) => {
  const response = await promisify(request)({
    timeout: 15000,
    uri
  });
  const { body, statusCode } = response || {};

  if (statusCode >= 400) {
    console.error('request failed', { statusCode });
    throw body;
  }
  return body;
};

async function main() {
  const url = process.argv[2];

  spawnPythonService();

  // If this line fails on windows, you need to spawn the python process yourself
  // run `PATH_TO_PYTHON_EXECUTABLE -u service.py` in another window and leave it running
  const body = await doGetRequest(`http://127.0.0.1:4444/process?url=${url}&version=4`);

  const result_3 = processV3(body, '');
  const result_4 = processV4(body, '');

  // 'body' contains a list of ALL available tracks for this video
  // result_3 and result_4 are the tracks that processV3 and processV4 have selected

  // Dump the list of all tracks, then dump the list of tracks we selected. 

  const data = JSON.parse(body.toString().trim());
  console.log('\n\n=============================================================================================================');
  console.log(`using with yt-dlp v${data._version.version}...\n`);
  console.log(`Url: ${url}`);
  console.log(`Title: ${data.title}`);
  console.log(`Duration: ${data.duration}s`);
  console.log(`Language: ${data.language}`);

  console.log('\n\nID            EXT     RESOLUTION   FPS   | PROTO                | VCODEC                           ACODEC       ');
  console.log('----------------------------------------------------------------------------------------------------------------');
  data.formats.forEach((track) => {
    const format_id = track.format_id.padEnd(13, ' ');
    const ext = track.ext.padEnd(7, ' ');
    const resolution = track.resolution.padEnd(12, ' ');
    const fps = (['none', 'undefined'].includes(track.vcodec) ? '' : `${track.fps}`).padEnd(5, ' ');
    const protocol = track.protocol.padEnd(20, ' ');
    const vcodec = (['none', 'undefined'].includes(track.vcodec) ? '' : `${track.vcodec}`).padEnd(32, ' ');
    const acodec = (['none', 'undefined'].includes(track.acodec) ? '' : `${track.acodec}`).padEnd(12, ' ');
    console.log(`${format_id} ${ext} ${resolution} ${fps} | ${protocol} | ${vcodec} ${acodec}`);
  });

  console.log('\nV3 Audio Tracks:');
  if (result_3.audio) {
    console.log(`\tid=${result_3.audio.format_id}   language=${result_3.audio.language} type=${result_3.audio.type} protocol=${result_3.audio.protocol}`);
  }

  console.log('\nV3 Video Tracks:');
  result_3.video.forEach((track) => {
    const id = `${track.format_id}`.padEnd(12, ' ');
    const height = `${track.height}`.padEnd(8, ' ');
    const combined = `${track.combined}`.padEnd(7, ' ');
    const type = `${track.type}`.padEnd(10, ' ');
    const protocol = `${track.protocol}`.padEnd(20, ' ');
    console.log(`\tid=${id} height=${height} combined=${combined} type=${type} protocol=${protocol}`);
  });

  console.log('\nV4 Audio Tracks:');
  result_4.audio.forEach((track) => {
    const id = `${track.format_id}`.padEnd(12, ' ');
    const language = `${track.language}`.padEnd(6, ' ');
    const acodec = `${track.acodec}`.padEnd(10, ' ');
    const type = `${track.type}`.padEnd(10, ' ');
    const protocol = `${track.protocol}`.padEnd(20, ' ');
    console.log(`\tid=${id} language=${language} acodec=${acodec} type=${type} protocol=${protocol}`);
  });

  console.log('\nV4 Video Tracks:');
  result_4.video.forEach((track) => {
    const id = `${track.format_id}`.padEnd(12, ' ');
    const height = `${track.height}`.padEnd(8, ' ');
    const combined = `${track.combined}`.padEnd(7, ' ');
    const type = `${track.type}`.padEnd(10, ' ');
    const protocol = `${track.protocol}`.padEnd(20, ' ');
    console.log(`\tid=${id} height=${height} combined=${combined} type=${type} protocol=${protocol}`);
  });

  console.log('\n\n=============================================================================================================');
}

main();
