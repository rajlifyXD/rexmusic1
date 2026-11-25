$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "`n[REX] Checking prerequisites..." -ForegroundColor Cyan
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "Python 3.11+ is required. Install it from https://www.python.org/downloads/windows/ and enable Add Python to PATH."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Supported Node.js (including npm) is required: 22.22.2+, 24.15.0+, or 26+. Install the LTS release from https://nodejs.org/ and reopen PowerShell."
}
$PyVersion = python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
$PyParts = $PyVersion.Split('.')
if ([int]$PyParts[0] -lt 3 -or ([int]$PyParts[0] -eq 3 -and [int]$PyParts[1] -lt 11)) {
  throw "Python 3.11+ is required. Detected Python $PyVersion"
}
$NodeVersion = [version](node -p "process.versions.node")
$NodeSupported = (
  ($NodeVersion.Major -eq 22 -and $NodeVersion -ge [version]"22.22.2") -or
  ($NodeVersion.Major -eq 24 -and $NodeVersion -ge [version]"24.15.0") -or
  ($NodeVersion.Major -ge 26)
)
if (-not $NodeSupported) {
  throw "The ytdl-core v5 engine requires Node.js 22.22.2+, 24.15.0+, or 26+. Detected Node.js $NodeVersion. Install a supported Node.js release and reopen PowerShell."
}

Write-Host "[REX] Installing frontend dependencies..." -ForegroundColor Cyan
Push-Location (Join-Path $Root "frontend")
npm install --include=optional --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "Frontend npm install failed." }
Write-Host "[REX] Building frontend..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
Pop-Location

Write-Host "[REX] Creating Python environment..." -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $Root ".venv\Scripts\python.exe"))) {
  python -m venv (Join-Path $Root ".venv")
}
& (Join-Path $Root ".venv\Scripts\python.exe") -m pip install --upgrade pip
& (Join-Path $Root ".venv\Scripts\python.exe") -m pip install -r (Join-Path $Root "backend\requirements-windows.txt")
if ($LASTEXITCODE -ne 0) { throw "Python dependency installation failed." }


Write-Host "`n[REX] Installing @distube/ytdl-core v5 streaming sidecar..." -ForegroundColor Cyan
Push-Location (Join-Path $Root "backend\ytdl-service")
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "ytdl-core installation failed." }
node --check server.mjs
if ($LASTEXITCODE -ne 0) { throw "ytdl-core server syntax check failed." }
node --input-type=module -e "import { Ytdl } from '@distube/ytdl-core'; if (typeof Ytdl !== 'function') throw new Error('Ytdl export is missing'); console.log('@distube/ytdl-core import: OK')"
if ($LASTEXITCODE -ne 0) { throw "ytdl-core import check failed." }
Pop-Location

Write-Host "`n[REX] Setup complete." -ForegroundColor Green
Write-Host "Run .\run-windows.bat to start REX." -ForegroundColor Green
Write-Host "Active engine: @distube/ytdl-core v5." -ForegroundColor Green
