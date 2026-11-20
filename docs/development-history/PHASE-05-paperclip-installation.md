# PHASE 05 — PAPERCLIP INSTALLATION & INITIAL CONFIGURATION

## 1. Objective
Memasang Paperclip AI menggunakan metode rilis resmi yang paling stabil untuk Windows, menginisialisasi database PostgreSQL, mengaktifkan autentikasi pada loopback `127.0.0.1:3100`, serta membuktikan bahwa Dashboard, API, penolakan akses tanpa otorisasi, dan persistensi data lintas *restart* berfungsi tanpa mengganggu Hermes existing.

## 2. Prerequisites
- `PHASE-04` (`PASS`) selesai dengan `node26.cmd` (`v26.12.1`) dan `npm26.cmd` (`12.2.2`) tersedia.
- Secret Paperclip tersedia di `${ALLINONE_HOME}\config\secrets\paperclip-auth.env` & `paperclip-admin.json`.

## 3. Current Condition
- Sebelum Fase 05, belum ada instalasi runtime Paperclip atau database Paperclip pada host `<machine-name>`.

## 4. Technical Analysis
1. **Metode Instalasi Tunggal:** Menggunakan paket rilis stabil resmi `paperclipai@2026.1117.0` (commit `c0f132898d2a2677312d8c72096187b27a3d9a38`) di `${ALLINONE_HOME}\runtime\paperclip-app` dengan data terisolasi di `${ALLINONE_HOME}\data\paperclip`. Postinstall hydration untuk `@embedded-postgres/windows-x64` dijalankan secara eksplisit karena `npm 12.2.2` memblokir skrip otomatis pihak ketiga secara default.
2. **Database & Backup Terpisah:** Embedded PostgreSQL dijalankan secara lokal pada `127.0.0.1:54329` (`450` migrasi Drizzle berhasil diterapkan), dengan backup otomatis terkompresi (`paperclip-20261119-094922.sql.gz`, retensi 3 hari setiap 720 menit) terpisah dari kebijakan zero-backup Hermes.
3. **Autentikasi Loopback (`authenticated` + `private` + `127.0.0.1:3100`):** Meskipun terikat ke loopback `127.0.0.1`, mode `authenticated` diaktifkan sehingga request lokal tanpa kredensial ke `/api/companies` ditolak (`HTTP 403`). Setelah akun operator Board terdaftar dan `bootstrap_ceo` diterima (`HTTP 202`), pendaftaran publik ditutup (`auth.disableSignUp = true`) dan Board API key disimpan terenkripsi/ACL-locked di `config\secrets\paperclip-board-key.json`.
4. **Supervisor Layanan Windows:** Karena `paperclipai service` hanya mendukung `systemd`/`launchd`, supervisor C# tanpa jendela (`PaperclipServiceLauncher.exe`) dikompilasi dan didaftarkan pada Task Scheduler `\Hermes\PaperclipServer` (dilengkapi singleton mutex `Local\PaperclipServer_Singleton`, deteksi `maintenance.lock`, dan redaksi token otomatis).

## 5. Implementation Plan
- Menginstal `paperclipai@2026.1117.0` dan menjalankan `hydrate-symlinks.js`.
- Membangun `paperclip-server-entry.mjs`, `PaperclipServiceLauncher.exe`, dan task `\Hermes\PaperclipServer`.
- Mengonfigurasi `instances\default\config.json` (`authenticated`, `127.0.0.1:3100`), menjalankan `paperclipai doctor`, melakukan bootstrap Board Owner, membuat organisasi `Unified AI Engineering & Operations`, melakukan backup awal DB, me-*restart* layanan, dan memverifikasi persistensi data.

## 6. Actual Execution
- Menjalankan instalasi `paperclipai@2026.1117.0` (`444` paket terpasang; sisa ruang `D:` `4.66 GB`).
- Menjalankan `paperclipai doctor` (`12/12 passed`), migrasi pertama (`450` SQL migrations), bootstrap Board API key, pembuatan organisasi (`0000000b-0000-4000-8000-00000000000b`), `db:backup` (`92,460` bytes), dan pengujian *restart* penuh.

## 7. Files Created
- `${ALLINONE_HOME}\runtime\paperclip-app\` (`paperclipai@2026.1117.0`)
- `${ALLINONE_HOME}\runtime\bin\paperclipai.cmd`
- `${ALLINONE_HOME}\runtime\bin\PaperclipServiceLauncher.exe`
- `${ALLINONE_HOME}\scripts\PaperclipServiceLauncher.cs`
- `${ALLINONE_HOME}\scripts\paperclip-server-entry.mjs`
- `${ALLINONE_HOME}\scripts\register-paperclip-task.ps1`
- `${ALLINONE_HOME}\scripts\bootstrap_and_verify_paperclip.py`
- `${ALLINONE_HOME}\integration\paperclip_client.py`
- `${ALLINONE_HOME}\data\paperclip\instances\default\config.json`
- `${ALLINONE_HOME}\docs\PHASE-05-paperclip-installation.md`

## 8. Files Modified
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.json`
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.md`

## 9. Commands Executed
- `npm26.cmd install --prefix ${ALLINONE_HOME}\runtime\paperclip-app paperclipai@2026.1117.0 ...`
- `node26.cmd scripts/hydrate-symlinks.js`
- `csc.exe /nologo /optimize+ /target:exe /out:...\PaperclipServiceLauncher.exe ...\PaperclipServiceLauncher.cs`
- `powershell -File ...\register-paperclip-task.ps1`
- `python -u ...\bootstrap_and_verify_paperclip.py`
- `paperclipai.cmd db:backup -d ${ALLINONE_HOME}\data\paperclip --json`

## 10. Test Scenarios
- **P05-T1:** `paperclip doctor` dan startup server + database PostgreSQL embedded.
- **P05-T2:** Dashboard HTML (`GET /`) dan Health endpoint (`GET /api/health`).
- **P05-T3:** Penolakan request tanpa otentikasi (`GET /api/companies` -> `403`) vs keberhasilan dengan Board API key (`200`).
- **P05-T4:** Persistensi organisasi `Unified AI Engineering & Operations` setelah proses server dihentikan dan dinyalakan ulang.
- **P05-T5:** Pemeriksaan socket listening (`127.0.0.1:3100` & `127.0.0.1:54329` saja) dan kesehatan Hermes existing.

## 11. Expected Results
- Seluruh pengujian `P05-T1` s/d `P05-T5` lulus tanpa mengekspos port publik dan tanpa mengganggu Hermes existing.

## 12. Actual Results
- **P05-T1 (`PASS`):** `12 passed — All checks passed!`, `450` migrasi diterapkan, backup DB `92,460` bytes tersimpan (`databaseBackup.status: "ok"`).
- **P05-T2 (`PASS`):** `dashboard_ui_ok: True (7815 bytes)`, `/api/health` mengembalikan `{"status":"ok","commit":"c0f132898d2a2677312d8c72096187b27a3d9a38","bootstrapStatus":"ready"}`.
- **P05-T3 (`PASS`):** Unauthenticated `/api/companies` = `403`; authenticated `/api/companies` = `200`, `create_company_status = 201`.
- **P05-T4 (`PASS`):** `post_restart_company_persisted: True` (`company_id: 0000000b-0000-4000-8000-00000000000b`).
- **P05-T5 (`PASS`):** Port `3100` hanya di `127.0.0.1`, port `54329` hanya di `127.0.0.1`/`::1`; `Hermes Unified Health Status: HEALTHY`.

## 13. Evidence
- Log `task-1806.log` dan `task-1812.log` (`exit code 0`).
- Backup file `${ALLINONE_HOME}\data\paperclip\instances\default\data\backups\paperclip-20261119-094922.sql.gz`.

## 14. Problems Found
1. `npm 12.2.2` memblokir postinstall `@embedded-postgres/windows-x64` secara default (`allowScripts`).
2. `paperclipai run` tidak menerima flag `--yes`, subcommand bootstrap bernama `auth bootstrap-ceo` (mengembalikan HTTP `202`), dan cold-import pertama + 450 migrasi memerlukan ~86 detik pada CPU 2-core.

## 15. Corrective Actions
1. Menjalankan `hydrate-symlinks.js` secara eksplisit setelah instalasi npm.
2. Membuat entrypoint langsung `paperclip-server-entry.mjs` tanpa dependensi eksternal, mendaftarkan `\Hermes\PaperclipServer` di Task Scheduler agar lepas dari subshell Job Object, serta memperbarui verifikasi HTTP `202` pada `bootstrap_and_verify_paperclip.py`.

## 16. Acceptance Criteria
- [x] Paperclip dapat dijalankan (`2026.1117.0`).
- [x] Dashboard tampil (`http://127.0.0.1:3100/`, `200 OK`).
- [x] Database sehat (`embedded-postgres` pada `127.0.0.1:54329`, backup aktif).
- [x] API merespons (`/api/health` -> `ok`).
- [x] Data bertahan setelah restart (`0000000b-0000-4000-8000-00000000000b`).
- [x] Authentication berfungsi (`403` tanpa token, `200` dengan Bearer Board key, public sign-up dinonaktifkan).
- [x] Tidak ada public port yang tidak diperlukan.
- [x] Hermes existing tetap sehat (`HEALTHY`).

## 17. Final Status
`PASS`
