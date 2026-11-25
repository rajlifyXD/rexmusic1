@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo REX is not installed. Run setup-windows.ps1 first.
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

if not defined LIQUID_PORT set "LIQUID_PORT=4173"

for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$r=Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric,InterfaceMetric | Select-Object -First 1; if($r){Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $r.InterfaceIndex -ErrorAction SilentlyContinue | Where-Object {$_.IPAddress -notlike '169.254.*'} | Select-Object -First 1 -ExpandProperty IPAddress}"`) do set "LAN_IP=%%I"

echo.
echo ==========================================
echo          REX - WINDOWS LAN MODE
echo ==========================================
echo.
echo Local:   http://127.0.0.1:%LIQUID_PORT%
if defined LAN_IP (
  echo Network: http://%LAN_IP%:%LIQUID_PORT%
) else (
  echo Network IP could not be detected automatically.
  echo Run ipconfig and use your Wi-Fi IPv4 Address.
)
echo.
echo Open the Network URL on another device connected
echo to the SAME Wi-Fi network.
echo.
echo If Windows Firewall asks, allow Python on PRIVATE
echo networks. Do not enable Public network access.
echo If no prompt appears and other devices cannot connect,
echo allow inbound TCP port %LIQUID_PORT% on Private networks.
echo.
echo Press Ctrl+C in this window to stop REX.
echo ==========================================
echo.

cd /d "%~dp0backend"
"%~dp0.venv\Scripts\python.exe" -m app.main
pause
