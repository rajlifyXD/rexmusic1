"""Thin wrapper around ytmusicapi (unofficial). Normalises results into small JSON shapes."""
from urllib.parse import quote

from ytmusicapi import YTMusic

ytm = YTMusic()  # public, unauthenticated. Authenticated features are optional (see README).


def art(thumbs, size=544):
    if not thumbs:
        return ""
    url = thumbs[-1].get("url", "")
    if "=w" in url and "googleusercontent" in url:
        return url.split("=w")[0] + f"=w{size}-h{size}-l90-rj"
    return url


def _artist_entries(value):
    """Extract readable artist/text labels from common YT Music response shapes."""
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, dict):
        # YTMusic has returned plain strings, text runs, and nested endpoint
        # objects for artist labels across different search/browse responses.
        for key in ("name", "artistName", "displayName", "artist", "title", "simpleText", "text", "label"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return [candidate.strip()]
            if isinstance(candidate, (dict, list, tuple)):
                nested_names = _artist_entries(candidate)
                if nested_names:
                    return nested_names
        for key in ("runs", "items", "artists", "results", "contents"):
            nested = value.get(key)
            if nested is not None:
                nested_names = _artist_entries(nested)
                if nested_names:
                    return nested_names
        return []
    if isinstance(value, (list, tuple)):
        result = []
        seen = set()
        for entry in value:
            for name in _artist_entries(entry):
                folded = name.casefold()
                if folded not in seen:
                    seen.add(folded)
                    result.append(name)
        return result
    return []


def names(artists):
    """Return readable artist names from any common YTMusic response shape."""
    return ", ".join(_artist_entries(artists))


def artist_id(artists):
    """Extract the first artist browse ID from list, object, or wrapper shapes."""
    if isinstance(artists, dict):
        for key in ("id", "browseId", "artistId", "channelId"):
            value = artists.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        for key in ("items", "artists", "results", "contents"):
            nested = artists.get(key)
            if nested is not None:
                found = artist_id(nested)
                if found:
                    return found
    elif isinstance(artists, (list, tuple)):
        for artist in artists:
            found = artist_id(artist)
            if found:
                return found
    return None


def track(i, album_name="", album_art="", album_artist="", album_artist_id=None):
    album = i.get("album")
    # Preserve motion artwork only when a provider explicitly supplies a playable
    # animated asset. Standard YouTube Music thumbnails are still images.
    animated = i.get("animatedThumb") or i.get("animatedThumbnail") or i.get("motionArtwork")
    if isinstance(animated, list):
        animated = art(animated)
    elif isinstance(animated, dict):
        animated = animated.get("url") or animated.get("src") or ""
    # Some album tracklists omit per-track artist metadata because every track
    # inherits the album artist. Other response variants use `artist` instead
    # of `artists`, or wrap the list in an `items` object.
    artist_data = i.get("artists") or i.get("artist") or i.get("artistName") or i.get("author")
    resolved_artist = names(artist_data) or names(album_artist)
    resolved_artist_id = artist_id(i.get("artists")) or artist_id(i.get("artist")) or album_artist_id
    return {
        "type": "song",
        "videoId": i.get("videoId"),
        "title": i.get("title", ""),
        "artist": resolved_artist,
        "artistId": resolved_artist_id,
        "album": (album.get("name") if isinstance(album, dict) else album) or album_name,
        "albumId": album.get("id") if isinstance(album, dict) else None,
        "duration": int(i.get("duration_seconds") or 0),
        "thumb": art(i.get("thumbnails") or i.get("thumbnail")) or album_art,
        **({"animatedThumb": animated} if isinstance(animated, str) and animated.startswith(("http://", "https://")) else {}),
    }


def item(i):
    """Classify a search/home item and preserve artist labels/IDs defensively."""
    if not isinstance(i, dict):
        return None
    rt = str(i.get("resultType") or "").strip().casefold()
    browse_id = i.get("browseId") or i.get("channelId") or i.get("artistId")

    # This is a music app: do not mix arbitrary YouTube video search results
    # into the catalogue. Home/radio results commonly omit resultType.
    if i.get("videoId") and rt in ("", "song"):
        return track(i)

    if rt == "album" or str(browse_id or "").startswith("MPRE"):
        album_id = browse_id or i.get("id")
        title = names(i.get("title")) or names(i.get("name")) or "Untitled album"
        return {"type": "album", "id": album_id, "title": title,
                "subtitle": names(i.get("artists")) or str(i.get("year") or ""),
                "thumb": art(i.get("thumbnails") or i.get("thumbnail"))}

    if rt == "artist" or str(browse_id or "").startswith("UC"):
        artist_name = (names(i.get("artist")) or names(i.get("artists"))
                       or names(i.get("artistName")) or names(i.get("name"))
                       or names(i.get("title")) or names(i))
        artist_browse_id = browse_id or i.get("id") or artist_id(i.get("artist")) or artist_id(i.get("artists"))
        if artist_browse_id:
            return {"type": "artist", "id": artist_browse_id,
                    "title": artist_name or "Unknown artist",
                    "subtitle": i.get("subscribers") or i.get("monthlyListeners") or "",
                    "thumb": art(i.get("thumbnails") or i.get("thumbnail"))}

    if rt == "playlist" or i.get("playlistId"):
        pid = i.get("playlistId") or i.get("browseId") or i.get("id")
        if pid:
            title = names(i.get("title")) or names(i.get("name")) or "Untitled playlist"
            return {"type": "playlist", "id": pid, "title": title,
                    "subtitle": names(i.get("author")) or names(i.get("description")),
                    "thumb": art(i.get("thumbnails") or i.get("thumbnail"))}
    return None



def items(lst):
    return [x for x in (item(i) for i in (lst or [])) if x and (x.get("videoId") or x.get("id"))]


def proxied(url):
    return f"/api/img?u={quote(url, safe='')}" if url else ""
