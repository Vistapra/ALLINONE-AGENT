#Requires -Version 5.1
<#
.SYNOPSIS
    Starts ALLINONE-AGENT's own managed components (Paperclip, Office Virtual Company,
    Platform Health Watchdog, Platform Maintenance). Does NOT touch Hermes Agent's own
    internal tasks (HermesAutoUpdate, Hermes_Gateway, cua-driver-serve, HermesPostRebootVerify) -
    those belong to the upstream hermes-agent package and are managed by its own tooling.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param([switch]$WhatIf)

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
            Start-ScheduledTask -TaskName $taskName
            Write-Host "  Started $taskName." -ForegroundColor Green
        }
    }
}
finally {
    Exit-AllinoneSingletonLock -LockPath $lockPath
}

Write-Host ""
Write-Host "Run .\health.ps1 to confirm the application endpoints are actually responding - a scheduled task reporting 'Running' does not by itself prove the service inside it is healthy." -ForegroundColor Cyan
