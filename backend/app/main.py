import asyncio
import json
import os
import socket
import sys
import time
import threading
import subprocess
import re
from urllib.parse import urlparse
from pathlib import Path
from datetime import datetime, timezone

import httpx
import uvicorn
from fastapi import Body, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import db, lyrics as ly, supabase_store as sb
from .ytm import art, artist_id, item, items, names, track, ytm

# Optional local-only settings. The .env file is deliberately gitignored and
# never included with the source ZIP.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = PROJECT_ROOT / ".env"

def _load_local_env() -> None:
    if not ENV_FILE.is_file():
        return
    try:
        for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and key.replace("_", "").isalnum():
                os.environ.setdefault(key, value)
    except OSError:
        # Configuration is optional. Environment variables still work.
        pass

_load_local_env()

PORT = int(os.environ.get("LIQUID_PORT", "4173"))
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
IMG_HOSTS = ("lh3.googleusercontent.com", "i.ytimg.com", "yt3.ggpht.com", "yt3.googleusercontent.com",
             "lh4.googleusercontent.com", "lh5.googleusercontent.com", "lh6.googleusercontent.com", "music.youtube.com")
APPLE_ARTWORK_HOST_SUFFIX = ".mzstatic.com"

app = FastAPI(title="REX Music")

# Local/LAN mode is same-origin. For a Vercel frontend, set
# REX_CORS_ORIGINS to its exact HTTPS origin(s), comma-separated.
_cors_origins = [
    value.strip().rstrip("/")
    for value in os.environ.get("REX_CORS_ORIGINS", "").split(",")
    if value.strip()
]
_cors_origin_regex = os.environ.get("REX_CORS_ORIGIN_REGEX", "").strip() or None
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_origin_regex,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Range", "If-Range"],
    expose_headers=["Accept-Ranges", "Content-Length", "Content-Range", "ETag", "Last-Modified"],
)

# ---------------- required @distube/ytdl-core v5 sidecar ----------------
_YTDL_PORT = int(os.environ.get("REX_YTDL_PORT", "4181"))
_YTDL_BASE = f"http://127.0.0.1:{_YTDL_PORT}"
_YTDL_DIR = Path(__file__).resolve().parents[1] / "ytdl-service"
_ytdl_process: subprocess.Popen | None = None


@app.on_event("startup")
async def _start_ytdl_sidecar():
    """Start the local Node sidecar; Vercel uses a separate Node Function."""
    global _ytdl_process

    if os.environ.get("VERCEL") == "1":
        print("[REX YTDL] Vercel deployment: audio is served by the Node Function at /api/ytdl.", flush=True)
        return

    server_file = _YTDL_DIR / "server.mjs"
    package_file = _YTDL_DIR / "node_modules" / "youtubei.js"
    if not server_file.is_file() or not package_file.exists():
        print(
            "[REX YTDL] The active engine is not installed; run the REX setup script. "
            "Run: cd backend/ytdl-service && npm install",
            flush=True,
        )
        return

    node = os.environ.get("REX_NODE_BINARY", "node")
    try:
        version_check = subprocess.run(
            [node, "-p", "process.versions.node"],
            capture_output=True, text=True, timeout=5, check=True,
        )
        version = tuple(int(part) for part in version_check.stdout.strip().split(".")[:3])
        supported = (
            (version[0] == 22 and version >= (22, 22, 2))
            or (version[0] == 24 and version >= (24, 15, 0))
            or version[0] >= 26
        )
        if not supported:
            print(
                f"[REX YTDL] Node {version_check.stdout.strip()} is not supported. "
                "Use Node 22.22.2+, 24.15.0+, or 26+.",
                flush=True,
            )
            return
        env = os.environ.copy()
        env["REX_YTDL_PORT"] = str(_YTDL_PORT)
        _ytdl_process = subprocess.Popen(
            [node, "server.mjs"],
            cwd=str(_YTDL_DIR),
            env=env,
            stdin=subprocess.DEVNULL,
        )
        async with httpx.AsyncClient(timeout=1.0) as client:
            for _ in range(20):
                if _ytdl_process.poll() is not None:
                    break
                try:
                    response = await client.get(f"{_YTDL_BASE}/health")
                    if response.status_code == 200:
                        print("[REX YTDL] youtubei.js sidecar ready.", flush=True)
                        return
                except httpx.HTTPError:
                    pass
                await asyncio.sleep(0.25)
        print("[REX YTDL] Sidecar did not become healthy; audio playback will be unavailable until it is fixed.", flush=True)
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        print(f"[REX YTDL] Could not start required sidecar: {type(exc).__name__}: {exc}", flush=True)


@app.on_event("shutdown")
async def _stop_ytdl_sidecar():
    global _ytdl_process
    if _ytdl_process and _ytdl_process.poll() is None:
        _ytdl_process.terminate()
        try:
            _ytdl_process.wait(timeout=4)
        except subprocess.TimeoutExpired:
            _ytdl_process.kill()
    _ytdl_process = None


async def _ytdl_sidecar_request(path: str, *, headers: dict | None = None):
    """Open a local sidecar request and map connection failures to a clean 503."""
    client = httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=2.0, read=35.0))
    try:
        request = client.build_request("GET", f"{_YTDL_BASE}{path}", headers=headers or {})
        response = await client.send(request, stream=True)
        return client, response
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(
            503,
            "The ytdl-core service is unavailable. Check Node.js and backend/ytdl-service installation.",
        ) from exc


async def _proxy_ytdl_stream(video_id: str, request: Request, quality: str):
    """Stream from the isolated Node service through the existing REX stream URL."""
    forwarded = {}
    for name in ("range", "if-range"):
        value = request.headers.get(name)
        if value:
            forwarded[name] = value
    client, upstream = await _ytdl_sidecar_request(
        f"/stream/{video_id}?quality={quality}", headers=forwarded
    )
    if upstream.status_code >= 400:
        body = await upstream.aread()
        await upstream.aclose()
        await client.aclose()
        try:
            detail = body.decode("utf-8", errors="replace")
            parsed = json.loads(detail)
            detail = parsed.get("error", detail) if isinstance(parsed, dict) else detail
        except Exception:
            detail = body.decode("utf-8", errors="replace")[:1000]
        raise HTTPException(upstream.status_code, detail or "ytdl-core stream failed")

    passthrough = {
        "content-type", "content-length", "content-range", "accept-ranges",
        "cache-control", "x-rex-playback-engine", "x-rex-ytdl-format",
    }
    response_headers = {
        key: value for key, value in upstream.headers.items()
        if key.lower() in passthrough
    }
    response_headers["Cache-Control"] = "no-store"

    async def relay():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        relay(),
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=upstream.headers.get("content-type"),
    )


db.init()

@app.get("/api/health")
def health():
    """Local service health; reports storage and the isolated stream sidecar separately."""
    try:
        with db.conn() as c:
            c.execute("SELECT 1").fetchone()
        database_ok = True
    except Exception:
        database_ok = False
    serverless_streaming = os.environ.get("VERCEL") == "1"
    sidecar_ok = serverless_streaming or bool(_ytdl_process is not None and _ytdl_process.poll() is None)
    return {
        "ok": database_ok,
        "service": "REX API",
        "database": "ready" if database_ok else "unavailable",
        "streaming": "ready" if sidecar_ok else "unavailable",
        "engine": "youtubei.js (Vercel Node Function)" if serverless_streaming else "youtubei.js",
    }


_img_cache: dict[str, tuple[bytes, str]] = {}
_playability_cache: dict[str, tuple[float, bool, str]] = {}
# Apple animated artwork lookup is optional. Positive and negative results are
# cached so a track change never repeatedly scrapes the same album.
_animated_artwork_cache: dict[str, tuple[float, dict]] = {}
_animated_artwork_lock = threading.Lock()
_ANIMATED_ARTWORK_API = os.environ.get("REX_ANIMATED_ARTWORK_API", "https://artwork.m8tec.top").rstrip("/")
# Some YouTube Music rows omit the parsed `artists` array. Cache a lightweight
# fallback from the player response so popular Topic-channel tracks still show
# their artist without repeating a player request on every page render.
_artist_fallback_cache: dict[str, tuple[float, str, str | None]] = {}
_artist_fallback_lock = threading.Lock()


def _clean_youtube_author(value: object) -> str:
    if not isinstance(value, str):
        return ""
    author = " ".join(value.split()).strip()
    for suffix in (" - Topic", " — Topic"):
        if author.casefold().endswith(suffix.casefold()):
            author = author[:-len(suffix)].strip()
    return author


def _hydrate_track_artist(track_data: dict) -> dict:
    """Fill only missing artist labels using YouTube's own videoDetails author.

    Normal YTMusic artist metadata always wins. This fallback covers inconsistent
    search/watch rows, including official Topic-channel uploads from artists such
    as The Weeknd and SZA. Failure is intentionally non-fatal to playback.
    """
    if not isinstance(track_data, dict):
        return track_data
    current_artist = track_data.get("artist")
    if isinstance(current_artist, str) and current_artist.strip():
        return track_data
    video_id = track_data.get("videoId")
    if not video_id:
        return track_data

    now = time.time()
    with _artist_fallback_lock:
        cached = _artist_fallback_cache.get(video_id)
        if cached and cached[0] > now:
            _, artist_name, artist_channel = cached
            if artist_name:
                track_data["artist"] = artist_name
                if artist_channel and not track_data.get("artistId"):
                    track_data["artistId"] = artist_channel
            return track_data

    try:
        response = ytm.get_song(video_id)
        details = response.get("videoDetails") or response.get("video_details") or {}
        microformat = response.get("microformat") or {}
        microformat = microformat.get("playerMicroformatRenderer") or microformat.get("player_microformat_renderer") or {}
        author = _clean_youtube_author(details.get("author") or microformat.get("ownerChannelName"))
        channel_id = details.get("channelId") or microformat.get("externalChannelId")
        ttl = 24 * 60 * 60 if author else 5 * 60
    except Exception:
        author, channel_id, ttl = "", None, 5 * 60

    with _artist_fallback_lock:
        if len(_artist_fallback_cache) > 1000:
            expired = [key for key, value in _artist_fallback_cache.items() if value[0] <= now]
            for key in expired[:500]:
                _artist_fallback_cache.pop(key, None)
            if len(_artist_fallback_cache) > 1000:
                _artist_fallback_cache.pop(next(iter(_artist_fallback_cache)))
        _artist_fallback_cache[video_id] = (now + ttl, author, channel_id if isinstance(channel_id, str) else None)

    if author:
        track_data["artist"] = author
        if isinstance(channel_id, str) and channel_id and not track_data.get("artistId"):
            track_data["artistId"] = channel_id
    return track_data


def _hydrate_track_list(entries: list[dict]) -> list[dict]:
    return [_hydrate_track_artist(entry) if entry.get("type") == "song" else entry for entry in entries]


def _hydrate_stored_tracks(connection, entries: list[dict]) -> list[dict]:
    """Hydrate legacy rows in memory only. Library GET requests must stay read-only."""
    return _hydrate_track_list(entries)


def yt_call(fn, *a, **k):
    """Run a ytmusicapi call; map upstream failures to a clean 502 (unofficial endpoints change)."""
    try:
        return fn(*a, **k)
    except Exception as e:
        raise HTTPException(502, f"YouTube Music request failed: {type(e).__name__}: {e}")


# ---------------- health + images ----------------
# ---------------- artwork image proxy ----------------
@app.get("/api/img")
async def img(u: str):
    """Fetch and cache approved artwork hosts without turning upstream slowness into a 500."""
    from urllib.parse import urlparse

    parsed = urlparse(u)
    host = (parsed.hostname or "").lower()
    allowed = host in IMG_HOSTS or host.endswith(APPLE_ARTWORK_HOST_SUFFIX)
    if parsed.scheme not in ("http", "https") or not allowed:
        raise HTTPException(400, "Artwork host not allowed")

    cached = _img_cache.get(u)
    if cached is None:
        timeout = httpx.Timeout(connect=3.0, read=8.0, write=3.0, pool=3.0)
        last_error = None
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                    response = await client.get(u, headers={"Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"})
                if response.status_code != 200:
                    raise HTTPException(502, f"Artwork provider returned HTTP {response.status_code}")
                content_type = response.headers.get("content-type", "image/jpeg").split(";", 1)[0].strip()
                if not content_type.startswith("image/"):
                    raise HTTPException(502, "Artwork provider returned a non-image response")
                if len(response.content) > 15 * 1024 * 1024:
                    raise HTTPException(413, "Artwork image is too large")
                cached = (response.content, content_type)
                if len(_img_cache) >= 400:
                    _img_cache.pop(next(iter(_img_cache)))
                _img_cache[u] = cached
                break
            except HTTPException:
                raise
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                last_error = exc
                if attempt == 0:
                    await asyncio.sleep(0.25)
            except httpx.HTTPError as exc:
                last_error = exc
                break

        if cached is None:
            # A controlled 504 lets the frontend's image onError fallback run;
            # it avoids an unhandled ASGI traceback for a slow upstream image host.
            detail = "Artwork provider timed out" if isinstance(last_error, httpx.TimeoutException) else "Artwork provider is temporarily unavailable"
            raise HTTPException(504, detail) from last_error

    data, content_type = cached
    return Response(
        data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=604800, stale-while-revalidate=86400"},
    )


# ---------------- optional Apple Music motion artwork ----------------
def _normalise_match_text(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", (value or "").casefold()))


def _artwork_artist_candidates(artist: str) -> list[str]:
    """Try the complete track credit first, then its primary credited artist.

    Apple Music animated art is album-level, while YouTube Music track credits
    often include several featured artists. The album is commonly indexed under
    its lead artist only (for example, Metro Boomin rather than the full
    Annihilate collaboration credit).
    """
    candidates = []
    primary = re.split(r"\s*(?:,|&|\bfeat\.?\b|\bfeaturing\b|\bwith\b)\s*", artist, maxsplit=1, flags=re.I)[0]
    # The album's lead artist is the best first guess for Apple Music's album index.
    for candidate in (primary, artist):
        candidate = " ".join(candidate.split()).strip(" ,&-")
        if candidate and candidate.casefold() not in {x.casefold() for x in candidates}:
            candidates.append(candidate)
    return candidates[:2]


def _artwork_album_candidates(album: str) -> list[str]:
    candidates = [" ".join(album.split()).strip()]
    # Soundtrack releases are commonly labelled with a parenthetical subtitle
    # in YouTube Music but indexed under the shorter Apple Music album name.
    shortened = re.sub(r"\s*\([^)]*(?:soundtrack|motion picture|original motion picture|deluxe|expanded|remaster)[^)]*\)\s*$", "", album, flags=re.I)
    shortened = re.sub(r"\s*\[[^]]*(?:soundtrack|motion picture|original motion picture|deluxe|expanded|remaster)[^]]*\]\s*$", "", shortened, flags=re.I).strip(" -–—:")
    if shortened and shortened.casefold() not in {x.casefold() for x in candidates}:
        candidates.append(shortened)
    return [x for x in candidates if x][:2]


def _apple_song_release_candidates(artist: str, album: str, title: str) -> list[dict]:
    """Resolve exact Apple song/release links plus a high-resolution static cover."""
    if not title.strip():
        return []
    primary_artist = _artwork_artist_candidates(artist)[0] if artist else ""
    term = " ".join(x for x in (title, primary_artist or artist, album) if x).strip()
    try:
        response = httpx.get(
            "https://itunes.apple.com/search",
            params={"term": term, "entity": "song", "limit": 20},
            headers={"Accept": "application/json", "User-Agent": "REX-Music/1.0"},
            timeout=8.0,
            follow_redirects=True,
        )
        response.raise_for_status()
        results = response.json().get("results", [])
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        return []

    target_title = _normalise_match_text(title)
    target_album = _normalise_match_text(album)
    target_artist = _normalise_match_text(primary_artist or artist)
    ranked = []
    for row in results if isinstance(results, list) else []:
        if not isinstance(row, dict):
            continue
        row_title = _normalise_match_text(str(row.get("trackName") or ""))
        if not row_title or row_title != target_title:
            continue
        row_artist = _normalise_match_text(str(row.get("artistName") or ""))
        row_album = _normalise_match_text(str(row.get("collectionName") or ""))
        score = 100
        if target_artist and target_artist in row_artist:
            score += 30
        elif target_artist:
            continue
        if target_album and (target_album in row_album or row_album in target_album):
            score += 25
        urls = [u for u in (row.get("collectionViewUrl"), row.get("trackViewUrl"))
                if isinstance(u, str) and u.startswith("https://music.apple.com/")]
        if not urls:
            continue
        artwork = row.get("artworkUrl100") or row.get("artworkUrl60") or ""
        static_url = artwork
        if isinstance(static_url, str) and static_url:
            static_url = re.sub(r"/\d+x\d+bb\.(?:jpg|jpeg|png)(?:\?.*)?$", "/3000x3000bb.jpg", static_url, flags=re.I)
        ranked.append((score, {"urls": urls, "staticUrl": static_url or None,
                               "artist": row.get("artistName"), "album": row.get("collectionName")}))
    ranked.sort(key=lambda item: item[0], reverse=True)
    output, seen = [], set()
    for _, candidate in ranked[:4]:
        for url in candidate["urls"]:
            if url not in seen:
                seen.add(url)
                output.append({**candidate, "url": url})
    return output[:3]


def _request_m8tec_details(artist: str, album: str) -> dict | None:
    response = httpx.get(
        f"{_ANIMATED_ARTWORK_API}/api/v1/artwork/search",
        params={"artist": artist, "album": album},
        headers={"Accept": "application/json", "User-Agent": "REX-Music/1.0"},
        timeout=10.0,
        follow_redirects=True,
    )
    if response.status_code in (204, 404):
        return None
    response.raise_for_status()
    payload = response.json()
    urls = _motion_urls(payload)
    return {**urls, "payload": payload if isinstance(payload, dict) else {}}


def _request_m8tec_url(apple_music_url: str) -> dict | None:
    response = httpx.get(
        f"{_ANIMATED_ARTWORK_API}/api/v1/artwork/url",
        params={"url": apple_music_url},
        headers={"Accept": "application/json", "User-Agent": "REX-Music/1.0"},
        timeout=10.0,
        follow_redirects=True,
    )
    if response.status_code in (204, 404):
        return None
    response.raise_for_status()
    payload = response.json()
    urls = _motion_urls(payload)
    return {**urls, "payload": payload if isinstance(payload, dict) else {}}

def _motion_urls(payload):
    """Read only the documented portrait HLS field from m8tec's API.

    The API response is flat: {"url": <square>, "url_tall": <portrait>}.
    Never infer a tall variant from the generic `url` field: that may be square.
    """
    if not isinstance(payload, dict):
        return {"tallUrl": None}

    tall_url = None
    # The documented response currently uses url_tall. Accept common casing
    # variants for forward compatibility, but never fall back to square `url`.
    for key in ("url_tall", "urlTall", "tallUrl", "tall_url", "portraitUrl", "portrait_url"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            candidate = value.strip()
            parsed = urlparse(candidate)
            if parsed.scheme == "https" and parsed.hostname and parsed.path.lower().endswith((".m3u8", ".mp4", ".m4v", ".webm")):
                tall_url = candidate
                break

    # Some deployments wrap the same response in `data` or `result`.
    if not tall_url:
        for key in ("data", "result", "artwork"):
            nested = payload.get(key)
            if isinstance(nested, dict):
                nested_result = _motion_urls(nested)
                if nested_result.get("tallUrl"):
                    tall_url = nested_result["tallUrl"]
                    break

    return {"tallUrl": tall_url}


@app.get("/api/artwork/animated")
def animated_artwork(artist: str = Query(min_length=1, max_length=160), album: str = Query(min_length=1, max_length=220), title: str | None = Query(default=None, max_length=180)):
    """Find tall Apple Motion art by release metadata, then exact Apple Music URL."""
    artist = " ".join(artist.split()).strip()
    album = " ".join(album.split()).strip()
    title = " ".join((title or "").split()).strip()
    if not artist or not album:
        return {"available": False, "tallUrl": None, "staticUrl": None, "status": "not-found"}

    key = f"{artist.casefold()}\x1f{album.casefold()}\x1f{title.casefold()}"
    now = time.time()
    with _animated_artwork_lock:
        cached = _animated_artwork_cache.get(key)
        if cached and cached[0] > now:
            return cached[1]

    result = None
    static_url = None
    try:
        # First use the documented artist/album endpoint. Try complete credits,
        # then the lead artist and shorter soundtrack alias.
        for artist_candidate in _artwork_artist_candidates(artist):
            for album_candidate in _artwork_album_candidates(album):
                found = _request_m8tec_details(artist_candidate, album_candidate)
                if found and found.get("tallUrl"):
                    payload = found.get("payload") or {}
                    result = {
                        "available": True, "tallUrl": found["tallUrl"], "staticUrl": None,
                        "status": "found", "matchedArtist": payload.get("artist") or artist_candidate,
                        "matchedAlbum": payload.get("album") or album_candidate,
                        "lookupMethod": "artist-album",
                    }
                    break
            if result:
                break

        # Exact Apple song lookup avoids failures caused by collaboration credits
        # and soundtrack subtitles. It also provides a 3000px still-cover URL.
        apple_candidates = _apple_song_release_candidates(artist, album, title) if title else []
        for candidate in apple_candidates:
            if candidate.get("staticUrl") and not static_url:
                static_url = candidate["staticUrl"]
            if result:
                continue
            found = _request_m8tec_url(candidate["url"])
            if found and found.get("tallUrl"):
                payload = found.get("payload") or {}
                result = {
                    "available": True, "tallUrl": found["tallUrl"],
                    "staticUrl": candidate.get("staticUrl"), "status": "found",
                    "matchedArtist": payload.get("artist") or candidate.get("artist") or artist,
                    "matchedAlbum": payload.get("album") or candidate.get("album") or album,
                    "lookupMethod": "apple-music-url",
                }
                break

        if not result:
            result = {"available": False, "tallUrl": None, "staticUrl": static_url,
                      "status": "not-found"}
        elif static_url and not result.get("staticUrl"):
            result["staticUrl"] = static_url
        ttl = 7 * 24 * 60 * 60 if result["available"] else 6 * 60 * 60
    except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
        result = {"available": False, "tallUrl": None, "staticUrl": static_url,
                  "temporarilyUnavailable": True, "status": "upstream-error", "error": type(exc).__name__}
        ttl = 5 * 60

    with _animated_artwork_lock:
        if len(_animated_artwork_cache) > 1000:
            expired = [cache_key for cache_key, (expires, _) in _animated_artwork_cache.items() if expires <= now]
            for cache_key in expired[:500]:
                _animated_artwork_cache.pop(cache_key, None)
            if len(_animated_artwork_cache) > 1000:
                _animated_artwork_cache.pop(next(iter(_animated_artwork_cache)))
        _animated_artwork_cache[key] = (now + ttl, result)
    return result


# ---------------- catalogue ----------------
@app.get("/api/search")
def search(request: Request, q: str, filter: str | None = None, limit: int = 20):
    # Authenticate before doing external catalogue work or writing search history.
    user = sb.current_user(request)
    if filter in ("all", "", None):
        filter = None
    res = yt_call(ytm.search, q, filter=filter, limit=limit)
    # Search history is private account data. RLS scopes each row to this user.
    clean_query = q.strip()[:200]
    if clean_query:
        sb.rest("search_history", user, method="POST", payload={
            "user_id": user["id"], "query": clean_query,
        }, prefer="return=minimal")
    out = []
    for r in res:
        n = item(r)
        if n:
            out.append(n)
    return {"results": _hydrate_track_list(out)}


@app.get("/api/suggest")
def suggest(q: str):
    return {"suggestions": yt_call(ytm.get_search_suggestions, q)[:8]}


@app.get("/api/search/history")
def search_history(request: Request):
    user = sb.current_user(request)
    rows = sb.rest("search_history", user, params={
        "select": "query,searched_at", "user_id": f"eq.{user['id']}",
        "order": "searched_at.desc", "limit": "12",
    })
    seen, history = set(), []
    for row in rows or []:
        query = row.get("query")
        if query and query.casefold() not in seen:
            seen.add(query.casefold())
            history.append(query)
    return {"history": history}


@app.delete("/api/search/history")
def clear_search_history(request: Request):
    user = sb.current_user(request)
    sb.rest("search_history", user, method="DELETE", params={"user_id": f"eq.{user['id']}"})
    return {"ok": True}


@app.get("/api/home")
def home():
    shelves = []
    try:
        for s in yt_call(ytm.get_home, limit=6):
            cs = _hydrate_track_list(items(s.get("contents")))
            if cs:
                shelves.append({"title": s.get("title", ""), "items": cs})
    except HTTPException:
        pass
    charts = None
    try:
        ch = ytm.get_charts("US")
        chart_source = ch.get("songs") or ch.get("videos")
        vids = _hydrate_track_list(items((chart_source or {}).get("items") if isinstance(chart_source, dict) else chart_source))
        arts = items((ch.get("artists") or {}).get("items") if isinstance(ch.get("artists"), dict) else ch.get("artists"))
        charts = {"songs": vids[:15], "artists": arts[:15]}
    except Exception:
        pass
    moods = []
    try:
        for sect, lst in ytm.get_mood_categories().items():
            moods += [{"title": m["title"], "params": m["params"], "section": sect} for m in lst]
    except Exception:
        pass
    if not shelves and not charts:
        raise HTTPException(502, "YouTube Music returned no home content")
    return {"shelves": shelves, "charts": charts, "moods": moods[:24]}


@app.get("/api/mood")
def mood(params: str, title: str = ""):
    """Load mood playlists, falling back to a playlist search if the mood feed is empty."""
    out = []
    sections = yt_call(ytm.get_mood_playlists, params) or []
    if isinstance(sections, dict):
        sections = sections.get("sections") or sections.get("results") or [sections]
    for section in sections:
        if not isinstance(section, dict):
            continue
        source = section.get("playlists") or section.get("contents") or section.get("items") or []
        if isinstance(source, dict):
            source = source.get("items") or source.get("results") or []
        out.extend(items(source))
    if not out and title.strip():
        try:
            out = [entry for entry in (item(row) for row in yt_call(ytm.search, title.strip(), filter="playlists", limit=18)) if entry]
        except Exception:
            out = []
    return {"results": _hydrate_track_list(out)}


@app.get("/api/album/{bid}")
def album(bid: str):
    a = yt_call(ytm.get_album, bid)
    cover, an = art(a.get("thumbnails")), a.get("title", "")
    album_artists = a.get("artists") or a.get("artist")
    album_artist = names(album_artists)
    album_artist_id = artist_id(album_artists)
    return {"type": "album", "id": bid, "title": an, "artist": album_artist, "artistId": album_artist_id,
            "year": a.get("year"), "thumb": cover, "duration": a.get("duration"),
            "tracks": _hydrate_track_list([track(t, an, cover, album_artist, album_artist_id) for t in a.get("tracks", []) if t.get("videoId")])}


def _artist_section_rows(section):
    if isinstance(section, dict):
        rows = section.get("results") or section.get("items") or section.get("contents") or []
    else:
        rows = section or []
    return rows if isinstance(rows, list) else []


def _artist_card_rows(rows, result_type):
    cards = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        payload = dict(row)
        payload.setdefault("resultType", result_type)
        if not payload.get("browseId") and payload.get("id"):
            payload["browseId"] = payload["id"]
        card = item(payload)
        if card and card.get("id"):
            cards.append(card)
    return cards


def _artist_profile_for(cid, name):
    """Try the supplied channel ID, then resolve a fresh ID by artist name."""
    tried = set()
    last_error = None

    def load(candidate_id):
        nonlocal last_error
        candidate_id = str(candidate_id or "").strip()
        if not candidate_id or candidate_id in tried:
            return None
        tried.add(candidate_id)
        try:
            profile = ytm.get_artist(candidate_id)
            if isinstance(profile, dict) and (profile.get("name") or profile.get("songs") or profile.get("albums")):
                return profile, candidate_id
        except Exception as exc:
            last_error = exc
        return None

    result = load(cid)
    if result:
        return result

    if name.strip():
        try:
            matches = ytm.search(name.strip(), filter="artists", limit=12) or []
        except Exception as exc:
            last_error = exc
            matches = []

        wanted = " ".join(name.casefold().split())
        def match_rank(row):
            label = (names(row.get("artist")) or names(row.get("title"))
                     or names(row.get("name")) or names(row.get("artistName")))
            folded = " ".join(label.casefold().split())
            if folded == wanted:
                return 0
            if wanted and (wanted in folded or folded in wanted):
                return 1
            return 2

        ordered_matches = sorted((r for r in matches if isinstance(r, dict)), key=match_rank)
        for row in ordered_matches:
            candidate_ids = [row.get("browseId"), row.get("channelId"),
                             row.get("artistId"), row.get("id"),
                             artist_id(row.get("artist")), artist_id(row.get("artists"))]
            for candidate_id in candidate_ids:
                result = load(candidate_id)
                if result:
                    return result

        # If the browse endpoint itself rejects this channel, keep the artist
        # page useful by building its sections from category search results.
        artist_match = ordered_matches[0] if ordered_matches else {}
        resolved_id = (artist_match.get("browseId") or artist_match.get("channelId")
                       or artist_match.get("artistId") or artist_match.get("id") or cid)
        artist_label = (names(artist_match.get("title")) or names(artist_match.get("artist"))
                        or names(artist_match.get("name")) or name.strip())
        wanted = artist_label.casefold()

        def safe_artist_search(category, limit):
            try:
                results = ytm.search(artist_label or name.strip(), filter=category, limit=limit) or []
                return [row for row in results if isinstance(row, dict)]
            except Exception:
                return []

        song_rows = safe_artist_search("songs", 50)
        album_rows = safe_artist_search("albums", 50)
        video_rows = safe_artist_search("videos", 30)

        def belongs_to_artist(row):
            labels = names(row.get("artists") or row.get("artist"))
            return bool(labels and wanted and wanted in labels.casefold())

        matching_songs = [row for row in song_rows if belongs_to_artist(row)]
        matching_albums = [row for row in album_rows if belongs_to_artist(row)]
        matching_videos = [row for row in video_rows if belongs_to_artist(row)]
        if matching_songs:
            song_rows = matching_songs
        if matching_albums:
            album_rows = matching_albums
        if matching_videos:
            video_rows = matching_videos

        singles_rows, album_only_rows = [], []
        for row in album_rows:
            release_type = str(row.get("type") or row.get("albumType") or "").casefold()
            (singles_rows if "single" in release_type or "ep" in release_type else album_only_rows).append(row)

        if song_rows or album_rows or video_rows:
            fallback_profile = {
                "name": artist_label, "description": "", "thumbnails": artist_match.get("thumbnails") or [],
                "subscribers": artist_match.get("subscribers", ""),
                "monthlyListeners": artist_match.get("monthlyListeners", ""),
                "songs": {"results": song_rows}, "albums": {"results": album_only_rows},
                "singles": {"results": singles_rows}, "videos": {"results": video_rows},
                "related": {"results": []},
            }
            return fallback_profile, str(resolved_id or cid)

    detail = f" ({type(last_error).__name__}: {last_error})" if last_error else ""
    raise HTTPException(502, f"Could not load this artist from YouTube Music. Try searching for the artist again.{detail}")


def _artist_tracks_from_section(section, fallback=None, limit=100):
    rows = _artist_section_rows(section)
    pointer = section.get("browseId") if isinstance(section, dict) else None
    if pointer:
        try:
            playlist_data = ytm.get_playlist(pointer, limit=limit)
            playlist_rows = playlist_data.get("tracks") if isinstance(playlist_data, dict) else []
            expanded = [track(row) for row in (playlist_rows or []) if isinstance(row, dict) and row.get("videoId")]
            if expanded:
                return expanded
        except Exception:
            pass
    source = rows if rows else (fallback or [])
    return [track(row) for row in source if isinstance(row, dict) and row.get("videoId")]


def _artist_release_cards(channel_id, section, result_type, order="Popularity"):
    rows = _artist_section_rows(section)
    params = section.get("params") if isinstance(section, dict) else None
    if params:
        try:
            expanded = ytm.get_artist_albums(channel_id, params, limit=100, order=order)
            if expanded:
                rows = expanded
        except Exception:
            # The profile and its short preview remain usable if one shelf fails.
            pass
    return _artist_card_rows(rows, result_type)


@app.get("/api/artist/{cid}")
def artist(cid: str, name: str = ""):
    profile, resolved_id = _artist_profile_for(cid, name)
    artist_name = names(profile.get("name")) or name.strip() or "Artist"
    songs_section = profile.get("songs") or {}
    popular_preview = [track(row) for row in _artist_section_rows(songs_section)
                       if isinstance(row, dict) and row.get("videoId")]
    song_tracks = _artist_tracks_from_section(songs_section, popular_preview, limit=100)

    # Some artist pages expose a short preview without a usable continuation.
    # A targeted song search is a fallback, not the primary catalogue source.
    if len(song_tracks) <= 3 and artist_name:
        try:
            searched = ytm.search(artist_name, filter="songs", limit=40) or []
            candidates = [track(row) for row in searched
                          if isinstance(row, dict) and row.get("videoId")]
            matching = [entry for entry in candidates
                        if artist_name.casefold() in (entry.get("artist") or "").casefold()]
            source = matching or candidates
            known = {entry.get("videoId") for entry in song_tracks}
            song_tracks.extend(entry for entry in source if entry.get("videoId") not in known)
        except Exception:
            pass

    video_section = profile.get("videos") or {}
    video_tracks = _artist_tracks_from_section(video_section, limit=100)
    albums = _artist_release_cards(resolved_id, profile.get("albums") or {}, "album", "Popularity")
    singles = _artist_release_cards(resolved_id, profile.get("singles") or {}, "album", "Popularity")
    related = _artist_card_rows(_artist_section_rows(profile.get("related") or {}), "artist")
    popular_tracks = popular_preview or song_tracks[:10]
    if len(popular_tracks) < 4 and song_tracks:
        popular_tracks = song_tracks[:10]

    return {
        "type": "artist", "id": resolved_id, "name": artist_name,
        "description": profile.get("description", ""),
        "thumb": art(profile.get("thumbnails")),
        "subscribers": profile.get("subscribers", ""),
        "monthlyListeners": profile.get("monthlyListeners", ""),
        "popular": _hydrate_track_list(popular_tracks[:10]),
        "songs": _hydrate_track_list(song_tracks[:100]),
        "albums": albums, "singles": singles,
        "videos": _hydrate_track_list(video_tracks[:100]),
        "related": related,
    }


@app.get("/api/playlist/{pid}")
def playlist(pid: str):
    p = yt_call(ytm.get_playlist, pid, limit=100)
    return {"type": "playlist", "id": pid, "title": p.get("title", ""), "author": names(p.get("author")),
            "thumb": art(p.get("thumbnails")), "tracks": _hydrate_track_list([track(t) for t in p.get("tracks", []) if t.get("videoId")])}


@app.get("/api/watch/{video_id}")
def watch(video_id: str):
    w = yt_call(ytm.get_watch_playlist, videoId=video_id, limit=25)
    return {"tracks": _hydrate_track_list([track(t) for t in w.get("tracks", []) if t.get("videoId")]), "lyricsId": w.get("lyrics")}


@app.get("/api/playable/{video_id}")
def playable(video_id: str):
    """Use YouTube Music's own playability response to avoid known blocked embeds."""
    now = time.time()
    cached = _playability_cache.get(video_id)
    if cached and now - cached[0] < 900:
        return {"playable": cached[1], "reason": cached[2]}

    song = yt_call(ytm.get_song, video_id)
    status = song.get("playabilityStatus") or {}
    ok = status.get("status") == "OK" and status.get("playableInEmbed") is not False
    reason = status.get("reason") or ("Available in YouTube Music" if ok else "This track is not available for embedded playback.")
    if len(_playability_cache) > 500:
        _playability_cache.pop(next(iter(_playability_cache)))
    _playability_cache[video_id] = (now, ok, reason)
    return {"playable": ok, "reason": reason}


# ---------------- ytdl-core audio stream ----------------
@app.get("/api/stream/{video_id}")
async def stream_audio(
    video_id: str,
    request: Request,
    quality: str = Query("balanced", pattern="^(data-saver|balanced|high)$"),
):
    """Stream audio from the local @distube/ytdl-core Node sidecar."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,32}", video_id or ""):
        raise HTTPException(400, "Invalid video id")
    return await _proxy_ytdl_stream(video_id, request, quality)


# ---------------- lyrics ----------------
@app.get("/api/lyrics")
async def lyrics(request: Request, videoId: str, title: str, artist: str = "", album: str = "", duration: int = 0, refresh: bool = False):
    user = sb.current_user(request)
    settings_rows = sb.rest("user_settings", user, params={
        "select": "settings", "user_id": f"eq.{user['id']}", "limit": "1",
    })
    settings = (settings_rows or [{}])[0].get("settings") or {}
    order = settings.get("lyricsOrder")
    out = await ly.lookup(ytm, videoId, title, artist, album, duration, order, refresh)
    return out


# ---------------- Supabase username/password account ----------------
@app.post("/api/auth/register")
def auth_register(request: Request, body: dict = Body(...)):
    username = body.get("username", "")
    password = body.get("password", "")
    display_name = body.get("displayName")
    client_host = request.client.host if request.client else "unknown"
    return sb.register(username, password, display_name, client_host)


@app.post("/api/auth/recover")
def auth_recover(request: Request, body: dict = Body(...)):
    client_host = request.client.host if request.client else "unknown"
    return sb.recover_account(
        body.get("username", ""),
        body.get("recoveryCode", ""),
        body.get("newPassword", ""),
        client_host,
    )


@app.get("/api/auth/me")
def auth_me(request: Request):
    user = sb.current_user(request)
    return {"profile": sb.client_profile(user)}


# ---------------- private per-user library (Supabase + RLS) ----------------
def _require_track(body: dict) -> tuple[str, dict]:
    track_id = str(body.get("videoId") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,32}", track_id):
        raise HTTPException(400, "A valid videoId is required.")
    return track_id, body


def _user_settings(user: dict) -> dict:
    rows = sb.rest("user_settings", user, params={
        "select": "settings", "user_id": f"eq.{user['id']}", "limit": "1",
    })
    return (rows or [{}])[0].get("settings") or {}


@app.get("/api/library")
def library(request: Request):
    user = sb.current_user(request)
    uid = user["id"]
    like_rows = sb.rest("liked_tracks", user, params={
        "select": "track_data,created_at", "user_id": f"eq.{uid}",
        "order": "created_at.desc", "limit": "500",
    }) or []
    history_rows = sb.rest("play_history", user, params={
        "select": "track_data,played_at", "user_id": f"eq.{uid}",
        "order": "played_at.desc", "limit": "120",
    }) or []
    playlist_rows = sb.rest("playlists", user, params={
        "select": "id,name,created_at", "user_id": f"eq.{uid}",
        "order": "created_at.desc",
    }) or []
    item_rows = sb.rest("playlist_tracks", user, params={
        "select": "playlist_id", "user_id": f"eq.{uid}",
    }) or []
    counts: dict[str, int] = {}
    for row in item_rows:
        pid = row.get("playlist_id")
        if pid:
            counts[pid] = counts.get(pid, 0) + 1
    saved_rows = sb.rest("saved_items", user, params={
        "select": "item_type,item_data,created_at", "user_id": f"eq.{uid}",
        "order": "created_at.desc", "limit": "500",
    }) or []
    likes = [row.get("track_data") for row in like_rows if isinstance(row.get("track_data"), dict)]
    recent, seen = [], set()
    for row in history_rows:
        value = row.get("track_data")
        if isinstance(value, dict) and value.get("videoId") and value["videoId"] not in seen:
            seen.add(value["videoId"])
            recent.append(value)
            if len(recent) >= 60:
                break
    saved: dict[str, list] = {"album": [], "artist": [], "playlist": []}
    for row in saved_rows:
        kind = row.get("item_type")
        if kind in saved:
            value = row.get("item_data")
            if isinstance(value, dict):
                saved[kind].append(value)
    return {
        "likes": _hydrate_track_list(likes),
        "recent": _hydrate_track_list(recent),
        "playlists": [{"id": row["id"], "name": row["name"], "count": counts.get(row["id"], 0)} for row in playlist_rows],
        "saved": saved,
    }


@app.post("/api/library/like")
def like(request: Request, t: dict = Body(...)):
    user = sb.current_user(request)
    track_id, track_data = _require_track(t)
    existing = sb.rest("liked_tracks", user, params={
        "select": "id", "user_id": f"eq.{user['id']}", "track_id": f"eq.{track_id}", "limit": "1",
    }) or []
    if existing:
        sb.rest("liked_tracks", user, method="DELETE", params={
            "user_id": f"eq.{user['id']}", "track_id": f"eq.{track_id}",
        })
        return {"liked": False}
    sb.rest("liked_tracks", user, method="POST", payload={
        "user_id": user["id"], "track_id": track_id, "track_data": track_data,
    }, prefer="return=minimal")
    return {"liked": True}


@app.post("/api/library/history")
def add_history(request: Request, t: dict = Body(...)):
    user = sb.current_user(request)
    track_id, track_data = _require_track(t)
    sb.rest("play_history", user, method="POST", payload={
        "user_id": user["id"], "track_id": track_id, "track_data": track_data,
        "played_seconds": 0,
    }, prefer="return=minimal")
    return {"ok": True}


@app.post("/api/library/saved")
def toggle_saved(request: Request, body: dict = Body(...)):
    user = sb.current_user(request)
    kind, key, data = body.get("kind"), str(body.get("id") or "").strip(), body.get("data")
    if kind not in ("album", "artist", "playlist") or not key or not isinstance(data, dict):
        raise HTTPException(400, "kind, id and data are required.")
    existing = sb.rest("saved_items", user, params={
        "select": "id", "user_id": f"eq.{user['id']}",
        "item_type": f"eq.{kind}", "item_id": f"eq.{key}", "limit": "1",
    }) or []
    if existing:
        sb.rest("saved_items", user, method="DELETE", params={
            "user_id": f"eq.{user['id']}", "item_type": f"eq.{kind}", "item_id": f"eq.{key}",
        })
        return {"saved": False}
    sb.rest("saved_items", user, method="POST", payload={
        "user_id": user["id"], "item_type": kind, "item_id": key, "item_data": data,
    }, prefer="return=minimal")
    return {"saved": True}


@app.post("/api/playlists")
def create_playlist(request: Request, body: dict = Body(...)):
    user = sb.current_user(request)
    name = (body.get("name") or "").strip()
    if not name or len(name) > 80:
        raise HTTPException(400, "Playlist name must contain 1–80 characters.")
    rows = sb.rest("playlists", user, method="POST", payload={
        "user_id": user["id"], "name": name,
    }, prefer="return=representation") or []
    if not rows:
        raise HTTPException(502, "Supabase did not return the new playlist.")
    return {"id": rows[0]["id"], "name": name, "count": 0}


@app.get("/api/playlists/{pid}")
def get_local_playlist(pid: str, request: Request):
    user = sb.current_user(request)
    playlists = sb.rest("playlists", user, params={
        "select": "id,name", "id": f"eq.{pid}", "user_id": f"eq.{user['id']}", "limit": "1",
    }) or []
    if not playlists:
        raise HTTPException(404, "Playlist not found.")
    rows = sb.rest("playlist_tracks", user, params={
        "select": "track_data,track_id,position", "playlist_id": f"eq.{pid}",
        "user_id": f"eq.{user['id']}", "order": "position.asc,added_at.asc",
    }) or []
    tracks = [row.get("track_data") for row in rows if isinstance(row.get("track_data"), dict)]
    return {"id": pid, "name": playlists[0]["name"], "tracks": _hydrate_track_list(tracks)}


@app.patch("/api/playlists/{pid}")
def rename_playlist(pid: str, request: Request, body: dict = Body(...)):
    user = sb.current_user(request)
    name = (body.get("name") or "").strip()
    if not name or len(name) > 80:
        raise HTTPException(400, "Playlist name must contain 1–80 characters.")
    sb.rest("playlists", user, method="PATCH", params={
        "id": f"eq.{pid}", "user_id": f"eq.{user['id']}",
    }, payload={"name": name, "updated_at": datetime.now(timezone.utc).isoformat()})
    return {"ok": True}


@app.delete("/api/playlists/{pid}")
def delete_playlist(pid: str, request: Request):
    user = sb.current_user(request)
    sb.rest("playlists", user, method="DELETE", params={
        "id": f"eq.{pid}", "user_id": f"eq.{user['id']}",
    })
    return {"ok": True}


@app.post("/api/playlists/{pid}/items")
def add_item(pid: str, request: Request, t: dict = Body(...)):
    user = sb.current_user(request)
    track_id, track_data = _require_track(t)
    owned = sb.rest("playlists", user, params={
        "select": "id", "id": f"eq.{pid}", "user_id": f"eq.{user['id']}", "limit": "1",
    }) or []
    if not owned:
        raise HTTPException(404, "Playlist not found.")
    positions = sb.rest("playlist_tracks", user, params={
        "select": "position", "playlist_id": f"eq.{pid}", "user_id": f"eq.{user['id']}",
        "order": "position.desc", "limit": "1",
    }) or []
    next_position = (int(positions[0].get("position", -1)) + 1) if positions else 0
    sb.rest("playlist_tracks", user, method="POST", params={"on_conflict": "playlist_id,track_id"}, payload={
        "playlist_id": pid, "user_id": user["id"], "track_id": track_id,
        "track_data": track_data, "position": next_position,
    }, prefer="resolution=ignore-duplicates,return=minimal")
    return {"ok": True}


@app.delete("/api/playlists/{pid}/items/{video_id}")
def remove_item(pid: str, video_id: str, request: Request):
    user = sb.current_user(request)
    sb.rest("playlist_tracks", user, method="DELETE", params={
        "playlist_id": f"eq.{pid}", "track_id": f"eq.{video_id}", "user_id": f"eq.{user['id']}",
    })
    return {"ok": True}


@app.put("/api/playlists/{pid}/order")
def reorder(pid: str, request: Request, body: dict = Body(...)):
    user = sb.current_user(request)
    owned = sb.rest("playlists", user, params={
        "select": "id", "id": f"eq.{pid}", "user_id": f"eq.{user['id']}", "limit": "1",
    }) or []
    if not owned:
        raise HTTPException(404, "Playlist not found.")
    for index, video_id in enumerate(body.get("videoIds", [])):
        sb.rest("playlist_tracks", user, method="PATCH", params={
            "playlist_id": f"eq.{pid}", "track_id": f"eq.{video_id}", "user_id": f"eq.{user['id']}",
        }, payload={"position": index})
    return {"ok": True}


@app.get("/api/settings")
def get_settings(request: Request):
    user = sb.current_user(request)
    settings = _user_settings(user)
    profile = sb.client_profile(user)
    settings["profile"] = {"username": profile["displayName"], "avatar": profile["avatar"], "accountUsername": profile["username"]}
    return settings


@app.put("/api/settings")
def put_settings(request: Request, body: dict = Body(...)):
    user = sb.current_user(request)
    settings = _user_settings(user)
    profile = body.get("profile")
    if isinstance(profile, dict):
        profile_patch = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if isinstance(profile.get("username"), str):
            profile_patch["display_name"] = profile["username"].strip()[:60] or "Listener"
        if isinstance(profile.get("avatar"), str) and re.fullmatch(r"rex-portrait-[0-9]{2}", profile["avatar"]):
            profile_patch["avatar_key"] = profile["avatar"]
        sb.rest("profiles", user, method="PATCH", params={"id": f"eq.{user['id']}"}, payload=profile_patch)
    for key, value in body.items():
        if key != "profile":
            settings[key] = value
    sb.rest("user_settings", user, method="POST", payload={
        "user_id": user["id"], "settings": settings,
    }, prefer="resolution=merge-duplicates,return=minimal")
    return {"ok": True}


@app.get("/api/offset/{video_id}")
def get_offset(video_id: str, request: Request):
    user = sb.current_user(request)
    rows = sb.rest("playback_offsets", user, params={
        "select": "position_seconds", "user_id": f"eq.{user['id']}",
        "track_id": f"eq.{video_id}", "limit": "1",
    }) or []
    return {"offset": float(rows[0].get("position_seconds") or 0) if rows else 0}


@app.put("/api/offset/{video_id}")
def put_offset(video_id: str, request: Request, body: dict = Body(...)):
    user = sb.current_user(request)
    try:
        offset = max(0.0, float(body.get("offset", 0)))
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid playback offset.")
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,32}", video_id or ""):
        raise HTTPException(400, "Invalid video id.")
    sb.rest("playback_offsets", user, method="POST", payload={
        "user_id": user["id"], "track_id": video_id, "position_seconds": offset,
    }, prefer="resolution=merge-duplicates,return=minimal")
    return {"ok": True}


# ---------------- frontend (SPA) ----------------
if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{path:path}")
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    f = (DIST / path).resolve()
    if path and f.is_file() and DIST in f.parents:
        return FileResponse(f)
    idx = DIST / "index.html"
    if not idx.exists():
        raise HTTPException(503, "Frontend not built. Run bash termux-setup.sh (or: cd frontend && npm run build).")
    return FileResponse(idx)


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # no packets sent; picks the outbound interface
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(i for i in ips if i.startswith(("192.168.", "10.", "172.")) or False)


def main():
    lan = "--local" not in sys.argv
    host = "0.0.0.0" if lan else "127.0.0.1"
    print("\n  REX MUSIC")
    print(f"  Local:   http://localhost:{PORT}")
    if lan:
        for ip in lan_ips():
            print(f"  Network: http://{ip}:{PORT}   <- open this on your phone (same Wi-Fi)")
    print("  Press Ctrl+C to stop.\n")
    uvicorn.run(app, host=host, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
