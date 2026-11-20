<#
.SYNOPSIS
  Hermes Agent autonomous update monitor / executor for Windows.

.DESCRIPTION
  Runs OUTSIDE the Hermes checkout. Detects new upstream commits (channel "main")
  or releases (channel "stable") with a lightweight `git ls-remote` (protocol v2,
  single ref, no clone/fetch), confirms with the official `hermes update --check`,
  and applies updates ONLY through the official `hermes update --no-backup --yes`.

  Commands:
    status | check-now | update-now | pause | resume | logs | config | run | cycle
    install | uninstall | selftest-lock

  Root dir / config can be overridden for isolated tests with
  $env:HERMES_AU_ROOT (state, logs, config.json live there).
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Command = 'status',
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Rest,
  [int]$Tail = 40,
  [switch]$Json,
  [string]$Set
)

if (-not $env:ALLINONE_HERMES_HOME) { $env:ALLINONE_HERMES_HOME = (Join-Path $env:LOCALAPPDATA 'hermes') }
$ALLINONE_HERMES_HOME = $env:ALLINONE_HERMES_HOME

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 1

# --------------------------------------------------------------------------- paths
$Script:Root = if ($env:HERMES_AU_ROOT) { $env:HERMES_AU_ROOT } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$Script:ScriptPath = $MyInvocation.MyCommand.Path
$Script:ConfigPath = Join-Path $Root 'config.json'
$Script:StateDir   = Join-Path $Root 'state'
$Script:StatePath  = Join-Path $StateDir 'state.json'
$Script:LogDir     = Join-Path $Root 'logs'
$Script:RunLogDir  = Join-Path $LogDir 'runs'
$Script:LogPath    = Join-Path $LogDir 'autoupdate.log'
$Script:JsonLogPath= Join-Path $LogDir 'autoupdate.jsonl'
$Script:EmptyStdin = Join-Path $StateDir 'empty-stdin.txt'
$Script:TaskName   = if ($env:HERMES_AU_TASKNAME) { $env:HERMES_AU_TASKNAME } else { 'HermesAutoUpdate' }
$Script:TaskPath   = '\Hermes\'
$Script:MutexPrefix= if ($env:HERMES_AU_MUTEX_PREFIX) { $env:HERMES_AU_MUTEX_PREFIX } else { 'Local\HermesAutoUpdate' }

foreach ($d in @($StateDir, $LogDir, $RunLogDir)) {
  if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}
if (-not (Test-Path -LiteralPath $EmptyStdin)) { Set-Content -LiteralPath $EmptyStdin -Value '' -NoNewline }

# Never let git / credential managers prompt from a background task.
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE     = 'Never'
$env:PYTHONIOENCODING    = 'utf-8'
$env:PYTHONUTF8          = '1'

# --------------------------------------------------------------------------- defaults
$Script:Defaults = [ordered]@{
  AUTO_UPDATE_ENABLED = $true; UPDATE_CHANNEL = 'main'; SCHEDULE_MODE = 'interval'; DAILY_CHECK_HOUR = 3; DAILY_CHECK_MINUTE = 0; CHECK_INTERVAL_SECONDS = 60
  UPDATE_ON_NEW_VERSION = $true; UPDATE_ON_STARTUP = $true; UPDATE_AFTER_RECONNECT = $true
  AUTO_RECOVERY_ENABLED = $true; AUTO_RESTART_AFTER_UPDATE = $true; PRESERVE_USER_DATA = $true
  ALLOW_PRERELEASE = $false; ALLOW_FORCE_TERMINATION = $false; TIMEZONE = 'Asia/Jakarta'
  REPO_URL = 'https://github.com/NousResearch/hermes-agent.git'
  HERMES_CMD = ''; CHECKOUT_DIR = ''; HERMES_HOME = ''
  STABILIZE_SECONDS = 120; MAX_PENDING_MINUTES = 15; MIN_UPDATE_INTERVAL_MINUTES = 15
  STABLE_RECHECK_HOURS = 6; MIN_FREE_DISK_GB = 3; UPDATE_TIMEOUT_MINUTES = 90
  NETWORK_TIMEOUT_SECONDS = 30; MAX_BACKOFF_SECONDS = 1800; MAX_ATTEMPTS_PER_TARGET = 3
  FAILED_TARGET_COOLDOWN_MINUTES = 30; FAILED_TARGET_COOLDOWN_MAX_MINUTES = 1440
  BACKUP_ENABLED = $false; PREFER_PM_GIT = $true; CLEAN_UPDATE_ARTIFACTS = $true; CUSTOMIZATIONS = @(); PM_PYTHON = ''; PM_GIT = ''
  LOG_MAX_MB = 5; LOG_KEEP = 5; RUN_LOG_KEEP = 30; HEARTBEAT_MINUTES = 60; DAEMON_RECYCLE_HOURS = 24
}
$Script:MinIntervalSeconds = 30   # hard floor regardless of config

# --------------------------------------------------------------------------- helpers
function ConvertTo-HashtableDeep($obj) {
  if ($null -eq $obj) { return $null }
  if ($obj -is [System.Collections.IDictionary]) {
    $h = [ordered]@{}; foreach ($k in $obj.Keys) { $h[$k] = ConvertTo-HashtableDeep $obj[$k] }; return $h
  }
  if ($obj -is [pscustomobject]) {
    $h = [ordered]@{}; foreach ($p in $obj.PSObject.Properties) { $h[$p.Name] = ConvertTo-HashtableDeep $p.Value }; return $h
  }
  if (($obj -is [System.Collections.IEnumerable]) -and -not ($obj -is [string])) {
    $list = @(); foreach ($i in $obj) { $list += ,(ConvertTo-HashtableDeep $i) }; return ,$list
  }
  return $obj
}

function Get-Config {
  $cfg = [ordered]@{}
  foreach ($k in $Defaults.Keys) { $cfg[$k] = $Defaults[$k] }
  if (Test-Path -LiteralPath $ConfigPath) {
    try {
      $file = ConvertTo-HashtableDeep (Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json)
      foreach ($k in $file.Keys) { $cfg[$k] = $file[$k] }
    } catch { Write-Log 'ERROR' 'config' "config.json unreadable, using defaults: $($_.Exception.Message)" }
  }
  if (-not $cfg.HERMES_HOME) { $cfg.HERMES_HOME = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' } }
  if (-not $cfg.HERMES_CMD) {
    $c = Get-Command hermes.cmd -ErrorAction SilentlyContinue; if ($c) { $cfg.HERMES_CMD = $c.Source }
  }
  if ([int]$cfg.CHECK_INTERVAL_SECONDS -lt $MinIntervalSeconds) { $cfg.CHECK_INTERVAL_SECONDS = $MinIntervalSeconds }
  $ch = ([string]$cfg.UPDATE_CHANNEL).ToLower(); if ($ch -notin @('main','stable')) { $ch = 'main' }; $cfg.UPDATE_CHANNEL = $ch
  $sm = ([string]$cfg.SCHEDULE_MODE).ToLower(); if ($sm -notin @('interval','daily')) { $sm = 'interval' }; $cfg.SCHEDULE_MODE = $sm
  $cfg.BACKUP_ENABLED = $false   # zero-backup policy: not configurable, no backup code exists
  return $cfg
}

$Script:TzMap = @{ 'Asia/Jakarta' = 'SE Asia Standard Time'; 'UTC' = 'UTC'; 'Asia/Makassar' = 'Singapore Standard Time'; 'Asia/Jayapura' = 'Tokyo Standard Time' }
function Get-Now {
  $utc = [DateTimeOffset]::UtcNow
  try {
    $tzName = if ($Script:Cfg) { [string]$Script:Cfg.TIMEZONE } else { 'Asia/Jakarta' }
    $id = if ($TzMap.ContainsKey($tzName)) { $TzMap[$tzName] } else { $tzName }
    $tz = [TimeZoneInfo]::FindSystemTimeZoneById($id)
    return [TimeZoneInfo]::ConvertTime($utc, $tz)
  } catch { return $utc.ToLocalTime() }
}
function Fmt([DateTimeOffset]$d) { return $d.ToString("yyyy-MM-dd'T'HH:mm:sszzz") }
function NowIso { return (Fmt (Get-Now)) }
function Parse-Iso($s) { if (-not $s) { return $null }; try { return [DateTimeOffset]::Parse([string]$s, [Globalization.CultureInfo]::InvariantCulture) } catch { return $null } }
function Get-DailyScheduleWindow([DateTimeOffset]$now) {
  $h = if ($Script:Cfg -and $null -ne $Script:Cfg.DAILY_CHECK_HOUR) { [Math]::Max(0, [Math]::Min(23, [int]$Script:Cfg.DAILY_CHECK_HOUR)) } else { 3 }
  $m = if ($Script:Cfg -and $null -ne $Script:Cfg.DAILY_CHECK_MINUTE) { [Math]::Max(0, [Math]::Min(59, [int]$Script:Cfg.DAILY_CHECK_MINUTE)) } else { 0 }
  $todaySlot = [DateTimeOffset]::new($now.Year, $now.Month, $now.Day, $h, $m, 0, $now.Offset)
  if ($now -ge $todaySlot) {
    return @{ due_slot = $todaySlot; next_slot = $todaySlot.AddDays(1); is_catchup = (($now - $todaySlot).TotalMinutes -ge 10); hhmm = ('{0:D2}:{1:D2}' -f $h, $m) }
  }
  return @{ due_slot = $todaySlot.AddDays(-1); next_slot = $todaySlot; is_catchup = $true; hhmm = ('{0:D2}:{1:D2}' -f $h, $m) }
}

$Script:RedactPatterns = @(
  '(?i)(sk-[A-Za-z0-9_\-]{8,})', '(?i)(sk-or-v1-[A-Za-z0-9]{8,})', '(gh[pousr]_[A-Za-z0-9]{20,})', '(github_pat_[A-Za-z0-9_]{20,})',
  '(?i)(bearer\s+)[A-Za-z0-9\._\-]{12,}', '(?i)((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s"'',;]{6,}', '(xox[baprs]-[A-Za-z0-9\-]{10,})', '(AIza[0-9A-Za-z_\-]{30,})'
)
function Redact([string]$text) {
  if (-not $text) { return $text }
  foreach ($p in $RedactPatterns) {
    $text = [regex]::Replace($text, $p, { param($m) if ($m.Groups.Count -gt 1 -and $m.Groups[1].Value -match '(?i)(bearer\s+|[=:]\s*)$') { $m.Groups[1].Value + '[REDACTED]' } else { '[REDACTED]' } })
  }
  return $text
}

function Rotate-File([string]$path, [int]$maxMb, [int]$keep) {
  try {
    if ((Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path).Length -gt ($maxMb * 1MB))) {
      for ($i = $keep - 1; $i -ge 1; $i--) {
        $src = "$path.$i"; $dst = "$path.$($i + 1)"
        if (Test-Path -LiteralPath $src) { Move-Item -LiteralPath $src -Destination $dst -Force }
      }
      Move-Item -LiteralPath $path -Destination "$path.1" -Force
      if (Test-Path -LiteralPath "$path.$($keep + 1)") { Remove-Item -LiteralPath "$path.$($keep + 1)" -Force }
    }
  } catch { }
}

function Write-Log([string]$Level, [string]$Event, [string]$Message, [hashtable]$Data) {
  $maxMb = 5; $keep = 5
  if ($Script:Cfg) { $maxMb = [int]$Cfg.LOG_MAX_MB; $keep = [int]$Cfg.LOG_KEEP }
  $ts = NowIso
  $Message = Redact $Message
  $line = "{0} [{1}] {2}: {3}" -f $ts, $Level.PadRight(5), $Event, $Message
  $rec = [ordered]@{ ts = $ts; tz = $(if ($Script:Cfg) { $Cfg.TIMEZONE } else { '' }); level = $Level; event = $Event; msg = $Message; pid = $PID }
  if ($Data) { foreach ($k in $Data.Keys) { $v = $Data[$k]; if ($v -is [string]) { $v = Redact $v }; $rec[$k] = $v } }
  for ($i = 0; $i -lt 5; $i++) {
    try {
      Rotate-File $LogPath $maxMb $keep; Rotate-File $JsonLogPath $maxMb $keep
      [IO.File]::AppendAllText($LogPath, $line + "`r`n", [Text.Encoding]::UTF8)
      [IO.File]::AppendAllText($JsonLogPath, ($rec | ConvertTo-Json -Compress -Depth 6) + "`n", [Text.Encoding]::UTF8)
      break
    } catch { Start-Sleep -Milliseconds 150 }
  }
  if ($Script:Interactive) { Write-Host $line }
}

# ---- named mutexes ----------------------------------------------------------
function New-NamedMutex([string]$suffix) { return New-Object System.Threading.Mutex($false, "$MutexPrefix.$suffix") }
function Enter-Mutex($m, [int]$timeoutMs) {
  try { return $m.WaitOne($timeoutMs) } catch [System.Threading.AbandonedMutexException] { return $true }
}

# ---- state ------------------------------------------------------------------
function Read-State {
  if (Test-Path -LiteralPath $StatePath) {
    try { $s = ConvertTo-HashtableDeep (Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json); if ($s) { return $s } } catch { }
  }
  return [ordered]@{}
}
function Update-State([scriptblock]$Mutator) {
  $m = New-NamedMutex 'State'
  $got = Enter-Mutex $m 10000
  try {
    $s = Read-State
    & $Mutator $s
    $tmp = "$StatePath.tmp.$PID"
    [IO.File]::WriteAllText($tmp, ($s | ConvertTo-Json -Depth 8), [Text.Encoding]::UTF8)
    Move-Item -LiteralPath $tmp -Destination $StatePath -Force
    return $s
  } finally { if ($got) { $m.ReleaseMutex() }; $m.Dispose() }
}
function SGet($s, [string]$k, $default = $null) { if ($s -and $s.Contains($k) -and $null -ne $s[$k]) { return $s[$k] } else { return $default } }

# ---- process runner (hidden, timeout, captured) ------------------------------
function Invoke-Proc {
  param([string]$File, [string[]]$ArgList, [int]$TimeoutSec = 60, [string]$WorkDir = $null, [switch]$BelowNormal, [string]$OutFile = $null, [string]$RawArgs = $null)
  $quoted = @(); foreach ($a in $ArgList) { if ($a -match '[\s"]') { $quoted += '"' + ($a -replace '"', '\"') + '"' } else { $quoted += $a } }
  $res = [ordered]@{ ExitCode = $null; TimedOut = $false; StdOut = ''; StdErr = ''; Pid = $null; Error = $null }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $File; $psi.Arguments = $(if ($RawArgs) { $RawArgs } else { ($quoted -join ' ') })
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  if ($WorkDir) { $psi.WorkingDirectory = $WorkDir }
  $p = New-Object System.Diagnostics.Process; $p.StartInfo = $psi
  $sbOut = New-Object System.Text.StringBuilder; $sbErr = New-Object System.Text.StringBuilder
  $writer = $null
  try {
    if ($OutFile) { $writer = New-Object IO.StreamWriter($OutFile, $false, (New-Object Text.UTF8Encoding($false))); $writer.AutoFlush = $true }
    $null = $p.Start()
    $res.Pid = $p.Id
    $p.StandardInput.Close()   # no interactive prompts can block a background run
    if ($BelowNormal) { try { $p.PriorityClass = 'BelowNormal' } catch { } }
    $tOut = $p.StandardOutput.ReadToEndAsync(); $tErr = $p.StandardError.ReadToEndAsync()
    $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(1, $TimeoutSec))
    while (-not $p.HasExited) {
      if ([DateTime]::UtcNow -gt $deadline) { $res.TimedOut = $true; break }
      Start-Sleep -Milliseconds 100
    }
    if (-not $res.TimedOut) {
      $p.WaitForExit(); $res.ExitCode = $p.ExitCode
      # A grandchild (e.g. a relaunched gateway) could inherit the pipe; never block on it.
      if ($tOut.Wait(15000)) { $res.StdOut = $tOut.Result }
      if ($tErr.Wait(5000)) { $res.StdErr = $tErr.Result }
    } else {
      # Never kill on timeout (ALLOW_FORCE_TERMINATION=false); report what we have.
      if ($tOut.IsCompleted) { $res.StdOut = $tOut.Result }
    }
    if ($writer) { $writer.Write($res.StdOut); if ($res.StdErr) { $writer.Write("`n--- stderr ---`n" + $res.StdErr) } }
  } catch { $res.Error = $_.Exception.Message } finally { if ($writer) { $writer.Dispose() } }
  return $res
}

function Invoke-Hermes([string[]]$HArgs, [int]$TimeoutSec = 120, [string]$OutFile = $null, [switch]$BelowNormal) {
  # Run through cmd.exe so the npm .cmd shim works exactly like an interactive call.
  # Output goes to a FILE via cmd redirection: background processes the updater may
  # (re)launch inherit a file handle instead of our pipe, so we can never hang on them.
  $file = if ($OutFile) { $OutFile } else { Join-Path $StateDir ("hermes-{0}.out" -f [guid]::NewGuid().ToString('N').Substring(0, 8)) }
  $argStr = (($HArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' ')
  $line = '"' + $Cfg.HERMES_CMD + '" ' + $argStr + ' < NUL > "' + $file + '" 2>&1'
  $r = Invoke-Proc -File "$env:ComSpec" -RawArgs ('/d /s /c "' + $line + '"') -TimeoutSec $TimeoutSec -BelowNormal:$BelowNormal -WorkDir $Root
  $txt = ''
  for ($i = 0; $i -lt 5; $i++) { try { if (Test-Path -LiteralPath $file) { $fs = New-Object IO.FileStream($file, 'Open', 'Read', 'ReadWrite'); $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8); $txt = $sr.ReadToEnd(); $sr.Dispose() }; break } catch { Start-Sleep -Milliseconds 200 } }
  $r.StdOut = $txt; $r.StdErr = ''
  if (-not $OutFile -and -not $r.TimedOut) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
  return $r
}

function Invoke-Git([string[]]$GArgs, [int]$TimeoutSec = 30) {
  $gitBin = if ($Script:GitExe -and (Test-Path -LiteralPath $Script:GitExe)) { $Script:GitExe } else { 'git.exe' }
  return Invoke-Proc -File $gitBin -ArgList $GArgs -TimeoutSec $TimeoutSec
}

# --------------------------------------------------------------------------- detection
function Get-HeadFast {
  # Resolve HEAD by reading .git files directly (no process spawn). Falls back to git.
  try {
    $gd = Join-Path $Cfg.CHECKOUT_DIR '.git'
    if (Test-Path -LiteralPath $gd -PathType Leaf) { $l = (Get-Content -LiteralPath $gd -TotalCount 1); if ($l -match '^gitdir:\s*(.+)$') { $gd = $Matches[1].Trim(); if (-not [IO.Path]::IsPathRooted($gd)) { $gd = Join-Path $Cfg.CHECKOUT_DIR $gd } } }
    $head = ([IO.File]::ReadAllText((Join-Path $gd 'HEAD'))).Trim()
    if ($head -match '^[0-9a-f]{40}$') { return @{ head = $head; branch = 'HEAD' } }
    if ($head -match '^ref:\s*(refs/heads/(.+))$') {
      $ref = $Matches[1]; $br = $Matches[2]
      $rf = Join-Path $gd ($ref -replace '/', '\')
      if (Test-Path -LiteralPath $rf) { $sha = ([IO.File]::ReadAllText($rf)).Trim(); if ($sha -match '^[0-9a-f]{40}$') { return @{ head = $sha; branch = $br } } }
      $pr = Join-Path $gd 'packed-refs'
      if (Test-Path -LiteralPath $pr) { foreach ($ln in [IO.File]::ReadAllLines($pr)) { if ($ln -match ('^([0-9a-f]{40}) ' + [regex]::Escape($ref) + '$')) { return @{ head = $Matches[1]; branch = $br } } } }
    }
  } catch { }
  $r = Invoke-Git @('-C', $Cfg.CHECKOUT_DIR, 'rev-parse', 'HEAD') 20
  return @{ head = $(if ($r.ExitCode -eq 0) { $r.StdOut.Trim() } else { $null }); branch = $null }
}

function Get-LocalInfo([switch]$Full) {
  $hf = Get-HeadFast
  if (-not $Full) { return [ordered]@{ head = $hf.head; branch = $hf.branch; dirty = $null; origin = $null } }
  $head = $hf.head
  $b = Invoke-Git @('-C', $Cfg.CHECKOUT_DIR, 'rev-parse', '--abbrev-ref', 'HEAD') 20
  $branch = if ($b.ExitCode -eq 0) { $b.StdOut.Trim() } else { $null }
  $d = Invoke-Git @('-C', $Cfg.CHECKOUT_DIR, 'status', '--porcelain', '--untracked-files=no') 30
  $dirty = if ($d.ExitCode -eq 0) { [bool]($d.StdOut.Trim()) } else { $null }
  $o = Invoke-Git @('-C', $Cfg.CHECKOUT_DIR, 'remote', 'get-url', 'origin') 20
  $origin = if ($o.ExitCode -eq 0) { $o.StdOut.Trim() } else { $null }
  return [ordered]@{ head = $head; branch = $branch; dirty = $dirty; origin = $origin }
}

function Test-OfficialOrigin([string]$url) {
  if (-not $url) { return $false }
  # Isolated test sandbox only: a local bare repo stands in for GitHub.
  if ($env:HERMES_AU_TEST_MODE -eq '1' -and $env:HERMES_AU_ROOT -and ($url -replace '/', '\') -like "*\tests\sandbox\*") { return $true }
  return ($url.TrimEnd('/') -replace '\.git$', '') -match '^(https://github\.com/|git@github\.com:)NousResearch/hermes-agent$'
}

function Get-ErrorCategory([string]$text) {
  if (-not $text) { return 'unknown' }
  if ($text -match '(?i)rate limit|HTTP 429|error: 429|too many requests|secondary rate') { return 'rate_limited' }
  if ($text -match '(?i)could not resolve host|name or service not known|no such host|getaddrinfo') { return 'network_offline' }
  if ($text -match '(?i)timed out|timeout|operation too slow|connection reset|early EOF|RPC failed|unexpected disconnect|SSL_read|schannel|Failed to connect|Could not connect|unable to access') { return 'network_error' }
  if ($text -match '(?i)HTTP 5\d\d|returned error: 5\d\d|service unavailable|bad gateway') { return 'github_unavailable' }
  if ($text -match '(?i)no space left|ENOSPC|not enough space|disk (is )?full') { return 'disk_full' }
  if ($text -match '(?i)merge conflict|CONFLICT \(') { return 'local_conflict' }
  if ($text -match '(?i)not a git repository|git data is damaged|bad object|corrupt') { return 'git_invalid' }
  if ($text -match '(?i)config migration|migrate config') { return 'config_migration' }
  if ($text -match '(?i)dependency|uv sync|pip|resolver|InstallError|wheel') { return 'dependency_failed' }
  if ($text -match '(?i)gateway') { return 'gateway' }
  return 'unknown'
}

function Get-RemoteTarget {
  $timeout = [int]$Cfg.NETWORK_TIMEOUT_SECONDS
  if ($Cfg.UPDATE_CHANNEL -eq 'main') {
    $r = Invoke-Git @('-c', 'protocol.version=2', 'ls-remote', $Cfg.REPO_URL, 'refs/heads/main') $timeout
    if ($r.TimedOut) { return @{ ok = $false; category = 'network_error'; error = "ls-remote timed out after ${timeout}s" } }
    if ($r.Error) { return @{ ok = $false; category = 'unknown'; error = $r.Error } }
    if ($r.ExitCode -ne 0) { $t = ($r.StdErr + ' ' + $r.StdOut).Trim(); return @{ ok = $false; category = (Get-ErrorCategory $t); error = $t } }
    $m = [regex]::Match($r.StdOut, '(?m)^([0-9a-f]{40})\s+refs/heads/main\s*$')
    if (-not $m.Success) { return @{ ok = $false; category = 'protocol'; error = 'refs/heads/main not found in ls-remote output' } }
    return @{ ok = $true; sha = $m.Groups[1].Value; signature = $m.Groups[1].Value }
  } else {
    $r = Invoke-Git @('-c', 'protocol.version=2', 'ls-remote', '--tags', $Cfg.REPO_URL, 'refs/tags/v*') $timeout
    if ($r.TimedOut) { return @{ ok = $false; category = 'network_error'; error = "ls-remote timed out after ${timeout}s" } }
    if ($r.ExitCode -ne 0) { $t = ($r.StdErr + ' ' + $r.StdOut).Trim(); return @{ ok = $false; category = (Get-ErrorCategory $t); error = $t } }
    $rx = if ($Cfg.ALLOW_PRERELEASE) { '^v\d+\.\d+\.\d+([-.][0-9A-Za-z.\-]+)?$' } else { '^v\d+\.\d+\.\d+$' }
    $tags = @()
    foreach ($ln in ($r.StdOut -split "`n")) {
      $mm = [regex]::Match($ln.Trim(), '^([0-9a-f]{40})\s+refs/tags/(\S+?)(\^\{\})?$')
      if ($mm.Success -and $mm.Groups[3].Value -eq '' -and $mm.Groups[2].Value -match $rx) { $tags += "$($mm.Groups[2].Value)=$($mm.Groups[1].Value)" }
    }
    $sorted = $tags | Sort-Object
    $sha1 = [Security.Cryptography.SHA1]::Create()
    $sig = ([BitConverter]::ToString($sha1.ComputeHash([Text.Encoding]::UTF8.GetBytes(($sorted -join "`n"))))).Replace('-', '').ToLower()
    return @{ ok = $true; sha = $null; signature = $sig; tagCount = $tags.Count }
  }
}

function Invoke-OfficialCheck {
  $r = Invoke-Hermes @('update', '--check') 300
  $txt = ($r.StdOut + "`n" + $r.StdErr)
  $res = [ordered]@{ exit = $r.ExitCode; timedOut = $r.TimedOut; available = $null; channel = $null; text = (Redact ($txt.Trim())) }
  $cm = [regex]::Match($txt, '(?i)Update channel:\s*([A-Za-z0-9_\-]+)'); if ($cm.Success) { $res.channel = $cm.Groups[1].Value.ToLower() }
  if ($r.TimedOut -or $null -eq $r.ExitCode) { $res.available = $null; return $res }
  if ($r.ExitCode -ne 0 -and $txt -notmatch '(?i)update available|up to date') { $res.available = $null; return $res }
  if ($txt -match '(?i)update available|commits? behind|new release|newer release') { $res.available = $true }
  elseif ($txt -match '(?i)up to date|already (at|on) the latest|is newer|no update') { $res.available = $false }
  return $res
}

function Get-VenvHolders {
  # Official contract: exit 0 = venv free ([]), exit 3 = holders present (JSON list).
  $r = Invoke-Hermes @('update', '--list-venv-holders') 120
  $holders = New-Object System.Collections.ArrayList
  if ($r.ExitCode -ne 0) {
    $m = [regex]::Match($r.StdOut, '(?ms)^\s*(\[.*\])\s*$')
    if ($m.Success) {
      try { foreach ($it in @($m.Groups[1].Value | ConvertFrom-Json)) { foreach ($x in @($it)) { if ($x) { $null = $holders.Add((ConvertTo-HashtableDeep $x)) } } } } catch { }
    }
    if ($r.ExitCode -eq 3 -and $holders.Count -eq 0) { $null = $holders.Add(@{ kind = 'unknown'; pid = '?' }) }  # fail safe: treat as busy
  }
  return @{ exit = $r.ExitCode; holders = @($holders); raw = $r.StdOut.Trim() }
}

function Get-GatewayRunning {
  $r = Invoke-Hermes @('gateway', 'status') 120
  $t = $r.StdOut + $r.StdErr
  if ($t -match '(?i)not running|no gateway') { return $false }
  if ($t -match '(?i)running|active|pid') { return $true }
  return $null
}

function Get-LatestReceipt {
  $p = Join-Path $Cfg.HERMES_HOME 'logs\update_receipts\latest.json'
  if (-not (Test-Path -LiteralPath $p)) { return $null }
  try { return ConvertTo-HashtableDeep (Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}
function Get-ReceiptSummary($rc) {
  # Official receipt: HERMES_HOME\logs\update_receipts\latest.json (schema 1)
  if (-not $rc) { return $null }
  $sum = [ordered]@{ update_id = $rc['update_id']; outcome = $rc['outcome']; started_at = $rc['started_at']; finished_at = $rc['finished_at'] }
  if ($rc['pre_update'])  { $sum.pre_sha = $rc['pre_update']['sha'] }
  if ($rc['post_update']) { $sum.post_sha = $rc['post_update']['sha']; $sum.post_version = $rc['post_update']['version'] }
  $sum.pm_sync_outcome = $rc['pm_sync_outcome']
  $fu = @(); $warn = @()
  foreach ($k in @('follow_ups', 'followups', 'follow_up')) { if ($rc.Contains($k) -and $rc[$k]) { foreach ($i in @($rc[$k])) { if ($i -is [System.Collections.IDictionary]) { $fu += (@($i['kind'], $i['name'], $i['type'], $i['detail']) | Where-Object { $_ } | Select-Object -First 2) -join ': ' } else { $fu += [string]$i } } } }
  $gr = $rc['gateway_restart']
  if ($gr) {
    if ($gr['incomplete']) { $fu += 'gateway_restart: incomplete' }
    if (@($gr['failed_units']).Where({ $_ }).Count -gt 0) { $fu += 'gateway_restart: failed units ' + (@($gr['failed_units']) -join ',') }
    if ($gr['phase_error']) { $fu += 'gateway_restart: ' + $gr['phase_error'] }
  }
  foreach ($st in @($rc['stages'])) { if ($st -and $st['outcome'] -and $st['outcome'] -ne 'success') { $fu += "$($st['name']): $($st['outcome'])" } }
  foreach ($st in @($rc['steps'])) { if ($st -and $st.Contains('ok') -and -not $st['ok']) { $warn += "$($st['name']): $($st['detail'])" } }
  foreach ($k in @('warnings')) { if ($rc.Contains($k) -and $rc[$k]) { foreach ($i in @($rc[$k])) { $warn += [string]$i } } }
  if ($rc['pm_venv_rebuild'] -and -not $rc['pm_venv_rebuild']['ok'] -and ([string]$rc['pm_venv_rebuild']['reason'] -notmatch '(?i)already in sync|up to date|not needed|no change')) { $fu += 'pm_venv_rebuild: ' + $rc['pm_venv_rebuild']['reason'] }
  $sum.follow_ups = @($fu | Select-Object -First 10); $sum.warnings = @($warn | Select-Object -First 10)
  return $sum
}

function Get-ConfiguredChannel {
  # Reads update.installs.<id>.channel for our checkout from config.yaml (cheap, no network).
  $p = Join-Path $Cfg.HERMES_HOME 'config.yaml'
  if (-not (Test-Path -LiteralPath $p)) { return $null }
  try { $txt = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) } catch { return $null }
  $want = ([IO.Path]::GetFullPath($Cfg.CHECKOUT_DIR)).TrimEnd('\').ToLower()
  foreach ($m in [regex]::Matches($txt, '(?m)^\s+path:\s*["'']?(?<path>[^"''\r\n]+?)["'']?\s*\r?\n\s+channel:\s*["'']?(?<ch>[A-Za-z0-9_\-]+)')) {
    $pp = ($m.Groups['path'].Value -replace '\\\\', '\').TrimEnd('\').ToLower()
    if ($pp -eq $want) { return $m.Groups['ch'].Value.ToLower() }
  }
  return ''
}
function Ensure-Channel {
  $cur = Get-ConfiguredChannel
  if ($null -eq $cur) { return }
  if ($cur -ne $Cfg.UPDATE_CHANNEL) {
    $st = Read-State; $lastFix = Parse-Iso (SGet $st 'channel_repair_at')
    if ($lastFix -and ((Get-Now) - $lastFix).TotalHours -lt 6) { return }
    Update-State { param($s) $s.channel_repair_at = (NowIso) } | Out-Null
    $r = Invoke-Hermes @('update', '--set-channel', $Cfg.UPDATE_CHANNEL) 300
    $lvl = if ($r.ExitCode -eq 0) { 'WARN' } else { 'ERROR' }
    Write-Log $lvl 'channel.repair' "Hermes channel record was '$(if ($cur) { $cur } else { 'unset' })'; re-applied official 'hermes update --set-channel $($Cfg.UPDATE_CHANNEL)' (exit $($r.ExitCode))" @{ output = (($r.StdOut + $r.StdErr).Trim()) }
  }
}

function Get-FreeGB([string]$path) {
  try { $root = [IO.Path]::GetPathRoot($path); $d = New-Object IO.DriveInfo($root); return [Math]::Round($d.AvailableFreeSpace / 1GB, 2) } catch { return $null }
}

function Get-RunningHermesUpdate {
  try {
    # Cheap pre-filter: no hermes/python process at all -> no update can be running.
    if (-not (Get-Process -Name hermes, python, pythonw -ErrorAction SilentlyContinue)) { return @() }
    return @(Get-CimInstance Win32_Process -Filter "Name='hermes.exe' OR Name='python.exe' OR Name='node.exe' OR Name='cmd.exe'" -ErrorAction Stop |
      Where-Object { $_.CommandLine -and $_.CommandLine -match '(?i)hermes(\.js|\.cmd|\.exe)?"?\s+update(\s|$)' -and $_.CommandLine -notmatch '--check|--plan|--list-venv-holders|--help' -and $_.ProcessId -ne $PID } |
      Select-Object -ExpandProperty ProcessId)
  } catch { return @() }
}

function Test-Online { try { return [System.Net.NetworkInformation.NetworkInterface]::GetIsNetworkAvailable() } catch { return $true } }

# --------------------------------------------------------------------------- zero-backup helpers
# NOTE: this updater intentionally contains NO backup / snapshot / archive code.
function Prune-Dir([string]$dir, [string]$filter, [int]$keep) {
  # Used only for rotating the updater's own run logs.
  Get-ChildItem -LiteralPath $dir -Filter $filter -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -Skip $keep |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}

function Use-PreferredGit {
  # Prefer the modern Git that Hermes' own package manager installed (user scope, no UAC) over the
  # old system Git. Applied to this process only, so `hermes update` launched from here inherits it.
  if ($Cfg.PM_GIT -and (Test-Path -LiteralPath $Cfg.PM_GIT)) {
    $dir = Split-Path -Parent $Cfg.PM_GIT
    if (-not (($env:PATH -split ';') -contains $dir)) { $env:PATH = $dir + ';' + $env:PATH }
    return $Cfg.PM_GIT
  }
  if (-not $Cfg.PREFER_PM_GIT) { return $null }
  try {
    $cand = Get-ChildItem -LiteralPath (Join-Path $Cfg.HERMES_HOME 'tools') -Directory -Filter 'git-*' -ErrorAction Stop |
      Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'cmd\git.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($cand) {
      $dir = Split-Path -Parent $cand
      if (-not (($env:PATH -split ';') -contains $dir)) { $env:PATH = $dir + ';' + $env:PATH }
      return $cand
    }
  } catch { }
  return $null
}

function Get-OfficialBackupSetting {
  # updates.pre_update_backup from config.yaml (quick | full | off; legacy true/false)
  $p = Join-Path $Cfg.HERMES_HOME 'config.yaml'
  try { $txt = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) } catch { return $null }
  $m = [regex]::Match($txt, '(?ms)^updates:\s*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+pre_update_backup:\s*["'']?([A-Za-z]+)')
  if ($m.Success) { return $m.Groups[1].Value.ToLower() }
  return 'quick (default)'
}
function Ensure-OfficialNoBackup {
  $v = Get-OfficialBackupSetting
  if ($v -in @('off', 'false')) { return $v }
  $r = Invoke-Hermes @('config', 'set', 'updates.pre_update_backup', 'off') 180
  Write-Log $(if ($r.ExitCode -eq 0) { 'WARN' } else { 'ERROR' }) 'backup.policy' "official updates.pre_update_backup was '$v'; re-applied 'off' (exit $($r.ExitCode))"
  return (Get-OfficialBackupSetting)
}

function Get-PmPython {
  if ($Cfg.PM_PYTHON -and (Test-Path -LiteralPath $Cfg.PM_PYTHON)) { return $Cfg.PM_PYTHON }
  try {
    return Get-ChildItem -LiteralPath (Join-Path $Cfg.HERMES_HOME 'tools') -Directory -Filter 'python-*' -ErrorAction Stop |
      Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'python.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  } catch { return $null }
}
function Get-DbSchemaFingerprint {
  # Read-only fingerprint of state.db (PRAGMA user_version + schema SQL hash). Used to decide whether
  # a code-only rollback is still compatible with the live data. 'absent' = no DB; $null = unknown.
  $db = Join-Path $Cfg.HERMES_HOME 'state.db'
  if (-not (Test-Path -LiteralPath $db)) { return 'absent' }
  $py = Get-PmPython; if (-not $py) { return $null }
  $code = "import sqlite3,hashlib,sys,pathlib; c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True); v=c.execute('pragma user_version').fetchone()[0]; s=''.join((r[0] or '') for r in c.execute('select sql from sqlite_master order by type,name')); print(str(v)+':'+hashlib.sha1(s.encode()).hexdigest())"
  $r = Invoke-Proc -File $py -ArgList @('-I', '-c', $code, $db) -TimeoutSec 60
  if ($r.ExitCode -eq 0 -and $r.StdOut.Trim() -match '^\d+:[0-9a-f]{40}$') { return $r.StdOut.Trim() }
  return $null
}

function Test-Customizations([switch]$Repair) {
  # Required local source customizations (config CUSTOMIZATIONS). Verifies each marker is present and,
  # with -Repair, re-inserts it after its anchor line when an update dropped it. No copies are made.
  $out = @()
  foreach ($c in @($Cfg.CUSTOMIZATIONS)) {
    if (-not $c -or -not $c['file']) { continue }
    $path = Join-Path $Cfg.CHECKOUT_DIR ($c['file'] -replace '/', '\')
    $st = [ordered]@{ file = $c['file']; marker = $c['marker']; present = $false; native = $false; repaired = $false; error = $null }
    try {
      $txt = [IO.File]::ReadAllText($path, (New-Object Text.UTF8Encoding($false)))
      $st.present = $txt.Contains($c['marker'])
      if ($st.present) {
        $d = Invoke-Git @('-C', $Cfg.CHECKOUT_DIR, 'diff', '--quiet', 'HEAD', '--', $c['file']) 30
        $st.native = ($d.ExitCode -eq 0)   # marker present without a local diff => upstream ships it natively
      } elseif ($Repair) {
        $nl = if ($txt.Contains("`r`n")) { "`r`n" } else { "`n" }
        $idx = $txt.IndexOf($c['anchor'])
        if ($idx -lt 0) { $st.error = 'anchor not found (upstream changed this code) - needs attention' }
        else {
          $eol = $txt.IndexOf("`n", $idx); if ($eol -lt 0) { $eol = $txt.Length - 1 }
          $new = $txt.Substring(0, $eol + 1) + $c['insert'] + $nl + $txt.Substring($eol + 1)
          $py = Get-PmPython
          [IO.File]::WriteAllText($path, $new, (New-Object Text.UTF8Encoding($false)))
          if ($py -and $path -match '\.py$') {
            $v = Invoke-Proc -File $py -ArgList @('-I', '-c', "import ast,sys; ast.parse(open(sys.argv[1],encoding='utf-8').read())", $path) -TimeoutSec 30
            if ($v.ExitCode -ne 0) { [IO.File]::WriteAllText($path, $txt, (New-Object Text.UTF8Encoding($false))); $st.error = 're-insert produced invalid syntax; reverted to upstream file' }
          }
          if (-not $st.error) { $st.present = $true; $st.repaired = $true }
        }
      }
    } catch { $st.error = $_.Exception.Message }
    $out += , $st
  }
  return $out
}

function Clear-UpdateArtifacts([string]$preStashTop) {
  # After a VERIFIED update: remove the transient recovery copies the official updater may leave
  # (rescue refs, recovery closure, quick-snapshot dirs, last-known-good config copies, autostash
  # entries whose only content is a verified customization). Nothing active is touched.
  if (-not $Cfg.CLEAN_UPDATE_ARTIFACTS) { return @() }
  $done = @()
  $co = $Cfg.CHECKOUT_DIR; $hh = $Cfg.HERMES_HOME
  # 1) rescue refs refs/hermes-update-backups/*
  $refs = Invoke-Git @('-C', $co, 'for-each-ref', '--format=%(refname)', 'refs/hermes-update-backups') 30
  foreach ($ref in @(($refs.StdOut -split "`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
    $d = Invoke-Git @('-C', $co, 'update-ref', '-d', $ref) 30; if ($d.ExitCode -eq 0) { $done += "ref $ref" }
  }
  # 2) recovery closure (only when no interrupted update is pending)
  $gd = Join-Path $co '.git'
  $marker = @(Get-ChildItem -LiteralPath $gd -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)interrupted|pull-marker|hermes-update-pull' })
  $rc = Join-Path $gd 'hermes-update-recovery'
  if ((Test-Path -LiteralPath $rc) -and $marker.Count -eq 0) { Remove-Item -LiteralPath $rc -Recurse -Force -ErrorAction SilentlyContinue; if (-not (Test-Path -LiteralPath $rc)) { $done += 'recovery closure .git\hermes-update-recovery' } }
  # 3) official quick snapshots + last-known-good config copies (all profiles)
  $homes = @($hh) + @(Get-ChildItem -LiteralPath (Join-Path $hh 'profiles') -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  foreach ($hd in $homes) {
    foreach ($sub in @('state-snapshots', 'backups\config')) {
      $p = Join-Path $hd $sub
      if (Test-Path -LiteralPath $p) {
        foreach ($it in @(Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue)) {
          if ($it.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }   # never follow links
          Remove-Item -LiteralPath $it.FullName -Recurse -Force -ErrorAction SilentlyContinue
          if (-not (Test-Path -LiteralPath $it.FullName)) { $done += "$sub\$($it.Name)" }
        }
      }
    }
  }
  # 4) autostash entries created by hermes update: drop only when they touch nothing but verified customizations
  $custFiles = @(@($Cfg.CUSTOMIZATIONS) | Where-Object { $_ } | ForEach-Object { $_['file'] })
  $cust = Test-Customizations
  $allPresent = (@($cust | Where-Object { -not $_.present }).Count -eq 0)
  $list = Invoke-Git @('-C', $co, 'stash', 'list', '--format=%H %gs') 30
  foreach ($ln in @(($list.StdOut -split "`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ -match 'hermes-update-autostash' })) {
    $sha = ($ln -split ' ')[0]
    $files = Invoke-Git @('-C', $co, 'stash', 'show', '--name-only', $sha) 30
    $touched = @(($files.StdOut -split "`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $onlyCust = ($touched.Count -gt 0) -and (@($touched | Where-Object { $custFiles -notcontains $_ }).Count -eq 0)
    if ($onlyCust -and $allPresent) {
      $idx = Invoke-Git @('-C', $co, 'stash', 'list', '--format=%H %gd') 30
      $m = [regex]::Match($idx.StdOut, ([regex]::Escape($sha) + ' (stash@\{\d+\})'))
      if ($m.Success) { $dr = Invoke-Git @('-C', $co, 'stash', 'drop', $m.Groups[1].Value) 30; if ($dr.ExitCode -eq 0) { $done += "autostash $($sha.Substring(0,8))" } }
    } else {
      Write-Log 'WARN' 'artifacts.keep' "autostash $($sha.Substring(0,8)) kept: it holds changes beyond the verified customizations ($($touched -join ', ')) - needs attention"
    }
  }
  return $done
}

# --------------------------------------------------------------------------- smoke tests
function Test-HermesHealth {
  $v = Invoke-Hermes @('--version') 180
  $ver = ($v.StdOut + $v.StdErr).Trim()
  $okVer = ($v.ExitCode -eq 0 -and $ver -match 'Hermes Agent')
  $c = Invoke-Hermes @('config', 'check') 180
  $okCfg = ($c.ExitCode -eq 0)
  return [ordered]@{ ok = ($okVer); version_ok = $okVer; config_ok = $okCfg; version = (($ver -split "`n") | Select-Object -First 1); config_exit = $c.ExitCode }
}

# --------------------------------------------------------------------------- update executor
function Invoke-UpdateExecutor([string]$targetSha, [string]$reason, [switch]$Force) {
  $updMutex = New-NamedMutex 'Update'
  if (-not (Enter-Mutex $updMutex 0)) { Write-Log 'WARN' 'update.skip' 'another updater instance holds the update lock'; $updMutex.Dispose(); return @{ result = 'skipped_locked' } }
  try {
    $running = @(Get-RunningHermesUpdate)
    if ($running.Count -gt 0) { Write-Log 'WARN' 'update.skip' "a 'hermes update' process is already running (pid $($running -join ','))"; return @{ result = 'skipped_running' } }

    # ---- B. preparation
    $free = Get-FreeGB $Cfg.CHECKOUT_DIR; $freeHome = Get-FreeGB $Cfg.HERMES_HOME
    if (($null -ne $free -and $free -lt [double]$Cfg.MIN_FREE_DISK_GB) -or ($null -ne $freeHome -and $freeHome -lt [double]$Cfg.MIN_FREE_DISK_GB)) {
      Write-Log 'ERROR' 'update.blocked' "insufficient disk space (checkout drive ${free} GB, home drive ${freeHome} GB, need $($Cfg.MIN_FREE_DISK_GB) GB)" @{ error_category = 'disk_full' }
      Update-State { param($s) $s.last_error = 'disk_full'; $s.last_error_at = (NowIso) } | Out-Null
      return @{ result = 'blocked_disk' }
    }
    $vh = Get-VenvHolders
    $nonGateway = @($vh.holders | Where-Object { -not ([string]$_['kind'] -match '^gateway') })
    if ($nonGateway.Count -gt 0) {
      $desc = ($nonGateway | ForEach-Object { "$($_['kind'])#$($_['pid'])" }) -join ', '
      Write-Log 'INFO' 'update.deferred' "Hermes is busy (active processes hold the runtime: $desc); not interrupting - will retry next cycle" @{ busy = $desc }
      Update-State { param($s) $s.deferred_busy_since = $(if (SGet $s 'deferred_busy_since') { $s.deferred_busy_since } else { NowIso }); $s.last_deferred_reason = "busy: $desc" } | Out-Null
      return @{ result = 'deferred_busy' }
    }
    $gwBefore = Get-GatewayRunning
    $pre = Get-LocalInfo -Full
    if (-not (Test-OfficialOrigin $pre.origin)) { Write-Log 'ERROR' 'update.blocked' "checkout origin is not the official repository: $($pre.origin)"; return @{ result = 'blocked_origin' } }
    $preHealth = Test-HermesHealth
    $preRc = Get-LatestReceipt; $preRcId = if ($preRc) { $preRc['update_id'] } else { $null }
    $backupPolicy = Ensure-OfficialNoBackup      # official updates.pre_update_backup must stay 'off'
    $preSchema = Get-DbSchemaFingerprint          # read-only; decides later whether a code rollback is data-compatible
    $gitUsed = (Invoke-Git @('--version') 15).StdOut.Trim()
    Write-Log 'INFO' 'update.start' "updating $($pre.head) -> $(if ($targetSha) { $targetSha } else { 'latest stable' }) (reason: $reason)" @{
      channel = $Cfg.UPDATE_CHANNEL; installed_commit = $pre.head; target_commit = $targetSha; installed_version = $preHealth.version
      backup = 'disabled (zero-backup)'; official_pre_update_backup = $backupPolicy; db_schema = $preSchema; git = $gitUsed; command = 'hermes update --no-backup --yes'; gateway_running_before = $gwBefore }
    $started = Get-Now
    Update-State { param($s) $s.update_in_progress = $true; $s.update_started = (Fmt $started); $s.update_target = $targetSha; $s.update_pid = $PID; $s.update_pre_commit = $pre.head } | Out-Null

    # ---- C. official update
    $runLog = Join-Path $RunLogDir ("update-{0}.log" -f $started.ToString('yyyyMMdd-HHmmss'))
    $hargs = @('update', '--no-backup', '--yes')   # zero-backup: never a quick snapshot nor a zip
    if (-not $Cfg.AUTO_RESTART_AFTER_UPDATE) { $hargs += '--no-gateway-restart' }
    $r = Invoke-Hermes $hargs ([int]$Cfg.UPDATE_TIMEOUT_MINUTES * 60) $runLog -BelowNormal
    $outText = ''
    try { $outText = [IO.File]::ReadAllText($runLog, [Text.Encoding]::UTF8) } catch { }
    $outText = $outText + "`n" + $r.StdErr
    [IO.File]::WriteAllText($runLog, (Redact $outText), [Text.Encoding]::UTF8)
    Prune-Dir $RunLogDir 'update-*.log' ([int]$Cfg.RUN_LOG_KEEP)

    if ($r.TimedOut) {
      Write-Log 'ERROR' 'update.timeout' "official updater still running after $($Cfg.UPDATE_TIMEOUT_MINUTES) min (pid $($r.Pid)); NOT terminating it (ALLOW_FORCE_TERMINATION=false). Lock released; next cycles will wait for it." @{ error_category = 'timeout'; run_log = $runLog }
      Update-State { param($s) $s.update_in_progress = $false; $s.last_error = 'timeout'; $s.last_error_at = (NowIso) } | Out-Null
      return @{ result = 'timeout' }
    }

    # ---- D. validation
    $post = Get-LocalInfo -Full
    $health = Test-HermesHealth
    $rc = Get-LatestReceipt; $rcs = Get-ReceiptSummary $rc
    $receiptNew = ($rc -and $rc['update_id'] -and $rc['update_id'] -ne $preRcId)
    if (-not $receiptNew) { $rcs = $null }
    $chk = Invoke-OfficialCheck
    $gwAfter = if ($gwBefore) { Get-GatewayRunning } else { $gwBefore }
    $followUps = @(); if ($rcs) { foreach ($k in @('follow_ups', 'followups', 'follow_up')) { if ($rcs.Contains($k)) { $followUps += $rcs[$k] } } }
    $outcome = if ($rcs) { [string](@($rcs['outcome'], $rcs['result'], $rcs['status']) | Where-Object { $_ } | Select-Object -First 1) } else { '' }
    $moved = ($post.head -and $post.head -ne $pre.head)
    $reachedTarget = (-not $targetSha) -or ($post.head -eq $targetSha) -or ($chk.available -eq $false)
    # required local customizations: verify, re-insert if the update dropped them (no copies kept)
    $cust = @(Test-Customizations -Repair)
    $custMissing = @($cust | Where-Object { -not $_.present })
    $custNote = if ($custMissing.Count -gt 0) { 'customization missing: ' + (($custMissing | ForEach-Object { "$($_.file) ($($_.error))" }) -join '; ') } else { $null }

    $result = 'failed'
    if ($r.ExitCode -eq 0 -and $health.ok -and $reachedTarget) {
      $result = 'success'
      $realFollowUps = @($followUps | Where-Object { [string]$_ -notmatch '(?i)^(snapshot:\s*skipped|pm_venv_rebuild:\s*already\s+in\s+sync)$' })
      if ($realFollowUps.Count -gt 0 -or ($outcome -and $outcome -notmatch '(?i)^success$') -or ($gwBefore -and -not $gwAfter) -or -not $receiptNew -or $custNote) { $result = 'partial' }
    } elseif ($r.ExitCode -eq 0 -and $health.ok -and -not $reachedTarget) {
      $result = 'partial'
    }
    $cat = if ($result -eq 'failed') { Get-ErrorCategory $outText } else { $null }
    $finished = Get-Now; $dur = [int]($finished - $started).TotalSeconds

    $recovery = $null
    if ($result -eq 'failed' -and $Cfg.AUTO_RECOVERY_ENABLED) {
      $recovery = Invoke-Recovery $pre $post $health $cat $runLog $preSchema
      if ($recovery.healthy) { $post = Get-LocalInfo; $health = Test-HermesHealth }
    }
    $cleaned = @()
    if ($result -in @('success', 'partial') -and $health.ok) { try { $cleaned = @(Clear-UpdateArtifacts) } catch { Write-Log 'WARN' 'artifacts' "cleanup failed: $($_.Exception.Message)" } }
    if ($result -in @('success', 'partial') -and $Cfg.HERMES_HOME -eq $ALLINONE_HERMES_HOME) {
      $hp = Join-Path $Root 'hermes-health.ps1'
      if (Test-Path -LiteralPath $hp) {
        try {
          $hOut = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $hp -Heal -Json 2>$null
          $gwAfter = Get-GatewayRunning
          Write-Log 'INFO' 'update.post_health' 'verified gateway & computer_use post-update health' @{ gateway_running = $gwAfter }
        } catch { Write-Log 'WARN' 'update.post_health' "post-update health heal warning: $($_.Exception.Message)" }
      }
    }
    $data = [ordered]@{ channel = $Cfg.UPDATE_CHANNEL; installed_commit_before = $pre.head; installed_commit = $post.head; target_commit = $targetSha
      exit_code = $r.ExitCode; result = $result; duration_s = $dur; update_start = (Fmt $started); update_finish = (Fmt $finished)
      version = $health.version; health_ok = $health.ok; config_check_ok = $health.config_ok; receipt = $rcs; receipt_new = [bool]$receiptNew; follow_ups = $followUps
      gateway_before = $gwBefore; gateway_after = $gwAfter; backup = 'disabled'; customizations = $cust; customization_note = $custNote; artifacts_removed = $cleaned; error_category = $cat; recovery = $recovery; run_log = $runLog; post_check_available = $chk.available }
    $lvl = switch ($result) { 'success' { 'INFO' } 'partial' { 'WARN' } default { 'ERROR' } }
    Write-Log $lvl 'update.finish' "update $result in ${dur}s: $($pre.head) -> $($post.head) [$($health.version)]" $data

    Update-State {
      param($s)
      $s.update_in_progress = $false; $s.last_update_attempt = (Fmt $finished); $s.last_update_result = $result; $s.last_update_duration_s = $dur
      $s.last_update_run_log = $runLog; $s.last_update_follow_ups = $followUps; $s.deferred_busy_since = $null
      if ($result -in @('success', 'partial')) {
        $s.last_update_success = (Fmt $finished); $s.consecutive_update_failures = 0; $s.last_error = $null
        $s.needs_attention = $custNote
        $s.restart_pending = [bool](@($followUps | Where-Object { $_ -match '(?i)restart|gateway' }).Count -gt 0 -or ($gwBefore -and -not $gwAfter))
        if ($targetSha -and $s.Contains('failed_targets') -and $s.failed_targets -and $s.failed_targets.Contains($targetSha)) { $s.failed_targets.Remove($targetSha) }
      } else {
        $s.consecutive_update_failures = [int](SGet $s 'consecutive_update_failures' 0) + 1
        $s.last_error = $cat; $s.last_error_at = (Fmt $finished)
        if (-not $s.Contains('failed_targets') -or -not $s.failed_targets) { $s.failed_targets = [ordered]@{} }
        $key = if ($targetSha) { $targetSha } else { 'stable:' + (SGet $s 'remote_signature' '') }
        $prev = if ($s.failed_targets.Contains($key)) { $s.failed_targets[$key] } else { [ordered]@{ attempts = 0 } }
        $att = [int]$prev['attempts'] + 1
        $transient = $cat -in @('network_error', 'network_offline', 'github_unavailable', 'rate_limited', 'disk_full')
        $mins = [Math]::Min([double]$Cfg.FAILED_TARGET_COOLDOWN_MAX_MINUTES, [double]$Cfg.FAILED_TARGET_COOLDOWN_MINUTES * [Math]::Pow(2, $att - 1))
        if ($transient) { $mins = [Math]::Min($mins, 30) }
        $s.failed_targets[$key] = [ordered]@{ attempts = $att; category = $cat; last = (Fmt $finished); retry_after = (Fmt ((Get-Now).AddMinutes($mins))); quarantined = (($att -ge [int]$Cfg.MAX_ATTEMPTS_PER_TARGET) -and -not $transient); run_log = $runLog }
        # Never pause permanently: flag it, quarantine this commit, keep monitoring for a newer upstream commit.
        if ($recovery -and $recovery.manual_required) { $s.needs_attention = $recovery.message; $s.failed_targets[$key]['quarantined'] = $true }
        # keep map small
        if ($s.failed_targets.Count -gt 20) { $old = @($s.failed_targets.Keys | Select-Object -First ($s.failed_targets.Count - 20)); foreach ($k in $old) { $s.failed_targets.Remove($k) } }
      }
    } | Out-Null
    return @{ result = $result; data = $data }
  } finally {
    try { $updMutex.ReleaseMutex() } catch { }
    $updMutex.Dispose()
    Update-State { param($s) if (SGet $s 'update_pid') { if ($s.update_pid -eq $PID) { $s.update_in_progress = $false } } } | Out-Null
  }
}

function Invoke-Recovery($pre, $post, $health, [string]$cat, [string]$runLog, [string]$preSchema) {
  $steps = @()
  # 1) Transient / nothing changed: no repair needed, the old install is intact.
  if ($post.head -eq $pre.head -and $health.ok) {
    $steps += 'checkout unchanged and Hermes healthy - nothing to recover'
    return @{ healthy = $true; steps = $steps; manual_required = $false; message = 'no change' }
  }
  # 2) Official self-repair: re-running `hermes update` finishes owed steps (deps sync, rebuilds, restarts).
  if ($cat -notin @('disk_full', 'network_offline')) {
    $steps += 'rerun official updater to complete owed steps'
    $r2 = Invoke-Hermes @('update', '--no-backup', '--yes') ([int]$Cfg.UPDATE_TIMEOUT_MINUTES * 60) ($runLog -replace '\.log$', '-repair.log') -BelowNormal
    $h2 = Test-HermesHealth
    if ($r2.ExitCode -eq 0 -and $h2.ok) { $steps += 'repair succeeded'; Write-Log 'WARN' 'recovery' 'official re-run repaired the installation' @{ steps = $steps }; return @{ healthy = $true; steps = $steps; manual_required = $false; message = 'repaired by re-run' } }
    $steps += "repair exit=$($r2.ExitCode) health=$($h2.ok)"
    $health = $h2
  }
  if ($health.ok) {
    $steps += 'Hermes still starts; leaving code in place, target quarantined after retries'
    return @{ healthy = $true; steps = $steps; manual_required = $false; message = 'degraded but runnable' }
  }
  # 3) Hermes no longer starts. Code-only rollback is only safe when no Hermes process ran
  #    the new code against user data. We never touch HERMES_HOME data automatically.
  $vh = Get-VenvHolders
  if (@($vh.holders).Count -gt 0) {
    $msg = "Hermes broken after update and Hermes processes are running (not interrupted); needs attention. Pre-update commit $($pre.head). No backups exist (zero-backup policy)."
    Write-Log 'ERROR' 'recovery' $msg @{ steps = $steps }; return @{ healthy = $false; steps = $steps; manual_required = $true; message = $msg }
  }
  # Without backups a rollback is only allowed when the live database schema is exactly what the old
  # code knew (read-only fingerprint before vs now). Otherwise older code could misread migrated data.
  $nowSchema = Get-DbSchemaFingerprint
  if (-not $preSchema -or -not $nowSchema -or $preSchema -ne $nowSchema) {
    $msg = "Hermes broken after update; code rollback REFUSED (state.db schema ${preSchema} -> ${nowSchema}; not provably compatible, no backups exist). Commit quarantined; monitoring continues for a fixed upstream commit. See $runLog"
    Write-Log 'ERROR' 'recovery' $msg @{ steps = $steps }; return @{ healthy = $false; steps = $steps; manual_required = $true; message = $msg; rollback_refused = $true }
  }
  $steps += "code rollback (schema unchanged $nowSchema): git checkout --detach $($pre.head)"
  $co = Invoke-Git @('-C', $Cfg.CHECKOUT_DIR, 'checkout', '--detach', $pre.head) 300
  if ($co.ExitCode -ne 0) {
    # If checkout was blocked ONLY by our declarative customizations (no unknown user edits), revert
    # those declarative lines to HEAD, switch to $pre.head, then re-apply customizations below.
    $custFiles = @(@($Cfg.CUSTOMIZATIONS) | Where-Object { $_ } | ForEach-Object { $_['file'] })
    $stDirty = Invoke-Git @('-C', $Cfg.CHECKOUT_DIR, 'status', '--porcelain', '--untracked-files=no') 30
    $modFiles = @(($stDirty.StdOut -split "`n") | ForEach-Object { if ($_ -match '^.{2}\s+(.+?)\r?$') { $Matches[1].Trim() } } | Where-Object { $_ })
    if ($modFiles.Count -gt 0 -and @($modFiles | Where-Object { $custFiles -notcontains $_ }).Count -eq 0) {
      $null = Invoke-Git (@('-C', $Cfg.CHECKOUT_DIR, 'checkout', 'HEAD', '--') + $custFiles) 60
      $co = Invoke-Git @('-C', $Cfg.CHECKOUT_DIR, 'checkout', '--detach', $pre.head) 300
    }
  }
  if ($co.ExitCode -eq 0) { $null = Test-Customizations -Repair }
  $h3 = Test-HermesHealth
  if ($co.ExitCode -eq 0 -and $h3.ok) {
    $msg = "rolled back code to $($pre.head) (database schema unchanged, so compatible); Hermes healthy. Data untouched. No backups exist."
    Write-Log 'WARN' 'recovery' $msg @{ steps = $steps }
    return @{ healthy = $true; steps = $steps; manual_required = $false; message = $msg; rolled_back = $true }
  }
  $msg = "automatic recovery failed (rollback exit=$($co.ExitCode), health=$($h3.ok)); needs attention, commit quarantined, monitoring continues; user data untouched; see $runLog"
  Write-Log 'ERROR' 'recovery' $msg @{ steps = $steps }
  return @{ healthy = $false; steps = $steps; manual_required = $true; message = $msg }
}

# --------------------------------------------------------------------------- one monitoring cycle
function Invoke-Cycle([string]$reason = 'schedule', [switch]$ForceUpdate) {
  $Script:Cfg = Get-Config
  $Script:GitExe = Use-PreferredGit
  $s = Read-State
  $now = Get-Now
  $isDaily = (([string]$Cfg.SCHEDULE_MODE).ToLower() -eq 'daily')
  $dailyWin = if ($isDaily) { Get-DailyScheduleWindow $now } else { $null }
  $nextDue = if ($isDaily) { $dailyWin.next_slot } else { $now.AddSeconds([int]$Cfg.CHECK_INTERVAL_SECONDS) }
  if (-not $Cfg.AUTO_UPDATE_ENABLED -and $reason -notin @('manual', 'manual-update')) { Update-State { param($s) $s.last_cycle = (NowIso); $s.last_cycle_result = 'disabled' } | Out-Null; return 'disabled' }
  if ((SGet $s 'paused' $false) -and $reason -notin @('manual', 'manual-update')) { Update-State { param($s) $s.last_cycle = (NowIso); $s.last_cycle_result = 'paused' } | Out-Null; return 'paused' }

  if ($isDaily -and $reason -notin @('manual', 'manual-update')) {
    $doneSlot = Parse-Iso (SGet $s 'last_daily_slot_completed')
    if ($doneSlot -and $doneSlot -ge $dailyWin.due_slot) {
      Update-State { param($s) $s.last_cycle = (NowIso); $s.last_cycle_result = 'waiting_daily_window'; $s.next_check = (Fmt $dailyWin.next_slot); $s.schedule_mode = 'daily' } | Out-Null
      return 'waiting_daily_window'
    }
    if ($dailyWin.is_catchup -and (SGet $s 'last_catchup_logged_slot') -ne (Fmt $dailyWin.due_slot)) {
      Write-Log 'INFO' 'schedule.catchup' "missed $($dailyWin.hhmm) daily window ($(Fmt $dailyWin.due_slot)) while computer was off/offline; running catch-up check now"
      Update-State { param($s) $s.last_catchup_logged_slot = (Fmt $dailyWin.due_slot) } | Out-Null
    }
  }

  $backoffUntil = Parse-Iso (SGet $s 'backoff_until')
  if ($backoffUntil -and $backoffUntil -gt $now -and $reason -notin @('manual', 'manual-update', 'reconnect')) { return 'backoff' }

  # update still running from an earlier timed-out run?
  if (@(Get-RunningHermesUpdate).Count -gt 0) { Write-Log 'INFO' 'check.skip' 'official hermes update process is running; skipping cycle'; return 'update_running' }

  # ---- connectivity + remote target
  if (-not (Test-Online)) {
    $retryDue = $now.AddSeconds([int]$Cfg.CHECK_INTERVAL_SECONDS)
    Update-State { param($s) $s.last_cycle = (NowIso); $s.last_cycle_result = 'offline'; $s.online = $false; $s.next_check = (Fmt $retryDue) } | Out-Null
    if ((SGet $s 'online' $true)) { Write-Log 'WARN' 'network' 'no network connectivity; waiting for reconnect' @{ error_category = 'network_offline' } }
    return 'offline'
  }
  $rt = Get-RemoteTarget
  if (-not $rt.ok) {
    $fails = [int](SGet $s 'consecutive_check_failures' 0) + 1
    $base = [double]$Cfg.CHECK_INTERVAL_SECONDS
    $mult = if ($rt.category -eq 'rate_limited') { 8 } else { 1 }
    $delay = [Math]::Min([double]$Cfg.MAX_BACKOFF_SECONDS, $base * $mult * [Math]::Pow(2, [Math]::Min($fails, 10) - 1))
    $delay = [int]($delay * (0.85 + (Get-Random -Maximum 0.3)))
    $until = (Get-Now).AddSeconds($delay)
    Write-Log 'WARN' 'check.error' "remote check failed (#$fails, $($rt.category)): $($rt.error); backing off ${delay}s" @{ error_category = $rt.category; retry_count = $fails; next_check = (Fmt $until) }
    Update-State { param($s) $s.last_cycle = (NowIso); $s.last_cycle_result = "check_failed:$($rt.category)"; $s.consecutive_check_failures = $fails; $s.backoff_until = (Fmt $until); $s.next_check = (Fmt $until); $s.last_error = $rt.category; $s.last_error_at = (NowIso); $s.online = $true } | Out-Null
    return 'check_failed'
  }

  $loc = Get-LocalInfo
  if (-not $loc.head) {
    Write-Log 'ERROR' 'check.local_unknown' "cannot resolve the installed commit in $($Cfg.CHECKOUT_DIR); not updating" @{ error_category = 'git_invalid' }
    Update-State { param($s) $s.last_cycle = (NowIso); $s.last_cycle_result = 'local_unknown'; $s.last_error = 'git_invalid'; $s.last_error_at = (NowIso); $s.next_check = (Fmt $nextDue) } | Out-Null
    return 'local_unknown'
  }
  try { Ensure-Channel } catch { Write-Log 'WARN' 'channel.repair' "channel verification failed: $($_.Exception.Message)" }
  $wasFailing = [int](SGet $s 'consecutive_check_failures' 0)
  if ($wasFailing -gt 0) { Write-Log 'INFO' 'check.recovered' "remote check working again after $wasFailing failure(s)" }

  $available = $false; $target = $rt.sha; $note = ''
  $ftPrev = SGet $s 'failed_targets'
  $owedTarget = [bool]($target -and $ftPrev -and $ftPrev.Contains($target))
  if ($Cfg.UPDATE_CHANNEL -eq 'main') {
    if ($loc.head -and $target -and $loc.head -ne $target) {
      $anc = Invoke-Git @('-C', $Cfg.CHECKOUT_DIR, 'merge-base', '--is-ancestor', $target, 'HEAD') 20
      if ($anc.ExitCode -eq 0) { $note = 'local contains remote main'; $available = $false } else { $available = $true }
    } elseif ($owedTarget) {
      $available = $true; $note = 'previous update on this commit failed'
    }
  } else {
    $lastSig = SGet $s 'stable_checked_signature' ''
    $lastStable = Parse-Iso (SGet $s 'stable_checked_at')
    $due = ($rt.signature -ne $lastSig) -or (-not $lastStable) -or (($now - $lastStable).TotalHours -ge [double]$Cfg.STABLE_RECHECK_HOURS) -or $reason -like 'manual*' -or ($reason -in @('startup', 'reconnect'))
    if ($due) {
      $oc = Invoke-OfficialCheck
      Update-State { param($s) $s.stable_checked_signature = $rt.signature; $s.stable_checked_at = (NowIso); $s.stable_last_official = $oc.available } | Out-Null
      $available = ($oc.available -eq $true); $note = 'official --check'
    } else { $available = [bool](SGet $s 'stable_last_official' $false) }
  }

  Update-State {
    param($s)
    $s.last_cycle = (NowIso); $s.last_check = (NowIso); $s.last_check_reason = $reason; $s.online = $true
    $s.consecutive_check_failures = 0; $s.backoff_until = $null; $s.next_check = (Fmt $nextDue)
    $s.installed_commit = $loc.head; $s.installed_branch = $loc.branch; $s.checkout_dirty = $loc.dirty
    $s.remote_target = $target; $s.remote_signature = $rt.signature; $s.update_available = $available; $s.channel = $Cfg.UPDATE_CHANNEL
    if ((SGet $s 'last_error') -match '^(network|rate|github)') { $s.last_error = $null }
  } | Out-Null

  $jl = [ordered]@{ channel = $Cfg.UPDATE_CHANNEL; installed_commit = $loc.head; target_commit = $target; update_available = $available; reason = $reason; next_check = (Fmt $nextDue) }
  if (-not $available) {
    $lastHb = Parse-Iso (SGet $s 'last_heartbeat_log')
    $changed = ((SGet $s 'last_logged_state') -ne "up:$($loc.head):$target")
    if ($changed -or -not $lastHb -or ($now - $lastHb).TotalMinutes -ge [double]$Cfg.HEARTBEAT_MINUTES -or $reason -ne 'schedule' -or $isDaily) {
      Write-Log 'INFO' 'check.up_to_date' "no update ($($Cfg.UPDATE_CHANNEL)): installed $($loc.head) target $target $note" $jl
      Update-State { param($s) $s.last_heartbeat_log = (NowIso); $s.last_logged_state = "up:$($loc.head):$target"; $s.pending_target = $null; $s.pending_since = $null; if ($isDaily) { $s.last_daily_slot_completed = (Fmt $dailyWin.due_slot); $s.next_check = (Fmt $dailyWin.next_slot); $s.schedule_mode = 'daily' } } | Out-Null
    } else {
      Update-State { param($s) $s.pending_target = $null; $s.pending_since = $null } | Out-Null
      $dbg = [ordered]@{ ts = (NowIso); level = 'DEBUG'; event = 'check.up_to_date'; pid = $PID }; foreach ($k in $jl.Keys) { $dbg[$k] = $jl[$k] }; Rotate-File $JsonLogPath ([int]$Cfg.LOG_MAX_MB) ([int]$Cfg.LOG_KEEP); [IO.File]::AppendAllText($JsonLogPath, ($dbg | ConvertTo-Json -Compress) + "`n", [Text.Encoding]::UTF8)
    }
    return 'up_to_date'
  }

  # ---- update available: gating
  $s = Read-State
  $key = if ($target) { $target } else { 'stable:' + $rt.signature }
  if ((SGet $s 'pending_target') -ne $key) {
    Write-Log 'INFO' 'check.update_available' "update available ($($Cfg.UPDATE_CHANNEL)): $($loc.head) -> $(if ($target) { $target } else { 'new stable release' })" $jl
    Update-State { param($s) $s.pending_target = $key; $s.pending_target_seen = (NowIso); if (-not (SGet $s 'pending_since')) { $s.pending_since = (NowIso) } } | Out-Null
    $s = Read-State
  }
  if (-not $Cfg.UPDATE_ON_NEW_VERSION -and -not $ForceUpdate) { return 'available_auto_update_off' }

  $ft = SGet $s 'failed_targets'
  if ($ft -and $ft.Contains($key) -and -not $ForceUpdate) {
    $f = $ft[$key]
    if ($f['quarantined']) {
      if ($isDaily) { Update-State { param($s) $s.last_daily_slot_completed = (Fmt $dailyWin.due_slot); $s.next_check = (Fmt $dailyWin.next_slot) } | Out-Null }
      return 'target_quarantined'
    }
    $ra = Parse-Iso $f['retry_after']; if ($ra -and $ra -gt $now) { return 'target_cooldown' }
  }
  if (-not $ForceUpdate) {
    $nowG = Get-Now
    $seen = Parse-Iso (SGet $s 'pending_target_seen'); $since = Parse-Iso (SGet $s 'pending_since')
    $stable = ([double]$Cfg.STABILIZE_SECONDS -le 0) -or ($seen -and (($nowG - $seen).TotalSeconds -ge [double]$Cfg.STABILIZE_SECONDS))
    $tooLong = $since -and (($nowG - $since).TotalMinutes -ge [double]$Cfg.MAX_PENDING_MINUTES)
    if (-not ($stable -or $tooLong)) { return 'waiting_stabilize' }
    $lastUpd = Parse-Iso (SGet $s 'last_update_attempt')
    if (-not $isDaily -and $lastUpd -and (($nowG - $lastUpd).TotalMinutes -lt [double]$Cfg.MIN_UPDATE_INTERVAL_MINUTES)) { return 'waiting_min_interval' }
  }

  # Confirm with the official updater (also respects the channel saved in config.yaml)
  if ($Cfg.UPDATE_CHANNEL -eq 'main' -and -not $owedTarget) {
    $oc = Invoke-OfficialCheck
    if ($oc.available -eq $false) {
      Write-Log 'INFO' 'check.official_no_update' "official 'hermes update --check' reports no update; not reinstalling" @{ official = $oc.text }
      Update-State { param($s) $s.pending_target = $null; $s.pending_since = $null; $s.update_available = $false; if ($isDaily) { $s.last_daily_slot_completed = (Fmt $dailyWin.due_slot); $s.next_check = (Fmt $dailyWin.next_slot); $s.schedule_mode = 'daily' } } | Out-Null
      return 'official_no_update'
    }
  }
  $res = Invoke-UpdateExecutor $target $reason -Force:$ForceUpdate
  Update-State { param($s) if ($res.result -in @('success', 'partial')) { $s.pending_target = $null; $s.pending_since = $null; if ($isDaily) { $s.last_daily_slot_completed = (Fmt $dailyWin.due_slot); $s.next_check = (Fmt $dailyWin.next_slot); $s.schedule_mode = 'daily' } } } | Out-Null
  return "update:$($res.result)"
}

# --------------------------------------------------------------------------- daemon
function Start-Daemon {
  $Script:Cfg = Get-Config
  $dm = New-NamedMutex 'Daemon'
  if (-not (Enter-Mutex $dm 0)) { $dm.Dispose(); return }   # already running -> exit quietly
  try {
    $startedAt = Get-Now
    $schedDesc = if (([string]$Cfg.SCHEDULE_MODE).ToLower() -eq 'daily') { ('daily@{0:D2}:{1:D2} {2} + offline catch-up' -f [int]$Cfg.DAILY_CHECK_HOUR, [int]$Cfg.DAILY_CHECK_MINUTE, $Cfg.TIMEZONE) } else { "interval $($Cfg.CHECK_INTERVAL_SECONDS)s" }
    Update-State { param($s) $s.daemon_pid = $PID; $s.daemon_started = (Fmt $startedAt); $s.daemon_heartbeat = (Fmt $startedAt); $s.schedule_mode = $Cfg.SCHEDULE_MODE } | Out-Null
    Write-Log 'INFO' 'daemon.start' "monitor started (pid $PID, channel $($Cfg.UPDATE_CHANNEL), schedule $schedDesc)"
    $first = $true; $wasOnline = Test-Online
    $lastTick = [DateTime]::UtcNow; $nextRun = [DateTime]::UtcNow; $lastHealUtc = [DateTime]::MinValue
    while ($true) {
      $Script:Cfg = Get-Config
      $reason = 'schedule'
      $nowUtc = [DateTime]::UtcNow
      $online = Test-Online
      if ($first) { $reason = 'startup'; $nextRun = $nowUtc; if (-not $Cfg.UPDATE_ON_STARTUP) { $reason = 'schedule' } }
      if ((($nowUtc - $lastTick).TotalSeconds) -gt 120) { $reason = 'resume'; $nextRun = $nowUtc; Write-Log 'INFO' 'daemon.resume' "clock jump of $([int]($nowUtc - $lastTick).TotalSeconds)s detected (sleep/hibernate resume)" }
      if ($online -and -not $wasOnline) { if ($Cfg.UPDATE_AFTER_RECONNECT) { $reason = 'reconnect'; $nextRun = $nowUtc }; Write-Log 'INFO' 'network' 'network connectivity restored' }
      $wasOnline = $online; $lastTick = $nowUtc

      # manual requests from the CLI
      $s = Read-State
      $req = SGet $s 'request'
      if ($req) { Update-State { param($s) $s.request = $null } | Out-Null; $reason = if ($req -eq 'update') { 'manual-update' } else { 'manual' }; $nextRun = $nowUtc }

      if ($nowUtc -ge $nextRun) {
        try {
          $out = Invoke-Cycle $reason -ForceUpdate:($reason -eq 'manual-update')
          Update-State { param($s) $s.last_cycle_result = $out; if ($req) { $s.request_result = $out; $s.request_done = (NowIso) } } | Out-Null
          if ($Cfg.HERMES_HOME -eq $ALLINONE_HERMES_HOME -and ($out -ne 'waiting_daily_window' -or (($nowUtc - $lastHealUtc).TotalSeconds -ge 300))) {
            $hp = Join-Path $Root 'hermes-health.ps1'
            if (Test-Path -LiteralPath $hp) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $hp -Heal -Json 2>$null | Out-Null; $lastHealUtc = [DateTime]::UtcNow }
          }
        } catch {
          Write-Log 'ERROR' 'daemon.cycle' "cycle crashed: $($_.Exception.Message) @ $($_.InvocationInfo.ScriptLineNumber)"
        }
        $st = Read-State
        $bo = Parse-Iso (SGet $st 'backoff_until')
        $nextRun = [DateTime]::UtcNow.AddSeconds([int]$Cfg.CHECK_INTERVAL_SECONDS)
        if ($bo -and $bo.UtcDateTime -gt $nextRun) { $nextRun = $bo.UtcDateTime }
        if (([string]$Cfg.SCHEDULE_MODE).ToLower() -eq 'daily') {
          $dw = Get-DailyScheduleWindow (Get-Now)
          $doneS = Parse-Iso (SGet $st 'last_daily_slot_completed')
          if ($doneS -and $doneS -ge $dw.due_slot) {
            Update-State { param($s) $s.next_check = (Fmt $dw.next_slot); $s.schedule_mode = 'daily' } | Out-Null
          } else {
            Update-State { param($s) $s.next_check = (Fmt ([DateTimeOffset]::new($nextRun).ToOffset((Get-Now).Offset))); $s.schedule_mode = 'daily' } | Out-Null
          }
        } else {
          Update-State { param($s) $s.next_check = (Fmt ([DateTimeOffset]::new($nextRun).ToOffset((Get-Now).Offset))); $s.schedule_mode = 'interval' } | Out-Null
        }
        $first = $false
        $lastTick = [DateTime]::UtcNow   # a long cycle (e.g. an update) is not a sleep/resume
      }
      Update-State { param($s) $s.daemon_heartbeat = (NowIso); $s.daemon_pid = $PID } | Out-Null
      if (((Get-Now) - $startedAt).TotalHours -ge [double]$Cfg.DAEMON_RECYCLE_HOURS) { Write-Log 'INFO' 'daemon.recycle' 'periodic recycle; Task Scheduler restarts the monitor within 1 minute'; break }
      Start-Sleep -Seconds 5
    }
  } finally {
    try { $dm.ReleaseMutex() } catch { }
    $dm.Dispose()
  }
}

# --------------------------------------------------------------------------- scheduler install
function Install-Task {
  $Script:Cfg = Get-Config
  $vbs = Join-Path $Root 'run-hidden.vbs'
  $user = "$env:USERDOMAIN\$env:USERNAME"
  $sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
  $start = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:00')
  $dailyTime = ('{0:D2}:{1:D2}:00' -f [int]$Cfg.DAILY_CHECK_HOUR, [int]$Cfg.DAILY_CHECK_MINUTE)
  $dailyBoundary = (Get-Date).ToString("yyyy-MM-ddT$dailyTime")
  $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Hermes Agent autonomous update monitor (daily 03:00 check &amp; update with offline/boot catch-up). Managed by $($ScriptPath).</Description>
    <URI>$($TaskPath)$($TaskName)</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>$dailyBoundary</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
    <LogonTrigger><Enabled>true</Enabled><UserId>$user</UserId><Delay>PT30S</Delay></LogonTrigger>
    <TimeTrigger>
      <Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
      <StartBoundary>$start</StartBoundary><Enabled>true</Enabled>
    </TimeTrigger>
    <SessionStateChangeTrigger><Enabled>true</Enabled><StateChange>SessionUnlock</StateChange><UserId>$user</UserId></SessionStateChangeTrigger>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="Microsoft-Windows-NetworkProfile/Operational"&gt;&lt;Select Path="Microsoft-Windows-NetworkProfile/Operational"&gt;*[System[(EventID=10000)]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription>
      <Delay>PT15S</Delay>
    </EventTrigger>
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
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$(Join-Path $Root 'HermesAutoUpdateLauncher.exe')</Command>
      <Arguments>run</Arguments>
      <WorkingDirectory>$Root</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
  Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Xml $xml -Force | Out-Null
  Write-Log 'INFO' 'install' "scheduled task $TaskPath$TaskName registered (logon + every 1 min watchdog + unlock + network-connected)"
}

# --------------------------------------------------------------------------- CLI views
function Show-Status {
  $Script:Cfg = Get-Config
  $s = Read-State
  $task = $null; try { $task = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction Stop } catch { }
  $info = $null; if ($task) { try { $info = Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath $TaskPath } catch { } }
  $dpid = SGet $s 'daemon_pid'; $alive = $false
  if ($dpid) { $p = Get-Process -Id $dpid -ErrorAction SilentlyContinue; $alive = [bool]$p }
  $hb = Parse-Iso (SGet $s 'daemon_heartbeat'); $hbAge = if ($hb) { [int]((Get-Now) - $hb).TotalSeconds } else { $null }
  $loc = Get-LocalInfo -Full
  $ft = SGet $s 'failed_targets'
  $gv = (Invoke-Git @('--version') 15).StdOut.Trim()
  $cust = @(Test-Customizations)
  $daemonHealth = if ($alive -and $hbAge -ne $null -and $hbAge -lt 180) { "healthy (heartbeat ${hbAge}s ago)" } elseif ($alive) { "stale heartbeat (${hbAge}s)" } else { 'not running (watchdog restarts it within ~1 min)' }
  $o = [ordered]@{
    auto_update_enabled = [bool]$Cfg.AUTO_UPDATE_ENABLED
    paused              = [bool](SGet $s 'paused' $false)
    paused_reason       = SGet $s 'paused_reason'
    monitor_running     = ($alive -and $hbAge -ne $null -and $hbAge -lt 180)
    daemon_health       = $daemonHealth
    monitor_pid         = $dpid
    monitor_heartbeat   = SGet $s 'daemon_heartbeat'
    scheduled_task      = $(if ($task) { "$TaskPath$TaskName ($($task.State))" } else { 'NOT REGISTERED' })
    task_last_run       = $(if ($info) { [string]$info.LastRunTime } else { $null })
    task_last_result    = $(if ($info) { $code = '0x{0:X}' -f $info.LastTaskResult; switch ($code) { '0x41301' { "$code (running)" } '0x800710E0' { "$code (monitor already running; duplicate start refused by IgnoreNew)" } '0x0' { "$code (ok)" } default { $code } } } else { $null })
    channel             = $Cfg.UPDATE_CHANNEL
    schedule_mode       = $Cfg.SCHEDULE_MODE
    daily_schedule      = $(if ($Cfg.SCHEDULE_MODE -eq 'daily') { ('{0:D2}:{1:D2} {2} (catch-up when online/powered on)' -f [int]$Cfg.DAILY_CHECK_HOUR, [int]$Cfg.DAILY_CHECK_MINUTE, $Cfg.TIMEZONE) } else { 'disabled (continuous interval)' })
    last_daily_slot     = SGet $s 'last_daily_slot_completed'
    check_interval_s    = $Cfg.CHECK_INTERVAL_SECONDS
    installed_commit    = $loc.head
    latest_upstream     = SGet $s 'remote_target'
    installed_branch    = $loc.branch
    checkout_dirty      = $loc.dirty
    update_available    = SGet $s 'update_available'
    last_check          = SGet $s 'last_check'
    last_cycle_result   = SGet $s 'last_cycle_result'
    next_check          = SGet $s 'next_check'
    update_in_progress  = [bool](SGet $s 'update_in_progress' $false) -or (@(Get-RunningHermesUpdate).Count -gt 0)
    last_update_attempt = SGet $s 'last_update_attempt'
    last_update_result  = SGet $s 'last_update_result'
    last_update_success = SGet $s 'last_update_success'
    restart_pending     = [bool](SGet $s 'restart_pending' $false)
    last_error          = SGet $s 'last_error'
    last_error_at       = SGet $s 'last_error_at'
    last_update_error   = $($fe = SGet $s 'failed_targets'; if ($fe -and $fe.Count -gt 0) { $k = @($fe.Keys)[-1]; "$($k.Substring(0,[Math]::Min(12,$k.Length))): $($fe[$k]['category']) (attempts $($fe[$k]['attempts']))" } else { $null })
    backup_enabled      = $false
    pre_update_backup   = "disabled (updater: none; official updates.pre_update_backup=$(Get-OfficialBackupSetting); runs with --no-backup)"
    daily_backup        = 'disabled (no code path)'
    update_command      = 'hermes update --no-backup --yes'
    git_for_updates     = "$gv"
    customizations      = $(($cust | ForEach-Object { "$($_.file): $(if ($_.present) { if ($_.native) { 'present (upstream native)' } else { 'present (local)' } } else { 'MISSING' })" }) -join '; ')
    consecutive_check_failures = SGet $s 'consecutive_check_failures' 0
    backoff_until       = SGet $s 'backoff_until'
    deferred_reason     = SGet $s 'last_deferred_reason'
    failed_targets      = $(if ($ft) { @($ft.Keys) } else { @() })
    needs_attention     = SGet $s 'needs_attention'
    logs                = $LogPath
  }
  if ($Json) { $o | ConvertTo-Json -Depth 5 } else {
    Write-Host 'Hermes Auto-Update status' -ForegroundColor Cyan
    foreach ($k in $o.Keys) { $v = $o[$k]; if ($v -is [array]) { $v = ($v -join ', ') }; Write-Host ('  {0,-27} {1}' -f $k, $v) }
  }
}

# --------------------------------------------------------------------------- dispatch
$Script:Cfg = Get-Config
$Script:GitExe = Use-PreferredGit
$Script:Interactive = $Command -notin @('run')
switch ($Command.ToLower()) {
  'run'        { Start-Daemon }
  'cycle'      { $r = Invoke-Cycle 'schedule'; Write-Host "cycle result: $r" }
  'status'     { Show-Status }
  'check-now'  {
    $r = Invoke-Cycle 'manual'
    Update-State { param($s) $s.last_cycle_result = $r } | Out-Null
    Write-Host "check result: $r"; Show-Status
  }
  'update-now' {
    $r = Invoke-Cycle 'manual-update' -ForceUpdate
    Write-Host "update result: $r"; Show-Status
  }
  'pause'      { Update-State { param($s) $s.paused = $true; $s.paused_reason = 'paused by user'; $s.paused_at = (NowIso) } | Out-Null; Write-Log 'INFO' 'control' 'auto-update paused by user'; Write-Host 'Auto-update PAUSED (monitor keeps running, no checks/updates until resume).' }
  'resume'     { Update-State { param($s) $s.paused = $false; $s.paused_reason = $null; $s.needs_attention = $null; $s.backoff_until = $null } | Out-Null; Write-Log 'INFO' 'control' 'auto-update resumed by user'; Write-Host 'Auto-update RESUMED.' }
  'logs'       { if ($Json) { Get-Content -LiteralPath $JsonLogPath -Tail $Tail } else { Get-Content -LiteralPath $LogPath -Tail $Tail } }
  'config'     {
    if ($Set) {
      $kv = $Set -split '=', 2; if ($kv.Count -ne 2) { throw "use -Set KEY=VALUE" }
      $raw = ConvertTo-HashtableDeep (Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json)
      $k = $kv[0].Trim().ToUpper(); $v = $kv[1].Trim()
      if (-not $Defaults.Contains($k)) { throw "unknown key $k" }
      $typed = if ($Defaults[$k] -is [bool]) { [bool]::Parse($v) } elseif ($Defaults[$k] -is [int]) { [int]$v } else { $v }
      if ($k -eq 'UPDATE_CHANNEL') {
        if ($typed -notin @('main', 'stable')) { throw 'UPDATE_CHANNEL must be main or stable' }
        $r = Invoke-Hermes @('update', '--set-channel', $typed) 300
        Write-Host (($r.StdOut + $r.StdErr).Trim())
        if ($r.ExitCode -ne 0) { throw "hermes update --set-channel $typed failed (exit $($r.ExitCode)); config unchanged" }
      }
      $raw[$k] = $typed
      [IO.File]::WriteAllText($ConfigPath, ($raw | ConvertTo-Json -Depth 5), [Text.Encoding]::UTF8)
      Write-Log 'INFO' 'control' "config $k set to $typed"
    }
    Get-Config | ConvertTo-Json -Depth 5
  }
  'install'    { Install-Task; Start-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath; Write-Host "Installed and started $TaskPath$TaskName" }
  'uninstall'  { Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false; $s = Read-State; if (SGet $s 'daemon_pid') { Stop-Process -Id $s.daemon_pid -ErrorAction SilentlyContinue }; Write-Host 'Scheduled task removed.' }
  'selftest-hermes' {
    $v = Invoke-Hermes @('--version') 180; Write-Host "hermes --version exit=$($v.ExitCode)`n$($v.StdOut.Trim())"
    $c = Invoke-OfficialCheck; Write-Host "hermes update --check exit=$($c.exit) available=$($c.available) channel=$($c.channel)`n$($c.text)"
    $h = Get-VenvHolders; Write-Host "venv holders exit=$($h.exit) count=$(@($h.holders).Count)"
    Write-Host "configured channel (config.yaml): $(Get-ConfiguredChannel)"
  }
  'selftest-lock' {
    # Holds the update lock for N seconds (used by the duplicate-execution test)
    $m = New-NamedMutex 'Update'; $got = Enter-Mutex $m 0; Write-Host "lock acquired: $got"
    if ($got) { Start-Sleep -Seconds ([int]($(if ($Rest) { $Rest[0] } else { 30 }))); $m.ReleaseMutex() }; $m.Dispose()
  }
  default      { Write-Host "Usage: hermes-autoupdate <status|check-now|update-now|pause|resume|logs [-Tail N] [-Json]|config [-Set KEY=VALUE]|install|uninstall>" }
}
