if (-not $env:ALLINONE_HOME) { $env:ALLINONE_HOME = (Join-Path $HOME 'ALLINONE-AGENT') }
$ALLINONE_HOME = $env:ALLINONE_HOME

$ErrorActionPreference = 'Stop'
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

# 1. Register \Hermes\PlatformMaintenance (Daily 03:02 WIB + Logon catch-up, sequential after HermesAutoUpdate)
$maintXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>$userId</Author>
    <Description>Unified AI Platform Coordinated Daily 03:00 WIB Maintenance &amp; Catch-Up Coordinator (Paperclip + VulnClaw; preserves HermesAutoUpdate untouched)</Description>
    <URI>\Hermes\PlatformMaintenance</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-11-19T03:02:00+07:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$userId</UserId>
      <Delay>PT2M</Delay>
    </LogonTrigger>
    <SessionStateChangeTrigger>
      <Enabled>true</Enabled>
      <StateChange>SessionUnlock</StateChange>
      <UserId>$userId</UserId>
      <Delay>PT1M</Delay>
    </SessionStateChangeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$userId</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "&amp; '${ALLINONE_HOME}\runtime\bin\ai-platform.cmd' run-maintenance"</Arguments>
      <WorkingDirectory>${ALLINONE_HOME}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

# 2. Register \Hermes\PlatformHealthWatchdog (Logon + every 15m self-healing & dependency reconciliation, respects maintenance.lock)
$wdXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>$userId</Author>
    <Description>Unified AI Platform Self-Healing Watchdog &amp; Task Dependency Reconciler</Description>
    <URI>\Hermes\PlatformHealthWatchdog</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$userId</UserId>
      <Delay>PT45S</Delay>
    </LogonTrigger>
    <TimeTrigger>
      <Repetition>
        <Interval>PT15M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>2026-11-19T00:05:00+07:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$userId</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${ALLINONE_HOME}\scripts\platform-watchdog.ps1"</Arguments>
      <WorkingDirectory>${ALLINONE_HOME}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

$svc = New-Object -ComObject 'Schedule.Service'
$svc.Connect()
$folder = $svc.GetFolder('\Hermes')
try {
    $badSub = $folder.GetFolder('Hermes')
    foreach ($t in $badSub.GetTasks(1)) { $badSub.DeleteTask($t.Name, 0) }
    $folder.DeleteFolder('Hermes', 0)
} catch {}
$null = $folder.RegisterTask('PlatformMaintenance', $maintXml, 6, $userId, $null, 3, $null)
$null = $folder.RegisterTask('PlatformHealthWatchdog', $wdXml, 6, $userId, $null, 3, $null)

# 3. Register \Hermes\OfficeVirtualCompany (Supervises Office Bridge 127.0.0.1:3210 + Hermes3D 127.0.0.1:3200 at Priority=4 Normal)
$officeXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>$userId</Author>
    <Description>Unified Autonomous AI Company — Office Bridge (127.0.0.1:3210) &amp; Hermes3D 3D Virtual Office (127.0.0.1:3200) Singleton Supervisor</Description>
    <URI>\Hermes\OfficeVirtualCompany</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$userId</UserId>
      <Delay>PT25S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$userId</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>4</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>5</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${ALLINONE_HOME}\runtime\bin\OfficeServiceLauncher.exe</Command>
      <WorkingDirectory>${ALLINONE_HOME}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
$null = $folder.RegisterTask('OfficeVirtualCompany', $officeXml, 6, $userId, $null, 3, $null)

Write-Output "REGISTERED_TASKS_OK"
