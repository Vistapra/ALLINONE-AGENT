<#
.SYNOPSIS
Registers/repairs Task Scheduler v1.4 startup & recovery tasks (\Hermes_Gateway and \Hermes\HermesPostRebootVerify)
using user-scoped InteractiveToken + LeastPrivilege (no elevation required).
#>
if (-not $env:ALLINONE_HERMES_HOME) { $env:ALLINONE_HERMES_HOME = (Join-Path $env:LOCALAPPDATA 'hermes') }
$ALLINONE_HERMES_HOME = $env:ALLINONE_HERMES_HOME
if (-not $env:ALLINONE_USER_HOME) { $env:ALLINONE_USER_HOME = $HOME }
$ALLINONE_USER_HOME = $env:ALLINONE_USER_HOME

$ErrorActionPreference = 'Stop'

$sid  = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
$user = ([Security.Principal.WindowsIdentity]::GetCurrent()).Name
$gwExe  = "${ALLINONE_HERMES_HOME}\gateway-service\HermesGatewayLauncher.exe"
$vbsRef = "${ALLINONE_HERMES_HOME}\gateway-service\Hermes_Gateway.vbs"
$postRebootPs1 = "${ALLINONE_USER_HOME}\HermesUpdater\post-reboot-verify.ps1"
$nowStart = (Get-Date).AddMinutes(1).ToString("yyyy-MM-ddTHH:mm:00")

$gwXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Hermes Agent Gateway - Messaging Platform Integration</Description>
    <URI>\Hermes_Gateway</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$user</UserId>
      <Delay>PT30S</Delay>
    </LogonTrigger>
    <SessionStateChangeTrigger>
      <Enabled>true</Enabled>
      <StateChange>SessionUnlock</StateChange>
      <UserId>$user</UserId>
      <Delay>PT10S</Delay>
    </SessionStateChangeTrigger>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="Microsoft-Windows-NetworkProfile/Operational"&gt;&lt;Select Path="Microsoft-Windows-NetworkProfile/Operational"&gt;*[System[(EventID=10000)]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription>
      <Delay>PT15S</Delay>
    </EventTrigger>
    <TimeTrigger>
      <Repetition>
        <Interval>PT1M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>$nowStart</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$sid</UserId>
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
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$gwExe</Command>
      <Arguments>//B //Nologo "$vbsRef"</Arguments>
      <WorkingDirectory>${ALLINONE_HERMES_HOME}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

$rebootXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Hermes Agent post-reboot automatic verifier and Telegram reporter</Description>
    <URI>\Hermes\HermesPostRebootVerify</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$user</UserId>
      <Delay>PT60S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$sid</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$postRebootPs1"</Arguments>
      <WorkingDirectory>${ALLINONE_USER_HOME}\HermesUpdater</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

Register-ScheduledTask -TaskPath "\" -TaskName "Hermes_Gateway" -Xml $gwXml -Force | Out-Null
Register-ScheduledTask -TaskPath "\Hermes\" -TaskName "HermesPostRebootVerify" -Xml $rebootXml -Force | Out-Null

$bootIso = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString("o")
@{ boot_time_iso = $bootIso; armed_at = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -LiteralPath "${ALLINONE_USER_HOME}\HermesUpdater\state\reboot-baseline.json" -Encoding UTF8

Write-Output "Registered \Hermes_Gateway (v1.4, 4 triggers) and \Hermes\HermesPostRebootVerify."
