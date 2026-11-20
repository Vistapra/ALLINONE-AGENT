if (-not $env:ALLINONE_HOME) { $env:ALLINONE_HOME = (Join-Path $HOME 'ALLINONE-AGENT') }
$ALLINONE_HOME = $env:ALLINONE_HOME
if (-not $env:ALLINONE_HERMES_HOME) { $env:ALLINONE_HERMES_HOME = (Join-Path $env:LOCALAPPDATA 'hermes') }
$ALLINONE_HERMES_HOME = $env:ALLINONE_HERMES_HOME

$ErrorActionPreference = 'Stop'
$maintLock = "$ALLINONE_HOME\data\maintenance\maintenance.lock"
if (Test-Path $maintLock) {
    $ageSec = ((Get-Date) - (Get-Item $maintLock).LastWriteTime).TotalSeconds
    if ($ageSec -lt 5400) {
        Write-Output "MAINTENANCE_LOCK_ACTIVE: skipping watchdog restart ($ageSec s)"
        exit 0
    }
}

$svc = New-Object -ComObject 'Schedule.Service'
$svc.Connect()

# 1. Ensure \Hermes\PaperclipServer is running; if crashed/stopped, start via Task Scheduler
$pcFolder = $svc.GetFolder('\Hermes')
$pcTask = $pcFolder.GetTask('PaperclipServer')
$alive = $false
if ($pcTask.Enabled -and $pcTask.State -ne 4) {
    $null = $pcTask.Run($null)
    Start-Sleep -Seconds 15
} else {
    # Active HTTP liveness probe: if node.exe child is wedged/unresponsive twice, recycle child so PaperclipServiceLauncher restarts it
    for ($i = 0; $i -lt 2; $i++) {
        try {
            $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3100/api/health' -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
            if ($r.StatusCode -eq 200) { $alive = $true; break }
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    if (-not $alive) {
        $wedged = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'paperclip-server-entry' }
        foreach ($w in $wedged) {
            $ageMin = ((Get-Date) - $w.CreationDate).TotalMinutes
            if ($ageMin -ge 1.5) {
                Stop-Process -Id $w.ProcessId -Force -ErrorAction SilentlyContinue
                Write-Output "RECYCLED_WEDGED_PAPERCLIP_PID=$($w.ProcessId)"
            }
        }
    }
}

# 2. Ensure \Hermes\OfficeVirtualCompany (Office Bridge 3210 + Hermes3D 3200) is running; never affects Hermes or Paperclip on failure
try {
    $ovTask = $pcFolder.GetTask('OfficeVirtualCompany')
    if ($ovTask.Enabled -and $ovTask.State -ne 4) {
        $null = $ovTask.Run($null)
        Start-Sleep -Seconds 6
    } else {
        try {
            $null = Invoke-WebRequest -Uri 'http://127.0.0.1:3210/health' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        } catch {
            $wedgedBridge = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'office-bridge\\server\.js' }
            foreach ($wb in $wedgedBridge) {
                if (((Get-Date) - $wb.CreationDate).TotalMinutes -ge 1.5) {
                    Stop-Process -Id $wb.ProcessId -Force -ErrorAction SilentlyContinue
                }
            }
        }
        try {
            $null = Invoke-WebRequest -Uri 'http://127.0.0.1:3200/api/health' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        } catch {
            $wedgedH3d = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'hermes3d\\source\\server\\index\.js' }
            foreach ($wh in $wedgedH3d) {
                if (((Get-Date) - $wh.CreationDate).TotalMinutes -ge 1.5) {
                    Stop-Process -Id $wh.ProcessId -Force -ErrorAction SilentlyContinue
                }
            }
        }
    }
} catch {}

# 3. Reconcile task dependencies & record health snapshot (only when Paperclip HTTP is already live)
if ($alive) {
    $ErrorActionPreference = 'Continue'
    $py = "$ALLINONE_HERMES_HOME\tools\python-3.14.9+20261021-win32-x64\python.exe"
    if (-not (Test-Path $py)) { $py = 'python.exe' }
    & $py -c "import sys; sys.path.insert(0, r'${ALLINONE_HOME}'); from integration.workflow_engine import WorkflowEngine; WorkflowEngine().reconcile_tasks()" *>$null
    $tmpHealth = "$ALLINONE_HOME\data\last-health-snapshot.tmp.json"
    $dstHealth = "$ALLINONE_HOME\data\last-health-snapshot.json"
    $rawHealth = (& $py "${ALLINONE_HOME}\integration\platform_cli.py" health --json 2>$null) -join "`n"
    if ($rawHealth -and $rawHealth.Trim().StartsWith('{')) {
        [System.IO.File]::WriteAllText($tmpHealth, $rawHealth, (New-Object System.Text.UTF8Encoding($false)))
        Move-Item -Path $tmpHealth -Destination $dstHealth -Force
    }
}
exit 0
