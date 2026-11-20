# CONFIGURATION REFERENCE

## 1. Network Ports & Loopback Bindings

| Service | Host | Port | Protocol | Configuration Source |
| --- | --- | --- | --- | --- |
| **Paperclip AI** | `127.0.0.1` | `3100` | HTTP + WS | `PaperclipServiceLauncher.exe` |
| **Paperclip PostgreSQL** | `127.0.0.1` | `54329` | TCP | Embedded Paperclip PostgreSQL |
| **Office Bridge** | `127.0.0.1` | `3210` | HTTP + Dual WS | `OFFICE_BRIDGE_HOST`, `OFFICE_BRIDGE_PORT` |
| **Hermes3D Virtual Office** | `127.0.0.1` | `3200` | HTTP + WS Proxy | `HOST=127.0.0.1`, `PORT=3200` |

---

## 2. Environment Variables (`OfficeServiceLauncher.exe`)

| Variable | Value / Source | Purpose |
| --- | --- | --- |
| `UNIFIED_COMPANY_GOVERNANCE` | `1` | Activates enterprise route lockdowns, SSRF guards, path jails, and server-side token injection in Hermes3D. |
| `OFFICE_BRIDGE_HOST` / `PORT` | `127.0.0.1` / `3210` | Loopback bind for Office Bridge. |
| `PAPERCLIP_BASE_URL` | `http://127.0.0.1:3100` | Official Paperclip API base URL. |
| `HERMES3D_GATEWAY_URL` | `ws://127.0.0.1:3210/ws` | Connects Hermes3D gateway proxy to Office Bridge. |
| `HERMES3D_GATEWAY_TOKEN` | Loaded from `office-bridge-auth.json` | Server-side upstream token (never exposed to browser). |
| `STUDIO_ACCESS_TOKEN` | Loaded from `office-bridge-auth.json` | Gates `http://127.0.0.1:3200/login` & `studio_access` HttpOnly cookie. |

---

## 3. Model, Concurrency & Maintenance Configuration

- **AI Model:** `combo/X` (`provider: custom`, `base_url: https://work.example-provider.com/v1`, credential ref: `CUSTOM_API_KEY`).
- **Cost Display Policy:** Because `combo/X` reports `cost_usd: null`, all dashboards and APIs display `COST UNKNOWN` / `UNPRICED USAGE` (never `$0.00`).
- **Concurrency Limits (`config/resource-limits.json`):** `4` Wave-1 agents `ACTIVE`, `7` Wave-2 agents `STANDBY` (`paused`), `max_concurrent_runs: 2`, `max_delegation_depth: 3`, `disk_d_min_free_gb: 2.0`.
- **Maintenance Schedule:** Daily `03:00 Asia/Jakarta` with offline catch-up and active-work deferral; Hermes Auto-Updater retains `BACKUP_ENABLED: false`.
