# PHASE 24 — UNIFIED REAL-TIME EVENT BRIDGE

## 1. Objective
Mengubah aktivitas nyata dari **Paperclip AI**, **Hermes Workers**, **VulnClaw Findings**, **Workflow Ledger**, dan **Maintenance Coordinator** menjadi aliran event ternormalisasi (`schema_version: "1.0"`) yang disalurkan secara real-time ke kantor virtual 3D melalui WebSocket terautentikasi dengan deduplikasi, penomoran urut, deteksi stale, backpressure, dan redaksi rahasia otomatis.

## 2. Prerequisites
- `PHASE-23` lulus (`PASS`).
- WebSocket native Paperclip `ws://127.0.0.1:3100/api/companies/:companyId/events/ws` tersedia.

## 3. Previous Phase Dependencies
- [PHASE-23-paperclip-runtime-provider.md](file:///${ALLINONE_HOME}/docs/PHASE-23-paperclip-runtime-provider.md)

## 4. Current Condition
Paperclip mempublikasikan live events melalui `live-events-ws.ts`, dan riwayat eksekusi detail tercatat pada `/api/heartbeat-runs/:runId/events` serta `/log`.

## 5. Technical Analysis
- **Evaluasi Transport Upstream:** Digunakan gabungan **Native Paperclip WebSocket (`/events/ws`)** untuk latensi instan ditambah **Bounded Delta Reconciliation (`3.0s`)** terhadap Paperclip REST, SQLite `findings.db`, `workflow-ledger.db`, dan `maintenance.lock` sehingga tidak ada transisi yang hilang saat jaringan/soket terputus sementara.
- **Kejujuran Bukti Tool/Build/Test:** `inspectRunEvidenceText()` pada `paperclip-adapter.js` hanya memancarkan `tool.started` (`coding`), `build.started`, atau `test.started` apabila output aktual `/events` & `/log` dari run Hermes membuktikan eksekusi perintah terkait.
- **Keandalan Stream:** `NormalizedEventBus` menegakkan validasi skema `1.0`, nomor urut `sequence` monotonik, deduplikasi `2,500` kunci, penanda `"stale": true` untuk event `>60s`, buffer cincin terikat `500` event dengan pemadatan otomatis ke disk, pelindung backpressure `512 KB`, serta filter `sanitizePayload()`.

## 6. Architecture Decision
- Mengekspos stream event ternormalisasi di `ws://127.0.0.1:3210/api/events/ws` dan memproksikannya secara same-origin di `ws://127.0.0.1:3200/api/company/events/ws` dengan penyuntikan token server-side.

## 7. Implementation Plan
1. Mengimplementasikan `event-schema.js` (`validateOfficeEvent`, `NormalizedEventBus`).
2. Mengimplementasikan `realtime-synchronizer.js` (koneksi WS Paperclip + backoff + diffing lintas komponen).
3. Mengimplementasikan `useEnterpriseCompanyLive.ts` pada Hermes3D untuk reconnect eksponensial & `?sinceSeq=N` replay.
4. Mendokumentasikan kontrak di [OFFICE-EVENT-SCHEMA.md](file:///${ALLINONE_HOME}/OFFICE-EVENT-SCHEMA.md).

## 8. Actual Implementation
Seluruh kategori event nyata telah diimplementasikan, diuji terhadap duplikasi, event basi (*stale*), ukuran ring buffer, dan redaksi token pada `office-bridge.test.js`.

## 9. Files Created
- `${ALLINONE_HOME}\office-bridge\contracts\event-schema.js`
- `${ALLINONE_HOME}\office-bridge\events\realtime-synchronizer.js`
- `${ALLINONE_HOME}\hermes3d\source\src\features\enterprise-company\useEnterpriseCompanyLive.ts`
- `${ALLINONE_HOME}\OFFICE-EVENT-SCHEMA.md`
- `${ALLINONE_HOME}\docs\PHASE-24-realtime-event-bridge.md`

## 10. Files Modified
- `${ALLINONE_HOME}\office-bridge\server.js`
- `${ALLINONE_HOME}\hermes3d\source\server\index.js`

## 11. Commands Executed
- `${ALLINONE_HOME}\runtime\bin\node26.cmd --test ${ALLINONE_HOME}\office-bridge\tests\office-bridge.test.js`

## 12. Test Scenarios
- **P24-T01:** Validasi skema `v1.0` & penolakan event tidak sah.
- **P24-T02:** Supresi event duplikat (`dedupe_key`) & penandaan event kedaluwarsa (`stale: true`).
- **P24-T03:** Koneksi WebSocket live `snapshot.reconcile` + replay `?sinceSeq=N` + redaksi rahasia.

## 13. Expected Results
- Frontend menerima event nyata berurutan, duplikat ditekan, reconnect memulihkan state, dan rahasia tersensor 100%.

## 14. Actual Results
- Seluruh pengujian unit dan integrasi WebSocket lulus (`PASS`); badge UI menampilkan `● LIVE COMPANY · 4/11 ACTIVE · SEQ #13 · WS`.

## 15. Evidence
- [OFFICE-EVENT-SCHEMA.md](file:///${ALLINONE_HOME}/OFFICE-EVENT-SCHEMA.md)
- Hasil uji `Normalized Event Schema v1.0, Deduplication, Stale Marking & Ring Buffer` (`PASS`)

## 16. Root Cause (Apabila Terdapat Masalah)
- Tidak ditemukan cacat pada bus event.

## 17. Corrective Actions
- Tidak diperlukan.

## 18. Regression Test
- Koneksi Paperclip dan worker existing tetap sehat tanpa beban polling berlebih.

## 19. Acceptance Criteria
- [x] Event nyata diterima frontend.
- [x] Event duplicate tidak menyebabkan aktivitas ganda.
- [x] Reconnect berhasil dengan rekonsiliasi snapshot.
- [x] Snapshot dan event stream konsisten.
- [x] Data kedaluwarsa ditandai `stale` / `UNKNOWN`.
- [x] Secret tidak masuk ke stream.

## 20. Final Phase Status
`PASS`
