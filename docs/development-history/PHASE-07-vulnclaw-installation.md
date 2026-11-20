# PHASE 07 — VULNCLAW ISOLATED INSTALLATION

## 1. Objective
Memasang VulnClaw (`v0.4.1`) dalam lingkungan Python terisolasi khusus untuk workflow keamanan defensif statis, memverifikasi kompatibilitas model `combo/X` beserta pelaporan token, serta memastikan isolasi ketat dari kredensial Hermes/Telegram dan pemblokiran penuh kapabilitas ofensif.

## 2. Prerequisites
- `PHASE-06` (`PASS`) selesai; venv Python `3.14.9` tersedia di `${ALLINONE_HOME}\runtime\vulnclaw-venv`.
- Konfigurasi terisolasi tersedia di `${ALLINONE_HOME}\data\vulnclaw\config.yaml` (NTFS-ACL locked).

## 3. Current Condition
- Repository resmi `Netw0rkNoob/VulnClaw` (`tag v0.4.1`, commit `0b34878f84b089b21fcf85ecd445315f14df0672`) berada di `${ALLINONE_HOME}\vulnclaw`.

## 4. Technical Analysis
1. **Isolated Runtime (`Python 3.14.9`):** Dipasang menggunakan `uv pip install -e ${ALLINONE_HOME}\vulnclaw` (`55` paket terpasang) terpisah total dari Python `3.11.16` milik Hermes.
2. **Scrubbed Subprocess Environment:** `integration/vulnclaw_defensive.py` membentuk environment proses minimal tanpa meneruskan variabel `HERMES_*`, `TELEGRAM_*`, atau `PAPERCLIP_*` (`hermes_or_telegram_env_leaked = false`) dan menonaktifkan seluruh MCP server (`enabled_mcp_servers = []`).
3. **Defensive-Only Boundary:** Hanya mengekspor fungsi analisis statis `codescan` (`L1/L2`, JSON/SARIF/Markdown) dan triase defensif JSON. Seluruh fungsi ofensif (`exploit`, `solve`, `recon`, `persistent`, `scan_network`, `python_execute`, `shell_command`) diblokir secara eksplisit (`PermissionError`), dan path di luar `workspaces\`, `tests\`, dan `reports\` ditolak keras.

## 5. Implementation Plan
- Menginstal `vulnclaw==0.4.1` ke `runtime\vulnclaw-venv`.
- Menjalankan `runtime_diagnostics(verify_llm=True)` untuk memverifikasi konektivitas `combo/X` dan penghitungan token.
- Menguji pemblokiran akses zona terlarang (`${ALLINONE_HERMES_HOME}`) dan pemblokiran perintah ofensif (`exploit`).
- Menjalankan `scan_authorized_code` pada fixture kode sintetis (`tests\fixtures\synthetic_app\app_settings.py`) serta `llm_defensive_triage`.

## 6. Actual Execution
- Menjalankan instalasi `uv pip install` (`task-2002`, exit `0`) dan verifikasi `scripts/phase07_08_install_and_verify_vulnclaw.py` (`task-2131`, exit `0`).

## 7. Files Created
- `${ALLINONE_HOME}\integration\vulnclaw_defensive.py`
- `${ALLINONE_HOME}\tests\fixtures\synthetic_app\app_settings.py`
- `${ALLINONE_HOME}\reports\phase07-synthetic-codescan.md`
- `${ALLINONE_HOME}\docs\PHASE-07-vulnclaw-installation.md`

## 8. Files Modified
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.json` & `.md`

## 9. Commands Executed
- `uv.exe pip install --python ${ALLINONE_HOME}\runtime\vulnclaw-venv\Scripts\python.exe -e ${ALLINONE_HOME}\vulnclaw`
- `python -u ${ALLINONE_HOME}\scripts\phase07_08_install_and_verify_vulnclaw.py`

## 10. Test Scenarios
- **P07-T1:** Inisialisasi runtime `vulnclaw==0.4.1` pada `Python 3.14.9` tanpa kebocoran env Hermes/Telegram dan `0` MCP server aktif.
- **P07-T2:** Konektivitas model `combo/X` (`https://work.example-provider.com/v1`) dengan metrik penggunaan token dan triase JSON defensif.
- **P07-T3:** Eksekusi `codescan` menghasilkan `3` temuan statis, `1` SARIF run, dan laporan Markdown tersanitasi.
- **P07-T4:** Penolakan akses ke `${ALLINONE_HERMES_HOME}` (`PermissionError`) dan pemblokiran aksi `exploit` (`PermissionError`).

## 11. Expected Results
- Seluruh skenario `P07-T1` s/d `P07-T4` lulus (`PASS`).

## 12. Actual Results
- **P07-T1 (`PASS`):** `vulnclaw_version: "0.4.1"`, `python_version: "3.14.9"`, `enabled_mcp_servers: []`, `hermes_or_telegram_env_leaked: false`.
- **P07-T2 (`PASS`):** `llm_connectivity.ok: true` (`total_tokens: 2761`), `llm_triage` mengembalikan `{"false_positive_likelihood":"low","recommended_fix":"Set DEBUG = False in production environments..."}`.
- **P07-T3 (`PASS`):** `codescan_findings_count: 3`, `sarif_runs: 1`, `reports\phase07-synthetic-codescan.md` tersimpan.
- **P07-T4 (`PASS`):** `hermes_zone_blocked: true`, `offensive_capability_blocked: true`.

## 13. Evidence
- `${ALLINONE_HOME}\reports\phase07-08-vulnclaw-findings-verification.json`
- `${ALLINONE_HOME}\reports\phase07-synthetic-codescan.md`

## 14. Problems Found
- `uv` menampilkan peringatan non-fatal bahwa hardlink lintas filesystem jatuh kembali ke salinan penuh (`Installed 55 packages in 19.46s`).

## 15. Corrective Actions
- Tidak diperlukan tindakan korektif tambahan; salinan penuh di `${ALLINONE_HOME}\runtime\vulnclaw-venv` justru menjamin isolasi file 100% dari `C:\`.

## 16. Acceptance Criteria
- [x] VulnClaw terpasang di environment terisolasi (`runtime\vulnclaw-venv`).
- [x] Konfigurasi model `combo/X` kompatibel dan melaporkan penggunaan token.
- [x] Input laporan/kode sintetis diproses menjadi temuan terstruktur & SARIF.
- [x] Tidak dapat mengakses kredensial Hermes (`hermes_zone_blocked: true`).
- [x] Kapabilitas ofensif diblokir (`offensive_capability_blocked: true`).

## 17. Final Status
`PASS`
