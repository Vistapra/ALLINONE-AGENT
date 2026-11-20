<#
.SYNOPSIS
Zero-Exposure Telegram Bot Token Rotation Utility for Hermes Agent (bot handle set via ALLINONE_TELEGRAM_BOT_HANDLE).
Never displays or logs the new token in terminal output, process argv, or log files.

.PARAMETER Cli
Use hidden console input (Read-Host -AsSecureString) instead of the masked Windows Forms GUI dialog.
#>
[CmdletBinding()]
param(
    [switch]$Cli
)

if (-not $env:ALLINONE_HERMES_HOME) { $env:ALLINONE_HERMES_HOME = (Join-Path $env:LOCALAPPDATA 'hermes') }
$ALLINONE_HERMES_HOME = $env:ALLINONE_HERMES_HOME
if (-not $env:ALLINONE_USER_HOME) { $env:ALLINONE_USER_HOME = $HOME }
$ALLINONE_USER_HOME = $env:ALLINONE_USER_HOME

$ErrorActionPreference = 'Stop'
$pyBoot  = "${ALLINONE_HERMES_HOME}\tools\python-3.14.9+20261021-win32-x64\python.exe"
$repoDir = "${ALLINONE_USER_HOME}\AppData\Roaming\npm\node_modules\hermes-agent\runtime\hermes-agent"

function Invoke-TokenRotation([string]$PlainToken) {
    $cleanTok = $PlainToken.Trim().TrimStart([char]0xFEFF)
    if ($cleanTok -notmatch '^\d{8,12}:[A-Za-z0-9_-]{30,}$') {
        return [pscustomobject]@{ ok = $false; error = "Format token tidak valid (harus angka_bot_id:kode_rahasia)." }
    }

    $rotPy = Join-Path $env:TEMP ("hermes_rot_" + [guid]::NewGuid().ToString("N") + ".py")
    # NOTE: expanding here-string (@"..."@), not literal (@'...'@), so
    # ${ALLINONE_USER_HOME} below resolves to this machine's real path instead
    # of being written as dead literal text into the generated Python file.
    $fallbackOwnerId = $env:ALLINONE_TELEGRAM_OWNER_ID
    @"
import asyncio, json, os, subprocess, sys, time
from pathlib import Path
sys.path.insert(0, r"${ALLINONE_USER_HOME}\AppData\Roaming\npm\node_modules\hermes-agent\runtime\hermes-agent")
import hermes_bootstrap
from hermes_cli.config import get_env_value, save_env_value

tok = sys.stdin.read().lstrip("\ufeff").strip()
owner_id = (get_env_value("TELEGRAM_ALLOWED_USERS") or "$fallbackOwnerId" or "").split(",")[0].strip()

async def verify_and_notify(send_notice: bool):
    from telegram import Bot
    bot = Bot(token=tok)
    async with bot:
        me = await bot.get_me()
        await bot.delete_webhook(drop_pending_updates=False)
        msg_id = None
        if send_notice and owner_id.isdigit():
            m = await bot.send_message(
                chat_id=int(owner_id),
                text=(
                    "🔒 Rotasi token Telegram berhasil!\n"
                    f"• Bot: @{me.username} (ID {me.id})\n"
                    f"• Owner eksklusif tetap terkunci: {owner_id}\n"
                    "• Token baru disimpan lokal di .env tanpa pernah ditampilkan di chat atau log."
                ),
            )
            msg_id = m.message_id
        return {"bot_id": me.id, "bot_username": me.username, "message_id": msg_id}

try:
    info = asyncio.run(verify_and_notify(False))
except Exception as exc:
    print(json.dumps({"ok": False, "error": f"Token ditolak oleh API Telegram ({type(exc).__name__})."}))
    raise SystemExit(1)

# Save rotated token atomically to .env (preserving owner allowlist & all other keys)
save_env_value("TELEGRAM_BOT_TOKEN", tok)
save_env_value("TELEGRAM_ALLOWED_USERS", owner_id)
save_env_value("TELEGRAM_ALLOW_ALL_USERS", "false")
save_env_value("GATEWAY_ALLOW_ALL_USERS", "false")

# Stop existing gateway cleanly, send notice, then start via \Hermes_Gateway task
subprocess.run(["cmd.exe", "/d", "/s", "/c", "hermes gateway stop < NUL"], capture_output=True, timeout=30)
subprocess.run(["schtasks.exe", "/End", "/TN", "Hermes_Gateway"], capture_output=True)
subprocess.run(["taskkill.exe", "/F", "/IM", "HermesGatewayLauncher.exe"], capture_output=True)
time.sleep(1.5)

info = asyncio.run(verify_and_notify(True))
subprocess.run(["schtasks.exe", "/Run", "/TN", "Hermes_Gateway"], capture_output=True)
time.sleep(6.0)
print(json.dumps({"ok": True, "bot_username": info["bot_username"], "bot_id": info["bot_id"], "owner_id": owner_id, "notice_message_id": info["message_id"]}))
"@ | Set-Content -LiteralPath $rotPy -Encoding UTF8

    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $pyBoot
        $psi.Arguments = '"' + $rotPy + '"'
        $psi.RedirectStandardInput = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.EnvironmentVariables["PYTHONPATH"] = $repoDir
        $p = [System.Diagnostics.Process]::Start($psi)
        $p.StandardInput.WriteLine($cleanTok)
        $p.StandardInput.Close()
        $out = $p.StandardOutput.ReadToEnd()
        $p.WaitForExit()
        $lines = @($out -split "`r?`n" | Where-Object { $_.Trim().StartsWith("{") })
        if ($lines.Count -gt 0) {
            return ($lines[-1] | ConvertFrom-Json)
        }
        return [pscustomobject]@{ ok = $false; error = "Gagal memproses hasil rotasi token." }
    } finally {
        Remove-Item -LiteralPath $rotPy -Force -ErrorAction SilentlyContinue
    }
}

if ($Cli) {
    $botHandleForDisplay = if ($env:ALLINONE_TELEGRAM_BOT_HANDLE) { "@$($env:ALLINONE_TELEGRAM_BOT_HANDLE)" } else { "@YourBotUsername" }
    Write-Host "=== Rotasi Aman TELEGRAM_BOT_TOKEN ($botHandleForDisplay) ===" -ForegroundColor Cyan
    Write-Host "1. Di Telegram buka @BotFather -> kirim /revoke -> pilih $botHandleForDisplay"
    Write-Host "2. Salin token baru yang diberikan @BotFather"
    $sec = Read-Host "3. Tempel token baru di sini (ketikan disembunyikan)" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    Write-Host "Memverifikasi token baru & me-restart Hermes_Gateway..." -ForegroundColor Yellow
    $res = Invoke-TokenRotation -PlainToken $plain
    $plain = $null
    if ($res.ok) {
        Write-Host "BERHASIL! Token baru aktif untuk @$($res.bot_username) (Owner ID $($res.owner_id), msg_id=$($res.notice_message_id))." -ForegroundColor Green
        exit 0
    } else {
        Write-Error $res.error
        exit 1
    }
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "Hermes Agent — Rotasi Aman Token Telegram (@BotFather /revoke)"
$form.Size = New-Object System.Drawing.Size(540, 290)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.TopMost = $true

$lbl = New-Object System.Windows.Forms.Label
$lbl.Location = New-Object System.Drawing.Point(18, 15)
$lbl.Size = New-Object System.Drawing.Size(490, 75)
$botHandleForGuiDisplay = if ($env:ALLINONE_TELEGRAM_BOT_HANDLE) { "@$($env:ALLINONE_TELEGRAM_BOT_HANDLE)" } else { "@YourBotUsername" }
$lbl.Text = "Cara mencabut token lama & mengganti dengan token baru tanpa ekspos chat/log:`r`n" +
            "1. Buka @BotFather di Telegram -> kirim /revoke -> pilih $botHandleForGuiDisplay.`r`n" +
            "2. Salin token baru dari @BotFather, lalu klik 'Tempel Clipboard' di bawah.`r`n" +
            "3. Klik 'Simpan & Restart Gateway' (Owner ID Anda yang sudah dikonfigurasi tetap dipertahankan)."
$form.Controls.Add($lbl)

$txt = New-Object System.Windows.Forms.TextBox
$txt.Location = New-Object System.Drawing.Point(18, 102)
$txt.Size = New-Object System.Drawing.Size(360, 26)
$txt.UseSystemPasswordChar = $true
$form.Controls.Add($txt)

$btnPaste = New-Object System.Windows.Forms.Button
$btnPaste.Location = New-Object System.Drawing.Point(386, 100)
$btnPaste.Size = New-Object System.Drawing.Size(120, 28)
$btnPaste.Text = "Tempel Clipboard"
$btnPaste.Add_Click({
    if ([System.Windows.Forms.Clipboard]::ContainsText()) {
        $txt.Text = [System.Windows.Forms.Clipboard]::GetText().Trim()
    }
})
$form.Controls.Add($btnPaste)

$statusLbl = New-Object System.Windows.Forms.Label
$statusLbl.Location = New-Object System.Drawing.Point(18, 142)
$statusLbl.Size = New-Object System.Drawing.Size(490, 42)
$statusLbl.ForeColor = [System.Drawing.Color]::DarkBlue
$statusLbl.Text = "Menunggu token baru dari @BotFather..."
$form.Controls.Add($statusLbl)

$btnSave = New-Object System.Windows.Forms.Button
$btnSave.Location = New-Object System.Drawing.Point(18, 196)
$btnSave.Size = New-Object System.Drawing.Size(260, 34)
$btnSave.Text = "Simpan & Restart Gateway"
$form.Controls.Add($btnSave)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Location = New-Object System.Drawing.Point(396, 196)
$btnClose.Size = New-Object System.Drawing.Size(110, 34)
$btnClose.Text = "Tutup"
$btnClose.Add_Click({ $form.Close() })
$form.Controls.Add($btnClose)

$btnSave.Add_Click({
    if (-not $txt.Text.Trim()) {
        [System.Windows.Forms.MessageBox]::Show("Tempel token baru dari @BotFather terlebih dahulu.", "Hermes Agent", "OK", "Warning") | Out-Null
        return
    }
    $btnSave.Enabled = $false
    $statusLbl.Text = "Memverifikasi token baru, menyimpan ke .env, dan me-restart Hermes_Gateway..."
    $form.Refresh()
    $res = Invoke-TokenRotation -PlainToken $txt.Text
    $txt.Text = ""
    if ($res.ok) {
        [System.Windows.Forms.MessageBox]::Show("Rotasi token BERHASIL! @$($res.bot_username) kembali online dengan token baru (pesan konfirmasi telah dikirim ke DM Telegram Anda).", "Rotasi Berhasil", "OK", "Information") | Out-Null
        $form.Close()
    } else {
        $statusLbl.Text = "Gagal: $($res.error)"
        $btnSave.Enabled = $true
    }
})

[void]$form.ShowDialog()
