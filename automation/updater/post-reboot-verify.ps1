if (-not $env:ALLINONE_HERMES_HOME) { $env:ALLINONE_HERMES_HOME = (Join-Path $env:LOCALAPPDATA 'hermes') }
$ALLINONE_HERMES_HOME = $env:ALLINONE_HERMES_HOME
if (-not $env:ALLINONE_USER_HOME) { $env:ALLINONE_USER_HOME = $HOME }
$ALLINONE_USER_HOME = $env:ALLINONE_USER_HOME

<#
.SYNOPSIS
Automatic Post-Reboot Verification Probe for Hermes Agent (runs 60s after Windows login following a physical reboot).
Verifies that \Hermes_Gateway (Telegram), \cua-driver-serve (Computer Use), and \Hermes\HermesAutoUpdate
all started automatically without any manual command, then delivers live proof + desktop screenshot to the configured Telegram owner (ALLINONE_TELEGRAM_OWNER_ID).
#>
$ErrorActionPreference = 'Continue'

$stateDir   = "${ALLINONE_USER_HOME}\HermesUpdater\state"
$armFile    = Join-Path $stateDir "reboot-baseline.json"
$verifyFile = Join-Path $stateDir "reboot-verified.json"
$healthPs1  = "${ALLINONE_USER_HOME}\HermesUpdater\hermes-health.ps1"
$pyExe      = "${ALLINONE_HERMES_HOME}\tools\python-3.14.9+20261021-win32-x64\python.exe"
$repoDir    = "${ALLINONE_USER_HOME}\AppData\Roaming\npm\node_modules\hermes-agent\runtime\hermes-agent"

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$os = Get-CimInstance Win32_OperatingSystem
$currentBootIso = $os.LastBootUpTime.ToString("o")

if (Test-Path -LiteralPath $armFile) {
    try {
        $arm = Get-Content -LiteralPath $armFile -Raw | ConvertFrom-Json
        if ($arm.boot_time_iso -eq $currentBootIso -and (Test-Path -LiteralPath $verifyFile)) {
            exit 0
        }
        if ($arm.boot_time_iso -eq $currentBootIso) {
            # Same boot session in which baseline was armed -> wait for actual physical reboot
            exit 0
        }
    } catch {}
}

# Wait up to 45s if Telegram is still finishing initial handshake after login
$healthObj = $null
for ($i = 0; $i -lt 6; $i++) {
    $raw = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $healthPs1 -Heal -Json
    try { $healthObj = $raw | ConvertFrom-Json } catch {}
    if ($healthObj -and $healthObj.overall_healthy) { break }
    Start-Sleep -Seconds 8
}

$verified = [ordered]@{
    verified_at          = (Get-Date).ToString("o")
    boot_time_iso        = $currentBootIso
    overall_healthy      = [bool]($healthObj.overall_healthy)
    gateway_pid          = $healthObj.gateway.pid
    telegram_connected   = [bool]($healthObj.gateway.telegram_connected)
    cua_status           = [string]$healthObj.computer_use.status
    cua_pids             = $healthObj.computer_use.driver_pids
    autoupdate_healthy   = [bool]$healthObj.auto_updater.healthy
}
($verified | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $verifyFile -Encoding UTF8
@{ boot_time_iso = $currentBootIso; updated_at = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -LiteralPath $armFile -Encoding UTF8

# Send live post-reboot verification message + desktop screenshot to the configured Telegram owner.
$env:PYTHONPATH = $repoDir
$notifyPy = Join-Path $stateDir "post_reboot_notify.py"
# NOTE: this here-string uses @"..."@ (expanding), not @'...'@ (literal), so that
# the ${ALLINONE_USER_HOME}/${ALLINONE_HERMES_HOME} references below are resolved
# to this machine's real paths by PowerShell when the .py file is generated.
# A prior redaction pass had left these as @'...'@ (literal), which silently
# wrote the dead text "${ALLINONE_USER_HOME}" into the generated Python file
# instead of a real path -- fixed here.
$ownerIdForNotify = $env:ALLINONE_TELEGRAM_OWNER_ID
@"
import asyncio, json, os, sys
from pathlib import Path
os.environ["HERMES_CUA_DRIVER_CMD"] = r"${ALLINONE_USER_HOME}\HermesUpdater\bin\CuaDriverProxy.exe"
sys.path.insert(0, r"${ALLINONE_USER_HOME}\AppData\Roaming\npm\node_modules\hermes-agent\runtime\hermes-agent")
import hermes_bootstrap
from dotenv import load_dotenv
load_dotenv(r"${ALLINONE_HERMES_HOME}\.env", override=True)
from hermes_cli.config import get_env_value, load_config
import tools.computer_use_tool
from tools.registry import registry

load_config()
tok = (get_env_value("TELEGRAM_BOT_TOKEN") or "").lstrip("\ufeff").strip()
owner_chat_id = "$ownerIdForNotify"
ver = json.loads(Path(r"${ALLINONE_USER_HOME}\HermesUpdater\state\reboot-verified.json").read_text(encoding="utf-8-sig"))

shot_file = None
try:
    registry._tools["computer_use"].handler({"action": "capture", "app": "screen", "mode": "vision"})
    imgs = sorted(Path(r"${ALLINONE_HERMES_HOME}\cache\images").glob("computer_use_*.*"), key=lambda p: p.stat().st_mtime, reverse=True)
    if imgs:
        shot_file = imgs[0]
except Exception:
    pass

async def send():
    from telegram import Bot
    bot = Bot(token=tok)
    msg = (
        "✅ VERIFIKASI REBOOT FISIK WINDOWS BERHASIL!\n\n"
        f"• Boot Time Baru: {ver.get('boot_time_iso')}\n"
        f"• Hermes_Gateway: Aktif otomatis (PID {ver.get('gateway_pid')}, Telegram Connected={ver.get('telegram_connected')})\n"
        f"• Computer Use (cua-driver): {ver.get('cua_status')} (PIDs {ver.get('cua_pids')})\n"
        f"• Autonomous Updater: Healthy={ver.get('autoupdate_healthy')}\n"
        "• Tanpa perintah manual setelah restart Windows."
    )
    async with bot:
        await bot.send_message(chat_id=int(owner_chat_id), text=msg)
        if shot_file and shot_file.exists():
            with shot_file.open("rb") as fh:
                await bot.send_photo(chat_id=int(owner_chat_id), photo=fh, caption="📸 Screenshot desktop otomatis pasca-reboot Windows.")

if tok and owner_chat_id:
    asyncio.run(send())
"@ | Set-Content -LiteralPath $notifyPy -Encoding UTF8

& $pyExe $notifyPy 2>&1 | Out-Null
Remove-Item -LiteralPath $notifyPy -Force -ErrorAction SilentlyContinue
