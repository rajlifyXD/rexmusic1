"""SQLite persistence for the local Liquid Music library (no account required)."""
import json
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(os.environ.get("LIQUID_DB", Path(__file__).resolve().parents[2] / "data" / "liquid.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS tracks (video_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS likes (video_id TEXT PRIMARY KEY, ts REAL NOT NULL);
CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT NOT NULL, ts REAL NOT NULL);
CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL, position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, video_id));
CREATE TABLE IF NOT EXISTS saved (kind TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, ts REAL NOT NULL, PRIMARY KEY (kind, key));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS offsets (video_id TEXT PRIMARY KEY, offset REAL NOT NULL);
CREATE TABLE IF NOT EXISTS search_history (q TEXT PRIMARY KEY, ts REAL NOT NULL);
"""


@contextmanager
def conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=20.0)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout=20000")
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA synchronous=NORMAL")
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init():
    with conn() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)
        c.execute("PRAGMA wal_autocheckpoint=1000")


def upsert_track(c, t: dict):
    c.execute("INSERT OR REPLACE INTO tracks(video_id,data) VALUES(?,?)", (t["videoId"], json.dumps(t)))


def tracks_for(c, rows):
    out = []
    for r in rows:
        tr = c.execute("SELECT data FROM tracks WHERE video_id=?", (r["video_id"],)).fetchone()
        if tr:
            out.append(json.loads(tr["data"]))
    return out


def now():
    return time.time()
