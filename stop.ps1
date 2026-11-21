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
            # Pipe the actual task object through rather than passing -TaskName alone: these
            # tasks live under \Hermes\, not the root path Stop-ScheduledTask defaults to when
            # given only a bare name, which fails with "the system cannot find the file
            # specified" - confirmed against this real machine. Piping carries the real TaskPath
            # with it regardless of what path a given install registers tasks under.
            $task | Stop-ScheduledTask
            Write-Host "  Stopped $taskName." -ForegroundColor Green
        }
    }
}
finally {
    Exit-AllinoneSingletonLock -LockPath $lockPath
}
