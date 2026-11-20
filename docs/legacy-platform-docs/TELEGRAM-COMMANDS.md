# Telegram Remote Command Reference (`TELEGRAM-COMMANDS.md`)

## 1. Security & Single-Consumer Architecture

- **Bot:** `@YOUR_BOT_HANDLE_HERE` (`CODEXE`)
- **Exclusive Authorized Owner ID:** `YOUR_TELEGRAM_OWNER_ID_HERE`
- **Single Polling Consumer:** Hanya `\Hermes_Gateway` yang melakukan polling `getUpdates` ke Telegram Bot API, sehingga tidak pernah terjadi konflik `HTTP 409 Conflict`.
- **Platform Bridge:** Instruksi platform diteruskan dari Hermes melalui skill `${ALLINONE_HERMES_HOME}\skills\unified-ai-platform\SKILL.md` ke `${ALLINONE_HOME}\runtime\bin\ai-platform.cmd telegram-cmd ...`. Notifikasi penyelesaian dikirim keluar melalui `POST /sendMessage` satu arah yang telah melewati filter redaksi token `sanitize_text()`.
- **Fail-Closed Auth:** Setiap pemanggilan `handle_telegram_command()` atau `WorkflowEngine` dengan `caller_id != "YOUR_TELEGRAM_OWNER_ID_HERE"` langsung ditolak (`PermissionError`) dan dicatat ke tabel `auth_audit_log` pada `workflow-ledger.db`.

## 2. Supported Platform Commands

| Command | Usage | Behavior |
|---|---|---|
| `/platform_status` | `/platform_status` | Menampilkan status gabungan `HEALTHY`/`DEGRADED`, kesehatan Hermes, Paperclip, VulnClaw, serta CPU/RAM/Disk Windows. |
| `/agents` | `/agents` | Menampilkan seluruh agent organisasi `Unified AI Engineering & Operations`, role, status (`idle`/`paused`), dan batas budget. |
| `/projects` | `/projects` | Menampilkan daftar project yang terdaftar di Paperclip beserta ID dan statusnya. |
| `/tasks` | `/tasks` | Menampilkan 15 task terbaru di Paperclip beserta identifier `UNI-*` dan statusnya. |
| `/task_status` | `/task_status <UNI-X atau UUID>` | Menampilkan status terkini, prioritas, assignee, dan komentar/hasil terakhir dari suatu task. |
| `/create_task` | `/create_task <Judul> \| <Deskripsi>` | Membuat task baru di Paperclip secara **idempotent** (pesan duplikat mengembalikan task yang sama) dan menugaskannya ke `CEO Agent`. |
| `/pause_task` | `/pause_task <UNI-X>` | Mengubah tahap workflow menjadi `BLOCKED` di Paperclip dan ledger. |
| `/resume_task` | `/resume_task <UNI-X>` | Mengembalikan task yang ditunda menjadi `ASSIGNED` (`todo`). |
| `/cancel_task` | `/cancel_task <UNI-X>` | Membatalkan task (`CANCELLED`) sekaligus menghentikan heartbeat run aktif terkait. |
| `/security_report` | `/security_report [nama-folder-workspace]` | Menampilkan ringkasan temuan pada `findings.db` (dan opsional menjalankan pemindaian statis defensif VulnClaw pada subfolder `workspaces\`). |
| `/update_status` | `/update_status` | Menampilkan status jadwal pemeliharaan harian `03:00 WIB` untuk `HermesUpdater` dan `PlatformMaintenance`. |
| `/help_platform` | `/help_platform` | Menampilkan daftar ringkas seluruh perintah platform. |

## 3. Natural Language Routing

Selain slash command di atas, Owner tetap dapat mengirim instruksi bahasa alami seperti biasa:
- **Instruksi Windows / Desktop langsung** (*"Buka Visual Studio Code"*, *"Ambil screenshot desktop"*, *"Periksa kapasitas drive C dan D"*) -> dieksekusi langsung oleh Hermes menggunakan toolset lokal dan Computer Use.
- **Instruksi rekayasa multi-agent / proyek kompleks** (*"Analisis project X, buat rencana, delegasikan ke developer dan QA, review keamanan..."*) -> dikelola sebagai parent/child task terstruktur di Paperclip.
