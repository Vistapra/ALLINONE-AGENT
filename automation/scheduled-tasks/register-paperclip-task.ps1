if (-not $env:ALLINONE_HOME) { $env:ALLINONE_HOME = (Join-Path $HOME 'ALLINONE-AGENT') }
$ALLINONE_HOME = $env:ALLINONE_HOME

$ErrorActionPreference = 'Stop'
$exe = "$ALLINONE_HOME\runtime\bin\PaperclipServiceLauncher.exe"
$user = "$env:USERDOMAIN\$env:USERNAME"
$sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
$start = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:00')

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Paperclip Control Plane supervisor (127.0.0.1:3100 + embedded PostgreSQL 54329, singleton mutex + maintenance lock aware).</Description>
    <URI>\Hermes\PaperclipServer</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>$user</UserId><Delay>PT35S</Delay></LogonTrigger>
    <SessionStateChangeTrigger><Enabled>true</Enabled><StateChange>SessionUnlock</StateChange><UserId>$user</UserId><Delay>PT15S</Delay></SessionStateChangeTrigger>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="Microsoft-Windows-NetworkProfile/Operational"&gt;&lt;Select Path="Microsoft-Windows-NetworkProfile/Operational"&gt;*[System[(EventID=10000)]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription>
      <Delay>PT20S</Delay>
    </EventTrigger>
    <TimeTrigger>
      <Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
      <StartBoundary>$start</StartBoundary><Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>$sid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
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
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>4</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$exe</Command>
      <WorkingDirectory>${ALLINONE_HOME}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

Register-ScheduledTask -TaskPath '\Hermes\' -TaskName 'PaperclipServer' -Xml $xml -Force | Out-Null
Write-Host 'Registered Scheduled Task \Hermes\PaperclipServer'
