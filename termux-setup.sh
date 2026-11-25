#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TUR_PYPI_INDEX="https://termux-user-repository.github.io/pypi/"
REQUIRED_PYTHON="3.14"

fail() { printf '\n[REX SETUP ERROR] %s\n' "$*" >&2; exit 1; }
info() { printf '\n\033[1;36m[REX]\033[0m %s\n' "$*"; }

if ! command -v pkg >/dev/null 2>&1; then
  fail "This setup must run inside the Termux app on Android."
fi

cd "$ROOT"
info "Updating Termux packages..."
pkg update -y
pkg upgrade -y
pkg install -y python python-pip unzip

info "Installing Node.js (required for the ytdl-core streaming sidecar)..."
if ! pkg install -y nodejs-lts; then
  info "nodejs-lts is unavailable in this repository; trying nodejs."
  pkg install -y nodejs
fi

command -v python >/dev/null 2>&1 || fail "Python was not installed. Try: pkg install python python-pip"
command -v npm >/dev/null 2>&1 || fail "npm is missing. Try: pkg install nodejs-lts"
command -v node >/dev/null 2>&1 || fail "Node.js is missing. Try: pkg install nodejs-lts"

PY_VERSION="$(python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [[ "$PY_VERSION" != "$REQUIRED_PYTHON" ]]; then
  cat >&2 <<MSG

REX's Android backend currently needs Termux Python $REQUIRED_PYTHON.
This project uses the Android ARM64 pydantic-core wheel for that Python ABI.
Detected Python: $PY_VERSION

Try updating Termux completely:
  pkg update -y && pkg upgrade -y
  pkg reinstall python python-pip
  python --version
Then run this setup again.
MSG
  exit 2
fi

NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
IFS='.' read -r NODE_MAJOR NODE_MINOR NODE_PATCH <<< "$NODE_VERSION"
NODE_MAJOR="${NODE_MAJOR:-0}"; NODE_MINOR="${NODE_MINOR:-0}"; NODE_PATCH="${NODE_PATCH:-0}"
NODE_SUPPORTED=false
if [[ "$NODE_MAJOR" =~ ^[0-9]+$ && "$NODE_MINOR" =~ ^[0-9]+$ && "$NODE_PATCH" =~ ^[0-9]+$ ]]; then
  if (( NODE_MAJOR == 22 && (NODE_MINOR > 22 || (NODE_MINOR == 22 && NODE_PATCH >= 2)) )); then NODE_SUPPORTED=true; fi
  if (( NODE_MAJOR == 24 && (NODE_MINOR > 15 || (NODE_MINOR == 15 && NODE_PATCH >= 0)) )); then NODE_SUPPORTED=true; fi
  if (( NODE_MAJOR >= 26 )); then NODE_SUPPORTED=true; fi
fi
[[ "$NODE_SUPPORTED" == true ]] || fail "@distube/ytdl-core v5 requires Node 22.22.2+, 24.15.0+, or 26+. Detected: ${NODE_VERSION:-unavailable}. Update Termux and install nodejs-lts."

if [[ "$(uname -m)" != "aarch64" ]]; then
  info "Detected architecture $(uname -m). This project is primarily tested for Android ARM64 (aarch64)."
fi
info "Runtime versions: Python $(python --version 2>&1), Node v$NODE_VERSION"

info "Installing REX frontend dependencies..."
cd "$ROOT/frontend"
npm install --include=optional --no-audit --no-fund

info "Building the REX frontend..."
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}" npm run build
[[ -f "$ROOT/frontend/dist/index.html" ]] || fail "Frontend build did not create frontend/dist/index.html"

info "Installing @distube/ytdl-core v5 streaming sidecar..."
cd "$ROOT/backend/ytdl-service"
npm install --no-audit --no-fund
node --check server.mjs
node --input-type=module -e "import { Ytdl } from '@distube/ytdl-core'; if (typeof Ytdl !== 'function') throw new Error('Ytdl export is missing'); console.log('@distube/ytdl-core import: OK')"

info "Creating a fresh isolated Python environment..."
cd "$ROOT"
rm -rf "$ROOT/.venv-termux"
python -m venv --system-site-packages "$ROOT/.venv-termux"
# shellcheck disable=SC1091
source "$ROOT/.venv-termux/bin/activate"
python -m pip install --upgrade pip

info "Installing the Android-native pydantic-core wheel..."
python -m pip install --no-cache-dir --only-binary=pydantic-core \
  --extra-index-url "$TUR_PYPI_INDEX" \
  "pydantic-core==2.50.4"

info "Installing REX backend dependencies..."
python -m pip install --no-cache-dir --only-binary=pydantic-core \
  --extra-index-url "$TUR_PYPI_INDEX" \
  -r "$ROOT/backend/requirements-termux.txt"

info "Checking Python backend imports..."
python -c 'import fastapi, httpx, pydantic, pydantic_core, uvicorn, ytmusicapi; print("FastAPI:", fastapi.__version__); print("Pydantic:", pydantic.__version__); print("pydantic-core:", pydantic_core.__version__); print("Uvicorn:", uvicorn.__version__); print("HTTPX:", httpx.__version__); print("ytmusicapi:", getattr(ytmusicapi, "__version__", "installed"))'
cd "$ROOT/backend"
python -c 'from app.main import app; print("FastAPI app import: OK")'

cat <<MSG

============================================================
 REX ytdl-core edition is installed on this Android phone.
============================================================

Active playback engine:
  @distube/ytdl-core v5 (Node.js sidecar)

Start REX:
  cd "$ROOT"
  bash termux-run.sh

Open Chrome:
  http://127.0.0.1:4173

Keep Termux open while listening. Set Android Settings > Apps >
Termux > Battery > Unrestricted to reduce background shutdowns.
Press CTRL+C in Termux to stop the server.
MSG
