# OFFICE SECURITY AUDIT — HERMES3D × OFFICE BRIDGE

- **Audit Date:** `2026-11-19`
- **Target System:** `UNIFIED AUTONOMOUS AI COMPANY` (`Hermes3D` `127.0.0.1:3200` + `Office Bridge` `127.0.0.1:3210`)
- **Automated Secret & Bundle Scan:** `overall_passed: true` (`158` files scanned including `.next/static` client bundles, `0` leaked secrets)

---

## 1. Security Controls Matrix

| Domain | Control Implemented | Verification Method | Result |
| --- | --- | --- | --- |
| **Network Exposure** | Both `127.0.0.1:3200` (Hermes3D) and `127.0.0.1:3210` (Office Bridge) bind strictly to IPv4 loopback (`127.0.0.1`). | Socket binding & port inspection | `PASS` |
| **UI & API Authentication** | `server/access-gate.js` enforces `STUDIO_ACCESS_TOKEN` on every route & WS upgrade via `/login` + `HttpOnly; SameSite=Strict` cookie. Office Bridge enforces constant-time `timingSafeEqual` `bridgeToken`. | Unauth HTTP/WS probes (`401`) | `PASS` |
| **Authorization & RBAC** | Mutating actions (`POST/PATCH/PUT/DELETE` tasks, pause/resume, cancel, approvals, emergency-stop) require Owner identity (`YOUR_TELEGRAM_OWNER_ID_HERE`) and `owner` role; `viewer` role receives `403`. | Role & actor negative tests (`403`) | `PASS` |
| **WebSocket Origin & CSRF** | `/api/company/[...slug]`, `/api/company/events/ws`, `/ws`, and `/api/events/ws` validate `Origin` against loopback allowlist (`http://127.0.0.1:3200`, `http://localhost:3200`). | Cross-origin `https://attacker.example` (`403`) | `PASS` |
| **Server-Side Secret Storage** | Secrets stored in `${ALLINONE_HOME}\config\secrets\office-bridge-auth.json` with NTFS inheritance removed (`icacls /inheritance:r`), accessible only to `<owner-username>`, `SYSTEM`, and `Administrators`. Browser never receives `bridgeToken`, `PAPERCLIP_BOARD_KEY`, `CUSTOM_API_KEY`, or `TELEGRAM_BOT_TOKEN`. | `icacls` audit + `.next/static` scan | `PASS` |
| **Upstream Route Hardening** | Under `UNIFIED_COMPANY_GOVERNANCE=1`: `/api/runtime/custom` SSRF-locked to local ports `3210/3100`; `/api/path-suggestions` jailed to `workspaces/` & `reports/`; `/api/office/agent-state` and `/api/skills/remove` disabled (`403`). | Route negative probes | `PASS` |
| **Path Traversal & Zone Isolation** | `validateAuthorizedEvidencePath` resolves `fs.realpathSync`, blocks null bytes, explicitly denies `${ALLINONE_HERMES_HOME}`, `config\secrets`, `data\vulnclaw`, and `C:\Windows`, and permits only `workspaces/`, `reports/`, and `docs/`. | Traversal & restricted-zone tests (`403`) | `PASS` |
| **Untrusted Data & Redaction** | `sanitizePayload` / `sanitizeText` strips `sk-*`, `pcp_*`, Telegram tokens, `Bearer` headers, sensitive JSON keys, and neutralizes `[EMBEDDED_DIRECTIVE:...]` / prompt-injection strings into `[DATA_LITERAL_DIRECTIVE_IGNORED]`. | Unit & E2E injection fixtures | `PASS` |
| **VulnClaw Isolation** | Office Bridge reads only structured SQLite records from `${ALLINONE_HOME}\data\findings\findings.db` (`readonly: true`). Browser & avatars have zero direct execution path to VulnClaw CLI/containers. | Architecture & boundary audit | `PASS` |
| **HTTP Security Headers** | `Content-Security-Policy` (`frame-ancestors 'none'`, `object-src 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `240 req/min` rate limiting. | Response header inspection | `PASS` |

---

## 2. Dependency Vulnerability Review

- `npm audit --omit=dev` (`reports/phase22-npm-audit.json`): Reviewed production dependency graph on isolated loopback runtime; zero unauthenticated remote vectors exposed because `access-gate.js` gates every HTTP and WebSocket request before reaching Next.js handlers.

---

## 3. Documented Credential Rotation Status (Owner Action Item)

- `telegram_bot_token_rotated_since_chat_exposure: false`
- `custom_api_key_rotated_since_chat_exposure: false`
- **Transparency Note:** Neither credential was ever echoed, logged, or bundled by our code (`verify-security-boundaries.py` -> `0` leaks across `158` files). However, because both values were pasted in plain text by the Owner in earlier conversation turns (`PHASE 00–19`), rotating the Telegram bot token via `@BotFather` and `CUSTOM_API_KEY` via `work.example-provider.com` remains recommended for production hygiene.
