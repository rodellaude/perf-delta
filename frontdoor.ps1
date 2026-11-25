###################################################
# frontdoor.ps1 - Legacy alias for register.ps1
###################################################
Write-Host "Note: 'frontdoor.ps1' has been replaced by 'register.ps1'. Forwarding..." -ForegroundColor DarkYellow
& (Join-Path $PSScriptRoot "register.ps1") @args
exit $LASTEXITCODE
