[CmdletBinding()]
param(
    [int]$Port = 8080,
    [switch]$Rebuild,
    [switch]$Dev
)

###################################################
# launch-dashboard.ps1 - Perf-Delta Single-Port Web Server Launcher
# Default (Single-Port LAN Mode):
#   - Serves both the React UI (dashboard-ui/dist) and DuckDB REST API on ONE port (default :8080)
#   - Binds to 0.0.0.0 so teammates & read-only clients can access http://<your-IP>:8080
# Optional flags:
#   -Port 8080   Change listening port
#   -Rebuild     Force rebuild of dashboard-ui before starting
#   -Dev         Run 2-port Vite HMR dev mode (:5173 + :8080)
###################################################
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$ApiDir = Join-Path $Root "dashboard-api"
$UiDir = Join-Path $Root "dashboard-ui"
$DistIndex = Join-Path $UiDir "dist\index.html"

# Refresh PATH from Machine + User environment so newly installed Node.js is found
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")
if (-not (Get-Command npm -ErrorAction SilentlyContinue) -and (Test-Path "C:\Program Files\nodejs\npm.cmd")) {
    $env:Path = "C:\Program Files\nodejs;$env:Path"
}

$NpmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $NpmCmd) {
    Write-Host "ERROR: Node.js (npm) is not installed or not on PATH." -ForegroundColor Red
    Write-Host "Install Node.js LTS from https://nodejs.org/ and re-run .\launch-dashboard.ps1" -ForegroundColor Yellow
    exit 1
}

# Install dependencies if needed
if (-not (Test-Path (Join-Path $ApiDir "node_modules"))) {
    Write-Host ">>> [1/3] Installing API dependencies (dashboard-api)..." -ForegroundColor Cyan
    Push-Location $ApiDir
    try { npm install } finally { Pop-Location }
}

if (($Dev -or $Rebuild -or -not (Test-Path $DistIndex)) -and -not (Test-Path (Join-Path $UiDir "node_modules"))) {
    Write-Host ">>> [2/3] Installing UI dependencies (dashboard-ui)..." -ForegroundColor Cyan
    Push-Location $UiDir
    try { npm install } finally { Pop-Location }
}

$env:DASHBOARD_API_PORT = "$Port"
$env:DASHBOARD_HOST = "0.0.0.0"

if ($Dev) {
    Write-Host ">>> [DEV] Starting 2-port HMR mode: API (:$Port) + Vite UI (:5173)..." -ForegroundColor Yellow
    $apiProc = Start-Process -FilePath "node" -ArgumentList "--watch", "server.js" -WorkingDirectory $ApiDir -PassThru -NoNewWindow
    Push-Location $UiDir
    try {
        npm run dev
    } finally {
        Pop-Location
        if ($apiProc -and -not $apiProc.HasExited) {
            Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
        }
    }
    exit 0
}

# Single-Port Mode: build UI if missing or -Rebuild requested
if ($Rebuild -or -not (Test-Path $DistIndex)) {
    Write-Host ">>> Building production UI bundle (dashboard-ui/dist)..." -ForegroundColor Cyan
    Push-Location $UiDir
    try { npm run build } finally { Pop-Location }
}

Write-Host ">>> Starting Perf-Delta Single-Port Server on http://localhost:$Port (LAN-accessible)..." -ForegroundColor Green
Push-Location $ApiDir
try {
    node --watch server.js
} finally {
    Pop-Location
}
