if (-not $env:ALLINONE_HERMES_HOME) { $env:ALLINONE_HERMES_HOME = (Join-Path $env:LOCALAPPDATA 'hermes') }
$ALLINONE_HERMES_HOME = $env:ALLINONE_HERMES_HOME
if (-not $env:ALLINONE_USER_HOME) { $env:ALLINONE_USER_HOME = $HOME }
$ALLINONE_USER_HOME = $env:ALLINONE_USER_HOME

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$pyExe = "${ALLINONE_HERMES_HOME}\installs\d064cda90b74df76\environments\ab4bd76f49f04469aa4936d1d281245b\venv\Scripts\python.exe"
$scriptPy = "${ALLINONE_USER_HOME}\HermesUpdater\telegram-direct-pair.py"

function Invoke-PairHelper([string]$Token, [string[]]$HelperArgs) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $pyExe
    $psi.Arguments = '"' + $scriptPy + '" ' + ($HelperArgs -join ' ')
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $p.StandardInput.WriteLine($Token)
    $p.StandardInput.Close()
    $stdout = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    try {
        return ($stdout.Trim() | ConvertFrom-Json)
    } catch {
        return [pscustomobject]@{ ok = $false; error = "Gagal memproses respons helper." }
    }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Hermes Agent — Hubungkan Bot Telegram (Aman / Tanpa Ekspos Token)"
$form.Size = New-Object System.Drawing.Size(560, 360)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.TopMost = $true

$lblInfo = New-Object System.Windows.Forms.Label
$lblInfo.Location = New-Object System.Drawing.Point(18, 15)
$lblInfo.Size = New-Object System.Drawing.Size(510, 95)
$botHandleForDisplay = if ($env:ALLINONE_TELEGRAM_BOT_HANDLE) { "@$($env:ALLINONE_TELEGRAM_BOT_HANDLE)" } else { "@YourBotUsername" }
$lblInfo.Text = "Layanan webhook belum mengirim callback token otomatis.`r`n" +
                "Langkah cepat (10 detik, token TIDAK PERNAH masuk ke chat/log):`r`n" +
                "1. Di Telegram buka @BotFather -> kirim /mybots -> pilih $botHandleForDisplay (bot Anda) -> API Token -> Copy.`r`n" +
                "2. Kirim pesan /start atau 'halo' dari Telegram Anda ke $botHandleForDisplay.`r`n" +
                "3. Tempel token di kotak tersembunyi di bawah lalu klik 'Deteksi & Kunci Akses Pemilik'."
$form.Controls.Add($lblInfo)

$lblTok = New-Object System.Windows.Forms.Label
$lblTok.Location = New-Object System.Drawing.Point(18, 118)
$lblTok.Size = New-Object System.Drawing.Size(300, 20)
$lblTok.Text = "TELEGRAM_BOT_TOKEN (input disembunyikan):"
$form.Controls.Add($lblTok)

$txtTok = New-Object System.Windows.Forms.TextBox
$txtTok.Location = New-Object System.Drawing.Point(18, 140)
$txtTok.Size = New-Object System.Drawing.Size(375, 26)
$txtTok.UseSystemPasswordChar = $true
$form.Controls.Add($txtTok)

$btnPaste = New-Object System.Windows.Forms.Button
$btnPaste.Location = New-Object System.Drawing.Point(402, 138)
$btnPaste.Size = New-Object System.Drawing.Size(125, 28)
$btnPaste.Text = "Tempel Clipboard"
$btnPaste.Add_Click({
    if ([System.Windows.Forms.Clipboard]::ContainsText()) {
        $txtTok.Text = [System.Windows.Forms.Clipboard]::GetText().Trim()
    }
})
$form.Controls.Add($btnPaste)

$lblUid = New-Object System.Windows.Forms.Label
$lblUid.Location = New-Object System.Drawing.Point(18, 178)
$lblUid.Size = New-Object System.Drawing.Size(510, 20)
$lblUid.Text = "Telegram User ID Numerik Pemilik (opsional — kosongkan untuk deteksi otomatis dari pesan /start):"
$form.Controls.Add($lblUid)

$txtUid = New-Object System.Windows.Forms.TextBox
$txtUid.Location = New-Object System.Drawing.Point(18, 200)
$txtUid.Size = New-Object System.Drawing.Size(240, 26)
$form.Controls.Add($txtUid)

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Location = New-Object System.Drawing.Point(18, 236)
$lblStatus.Size = New-Object System.Drawing.Size(510, 36)
$lblStatus.ForeColor = [System.Drawing.Color]::DarkBlue
$lblStatus.Text = "Menunggu input token..."
$form.Controls.Add($lblStatus)

$btnConnect = New-Object System.Windows.Forms.Button
$btnConnect.Location = New-Object System.Drawing.Point(18, 278)
$btnConnect.Size = New-Object System.Drawing.Size(320, 34)
$btnConnect.Text = "Deteksi & Kunci Akses Pemilik"
$form.Controls.Add($btnConnect)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Location = New-Object System.Drawing.Point(418, 278)
$btnClose.Size = New-Object System.Drawing.Size(110, 34)
$btnClose.Text = "Tutup"
$btnClose.Add_Click({ $form.Close() })
$form.Controls.Add($btnClose)

$btnConnect.Add_Click({
    $tok = $txtTok.Text.Trim()
    if (-not $tok) {
        [System.Windows.Forms.MessageBox]::Show("Silakan tempel TELEGRAM_BOT_TOKEN terlebih dahulu.", "Hermes Agent", "OK", "Warning") | Out-Null
        return
    }
    $btnConnect.Enabled = $false
    $manualUid = $txtUid.Text.Trim()
    if ($manualUid -and ($manualUid -match '^\d+$')) {
        $lblStatus.Text = "Memverifikasi bot & mengaktifkan Hermes_Gateway..."
        $form.Refresh()
        $fin = Invoke-PairHelper -Token $tok -HelperArgs @("--mode", "finalize", "--owner-id", $manualUid)
        if ($fin.ok) {
            [System.Windows.Forms.MessageBox]::Show("Berhasil! Bot @$($fin.receipt.bot_username) aktif dan terkunci khusus untuk User ID $manualUid.`r`nSilakan cek DM Telegram Anda dan balas 'Sudah' di Antigravity.", "Hermes Agent Aktif", "OK", "Information") | Out-Null
            $form.Close()
            return
        } else {
            $lblStatus.Text = "Gagal: $($fin.error)"
            $btnConnect.Enabled = $true
            return
        }
    }

    $lblStatus.Text = "Memeriksa bot & mendeteksi pesan /start Anda di Telegram (maks 25 detik)..."
    $form.Refresh()
    $det = Invoke-PairHelper -Token $tok -HelperArgs @("--mode", "detect", "--wait-seconds", "25")
    if (-not $det.ok) {
        $lblStatus.Text = "Gagal: $($det.error)"
        $btnConnect.Enabled = $true
        return
    }
    if (-not $det.detected_user) {
        $lblStatus.Text = "Bot @$($det.bot_username) valid! Kirim pesan /start atau 'halo' ke @$($det.bot_username) di Telegram lalu klik tombol ini lagi."
        $btnConnect.Enabled = $true
        return
    }

    $u = $det.detected_user
    $confirmMsg = "Bot terverifikasi: @$($det.bot_username) ($($det.bot_name))`r`n`r`n" +
                  "Akun Telegram pengirim yang terdeteksi:`r`n" +
                  "• Nama: $($u.first_name) $($u.last_name)`r`n" +
                  "• Username: @$($u.username)`r`n" +
                  "• User ID Numerik: $($u.id)`r`n`r`n" +
                  "Kunci akses penuh Hermes Agent HANYA untuk akun ini?"
    $ans = [System.Windows.Forms.MessageBox]::Show($confirmMsg, "Konfirmasi Pemilik Resmi", "YesNo", "Question")
    if ($ans -ne [System.Windows.Forms.DialogResult]::Yes) {
        $lblStatus.Text = "Dibatalkan oleh pengguna. Anda juga dapat mengisi User ID numerik secara manual."
        $btnConnect.Enabled = $true
        return
    }

    $lblStatus.Text = "Menyimpan ke .env, mengunci allowlist, mengirim pesan uji & menyalakan Hermes_Gateway..."
    $form.Refresh()
    $fin = Invoke-PairHelper -Token $tok -HelperArgs @("--mode", "finalize", "--owner-id", $u.id, "--bot-username", $det.bot_username)
    if ($fin.ok) {
        [System.Windows.Forms.MessageBox]::Show("BERHASIL! Bot @$($fin.receipt.bot_username) aktif dan terkunci ke ID $($u.id).`r`nPesan uji & screenshot telah dikirim ke Telegram Anda. Silakan balas 'Sudah' di chat.", "Hermes Agent Aktif", "OK", "Information") | Out-Null
        $form.Close()
    } else {
        $lblStatus.Text = "Gagal finalisasi: $($fin.error)"
        $btnConnect.Enabled = $true
    }
})

[void]$form.ShowDialog()
