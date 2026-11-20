# ARCHITECTURE DECISION RECORD — HERMES3D AS INTERACTIVE 3D VIRTUAL OFFICE FRONTEND (`HERMES3D-ARCHITECTURE-DECISION.md`)

- **Status:** `ACCEPTED`
- **Date:** `2026-11-19`
- **Context:** Integrasi `iamlukethedev/Hermes3D` (`beb7629`) ke dalam **UNIFIED AUTONOMOUS AI AGENT PLATFORM** (`Paperclip v2026.1117.0` + `Hermes Agent v0.23.2+` + `VulnClaw v0.4.1` + `Telegram CODEXE`).

## 1. Problem Statement
Kita membutuhkan lingkungan kantor virtual 3D interaktif (**UNIFIED AUTONOMOUS AI COMPANY**) di mana setiap karyawan avatar merepresentasikan 1 dari 11 role agent nyata yang bekerja di Paperclip dan dieksekusi oleh Hermes Workers, tanpa menciptakan orkestrator kedua, database bisnis kedua, poller Telegram kedua, atau animasi dekoratif palsu.

## 2. Evaluated Options

### Option A — Menggunakan `server/hermes-gateway-adapter.js` Bawaan Hermes3D
- **Ditolak.** Adapter bawaan mengelola registri sub-agent sendiri di memori (`spawn_agent`, `delegate_task`) dan memanggil API HTTP Hermes secara langsung, sehingga melewati tata kelola, antrean issue `UNI-*`, hierarki 11 role, isolasi profil `profiles\pc*`, serta batas anggaran di Paperclip.

### Option B — Hanya Menggunakan `CustomRuntimeProvider` HTTP Polling Bawaan Hermes3D
- **Tidak Cukup Sendirian.** `src/lib/runtime/custom/provider.ts` di upstream hanya menyediakan HTTP request-response (`GET /health`, `/state`, `/registry`, `POST /v1/chat/completions`) dan secara eksplisit belum mengimplementasikan streaming event real-time (`runtime-agent-events`, `presence`, `tool`, `exec.approval`).

### Option C — **Selected Architecture:** Hermes3D Frontend (`127.0.0.1:3200`) + Dedicated Modular **Office Bridge** (`127.0.0.1:3210`) di Atas Paperclip & Unified Integration Layer
- **Dipilih.** Memanfaatkan kekuatan penuh engine 3D/2D & WebSocket proxy Hermes3D sambil menjaga **Paperclip (`127.0.0.1:3100`)** sebagai satu-satunya pusat orkestrasi dan **Hermes (`profiles\pc*`)** sebagai satu-satunya mesin eksekusi.

## 3. Core Architectural Decisions

1. **Strict Single Source of Truth:**
   - **Organisasi, 11 Agent, Project, Task (`UNI-*`), Run, Approval, & Budget:** Dimiliki 100% oleh **Paperclip PostgreSQL** dan diakses hanya melalui REST API resmi (`http://127.0.0.1:3100/api/*`) serta WebSocket live events resmi (`ws://127.0.0.1:3100/api/companies/:companyId/events/ws`).
   - **Execution State & Worker Isolation:** Dimiliki oleh **Hermes Agent** melalui adapter resmi `hermes_local` (`${ALLINONE_HERMES_HOME}\profiles\pc*`).
   - **Defensive Security Findings:** Dimiliki oleh **SQLite `data\findings\findings.db`** (`FindingsStore`) dan disinkronkan ke issue Paperclip.
   - **Hermes3D & Office Bridge Persistence:** Hanya menyimpan tata letak kantor visual (`office-data\layouts\`), profil visual avatar (`office-data\visual-profiles\`), preferensi kualitas grafis (`HERMES_STATE_DIR=${ALLINONE_HOME}\office-data\studio-state`), dan buffer riwayat event terikat (*bounded ring buffer* di `office-data\event-history\`).

2. **Dual-Surface Office Bridge (`${ALLINONE_HOME}\office-bridge\` pada `127.0.0.1:3210`):**
   - Dibangun di atas runtime terisolasi `node26.cmd` (`Node.js v26.12.1` dengan modul bawaan `node:sqlite`, `node:http`, `node:crypto`, dan `ws`) sehingga ringan (`~45 MB` RAM, `0` duplikasi paket berat).
   - Menyediakan **tiga antarmuka terintegrasi** pada satu proses singleton:
     1. **Hermes3D Gateway WS Protocol v3 (`ws://127.0.0.1:3210/ws`):** Menyuplai 11 agent asli Paperclip ke scene 3D/2D Hermes3D secara real-time, menerjemahkan penugasan chat/instruksi menjadi issue/komentar terotorisasi di Paperclip, dan meneruskan pembatalan ke `POST /api/heartbeat-runs/:runId/cancel`.
     2. **Custom Runtime HTTP Seam (`GET /health`, `/state`, `/registry`, `POST /v1/chat/completions`):** Memenuhi kontrak `CustomRuntimeProvider` Hermes3D secara penuh.
     3. **Enterprise Office REST & Normalized Event Stream (`/api/office-bridge/*` + `ws://127.0.0.1:3210/api/events/ws`):** Mengirim kontrak event ternormalisasi `schema_version: "1.0"` (`OFFICE-EVENT-SCHEMA.md`) serta melayani modul custom Enterprise di Hermes3D (**Agent Command Center**, **Security Operations Center**, **Collaboration & Meeting Room**, **Governance & Budget Center**, **Company Observability & Evidence Viewer**, dan **Telegram Bidirectional Sync**).

3. **Disk-Conscious Dependency Strategy (`D:` `4.44 GB` Free):**
   - Source code Hermes3D, cabang Git `integration/unified-ai-company`, konfigurasi, Office Bridge, dan `office-data` berada di `${ALLINONE_HOME}\`.
   - Apabila direktori fisik `node_modules` Hermes3D berukuran besar (`~700 MB`), folder fisik paket dapat ditempatkan di `${ALLINONE_HERMES_HOME}3d-node-modules` (`C:` memiliki `44.71 GB` bebas) dan dihubungkan melalui Windows Directory Junction (`mklink /J`) ke `${ALLINONE_HOME}\hermes3d\source\node_modules` agar sisa ruang `D:` tetap aman di sekitar `~4.2 GB` (jauh di atas batas `2.0 GB` `maintenance_coordinator.py`).

4. **Zero Credential Sharing & Loopback Hardening:**
   - Baik Hermes3D (`127.0.0.1:3200`) maupun Office Bridge (`127.0.0.1:3210`) **tidak pernah** membaca `TELEGRAM_BOT_TOKEN` atau `CUSTOM_API_KEY`.
   - Keduanya memakai token rahasia lokal masing-masing di `${ALLINONE_HOME}\config\secrets\office-bridge-auth.json` (dikunci ACL NTFS), `STUDIO_ACCESS_TOKEN` diaktifkan, `UPSTREAM_ALLOWLIST=127.0.0.1,localhost`, dan rute lokal berisiko (`/api/path-suggestions`, `/api/gateway/agent-state`, `/api/gateway/skills/remove`) dikunci.
   - Kegagalan atau dimatikannya Hermes3D / Office Bridge maupun ditutupnya tab browser sama sekali tidak menghentikan Paperclip, Hermes Workers, VulnClaw, atau Telegram Gateway.
