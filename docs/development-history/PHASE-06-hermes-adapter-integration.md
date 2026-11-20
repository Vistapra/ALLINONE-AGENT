# PHASE 06 — OFFICIAL PAPERCLIP TO HERMES INTEGRATION

## 1. Objective
Mengevaluasi dan mengintegrasikan Paperclip AI dengan Hermes Agent menggunakan paket adapter resmi `@paperclipai/hermes-paperclip-adapter`, membuktikan eksekusi nyata pada komputer Windows (`hermes_local` dan `hermes_gateway`), serta memverifikasi isolasi sesi, workspace, *timeout*, dan pembatalan eksekusi tanpa menyentuh sesi Telegram pribadi Owner.

## 2. Prerequisites
- `PHASE-05` (`PASS`) selesai; Paperclip berjalan pada `127.0.0.1:3100`.
- Hermes existing berjalan sehat (`\Hermes_Gateway`, model `combo/X`, `26` sesi Owner).

## 3. Current Condition
- Paket resmi `@paperclipai/hermes-paperclip-adapter` terpasang bersama `paperclipai@2026.1117.0` dan menyediakan `hermes_local`, `hermes_gateway`, serta skill `paperclip-task-bridge`.

## 4. Technical Analysis
1. **Analisis Empiris `hermes_gateway` vs `hermes_local`:**
   - Pada kode sumber Hermes (`gateway/config.py:333`), `SHARED_LISTENER_MIRROR_PLATFORMS = frozenset({"api_server", "webhook"})` mencegah profil sekunder membuka listener HTTP `api_server` terpisah. Menyalakan `API_SERVER_ENABLED=true` pada profil default akan mengekspos sesi pribadi Owner (`state.db`, `MEMORY.md`, `computer_use`).
   - Sebaliknya, `hermes_local` + **Named Profiles** (`${ALLINONE_HERMES_HOME}\profiles\<profile_id>`, sesuai `hermes_constants.py:117`) berbagi satu Python venv Hermes (`0 MB` duplikasi venv), menggunakan `0 MB` RAM saat idle, terdeteksi otomatis oleh `hermes update`, dan menjaga isolasi 100% atas `.env`, `config.yaml`, `SOUL.md`, `memories\`, dan `state.db`.
2. **Scoped Agent API Key & Passthrough (`session_client_env.py`):**
   - Hermes `v0.23.2+` menyaring variabel `*_API_KEY` dari `client_env` dan meneruskannya hanya melalui `terminal.env_passthrough` dari `.env` profil terkait. `hermes_worker_factory.py` menerbitkan kunci API khusus per-agent (`POST /api/agents/:id/keys`) di `profiles\pc<role>\.env` dan mendaftarkan `PAPERCLIP_API_URL`, `PAPERCLIP_RUN_ID`, `PAPERCLIP_TASK_ID`, `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID` pada `terminal.client_env_passthrough`.

## 5. Implementation Plan
- Membangun `integration/hermes_worker_factory.py` dan memperkaya `integration/paperclip_client.py`.
- Menguji kontrak transport & penolakan otentikasi `hermes_gateway` (`401` tanpa key/key salah, `200`/`succeeded` dengan key valid).
- Menguji `hermes_local` secara *end-to-end*: pembacaan spesifikasi `requirements_spec.md`, pembuatan `calculator.py` & `test_calculator.py`, eksekusi `unittest`, pembaruan status issue ke `done` oleh worker sendiri, pengujian *timeout* (`timed_out`), dan pengujian pembatalan eksplisit (`cancelled`).

## 6. Actual Execution
- Menjalankan skrip verifikasi `scripts/phase06_verify_hermes_adapters.py` dan menyimpan bukti lengkap ke `reports/phase06-adapter-verification.json`.

## 7. Files Created
- `${ALLINONE_HOME}\integration\hermes_worker_factory.py`
- `${ALLINONE_HOME}\scripts\phase06_verify_hermes_adapters.py`
- `${ALLINONE_HOME}\workspaces\phase06-smoke\calculator.py` *(dibuat oleh Hermes Worker)*
- `${ALLINONE_HOME}\workspaces\phase06-smoke\test_calculator.py` *(dibuat oleh Hermes Worker)*
- `${ALLINONE_HOME}\reports\phase06-adapter-verification.json`
- `${ALLINONE_HOME}\docs\PHASE-06-hermes-adapter-integration.md`

## 8. Files Modified
- `${ALLINONE_HOME}\integration\paperclip_client.py`
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.json` & `.md`

## 9. Commands Executed
- `python -u "${ALLINONE_HOME}\scripts\phase06_verify_hermes_adapters.py"`
- `python -m unittest discover -s ${ALLINONE_HOME}\workspaces\phase06-smoke -v`

## 10. Test Scenarios
- **P06-T1 (`hermes_gateway` Contract & Auth):** Uji HTTP `401` tanpa token/token salah vs run `succeeded` (`GATEWAY_TRANSPORT_CONTRACT_VERIFIED`).
- **P06-T2 (`hermes_local` Real Coding & Test):** Issue `UNI-8` -> worker menulis `calculator.py` & `test_calculator.py`, menjalankan `unittest`, dan memperbarui issue menjadi `done`.
- **P06-T3 (Timeout & Cancellation):** Uji batas waktu `timeoutSec=4` (`timed_out`) dan `POST /api/heartbeat-runs/:id/cancel` (`cancelled`).
- **P06-T4 (Owner Isolation):** Sesi `state.db` Owner tetap `26 -> 26` dan `\Hermes_Gateway` tetap sehat.

## 11. Expected Results
- Seluruh skenario `P06-T1` s/d `P06-T4` lulus dengan `exit_code = 0` pada run normal, `timed_out` pada uji batas waktu, `cancelled` pada pembatalan, dan `0` perubahan pada sesi Owner.

## 12. Actual Results
- **P06-T1 (`PASS`):** Unauthenticated = `401`, wrong key = `401`, bad Paperclip token = `401`; run `9b727445-346e-431b-b968-c8c8bbbbfdcf` -> `status: "succeeded"`, `exit_code: 0`.
- **P06-T2 (`PASS`):** Run `87eb3d69-26b4-4431-b997-af119e200824` & `769ed2cc-0656-484e-906b-d50c78a1c5b9` -> `status: "succeeded"`, `exit_code: 0`, `session_id_captured: "local-ba495f01..."`, `unittest_exit_code: 0` (`Ran 2 tests in 0.002s — OK`), issue `UNI-8` diperbarui ke `done` oleh agent sendiri.
- **P06-T3 (`PASS`):** Timeout run `019b7d38-4942-4484-9af9-704266ae8594` -> `timed_out`; Cancelled run `8a604de7-f53f-4611-9bfa-6aaa0753e985` -> `cancelled`.
- **P06-T4 (`PASS`):** `owner_sessions_untouched: true` (`26 -> 26`), `telegram_gateway_healthy: true`.

## 13. Evidence
- `${ALLINONE_HOME}\reports\phase06-adapter-verification.json`

## 14. Problems Found
1. Variabel `PAPERCLIP_API_KEY` awal tersaring oleh kebijakan `session_client_env.py` Hermes, dan biner `jq` tidak terpasang secara bawaan di Windows.
2. Endpoint penghapusan probe sementara pada Paperclip mensyaratkan `POST /api/agents/:id/terminate` sebelum `DELETE`.

## 15. Corrective Actions
1. Mengikat kunci API per-agent di `profiles\pc<role>\.env` melalui `terminal.env_passthrough` + `client_env_passthrough` serta menyediakan snippet pembaruan status berbasis Python `urllib.request` pada `SOUL.md`/`AGENTS.md`.
2. Menambahkan sinkronisasi `pause_agent`, `resume_agent`, dan urutan `terminate` sebelum `DELETE` pada klien Paperclip.

## 16. Acceptance Criteria
- [x] Paperclip berhasil memicu eksekusi Hermes (`87eb3d69`, `769ed2cc`).
- [x] Hermes menyelesaikan pekerjaan nyata di filesystem (`calculator.py`, `test_calculator.py`, `unittest OK`).
- [x] Hasil kembali ke Paperclip (`exitCode: 0`, `session_id` tercatat, issue `done`).
- [x] Session worker terpisah dari session Telegram pribadi (`26 -> 26`).
- [x] Timeout (`019b7d38`) dan cancellation (`8a604de7`) bekerja.
- [x] Unauthorized request ditolak (`401`).

## 17. Final Status
`PASS`
