# PHASE 21 — HERMES3D DEEP REPOSITORY & COMPATIBILITY RESEARCH

## 1. Objective
Melakukan audit kode sumber secara menyeluruh terhadap repositori resmi **[iamlukethedev/Hermes3D](https://github.com/iamlukethedev/Hermes3D)** (`commit beb76292747b816ef317aa6f9a3992e0014f81d9`, branch `main`, 4 commit di atas rilis `v1.0.0`), memverifikasi kontrak runtime provider, arsitektur 3D/2D scene, lisensi kode & aset, kompatibilitas Windows, tumpang tindih orkestrasi dengan Paperclip, serta batas keamanan (*trust boundaries*).

## 2. Prerequisites
- `PHASE-20` lulus (`PASS`) dengan platform existing dalam kondisi `HEALTHY`.
- Source tree `Hermes3D` berhasil di-clone ke `${ALLINONE_HOME}\hermes3d\source`.

## 3. Previous Phase Dependencies
- `PHASE-20` ([PHASE-20-platform-preservation-audit.md](file:///${ALLINONE_HOME}/docs/PHASE-20-platform-preservation-audit.md)) — inventaris port bebas, spesifikasi GPU `NVIDIA GeForce GT 710` (`2 GB VRAM`), dan kontrak REST/WebSocket Paperclip (`127.0.0.1:3100`).

## 4. Current Condition
Repositori `iamlukethedev/Hermes3D` terdiri atas **672 berkas** dengan metadata terverifikasi:
- **HEAD Commit (`main`):** `beb76292747b816ef317aa6f9a3992e0014f81d9` (*"Add 2D pixel office mode (Gather-style) with a 3D/2D renderer toggle (#25)"*).
- **Release Tag:** `v1.0.0` (`35763d95c9ba27a6496a27211b03ed2a0b311182`).
- **Lisensi Kode:** **MIT License** (`Copyright (c) 2026 Luke The Dev`).
- **Lisensi Aset 3D/2D:**
  - `public/office-assets/models/furniture/*.glb` (15 model furnitur kantor low-poly) — aset domain publik **CC0 1.0** (Kenney Furniture Kit).
  - `public/office-assets/env/office_env_1k.hdr` — pencahayaan langit HDRI berlisensi **CC0** (didokumentasikan eksplisit di `src/features/retro-office/systems/atmosphere.tsx:4`).
  - `src/lib/avatars/vendor/multiavatar.js` — generator avatar deterministik berlisensi **MIT**.
  - Avatar karakter 3D (`src/features/retro-office/objects/agents.tsx`) — mesh artikulasi prosedural `Three.js` murni buatan proyek (MIT).
  - Tidak ditemukan dependensi atau aset berlisensi copyleft ketat (GPL/AGPL) maupun aset berhak cipta tanpa izin.

## 5. Technical Analysis

### 5.1 Verifikasi Path & Modul Aktual
| Path yang Diperiksa | Keberadaan Aktual | Analisis Implementasi Kode Sumber |
|---|---|---|
| `src/lib/runtime/custom/` | **ADA** (`provider.ts`, `http.ts`) | Mengimplementasikan `CustomRuntimeProvider` melalui proxy HTTP `/api/runtime/custom` (`GET /health`, `GET /state`, `GET /registry`, `POST /v1/chat/completions`). Namun **belum mendukung** streaming event WebSocket (`runtime-agent-events`, `streaming`), `approvals`, `skills`, atau `files`. |
| `src/lib/runtime/createRuntimeProvider.ts` | **ADA** | Factory untuk `"hermes"`, `"demo"`, `"local"`, `"hermes3d"`, dan `"custom"`. Mode `"hermes"` menggunakan `HermesRuntimeProvider` di atas `GatewayClient` (protokol WebSocket penuh v3). |
| `src/features/office/` | **ADA** (`46` berkas) | Berisi `OfficeScreen.tsx`, `HQSidebar.tsx`, `TaskBoardPanel.tsx`, `AnalyticsPanel.tsx`, `HistoryPanel.tsx`, `InboxPanel.tsx`, `StandupImmersiveScreen.tsx`, `GithubImmersiveScreen.tsx`, serta builder Phaser 2D. |
| `src/features/retro-office/` | **ADA** (`28` berkas) | Engine 3D utama berbasis `Three.js 0.185.1`, `@react-three/fiber 9.7.0`, `@react-three/drei 10.7.8`, dan `@react-three/postprocessing 3.0.5`. Mendukung navigasi grid A* (`astar` + collision avoidance), preset kamera + follow-cam, furnitur instanced, dan kualitas grafis (`low`, `balanced`, `ultra` + deteksi otomatis software WebGL). |
| `src/features/pixel-office/` | **ADA** (`9` berkas) | Renderer kantor piksel 2D bergaya Gather berbasis `Phaser 3.90.0` untuk mode hemat daya / fallback 2D yang menggunakan state agent yang sama dengan 3D! |
| `src/lib/office/floors.ts` | **ADA** | Multi-floor telah disederhanakan di upstream menjadi satu lantai terpadu (`HERMES_FLOOR`) dengan pembagian zona/ruangan spasial. |
| `server/` | **ADA** (`11` berkas) | Custom server Node.js (`server/index.js`), `access-gate.js` (`STUDIO_ACCESS_TOKEN` timing-safe cookie + rate limit), `gateway-proxy.js` (`/api/gateway/ws` dengan batas frame 256 KB & 60 fps bucket), `demo-gateway-adapter.js`, dan `hermes-gateway-adapter.js`. |
| `plugins/hermes3d-office-bridge/` | **ADA** (`4` berkas) | Plugin Python opsional untuk mempublikasikan percakapan TUI/CLI Hermes ke bus event kantor. Tidak dipasang pada profil Owner agar sesi pribadi Owner tetap 100% terisolasi. |
| `docs/` | **ADA** (`24` berkas) | Memuat dokumentasi operasional serta dokumen spesifikasi rencana (`docs/office_sys/*` seperti `agent-state-model-spec.md`, `hierarchy-and-teams-spec.md`, `desk-progression-spec.md`, `bulletin-board-spec.md`, `whiteboard-spec.md`). |

### 5.2 Tumpang Tindih dengan Paperclip & Risiko Trust Boundaries
1. **Orkestrator Duplikat di `server/hermes-gateway-adapter.js`:** Adapter bawaan tersebut mendefinisikan tool `spawn_agent`, `delegate_task`, dan `dismiss_agent` di memori lokal. **DILARANG DIGUNAKAN** karena melanggar aturan arsitektur tunggal Paperclip.
2. **Pembuatan/Penghapusan Agent & Task Lokal di Studio:** Modal `CompanyBuilderModal`, `AgentCreateWizardModal`, `deleteAgentOperation`, dan `/api/task-store` (penyimpanan JSON lokal) tumpang tindih dengan Paperclip. Seluruh identitas organisasi (11 agent) dan lifecycle task (`UNI-*`) wajib bersumber dari Paperclip melalui **Office Bridge**.
3. **Temuan Keamanan Rute API Bawaan Hermes3D (Wajib Diperkeras):**
   - `src/app/api/path-suggestions/route.ts` menelusuri `os.homedir()` (`${ALLINONE_USER_HOME}`) — berisiko membocorkan struktur folder pribadi Owner ke browser; wajib dibatasi hanya ke `${ALLINONE_HOME}\workspaces`.
   - `src/app/api/gateway/agent-state/route.ts` dan `src/app/api/gateway/skills/remove/route.ts` memanggil penghapusan direktori state / helper SSH — wajib dikunci (`403 Forbidden`) agar siklus hidup worker murni dikendalikan Paperclip.
   - `HERMES_STATE_DIR` default menunjuk ke `~/.hermes` (`${ALLINONE_USER_HOME}\.hermes`) — wajib diarahkan secara eksplisit ke `${ALLINONE_HOME}\office-data\studio-state` agar 100% terpisah dari `${ALLINONE_HERMES_HOME}`.

## 6. Architecture Decision
Detail keputusan arsitektur dituangkan dalam [HERMES3D-ARCHITECTURE-DECISION.md](file:///${ALLINONE_HOME}/HERMES3D-ARCHITECTURE-DECISION.md):
- **Hermes3D (`127.0.0.1:3200`)** berperan murni sebagai lapisan visualisasi kantor 3D/2D dan antarmuka kontrol terotorisasi di atas cabang Git khusus `integration/unified-ai-company`.
- **Office Bridge (`127.0.0.1:3210`)** dibangun sebagai layanan Node.js (`node26.cmd` dengan `node:sqlite` & `ws`) yang menggabungkan:
  1. **Gateway WebSocket Protocol v3 (`ws://127.0.0.1:3210/ws`)** untuk memberi makan engine real-time Hermes3D (`agents.list` dari 11 agent Paperclip, `sessions.list`, `chat.send` -> pembuatan/komentar task resmi Paperclip, `chat.abort` -> `POST /api/heartbeat-runs/:id/cancel`, `presence`, `chat`, `agent`, `exec.approval` events) tanpa orkestrator bayangan.
  2. **Custom HTTP Runtime Provider (`GET /health`, `/state`, `/registry`, `POST /v1/chat/completions`)** untuk kompatibilitas penuh dengan kontrak `CustomRuntimeProvider`.
  3. **Normalized Enterprise Office API & Event Stream (`/api/office-bridge/*` + `ws://127.0.0.1:3210/api/events/ws`)** yang berlangganan langsung ke WebSocket native Paperclip (`ws://127.0.0.1:3100/api/companies/:companyId/events/ws`), membaca `findings.db` & `workflow-ledger.db` secara aman, memvalidasi skema event `v1.0`, melakukan redaksi rahasia otomatis, dan menyinkronkan kantor 3D <-> Paperclip <-> Telegram dua arah.

## 7. Implementation Plan
1. Mengaudit seluruh struktur direktori, dependensi `package.json` & `package-lock.json`, lisensi, rute server, dan scene 3D/2D.
2. Menyusun matriks kompatibilitas fitur lengkap pada `${ALLINONE_HOME}\HERMES3D-FEATURE-MATRIX.md`.
3. Menyusun Architecture Decision Record pada `${ALLINONE_HOME}\HERMES3D-ARCHITECTURE-DECISION.md`.

## 8. Actual Implementation
Seluruh 672 berkas di `${ALLINONE_HOME}\hermes3d\source` diaudit secara statis, termasuk pemeriksaan lisensi otomatis pada seluruh kode sumber dan aset.

## 9. Files Created
- `${ALLINONE_HOME}\docs\PHASE-21-hermes3d-repository-analysis.md`
- `${ALLINONE_HOME}\HERMES3D-FEATURE-MATRIX.md`
- `${ALLINONE_HOME}\HERMES3D-ARCHITECTURE-DECISION.md`

## 10. Files Modified
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.json`
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.md`

## 11. Commands Executed
- `git ls-remote https://github.com/iamlukethedev/Hermes3D`
- `git clone https://github.com/iamlukethedev/Hermes3D ${ALLINONE_HOME}\hermes3d\source`
- Skrip Python inventarisasi berkas dan audit lisensi pada `${ALLINONE_HOME}\hermes3d\source`

## 12. Test Scenarios
- **P21-T01:** Verifikasi commit target, tag rilis, dan lisensi MIT + CC0 aset 3D.
- **P21-T02:** Verifikasi kontrak `RuntimeProvider` (`HermesRuntimeProvider` vs `CustomRuntimeProvider`).
- **P21-T03:** Identifikasi fitur native vs partial vs demo vs planned serta risiko batas kepercayaan pada rute Next.js API.

## 13. Expected Results
- Kontrak integrasi, kesenjangan fitur, tumpang tindih orkestrasi, dan mitigasi keamanan terdokumentasi 100% berdasarkan kode aktual.

## 14. Actual Results
- Seluruh path dan kontrak terverifikasi akurat; kesenjangan streaming pada `CustomRuntimeProvider` dan risiko traversal/mutasi lokal pada rute bawaan berhasil diidentifikasi sebelum instalasi dijalankan.

## 15. Evidence
- [HERMES3D-FEATURE-MATRIX.md](file:///${ALLINONE_HOME}/HERMES3D-FEATURE-MATRIX.md)
- [HERMES3D-ARCHITECTURE-DECISION.md](file:///${ALLINONE_HOME}/HERMES3D-ARCHITECTURE-DECISION.md)

## 16. Root Cause (Apabila Terdapat Masalah)
- `CustomRuntimeProvider` di upstream hanya mengimplementasikan polling HTTP dasar tanpa streaming event real-time, sedangkan `hermes-gateway-adapter.js` membawa orkestrator sub-agent in-memory yang tumpang tindih dengan Paperclip.

## 17. Corrective Actions
- Merancang **Office Bridge** modular yang mengimplementasikan protokol WebSocket Gateway v3 **dan** endpoint HTTP Custom Provider sekaligus, dengan Paperclip sebagai satu-satunya sumber kebenaran organisasi dan task.

## 18. Regression Test
- Proses clone ke `${ALLINONE_HOME}\hermes3d\source` tidak menyentuh `${ALLINONE_HERMES_HOME}`, `Paperclip`, ataupun `VulnClaw`.

## 19. Acceptance Criteria
- [x] Source code telah diperiksa.
- [x] Official runtime requirements terverifikasi (`Node >= 20`, `npm >= 10`, WebGL2 / Phaser 2D fallback).
- [x] Runtime provider contract diketahui.
- [x] License dan aset dapat digunakan sesuai ketentuannya (MIT + CC0).
- [x] Integration gaps diketahui.
- [x] Security boundaries terdokumentasi.
- [x] Keputusan integrasi didasarkan pada implementasi aktual.

## 20. Final Phase Status
`PASS`
