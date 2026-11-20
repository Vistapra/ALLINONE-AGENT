#Requires -Version 5.1
<#
.SYNOPSIS
    Stops ALLINONE-AGENT's own managed components. Does NOT touch Hermes Agent's own internal
    tasks - see start.ps1 for the same boundary note.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param()

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
            Write-Host "  $taskName not registered - nothing to stop." -ForegroundColor DarkGray
            continue
        }
        if ($task.State -ne 'Running') {
            Write-Host "  $taskName already stopped." -ForegroundColor DarkGray
            continue
        }
        if ($PSCmdlet.ShouldProcess($taskName, 'Stop-ScheduledTask')) {
            Stop-ScheduledTask -TaskName $taskName
            Write-Host "  Stopped $taskName." -ForegroundColor Green
        }
    }
}
finally {
    Exit-AllinoneSingletonLock -LockPath $lockPath
}
