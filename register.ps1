[CmdletBinding()]
param(
    [string]$opMode = "",
    [string]$rawResultsFolder = "NONE",
    [string]$toolType = "jmeter",
    [string]$current = "",
    [string]$base = "NONE",
    [string]$labelFilter = "NONE",
    [string]$outputFolder = "NONE",
    [switch]$ci,
    [switch]$failOnSla,
    [switch]$nonInteractive
)

###################################################
# register.ps1 - Perf-Delta Vault Registration & CLI Launcher (Windows)
# Default interactive mode registers CSV test results into Data/Performance_Vault.db
# and pre-computes agg_* summary tables for instant Live Web Dashboard queries.
# Also supports optional static HTML report generation & headless CI mode.
###################################################
$RScript = Join-Path $PSScriptRoot ".engine\engine.R"
$isInteractive = ($PSBoundParameters.Count -eq 0 -and -not $nonInteractive)

# Dynamically find latest installed 64-bit Rscript.exe
$RBase = "C:\Program Files\R"
if (Test-Path $RBase) {
  $RScriptExePath = Get-ChildItem -Path $RBase -Recurse -Filter "Rscript.exe" |
    Where-Object { $_.FullName -like "*\x64\*" } |
    Sort-Object { $_.FullName } -Descending |
    Select-Object -First 1 -ExpandProperty FullName
} else {
  $RCmd = Get-Command Rscript -ErrorAction SilentlyContinue
  $RScriptExePath = if ($RCmd) { $RCmd.Source } else { $null }
}

if ([string]::IsNullOrWhiteSpace($RScriptExePath) -or !(Test-Path $RScriptExePath)) {
  Write-Host "ERROR: Rscript.exe not found. Please install R from https://cran.r-project.org/" -ForegroundColor Red
  if ($isInteractive) {
    Write-Host "Press any key to exit..."
    [void][System.Console]::ReadKey($true)
  }
  exit 1
}

Write-Host "Using R: $RScriptExePath" -ForegroundColor DarkGray

if ($isInteractive) {
    Write-Host "--- Perf-Delta - Vault Registration & Report Engine ---" -ForegroundColor Cyan
    Write-Host "Operations:" -ForegroundColor Yellow
    Write-Host "1. Register Data (Save CSVs + Pre-Aggregated Tables to DuckDB Vault) [Default]"
    Write-Host "2. Generate Static HTML Report (Legacy / Offline Export)"

    $choice = ""
    while ($true) {
        $inputChoice = (Read-Host "Select operation [1 or 2, or press Enter for default]").Trim()
        if ([string]::IsNullOrWhiteSpace($inputChoice)) { $choice = "1"; break }
        if ($inputChoice -match "^[1-2]$") { $choice = $inputChoice; break }
        Write-Host "Invalid choice! Please enter 1, 2, or press Enter." -ForegroundColor Red
    }

    $rawResultsFolder = "NONE"
    $currentRun       = "NONE"
    $baseRun          = "NONE"
    $toolType         = "jmeter"
    $labelFilter      = "NONE"

    if ($choice -eq "1") {
        $opMode = "register"
        Write-Host "`nSelect Tool Type:" -ForegroundColor Yellow
        Write-Host "1. JMeter (Default)"
        Write-Host "2. NeoLoad"
        while ($true) {
            $toolChoice = (Read-Host "Enter choice (1 or 2, or press Enter for default)").Trim()
            if ([string]::IsNullOrWhiteSpace($toolChoice) -or $toolChoice -eq "1") { $toolType = "jmeter"; break }
            if ($toolChoice -eq "2") { $toolType = "neoload"; break }
            Write-Host "Invalid choice! Please enter 1, 2, or press Enter." -ForegroundColor Red
        }
        while ([string]::IsNullOrWhiteSpace($rawResultsFolder) -or $rawResultsFolder -eq "NONE") {
            Write-Host ""
            Write-Host "Required CSV Naming Convention in Target Folder:" -ForegroundColor Cyan
            Write-Host "<ProjectName>_<TestType>_<AppName>_<BuildId>_<Timestamp>.csv" -ForegroundColor DarkGray
            Write-Host "e.g., ECAN_PeakLoad_ECan-UAT_10007_20261119.csv" -ForegroundColor DarkGray
            Write-Host ""
            $rawResultsFolder = Read-Host "Enter FULL folder path containing CSV results"
            if ([string]::IsNullOrWhiteSpace($rawResultsFolder)) { Write-Host "Full path is required!" -ForegroundColor Red }
        }
    } else {
        $opMode = "report"
        & $RScriptExePath --vanilla $RScript "--opMode=menu"
        Write-Host "`nReport Run Selection (Current and Base):" -ForegroundColor Yellow
        $inputCurrent = ""
        while ([string]::IsNullOrWhiteSpace($inputCurrent)) {
            $inputCurrent = (Read-Host "1. Enter CURRENT Run ID or Sequence Number (Required)").Trim()
            if ([string]::IsNullOrWhiteSpace($inputCurrent)) { Write-Host "Current Run ID is required." -ForegroundColor Red }
        }
        $inputBase = (Read-Host "2. Enter BASELINE Run ID or Sequence Number (Optional, press Enter for standalone)").Trim()
        $currentRun = $inputCurrent
        $baseRun    = if (-not [string]::IsNullOrWhiteSpace($inputBase)) { $inputBase } else { "NONE" }
        $inputFilter = (Read-Host "Enter transaction label filter pattern or press Enter for all").Trim()
        if (-not [string]::IsNullOrWhiteSpace($inputFilter)) { $labelFilter = $inputFilter }
    }
} else {
    if ([string]::IsNullOrWhiteSpace($opMode)) {
        $opMode = if ($rawResultsFolder -ne "NONE") { "register" } else { "report" }
    }
    $currentRun = if ([string]::IsNullOrWhiteSpace($current)) { "NONE" } else { $current }
    $baseRun    = $base
}

Write-Output "`nLaunching Perf-Delta Engine ($opMode)..."
$rArgs = @("--vanilla", $RScript, "--opMode=$opMode")

if ($opMode -eq "register") {
    $rArgs += "--rawResultsFolder=$rawResultsFolder"
    $rArgs += "--active_tool=$toolType"
} else {
    $rArgs += "--current=$currentRun"
    $rArgs += "--base=$baseRun"
    $rArgs += "--active_tool=$toolType"
    $rArgs += "--labelFilterParam=$labelFilter"
}

if ($outputFolder -ne "NONE") { $rArgs += "--outputFolder=$outputFolder" }
if ($ci -or $failOnSla) { $rArgs += "--ci" }

& $RScriptExePath $rArgs
$rExitCode = $LASTEXITCODE

if ($isInteractive) {
    Write-Output "`nProcess complete. Press any key to exit..."
    [void][System.Console]::ReadKey($true)
} else {
    exit $rExitCode
}
