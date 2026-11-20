# Paperclip <-> Hermes Integration (`PAPERCLIP-INTEGRATION.md`)

## 1. Official Adapter Package

Integrasi menggunakan paket resmi **`@paperclipai/hermes-paperclip-adapter`** yang disertakan dalam rilis stabil `paperclipai@2026.1117.0` (`${ALLINONE_HOME}\runtime\paperclip-app\node_modules\@paperclipai\hermes-paperclip-adapter`), yang menyediakan tiga permukaan resmi:
1. **`hermes_local`** — Menjalankan `hermes.exe chat -q ... -Q` sebagai proses worker dengan dukungan `sessionCodec`, `instructionsFilePath` (`HERMES_EPHEMERAL_SYSTEM_PROMPT`), timeout, dan pembatalan run.
2. **`hermes_gateway`** — Mengirim run melalui HTTP `POST /v1/runs` + SSE `/v1/runs/:id/events` dengan header `X-Hermes-Session-Key`.
3. **`paperclip-task-bridge`** — Skill Hermes untuk berinteraksi dengan REST API Paperclip.

## 2. Empirical Adapter Evaluation & Production Choice

Kedua adapter (`hermes_gateway` dan `hermes_local`) diuji secara langsung pada Fase 06 (`${ALLINONE_HOME}\reports\phase06-adapter-verification.json`):
- **Mengapa `hermes_local` + Named Profiles dipilih untuk produksi:**
  1. Pada kode sumber Hermes (`gateway/config.py:333`), `SHARED_LISTENER_MIRROR_PLATFORMS = frozenset({"api_server", "webhook"})` menetapkan bahwa hanya profil default (`\Hermes_Gateway`) yang mengikat listener HTTP `api_server`. Menyalakan `API_SERVER_ENABLED=true` pada profil default akan mengekspos database sesi pribadi dan CUA desktop milik Owner.
  2. Pada `hermes_constants.py:117`, menempatkan `HERMES_HOME` di bawah `${ALLINONE_HERMES_HOME}\profiles\<profile_id>` memungkinkan setiap worker berbagi satu Python venv Hermes (`0 MB` duplikasi venv) sambil mempertahankan isolasi penuh atas `.env`, `config.yaml`, `SOUL.md`, `memories\`, dan `state.db`.
  3. Konsumsi memori saat tidak ada pekerjaan aktif adalah `0 MB` per role worker.

## 3. Scoped Agent API Key & Passthrough Wiring

Pada arsitektur sesi Hermes `v0.23.2+`, `agent/session_client_env.py` memblokir variabel kredensial (`*_API_KEY`) agar tidak dikirim mentah melalui argumen/IPC `client_env`, dan mewajibkan rahasia profil dibaca melalui `terminal.env_passthrough` dari `.env` profil masing-masing. Oleh karena itu, `hermes_worker_factory.py` mengikat:
1. Kunci API Paperclip khusus per-agent (`POST /api/agents/:id/keys`) di `profiles\pc<role>\.env` (`PAPERCLIP_API_KEY`), diteruskan secara aman melalui `terminal.env_passthrough`.
2. Konteks eksekusi non-rahasia (`PAPERCLIP_API_URL`, `PAPERCLIP_RUN_ID`, `PAPERCLIP_TASK_ID`, `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`) melalui `terminal.client_env_passthrough`.
3. Pola pembaruan status task berbasis Python `urllib.request` pada `AGENTS.md` (menggantikan `jq` yang tidak tersedia secara bawaan di Windows).
