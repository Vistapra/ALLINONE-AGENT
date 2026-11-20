#Requires -Version 5.1
<#
.SYNOPSIS
    Uninstalls ALLINONE-AGENT's own managed components. Preserves data by default.
.DESCRIPTION
    Only stops/unregisters scheduled tasks this project's own installer registers
    (PaperclipServer, OfficeVirtualCompany, PlatformHealthWatchdog, PlatformMaintenance). Never
    touches Hermes Agent's own tasks (HermesAutoUpdate, Hermes_Gateway, cua-driver-serve,
    HermesPostRebootVerify) or any other application on the machine.
.PARAMETER DeleteData
    Also delete $ALLINONE_HOME\data and $ALLINONE_HOME\config. Requires typed confirmation
    ("DELETE") in addition to this flag - the flag alone is not sufficient.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param([switch]$DeleteData)

$ErrorActionPreference = 'Stop'
$ScriptRoot = $PSScriptRoot
Import-Module (Join-Path $ScriptRoot 'scripts\lib\InstallState.psm1') -Force

$AllinoneHome = Get-AllinoneHome
$managedTasks = 'PaperclipServer', 'OfficeVirtualCompany', 'PlatformHealthWatchdog', 'PlatformMaintenance'

Write-Host "ALLINONE-AGENT uninstall" -ForegroundColor Cyan
Write-Host "Install path: $AllinoneHome" -ForegroundColor Gray
Write-Host "This will stop and unregister only: $($managedTasks -join ', ')" -ForegroundColor Gray
Write-Host "It will NOT touch Hermes Agent's own tasks, npm package, or any other application." -ForegroundColor Gray

foreach ($t in $managedTasks) {
    $task = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
    if (-not $task) { continue }
    if ($PSCmdlet.ShouldProcess($t, 'Stop and unregister scheduled task')) {
        if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue }
        Unregister-ScheduledTask -TaskName $t -Confirm:$false
        Write-Host "  Removed task: $t" -ForegroundColor Green
    }
}

if (Test-Path (Get-AllinoneLockFilePath -AllinoneHome $AllinoneHome)) {
    Remove-Item -LiteralPath (Get-AllinoneLockFilePath -AllinoneHome $AllinoneHome) -Force -ErrorAction SilentlyContinue
}

if ($DeleteData) {
    Write-Host ""
    Write-Host "You passed -DeleteData. This will PERMANENTLY remove:" -ForegroundColor Red
    Write-Host "  $AllinoneHome\data"
    Write-Host "  $AllinoneHome\config"
    $confirm = Read-Host "Type DELETE (all caps) to confirm permanent data deletion, anything else to skip"
    if ($confirm -ceq 'DELETE') {
        foreach ($sub in 'data', 'config') {
            $p = Join-Path $AllinoneHome $sub
            if (Test-Path $p) {
                if ($PSCmdlet.ShouldProcess($p, 'Remove-Item -Recurse')) {
                    Remove-Item -LiteralPath $p -Recurse -Force
                    Write-Host "  Deleted $p" -ForegroundColor Red
                }
            }
        }
    } else {
        Write-Host "Confirmation text did not match 'DELETE' - data preserved." -ForegroundColor Yellow
    }
} else {
    Write-Host ""
    Write-Host "Data preserved at $AllinoneHome\data and $AllinoneHome\config (pass -DeleteData to remove, with typed confirmation)." -ForegroundColor Gray
}

Write-Host ""
Write-Host "Uninstall of ALLINONE-AGENT's own components complete. Upstream components (Paperclip/VulnClaw checkouts under upstream-checkouts\, Hermes Agent npm package) were left untouched - remove them yourself if no longer needed." -ForegroundColor Cyan
