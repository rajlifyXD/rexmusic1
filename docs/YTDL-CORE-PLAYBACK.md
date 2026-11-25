# REX ytdl-core playback

## Active architecture

The player sends the selected video's ID and quality profile to the existing REX same-origin stream route:

`HTMLAudioElement → GET /api/stream/{video_id}?quality=... → FastAPI → 127.0.0.1:4181 → @distube/ytdl-core v5`

The FastAPI app starts the Node sidecar at application startup and stops it at shutdown. The sidecar binds to loopback only. The frontend assigns this stream URL directly to the browser audio element.

## Dependencies

- `@distube/ytdl-core` 5.2.1
- Supported Node.js versions: 22.22.2+, 24.15.0+, or 26+
- FastAPI / HTTPX backend proxy

## Install

Termux and Windows setup install the sidecar dependencies. FastAPI starts the local Node sidecar automatically when REX launches.

## Quality profiles

- `data-saver`: chooses a lower-bitrate audio-only format where available.
- `balanced`: targets a moderate audio bitrate.
- `high`: selects the highest available audio-only format.

These are selection preferences. They do not guarantee fixed bitrates or lossless audio. Byte-range seeking is supported when the selected source exposes a known content length.

## Limitations

This is an unofficial extractor for online media. YouTube may require verification, rate-limit requests, return HTTP 403/429, or provide no usable direct audio-only format. The implementation does not mint tokens, impersonate accounts, use browser cookies, or bypass those restrictions. Successful installation does not guarantee that every video will stream.
