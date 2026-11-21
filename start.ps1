#Requires -Version 5.1
<#
.SYNOPSIS
    Starts ALLINONE-AGENT's own managed components (Paperclip, Office Virtual Company,
    Platform Health Watchdog, Platform Maintenance). Does NOT touch Hermes Agent's own
    internal tasks (HermesAutoUpdate, Hermes_Gateway, cua-driver-serve, HermesPostRebootVerify) -
    those belong to the upstream hermes-agent package and are managed by its own tooling.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param()
# Note: -WhatIf is provided automatically by SupportsShouldProcess - an explicit [switch]$WhatIf
# param here previously collided with it, causing "A parameter with the name 'WhatIf' was defined
# multiple times" on every single invocation of this script, with or without -WhatIf. Confirmed
# against this real machine: this bug meant start.ps1 could never actually start anything.

$ErrorActionPreference = 'Stop'
$ScriptRoot = $PSScriptRoot
Import-Module (Join-Path $ScriptRoot 'scripts\lib\InstallState.psm1') -Force

$AllinoneHome = Get-AllinoneHome
$managedTasks = 'PaperclipServer', 'OfficeVirtualCompany', 'PlatformHealthWatchdog', 'PlatformMaintenance'

$lockPath = Enter-AllinoneSingletonLock -AllinoneHome $AllinoneHome
try {
    foreach ($taskName in $managedTasks) {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if (-not $task) {
            Write-Warning "Task '$taskName' is not registered. Run install.ps1 (Fresh/Repair mode) first, or register it manually via automation\scheduled-tasks\."
            continue
        }
        if ($task.State -eq 'Running') {
            Write-Host "  $taskName already running." -ForegroundColor DarkGray
            continue
        }
        if ($PSCmdlet.ShouldProcess($taskName, 'Start-ScheduledTask')) {
            # Same fix as stop.ps1: pipe the real task object through so the correct TaskPath
            # (\Hermes\ on this reference machine) travels with it, instead of -TaskName alone
            # defaulting to root and failing to resolve the task.
            $task | Start-ScheduledTask
            Write-Host "  Started $taskName." -ForegroundColor Green
        }
    }
}
finally {
    Exit-AllinoneSingletonLock -LockPath $lockPath
}

Write-Host ""
Write-Host "Run .\health.ps1 to confirm the application endpoints are actually responding - a scheduled task reporting 'Running' does not by itself prove the service inside it is healthy." -ForegroundColor Cyan
