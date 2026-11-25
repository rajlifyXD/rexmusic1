# REX — Connected Edition

REX is a mobile-first music web app with a React/Vite frontend, a FastAPI API, Supabase Auth/PostgreSQL for user accounts and private libraries, and a Node.js `@distube/ytdl-core` streaming sidecar. It is a web app, not a native APK.

## Features

- Username/password accounts with one-time recovery codes.
- Separate user profiles, likes, playlists, history, saved items, settings, and playback offsets protected by Supabase Row Level Security.
- Search/catalogue, lyrics, artwork proxy, and audio streaming through the FastAPI backend.
- Original REX player, queue, lyrics, seeking, quality selection, and artwork presentation.
- Windows and Android/Termux setup and LAN access.

## Quick start — Windows

Requirements: Python 3.11+, Node.js 22.22.2+, 24.15.0+, or 26+.

```powershell
Copy-Item .env.example .env
# Add your Supabase Project URL, publishable key, and backend-only secret key to .env.
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
.\run-windows.bat
```

For same-Wi-Fi phone access, run `.\run-lan.bat` and open the Network URL printed in the terminal.

## Android / Termux

```bash
bash termux-setup.sh
bash termux-run.sh
```

## Supabase setup

See [docs/SUPABASE-SETUP.md](docs/SUPABASE-SETUP.md). For a new Supabase project, run `database/001_schema.sql` followed by `database/002_security_hardening.sql` in the SQL Editor. If your existing REX project already has the schema and hardening patch, do not rerun them.

## Deploy frontend and backend to Vercel

See [docs/VERCEL-DEPLOYMENT.md](docs/VERCEL-DEPLOYMENT.md). Create two Vercel projects from this repository: set `frontend` as the frontend project's Root Directory, and `backend` as the API project's Root Directory. The API project deploys FastAPI plus a Node.js serverless audio-stream function. Vercel Hobby functions have a 300-second maximum duration, so long tracks can be interrupted; use this as a test deployment, not a promise of unlimited continuous streaming.

## Repository hygiene and private data

The source bundle intentionally excludes `.env`, SQLite databases, build output, dependency folders, obsolete one-off patch installers, and backup copies of source files. Keep private local database backups outside the Git repository. Never commit the Supabase secret/service-role key.

## Playback engine notes

The local audio path is `HTMLAudioElement → /api/stream/{video_id} → FastAPI → Node @distube/ytdl-core v5 sidecar`. In the Vercel deployment, the same browser URL is rewritten to the Node.js Vercel Function at `backend/api/ytdl.js`; FastAPI remains the API for the other routes. The extractor is unofficial and the source may rate-limit or reject requests. The quality selector chooses from the available formats; it does not guarantee lossless audio.

## License

See [LICENSE](LICENSE).
