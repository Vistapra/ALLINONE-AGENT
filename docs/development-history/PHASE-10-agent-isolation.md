# PHASE 10 — ROLE INSTRUCTIONS, SESSION & MEMORY ISOLATION

## 1. Objective
Menerapkan berkas instruksi khusus per-role (`AGENTS.md` / `SOUL.md`), memverifikasi isolasi penuh sesi (`state.db`), memori (`MEMORY.md`), dan toolset antar-role serta terhadap profil pribadi Owner, sekaligus membuktikan mekanisme pencegahan konflik workspace paralel (`workspace_exclusive_lock` dan `create_isolated_git_worktree`).

## 2. Prerequisites
- `PHASE-09` (`PASS`) selesai dengan 11 role organisasi diprovisikan.

## 3. Current Condition
- Setiap role memiliki profil bernama di `${ALLINONE_HERMES_HOME}\profiles\pc<role>` dan direktori metadata di `${ALLINONE_HOME}\workers\<role>`.

## 4. Technical Analysis
1. **Role-Specific Instructions & Least-Privilege Toolsets:**
   - `Security Reviewer`, `Security Lead`, `Findings Analyst`, `Remediation Reviewer`, dan `Compliance Reporter` hanya mendapatkan toolset `file` (*read-only* tanpa `terminal`).
   - `CEO`, `CTO`, `Backend Developer`, `Frontend Developer`, `DevOps`, dan `QA Engineer` mendapatkan `file,terminal` dengan batas workspace eksplisit.
2. **Disjoint Sessions & Private Memory Protection:**
   - Setiap profil menyimpan `state.db` dan `memories\MEMORY.md` sendiri dengan NTFS ACL terkunci. Sesi Telegram pribadi Owner (`26` sesi di `${ALLINONE_HERMES_HOME}\state.db`) dan `MEMORY.md` Owner tidak tersentuh (`byte-for-byte` identik).
3. **Workspace Conflict Protection:**
   - `workspace_exclusive_lock` menggunakan lock atomik `os.O_CREAT | os.O_EXCL` untuk menolak penulisan serentak pada folder yang sama (`TimeoutError`).
   - `create_isolated_git_worktree` membuat direktori Git worktree cabang terpisah sehingga dua worker paralel dapat mengedit nama berkas yang sama tanpa saling menimpa.
4. **Transient Upstream Router Resilience (`combo/X`):**
   - Karena router `combo/X` merutekan request lintas beberapa model backend (dan sesekali satu rute upstream mengembalikan pesan model *deprecated*), helper eksekusi menerapkan retry terbatas (*bounded retry* maksimal 2x) sesuai batas tata kelola.

## 5. Implementation Plan
- Memvalidasi keberadaan dan isi `AGENTS.md` pada seluruh 11 role.
- Menjalankan inspeksi *read-only* pada `Security Reviewer` dan verifikasi pengujian pada `QA Engineer` di `workspaces\phase10-isolation-lab`, lalu membuktikan himpunan `session_id` keduanya saling lepas (*disjoint*).
- Menguji pemblokiran lock eksklusif ganda dan isolasi dua Git worktree paralel (`feature/worktree-alpha` vs `feature/worktree-beta`).

## 6. Actual Execution
- Dieksekusi melalui `scripts/phase09_10_verify_org_and_isolation.py` (`task-2255` & `task-2268`).

## 7. Files Created
- `${ALLINONE_HOME}\scripts\phase09_10_verify_org_and_isolation.py`
- `${ALLINONE_HOME}\workspaces\phase10-isolation-lab\sample_config.py`
- `${ALLINONE_HOME}\reports\phase09-10-org-isolation-verification.json`
- `${ALLINONE_HOME}\docs\PHASE-10-agent-isolation.md`

## 8. Files Modified
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.json` & `.md`

## 9. Commands Executed
- `python -u ${ALLINONE_HOME}\scripts\phase09_10_verify_org_and_isolation.py`

## 10. Test Scenarios
- **P10-T1:** Validasi isi `AGENTS.md` untuk seluruh 11 role (`instructions_verified`).
- **P10-T2:** Isolasi sesi SQLite antara `Security Reviewer` (`pcsecurityreviewer\state.db`) dan `QA Engineer` (`pcqaengineer\state.db`).
- **P10-T3:** Pencegahan tabrakan melalui `workspace_exclusive_lock` dan isolasi edit simultan pada `create_isolated_git_worktree`.
- **P10-T4:** Keutuhan `state.db` dan `MEMORY.md` milik Owner.

## 11. Expected Results
- Seluruh pengujian `P10-T1` s/d `P10-T4` bernilai `true` / `PASS`.

## 12. Actual Results
- **P10-T1 (`PASS`):** `instructions_verified: true` untuk ke-11 role.
- **P10-T2 (`PASS`):** `security_reviewer_run` (`3a129d25-e335-4a5c-b6b2-c75c667352bc`, `succeeded`, exit `0`), `role_sessions_disjoint: true`.
- **P10-T3 (`PASS`):** `workspace_lock_conflict_blocked: true`, `parallel_git_worktree_isolated: true`.
- **P10-T4 (`PASS`):** `owner_sessions_untouched: true`, `owner_memory_untouched: true`.

## 13. Evidence
- `${ALLINONE_HOME}\reports\phase09-10-org-isolation-verification.json`

## 14. Problems Found
- Satu percobaan awal pada `combo/X` merutekan ke slot model upstream lama (`Claude Opus 4.6 is no longer available`) dan mengembalikan exit code `1`.

## 15. Corrective Actions
- Menambahkan *bounded retry* (maksimal 2 retry) pada helper pemicu run worker sehingga kegagalan transien router `combo/X` dipulihkan secara otomatis dan deterministik.

## 16. Acceptance Criteria
- [x] Setiap agent mempunyai berkas instruksi peran (`AGENTS.md` & `SOUL.md`).
- [x] Sesi tidak bercampur antar-role maupun dengan sesi Telegram Owner.
- [x] Memory pribadi Owner tidak bocor ke project worker.
- [x] Dua pekerjaan berbeda tidak saling merusak file (`workspace_exclusive_lock` + Git worktree).

## 17. Final Status
`PASS`
