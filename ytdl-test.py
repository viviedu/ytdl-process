import json
import yt_dlp

URL = 'https://www.youtube.com/playlist?list=PLQHHr8gPOsH7QTEzRAeBF1ivDAroEG4Iw'

# ℹ️ See help(yt_dlp.YoutubeDL) for a list of available options and public functions
ydl_opts = {}
ydl_opts = {
    'forcejson': True,
    'quiet': True,
    'simulate': True,
    'extract_flat': True
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info(URL, download=False)

    # ℹ️ ydl.sanitize_info makes the info json-serializable
    with open("test_file.txt", 'w') as f:
        f.write(json.dumps(ydl.sanitize_info(info)))