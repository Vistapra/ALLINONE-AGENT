# PHASE 01 — DEEP REPOSITORY & COMPATIBILITY ANALYSIS

## 1. Objective
Menganalisis secara mendalam dokumentasi resmi, package manifest, kebutuhan runtime, mekanisme database, arsitektur keamanan, dan adapter resmi dari ketiga proyek (`NousResearch/hermes-agent`, `paperclipai/paperclip`, dan `Netw0rkNoob/VulnClaw`) berdasarkan kode sumber aktual yang diperiksa pada disk.

## 2. Prerequisites
- `PHASE-00` selesai (`PASS`) dengan baseline hardware, OS, runtime, dan Hermes terpetakan.
- Koneksi Git/npm tersedia untuk memeriksa metadata rilis dan melakukan shallow checkout resmi.

## 3. Current Condition
- **Hermes Agent:** Terpasang di `${ALLINONE_USER_HOME}\AppData\Roaming\npm\node_modules\hermes-agent\runtime\hermes-agent` pada commit `31ce88f86e6cf4a66ef6aa315e4657a31bcf9915` (`v0.23.2+1033.g31ce88f.dirty`, branch `main`).
- **Paperclip AI:** Diperiksa pada repository resmi `${ALLINONE_HOME}\paperclip` (HEAD `3dffb2c9dd391a50913833c0fbb439d7a2f313a8`, rilis stabil terbaru `v2026.1117.0` / commit `c0f132898d2a2677312d8c72096187b27a3d9a38` dan paket npm resmi `paperclipai@2026.1117.0`).
- **VulnClaw:** Diperiksa pada repository resmi `${ALLINONE_HOME}\vulnclaw` (HEAD `0b34878f84b089b21fcf85ecd445315f14df0672` = tag rilis stabil `v0.4.1`).

## 4. Technical Analysis

### 4.1 Analisis Paperclip AI (`paperclipai/paperclip`)
1. **Runtime & Build:**
   - `engines.node`: `>=24.11.0` (`package.json`, `cli/package.json`, `server/package.json`). Host memiliki portable `node-26.12.1-win32-x64` yang memenuhi syarat tanpa mengubah Node global `v20.16.0`.
   - Monorepo source build (`server/package.json`) memanggil perintah shell Unix (`bash ../scripts/prepare-server-ui-dist.sh`, `mkdir -p`, `cp -R`, `rm -rf`) serta membutuhkan binary `paperclip-runner` (Rust crate). Sebaliknya, paket rilis resmi `paperclipai@2026.1117.0` di npm sudah memuat `dist/`, `ui-dist/`, `embedded-postgres`, dan `@paperclipai/hermes-paperclip-adapter@2026.1117.0` siap pakai lintas platform.
   - `cli/src/install-store.ts` menggunakan POSIX symlink (`cli/current`) & shim `~/.local/bin/paperclipai`, serta `cli/src/services/service-manager.ts` hanya mendukung `systemd` | `launchd` (`export type ServicePlatform = "systemd" | "launchd"`). Oleh karena itu, pada Windows non-admin metode paling stabil adalah menginstal paket rilis resmi `paperclipai@2026.1117.0` ke prefix terisolasi `${ALLINONE_HOME}\runtime\paperclip-app` dengan `-d ${ALLINONE_HOME}\data\paperclip` dan mengelolanya melalui Windows Task Scheduler.
2. **Database, Auth, Org, Governance & Budget:**
   - Database resmi menggunakan PostgreSQL melalui Drizzle ORM (`@paperclipai/db`), dengan **embedded PostgreSQL (`embedded-postgres@^18.1.0-beta.16`)** otomatis diinisialisasi di dalam `PAPERCLIP_HOME` tanpa perlu mengutak-atik instalasi global `C:\Program Files\PostgreSQL\15`.
   - Mendukung dua deployment mode (`local_trusted` loopback dan `authenticated` via `better-auth` + agent API keys + short-lived run JWT + `task_bridge` scoped keys).
   - Menyediakan model multi-company, org chart berhierarki (`reportsTo`), atomic issue checkout, heartbeat wakeup queue, comments/threads, approvals, serta budget policies per company/agent/project dengan hard-stop.
3. **Hermes Adapters Resmi (`@paperclipai/hermes-paperclip-adapter`):**
   - Sudah built-in di `@paperclipai/server` dan `paperclipai` CLI — **tidak memerlukan adapter eksternal tambahan** (dan plugin komunitas `selaeron-paperclip-sel9` di katalog Hermes sengaja tidak dipakai karena hanya diuji terhadap mock).
   - Memuat **dua** adapter resmi + **satu** skill resmi:
     - `hermes_local` (`packages/adapters/hermes/src/server/execute.ts`): menjalankan `hermes chat -q <prompt> [-Q] [-m <model>] [-t <toolsets>] [--max-turns N] [--source tool] [--yolo] [--resume <id>] [extraArgs...]` dengan `cwd` per-workspace, `env` terisolasi (termasuk `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY` run token, `PAPERCLIP_RUN_ID`, `PAPERCLIP_TASK_ID`, `HERMES_EPHEMERAL_SYSTEM_PROMPT`), `timeoutSec`, dan `graceSec`. Catatan penting Windows: `hermesCommand` wajib diarahkan ke binary PE `${ALLINONE_HERMES_HOME}\bin\hermes.exe` (bukan `.cmd`) agar `spawn(..., { shell: false })` bebas error `EINVAL`. Selain itu `detectModel()` membaca `~/.hermes/config.yaml`, namun saat `provider: "auto"` dan `model: "combo/X"` disetel, adapter menyerahkan resolusi provider langsung ke `config.yaml` di `HERMES_HOME` worker (`provider: custom`, `https://work.example-provider.com/v1`).
     - `hermes_gateway` (`packages/adapters/hermes/src/gateway/server/execute.ts`): memanggil `POST /v1/runs`, SSE `GET /v1/runs/{id}/events`, dan `POST /v1/runs/{id}/stop` dengan `Authorization: Bearer <API_SERVER_KEY>` dan `X-Hermes-Session-Key` (`issue` | `agent` | `run` | `none`).
     - `paperclip-task-bridge` (`packages/adapters/hermes/skills/paperclip-task-bridge/paperclip-task.mjs`): helper resmi arah balik (Hermes -> Paperclip) memakai key ber-scope `task_bridge`.

### 4.2 Analisis VulnClaw (`Netw0rkNoob/VulnClaw` `v0.4.1`)
1. **Runtime & Dependencies (`pyproject.toml`):**
   - Lisensi MIT, `requires-python = ">=3.10"` (mendukung Python `3.10`–`3.14`), `openai>=1.66.0`, `httpx>=0.27.0`, `pydantic>=2.0.0`, `mcp>=1.0,<2.0`, `typer`, `rich`, `pyyaml`, `jinja2`, `jsonschema`.
   - Mendukung provider `custom` OpenAI-compatible (`llm.provider = "custom"`, `llm.base_url = "https://work.example-provider.com/v1"`, `llm.model = "combo/X"`, `VULNCLAW_CONFIG_DIR` terisolasi).
2. **Pemisahan Kapabilitas Defensif vs Ofensif:**
   - **Aman & Defensif (Diaktifkan dalam Platform):**
     - `vulnclaw.codescan` (`vulnclaw code scan <path> --format json|sarif|markdown`): pemindaian statis kode sumber & konfigurasi lokal murni Python tanpa target jaringan (`L1` regex/entropy, `L2` structural checks, opsional `L3` LLM semantic review) lengkap dengan `rule_id`, `severity`, `cwe`, `evidence`, dan `remediation`.
     - `vulnclaw.plugins` (`builtin.web.headers`, `builtin.web.jwt`, `builtin.web.js_endpoints`): analisis read-only terhadap artefak/header/konfigurasi statis.
     - `vulnclaw.report` + LLM defensive triage client (`make_openai_client`): klasifikasi keparahan, evaluasi false-positive, sanitasi laporan audit, dan rekomendasi remediasi terstruktur.
   - **Ofensif / Berisiko Tinggi (TIDAK Diekspos ke Paperclip maupun Telegram):**
     - Subcommand `exploit`, `run`, `solve`, `persistent`, `recon`, `scan` jaringan live, `python_execute` (dicatat sendiri oleh upstream README sebagai *not a strong isolation sandbox*), `shell_command`, `http_probe_batch`, serta MCP eksternal (`chrome-devtools`, `burp`). Seluruh permukaan ini diblokir pada wrapper integrasi defensif.

### 4.3 Analisis Hermes Agent (`NousResearch/hermes-agent`)
- Mendukung isolasi penuh melalui `HERMES_HOME` terpisah maupun `hermes profile` (`-p <profile>`).
- Mendukung `gateway/platforms/api_server.py` (`/v1/runs`, `/health`, `X-Hermes-Session-Key`), namun mengaktifkan `api_server` pada proses `\Hermes_Gateway` utama akan berbagi `HERMES_HOME` pemilik. Menjalankan worker melalui `hermes_local` dengan `HERMES_HOME` khusus worker memberikan isolasi penuh dari sesi/memori/token Telegram pemilik, **0 MB RAM idle**, pembatasan `toolsets` per role, dan deteksi proses aktif otomatis oleh `hermes update --list-venv-holders`.

### 4.4 Compatibility Matrix
| Component | Version | Commit / Tag | Runtime Requirement | OS Support | Installation Method | Integration Method | License | Security Limitations | Known Issues & Mitigations | Recommended Approach |
|---|---|---|---|---|---|---|---|---|---|---|
| **Hermes Agent** | `0.23.2+1033` | `31ce88f86e6cf4a66ef6aa315e4657a31bcf9915` (`main`) | Python `3.11.16` (managed venv) | Linux, macOS, Windows | Existing official git install (pertahankan) | Executed via `hermes.exe` (`hermes_local`) + Telegram Gateway | MIT | `--yolo` pada headless child process harus dibatasi via isolated worker `HERMES_HOME` + restricted `toolsets` + `cwd` | `hermes doctor --fix` merusak metadata npm-bridge -> jangan dijalankan; `hermes.cmd` gagal `spawn` tanpa shell -> gunakan `hermes.exe` | Pertahankan instalasi existing; buat isolated worker homes untuk Paperclip |
| **Paperclip AI** | `2026.1117.0` | `c0f132898d2a2677312d8c72096187b27a3d9a38` (`v2026.1117.0`) / repo `3dffb2c9` | Node.js `>=24.11.0` (gunakan portable `v26.12.1`) | Linux, macOS, Windows (server/CLI) | Official npm package `paperclipai@2026.1117.0` di `${ALLINONE_HOME}\runtime\paperclip-app` + source checkout `${ALLINONE_HOME}\paperclip` | Built-in `@paperclipai/hermes-paperclip-adapter` (`hermes_local` primary; `hermes_gateway` dievaluasi) + REST API | MIT | Mode `local_trusted` tanpa auth mengizinkan proses lokal lain mengakses API jika tanpa proteksi -> aktifkan mode `authenticated` atau API key boundary pada loopback `127.0.0.1` | `service-manager.ts` hanya `systemd`/`launchd`; build monorepo memakai bash/Rust -> gunakan paket rilis prebuilt + Task Scheduler launcher Windows | Single instance di `127.0.0.1:3100` dengan embedded Postgres di `${ALLINONE_HOME}\data\paperclip` |
| **VulnClaw** | `0.4.1` | `0b34878f84b089b21fcf85ecd445315f14df0672` (`v0.4.1`) | Python `>=3.10` (`3.14.9` via `uv venv` terisolasi) | Linux, macOS, Windows | Editable/wheel install dari tag `v0.4.1` ke venv terisolasi `${ALLINONE_HOME}\runtime\vulnclaw-venv` | Isolated defensive CLI/module wrapper (`codescan` + structured report analyzer) -> Findings Ingestion API -> Paperclip | MIT | `python_execute` & `solve`/`exploit` bukan sandbox kuat dan berorientasi pentest aktif | Tidak boleh diberi akses `C:\`/`D:\` bebas, `.env` Hermes, atau jaringan live | Jalankan *on-demand* hanya pada modul defensif (`codescan` + sanitized report triage) dengan `VULNCLAW_CONFIG_DIR` terpisah |

### 4.5 Architecture Decision Record (ADR Summary)
- **ADR-01 (Instalasi Paperclip):** Menggunakan rilis stabil prebuilt `paperclipai@2026.1117.0` yang dijalankan dengan portable `Node v26.12.1` dan `PAPERCLIP_HOME=${ALLINONE_HOME}\data\paperclip` (satu instalasi tunggal; checkout `${ALLINONE_HOME}\paperclip` dipertahankan sebagai referensi kode & skill `paperclip-task-bridge`).
- **ADR-02 (Pemilihan Adapter Hermes):** Memilih adapter resmi built-in `hermes_local` dengan binary `hermes.exe`, `HERMES_HOME` worker terisolasi per profil keamanan, dan pembatasan `toolsets` per role sebagai jalur produksi utama (hemat ~260 MB RAM pada host 8 GB dan terdeteksi otomatis oleh updater Hermes), sambil menguji kedua adapter (`hermes_local` dan `hermes_gateway`) secara nyata pada Fase 06.
- **ADR-03 (Isolasi Defensif VulnClaw):** Menginstal `VulnClaw v0.4.1` ke `uv` virtualenv terpisah tanpa Docker (karena Docker tidak tersedia dan RAM host 8 GB), menonaktifkan MCP eksternal dan subcommand ofensif di layer integrasi, serta hanya mengekspos `codescan` statis lokal dan analisis laporan tersanitasi secara *on-demand*.

## 5. Implementation Plan
- Mengambil referensi remote dan melakukan shallow checkout resmi `paperclipai/paperclip` serta `Netw0rkNoob/VulnClaw` ke `${ALLINONE_HOME}\`.
- Memeriksa kode sumber adapter Hermes, CLI/server Paperclip, API server Hermes, dan modul defensif VulnClaw.
- Mendokumentasikan Compatibility Matrix dan ADR ke `PHASE-01-repository-analysis.md` serta memperbarui ledger.

## 6. Actual Execution
- Menjalankan `phase01_fetch_and_inspect.ps1` dan `phase01_hermes_inspect.ps1`.
- Membaca langsung `package.json`, `cli/src/index.ts`, `install.ts`, `onboard.ts`, `run.ts`, `service-manager.ts`, `packages/adapters/hermes/src/server/execute.ts`, `detect-model.ts`, `src/gateway/server/execute.ts`, `skills/paperclip-task-bridge/SKILL.md`, `gateway/platforms/api_server.py` (Hermes), serta `pyproject.toml`, `README_EN.md`, `config/schema.py`, `config/settings.py`, dan `codescan/scanner.py` (VulnClaw).

## 7. Files Created
- `${ALLINONE_HOME}\paperclip\` (official git checkout)
- `${ALLINONE_HOME}\vulnclaw\` (official git checkout `v0.4.1`)
- `${ALLINONE_HOME}\docs\PHASE-01-repository-analysis.md`

## 8. Files Modified
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.json`
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.md`

## 9. Commands Executed
- `git ls-remote --heads --tags https://github.com/paperclipai/paperclip.git`
- `git ls-remote --heads --tags https://github.com/Netw0rkNoob/VulnClaw.git`
- `npm view paperclipai version dist-tags engines bin`
- `npm view @paperclipai/hermes-paperclip-adapter version dist-tags engines peerDependencies`
- `git clone --filter=blob:none --depth 20 ...` (untuk `paperclip` dan `vulnclaw`)
- `hermes.cmd serve --help` & `hermes.cmd profile --help`

## 10. Test Scenarios
- **P01-T1:** Verifikasi keberadaan dan tanda tangan eksport `hermes_local`, `hermes_gateway`, dan `paperclip-task-bridge` pada kode sumber Paperclip.
- **P01-T2:** Verifikasi dukungan endpoint `/v1/runs` dan isolasi profil pada kode sumber Hermes existing.
- **P01-T3:** Verifikasi dukungan Python `3.10–3.14`, provider `custom` OpenAI-compatible, serta modul statis `codescan` pada VulnClaw `v0.4.1`.

## 11. Expected Results
- Seluruh fitur, nama konfigurasi, endpoint, dan batasan OS terverifikasi langsung dari source code tanpa asumsi.

## 12. Actual Results
- **P01-T1 (`PASS`):** `hermes_local` dan `hermes_gateway` terverifikasi built-in di `@paperclipai/hermes-paperclip-adapter` (`2026.1117.0`), beserta skill `paperclip-task-bridge`.
- **P01-T2 (`PASS`):** Hermes `31ce88f8` memiliki `/v1/runs` di `gateway/platforms/api_server.py` serta binary `hermes.exe` dan isolasi `HERMES_HOME` / `hermes profile`.
- **P01-T3 (`PASS`):** VulnClaw `0.4.1` (`0b34878f`) mendukung Python `3.10–3.14`, `LLMProvider.CUSTOM`, dan modul lokal bebas jaringan `vulnclaw.codescan`.

## 13. Evidence
- Log eksekusi `task-1610.log` & `task-1611.log` (`exit code 0`).
- Inspeksi file aktual di `${ALLINONE_HOME}\paperclip\packages\adapters\hermes\*` dan `${ALLINONE_HOME}\vulnclaw\vulnclaw\codescan\scanner.py`.

## 14. Problems Found
1. Script build monorepo Paperclip memakai utilitas shell Unix + Rust crate `paperclip-runner`, dan `service-manager.ts` tidak mendukung Windows Task Scheduler.
2. `detectModel()` di `hermes_local` membaca `~/.hermes/config.yaml` (path Unix), bukan `%LOCALAPPDATA%\hermes\config.yaml`.
3. VulnClaw menyertakan tool ofensif (`exploit`, `solve`, `python_execute`) yang tidak boleh diekspos ke workflow otonom.

## 15. Corrective Actions
1. Menetapkan penggunaan paket rilis resmi prebuilt `paperclipai@2026.1117.0` di atas portable `Node v26.12.1` + Task Scheduler launcher khusus Windows.
2. Mengonfigurasi `provider: "auto"`, `model: "combo/X"`, `hermesCommand: "...\\hermes.exe"`, dan `HERMES_HOME` worker eksplisit agar Hermes membaca `config.yaml` worker secara langsung.
3. Membatasi integrasi VulnClaw hanya melalui wrapper defensif (`codescan` + sanitized report analyzer) tanpa mengekspos CLI ofensif.

## 16. Acceptance Criteria
- [x] Source code dan dokumentasi ketiga project sudah diperiksa.
- [x] Installation strategy didasarkan pada bukti.
- [x] Adapter resmi teridentifikasi (`@paperclipai/hermes-paperclip-adapter`: `hermes_local` & `hermes_gateway`).
- [x] Kebutuhan runtime dan resource diketahui (`Node >=24.11.0`, `Python >=3.10`, embedded Postgres, RAM 8 GB constraints).
- [x] Tidak ada asumsi fitur yang tidak terverifikasi.
- [x] Architecture decision record tersedia (ADR-01 s/d ADR-03).

## 17. Final Status
`PASS`
