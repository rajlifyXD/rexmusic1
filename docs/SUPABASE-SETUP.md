# REX — Supabase accounts and private library

REX uses username/password accounts backed by Supabase Auth. The user-facing app does not ask for an email address; the FastAPI backend maps usernames to a non-deliverable internal alias.

## 1. Create the database schema

For a **brand-new Supabase project**, open **SQL Editor → New query** and run the complete file:

```text
database/001_schema.sql
```

Then run the hardening patch:

```text
database/002_security_hardening.sql
```

The first script creates the ten app tables. The second script enforces playlist ownership at the database level and prevents clients from changing login usernames through profile updates.

If your REX project already has all ten tables and you already ran the hardening patch, do not rerun either script. These instructions are mainly for setting up a fresh Supabase project.

## 2. Configure local development

Copy `.env.example` to `.env` in the repository root.

- `SUPABASE_URL`: Supabase Project URL.
- `SUPABASE_ANON_KEY`: publishable key (`sb_publishable_...`) or legacy anon key.
- `SUPABASE_SERVICE_ROLE_KEY`: secret key (`sb_secret_...`) or legacy service-role key. Backend only.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`: same Project URL and publishable/anon key, exposed to the browser.
- `VITE_API_BASE_URL`: leave blank for Windows/Termux same-origin mode. Set only when the frontend is hosted separately from the FastAPI server.

Never put the secret/service-role key in a `VITE_` variable, frontend code, GitHub, or Vercel's frontend environment variables. `.env` is ignored by Git.

## 3. Build and run

**Windows**

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
.\run-windows.bat
```

For devices on the same Wi-Fi network, use `run-lan.bat` and open the printed Network URL on the phone.

**Termux**

```bash
bash termux-setup.sh
bash termux-run.sh
```

## 4. Accounts and recovery codes

Choose **Create account** in REX. Usernames must be 3–24 characters and contain lowercase letters, numbers, or underscores. Passwords must be at least 8 characters. The recovery code is displayed once at account creation; save it somewhere private. Only a salted hash is stored. A successful recovery rotates the code and invalidates the old one.

## 5. Optional import of an old local library

The GitHub-ready source bundle deliberately does not include `data/liquid.db` because it can contain private listening history and playlists. Keep your own private backup of that database if you still need it.

After creating the target REX account, place your private database at `data/liquid.db`, run a dry run, review the counts, then confirm:

```bash
python backend/migrate_local_library.py --username YOUR_USERNAME
python backend/migrate_local_library.py --username YOUR_USERNAME --confirm
```

The importer does not delete or modify the SQLite source database.

## 6. Data isolation

Supabase stores profiles, playlists and playlist tracks, liked songs, play history, saved albums/artists/playlists, playback offsets, settings, search history, and recovery-code hashes. Ordinary library calls use the signed-in user's access token so Postgres Row Level Security scopes rows to that user. The backend service secret is used only for account administration and recovery-code records.

## 7. Hosting

For a public test, deploy the Vite frontend to Vercel and host the FastAPI + Node streaming backend at a separate public HTTPS service. Set `VITE_API_BASE_URL` to that backend URL during the Vercel build. Set `REX_CORS_ORIGINS` on the backend to the exact Vercel site origin (for example, `https://rex-preview.vercel.app`). The artwork proxy uses CORS-enabled image requests so album art remains usable by the visual player layers.

See [Vercel deployment](VERCEL-DEPLOYMENT.md) for the frontend steps. The current backend starts a local Node `@distube/ytdl-core` sidecar and streams audio; it needs a host/runtime that supports both processes and streaming. The Vercel frontend deployment alone does not host this backend.

The recovery attempt limiter in this initial build is in-memory. Before running multiple backend instances, replace it with a shared rate limiter. For public release, also configure monitoring, backups, HTTPS, and review music-source/distribution rights.
