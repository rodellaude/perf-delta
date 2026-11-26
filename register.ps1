[CmdletBinding()]
param(
    [string]$rawResultsFolder = "",
    [string]$toolType = "jmeter"
)

###################################################
# register.ps1 - Perf-Delta Pure-Node.js Vault Registration CLI (Windows)
# Ingests JMeter or NeoLoad CSV results directly into Data/Performance_Vault.db
# using DuckDB's native C++ CSV reader and builds all 6 agg_* summary tables.
# Zero R dependency — requires only Node.js 20+ LTS.
###################################################
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$ApiDir = Join-Path $Root "dashboard-api"
$CliScript = Join-Path $ApiDir "register-cli.js"

# Refresh PATH so Node.js is found
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")
if (-not (Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path "C:\Program Files\nodejs\node.exe")) {
    $env:Path = "C:\Program Files\nodejs;$env:Path"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Node.js is not installed or not on PATH. Install Node.js 20+ LTS from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $ApiDir "node_modules"))) {
    Write-Host ">>> Installing Node.js dependencies (dashboard-api)..." -ForegroundColor Cyan
    Push-Location $ApiDir
    try { npm install } finally { Pop-Location }
}

$isInteractive = [string]::IsNullOrWhiteSpace($rawResultsFolder)
if ($isInteractive) {
    Write-Host "--- Perf-Delta - DuckDB Vault Registration (Node.js) ---" -ForegroundColor Cyan
    Write-Host "Select Tool Type:" -ForegroundColor Yellow
    Write-Host "1. JMeter (Default)"
    Write-Host "2. NeoLoad"
    while ($true) {
        $toolChoice = (Read-Host "Enter choice (1 or 2, or press Enter for default)").Trim()
        if ([string]::IsNullOrWhiteSpace($toolChoice) -or $toolChoice -eq "1") { $toolType = "jmeter"; break }
        if ($toolChoice -eq "2") { $toolType = "neoload"; break }
        Write-Host "Invalid choice! Enter 1, 2, or press Enter." -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "Required CSV Naming Convention in Target Folder:" -ForegroundColor Cyan
    Write-Host "<ProjectName>_<TestType>_<AppName>_<BuildId>_<Timestamp>.csv" -ForegroundColor DarkGray
    Write-Host "e.g., ECAN_PeakLoad_ECan-UAT_10008_20261126.csv" -ForegroundColor DarkGray
    Write-Host ""
    while ([string]::IsNullOrWhiteSpace($rawResultsFolder)) {
        $rawResultsFolder = (Read-Host "Enter FULL folder path containing CSV results").Trim().Trim('"')
        if ([string]::IsNullOrWhiteSpace($rawResultsFolder)) { Write-Host "Folder path is required!" -ForegroundColor Red }
    }
}

& node $CliScript "--folder=$rawResultsFolder" "--tool=$toolType"
exit $LASTEXITCODE
