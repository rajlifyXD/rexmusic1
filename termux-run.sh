#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -x "$ROOT/.venv-termux/bin/python" ]]; then
  echo "REX is not installed yet. Run: bash '$ROOT/termux-setup.sh'" >&2
  exit 1
fi
if [[ ! -f "$ROOT/frontend/dist/index.html" ]]; then
  echo "REX frontend has not been built. Run: bash '$ROOT/termux-setup.sh'" >&2
  exit 1
fi
if [[ ! -d "$ROOT/backend/ytdl-service/node_modules/@distube/ytdl-core" ]]; then
  echo "The ytdl-core sidecar is not installed. Run: bash '$ROOT/termux-setup.sh'" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$ROOT/.venv-termux/bin/activate"
export PYTHONUNBUFFERED=1
cd "$ROOT/backend"
echo "[REX] Starting ytdl-core playback engine on local sidecar port 4181..."
exec python -m app.main --local
