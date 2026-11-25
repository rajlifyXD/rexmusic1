"""Unified lyrics engine.

Normalised result:
  {source, sync: "word"|"line"|"none", lines: [{start,end,text,words:[{start,end,text,space}]|None}], attribution}
Provider timestamps are retained; timed line lyrics may receive clearly-labelled approximate word pacing.
"""
import asyncio
import difflib
import os
import re
import time
import xml.etree.ElementTree as ET

import httpx

UA = "LiquidMusic/1.0 (self-hosted local music app)"
LIRIQO_BASES = [b for b in os.environ.get(
    "LIRIQO_BASE", "https://api.liriqo-alfarrizi.my.id/v1,https://api.liriqo-alfarrizi.workers.dev/v1").split(",") if b]
BETTER_URL = "https://api.betterlyrics.org/getLyrics"
LRCLIB_URL = "https://lrclib.net/api/get"
DEFAULT_ORDER = ["ytmusic", "liriqo", "betterlyrics", "lrclib"]

_cache: dict[str, tuple[float, dict | None]] = {}
_blocked_until: dict[str, float] = {}
HIT_TTL, MISS_TTL = 6 * 3600, 3600


# ---------- time + format parsers ----------
def tc(s: str | None) -> float | None:
    if not s:
        return None
    s = s.strip()
    try:
        if s.endswith("ms"):
            return float(s[:-2]) / 1000
        if s.endswith("s"):
            return float(s[:-1])
        parts = [float(p) for p in s.split(":")]
        t = 0.0
        for p in parts:
            t = t * 60 + p
        return t
    except ValueError:
        return None


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_ttml(text: str) -> dict | None:
    try:
        root = ET.fromstring(text.strip().encode("utf-8"))
    except ET.ParseError:
        return None
    lines, any_words = [], False
    for p in root.iter():
        if _local(p.tag) != "p":
            continue
        start, end = tc(p.get("begin")), tc(p.get("end"))
        words, plain = [], []
        spans = [c for c in p if _local(c.tag) == "span"]
        for sp in spans:
            role = " ".join(v for k, v in sp.attrib.items() if _local(k) == "role")
            if "translation" in role or "roman" in role:
                continue
            raw_text = "".join(sp.itertext())
            t = raw_text.strip()
            ws, we = tc(sp.get("begin")), tc(sp.get("end"))
            # TTML whitespace can live either inside the span text ("word ")
            # or in the element tail between spans. Preserve both forms before
            # stripping the token for display.
            has_space_after = bool(raw_text and raw_text[-1].isspace()) or bool(sp.tail and sp.tail[0].isspace())
            if t and ws is not None and we is not None:
                words.append({"start": ws, "end": we, "text": t, "space": has_space_after})
        if words:
            # merge syllables that are not separated by whitespace into one display word
            any_words = True
            line_text = "".join(w["text"] + (" " if w["space"] else "") for w in words).strip()
        else:
            line_text = "".join(p.itertext()).strip()
            words = None
        if not line_text:
            continue
        if start is None and words:
            start = words[0]["start"]
        if end is None and words:
            end = words[-1]["end"]
        lines.append({"start": start, "end": end, "text": line_text, "words": words})
    if not lines:
        return None
    synced = all(l["start"] is not None for l in lines)
    return {"sync": ("word" if any_words else "line") if synced else "none", "lines": lines}


LRC_TS = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")
LRC_WORD = re.compile(r"<(\d+):(\d+(?:\.\d+)?)>")


def parse_lrc(text: str) -> dict | None:
    raw = []
    for ln in text.splitlines():
        stamps = LRC_TS.findall(ln)
        if not stamps:
            continue
        body = LRC_TS.sub("", ln).strip()
        for m, s in stamps:
            raw.append((int(m) * 60 + float(s), body))
    if not raw:
        return None
    raw.sort(key=lambda x: x[0])
    lines, enhanced = [], False
    for i, (start, body) in enumerate(raw):
        end = raw[i + 1][0] if i + 1 < len(raw) else None
        words = None
        if LRC_WORD.search(body):
            enhanced = True
            pieces = LRC_WORD.split(body)  # [pre, m, s, text, m, s, text...]
            words = []
            for k in range(1, len(pieces) - 2, 3):
                ws = int(pieces[k]) * 60 + float(pieces[k + 1])
                raw_word = pieces[k + 2]
                words.append({"start": ws, "end": None, "text": raw_word.strip(), "space": bool(raw_word and raw_word[-1].isspace())})
            for k, w in enumerate(words):
                w["end"] = words[k + 1]["start"] if k + 1 < len(words) else end
            words = [w for w in words if w["text"]]
            body = "".join(w["text"] + (" " if w.get("space") else "") for w in words).strip()
        if body:
            lines.append({"start": start, "end": end, "text": body, "words": words})
    return {"sync": "word" if enhanced else "line", "lines": lines} if lines else None


def parse_plain(text: str) -> dict | None:
    lines = [{"start": None, "end": None, "text": l.strip(), "words": None} for l in text.splitlines()]
    return {"sync": "none", "lines": lines} if any(l["text"] for l in lines) else None


def from_timed(timed: list) -> dict | None:
    """LiriQo / ytmusicapi style [{text,start,end,words?}] lists."""
    lines, any_words = [], False
    for t in timed or []:
        text = (t.get("text") or "").strip()
        if not text:
            continue
        words = None
        if t.get("words"):
            words, pos = [], 0
            for w in t["words"]:
                wt = (w.get("text") or "").strip()
                if not wt:
                    continue
                idx = text.find(wt, pos)
                if idx >= 0:  # derive spacing from the real line text instead of guessing
                    pos = idx + len(wt)
                    space = pos < len(text) and text[pos].isspace()
                else:
                    space = True
                words.append({"start": w["start"], "end": w.get("end"), "text": wt, "space": space})
            any_words = any_words or bool(words)
        lines.append({"start": t.get("start"), "end": t.get("end"), "text": text, "words": words or None})
    if not lines or any(l["start"] is None for l in lines):
        return None
    return {"sync": "word" if any_words else "line", "lines": lines}


def to_seconds_guard(res: dict | None) -> dict | None:
    """Guard against providers that return milliseconds: if a start is absurdly large, divide."""
    if not res:
        return res
    starts = [l["start"] for l in res["lines"] if l["start"] is not None]
    if starts and max(starts) > 20000:  # > 5.5 hours cannot be seconds for a song
        def f(x):
            return None if x is None else x / 1000
        for l in res["lines"]:
            l["start"], l["end"] = f(l["start"]), f(l["end"])
            for w in l["words"] or []:
                w["start"], w["end"] = f(w["start"]), f(w["end"])
    return res


def estimate_word_timing(res: dict | None, duration: int = 0) -> dict | None:
    """Add clearly-labelled approximate karaoke timing to timed line lyrics.

    This does not claim provider-level word alignment. It apportions each timed
    line by token length and punctuation, so line-synced catalogues can still
    show a gentle word highlight when genuine word timestamps are unavailable.
    Untimed plain lyrics are deliberately left untouched.
    """
    if not res or res.get("sync") == "none":
        return res
    lines = res.get("lines") or []
    added = False
    for index, line in enumerate(lines):
        if line.get("words") or line.get("start") is None:
            continue
        start = float(line["start"])
        end_value = line.get("end")
        if end_value is None:
            end_value = next((x.get("start") for x in lines[index + 1:] if x.get("start") is not None), None)
        if end_value is None and duration > start:
            end_value = duration
        if end_value is None:
            continue
        end = float(end_value)
        if end - start < 0.28:
            continue
        tokens = re.findall(r"\S+", line.get("text") or "")
        if not tokens:
            continue
        if len(tokens) == 1:
            line["words"] = [{"start": start, "end": end, "text": tokens[0], "space": False}]
            added = True
            continue
        # Longer words receive slightly more of the line; punctuation adds a
        # tiny pause. Keep a minimum floor so short words remain readable.
        weights = []
        for token in tokens:
            core = re.sub(r"[^\w]", "", token, flags=re.UNICODE)
            weight = max(1.0, len(core) ** 0.72)
            if re.search(r"[,;:!?]$", token):
                weight *= 1.12
            weights.append(weight)
        total = sum(weights)
        span = end - start
        gap = min(0.055, span / (len(tokens) * 5))
        usable = max(0.1, span - gap * (len(tokens) - 1))
        cursor = start
        timed_words = []
        for token_index, (token, weight) in enumerate(zip(tokens, weights)):
            word_end = end if token_index == len(tokens) - 1 else cursor + usable * weight / total
            timed_words.append({"start": cursor, "end": word_end, "text": token, "space": True})
            cursor = word_end + gap
        line["words"] = timed_words
        added = True
    if added:
        res["sync"] = "word"
        res["wordTiming"] = "estimated"
    elif res.get("sync") == "word":
        res["wordTiming"] = res.get("wordTiming") or "source"
    return res


# ---------- providers ----------
class Ctx:
    def __init__(self, ytm, video_id, title, artist, album, duration):
        self.ytm, self.video_id, self.title, self.artist, self.album, self.duration = ytm, video_id, title, artist, album, duration


async def p_ytmusic(c: Ctx, http):
    def run():
        wp = c.ytm.get_watch_playlist(videoId=c.video_id)
        bid = wp.get("lyrics")
        if not bid:
            return None
        return c.ytm.get_lyrics(bid, timestamps=True)

    data = await asyncio.to_thread(run)
    if not data:
        return None
    ly = data.get("lyrics")
    src = data.get("source") or "YouTube Music"
    if isinstance(ly, list):
        def g(l, k):
            return l.get(k) if isinstance(l, dict) else getattr(l, k, None)
        # ytmusicapi reports timed lyrics in milliseconds
        normalised = []
        for line in ly:
            raw_words = g(line, "words") or g(line, "tokens") or []
            words = []
            for word in raw_words:
                wt = g(word, "text") or g(word, "word") or ""
                ws = g(word, "start")
                ws_ms = g(word, "start_time")
                if ws is None and ws_ms is not None:
                    ws = ws_ms / 1000
                we = g(word, "end")
                we_ms = g(word, "end_time")
                if we is None and we_ms is not None:
                    we = we_ms / 1000
                # Some unofficial providers return millisecond values under
                # generic start/end keys; tolerate that shape too.
                if ws is not None and ws > 20000:
                    ws = ws / 1000
                if we is not None and we > 20000:
                    we = we / 1000
                if wt and ws is not None:
                    words.append({"text": wt, "start": ws, "end": we})
            normalised.append({"text": g(line, "text"),
                               "start": None if g(line, "start_time") is None else g(line, "start_time") / 1000,
                               "end": None if g(line, "end_time") is None else g(line, "end_time") / 1000,
                               "words": words})
        res = from_timed(normalised)
    else:
        res = parse_plain(ly or "")
    return res and {**res, "source": "YouTube Music", "attribution": src}


async def p_liriqo(c: Ctx, http):
    last_err = None
    for base in LIRIQO_BASES:
        try:
            r = await http.get(f"{base}/lyrics", params={"v": c.video_id})
            if r.status_code != 200:
                last_err = f"{base} -> {r.status_code}"
                continue
            data = r.json()
            primary = data.get("primary") or (data.get("tracks") or [None])[0]
            if not primary:
                return None
            res = from_timed(primary.get("timed"))
            if not res and primary.get("ttml"):
                res = parse_ttml(primary["ttml"])
            if not res and primary.get("plain"):
                res = parse_plain(primary["plain"])
            res = to_seconds_guard(res)
            if not res:
                return None
            lvl = primary.get("syncLevel", "")
            return {**res, "source": "LiriQo", "attribution": f"LiriQo / {primary.get('provider', 'unknown')} ({lvl})"}
        except Exception as e:  # network or JSON error -> try next base
            last_err = f"{base}: {e}"
    if last_err:
        raise RuntimeError(last_err)
    return None


async def p_betterlyrics(c: Ctx, http):
    params = {"s": c.title, "a": c.artist}
    if c.album:
        params["al"] = c.album
    if c.duration:
        params["d"] = str(c.duration)
    r = await http.get(BETTER_URL, params=params)
    if r.status_code == 401:
        raise RuntimeError("Better Lyrics API requires authorisation (401)")
    if r.status_code == 429:
        _blocked_until["betterlyrics"] = time.time() + float(r.headers.get("Retry-After", 60))
        raise RuntimeError("Better Lyrics rate limited (429)")
    if r.status_code != 200:
        return None
    body = r.text
    ttml = None
    try:
        j = r.json()
        if isinstance(j, dict):
            ttml = j.get("ttml") or j.get("lyrics") or j.get("data")
        elif isinstance(j, str):
            ttml = j
    except ValueError:
        ttml = body
    if isinstance(ttml, str) and "<" in ttml:
        res = parse_ttml(ttml)
        return res and {**res, "source": "Better Lyrics", "attribution": "Better Lyrics (TTML)"}
    return None


async def p_lrclib(c: Ctx, http):
    params = {"track_name": c.title, "artist_name": c.artist}
    if c.album:
        params["album_name"] = c.album
    if c.duration:
        params["duration"] = str(c.duration)

    async def checked(r):
        if r.status_code == 429:
            _blocked_until["lrclib"] = time.time() + float(r.headers.get("Retry-After", 60))
            raise RuntimeError("LRCLIB rate limited (429)")
        return r.json() if r.status_code == 200 else None

    # Prefer LRCLIB's exact lookup (including duration/album), then use its
    # public search endpoint when catalogue metadata differs slightly.
    data = await checked(await http.get(LRCLIB_URL, params=params))
    if not data:
        query = " ".join(part for part in (c.title, c.artist) if part)
        results = await checked(await http.get("https://lrclib.net/api/search", params={"q": query}))
        if isinstance(results, list) and results:
            def score(item):
                title = difflib.SequenceMatcher(None, (item.get("trackName") or "").casefold(), c.title.casefold()).ratio()
                artist = difflib.SequenceMatcher(None, (item.get("artistName") or "").casefold(), c.artist.casefold()).ratio()
                duration = item.get("duration")
                duration_score = 1.0 if not c.duration or not duration else max(0.0, 1 - abs(float(duration) - c.duration) / 30)
                return title * 0.55 + artist * 0.35 + duration_score * 0.10
            data = max(results, key=score)
            if score(data) < 0.62:
                data = None
    if not isinstance(data, dict):
        return None
    res = parse_lrc(data.get("syncedLyrics") or "") or parse_plain(data.get("plainLyrics") or "")
    return res and {**res, "source": "LRCLIB", "attribution": "LRCLIB (lrclib.net)"}


PROVIDERS = {"ytmusic": p_ytmusic, "liriqo": p_liriqo, "betterlyrics": p_betterlyrics, "lrclib": p_lrclib}


async def lookup(ytm, video_id, title, artist, album="", duration=0, order=None, force=False):
    key = video_id
    hit = _cache.get(key)
    if hit and not force and time.time() - hit[0] < (HIT_TTL if hit[1] else MISS_TTL):
        return {"result": hit[1], "attempts": [{"provider": "cache", "status": "hit" if hit[1] else "cached-miss"}]}
    c = Ctx(ytm, video_id, title, artist, album, duration)
    attempts, best = [], None
    async with httpx.AsyncClient(timeout=10, headers={"User-Agent": UA}, follow_redirects=True) as http:
        for name in order or DEFAULT_ORDER:
            fn = PROVIDERS.get(name)
            if not fn:
                continue
            if _blocked_until.get(name, 0) > time.time():
                attempts.append({"provider": name, "status": "skipped (rate limited)"})
                continue
            try:
                res = await fn(c, http)
            except Exception as e:
                attempts.append({"provider": name, "status": f"error: {e}"})
                continue
            if not res:
                attempts.append({"provider": name, "status": "no lyrics"})
                continue
            attempts.append({"provider": name, "status": f"found ({res['sync']})"})
            # Prefer genuine word timestamps over line timing. A line-synced result
            # should not stop the chain: a later provider may have karaoke-level data.
            if res["sync"] == "word":
                best = res
                break
            if res["sync"] == "line":
                if best is None or best.get("sync") == "none":
                    best = res
                continue
            best = best or res  # keep plain lyrics only as a final fallback
    if best:
        best = estimate_word_timing(best, duration)
    _cache[key] = (time.time(), best)
    return {"result": best, "attempts": attempts}
