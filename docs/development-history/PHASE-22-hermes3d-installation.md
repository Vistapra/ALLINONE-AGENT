# PHASE 22 — ISOLATED HERMES3D INSTALLATION & DEVELOPMENT ENVIRONMENT

## 1. Objective
Memasang, menguji, dan membangun aplikasi **Hermes3D** secara terisolasi pada `${ALLINONE_HOME}\hermes3d\` di atas cabang Git khusus `integration/unified-ai-company` tanpa mengganggu layanan **Hermes Agent**, **Paperclip AI**, **VulnClaw**, maupun **Telegram Gateway** yang telah berjalan.

## 2. Prerequisites
- `PHASE-20` & `PHASE-21` lulus (`PASS`).
- Ruang disk mencukupi (`C:` `44.71 GB` bebas, `D:` `4.44 GB` bebas) dan runtime terisolasi `node26.cmd` (`Node v26.12.1`) serta `npm26.cmd` (`npm 12.2.2`) tersedia.

## 3. Previous Phase Dependencies
- [PHASE-20-platform-preservation-audit.md](file:///${ALLINONE_HOME}/docs/PHASE-20-platform-preservation-audit.md)
- [PHASE-21-hermes3d-repository-analysis.md](file:///${ALLINONE_HOME}/docs/PHASE-21-hermes3d-repository-analysis.md)

## 4. Current Condition
Direktori terstruktur telah disiapkan sesuai arsitektur target:
- `${ALLINONE_HOME}\hermes3d\{source,configuration,assets}`
- `${ALLINONE_HOME}\office-bridge\{adapters,events,contracts,authorization,tests}`
- `${ALLINONE_HOME}\office-data\{layouts,visual-profiles,event-history,studio-state}`

## 5. Technical Analysis
- **Target Commit & Branch:** Upstream `beb76292747b816ef317aa6f9a3992e0014f81d9` (`main`) di-checkout ke cabang integrasi lokal `integration/unified-ai-company`.
- **Isolasi Dependency & Disk:** `npm ci --no-fund` dijalankan menggunakan cache di `${ALLINONE_USER_HOME}\AppData\Local\npm-cache` dan `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, memasang `637` paket secara deterministik dari `package-lock.json` dengan menyisakan **`3.54 GB` ruang bebas pada `D:`** (jauh di atas batas aman `2.0 GB`).
- **Audit Kerentanan Dependency (`phase22-npm-audit.json`):** Terdapat 8 advisory upstream pada versi terkunci `package-lock.json` (`next@16.1.7`, `ws@8.18.3`, dsb.). Sesuai aturan *"Pin dependency melalui lockfile"*, lockfile dipertahankan tanpa upgrade paksa yang merusak kompatibilitas, dan risiko dimitigasi melalui ikatan eksklusif loopback `127.0.0.1:3200`, gerbang autentikasi `STUDIO_ACCESS_TOKEN` (`HttpOnly; SameSite=Strict`), `UPSTREAM_ALLOWLIST`, serta batas ukuran frame WebSocket `256 KB`.
- **Penanda Simulasi (Demo Mode):** Komponen `EnterpriseOfficeOverlay.tsx` menampilkan banner peringatan kuning mencolok `⚠ SIMULATED DEMO MODE — NOT PRODUCTION DATA` apabila `activeAdapterType === "demo"`, dan menampilkan `● LIVE COMPANY` hanya ketika terhubung ke data nyata Paperclip melalui Office Bridge.

## 6. Architecture Decision
- Menjalankan Hermes3D dalam mode produksi terkompilasi (`next build` + `node server/index.js`) pada `http://127.0.0.1:3200` dengan `HERMES_STATE_DIR=${ALLINONE_HOME}\office-data\studio-state` agar 100% terpisah dari `${ALLINONE_HERMES_HOME}`.

## 7. Implementation Plan
1. Membuat cabang `integration/unified-ai-company`.
2. Memasang paket melalui `npm ci` dan menyimpan laporan `npm audit`.
3. Menjalankan pemeriksaan tipe `tsc --noEmit` dan suite unit test `vitest run`.
4. Menjalankan build produksi `next build` dan memverifikasi render aplikasi pada loopback `127.0.0.1:3200`.

## 8. Actual Implementation
- `tsc --noEmit` lulus dengan `0` error (`TSC_EXIT=0`).
- `vitest run` lulus `100%` (`75/75` pengujian baseline + `18/18` pengujian keamanan & integrasi = `93/93 PASS`).
- `next build` (Turbopack) berhasil mengompilasi seluruh `32/32` halaman & rute API dalam `65 detik` (`NEXT_BUILD_EXIT=0`).

## 9. Files Created
- `${ALLINONE_HOME}\reports\phase22-npm-audit.json`
- `${ALLINONE_HOME}\docs\PHASE-22-hermes3d-installation.md`

## 10. Files Modified
- `${ALLINONE_HOME}\hermes3d\source\next.config.ts` (perbaikan CSP `upgrade-insecure-requests` untuk loopback HTTP `127.0.0.1`)

## 11. Commands Executed
- `git -C ${ALLINONE_HOME}\hermes3d\source checkout -B integration/unified-ai-company`
- `${ALLINONE_HOME}\runtime\bin\npm26.cmd ci --no-fund`
- `${ALLINONE_HOME}\runtime\bin\node26.cmd node_modules\typescript\bin\tsc --noEmit`
- `${ALLINONE_HOME}\runtime\bin\node26.cmd node_modules\vitest\vitest.mjs run ...`
- `${ALLINONE_HOME}\runtime\bin\node26.cmd node_modules\next\dist\bin\next build`

## 12. Test Scenarios
- **P22-T01:** Kompilasi TypeScript dan build produksi Next.js + Three.js + Phaser.
- **P22-T02:** Eksekusi unit tests Vitest (navigasi A*, render mode 2D/3D, event triggers, network policy, gateway proxy).
- **P22-T03:** Isolasi jaringan loopback (`127.0.0.1:3200`) dan kesehatan komponen existing.

## 13. Expected Results
- Build lulus dengan `exitCode: 0`, unit tests lulus, aplikasi tampil di loopback tanpa eksposur jaringan publik, dan seluruh layanan existing tetap `HEALTHY`.

## 14. Actual Results
- Seluruh build (`32/32` rute) dan unit test lulus (`0` error); `ai-platform.cmd status --json` mengonfirmasi `platform_state: "HEALTHY"` dengan `D:` bebas `3.54 GB`.

## 15. Evidence
- [phase22-npm-audit.json](file:///${ALLINONE_HOME}/reports/phase22-npm-audit.json)
- Log build produksi (`NEXT_BUILD_EXIT=0`) & status `OFFICE_AND_HERMES3D_ONLINE_IN_3S`

## 16. Root Cause (Apabila Terdapat Masalah)
- Header bawaan `next.config.ts` menyertakan `upgrade-insecure-requests` dan `Strict-Transport-Security` secara paksa pada `NODE_ENV=production` meskipun server berjalan pada HTTP loopback `127.0.0.1`.

## 17. Corrective Actions
- Menjadikan `upgrade-insecure-requests` dan HSTS kondisional terhadap `process.env.HTTPS === "true"`, serta memperketat `connect-src` khusus ke origin loopback.

## 18. Regression Test
- Pemeriksaan ulang `ai-platform.cmd status --json` membuktikan Hermes, Paperclip, VulnClaw, dan Telegram Gateway tetap berjalan normal tanpa gangguan.

## 19. Acceptance Criteria
- [x] Hermes3D dapat dibangun (`next build` sukses).
- [x] Aplikasi dapat dijalankan pada loopback (`127.0.0.1:3200`).
- [x] Lingkungan 3D & aset siap dimuat.
- [x] Tidak ada public network exposure.
- [x] Tidak terjadi dependency conflict.
- [x] Hermes existing tetap sehat.
- [x] Paperclip tetap sehat.
- [x] VulnClaw tetap terisolasi.

## 20. Final Phase Status
`PASS`
