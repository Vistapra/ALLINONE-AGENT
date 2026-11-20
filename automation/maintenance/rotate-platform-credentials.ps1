<#
.SYNOPSIS
  Safe local credential rotation utility for Unified Autonomous AI Agent Platform.
  Never prints old or new secrets to stdout, logs, or command line arguments.
#>
param(
  [ValidateSet('status', 'telegram', 'provider', 'internal-secrets')]
  [string]$Target = 'status'
)
if (-not $env:ALLINONE_HOME) { $env:ALLINONE_HOME = (Join-Path $HOME 'ALLINONE-AGENT') }
$ALLINONE_HOME = $env:ALLINONE_HOME
if (-not $env:ALLINONE_HERMES_HOME) { $env:ALLINONE_HERMES_HOME = (Join-Path $env:LOCALAPPDATA 'hermes') }
$ALLINONE_HERMES_HOME = $env:ALLINONE_HERMES_HOME
if (-not $env:ALLINONE_USER_HOME) { $env:ALLINONE_USER_HOME = $HOME }
$ALLINONE_USER_HOME = $env:ALLINONE_USER_HOME

$ErrorActionPreference = 'Stop'
$SecretDir = "$ALLINONE_HOME\config\secrets"
$HermesEnv = "$ALLINONE_HERMES_HOME\.env"
$VulnClawCfg = "$ALLINONE_HOME\data\vulnclaw\config.yaml"

function Get-SecretFingerprint([string]$val) {
  if (-not $val) { return 'EMPTY' }
  $bytes = [Text.Encoding]::UTF8.GetBytes($val.Trim())
  $sha = [Security.Cryptography.SHA256]::Create()
  $hash = ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join ''
  return "sha256:$($hash.Substring(0, 12))"
}

function Read-EnvMap([string]$path) {
  $m = [ordered]@{}
  if (Test-Path -LiteralPath $path) {
    foreach ($line in (Get-Content -LiteralPath $path -Encoding UTF8)) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        $m[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
      }
    }
  }
  return $m
}

if ($Target -eq 'status') {
  $hEnv = Read-EnvMap $HermesEnv
  $wEnv = Read-EnvMap (Join-Path $SecretDir 'worker-llm.env')
  $pEnv = Read-EnvMap (Join-Path $SecretDir 'paperclip-auth.env')
  $gEnv = Read-EnvMap (Join-Path $SecretDir 'hermes-api-test.env')
  [ordered]@{
    hermes_telegram_token_fp      = Get-SecretFingerprint $hEnv['TELEGRAM_BOT_TOKEN']
    hermes_provider_key_fp        = Get-SecretFingerprint $hEnv['CUSTOM_API_KEY']
    worker_provider_key_fp        = Get-SecretFingerprint $wEnv['CUSTOM_API_KEY']
    paperclip_auth_secret_fp      = Get-SecretFingerprint $pEnv['BETTER_AUTH_SECRET']
    paperclip_signing_secret_fp   = Get-SecretFingerprint $pEnv['PAPERCLIP_TOOL_ACTION_SIGNING_SECRET']
    hermes_isolated_api_key_fp    = Get-SecretFingerprint $gEnv['HERMES_ISOLATED_API_KEY']
    worker_has_telegram_token     = [bool]$wEnv.Contains('TELEGRAM_BOT_TOKEN')
    rotation_owner_prereq_note    = 'Telegram BotFather /revoke and your configured custom-provider API key re-issuance require owner action; run this script with -Target telegram or -Target provider once new token/key is issued.'
  } | ConvertTo-Json -Depth 4
  exit 0
}

if ($Target -eq 'telegram') {
  & "$ALLINONE_USER_HOME\HermesUpdater\bin\hermes-rotate-telegram-token.cmd" -Cli
  exit $LASTEXITCODE
}

if ($Target -eq 'provider') {
  $sec = Read-Host 'Enter new Provider API Key (masked)' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
    if ($plain.Length -lt 12) { throw 'API key too short; aborted.' }
    # Update worker-llm.env
    $wPath = Join-Path $SecretDir 'worker-llm.env'
    $providerBaseUrl = if ($env:ALLINONE_CUSTOM_PROVIDER_URL) { $env:ALLINONE_CUSTOM_PROVIDER_URL } else { 'https://api.openai.com/v1' }
    $wLines = @(
      "OPENAI_BASE_URL=$providerBaseUrl",
      "CUSTOM_API_KEY=$plain",
      "OPENAI_API_KEY=$plain"
    )
    [IO.File]::WriteAllLines($wPath, $wLines, (New-Object Text.UTF8Encoding($false)))
    # Propagate to worker homes
    Get-ChildItem "$ALLINONE_HOME\workers" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $wh = Join-Path $_.FullName 'hermes_home\.env'
      if (Test-Path -LiteralPath $wh) { [IO.File]::WriteAllLines($wh, $wLines, (New-Object Text.UTF8Encoding($false))) }
    }
    Write-Host "Updated provider key across isolated worker stores (fp=$(Get-SecretFingerprint $plain))."
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
