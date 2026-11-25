"""One-time, explicit import of this installation's SQLite library into one REX user.

Dry-run first: python backend/migrate_local_library.py --username your_name
Import only after reviewing the counts: add --confirm.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"


def load_env():
    if not ENV_FILE.is_file():
        return
    for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()
sys.path.insert(0, str(ROOT / "backend"))
from app import supabase_store as sb  # noqa: E402


def iso_timestamp(value):
    try:
        return datetime.fromtimestamp(float(value), timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return datetime.now(timezone.utc).isoformat()


def parse_json(value, fallback=None):
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def main():
    parser = argparse.ArgumentParser(description="Import this REX installation's old SQLite library to one Supabase account.")
    parser.add_argument("--username", required=True, help="The REX account username to receive the local library")
    parser.add_argument("--confirm", action="store_true", help="Perform the import. Without this, only a dry-run summary is shown.")
    args = parser.parse_args()

    sb.require_config(admin=True)
    username = args.username.strip().lower()
    sb.username_email(username)  # validates the username format
    db_path = Path(os.environ.get("LIQUID_DB", ROOT / "data" / "liquid.db"))
    if not db_path.is_file():
        raise SystemExit(f"SQLite library not found: {db_path}")

    profiles = sb.admin_rest("profiles", params={"select": "id,username", "username": f"eq.{username}", "limit": "1"}) or []
    if not profiles:
        raise SystemExit(f"No Supabase account profile found for username '{username}'. Create the account and sign in once first.")
    user_id = profiles[0]["id"]

    with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as con:
        con.row_factory = sqlite3.Row
        tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        counts = {}
        for table in ("likes", "history", "playlists", "playlist_items", "saved", "settings", "offsets", "search_history"):
            counts[table] = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] if table in tables else 0
        tracks = {row["video_id"]: parse_json(row["data"], {}) for row in con.execute("SELECT video_id,data FROM tracks")} if "tracks" in tables else {}
        likes = con.execute("SELECT video_id,ts FROM likes ORDER BY ts DESC").fetchall() if "likes" in tables else []
        history = con.execute("SELECT video_id,ts FROM history ORDER BY id DESC").fetchall() if "history" in tables else []
        playlists = con.execute("SELECT id,name,created FROM playlists ORDER BY created").fetchall() if "playlists" in tables else []
        playlist_items = con.execute("SELECT playlist_id,video_id,position FROM playlist_items ORDER BY playlist_id,position").fetchall() if "playlist_items" in tables else []
        saved = con.execute("SELECT kind,key,data,ts FROM saved ORDER BY ts DESC").fetchall() if "saved" in tables else []
        settings_rows = con.execute("SELECT key,value FROM settings").fetchall() if "settings" in tables else []
        offsets = con.execute("SELECT video_id,offset FROM offsets").fetchall() if "offsets" in tables else []
        searches = con.execute("SELECT q,ts FROM search_history ORDER BY ts DESC").fetchall() if "search_history" in tables else []

    print(f"Local database: {db_path}")
    print(f"Destination account: {username}")
    for key, value in counts.items():
        print(f"  {key}: {value}")
    print(f"  track metadata records: {len(tracks)}")
    if not args.confirm:
        print("\nDRY RUN ONLY — no data was changed. Review the counts, then rerun with --confirm.")
        return

    # Avoid accidental merging or duplicate imports into an account that has already started using REX.
    for table in ("liked_tracks", "play_history", "playlists", "playlist_tracks", "saved_items", "user_settings", "playback_offsets", "search_history"):
        existing = sb.admin_rest(table, params={"select": "*", "user_id": f"eq.{user_id}", "limit": "1"}) or []
        if existing:
            raise SystemExit(f"Import stopped: account '{username}' already has data in {table}. No data has been imported by this run.")

    playlist_id_map = {row["id"]: str(uuid.uuid4()) for row in playlists}
    playlist_records = [{
        "id": playlist_id_map[row["id"]], "user_id": user_id,
        "name": (row["name"] or "Imported playlist")[:80],
        "created_at": iso_timestamp(row["created"]),
    } for row in playlists]
    if playlist_records:
        sb.admin_rest("playlists", method="POST", payload=playlist_records, prefer="return=minimal")

    playlist_track_records = []
    for row in playlist_items:
        track_data = tracks.get(row["video_id"])
        mapped_id = playlist_id_map.get(row["playlist_id"])
        if mapped_id and isinstance(track_data, dict) and track_data:
            playlist_track_records.append({
                "playlist_id": mapped_id, "user_id": user_id,
                "track_id": row["video_id"], "track_data": track_data,
                "position": int(row["position"] or 0),
            })
    if playlist_track_records:
        sb.admin_rest("playlist_tracks", method="POST", payload=playlist_track_records, prefer="return=minimal")

    like_records = [{
        "user_id": user_id, "track_id": row["video_id"], "track_data": tracks[row["video_id"]],
        "created_at": iso_timestamp(row["ts"]),
    } for row in likes if isinstance(tracks.get(row["video_id"]), dict) and tracks[row["video_id"]]]
    if like_records:
        sb.admin_rest("liked_tracks", method="POST", payload=like_records, prefer="return=minimal")

    history_records = [{
        "user_id": user_id, "track_id": row["video_id"], "track_data": tracks[row["video_id"]],
        "played_at": iso_timestamp(row["ts"]), "played_seconds": 0,
    } for row in history if isinstance(tracks.get(row["video_id"]), dict) and tracks[row["video_id"]]]
    if history_records:
        sb.admin_rest("play_history", method="POST", payload=history_records, prefer="return=minimal")

    saved_records = []
    for row in saved:
        value = parse_json(row["data"], {})
        if row["kind"] in ("album", "artist", "playlist") and isinstance(value, dict):
            saved_records.append({
                "user_id": user_id, "item_type": row["kind"], "item_id": str(row["key"]),
                "item_data": value, "created_at": iso_timestamp(row["ts"]),
            })
    if saved_records:
        sb.admin_rest("saved_items", method="POST", payload=saved_records, prefer="return=minimal")

    settings = {row["key"]: parse_json(row["value"]) for row in settings_rows}
    profile = settings.pop("profile", {})
    if isinstance(profile, dict):
        patch = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if isinstance(profile.get("username"), str):
            patch["display_name"] = profile["username"][:60]
        if isinstance(profile.get("avatar"), str):
            patch["avatar_key"] = profile["avatar"]
        sb.admin_rest("profiles", method="PATCH", params={"id": f"eq.{user_id}"}, payload=patch)
    if settings:
        sb.admin_rest("user_settings", method="POST", payload={"user_id": user_id, "settings": settings},
                      prefer="resolution=merge-duplicates,return=minimal")

    offset_records = [{
        "user_id": user_id, "track_id": row["video_id"], "position_seconds": max(0, float(row["offset"] or 0)),
    } for row in offsets]
    if offset_records:
        sb.admin_rest("playback_offsets", method="POST", payload=offset_records,
                      prefer="resolution=merge-duplicates,return=minimal")

    search_records = [{"user_id": user_id, "query": row["q"][:200], "searched_at": iso_timestamp(row["ts"])}
                      for row in searches if (row["q"] or "").strip()]
    if search_records:
        sb.admin_rest("search_history", method="POST", payload=search_records, prefer="return=minimal")

    print("\nImport completed. The original SQLite database was left unchanged.")
    print(f"Imported playlists: {len(playlist_records)}")
    print(f"Imported playlist tracks: {len(playlist_track_records)}")
    print(f"Imported likes: {len(like_records)}")
    print(f"Imported history entries: {len(history_records)}")
    print(f"Imported saved items: {len(saved_records)}")
    print(f"Imported resume offsets: {len(offset_records)}")
    print(f"Imported searches: {len(search_records)}")


if __name__ == "__main__":
    main()
