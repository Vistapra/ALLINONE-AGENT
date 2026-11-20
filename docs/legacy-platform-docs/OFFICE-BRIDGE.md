# OFFICE BRIDGE ARCHITECTURE & SPECIFICATION

## 1. Purpose
`${ALLINONE_HOME}\office-bridge` (`http://127.0.0.1:3210`) is the dedicated normalization, real-time synchronization, authorization, and security redaction layer connecting **Hermes3D** (`127.0.0.1:3200`) to **Paperclip AI** (`127.0.0.1:3100`), **Hermes Workers**, **VulnClaw FindingsStore**, **Unified Health Monitor**, and the **Telegram Notification Bridge**.

---

## 2. Module Layout
- `server.js`: Singleton-locked HTTP & Dual-WebSocket server (`127.0.0.1:3210`).
- `authorization/auth.js`: NTFS-ACL-protected token management (`config/secrets/office-bridge-auth.json`), constant-time `timingSafeEqual` verification, Origin/CSRF allowlist, Owner RBAC (`YOUR_TELEGRAM_OWNER_ID_HERE`), and `240 req/min` rate limiting.
- `contracts/redaction.js`: Secret pattern scrubbing (`sk-*`, `pcp_*`, Telegram bot tokens, `Bearer`), `[EMBEDDED_DIRECTIVE:...]` neutralization, and path-jailed workspace validation (`validateAuthorizedEvidencePath`).
- `contracts/event-schema.js`: Normalized Event Schema `v1.0` (`28+` event types), monotonic `sequence`, `2,500`-key deduplication LRU, `60s` stale marking, and `500`-event persistent ring buffer (`office-data/event-history/recent-events.jsonl`).
- `contracts/state-machine.js`: Deterministic 6-dimensional state engine (`activation_state`, `connectivity_state`, `execution_state`, `task_state`, `maintenance_state`, `visual_state` across 19 visual states).
- `contracts/agent-identity.js`: Canonical Paperclip UUID identity mapping, 8 corporate departments, and filesystem-verified Hermes worker profile mapping (`pcceoagent` .. `pccompliancereporter`).
- `adapters/paperclip-adapter.js`: Official Paperclip REST + native live-events WS (`ws://127.0.0.1:3100/api/companies/:id/events/ws`), verified run tool evidence inspector (`inspectRunEvidenceText`), and `COST UNKNOWN` / `UNPRICED USAGE` budget formatter.
- `adapters/vulnclaw-findings-adapter.js`: Read-only SQLite reader for `findings.db` & `workflow-ledger.db`, Git/report Evidence Viewer, and out-of-process CLI/Telegram bridge.
- `events/realtime-synchronizer.js`: Combines Paperclip native WS push with `3s` bounded reconciliation diffing, emitting both Normalized v1.0 events and Hermes3D Gateway Protocol v3 frames.
- `tests/office-bridge.test.js`: Automated unit and live Paperclip integration suite.

---

## 3. Dual-Protocol Surface
1. **Hermes3D Gateway Protocol v3 (`ws://127.0.0.1:3210/ws`):** Implements `connect.challenge` -> `connect`, `agents.list` (all 11 Paperclip employees), `status`, `chat.history`, `chat.send` (governed Paperclip issue creation/comments), `tasks.list`/`tasks.create`/`tasks.update` (Kanban sync), `skills.status`, `cron.list`, and `agents.files.get`.
2. **Normalized Event Stream (`ws://127.0.0.1:3210/api/events/ws?sinceSeq=<n>`):** Pushes immediate `snapshot.reconcile` + `replay_events` on connect, followed by real-time `office.event` frames with `512 KB` per-client backpressure protection.
3. **Custom Runtime HTTP Seam:** `/health`, `/state`, `/registry`, `/v1/chat/completions`.
4. **Enterprise REST API:** `/api/office-bridge/{snapshot,events,agents,tasks,runs/:id/cancel,findings,governance,approvals/:id/resolve,meetings,emergency-stop,resume-wave1,health,evidence,layout,telegram/notify}`.
