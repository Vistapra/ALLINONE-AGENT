# PHASE 00 — BASELINE AUDIT & SYSTEM DISCOVERY

## 1. Objective
Memverifikasi kondisi aktual perangkat keras, sistem operasi, kapasitas disk, jaringan, runtime terpasang, layanan Windows, Task Scheduler, serta seluruh komponen instalasi Hermes Agent existing secara read-only sebelum melakukan perancangan maupun instalasi komponen baru.

## 2. Prerequisites
- Akses shell lokal Windows (`PowerShell`) pada sesi pengguna aktif.
- Instalasi Hermes Agent existing tersedia pada `${ALLINONE_USER_HOME}`.
- Tidak melakukan perubahan konfigurasi atau penghapusan data selama audit baseline.

## 3. Current Condition
### 3.1 Host, OS & Hardware Baseline
- **Computer Name:** `<machine-name>`
- **OS:** Microsoft Windows 10 Pro 22H2 (`10.0.19045`, Build `19045`, `64-bit`)
- **Last Physical Boot:** `2026-11-19T07:45:45.5000000+07:00`
- **CPU:** `Intel(R) Pentium(R) Gold G5400 CPU @ 3.70GHz` (`2` physical cores, `4` logical processors)
- **Virtualization:** `HypervisorPresent: true` (`WSLService`, `vmms`, `HvHost` running; WSL default version `2`)
- **Physical RAM:** `8,126.5 MB` (~8.0 GB total); saat audit: `7,180.2 MB` terpakai (`88.4%`), `946.3 MB` bebas; beban CPU idle `0%–4%`
- **Active Desktop Session:** Interactive console session `ID = 1` (`STATE = Active`, user account `<machine-name>\vista`, SID `S-1-5-21-2136605995-4073213849-1707912503-1004`, folder profil `${ALLINONE_USER_HOME}`, current shell `IsAdmin = False`)

### 3.2 Storage & Filesystem ACLs
| Drive | Used (GB) | Free (GB) | Total (GB) | Catatan |
|---|---:|---:|---:|---|
| `C:` | `178.28` | `16.04` | `194.32` | OS, `C:\laragon`, `${ALLINONE_USER_HOME}` (Hermes Home, HermesUpdater, VS Code) |
| `D:` | `29.87` | `7.70` | `37.57` | Data & project drive (`Project Alpha`, `Project Beta`, `hna`, `hermes_op_coding_test`); ACL mengizinkan `Authenticated Users: Modify` |

### 3.3 Installed Runtimes & Binaries
| Runtime / Tool | Global PATH Version & Path | Portable / Isolated Version di `%LOCALAPPDATA%\hermes\tools` |
|---|---|---|
| **Node.js** | `v20.16.0` (`C:\Program Files\nodejs\node.exe`) | `v26.12.1` (`...\tools\node-26.12.1-win32-x64\node.exe`) |
| **npm** | `10.8.1` (`C:\Program Files\nodejs\npm.cmd`) | `12.2.2` (`...\tools\npm-12.2.2-win32-x64`) |
| **pnpm** | Wrapper di `%APPDATA%\npm\pnpm.cmd` | `12.15.0` (`...\tools\pnpm-12.15.0-win32-x64\pnpm.exe`) |
| **Corepack** | `0.28.2` (`C:\Program Files\nodejs\corepack.cmd`) | — |
| **Python** | `3.14.9` (`...\tools\python-3.14.9+20261021-win32-x64\python.exe`) & `py -3.10` (`C:\WINDOWS\py.exe`) | Hermes venv Python `3.11.16` (`...\installs\d064cda90b74df76\environments\321dfcb619994c05b1ee80439e034add\venv\Scripts\python.exe`) |
| **uv** | `0.13.5` (`...\tools\uv-0.13.5-win32-x64\uv.exe` & `${ALLINONE_USER_HOME}\.local\bin\uv.exe`) | `0.13.5` |
| **Git** | `2.24.0.windows.2` (`C:\Program Files\Git\cmd\git.exe`) | `2.56.1.windows.1` (`...\tools\git-2.56.1+1-win32-x64\cmd\git.exe`) |
| **Docker** | `NOT FOUND` | Tidak terpasang |
| **PostgreSQL** | Direktori `C:\Program Files\PostgreSQL\15` ada (tanpa `postgres.exe`/`psql.exe` aktif atau Windows Service PostgreSQL berjalan) | Tidak ada server DB aktif |

### 3.4 Network, Ports & Firewall
- **Proxy:** Tidak aktif (`ProxyEnable = 0`).
- **Windows Firewall:** Ketiga profil (`Domain`, `Private`, `Public`) tercatat `Enabled = False` pada host existing (tidak diubah sesuai aturan keamanan).
- **Listening Ports Utama:**
  - Wildcard/LAN (`0.0.0.0` / `::`): `135`, `445`, `2179` (`vmms`), `3389` (RDP), `5040`, `5130`, `5357`, `5800`/`5900` (`tvnserver`), `5985` (WinRM), `8900` (`BSSRVService`).
  - Loopback (`127.0.0.1` / `::1`): `1001`, `56783`, `57224–57445` (`Antigravity` / `language_server`), `58112` & `58120` (`python.exe` PID `15524` — Hermes Gateway internal loopback sockets), `62341`.
  - Port kandidat platform (`3100`, `3101`, `3200`, `8642`, `8787`, `9119`, `5432`) saat ini **kosong / bebas**.

### 3.5 Hermes Agent Existing Baseline
- **Hermes Version:** `v0.23.2+1033.g31ce88f.dirty (2026.9.24)`
- **Installed Commit:** `31ce88f86e6cf4a66ef6aa315e4657a31bcf9915` (branch `main`, remote `https://github.com/NousResearch/hermes-agent.git`)
- **Install IDs:** `config.yaml` install key `d064cda90b74df76`; `%LOCALAPPDATA%\hermes\install_id` = `938ccaa4bdbc4c749896addf61c5e9c5`
- **Local Customization:** `agent/error_classifier.py` (`present (local)`, dijaga otomatis oleh updater)
- **Model & Provider:** `model.default: combo/X`, `provider: custom`, `base_url: https://work.example-provider.com/v1`, `key_env: CUSTOM_API_KEY` (nilai kredensial di `.env` tidak dibaca/dicetak)
- **Telegram Gateway:** Aktif (`PID 15524`, `WS = 69.4 MB`, `Private = 259.6 MB`), `telegram_connected = True`, owner-only allowlist (`YOUR_TELEGRAM_OWNER_ID_HERE`), `approvals.mode = smart`
- **Computer Use (CUA):** `status = ready` (`\cua-driver-serve`, `public_ports = 0`, `interactive_desktop_ready`)
- **Autonomous Updater:** `${ALLINONE_USER_HOME}\HermesUpdater` (`PID 5112`, `WS = 22.1 MB`, `Private = 66.0 MB`), `schedule_mode = daily`, `03:00 Asia/Jakarta` + offline/boot catch-up, `last_daily_slot = 2026-11-19T03:00:00+07:00`, `next_check = 2026-11-20T03:00:00+07:00`, zero-backup policy (`--no-backup`)
- **Data Integrity:** `state.db` (`26` sessions, `1,279` messages), `memories\MEMORY.md` & `USER.md`, `64` `SKILL.md` terpasang
- **Scheduled Tasks Existing:** `\Hermes_Gateway` (`Running`), `\cua-driver-serve` (`Ready`), `\Hermes\HermesAutoUpdate` (`Running`), `\Hermes\HermesPostRebootVerify` (`Ready`, `LastResult = 0x0`).

## 4. Technical Analysis
1. **Keterbatasan RAM & CPU (`8 GB` RAM, `2C/4T` Pentium G5400):**
   - Menjalankan Docker Desktop / Linux VM tidak tersedia dan akan menghabiskan 2–4 GB RAM ekstra. Seluruh layanan baru wajib berbasis proses native ringan dengan batas konkurensi ketat (`1–2` worker aktif paralel, VulnClaw dijalankan *on-demand* tanpa daemon berat yang menganggur).
2. **Kapasitas Disk (`D:` bebas `7.70 GB`, `C:` bebas `16.04 GB`):**
   - `${ALLINONE_HOME}` layak digunakan karena ACL mengizinkan `Modify` bagi pengguna aktif, namun ukuran clone dan dependency store harus dijaga hemat (`--depth 1`, tanpa duplikasi artefak besar) dengan disk guard aktif.
3. **Runtime Readiness:**
   - Node.js global adalah `v20.16.0`, sedangkan Paperclip modern membutuhkan Node terbaru — beruntung portable `node-26.12.1-win32-x64` dan `pnpm-12.15.0-win32-x64` sudah tersedia di `%LOCALAPPDATA%\hermes\tools\` sehingga dapat digunakan secara eksplisit tanpa menyentuh Node global `v20.16.0` milik project lain (`C:\laragon`).
   - `uv 0.13.5` dan Python `3.10` / `3.14` tersedia untuk membuat virtual environment terisolasi bagi VulnClaw dan layer integrasi tanpa menyentuh venv Hermes (`Python 3.11.16`).
4. **Implikasi Keamanan Firewall:**
   - Karena Windows Firewall pada host saat ini berstatus `Enabled = False`, setiap server lokal baru (Paperclip UI/API, integration service) **wajib** diikat secara eksplisit ke `127.0.0.1` (bukan `0.0.0.0` atau `::`) dan dilengkapi autentikasi.

## 5. Implementation Plan
- Menyimpan hasil audit ke `${ALLINONE_HOME}\docs\PHASE-00-baseline-audit.md`.
- Menginisialisasi `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.json` dan `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.md` sebagai sumber pelacakan status seluruh fase (`PHASE-00` s/d `PHASE-19`).

## 6. Actual Execution
- Menjalankan skrip diagnostik read-only untuk OS/Hardware/Disk/Port/Firewall/Tasks (`phase00_audit.ps1`), Hermes read-only audit tanpa membuka nilai `.env` (`phase00_hermes_audit.ps1`), serta pengukuran SQLite session count & penggunaan memori proses Hermes (`phase00_extra.ps1`).
- Membuat dokumen laporan baseline dan implementation ledger awal pada `${ALLINONE_HOME}`.

## 7. Files Created
- `${ALLINONE_HOME}\docs\PHASE-00-baseline-audit.md`
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.json`
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.md`

## 8. Files Modified
- Tidak ada file existing yang dimodifikasi.

## 9. Commands Executed
- `powershell -NoProfile -ExecutionPolicy Bypass -File "...\scratch\phase00_audit.ps1"`
- `powershell -NoProfile -ExecutionPolicy Bypass -File "...\scratch\phase00_hermes_audit.ps1"`
- `powershell -NoProfile -ExecutionPolicy Bypass -File "...\scratch\phase00_extra.ps1"`

## 10. Test Scenarios
- **P00-T1:** Verifikasi identitas OS, CPU, RAM, kapasitas drive `C:` & `D:`, dan sesi desktop interaktif.
- **P00-T2:** Verifikasi seluruh path executable runtime (`node`, `pnpm`, `python`, `uv`, `git`, `hermes`) dan port aktif.
- **P00-T3:** Verifikasi kesehatan Hermes existing (`hermes --version`, `hermes config check`, `hermes gateway status`, `hermes-autoupdate status`, `hermes-health`) tanpa kebocoran nilai secret `.env`.

## 11. Expected Results
- Seluruh metrik perangkat keras, jaringan, runtime, dan layanan Hermes existing terpetakan lengkap dengan exit code `0` dan `0` perubahan destruktif.

## 12. Actual Results
- **P00-T1 (`PASS`):** `<machine-name>` Windows 10 Pro Build `19045` x64, Pentium G5400 (`2C/4T`), `8,126.5 MB` RAM, `C:` `16.04 GB` free, `D:` `7.70 GB` free, interactive console session `1` (`Active`).
- **P00-T2 (`PASS`):** Global Node `v20.16.0` + portable Node `v26.12.1`, `pnpm 12.15.0`, `uv 0.13.5`, Git `2.24.0` + portable Git `2.56.1`, Docker `NOT FOUND`, tidak ada konflik port pada rentang port kandidat platform.
- **P00-T3 (`PASS`):** Hermes `v0.23.2+1033.g31ce88f.dirty` (`31ce88f8...`), `Hermes Unified Health Status: HEALTHY`, jadwal update harian `03:00 Asia/Jakarta` aktif (`next_check: 2026-11-20T03:00:00+07:00`), `0` secret tercetak.

## 13. Evidence
- Output log audit host: `task-1591.log` (`exit code 0`).
- Output log audit Hermes: `steps/1592/output.txt` (`exit code 0`, `Config version: 54 ✓`, `HEALTHY`).
- Output pengukuran `state.db` & proses: `sessions_count: 26`, `messages_count: 1279`, Gateway PID `15524` (`69.4 MB` WS), Updater PID `5112` (`22.1 MB` WS).

## 14. Problems Found
1. Windows Firewall host dalam kondisi `Enabled = False` pada seluruh profil.
2. RAM fisik terbatas (`8 GB` dengan ~`946 MB` free saat IDE + browser/layanan berjalan) dan ruang kosong `D:` sebesar `7.70 GB`.
3. Node global adalah `v20.16.0` (kemungkinan di bawah syarat Node modern Paperclip), serta direktori `C:\Program Files\PostgreSQL\15` tidak memiliki instance database aktif.

## 15. Corrective Actions
1. Mencatat kewajiban binding `127.0.0.1` + autentikasi token pada seluruh layanan baru di Fase 02, 03, 05, dan 07.
2. Menetapkan penggunaan portable `node-26.12.1-win32-x64` dan `pnpm-12.15.0-win32-x64` secara eksplisit pada Fase 04–05 tanpa mengubah Node global `v20.16.0`.
3. Menetapkan arsitektur hemat memori & ruang disk (tanpa Docker VM, embedded DB resmi bila didukung Paperclip, eksekusi VulnClaw *on-demand*).

## 16. Acceptance Criteria
- [x] Instalasi Hermes berhasil diidentifikasi (`31ce88f8...`, `d064cda90b74df76` / `938ccaa4...`).
- [x] Seluruh lokasi aktual terverifikasi (`${ALLINONE_USER_HOME}`, `D:\`, `%LOCALAPPDATA%\hermes`).
- [x] Existing services terpetakan (`\Hermes_Gateway`, `\cua-driver-serve`, `\Hermes\HermesAutoUpdate`, `\Hermes\HermesPostRebootVerify`).
- [x] Dependency gaps diketahui (Docker tidak ada, Node global `v20.16.0` vs portable `v26.12.1`, tidak ada PostgreSQL server aktif).
- [x] Port conflicts diketahui (seluruh port aktif terpetakan; port aplikasi kandidat bebas).
- [x] Resource baseline tersedia (CPU, RAM idle/aktif, kapasitas `C:` & `D:`).
- [x] Tidak ada perubahan destruktif.
- [x] Baseline report tersedia (`PHASE-00-baseline-audit.md`).

## 17. Final Status
`PASS`
