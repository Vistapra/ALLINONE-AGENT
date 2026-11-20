<#
.SYNOPSIS
Unified Health Monitor & Safe Self-Healer for Hermes Agent, Telegram Gateway, CUA Driver, Local Terminal, & Auto-Updater.
Pure Win32 handle / Named-Pipe / Schedule.Service COM implementation (~200ms execution, zero WMI/tasklist stalls).
#>
[CmdletBinding()]
param(
    [switch]$Heal,
    [switch]$Json
)

if (-not $env:ALLINONE_HERMES_HOME) { $env:ALLINONE_HERMES_HOME = (Join-Path $env:LOCALAPPDATA 'hermes') }
$ALLINONE_HERMES_HOME = $env:ALLINONE_HERMES_HOME
if (-not $env:ALLINONE_USER_HOME) { $env:ALLINONE_USER_HOME = $HOME }
$ALLINONE_USER_HOME = $env:ALLINONE_USER_HOME

$ErrorActionPreference = 'Continue'

$hermesHome = "${ALLINONE_HERMES_HOME}"
$updaterDir = "${ALLINONE_USER_HOME}\HermesUpdater"
$cuaCandidate = Get-ChildItem -Path "$hermesHome\tools\cua-driver-*\cua-driver.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
$cuaBin     = if ($cuaCandidate) { $cuaCandidate.FullName } else { "${ALLINONE_HERMES_HOME}\tools\cua-driver-0.21.0-win32-x64\cua-driver.exe" }
$gwPidFile  = Join-Path $hermesHome "gateway.pid"
$gwLogFile  = Join-Path $hermesHome "logs\gateway.log"
$updState   = Join-Path $updaterDir "state\state.json"

$actionsTaken = New-Object System.Collections.Generic.List[string]

function Test-PidAlive([int]$ProcessId) {
    if ($ProcessId -le 0) { return $false }
    try {
        $p = [System.Diagnostics.Process]::GetProcessById($ProcessId)
        $alive = (-not $p.HasExited)
        $p.Dispose()
        return $alive
    } catch {
        return $false
    }
}

$schedSvc = New-Object -ComObject "Schedule.Service"
$schedSvc.Connect()

function Get-TaskInfoCom([string]$FolderPath, [string]$TaskName) {
    try {
        $folder = $schedSvc.GetFolder($FolderPath)
        $t = $folder.GetTask($TaskName)
        $stateMap = @{ 0 = "Unknown"; 1 = "Disabled"; 2 = "Queued"; 3 = "Ready"; 4 = "Running" }
        $stName = if ($stateMap.ContainsKey([int]$t.State)) { $stateMap[[int]$t.State] } else { [string]$t.State }
        return @{
            registered = $true
            enabled    = [bool]$t.Enabled
            state      = $stName
            com_task   = $t
        }
    } catch {
        return @{ registered = $false; enabled = $false; state = "Missing"; com_task = $null }
    }
}

# --- 1. Interactive Desktop Session State ---
$mySessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
$cuaPipePresent = $false
try { $cuaPipePresent = ([System.IO.Directory]::GetFiles("\\.\pipe\", "cua-driver").Length -gt 0) } catch {}
$hasActiveInteractiveSession = ($mySessionId -gt 0 -or $cuaPipePresent)
$desktopUnlocked = $hasActiveInteractiveSession
$sessionState = if (-not $hasActiveInteractiveSession) {
    "waiting_for_interactive_session (no_active_user_login)"
} else {
    "interactive_desktop_ready"
}

# --- 2. Scheduled Tasks Check (<15ms via Schedule.Service COM) ---
$taskGwRaw  = Get-TaskInfoCom "\" "Hermes_Gateway"
$taskCuaRaw = Get-TaskInfoCom "\" "cua-driver-serve"
$taskUpdRaw = Get-TaskInfoCom "\Hermes" "HermesAutoUpdate"

# --- 3. Active Gateway Process & Single-Instance Guard ---
$gwPidFromFile = $null
$gwProcAlive = $false
if (Test-Path -LiteralPath $gwPidFile) {
    try {
        $pidObj = Get-Content -LiteralPath $gwPidFile -Raw | ConvertFrom-Json
        if ($pidObj.pid) {
            $gwPidFromFile = [int]$pidObj.pid
            $gwProcAlive = Test-PidAlive $gwPidFromFile
        }
    } catch {}
}

$duplicateGateways = $false

if (-not $gwProcAlive -and $Heal -and $taskGwRaw.registered -and $taskGwRaw.enabled) {
    if ($taskGwRaw.state -eq "Running") {
        try { $null = $taskGwRaw.com_task.Stop(0) } catch {}
        Start-Sleep -Milliseconds 800
    }
    try { $null = $taskGwRaw.com_task.Run($null) } catch {}
    $actionsTaken.Add("restarted_hermes_gateway_via_task")
    for ($w = 0; $w -lt 20; $w++) {
        Start-Sleep -Milliseconds 1500
        if (Test-Path -LiteralPath $gwPidFile) {
            try {
                $gwPidFromFile = [int]((Get-Content -LiteralPath $gwPidFile -Raw | ConvertFrom-Json).pid)
                if (Test-PidAlive $gwPidFromFile) {
                    $gwProcAlive = $true
                    $tailWait = (Get-Content -LiteralPath $gwLogFile -Tail 20 -ErrorAction SilentlyContinue) -join "`n"
                    if ($tailWait -match 'telegram connected|Connected to Telegram|Set bot status indicator') { break }
                }
            } catch {}
        }
    }
    $taskGwRaw = Get-TaskInfoCom "\" "Hermes_Gateway"
}

# --- 4. Telegram Connectivity Check ---
$tgConnected = $false
$tgLastLogLine = ""
if ($gwProcAlive -and (Test-Path -LiteralPath $gwLogFile)) {
    $tail = Get-Content -LiteralPath $gwLogFile -Tail 60 -ErrorAction SilentlyContinue
    $joined = ($tail -join "`n")
    if ($joined -match 'telegram connected|Connected to Telegram|Telegram API transport recovered|Set bot status indicator') {
        $tgConnected = $true
    }
    $tgMatch = @($tail | Where-Object { $_ -match 'Telegram|telegram' })
    if ($tgMatch.Count -gt 0) { $tgLastLogLine = [string]$tgMatch[-1] }
}

# --- 5. Computer Use (cua-driver) & Port Exposure Check ---
$cuaPids = @()
if ($cuaPipePresent -and (Test-Path -LiteralPath $cuaBin)) {
    $stOut = (& $cuaBin status 2>$null | Out-String)
    if ($stOut -match 'pid:\s*(\d+)') {
        $cuaPids = @([int]$Matches[1])
    }
}
$cuaRunning = $cuaPipePresent

if (-not $cuaRunning -and $desktopUnlocked -and $Heal -and $taskCuaRaw.registered -and $taskCuaRaw.enabled) {
    try { $null = $taskCuaRaw.com_task.Run($null) } catch {}
    $actionsTaken.Add("restarted_cua_driver_in_interactive_session")
    Start-Sleep -Seconds 3
    try { $cuaPipePresent = ([System.IO.Directory]::GetFiles("\\.\pipe\", "cua-driver").Length -gt 0) } catch {}
    if ($cuaPipePresent -and (Test-Path -LiteralPath $cuaBin)) {
        $stOut = (& $cuaBin status 2>$null | Out-String)
        if ($stOut -match 'pid:\s*(\d+)') { $cuaPids = @([int]$Matches[1]) }
    }
    $cuaRunning = $cuaPipePresent
}

$cuaExposedPorts = @()
if ($cuaPids.Count -gt 0) {
    $netLines = @(& netstat.exe -ano -p tcp 2>$null | Select-String "LISTENING")
    foreach ($nl in $netLines) {
        $parts = ($nl.Line.Trim() -split '\s+')
        if ($parts.Count -ge 5 -and ($parts[4] -match '^\d+$') -and ($cuaPids -contains [int]$parts[4])) {
            $localEp = $parts[1]
            if ($localEp -notmatch '^(127\.0\.0\.1|\[::1\])\:') {
                $cuaExposedPorts += $localEp
            }
        }
    }
}

$cuaStatus = if ($cuaRunning -and $desktopUnlocked) {
    "ready"
} elseif (-not $desktopUnlocked) {
    $sessionState
} else {
    "stopped"
}

# --- 6. Autonomous Auto-Updater Check ---
$updHealthy = $false
$updHeartbeatAgeSec = -1
if (Test-Path -LiteralPath $updState) {
    try {
        $st = Get-Content -LiteralPath $updState -Raw | ConvertFrom-Json
        $hbVal = if ($st.daemon_heartbeat) { $st.daemon_heartbeat } else { $st.monitor_heartbeat }
        if ($hbVal) {
            $hb = [datetimeoffset]::Parse([string]$hbVal)
            $updHeartbeatAgeSec = [int]([datetimeoffset]::Now - $hb).TotalSeconds
            if ($updHeartbeatAgeSec -lt 180 -and (-not [bool]$st.paused)) { $updHealthy = $true }
        }
        if (-not $updHealthy -and [bool]$st.update_in_progress -and $st.update_started -and (-not [bool]$st.paused)) {
            $uStart = [datetimeoffset]::Parse([string]$st.update_started)
            if (([datetimeoffset]::Now - $uStart).TotalMinutes -lt 60) { $updHealthy = $true }
        }
    } catch {}
}
if (-not $updHealthy -and $Heal -and $taskUpdRaw.registered -and $taskUpdRaw.enabled) {
    try { $null = $taskUpdRaw.com_task.Run($null) } catch {}
    $actionsTaken.Add("triggered_hermes_autoupdate_task")
}

# --- 7. Hermes Agent Config & Local Terminal Probe ---
$configExists = Test-Path -LiteralPath (Join-Path $hermesHome "config.yaml")
$envExists    = Test-Path -LiteralPath (Join-Path $hermesHome ".env")
$termProbeOut = (& cmd.exe /d /s /c "echo HERMES_TERM_OK" 2>&1 | Out-String).Trim()
$terminalOk   = ($termProbeOut -eq "HERMES_TERM_OK")

$taskGw  = @{ registered = $taskGwRaw.registered;  enabled = $taskGwRaw.enabled;  state = $taskGwRaw.state }
$taskCua = @{ registered = $taskCuaRaw.registered; enabled = $taskCuaRaw.enabled; state = $taskCuaRaw.state }
$taskUpd = @{ registered = $taskUpdRaw.registered; enabled = $taskUpdRaw.enabled; state = $taskUpdRaw.state }

$overallHealthy = (
    $configExists -and
    $envExists -and
    $terminalOk -and
    $gwProcAlive -and
    (-not $duplicateGateways) -and
    $tgConnected -and
    ($cuaExposedPorts.Count -eq 0) -and
    ($cuaRunning -or (-not $desktopUnlocked)) -and
    $taskGw.registered -and $taskCua.registered -and $taskUpd.registered
)

$report = [ordered]@{
    timestamp                = (Get-Date).ToString("o")
    overall_healthy          = $overallHealthy
    session_state            = $sessionState
    hermes_config_ok         = ($configExists -and $envExists)
    local_terminal_ok        = $terminalOk
    gateway = [ordered]@{
        running              = $gwProcAlive
        pid                  = $gwPidFromFile
        root_tree_count      = $(if ($gwProcAlive) { 1 } else { 0 })
        duplicate_detected   = $duplicateGateways
        telegram_connected   = $tgConnected
        last_telegram_event  = $tgLastLogLine
    }
    computer_use = [ordered]@{
        status               = $cuaStatus
        driver_running       = $cuaRunning
        driver_pids          = $cuaPids
        binary_present       = (Test-Path -LiteralPath $cuaBin)
        exposed_public_ports = $cuaExposedPorts
    }
    auto_updater = [ordered]@{
        healthy              = $updHealthy
        heartbeat_age_s      = $updHeartbeatAgeSec
    }
    scheduled_tasks = [ordered]@{
        Hermes_Gateway       = $taskGw
        cua_driver_serve     = $taskCua
        HermesAutoUpdate     = $taskUpd
    }
    heal_actions             = @($actionsTaken)
}

$stateOut = Join-Path $updaterDir "state\health-latest.json"
($report | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $stateOut -Encoding UTF8

if ($Json) {
    $report | ConvertTo-Json -Depth 6
} else {
    Write-Output "Hermes Unified Health Status: $(if ($overallHealthy) { 'HEALTHY' } else { 'DEGRADED' })"
    Write-Output "  Desktop Session      : $sessionState"
    Write-Output "  Hermes Config & Env  : $(if ($report.hermes_config_ok) { 'OK' } else { 'MISSING' })"
    Write-Output "  Local Terminal       : $(if ($terminalOk) { 'OK' } else { 'FAIL' })"
    Write-Output "  Telegram Gateway     : running=$gwProcAlive (PID=$gwPidFromFile, duplicates=$duplicateGateways, telegram_connected=$tgConnected)"
    Write-Output "  Computer Use (CUA)   : status=$cuaStatus (running=$cuaRunning, public_ports=$($cuaExposedPorts.Count))"
    Write-Output "  Autonomous Updater   : healthy=$updHealthy (heartbeat_age=${updHeartbeatAgeSec}s)"
    Write-Output "  Task \Hermes_Gateway : $($taskGw.state) (enabled=$($taskGw.enabled))"
    Write-Output "  Task \cua-driver     : $($taskCua.state) (enabled=$($taskCua.enabled))"
    Write-Output "  Task \HermesAutoUpd  : $($taskUpd.state) (enabled=$($taskUpd.enabled))"
    if ($actionsTaken.Count -gt 0) {
        Write-Output "  Self-Heal Actions    : $($actionsTaken -join ', ')"
    }
}
exit $(if ($overallHealthy) { 0 } else { 1 })
