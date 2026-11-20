# PHASE 12 — CENTRAL TASK LIFECYCLE & WORKFLOW ENGINE

## 1. Objective
Mengimplementasikan dan memverifikasi mesin siklus hidup task terpusat (`integration/workflow_engine.py`) dengan 13 tahap status, penyimpanan SQLite `workflow-ledger.db`, pembukaan otomatis task dependen (`reconcile_tasks`), pendeteksian siklus DAG, pembatasan kedalaman delegasi, dan pembatasan jumlah retry.

## 2. Prerequisites
- `PHASE-11` (`PASS`) selesai dengan jembatan Telegram <-> Paperclip aktif.

## 3. Current Condition
- Task Paperclip membutuhkan orkestrasi ketergantungan lintas parent/child, pencegahan *infinite delegation loop*, dan batas retry yang deterministik.

## 4. Technical Analysis
1. **13-Stage Canonical State Machine:** Memetakan `RECEIVED`, `TRIAGED`, `PLANNED`, `PENDING_APPROVAL`, `ASSIGNED`, `IN_PROGRESS`, `IN_REVIEW`, `IN_TESTING`, `READY_FOR_ACCEPTANCE`, `COMPLETED`, `FAILED`, `BLOCKED`, dan `CANCELLED` ke status native Paperclip beserta bukti artefak (`evidence_json`).
2. **DAG & Loop Prevention:**
   - `_check_no_cycle()` mencegah ketergantungan melingkar (`ValueError`).
   - `max_delegation_depth = 2` dan `max_subtasks_per_parent = 6` mencegah ledakan subtask rekursif.
   - `max_retries_per_task = 2` memblokir percobaan ulang ke-3 (`RuntimeError`) untuk ditinjau manual.
3. **Automatic Dependency Unblocking:** `reconcile_tasks()` memantau task dalam tahap `PLANNED` (`backlog`) dan otomatis mempromosikannya ke `ASSIGNED` (`todo`) begitu seluruh task prasyarat mencapai `done`.

## 5. Implementation Plan
- Menguji rantai ketergantungan `Prerequisite Task A` -> `Dependent Task B`, memverifikasi `Task B` tertahan di `PLANNED`, menyelesaikan `Task A`, menjalankan `reconcile_tasks()`, dan memverifikasi `Task B` otomatis terbuka (`dependencies_unblocked == 1`).
- Menguji penolakan kedalaman level 3, penolakan siklus, dan penegakan batas retry maksimal 2 kali.

## 6. Actual Execution
- Diverifikasi penuh melalui `scripts/phase11_12_verify_telegram_and_workflow.py` (`task-2309`, exit `0`).

## 7. Files Created
- `${ALLINONE_HOME}\integration\workflow_engine.py`
- `${ALLINONE_HOME}\data\workflow-ledger.db`
- `${ALLINONE_HOME}\docs\PHASE-12-workflow-engine.md`

## 8. Files Modified
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.json` & `.md`

## 9. Commands Executed
- `python -u ${ALLINONE_HOME}\scripts\phase11_12_verify_telegram_and_workflow.py`

## 10. Test Scenarios
- **P12-T1:** Penahanan task dependen di `PLANNED` sebelum prasyarat selesai, lalu pembukaan otomatis oleh `reconcile_tasks()`.
- **P12-T2:** Penolakan kedalaman delegasi `> 2` (`depth3_guard_enforced`).
- **P12-T3:** Deteksi dan penolakan siklus dependensi (`cycle_guard_enforced`).
- **P12-T4:** Penegakan batas retry maksimal 2 kali (`retry_cap_enforced`).

## 11. Expected Results
- Seluruh pengujian `P12-T1` s/d `P12-T4` lulus (`PASS`).

## 12. Actual Results
- **P12-T1 (`PASS`):** `dependency_blocked_initially: true`, `reconcile_result: {"synced_completed": 0, "dependencies_unblocked": 1}`.
- **P12-T2 (`PASS`):** `depth3_guard_enforced: true`.
- **P12-T3 (`PASS`):** `cycle_guard_enforced: true`.
- **P12-T4 (`PASS`):** `retry_cap_enforced: true`.

## 13. Evidence
- `${ALLINONE_HOME}\reports\phase11-12-telegram-workflow-verification.json`

## 14. Problems Found
1. Saat `retry_task()` dijalankan pada role standby yang sedang `paused`, `wake_agent` mengembalikan HTTP `409`.
2. Deduplikasi sisi server Paperclip membutuhkan pengecekan `existing_issue` pada `task_ledger` sebelum `INSERT`.

## 15. Corrective Actions
1. Menangani respons `409` pada agent standby secara aman di `retry_task()`.
2. Menambahkan pengecekan `SELECT * FROM task_ledger WHERE paperclip_issue_id = ?` setelah `create_issue()`.

## 16. Acceptance Criteria
- [x] Transisi 13 tahap status bekerja dan tersinkron dengan Paperclip.
- [x] Parent dan child tasks terhubung beserta batas kedalaman (`<= 2`).
- [x] Task dependen otomatis terbuka saat prasyarat selesai (`dependencies_unblocked: 1`).
- [x] Retry dibatasi maksimal 2 kali dan siklus dependensi tertolak.

## 17. Final Status
`PASS`
