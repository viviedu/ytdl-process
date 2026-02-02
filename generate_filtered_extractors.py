#!/usr/bin/env python3

import argparse
from yt_dlp.extractor import gen_extractor_classes

# list of strings to reject any extractors which have these values as a substring
# derived from yt-dlp extractors list
FORBIDDEN_EXTRACTOR_STRINGS = (
  'sex',
  'porn',
  'xx',
  'redtube',
  'cam',
  '4tube',
  'load',
  'gasm',
  'bang',
  'iwara',
  'jizz',
  'mother',
  'kink',
  'fap',
  'strip',
  'toypics',
  'thisvid',
  'chaturbate',
  'rule34',
  'tube8',
  'erocast',
  'eroprofile',
  'manyvids',
  'tube8',
  'fc2',
  'scrolller',
  'beeg',
  'peekvids',
  'playvids',
  'drtuber',
  'oftv',
  'nuvid',
  'noodlemagazine',
  'xvideos',
  'xhamster',
  'tnaflix',
  'empflix',
  'redgifs',
  'xstream',
  'pr0gramm',
  'myvidster',
  'murrtube',
  'goshgay'
)

def generate_filtered_extractors():
    extractors = [extractor.IE_NAME.lower() for extractor in gen_extractor_classes()]

    # start list with the default extractors and then add the ones we want to remove by prefixing extractor name with '-'
    return ['default'] + [
        f'-{extractor}' for extractor in extractors
        if any(forbidden_extractor_str in extractor.lower() for forbidden_extractor_str in FORBIDDEN_EXTRACTOR_STRINGS)
    ]

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-file", required=True, type=str)

    extractor_list = generate_filtered_extractors()
    
    output_file = parser.parse_args().output_file
    if output_file:
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(str(extractor_list))
