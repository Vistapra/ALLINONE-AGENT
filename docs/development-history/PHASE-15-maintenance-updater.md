# PHASE 15 — COORDINATED DAILY AUTO-UPDATE SYSTEM (03:00 WIB)

## 1. Objective
Mengimplementasikan koordinator pemeliharaan harian terpadu pukul **`03:00 Asia/Jakarta`** (`integration/maintenance_coordinator.py`) yang mempertahankan `\Hermes\HermesAutoUpdate` (`--no-backup`, *zero-backup policy*) tanpa regresi sambil mengelola pemeriksaan/pembaruan sekuensial Paperclip AI dan VulnClaw beserta *offline catch-up*, penundaan pekerjaan aktif, *smoke test*, dan karantina kandidat gagal.

## 2. Prerequisites
- `PHASE-14` (`PASS`) selesai; `\Hermes\HermesAutoUpdate` dan `\Hermes\PlatformMaintenance` terdaftar.

## 3. Current Condition
- `HermesUpdater` aktif pada mode `daily` pukul `03:00 Asia/Jakarta` dengan `BACKUP_ENABLED: false`.

## 4. Technical Analysis
1. **11-State Maintenance Coordinator:** `IDLE`, `MAINTENANCE_PENDING`, `DRAINING`, `PRECHECK`, `CANDIDATE_VALIDATION`, `UPDATING`, `POST_UPDATE_TEST`, `READY`, `DEFERRED`, `FAILED`, dan `NEEDS_ATTENTION`.
2. **Active-Work Deferral:** Memeriksa `HermesUpdater.update_in_progress` dan `Paperclip.list_live_runs()`. Terbukti pada pengujian nyata (`task-2372`) langsung menunda eksekusi menjadi `DEFERRED` (`paperclip_live_runs:1`) tanpa menandai slot harian selesai.
3. **Offline Catch-Up & Same-Day Deduplication:** Jika komputer mati pada pukul `03:00 WIB`, koordinator menjalankan *catch-up* saat komputer menyala, melakukan *smoke test* lintas ketiga komponen, menandai `last_completed_slot = 2026-11-19T03:00:00+07:00`, dan menolak eksekusi ganda di hari yang sama (`waiting_daily_window`).
4. **Zero-Backup Preservation for Hermes:** `HermesUpdater` tetap `BACKUP_ENABLED: false` (`0` arsip backup `.zip`), sedangkan Paperclip memiliki backup DB PostgreSQL terpisah sebelum pembaruan paket npm.

## 5. Implementation Plan
- Menguji penundaan saat ada pekerjaan aktif (`DEFERRED`).
- Menyimulasikan slot `03:00 WIB` yang terlewat (`2026-11-18T03:00:00+07:00`) dan memverifikasi *offline catch-up*, resolusi versi upstream (`npm` & `git ls-remote`), *smoke test*, karantina kandidat gagal, deduplikasi slot hari yang sama, dan ketiadaan arsip backup Hermes.

## 6. Actual Execution
- Diverifikasi melalui `scripts/phase14_to_17_verify_ops_and_governance.py` (`task-2384`).

## 7. Files Created
- `${ALLINONE_HOME}\integration\maintenance_coordinator.py`
- `${ALLINONE_HOME}\data\maintenance\state.json`
- `${ALLINONE_HOME}\docs\PHASE-15-maintenance-updater.md`

## 8. Files Modified
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.json` & `.md`

## 9. Commands Executed
- `${ALLINONE_HOME}\runtime\bin\ai-platform.cmd run-maintenance`
- `${ALLINONE_HOME}\runtime\bin\ai-platform.cmd updates`

## 10. Test Scenarios
- **P15-T1:** Penundaan otomatis saat ada run aktif (`active_work_deferral_verified`).
- **P15-T2:** Eksekusi *offline catch-up* untuk slot `03:00 WIB` yang terlewat beserta *post-update smoke test*.
- **P15-T3:** Deduplikasi eksekusi ulang pada hari yang sama (`waiting_daily_window`).
- **P15-T4:** Verifikasi `0` arsip backup Hermes dibuat (`hermes_zero_backup_preserved`).

## 11. Expected Results
- Seluruh skenario `P15-T1` s/d `P15-T4` lulus (`PASS`).

## 12. Actual Results
- **P15-T1 (`PASS`):** `active_work_deferral_verified: true` (baik simulasi maupun deteksi nyata `paperclip_live_runs:1`).
- **P15-T2 (`PASS`):** `outcome: "completed"`, `slot_completed: "2026-11-19T03:00:00+07:00"`, `next_slot: "2026-11-20T03:00:00+07:00"`, `is_catchup: true`, `actions: ["paperclip:up_to_date:2026.1117.0", "vulnclaw:up_to_date:v0.4.1"]`, `smoke: {"ok": true}`.
- **P15-T3 (`PASS`):** `same_day_slot_deduplicated: true`.
- **P15-T4 (`PASS`):** `BACKUP_ENABLED: false` pada `HermesUpdater` dan `0` arsip `.zip` di direktori backup Hermes.

## 13. Evidence
- `${ALLINONE_HOME}\data\maintenance\state.json`
- `${ALLINONE_HOME}\reports\phase14-to-17-ops-governance-verification.json`

## 14. Problems Found
- `ZoneInfo("Asia/Jakarta")` membutuhkan paket opsional `tzdata` pada distribusi Python standalone Windows.

## 15. Corrective Actions
- Menggunakan `timezone(timedelta(hours=7), name="WIB")` bawaan pustaka standar Python (WIB tetap UTC+7 sepanjang tahun tanpa DST).

## 16. Acceptance Criteria
- [x] Jadwal harian pukul `03:00 WIB` berjalan terkoordinasi.
- [x] Offline *catch-up* berfungsi ketika slot `03:00` terlewat.
- [x] Pekerjaan aktif tidak diputus (`DEFERRED`).
- [x] Kebijakan zero-backup Hermes tetap terjaga utuh.

## 17. Final Status
`PASS`
