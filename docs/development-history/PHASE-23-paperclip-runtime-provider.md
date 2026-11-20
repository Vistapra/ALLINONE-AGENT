# PHASE 23 — PAPERCLIP CUSTOM RUNTIME PROVIDER

## 1. Objective
Menghubungkan **Hermes3D** dengan **Paperclip AI (`http://127.0.0.1:3100`)** sebagai satu-satunya sumber kebenaran utama untuk organisasi perusahaan, ke-11 role agent, hierarki pelaporan, status aktivasi (`ACTIVE` vs `STANDBY`), proyek, task (`UNI-*`), heartbeat runs, approvals, dan anggaran tanpa menyentuh database PostgreSQL Paperclip secara langsung dan tanpa meneruskan rahasia ke browser.

## 2. Prerequisites
- `PHASE-22` lulus (`PASS`).
- Paperclip `v2026.1117.0` berjalan sehat pada `http://127.0.0.1:3100`.

## 3. Previous Phase Dependencies
- [HERMES3D-ARCHITECTURE-DECISION.md](file:///${ALLINONE_HOME}/HERMES3D-ARCHITECTURE-DECISION.md)
- [PHASE-22-hermes3d-installation.md](file:///${ALLINONE_HOME}/docs/PHASE-22-hermes3d-installation.md)

## 4. Current Condition
Organisasi tunggal `Unified AI Engineering & Operations` (`0000000b-0000-4000-8000-00000000000b`) memiliki 11 role agent terdaftar di Paperclip (`4` Wave-1 aktif/`idle`, `7` Wave-2 standby/`paused`).

## 5. Technical Analysis
- **Evaluasi Provider Upstream:** `CustomRuntimeProvider` (`src/lib/runtime/custom/provider.ts`) menyediakan seam HTTP `/health`, `/state`, `/registry`, dan `/v1/chat/completions`, sedangkan `HermesRuntimeProvider` menyediakan protokol WebSocket v3 penuh (`agents.list`, `sessions.list`, `chat.send`, `chat.abort`, `presence`, `agent` events).
- **Implementasi Adapter Modular:** Dibangun modul [paperclip-adapter.js](file:///${ALLINONE_HOME}/office-bridge/adapters/paperclip-adapter.js) dan [agent-identity.js](file:///${ALLINONE_HOME}/office-bridge/contracts/agent-identity.js) di dalam **Office Bridge (`127.0.0.1:3210`)** yang melayani **kedua** protokol sekaligus di atas REST API resmi Paperclip.
- **Canonical Identity & Anti-Duplication:** Setiap karyawan AI dipetakan secara deterministik menggunakan `paperclip_agent_id` (UUID Paperclip) dengan deduplikasi `Set` ketat pada rekonsiliasi sehingga reconnect frontend tidak pernah menggandakan avatar.

## 6. Architecture Decision
- Seluruh token autentikasi (`PAPERCLIP_BOARD_KEY` dan `bridgeToken`) disimpan eksklusif di sisi server (`${ALLINONE_HOME}\config\secrets\`, dikunci ACL NTFS).
- Browser berkomunikasi hanya melalui rute same-origin `/api/company/[...slug]` dan `/api/gateway/ws` yang menyuntikkan token autentikasi di sisi server Node.js.

## 7. Implementation Plan
1. Mengimplementasikan `PaperclipRuntimeAdapter` (`office-bridge/adapters/paperclip-adapter.js`).
2. Mengimplementasikan pemetaan identitas kanonis 11 agent (`office-bridge/contracts/agent-identity.js`).
3. Mengimplementasikan autentikasi server-side (`office-bridge/authorization/auth.js`, `src/app/api/company/[...slug]/route.ts`, dan injeksi token pada `server/gateway-proxy.js`).
4. Memverifikasi melalui pengujian otomatis `office-bridge.test.js` dan koneksi WebSocket live.

## 8. Actual Implementation
Seluruh endpoint organisasi, 11 agent, proyek, issue `UNI-*`, live runs, recent runs, approvals, dan budget berhasil disinkronkan secara live dari Paperclip `127.0.0.1:3100`.

## 9. Files Created
- `${ALLINONE_HOME}\office-bridge\adapters\paperclip-adapter.js`
- `${ALLINONE_HOME}\office-bridge\contracts\agent-identity.js`
- `${ALLINONE_HOME}\office-bridge\authorization\auth.js`
- `${ALLINONE_HOME}\hermes3d\source\src\app\api\company\[...slug]\route.ts`
- `${ALLINONE_HOME}\docs\PHASE-23-paperclip-runtime-provider.md`

## 10. Files Modified
- `${ALLINONE_HOME}\hermes3d\source\server\gateway-proxy.js`
- `${ALLINONE_HOME}\hermes3d\source\src\app\api\runtime\custom\route.ts`

## 11. Commands Executed
- `${ALLINONE_HOME}\runtime\bin\node26.cmd --test ${ALLINONE_HOME}\office-bridge\tests\office-bridge.test.js`
- Verifikasi handshake WebSocket `ws://127.0.0.1:3200/api/gateway/ws`

## 12. Test Scenarios
- **P23-T01:** Pengambilan perusahaan `Unified AI Engineering & Operations` dan 11 agent tanpa duplikasi.
- **P23-T02:** Verifikasi pemisahan `4 ACTIVE` (Wave-1) vs `7 STANDBY` (Wave-2) dan hierarki `manager_id` / `subordinate_ids`.
- **P23-T03:** Verifikasi penolakan akses tanpa token (`HTTP 401`) dan ketiadaan rahasia di bundle browser (`verify-security-boundaries.py`).

## 13. Expected Results
- Ke-11 agent Paperclip tampil konsisten, status Active/Standby akurat, autentikasi bekerja, dan `0` kebocoran kredensial.

## 14. Actual Results
- `overview.total_agents = 11`, `active_agents = 4`, `standby_agents = 7`, hierarki sesuai `reportsTo` Paperclip, dan `verify-security-boundaries.py` melaporkan `leaked_files: []` dari `158` berkas termasuk `.next/static`.

## 15. Evidence
- Uji otomatis `office-bridge.test.js` (`5/5 PASS`)
- Output `verify-security-boundaries.py` (`overall_passed: true`)

## 16. Root Cause (Apabila Terdapat Masalah)
- Pada uji browser awal, `GatewayClient.ts` di browser mengirim objek tanda tangan perangkat `@noble/ed25519` (`frame.params.device`) dengan `auth.token` kosong, sehingga `hasCompleteDeviceAuth()` di `server/gateway-proxy.js` bernilai `true` dan melewatkan penyuntikan `upstreamToken` server-side. Selain itu, variabel `HERMES3D_GATEWAY_URL` tanpa `HERMES3D_GATEWAY_TOKEN` menimpa token profil lokal dengan string kosong.

## 17. Corrective Actions
- Memperbaiki `forwardConnectFrame` pada `server/gateway-proxy.js` agar selalu menyuntikkan `upstreamToken` server-side saat `UNIFIED_COMPANY_GOVERNANCE=1` dan browser tidak membawa token, serta menyetel `HERMES3D_GATEWAY_TOKEN` dan `profiles.hermes` pada `OfficeServiceLauncher.cs`.

## 18. Regression Test
- Suite `tests/unit/gatewayProxy.test.ts` (`12/12 PASS`) dan uji koneksi langsung `/api/gateway/ws` dengan payload `device` berhasil mendapatkan `hello-ok` beserta 11 agent.

## 19. Acceptance Criteria
- [x] Hermes3D memperoleh organisasi nyata dari Paperclip.
- [x] Seluruh 11 agent existing direpresentasikan.
- [x] Identitas agent konsisten (`paperclip_agent_id`).
- [x] Perbedaan Active dan Standby tampil benar.
- [x] Hierarki sesuai data Paperclip.
- [x] Authentication bekerja (`401` tanpa kredensial, `200`/`101` dengan sesi sah).
- [x] Secret tidak diteruskan ke browser.
- [x] Tidak ada database atau orchestrator duplikat.

## 20. Final Phase Status
`PASS`
