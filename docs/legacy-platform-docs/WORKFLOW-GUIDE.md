# Multi-Agent Engineering & Security Workflow Guide (`WORKFLOW-GUIDE.md`)

## 1. Canonical 13-Stage Task Lifecycle

Setiap task pada `WorkflowEngine` (`data\workflow-ledger.db`) memetakan 13 tahap operasional ke status native Paperclip:

| Platform Stage | Paperclip Status | Meaning |
|---|---|---|
| `RECEIVED` | `backlog` | Instruksi diterima dari Owner (`YOUR_TELEGRAM_OWNER_ID_HERE`). |
| `TRIAGED` | `backlog` | Diklasifikasikan oleh input router (8 kategori). |
| `PLANNED` | `backlog` | Menunggu prasyarat dependensi parent/sibling selesai. |
| `PENDING_APPROVAL` | `blocked` | Menunggu persetujuan eksplisit Owner (mis. rilis produksi / UAC). |
| `ASSIGNED` | `todo` | Ditugaskan ke role agent spesifik dan siap dieksekusi. |
| `IN_PROGRESS` | `in_progress` | Sedang dikerjakan oleh worker Hermes pada branch terisolasi. |
| `IN_REVIEW` | `in_review` | Sedang ditinjau oleh `Security Reviewer` atau lead. |
| `IN_TESTING` | `in_review` | Sedang diuji oleh `QA Engineer` (unit & regression suite). |
| `READY_FOR_ACCEPTANCE` | `in_review` | Seluruh pengujian lulus, siap ditutup / diserahkan. |
| `COMPLETED` | `done` | Selesai beserta bukti artefak nyata & laporan dikirim ke Telegram. |
| `FAILED` | `blocked` | Eksekusi gagal melampaui batas retry (`max_retries_per_task = 2`). |
| `BLOCKED` | `blocked` | Ditunda manual (`/pause_task`) atau terhalang kebijakan scope. |
| `CANCELLED` | `cancelled` | Dibatalkan oleh Owner (`/cancel_task`). |

## 2. Standard Software Development & Defensive Remediation Flow

1. **Intake & Planning (`CEO Agent`):** Menerima objektif dari Telegram Owner, memeriksa struktur repositori uji secara *read-only*, dan menyusun rincian pekerjaan.
2. **Defensive Static Scan (`VulnClaw` + `Security Reviewer`):**
   - `scan_authorized_code()` memindai kode sumber pada workspace yang diizinkan.
   - `FindingsStore.ingest_finding()` menyimpan temuan secara terdeduplikasi dan membuat task `[Security Review]` pada Paperclip.
   - `Security Reviewer` (hanya toolset `file`, tanpa shell) memvalidasi apakah temuan merupakan `FALSE_POSITIVE` atau `CONFIRMED`.
   - Saat transisi ke `CONFIRMED`, sistem otomatis menerbitkan child task `[Remediation]`.
3. **Isolated Branch Implementation (`Backend Developer`):**
   - Membuat/berpindah ke Git branch fitur/perbaikan tersendiri (tidak pernah memodifikasi `main` secara langsung tanpa pengujian).
   - Mengakuisisi `workspace_exclusive_lock` (atau menggunakan `create_isolated_git_worktree` untuk pekerjaan paralel).
   - Mengimplementasikan kode, perbaikan keamanan, serta unit/regression test, lalu melakukan commit lokal pada branch tersebut.
4. **Independent Verification (`QA Engineer` + `VulnClaw` Re-scan):**
   - Pemindaian ulang VulnClaw memastikan kelemahan statis telah teratasi (`RESOLVED`).
   - `QA Engineer` menjalankan rangkaian pengujian independen (`python -m unittest discover -v`) dan memverifikasi exit code `0`.
5. **Production Gate & Owner Report:**
   - Merge ke `main` atau *deployment* produksi ditahan pada status `PENDING_APPROVAL` hingga disetujui Owner.
   - Ringkasan akhir yang telah disensor dari rahasia dikirim otomatis ke Telegram Owner `YOUR_TELEGRAM_OWNER_ID_HERE`.
