"""Vercel FastAPI entrypoint for the REX API project."""
import os

# Vercel Functions have an ephemeral writable /tmp directory. The persistent
# personal library lives in Supabase; this SQLite file is only a local health
# check/compatibility placeholder and must never be treated as user storage.
if os.environ.get("VERCEL") == "1":
    os.environ.setdefault("LIQUID_DB", "/tmp/rex/liquid.db")

from app.main import app  # noqa: E402


@app.get("/", include_in_schema=False)
async def api_root():
    return {
        "service": "REX API",
        "status": "online",
        "health": "/api/health",
        "note": "The REX web frontend is deployed separately.",
    }
