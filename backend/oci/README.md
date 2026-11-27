# Oracle Cloud backend (staged migration)

This directory prepares the existing REX FastAPI + Node streaming sidecar for a persistent Ubuntu VM. It does not create an OCI instance, change Vercel, or switch the production frontend.

## Runtime layout

- FastAPI: Uvicorn on `127.0.0.1:4173`.
- Node streaming sidecar: started by the existing FastAPI startup hook on `127.0.0.1:4181`.
- Persistent SQLite compatibility data: `/opt/rex/shared/data/liquid.db`.
- Environment file: `/opt/rex/shared/.env` (never commit it).
- systemd unit: `rex-api.service`.

FastAPI already owns the API routes, CORS policy, and streaming proxy. The OCI adapter is the systemd runtime plus the hardened Node sidecar; no duplicate API implementation is introduced.

## VM prerequisites (manual, once)

Use an eligible Always Free VM only after confirming the OCI console shows the resources as Always Free. This workflow does not provision infrastructure and must not be used to create paid resources.

On Ubuntu 24.04 ARM64, install:
- Python 3.11 or newer and `python3-venv`
- Node.js 22.22.2+, 24.15.0+, or 26+
- systemd and curl (normally present)

Create the service account and directories:

```bash
sudo useradd --system --create-home --home-dir /opt/rex --shell /usr/sbin/nologin rex
sudo mkdir -p /opt/rex/releases /opt/rex/shared/data
sudo chown -R rex:rex /opt/rex
```

Create `/opt/rex/shared/.env` with the backend's existing Supabase settings and optional `YT_COOKIE` / `REX_CORS_ORIGINS`. Restrict it:

```bash
sudo chown rex:rex /opt/rex/shared/.env
sudo chmod 600 /opt/rex/shared/.env
```

Never commit `.env` or paste secrets into GitHub files or workflow YAML. `LIQUID_DB` is managed by systemd; user libraries remain in Supabase.

## GitHub Actions configuration

Add these repository **Actions secrets** only after the VM is provisioned and SSH access is secured:

- `OCI_HOST`: VM public IP or DNS name.
- `OCI_USER`: SSH user (usually `ubuntu`).
- `OCI_SSH_KEY`: private deployment key. Never commit or paste it into chat.
- `OCI_KNOWN_HOSTS`: verified SSH host-key line for the VM.

Add repository **Actions variable** `OCI_DEPLOY_ENABLED=true` to enable push deployments. Until that variable is set, pushes run CI only and do not contact a server.

The workflow deploys only this migration branch. It uploads a clean source archive, installs Python and Node dependencies, updates the `current` symlink, restarts systemd, and checks the local health endpoint. If health validation fails, it restores the previous release and restarts the service.

## Public HTTPS endpoint is a separate final step

The application binds only to loopback. Before pointing the Vercel frontend at this backend, configure a domain, DNS, TLS reverse proxy (Caddy or Nginx), OCI ingress rules for 80/443, and the exact frontend origin in `REX_CORS_ORIGINS`. Keep SSH restricted to your own IP. Do not expose ports 4173 or 4181 publicly.

Only after the public HTTPS endpoint passes health, CORS, auth, catalog, artwork, and real audio Range/seek tests should `VITE_API_BASE_URL` be changed in a Vercel Preview deployment. Keep the existing production backend and frontend unchanged until the migration is explicitly approved.

## Operational notes

- The existing FastAPI startup hook starts the Node sidecar. systemd restarts the whole service if the main process exits.
- The sidecar binds to loopback only and supports byte ranges; it streams chunks rather than buffering whole tracks.
- The OCI sidecar now reads the optional `YT_COOKIE` environment variable and applies the same narrowly scoped TV-player JavaScript rewrite as the Vercel function.
- YouTube extraction is unofficial and can fail independently due to upstream challenges, rate limits, cookies, or format changes. This adapter does not guarantee availability or lossless audio.
- Monitor Oracle Always Free eligibility, resource quotas, bandwidth, and account billing. A free-tier label alone does not guarantee every resource configuration is free.
