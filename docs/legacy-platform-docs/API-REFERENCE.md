# UNIFIED PLATFORM & OFFICE BRIDGE API REFERENCE

## 1. Office Bridge HTTP REST API (`http://127.0.0.1:3210`)
*Authentication:* `Authorization: Bearer <bridgeToken>` or `X-Office-Bridge-Token: <bridgeToken>` (except public `/health`). Mutating methods also verify Owner `YOUR_TELEGRAM_OWNER_ID_HERE` and `Origin` allowlist.

| Method & Path | Description |
| --- | --- |
| `GET /health` | Unauthenticated loopback liveness check (`{ ok: true, paperclip_reachable: true }`). |
| `GET /state` · `GET /registry` | Custom Runtime HTTP provider snapshot & agent registry for Hermes3D. |
| `POST /v1/chat/completions` | Governed instruction-to-Paperclip-task completion seam. |
| `GET /api/office-bridge/snapshot[?refresh=1]` | Full synchronized company snapshot (company, 11 agents + 6D states, tasks, runs, findings, collaboration, budget, maintenance, event stats). |
| `GET /api/office-bridge/events?sinceSeq=<n>&limit=<k>` | Poll normalized `v1.0` events after sequence `n`. |
| `GET /api/office-bridge/agents` | All 11 mapped Paperclip agents with 8-department coordinates & states. |
| `GET /api/office-bridge/agents/:agentId` | 11-section Agent Inspector payload (overview, tasks, runs, sanitized logs, skills, tools, workspaces, hierarchy, budget, health). |
| `POST /api/office-bridge/agents/:agentId/(pause\|resume\|wake)` | Governed Paperclip lifecycle transition. |
| `GET /api/office-bridge/tasks` | Synchronized Paperclip issues list. |
| `POST /api/office-bridge/tasks` | Create governed Paperclip issue (`title`, `description`, `assignee_agent_id`, `idempotency_key`, `wake_immediately`). |
| `GET / PATCH /api/office-bridge/tasks/:issueId` | Retrieve task + comments + runs, or patch `status` / `assigneeAgentId` / `comment`. |
| `POST /api/office-bridge/runs/:runId/cancel` | Cancel active Paperclip heartbeat run. |
| `GET /api/office-bridge/findings` | Sanitized read-only VulnClaw defensive findings & timelines (`findings.db`). |
| `GET /api/office-bridge/collaboration` | Active parent-child delegation graph & virtual meetings. |
| `POST /api/office-bridge/meetings` | Start governed Paperclip coordination meeting (`agenda`, `participants`). |
| `GET /api/office-bridge/governance` | Pending approvals, per-agent budget policies (`COST UNKNOWN` / `UNPRICED USAGE`), and role boundaries. |
| `POST /api/office-bridge/approvals/:id/resolve` | Resolve Paperclip approval (`decision: "approve" \| "reject"`). |
| `POST /api/office-bridge/emergency-stop` | Trigger platform-wide Emergency Stop via `platform_cli.py`. |
| `POST /api/office-bridge/resume-wave1` | Restore the 4 Wave-1 agents (`ACTIVE`) while keeping 7 Wave-2 agents `STANDBY`. |
| `GET /api/office-bridge/health` | 12-component functional Unified Health Matrix (`HEALTHY` / `DEGRADED` / `MAINTENANCE` / `OFFLINE` / `UNKNOWN`). |
| `GET /api/office-bridge/evidence?target=<path>` | Path-jailed Git branch, commit, changed-file, and report viewer (`workspaces/`, `reports/`, `docs/`). |
| `GET / PUT /api/office-bridge/layout` | Load or save 3D office layout customization (`office-data/layouts/company-layout.json`). |

---

## 2. WebSocket Streams (`127.0.0.1:3210` & Proxied via `127.0.0.1:3200`)
- **Normalized Event Stream (`ws://127.0.0.1:3210/api/events/ws?sinceSeq=<n>` / `ws://127.0.0.1:3200/api/company/events/ws`):** Sends `snapshot.reconcile` on connect and real-time `office.event` frames (`v1.0`).
- **Hermes3D Gateway Protocol v3 (`ws://127.0.0.1:3210/ws` / `ws://127.0.0.1:3200/api/gateway/ws`):** Supports `connect`, `agents.list`, `status`, `chat.history`, `chat.send`, `tasks.list`, `tasks.create`, `tasks.update`, `skills.status`, `cron.list`, and `agents.files.get`.

---

## 3. Unified Platform CLI (`${ALLINONE_HOME}\ai-platform.cmd`)
- `ai-platform.cmd status [--json]` · `ai-platform.cmd health [--json]` · `ai-platform.cmd services` · `ai-platform.cmd agents` · `ai-platform.cmd tasks` · `ai-platform.cmd emergency-stop` · `ai-platform.cmd resume-wave1` · `ai-platform.cmd run-maintenance [--dry-run]`.
