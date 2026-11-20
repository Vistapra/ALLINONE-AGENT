#Requires -Version 5.1
<#
.SYNOPSIS
    Idempotency and checkpoint support for the ALLINONE-AGENT installer.
.DESCRIPTION
    Tracks install progress in a small JSON state file so install.ps1 can be re-run safely:
    stages already completed are skipped unless -Force is passed. This is deliberately a plain
    JSON file, not a database - the installer must work before any database is initialized.
#>

function Get-AllinoneHome {
    [CmdletBinding()]
    param([string]$InstallPath)
    if ($InstallPath) {
        $resolved = (Resolve-Path -LiteralPath $InstallPath -ErrorAction SilentlyContinue).Path
        if ($resolved) { return $resolved }
        return $InstallPath
    }
    if ($env:ALLINONE_HOME) { return $env:ALLINONE_HOME }
    return (Join-Path $HOME 'ALLINONE-AGENT')
}

function Get-AllinoneStateFilePath {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$AllinoneHome)
    Join-Path $AllinoneHome 'runtime\install-state.json'
}

function Read-AllinoneInstallState {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$AllinoneHome)
    $path = Get-AllinoneStateFilePath -AllinoneHome $AllinoneHome
    if (-not (Test-Path $path)) {
        return [PSCustomObject]@{
            SchemaVersion    = 1
            CreatedAt        = (Get-Date).ToString('o')
            Mode             = $null
            CompletedStages  = @()
            LastUpdated      = $null
        }
    }
    try {
        Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    } catch {
        Write-Warning "Install state file at '$path' is corrupt or unreadable ($($_.Exception.Message)). Treating as if no prior install state exists. The corrupt file is left in place for inspection, not deleted automatically."
        [PSCustomObject]@{ SchemaVersion = 1; CreatedAt = (Get-Date).ToString('o'); Mode = $null; CompletedStages = @(); LastUpdated = $null }
    }
}

function Save-AllinoneInstallState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$AllinoneHome,
        [Parameter(Mandatory)] [object]$State
    )
    $path = Get-AllinoneStateFilePath -AllinoneHome $AllinoneHome
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $State.LastUpdated = (Get-Date).ToString('o')
    $State | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $path -Encoding utf8
}

function Test-AllinoneStageCompleted {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object]$State,
        [Parameter(Mandatory)] [string]$StageName
    )
    return [bool]($State.CompletedStages -contains $StageName)
}

function Add-AllinoneCompletedStage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object]$State,
        [Parameter(Mandatory)] [string]$StageName
    )
    if ($State.CompletedStages -notcontains $StageName) {
        $State.CompletedStages = @($State.CompletedStages) + $StageName
    }
    $State
}

function Get-AllinoneLockFilePath {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$AllinoneHome)
    Join-Path $AllinoneHome 'runtime\allinone-agent.lock'
}

function Enter-AllinoneSingletonLock {
    <#
    .SYNOPSIS
        Best-effort singleton lock for ALLINONE-AGENT's own lifecycle scripts (start/stop/install).
        Does NOT touch Hermes Agent's own internal lock files (e.g. gateway.lock under the hermes
        home directory) - those belong to the upstream hermes-agent package, out of scope here.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$AllinoneHome)
    $lockPath = Get-AllinoneLockFilePath -AllinoneHome $AllinoneHome
    $dir = Split-Path -Parent $lockPath
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if (Test-Path $lockPath) {
        $existing = Get-Content -LiteralPath $lockPath -Raw -ErrorAction SilentlyContinue
        $pid_ = $null
        try { $pid_ = ($existing | ConvertFrom-Json).Pid } catch {}
        if ($pid_ -and (Get-Process -Id $pid_ -ErrorAction SilentlyContinue)) {
            throw "Another ALLINONE-AGENT lifecycle operation (PID $pid_) appears to be in progress (lock: $lockPath). If you are certain this is stale, remove the lock file manually and re-run."
        }
    }
    @{ Pid = $PID; StartedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $lockPath -Encoding utf8
    return $lockPath
}

function Exit-AllinoneSingletonLock {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$LockPath)
    if (Test-Path $LockPath) { Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue }
}

Export-ModuleMember -Function Get-AllinoneHome, Get-AllinoneStateFilePath, Read-AllinoneInstallState, `
    Save-AllinoneInstallState, Test-AllinoneStageCompleted, Add-AllinoneCompletedStage, `
    Get-AllinoneLockFilePath, Enter-AllinoneSingletonLock, Exit-AllinoneSingletonLock
