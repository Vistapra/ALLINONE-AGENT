#Requires -Version 5.1
<#
.SYNOPSIS
    Coordinates ALLINONE-AGENT updates. Does NOT reimplement Hermes Agent's own updater logic.
.DESCRIPTION
    Hermes Agent ships its own real update automation (vendored for reference under
    automation\updater\hermes-autoupdate.ps1, hermes-health.ps1, post-reboot-verify.ps1,
    upgrade-startup-tasks.ps1) which already implements the 03:00 Asia/Jakarta schedule, offline
    catch-up, and active-task deferral described in the project brief. This script coordinates
    around that existing behavior rather than duplicating it:
      - For the Hermes Agent component itself: defers entirely to the vendored
        hermes-autoupdate.ps1 / its own scheduled task (HermesAutoUpdate). This script does not
        invoke it directly, since doing so outside its own scheduled-task context/locking could
        race with a scheduled run.
      - For ALLINONE-AGENT-managed components (Paperclip, VulnClaw, Office Bridge, Hermes3D):
        triggers the PlatformMaintenance scheduled task on demand, which is this repo's own
        coordinator (automation\scheduled-tasks\register-platform-tasks.ps1 registers it).
.PARAMETER CheckOnly
    Report what would be updated without running anything.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'

Write-Host "ALLINONE-AGENT update coordinator" -ForegroundColor Cyan
Write-Host ""
Write-Host "Hermes Agent component: managed entirely by its own updater (scheduled task 'HermesAutoUpdate', 03:00 Asia/Jakarta + offline catch-up)." -ForegroundColor Gray
Write-Host "This script does not touch it. To run it manually, use its own tooling directly (outside this repo)." -ForegroundColor Gray
Write-Host ""

$task = Get-ScheduledTask -TaskName 'PlatformMaintenance' -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Warning "PlatformMaintenance task not registered - run install.ps1 first."
    exit 1
}

if ($CheckOnly) {
    Write-Host "CheckOnly: PlatformMaintenance task state is '$($task.State)'. Not triggering it." -ForegroundColor Yellow
    exit 0
}

if ($PSCmdlet.ShouldProcess('PlatformMaintenance', 'Start-ScheduledTask (on-demand maintenance/update run)')) {
    Start-ScheduledTask -TaskName 'PlatformMaintenance'
    Write-Host "Triggered PlatformMaintenance on demand. Check its result via Task Scheduler history or .\health.ps1 afterward." -ForegroundColor Green
    Write-Host "NOTE: this does not defer to active-task status the way the real 03:00 run does - running it manually mid-task could interrupt in-progress agent work. Prefer the scheduled time unless you understand this risk." -ForegroundColor Yellow
}
