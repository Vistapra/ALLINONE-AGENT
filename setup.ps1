#Requires -Version 5.1
<#
.SYNOPSIS
    ALLINONE-AGENT first-run configuration wizard.
.DESCRIPTION
    Generates config\platform.local.env and a fresh local owner-authentication token. Run after
    install.ps1. Supports -NonInteractive with -ConfigFile for scripted/CI use.

    STATUS: real, working script for the fields listed below (owner auth generation, workspace
    allowlist, Telegram opt-in file write, provider config field write). It does NOT yet perform
    live provider-connectivity verification or live Telegram API verification - those require
    actually calling out to a model provider / the Telegram API, which this phase does not
    attempt against a real endpoint. Marked [NOT VERIFIED] below where that applies.
.PARAMETER NonInteractive
    Skip all prompts; -ConfigFile must supply every required value.
.PARAMETER ConfigFile
    JSON file with keys: InstallPath, ModelProvider, ModelApiBaseUrl, ModelName, EnableTelegram,
    TelegramBotToken, TelegramOwnerId, WorkspaceAllowlist (array of paths).
#>
[CmdletBinding()]
param(
    [switch]$NonInteractive,
    [string]$ConfigFile,
    [string]$InstallPath
)

$ErrorActionPreference = 'Stop'
$ScriptRoot = $PSScriptRoot
Import-Module (Join-Path $ScriptRoot 'scripts\lib\InstallState.psm1') -Force

if ($NonInteractive -and -not $ConfigFile) {
    throw "-NonInteractive requires -ConfigFile pointing at a JSON answers file."
}

$answers = $null
if ($ConfigFile) {
    if (-not (Test-Path $ConfigFile)) { throw "ConfigFile not found: $ConfigFile" }
    $answers = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
}

function Get-Answer {
    param([string]$Key, [string]$Prompt, [string]$Default = '', [switch]$Secret)
    if ($answers -and $answers.PSObject.Properties.Name -contains $Key) {
        return $answers.$Key
    }
    if ($NonInteractive) {
        if ($Default) { return $Default }
        throw "Missing required answer for '$Key' in -ConfigFile and -NonInteractive was specified."
    }
    if ($Secret) {
        $sec = Read-Host -Prompt "$Prompt" -AsSecureString
        return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    }
    $val = Read-Host -Prompt "$Prompt$(if ($Default) { " [$Default]" })"
    if (-not $val) { return $Default }
    return $val
}

$AllinoneHome = if ($InstallPath) { $InstallPath } else { Get-AllinoneHome }
Write-Host "ALLINONE-AGENT first-run setup" -ForegroundColor Cyan
Write-Host "Install path: $AllinoneHome" -ForegroundColor Gray

$configDir = Join-Path $AllinoneHome 'config'
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$envPath = Join-Path $configDir 'platform.local.env'
$examplePath = Join-Path $ScriptRoot 'config\platform.local.env.example'

if (-not (Test-Path $envPath)) {
    if (Test-Path $examplePath) { Copy-Item $examplePath $envPath } else { New-Item -ItemType File -Path $envPath | Out-Null }
}

# --- Model provider ---
Write-Host ""
Write-Host "Model provider configuration (the reference install used a custom provider named 'combo/X' -" -ForegroundColor Gray
Write-Host "that remains supported, but is not the only option; any OpenAI-compatible endpoint should work)." -ForegroundColor Gray
$apiUrl   = Get-Answer -Key 'ModelApiBaseUrl' -Prompt 'Model API base URL (blank to configure later)'
$apiModel = Get-Answer -Key 'ModelName'       -Prompt 'Model name (e.g. combo/X, or your provider''s model id)'

# --- Owner authentication: always generate fresh, never reuse an old token ---
Write-Host ""
Write-Host "Generating a fresh local owner-authentication token (never reused from any prior install)..." -ForegroundColor Gray
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$ownerToken = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
Write-Host ""
Write-Host "Your new local owner access token (shown ONCE - store it in a password manager now):" -ForegroundColor Yellow
Write-Host "  $ownerToken" -ForegroundColor Yellow
Write-Host "This token is written to $envPath (local file, not logged elsewhere, not printed again by this script)." -ForegroundColor Gray

# --- Telegram (optional) ---
Write-Host ""
$enableTelegram = Get-Answer -Key 'EnableTelegram' -Prompt 'Enable Telegram integration? (y/N)' -Default 'N'
$telegramToken = ''
$telegramOwnerId = ''
if ($enableTelegram -match '^(y|yes)$') {
    Write-Host "Create or use your own bot via @BotFather, then paste its token below." -ForegroundColor Gray
    Write-Host "If this token was ever pasted into a chat/log before, rotate it in BotFather first - do not reuse an exposed token." -ForegroundColor Yellow
    $telegramToken = Get-Answer -Key 'TelegramBotToken' -Prompt 'Telegram bot token' -Secret
    $telegramOwnerId = Get-Answer -Key 'TelegramOwnerId' -Prompt 'Your numeric Telegram user ID (owner-only allowlist)'
    Write-Host "[NOT VERIFIED] This script does not call the Telegram API to confirm the token/ID are valid - test with your own safe command after setup, per docs/TELEGRAM-SETUP.md." -ForegroundColor Yellow
} else {
    Write-Host "Skipping Telegram - you can run the 3D/2D office without it. Re-run setup.ps1 later to add it." -ForegroundColor Gray
}

# --- Workspace allowlist: explicit opt-in only, never default to a whole drive ---
Write-Host ""
Write-Host "Workspace allowlist: list specific folders agents may operate on. Do not grant an entire drive." -ForegroundColor Gray
$workspaceRaw = Get-Answer -Key 'WorkspaceAllowlist' -Prompt 'Comma-separated workspace paths (blank = none yet, add later)' -Default ''
$workspaceList = @()
if ($answers -and $answers.WorkspaceAllowlist) {
    $workspaceList = @($answers.WorkspaceAllowlist)
} elseif ($workspaceRaw) {
    $workspaceList = $workspaceRaw -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}
foreach ($w in $workspaceList) {
    if ($w -match '^[A-Za-z]:\\?$') {
        Write-Warning "Refusing to add '$w' to the workspace allowlist - it looks like an entire drive root, not a specific project folder. Add a subfolder instead."
    }
}
$workspaceList = $workspaceList | Where-Object { $_ -notmatch '^[A-Za-z]:\\?$' }

# --- Write results ---
$envLines = Get-Content -LiteralPath $envPath
function Set-EnvLine {
    param([string[]]$Lines, [string]$Key, [string]$Value)
    $pattern = "^$([regex]::Escape($Key))="
    $found = $false
    $out = foreach ($l in $Lines) {
        if ($l -match $pattern) { $found = $true; "$Key=$Value" } else { $l }
    }
    if (-not $found) { $out += "$Key=$Value" }
    return $out
}
$envLines = Set-EnvLine $envLines 'HERMES_API_URL' $apiUrl
$envLines = Set-EnvLine $envLines 'HERMES_MODEL' $apiModel
$envLines = Set-EnvLine $envLines 'STUDIO_ACCESS_TOKEN' $ownerToken
if ($enableTelegram -match '^(y|yes)$') {
    $envLines = Set-EnvLine $envLines 'TELEGRAM_BOT_TOKEN' $telegramToken
    $envLines = Set-EnvLine $envLines 'TELEGRAM_OWNER_ID' $telegramOwnerId
}
$envLines | Set-Content -LiteralPath $envPath -Encoding utf8

$workspaceFile = Join-Path $configDir 'workspace-allowlist.json'
@{ Allowlist = $workspaceList; GeneratedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $workspaceFile -Encoding utf8

Write-Host ""
Write-Host "Setup complete. Wrote:" -ForegroundColor Green
Write-Host "  $envPath"
Write-Host "  $workspaceFile"
Write-Host ""
Write-Host "Next: run .\health.ps1 to check service reachability, then .\start.ps1 to bring services up." -ForegroundColor Cyan
