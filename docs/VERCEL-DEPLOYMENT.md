# REX test deployment: frontend and backend on Vercel

REX can be test-deployed as **two Vercel projects from the same GitHub repository**:

1. `frontend/` — Vite/React web app.
2. `backend/` — FastAPI API plus a Node.js Vercel Function for `@distube/ytdl-core` audio streaming.

The normal Windows and Termux setup is unchanged. Locally, FastAPI still starts the Node sidecar in `backend/ytdl-service/`. On Vercel, FastAPI skips that persistent child process; Vercel routes `/api/stream/:video_id` to `backend/api/ytdl.js` instead.

## 1. Deploy the backend project first

In Vercel choose **Add New → Project**, import the REX GitHub repository, and configure:

| Setting | Value |
|---|---|
| Project name | `rex-api` (or your choice) |
| Root Directory | `backend` |
| Framework Preset | FastAPI (automatic detection is also supported) |
| Build Command | Leave the detected/default command |
| Output Directory | Leave default / blank |
| Install Command | Leave the detected/default command |

The backend root contains `main.py` for FastAPI, `requirements.txt` for Python packages, `package.json` + `package-lock.json` for the Node streaming function, and `vercel.json` for the streaming rewrite.

Add these **backend-only** Environment Variables for Preview and Production:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase Project URL |
| `SUPABASE_ANON_KEY` | Your `sb_publishable_...` key (or legacy anon key) |
| `SUPABASE_SERVICE_ROLE_KEY` | Your `sb_secret_...` key (or legacy service-role key) |
| `REX_CORS_ORIGINS` | Exact frontend origin, e.g. `https://rex-web.vercel.app` |
| `LIQUID_DB` | `/tmp/rex/liquid.db` (ephemeral health-check database only) |
| `PO_TOKEN_PROVIDER_URL` | Optional; defaults to the Yozora-style provider `https://poptox.onrender.com` |
| `PO_TOKEN_API_KEY` | Optional API key for that PO-token provider |

Do **not** add the Supabase secret/service-role key to the frontend project. The backend's FastAPI app reads the Vercel environment variables directly. On Vercel, the local SQLite path is `/tmp`; the per-user libraries remain in Supabase and are not stored in this temporary database. The `PO_TOKEN_API_KEY`, when needed, must remain backend-only.

Deploy the backend and copy its HTTPS domain, for example `https://rex-api.vercel.app`.

## 2. Deploy the frontend project

Create another Vercel project from the same GitHub repository:

| Setting | Value |
|---|---|
| Project name | `rex-web` (or your choice) |
| Root Directory | `frontend` |
| Framework Preset | Vite |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

Add these frontend Environment Variables for Preview and Production:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Your `sb_publishable_...` key (or legacy anon key) |
| `VITE_API_BASE_URL` | Backend HTTPS origin, e.g. `https://rex-api.vercel.app` (no trailing slash) |

Redeploy after adding variables. Then copy the frontend's production origin and set that exact origin in the backend's `REX_CORS_ORIGINS`, then redeploy the backend if you changed it. For preview URLs, add the required preview origin(s) to `REX_CORS_ORIGINS` or configure a carefully scoped `REX_CORS_ORIGIN_REGEX` on the backend.

## 3. Streaming notes for the Vercel test

The audio stream is a Node.js Vercel Function and uses HTTP byte-range requests for seeking. The backend project's `vercel.json` sets the stream function to 300 seconds, which fits the Vercel Hobby function duration ceiling. On Hobby, a song/stream lasting longer than the function duration can be cut off. Vercel documents longer maximum durations on eligible Pro/Enterprise Fluid Compute plans; increase `maxDuration` in `backend/vercel.json` only when the account plan permits it.

The experimental WASM resolver adds `backend/api/potoken.js` as a separate Node Function. It fetches short-lived Proof-of-Origin token material from the configured provider for the client-side yt-dlp-wasm extractor; it does not stream audio and does not receive account cookies. For its Preview CORS response, the backend's `REX_CORS_ORIGINS` must include the exact frontend preview origin.

This makes Vercel suitable for a **test host**, but not a guarantee of uninterrupted long-form music streaming on the free/Hobby plan. YouTube may also rate-limit or change the upstream formats independently of Vercel. Check `/api/health` on the backend domain; it reports the serverless stream function as ready when running on Vercel.

## 4. What goes where

- Frontend Vercel project: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`.
- Backend Vercel project: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REX_CORS_ORIGINS`, `LIQUID_DB`.
- Supabase: existing Auth and database tables/policies. No schema rerun is needed if the existing REX schema and security patch are already installed.

Never commit `.env`, a Supabase secret key, or a local SQLite database to GitHub.
