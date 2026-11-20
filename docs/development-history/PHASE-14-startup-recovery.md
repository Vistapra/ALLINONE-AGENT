# PHASE 14 — STARTUP, SERVICE MANAGEMENT & SELF-HEALING

## 1. Objective
Mendaftarkan seluruh layanan otonom platform pada Windows Task Scheduler dengan urutan logon bertahap (*staggered triggers*), prioritas I/O/CPU `Normal` (`Priority=4`), pencegahan proses ganda berbasis OS Named Mutex, serta memverifikasi pemulihan otomatis (*self-healing*) pasca-*hard-crash* dan kepatuhan watchdog terhadap `maintenance.lock`.

## 2. Prerequisites
- `PHASE-13` (`PASS`) selesai; `\Hermes_Gateway`, `\cua-driver-serve`, dan `\Hermes\HermesAutoUpdate` existing berjalan sehat.

## 3. Current Condition
- Layanan baru yang dikelola: `\Hermes\PaperclipServer`, `\Hermes\PlatformHealthWatchdog`, dan `\Hermes\PlatformMaintenance`.

## 4. Technical Analysis
1. **Supervisor Hardening (`PaperclipServiceLauncher.exe`):**
   - Memegang OS Named Mutex `Local\PaperclipServer_Singleton`.
   - Mem-polling `proc.HasExited` (bukan `WaitForExit()`, agar pewarisan handle *grandchild* `postgres.exe` di Windows tidak menahan pendeteksian *crash*).
   - Menjalankan `CleanupOrphanedChildren()` (`pg_ctl stop -m fast` + pembersihan `postmaster.pid` yatim) sebelum menyalakan ulang server.
   - Dikonfigurasi pada `<Priority>4</Priority>` (`Normal`) agar tidak mengalami *I/O starvation* (`IO_PRIORITY_VERY_LOW` pada default Task Scheduler `Priority=7`).
   - Memiliki *exponential backoff* (`3s..60s`) dan *crash-loop cool-down* `180 detik` setelah `6` keluar cepat berturut-turut.
2. **Active HTTP Liveness Watchdog (`platform-watchdog.ps1`):**
   - Memeriksa `maintenance.lock` terlebih dahulu (`MAINTENANCE_LOCK_ACTIVE`).
   - Melakukan pemeriksaan HTTP aktif ke `http://127.0.0.1:3100/api/health` dan me-recycle child yang macet bila terjadi kegagalan berturut-turut, serta menjalankan `WorkflowEngine().reconcile_tasks()`.

## 5. Implementation Plan
- Mendaftarkan task melalui `register-paperclip-task.ps1` dan `register-platform-tasks.ps1`.
- Menguji penundaan watchdog saat `maintenance.lock` aktif.
- Menguji *hard-crash injection* (`Stop-Process -Id <nodePid> -Force`) dan memverifikasi Paperclip pulih otomatis ke `status=ok` tanpa campur tangan manusia.

## 6. Actual Execution
- Diverifikasi penuh melalui `scripts/phase14_to_17_verify_ops_and_governance.py` (`task-2384`, exit `0`).

## 7. Files Created
- `${ALLINONE_HOME}\scripts\platform-watchdog.ps1`
- `${ALLINONE_HOME}\scripts\register-platform-tasks.ps1`
- `${ALLINONE_HOME}\scripts\phase14_to_17_verify_ops_and_governance.py`
- `${ALLINONE_HOME}\docs\PHASE-14-startup-recovery.md`

## 8. Files Modified
- `${ALLINONE_HOME}\scripts\PaperclipServiceLauncher.cs` & `runtime\bin\PaperclipServiceLauncher.exe`
- `${ALLINONE_HOME}\scripts\register-paperclip-task.ps1`
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.json` & `.md`

## 9. Commands Executed
- `powershell -File ${ALLINONE_HOME}\scripts\register-paperclip-task.ps1`
- `powershell -File ${ALLINONE_HOME}\scripts\register-platform-tasks.ps1`
- `python -u ${ALLINONE_HOME}\scripts\phase14_to_17_verify_ops_and_governance.py`

## 10. Test Scenarios
- **P14-T1:** Registrasi seluruh task terjadwal tanpa duplikasi dengan task Hermes existing.
- **P14-T2:** Penundaan watchdog saat `maintenance.lock` aktif (`maintenance_lock_watchdog_deferred`).
- **P14-T3:** Pemulihan mandiri otomatis saat proses child `node.exe` (`PID 16088`) dihentikan paksa.

## 11. Expected Results
- Seluruh pengujian `P14-T1` s/d `P14-T3` lulus (`PASS`); uji *physical OS reboot* pasca-registrasi dicatat jujur sebagai `NOT_TESTED` pada Fase 18 (`G10`).

## 12. Actual Results
- **P14-T1 (`PASS`):** `tasks_registered: true` (`\Hermes\PaperclipServer`, `\Hermes\PlatformHealthWatchdog`, `\Hermes\PlatformMaintenance` terdaftar berdampingan dengan task Hermes existing).
- **P14-T2 (`PASS`):** `maintenance_lock_watchdog_deferred: true`.
- **P14-T3 (`PASS`):** `paperclip_killed_pid: "16088"`, `paperclip_crash_self_healed: true` dalam `< 45 detik`.

## 13. Evidence
- `${ALLINONE_HOME}\reports\phase14-to-17-ops-governance-verification.json`

## 14. Problems Found
1. `.NET Process.WaitForExit()` menahan loop ketika *grandchild* `postgres.exe` mewarisi pipe stdout, dan `postmaster.pid` yatim menghambat restart cepat.
2. Default Windows Task Scheduler `<Priority>7</Priority>` memperlambat cold-start I/O menjadi ~278 detik.

## 15. Corrective Actions
1. Mengganti dengan polling `proc.HasExited` + `CleanupOrphanedChildren()` (`pg_ctl stop -m fast`).
2. Mengubah `<Priority>4</Priority>` (`Normal`), memangkas waktu pemulihan *crash* menjadi `< 45 detik`.

## 16. Acceptance Criteria
- [x] Seluruh layanan terdaftar resmi di Windows Task Scheduler tanpa duplikasi.
- [x] Pemulihan otomatis pasca-*crash* terbukti bekerja (`PID 16088 -> recovered`).
- [x] Singleton mutex dan `maintenance.lock` ditaati oleh supervisor & watchdog.
- [x] Batasan pengujian reboot fisik pasca-Fase-14 didokumentasikan secara jujur.

## 17. Final Status
`PASS`
