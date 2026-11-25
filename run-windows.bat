@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo REX is not installed. Right-click setup-windows.ps1 and run with PowerShell,
  echo or open PowerShell here and run: powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
  pause
  exit /b 1
)
if not exist "frontend\dist\index.html" (
  echo Frontend is not built. Run setup-windows.ps1 first.
  pause
  exit /b 1
)
if not exist "backend\ytdl-service\node_modules\@distube\ytdl-core" (
  echo ytdl-core dependencies are missing. Run setup-windows.ps1 first.
  pause
  exit /b 1
)
cd /d "%~dp0backend"
"%~dp0.venv\Scripts\python.exe" -m app.main
pause
