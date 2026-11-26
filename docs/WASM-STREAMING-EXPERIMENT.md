# REX client-side yt-dlp-wasm experiment

This experiment is isolated to the `experiment/client-side-wasm` branch. It does not change the production branch or switch the production player.

## How playback is wired

When `VITE_REX_STREAM_ENGINE=wasm` is set, REX uses this path:

`REX HTMLAudioElement → direct signed audio-only Google Video URL`

1. REX imports the pinned `@project516/yt-dlp-wasm` 0.6.0 npm dependency. Vite bundles its module worker as a same-origin asset (the worker must not be loaded directly from a cross-origin CDN).
2. The worker loads the pinned yt-dlp 2026.10.26 Python wheel from jsDelivr (CORS-enabled), then extracts only YouTube metadata and progressive audio format URLs. It does not download the song into a Blob or hold the audio file in browser memory.
3. The REX player assigns the selected signed audio URL to its existing `HTMLAudioElement`.
4. REX retains its current queue, play/pause, previous/next, shuffle, repeat, seek, quality selection, Media Session and lyrics clock.

The extractor tries the current `mweb` client first and then the `web` client. For each client it requests separate GVS and player Proof-of-Origin tokens. The backend's `/api/potoken` function is adapted from Yozora's PO-token-provider approach. It returns only short-lived PO-token material; it never returns or forwards REX account cookies.

## Required configuration

The browser must send yt-dlp's extraction requests through a CORS proxy. Do not point the app at an unknown public proxy.

Set these variables on the **frontend Vercel project**, in Preview only while testing:

| Variable | Value |
| --- | --- |
| `VITE_REX_STREAM_ENGINE` | `wasm` |
| `VITE_YTDLP_WASM_CORS_PROXY` | Your own yt-dlp-wasm CORS proxy URL |
| `VITE_YTDLP_WASM_CORS_PROXY_KEY` | The proxy's access key (optional if your proxy does not require one) |

The proxy access key is necessarily visible in browser-delivered frontend code. Use a dedicated, rotatable key and a narrowly restricted allowed-origin list; never reuse a Vercel, Supabase, GitHub, or YouTube credential. REX does not read browser cookies or pass `YT_COOKIE` to the WASM engine.

Set these variables on the **backend Vercel project**, Preview only:

| Variable | Value |
| --- | --- |
| `REX_CORS_ORIGINS` | The exact frontend preview origin, e.g. `https://your-preview.vercel.app` |
| `PO_TOKEN_PROVIDER_URL` | Optional; defaults to Yozora's `https://poptox.onrender.com` provider |
| `PO_TOKEN_API_KEY` | Optional provider API key, stored server-side only |

The backend preview also needs the existing Supabase and database variables required by the main API. Do not move any backend secret to the frontend. Do not modify Production environment variables to test this branch.

### CORS proxy hosting

Use the proxy implementation documented by [Project516/yt-dlp-wasm](https://github.com/Project516/yt-dlp-wasm/tree/master/packages/cors-proxy). Its hosted Cloudflare Worker mode is useful for general testing, but the project warns that YouTube often rejects Cloudflare Worker datacenter IPs. For YouTube, the maintainers recommend running the proxy on an always-on home Linux machine and publishing it through a Cloudflare Tunnel. A Vercel Serverless Function is also a datacenter egress point and is not a reliable substitute for a residential proxy.

The proxy can see every request it relays. Do not submit cookies, passwords, or other personal credentials through it. This REX integration intentionally does not use cookies.

## Dependency and licensing note

`@project516/yt-dlp-wasm` is distributed under `AGPL-3.0-or-later AND Unlicense`; its ffmpeg WASM core is `AGPL-3.0-or-later`. Review those terms against REX's distribution model before shipping the dependency to the public production app.

## Browser requirements

The current WASM package requires WebAssembly JSPI. The upstream project documents support in Chrome 137+, Firefox 153+, Safari 27+, or Node.js 25+. A browser without JSPI receives a clear REX playback error.

## Important limits

- This path preserves REX's native playback UI and progressive media element; it does **not** buffer the complete track into a Blob.
- The signed media URL is short-lived and is re-resolved when necessary. YouTube can still reject extraction, expire a URL, restrict a video, or change its player protocol.
- The resolver accepts only direct HTTPS, audio-only, non-DRM formats hosted on Google Video. It will fail clearly rather than pretend a video, DRM, HLS, or fragmented DASH response is a progressive audio stream.
- There is no legitimate way to promise that unofficial YouTube extraction will never be rate-limited or changed upstream. This is an experimental alternative, not a guarantee of unlimited access.
- The existing ytdl-core stream path remains the default until this branch has been verified with a correctly hosted residential proxy and representative tracks.

## Test checklist

1. Confirm both frontend and backend Preview deployments build from this branch.
2. Configure the proxy and the Preview-only variables above.
3. Verify `/api/potoken?video_id=<11-char-video-id>&client=mweb&context=gvs` returns `po_token` without exposing provider keys.
4. Test a short public track, a longer track, a seek near the end, next/previous, repeat, shuffle, and all three quality profiles.
5. Inspect browser network requests: the extraction requests must use the configured proxy; the audio element must request the selected Google Video URL directly and receive byte ranges.
6. Only after those checks pass should the WASM engine be considered for broader rollout. Production remains on the existing engine unless explicitly changed later.
