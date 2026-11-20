# PHASE 03 — CREDENTIAL SECURITY & TRUST BOUNDARIES

## 1. Objective
Memastikan pemisahan identitas kredensial antar-layanan, pengerasan izin sistem berkas (NTFS ACL), isolasi trust boundary antara zona Owner, Worker Paperclip, dan VulnClaw, serta kesiapan prosedur rotasi kredensial yang pernah muncul pada riwayat percakapan tanpa membocorkan nilai rahasia apa pun.

## 2. Prerequisites
- `PHASE-02` (`PASS`) selesai dengan struktur `${ALLINONE_HOME}` terbentuk.
- Akses utilitas `icacls.exe` dan `System.Security.Cryptography.RandomNumberGenerator` pada akun pengguna pemilik.

## 3. Current Condition
- Token Telegram (`TELEGRAM_BOT_TOKEN`) dan API key provider (`CUSTOM_API_KEY`) pada riwayat percakapan terdahulu berstatus *potentially exposed in chat history* sehingga memerlukan tindakan rotasi eksternal oleh Owner (`@BotFather /revoke` dan penerbitan key baru di portal `work.example-provider.com`).
- Sebelum Fase 03, belum ada penyimpanan rahasia terpisah untuk Paperclip, worker Hermes, maupun VulnClaw.

## 4. Technical Analysis
1. **Pemisahan Kredensial Layanan (Distinct Service Identities):**
   - `TELEGRAM_BOT_TOKEN` (`sha256:944a8c778ba4`) — hanya berada di `${ALLINONE_HERMES_HOME}\.env` (Zona Owner). Tidak pernah disalin ke Worker maupun VulnClaw.
   - `CUSTOM_API_KEY` (`sha256:65315acba723`) — kredensial inferensi LLM ke `https://work.example-provider.com/v1`, disalurkan ke `worker-llm.env` dan `data\vulnclaw\config.yaml` tanpa menyertakan variabel sensitif Hermes lainnya.
   - `BETTER_AUTH_SECRET` (`sha256:6da5271a1703`), `PAPERCLIP_AGENT_JWT_SECRET`, dan `PAPERCLIP_TOOL_ACTION_SIGNING_SECRET` (`sha256:09ea658c3720`) — 256-bit CSPRNG hex unik khusus Paperclip di `config\secrets\paperclip-auth.env`, ditambah kredensial operator lokal di `config\secrets\paperclip-admin.json`.
   - `HERMES_ISOLATED_API_KEY` (`sha256:49807b54ce7c`) — token unik khusus pengujian terisolasi `hermes_gateway` di Fase 06.
   - Paperclip agent API keys & `task_bridge` scoped keys — diterbitkan langsung oleh Paperclip DB saat organisasi diinisialisasi.
2. **Pengerasan NTFS ACL (`icacls /inheritance:r`):**
   - Direktori `${ALLINONE_HOME}\config\secrets` dan `${ALLINONE_HOME}\data\vulnclaw` dicabut pewarisan grup luas (`Authenticated Users`, `BUILTIN\Users`) dan dibatasi eksklusif untuk `<machine-name>\vista`, `NT AUTHORITY\SYSTEM`, dan `BUILTIN\Administrators`.
3. **Matriks Trust Boundaries:**
   | Zona | Akses `C:\` / `D:\` Penuh | Hermes Home Owner (`state.db`, `MEMORY.md`) | `TELEGRAM_BOT_TOKEN` | GUI `computer_use` | Terminal Lokal | Jaringan |
   |---|---|---|---|---|---|---|
   | **Hermes Owner (Telegram)** | Diizinkan (`smart` approval) | Penuh | Ya (tunggal) | Ya (`\cua-driver-serve`) | Ya | Outbound normal |
   | **Paperclip Hermes Workers** | Terbatas pada `${ALLINONE_HOME}\workspaces\<project>` | **Diblokir** (memakai `workers\<role>\hermes_home`) | **Tidak ada** | **Diblokir** (`toolsets` tanpa `computer_use`) | Hanya role engineering (`Dev`, `QA`, `DevOps`) | Loopback Paperclip + LLM API |
   | **VulnClaw Defensive** | Hanya input tersanitasi / repo uji yang ditunjuk | **Diblokir** | **Tidak ada** | **Tidak ada** | **Tidak diekspos** (`codescan` + parser statis) | Hanya LLM API bila L3/triage diminta; seluruh MCP dimatikan |
4. **Status Rotasi Kredensial Eksternal (Owner Prerequisite):**
   - Utilitas rotasi aman tanpa echo telah disiapkan di [rotate-platform-credentials.ps1](file:///${ALLINONE_HOME}/scripts/rotate-platform-credentials.ps1) dan terhubung ke `hermes-rotate-telegram-token.cmd`. Karena pencabutan token di `@BotFather` dan penerbitan API key baru di `work.example-provider.com` hanya dapat dilakukan oleh pemilik manusia, tindakan eksternal tersebut dicatat transparan sebagai *Owner Action Prerequisite* untuk hardening produksi penuh.

## 5. Implementation Plan
- Membangun skrip rotasi kredensial aman `rotate-platform-credentials.ps1`.
- Membangkitkan secret layanan unik dengan CSPRNG dan mengunci ACL NTFS pada `config\secrets` serta `data\vulnclaw`.
- Membangun dan menjalankan skrip audit otomatis `verify-security-boundaries.py`.

## 6. Actual Execution
- Menjalankan pembangkitan secret CSPRNG in-memory tanpa mencetak nilai rahasia ke terminal.
- Menerapkan `icacls.exe ... /inheritance:r` pada `${ALLINONE_HOME}\config\secrets` dan `${ALLINONE_HOME}\data\vulnclaw`.
- Menjalankan `verify-security-boundaries.py` untuk memvalidasi ACL, keunikan 6 kredensial, ketiadaan token Telegram pada worker/VulnClaw, penonaktifan seluruh MCP VulnClaw, dan pemindaian kebocoran rahasia pada seluruh artefak.

## 7. Files Created
- `${ALLINONE_HOME}\scripts\rotate-platform-credentials.ps1`
- `${ALLINONE_HOME}\scripts\verify-security-boundaries.py`
- `${ALLINONE_HOME}\config\secrets\{worker-llm.env,paperclip-auth.env,paperclip-admin.json,hermes-api-test.env}` (ACL-locked, nilai tidak pernah ditampilkan)
- `${ALLINONE_HOME}\data\vulnclaw\config.yaml` (ACL-locked, MCP disabled)
- `${ALLINONE_HOME}\docs\PHASE-03-security-boundaries.md`

## 8. Files Modified
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.json`
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.md`

## 9. Commands Executed
- `icacls.exe ${ALLINONE_HOME}\config\secrets /inheritance:r ...`
- `icacls.exe ${ALLINONE_HOME}\data\vulnclaw /inheritance:r ...`
- `powershell -NoProfile -ExecutionPolicy Bypass -File "${ALLINONE_HOME}\scripts\rotate-platform-credentials.ps1" -Target status`
- `python "${ALLINONE_HOME}\scripts\verify-security-boundaries.py"`

## 10. Test Scenarios
- **P03-T1:** Verifikasi ACL direktori rahasia menolak grup luas (`Authenticated Users` / `BUILTIN\Users`).
- **P03-T2:** Verifikasi keunikan kriptografis antar-kredensial (`6/6` SHA-256 fingerprint berbeda).
- **P03-T3:** Verifikasi isolasi `worker-llm.env` dan `data\vulnclaw\config.yaml` dari token Telegram, CUA driver, Hermes Home, dan MCP server.
- **P03-T4:** Pemindaian kebocoran nilai secret pada seluruh file dokumentasi, skrip, dan ledger.

## 11. Expected Results
- `overall_passed: true` pada seluruh pemeriksaan `verify-security-boundaries.py` dengan `leaked_files: []`.

## 12. Actual Results
- **P03-T1 (`PASS`):** ACL hanya mengizinkan `Administrators`, `SYSTEM`, dan `<machine-name>\vista`.
- **P03-T2 (`PASS`):** `6/6` fingerprint kredensial unik terverifikasi.
- **P03-T3 (`PASS`):** `worker_has_telegram_token: false`, `vulnclaw_config_isolated_and_mcp_off: true`.
- **P03-T4 (`PASS`):** `zero_secret_exposure_in_artifacts: true` (`leaked_files: []`).

## 13. Evidence
- Output JSON `verify-security-boundaries.py` (`exit code 0`, `"overall_passed": true`).
- Output fingerprint redacted `rotate-platform-credentials.ps1 -Target status`.

## 14. Problems Found
- Rotasi aktual token Telegram (`@BotFather /revoke`) dan API key upstream (`work.example-provider.com`) memerlukan otorisasi langsung dari pemilik manusia di luar mesin lokal.

## 15. Corrective Actions
- Menyediakan `rotate-platform-credentials.ps1 -Target telegram` dan `-Target provider` siap pakai satu perintah serta mencatat tindakan eksternal pemilik pada bagian *Required Owner Actions* di laporan akhir.

## 16. Acceptance Criteria
- [x] Secret storage terverifikasi (NTFS ACL-locked).
- [x] Credential exposure tidak ditemukan dalam artefak baru (`0` leaks).
- [x] Service identities terpisah (`6/6` distinct secrets).
- [x] Authentication foundation siap untuk Paperclip & adapter.
- [x] Unauthorized broad group access pada folder secret ditolak oleh ACL.
- [x] Scope setiap agent terdefinisi dalam matriks trust boundary.
- [x] Prosedur credential rotation siap dan prasyarat tindakan pemilik tercatat jelas.

## 17. Final Status
`PASS`
