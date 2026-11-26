[CmdletBinding()]
param(
    [switch]$IncludeVault
)

###################################################
# package-offline.ps1 - Perf-Delta Air-Gapped / Offline Bundle Packager (Windows x64)
# Optional fallback tool for deploying Perf-Delta onto restricted corporate machines
# that have NO access to npmjs.org or an internal corporate npm mirror.
#
# Creates: dist-offline/perf-delta-offline-win-x64.zip
# Includes: dashboard-api (+ node_modules), dashboard-ui/dist (with bundled fonts),
#           config.yaml, SLA/, launch-dashboard.ps1, launch-dashboard.sh, register.ps1, README.md
# Excludes: secrets.yaml, RawResults/, Reports/, dashboard-ui/node_modules/
###################################################
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$ApiDir = Join-Path $Root "dashboard-api"
$UiDir = Join-Path $Root "dashboard-ui"
$OutDir = Join-Path $Root "dist-offline"
$StageDir = Join-Path $OutDir "stage"
$ZipPath = Join-Path $OutDir "perf-delta-offline-win-x64.zip"

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")
if (-not (Get-Command npm -ErrorAction SilentlyContinue) -and (Test-Path "C:\Program Files\nodejs\npm.cmd")) {
    $env:Path = "C:\Program Files\nodejs;$env:Path"
}

Write-Host ">>> [1/3] Ensuring API dependencies & production UI bundle are built..." -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $ApiDir "node_modules"))) {
    Push-Location $ApiDir
    try { npm install } finally { Pop-Location }
}
Push-Location $UiDir
try {
    if (-not (Test-Path (Join-Path $UiDir "node_modules"))) { npm install }
    npm run build
} finally {
    Pop-Location
}

Write-Host ">>> [2/3] Staging offline bundle (excluding secrets.yaml & raw CSVs)..." -ForegroundColor Cyan
if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null

# Top-level files
foreach ($f in @("config.yaml", "launch-dashboard.ps1", "launch-dashboard.sh", "register.ps1", "README.md")) {
    $src = Join-Path $Root $f
    if (Test-Path $src) { Copy-Item $src -Destination $StageDir }
}

# SLA folder
if (Test-Path (Join-Path $Root "SLA")) {
    Copy-Item (Join-Path $Root "SLA") -Destination (Join-Path $StageDir "SLA") -Recurse
}

# dashboard-api (including node_modules for native DuckDB)
Copy-Item $ApiDir -Destination (Join-Path $StageDir "dashboard-api") -Recurse

# dashboard-ui/dist ONLY (no dashboard-ui/node_modules needed at runtime)
New-Item -ItemType Directory -Path (Join-Path $StageDir "dashboard-ui") -Force | Out-Null
Copy-Item (Join-Path $UiDir "dist") -Destination (Join-Path $StageDir "dashboard-ui\dist") -Recurse

# Data folder (empty by default unless -IncludeVault is passed)
New-Item -ItemType Directory -Path (Join-Path $StageDir "Data") -Force | Out-Null
if ($IncludeVault -and (Test-Path (Join-Path $Root "Data\Performance_Vault.db"))) {
    Copy-Item (Join-Path $Root "Data\Performance_Vault.db") -Destination (Join-Path $StageDir "Data\Performance_Vault.db")
}

Write-Host ">>> [3/3] Creating zip archive: $ZipPath" -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $StageDir "*") -DestinationPath $ZipPath -CompressionLevel Optimal
Remove-Item $StageDir -Recurse -Force

$sizeMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
Write-Host ">>> [SUCCESS] Offline bundle ready: $ZipPath ($sizeMb MB)" -ForegroundColor Green
Write-Host ">>> Copy to target Windows x64 machine, unzip, and run .\launch-dashboard.ps1 (zero internet required)." -ForegroundColor DarkGray
