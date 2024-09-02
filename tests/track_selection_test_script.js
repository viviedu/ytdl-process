const { processV4, processV3, spawnPythonService } = require('./../index');
const { promisify } = require('util');
const request = require('request');

if (process.argv.length < 3) {
    console.error("\n\nERROR: Must provide one url.")
    console.error("e.g.      yarn test-track-selection https://www.youtubodybe.com/watch?v=_lsC0aXyY6g\n\n")
    process.exit(-1)
}

const doGetRequest = async (uri) => {
    const response = await promisify(request)({
      timeout: 15000,
      uri
    });
    const { body, statusCode } = response || {};
  
    if (statusCode >= 400) {
      log.warn('request failed', { statusCode });
      throw body;
    }
    return body;
  };

async function main() {
    const url = process.argv[2]

    spawnPythonService()
    const body = await doGetRequest(`http://127.0.0.1:4444/process?url=${url}`);
    const result_3 = processV3(body, '');
    const result_4 = processV4(body, '');

    // 'body' contains a list of ALL available tracks for this video
    // result_3 and result_4 are the tracks that processV3 and processV4 have selected

    // Dump the list of all tracks, then dump the list of tracks we selected. 

    const data = JSON.parse(body.toString().trim());
    console.log("\n\n=============================================================================================================");
    console.log(`using with yt-dlp v${data._version.version}...\n`);
    console.log(`Url: ${url}`);
    console.log(`Title: ${data.title}`);
    console.log(`Duration: ${data.duration}s`);
    console.log(`Language: ${data.language}`);

    console.log(`\n\nID            EXT     RESOLUTION   FPS   | PROTO                | VCODEC                           ACODEC       `)
    console.log(`----------------------------------------------------------------------------------------------------------------`)
    data.formats.forEach((track) => {
        format_id = track.format_id.padEnd(13, ' ')
        ext = track.ext.padEnd(7, ' ')
        resolution = track.resolution.padEnd(12, ' ')
        fps = (['none', 'undefined'].includes(track.vcodec) ? '' : `${track.fps}`).padEnd(5, ' ')
        protocol = track.protocol.padEnd(20, ' ')
        vcodec = (['none', 'undefined'].includes(track.vcodec) ? '' : `${track.vcodec}`).padEnd(32, ' ')
        acodec = (['none', 'undefined'].includes(track.acodec) ? '' : `${track.acodec}`).padEnd(12, ' ')
        console.log(`${format_id} ${ext} ${resolution} ${fps} | ${protocol} | ${vcodec} ${acodec}`)
    })

    console.log('\nV3 Audio Tracks:')
    if (result_3.audio) {
        console.log(`\tid=${result_3.audio.format_id}   language=${result_3.audio.language} type=${result_3.audio.type} protocol=${result_3.audio.protocol}`)
    }

    console.log('\nV3 Video Tracks:')
    result_3.video.forEach((track) => {
        id = `${track.format_id}`.padEnd(12, ' ')
        height = `${track.height}`.padEnd(8, ' ')
        combined = `${track.combined}`.padEnd(7, ' ')
        type = `${track.type}`.padEnd(10, ' ')
        protocol = `${track.protocol}`.padEnd(20, ' ')
        console.log(`\tid=${id} height=${height} combined=${combined} type=${type} protocol=${protocol}`)
    })

    console.log('\nV4 Audio Tracks:')
    result_4.audio.forEach((track) => {
        id = `${track.format_id}`.padEnd(12, ' ')
        language = `${track.language}`.padEnd(6, ' ')
        type = `${track.type}`.padEnd(10, ' ')
        protocol = `${track.protocol}`.padEnd(20, ' ')
        console.log(`\tid=${id} language=${language} type=${type} protocol=${protocol}`)
    })

    console.log('\nV4 Video Tracks:')
    result_4.video.forEach((track) => {
        id = `${track.format_id}`.padEnd(12, ' ')
        height = `${track.height}`.padEnd(8, ' ')
        combined = `${track.combined}`.padEnd(7, ' ')
        type = `${track.type}`.padEnd(10, ' ')
        protocol = `${track.protocol}`.padEnd(20, ' ')
        console.log(`\tid=${id} height=${height} combined=${combined} type=${type} protocol=${protocol}`)
    })

    console.log("\n\n=============================================================================================================");
}

main();
