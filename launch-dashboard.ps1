###################################################
# launch-dashboard.ps1 - Perf-Delta Modern Web App Launcher
# 1. Refreshes Windows PATH for newly installed Node.js
# 2. Starts Live DuckDB REST API (dashboard-api on :3001)
# 3. Starts Cyber-Slate React Dashboard (dashboard-ui on :5173)
###################################################
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$ApiDir = Join-Path $Root "dashboard-api"
$UiDir = Join-Path $Root "dashboard-ui"

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

if (-not (Test-Path (Join-Path $UiDir "node_modules"))) {
    Write-Host ">>> [2/3] Installing UI dependencies (dashboard-ui)..." -ForegroundColor Cyan
    Push-Location $UiDir
    try { npm install } finally { Pop-Location }
}

Write-Host ">>> [3/3] Starting Live DuckDB API (http://localhost:3001) + Cyber-Slate UI (http://localhost:5173)..." -ForegroundColor Green

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
