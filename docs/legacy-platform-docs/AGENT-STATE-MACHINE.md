# MULTI-DIMENSIONAL AGENT BEHAVIOR & STATE MACHINE (`AGENT-STATE-MACHINE.md`)

Implementasi sumber: [state-machine.js](file:///${ALLINONE_HOME}/office-bridge/contracts/state-machine.js)

## 1. Orthogonal 6-Dimension State Model

Untuk mencegah ambiguitas (misalnya agent yang *standby* namun konektivitas *online*, atau task sedang berjalan saat koneksi visual *stale*), setiap karyawan AI di kantor 3D memiliki **6 dimensi state independen**:

| Dimensi | Nilai Valid | Sumber Kebenaran |
|---|---|---|
| `activation_state` | `ACTIVE`, `STANDBY`, `PAUSING`, `DEACTIVATED`, `UNKNOWN` | Paperclip `agent.status` (`idle`/`running` vs `paused`) & `lifecycleState` |
| `connectivity_state` | `ONLINE`, `STALE`, `OFFLINE`, `UNKNOWN` | Keterjangkauan REST/WS Paperclip & kesehatan runtime Hermes |
| `execution_state` | `IDLE`, `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `TIMED_OUT`, `UNKNOWN` | Paperclip `live-runs` & `heartbeat-runs` terkini |
| `task_state` | `NONE`, `ASSIGNED`, `IN_PROGRESS`, `IN_REVIEW`, `WAITING_APPROVAL`, `BLOCKED`, `COMPLETED`, `FAILED`, `CANCELLED`, `UNKNOWN` | Issue aktif agent di Paperclip + `workflow_stage` di `workflow-ledger.db` |
| `maintenance_state` | `NORMAL`, `DRAINING`, `MAINTENANCE_ACTIVE`, `UNKNOWN` | `data\maintenance\maintenance.lock` & `state.json` |
| `visual_state` | 19 state deterministik di bawah ini | Fungsi reduksi prioritas deterministik `computeAgentStateDimensions()` |

---

## 2. Visual State Catalog & Deterministic Priority Order

Urutan evaluasi prioritas tertinggi ke terendah di `computeAgentStateDimensions()`:

1. **`OFFLINE`** — Runtime Paperclip atau Hermes terbukti tidak dapat dijangkau (`connectivity_state === "OFFLINE"`).
2. **`UNKNOWN`** — Data telemetri agent hilang/tidak lengkap (`connectivity_state === "UNKNOWN"`). Dibedakan secara tegas dari `OFFLINE`.
3. **`MAINTENANCE`** — Koordinator pemeliharaan sedang memegang `maintenance.lock` (`maintenance_state === "MAINTENANCE_ACTIVE"`).
4. **`PAUSED`** — Agent berada dalam status Wave-2 `STANDBY` (`paused`), `PAUSING`, atau `DEACTIVATED`.
5. **`WAITING_APPROVAL`** — Terdapat approval Paperclip berstatus `pending` atau tahap workflow `PENDING_APPROVAL`.
6. **Active Execution States (`execution_state` = `RUNNING` / `QUEUED`):**
   - **`WALKING`** — Avatar sedang berpindah ke meja kerja / ruang departemen.
   - **`TESTING`** — Terbukti menjalankan perintah pengujian (`unittest`, `pytest`, `vitest`, `Ran N tests`) pada log/event run aktual.
   - **`BUILDING`** — Terbukti menjalankan kompilasi/build (`py_compile`, `tsc`, `next build`) pada log/event run aktual.
   - **`CODING`** — Terbukti memodifikasi berkas/branch (`write_file`, `edit_file`, `patch`, `git commit`) pada log/event run aktual.
   - **`RESEARCHING`** — Terbukti melakukan inspeksi statis/pencarian (`codescan`, `search_files`, `read_file`).
   - **`COLLABORATING`** — Terbukti terlibat dalam serah-terima delegasi aktif atau rapat koordinasi terotorisasi.
   - **`PLANNING`** — Role eksekutif menyusun dekomposisi rencana kerja pada parent issue.
   - **`REVIEWING`** — Mengeksekusi tugas berstatus `IN_REVIEW` / `UNDER_REVIEW` / triase temuan keamanan.
   - **`WORKING`** — **Default jujur** apabila eksekusi worker aktif terbukti berjalan namun jenis tool spesifik belum terdeteksi (tidak pernah menampilkan `CODING` palsu hanya karena jabatan agent adalah Developer).
7. **`FAILED`** — Run terakhir baru saja berakhir `failed` / `timed_out` (ditahan selama `18 detik` jendela observasi) atau tahap task `FAILED`.
8. **`BLOCKED`** — Issue ditahan oleh prasyarat dependensi atau gate (`task_state === "BLOCKED"`).
9. **`COMPLETED`** — Run terakhir baru saja selesai sukses (`exitCode: 0`, ditahan selama `12 detik` indikator penyelesaian).
10. **`AT_DESK`** — Agent `ACTIVE` memiliki tugas berstatus `ASSIGNED` di mejanya sambil menunggu giliran eksekusi.
11. **`IDLE`** — Agent `ACTIVE` siap menerima tugas tanpa pekerjaan aktif (`task_state === "NONE"`).

---

## 3. Anti-Flicker Debounce & Reconnect Reconciliation

- **Debounce Visual (`350 ms`):** Transisi non-kritis yang berfluktuasi lebih cepat dari `350 ms` diredam agar animasi tidak berkedip, sedangkan state kritis (`OFFLINE`, `UNKNOWN`, `MAINTENANCE`, `FAILED`, `WAITING_APPROVAL`, `PAUSED`) langsung diterapkan tanpa penundaan.
- **Browser Bukan Pemilik State:** Menutup tab browser, me-refresh halaman, atau memutus koneksi WebSocket sama sekali tidak mereset eksekusi backend menjadi `IDLE`. Saat koneksi pulih, `snapshot.reconcile` memulihkan posisi dan state aktual dari Paperclip.
