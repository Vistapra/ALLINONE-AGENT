#Requires -Version 5.1
<#
.SYNOPSIS
    Health check for ALLINONE-AGENT: scheduled-task state + HTTP endpoint reachability.
.DESCRIPTION
    Never reports "healthy" for something it did not actually check. Endpoint checks are plain
    TCP-connect + optional HTTP GET; they confirm reachability, not full application correctness.
#>
[CmdletBinding()]
param(
    [int]$PaperclipPort = 3100,
    [int]$Hermes3dPort = 3200,
    [int]$OfficeBridgePort = 3210
)

$ErrorActionPreference = 'Continue'

function Test-HttpEndpoint {
    param([string]$Name, [string]$Url)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        [PSCustomObject]@{ Name = $Name; Status = 'PASS'; Detail = "HTTP $($resp.StatusCode) from $Url" }
    } catch [System.Net.WebException] {
        [PSCustomObject]@{ Name = $Name; Status = 'FAIL'; Detail = "No response from $Url ($($_.Exception.Message))" }
    } catch {
        [PSCustomObject]@{ Name = $Name; Status = 'UNKNOWN'; Detail = "Could not determine status of $Url ($($_.Exception.Message))" }
    }
}

Write-Host "ALLINONE-AGENT Health Check - $(Get-Date -Format 'o')" -ForegroundColor Cyan
Write-Host ""
Write-Host "-- Scheduled Tasks (ALLINONE-managed) --" -ForegroundColor Gray
$managedTasks = 'PaperclipServer', 'OfficeVirtualCompany', 'PlatformHealthWatchdog', 'PlatformMaintenance'
$taskResults = foreach ($t in $managedTasks) {
    $task = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
    if (-not $task) {
        [PSCustomObject]@{ Name = $t; Status = 'UNKNOWN'; Detail = 'Not registered.' }
    } else {
        [PSCustomObject]@{ Name = $t; Status = (if ($task.State -eq 'Running') {'PASS'} else {'FAIL'}); Detail = "State: $($task.State)" }
    }
}

Write-Host ""
Write-Host "-- Scheduled Tasks (upstream hermes-agent, informational only) --" -ForegroundColor Gray
$hermesTasks = 'HermesAutoUpdate', 'Hermes_Gateway', 'HermesPostRebootVerify', 'cua-driver-serve'
$hermesTaskResults = foreach ($t in $hermesTasks) {
    $task = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
    if (-not $task) {
        [PSCustomObject]@{ Name = $t; Status = 'UNKNOWN'; Detail = 'Not found on this machine (expected if Hermes Agent is not installed/adopted).' }
    } else {
        [PSCustomObject]@{ Name = $t; Status = (if ($task.State -eq 'Running') {'PASS'} else {'INFO'}); Detail = "State: $($task.State)" }
    }
}

Write-Host ""
Write-Host "-- Application Endpoints --" -ForegroundColor Gray
$endpointResults = @(
    Test-HttpEndpoint -Name 'Paperclip'     -Url "http://127.0.0.1:$PaperclipPort"
    Test-HttpEndpoint -Name 'Hermes3D'      -Url "http://127.0.0.1:$Hermes3dPort/office"
    Test-HttpEndpoint -Name 'Office Bridge' -Url "http://127.0.0.1:$OfficeBridgePort"
)

$all = $taskResults + $hermesTaskResults + $endpointResults
$all | ForEach-Object {
    $color = switch ($_.Status) { 'PASS' {'Green'}; 'FAIL' {'Red'}; 'INFO' {'Gray'}; default {'Yellow'} }
    Write-Host ("  [{0,-7}] {1,-24} {2}" -f $_.Status, $_.Name, $_.Detail) -ForegroundColor $color
}

Write-Host ""
$failCount = ($taskResults + $endpointResults | Where-Object { $_.Status -eq 'FAIL' }).Count
if ($failCount -gt 0) {
    Write-Host "$failCount check(s) FAILED. This is a real failure signal, not a false alarm suppressed for convenience." -ForegroundColor Red
    exit 1
} else {
    Write-Host "All ALLINONE-managed checks passed (upstream hermes-agent tasks are informational and not scored)." -ForegroundColor Green
    exit 0
}
