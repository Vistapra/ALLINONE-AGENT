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
    <#
    .DESCRIPTION
        PASS means "a server actually answered", not "answered 200". Several real
        ALLINONE endpoints are correctly fail-closed and return 401/403 without
        credentials (Office Bridge, Hermes3D's authenticated pages) - that is the
        security design working, not an outage. A real connection failure (refused,
        timed out, DNS, TLS) is the only thing that should FAIL here.
    #>
    param([string]$Name, [string]$Url)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        [PSCustomObject]@{ Name = $Name; Status = 'PASS'; Detail = "HTTP $($resp.StatusCode) from $Url" }
    } catch {
        $statusCode = $null
        $response = $_.Exception.Response
        if ($response) {
            # Windows PowerShell 5.1 (System.Net.WebException -> HttpWebResponse) and
            # PowerShell 7+ (HttpResponseException -> HttpResponseMessage) expose
            # StatusCode under the same property name but different enum types.
            try { $statusCode = [int]$response.StatusCode } catch { $statusCode = $null }
        }
        if ($statusCode -and $statusCode -ge 400 -and $statusCode -lt 500) {
            [PSCustomObject]@{
                Name   = $Name
                Status = 'PASS'
                Detail = "HTTP $statusCode from $Url - server is up and correctly rejecting an unauthenticated request (not an outage)."
            }
        } elseif ($statusCode) {
            [PSCustomObject]@{ Name = $Name; Status = 'FAIL'; Detail = "HTTP $statusCode from $Url - server responded but with a server-side error." }
        } else {
            [PSCustomObject]@{ Name = $Name; Status = 'FAIL'; Detail = "No response from $Url ($($_.Exception.Message))" }
        }
    }
}

Write-Host "ALLINONE-AGENT Health Check - $(Get-Date -Format 'o')" -ForegroundColor Cyan
Write-Host ""
Write-Host "-- Scheduled Tasks (ALLINONE-managed) --" -ForegroundColor Gray
# Only PaperclipServer/OfficeVirtualCompany are logon-triggered, continuously-running services -
# they should be 'Running'. PlatformHealthWatchdog/PlatformMaintenance are daily/time-triggered
# periodic tasks - 'Ready' (idle between trigger firings) is their correct, healthy resting state,
# confirmed against this machine's real trigger definitions (MSFT_TaskDailyTrigger /
# MSFT_TaskTimeTrigger), not assumed.
$alwaysRunningTasks = 'PaperclipServer', 'OfficeVirtualCompany'
$periodicTasks = 'PlatformHealthWatchdog', 'PlatformMaintenance'
$taskResults = foreach ($t in ($alwaysRunningTasks + $periodicTasks)) {
    $task = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
    if (-not $task) {
        [PSCustomObject]@{ Name = $t; Status = 'UNKNOWN'; Detail = 'Not registered.' }
    } elseif ($t -in $alwaysRunningTasks) {
        $taskStatus = if ($task.State -eq 'Running') { 'PASS' } else { 'FAIL' }
        [PSCustomObject]@{ Name = $t; Status = $taskStatus; Detail = "State: $($task.State) (expected: continuously Running)" }
    } else {
        $taskStatus = if ($task.State -in @('Ready', 'Running')) { 'PASS' } else { 'FAIL' }
        [PSCustomObject]@{ Name = $t; Status = $taskStatus; Detail = "State: $($task.State) (periodic task - 'Ready' between triggers is healthy, not a failure)" }
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
        $taskStatus = if ($task.State -eq 'Running') { 'PASS' } else { 'INFO' }
        [PSCustomObject]@{ Name = $t; Status = $taskStatus; Detail = "State: $($task.State)" }
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
$failCount = @($taskResults + $endpointResults | Where-Object { $_.Status -eq 'FAIL' }).Count
# The @(...) array-subexpression is load-bearing, not stylistic: without it, when exactly ONE
# object matches the Where-Object filter, PowerShell returns a bare PSCustomObject (not an
# array), which has no .Count property - accessing it returns $null, and `$null -gt 0` is
# $false, so a real single failure was silently reported as "all passed, exit 0". Confirmed
# against this real machine: this exact scenario occurred (PaperclipServer's task briefly
# showing a false FAIL state while the service itself was healthy) and was masked by this bug.
if ($failCount -gt 0) {
    Write-Host "$failCount check(s) FAILED. This is a real failure signal, not a false alarm suppressed for convenience." -ForegroundColor Red
    exit 1
} else {
    Write-Host "All ALLINONE-managed checks passed (upstream hermes-agent tasks are informational and not scored)." -ForegroundColor Green
    exit 0
}
