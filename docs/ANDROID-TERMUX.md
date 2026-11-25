# Android / Termux

REX is a local web app, not a native APK. Termux runs FastAPI and the local Node.js `@distube/ytdl-core` v5 sidecar; Chrome opens `http://127.0.0.1:4173`.

## Requirements

- Termux from F-Droid or official GitHub releases
- Android ARM64 (`aarch64`) recommended
- Python 3.14 for the supplied Android-native `pydantic-core` wheel
- Node.js 22.22.2+, 24.15.0+, or 26+ for `@distube/ytdl-core` v5

## Fresh installation

Run `bash termux-setup.sh` from the project root. The installer installs Node.js, frontend dependencies, the ytdl-core sidecar, the Python environment and backend packages. It checks the Node sidecar import and FastAPI app import. It verifies the Node sidecar package directly and does not load browser-only modules in Node.

## Launch

```bash
bash termux-run.sh
```

Open `http://127.0.0.1:4173` in Chrome. Keep Termux running and set its battery usage to Unrestricted.

## Troubleshooting

- If `pkg` cannot find packages, run `pkg update -y && pkg upgrade -y`.
- If Python is not 3.14, update/reinstall Termux Python before setup; the supplied pydantic-core wheel must match the Python ABI.
- If Node.js does not meet ytdl-core's supported version range, update Termux and reinstall `nodejs-lts`.
- If npm install fails, check the network and rerun `bash termux-setup.sh`.
- If the sidecar is not ready, rerun setup and check the setup output for the installation error.
- YouTube can still deny direct extraction or rate-limit requests. REX does not use user cookies or bypass verification.
