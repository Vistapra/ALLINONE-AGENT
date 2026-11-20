# PHASE 32 — UNIFIED COMPANY DASHBOARD & OBSERVABILITY

- **Final Phase Status:** `PASS`
- **Executed At:** `2026-11-19`

## 1. Objective
Deliver a comprehensive Company Dashboard & Observability suite inside Hermes3D displaying real corporate KPIs, 12-component functional Operational Health, measured Agent Performance, Kanban/Org views, 2D Pixel Office fallback, and a path-jailed Evidence Viewer.

## 2. Prerequisites
- PHASE 25 VulnClaw Security Center.
- PHASE 30 Governance & Budget Control.
- PHASE 31 Telegram & Office Sync.

## 3. Previous Phase Dependencies
- `PHASE-25-vulnclaw-security-center.md`
- `PHASE-30-governance-budget.md`
- `PHASE-31-telegram-office-sync.md`

## 4. Current Condition
Platform health checks existed in `platform_cli.py` and `last-health-snapshot.json`, while workspace Git/report artifacts lived in `${ALLINONE_HOME}\workspaces` and `reports`.

## 5. Technical Analysis
Verified all 15 corporate overview counters, 12 operational health components (`paperclip`, `postgresql`, `hermes_agent`, `hermes_gateway`, `telegram`, `vulnclaw_defensive`, `computer_use`, `office_bridge`, `hermes3d`, `event_stream`, `maintenance_coordinator`, `auto_updater`), objective agent performance counters (completed/failed runs, duration, token usage—never fake animation-based "productivity scores"), and strict path-jailed evidence inspection (`validateAuthorizedEvidencePath`).

## 6. Architecture Decision
Expose `/api/office-bridge/snapshot`, `/api/office-bridge/health`, and `/api/office-bridge/evidence?target=...` and render them in the **Enterprise Command Center** (`Roster`, `Inspector`, `Collab`, `SOC`, `Gov/Budget`, `Ops/Evid` tabs) plus native Kanban & 2D Phaser Pixel Office fallback (`PhaserOfficeCanvas.tsx`), backed strictly by Paperclip + SQLite read-only views with zero duplicate business databases.

## 7. Implementation Plan
1. Aggregate all 15 company overview metrics (`total_agents`, `active_agents`, `standby_agents`, `running_agents`, `idle_agents`, `unknown_agents`, `total_projects`, `running_tasks`, `queued_tasks`, `blocked_tasks`, `completed_tasks`, `failed_tasks`, `pending_approvals`, `open_findings`, `resolved_findings`).
2. Build `buildUnifiedHealthMatrix()` evaluating functional health across all 12 components (`HEALTHY`, `DEGRADED`, `MAINTENANCE`, `OFFLINE`, `BLOCKED`, `UNKNOWN`).
3. Build `inspectWorkspaceEvidence(target)` returning Git branch, commit history, changed files, and sanitized report excerpts strictly inside `workspaces/`, `reports/`, and `docs/`.

## 8. Actual Implementation
- Implemented `buildUnifiedHealthMatrix` in `office-bridge/server.js` (stripping PowerShell UTF-8 BOM `\uFEFF` from `last-health-snapshot.json` for sub-millisecond reads with automatic fallback to `platform_cli.py`).
- Implemented `inspectWorkspaceEvidence` in `vulnclaw-findings-adapter.js` guarded by `validateAuthorizedEvidencePath`.
- Wired `Ops/Evid` tab, Kanban board (`tasks.list`/`tasks.create`/`tasks.update`), Org tree, and `2D PIXEL` fallback in Hermes3D.

## 9. Files Created
- `${ALLINONE_HOME}\docs\PHASE-32-company-dashboard.md`

## 10. Files Modified
- `${ALLINONE_HOME}\office-bridge\server.js`
- `${ALLINONE_HOME}\office-bridge\adapters\vulnclaw-findings-adapter.js`
- `${ALLINONE_HOME}\hermes3d\source\src\features\enterprise-company\EnterpriseOfficeOverlay.tsx`

## 11. Commands Executed
- `${ALLINONE_HOME}\runtime\bin\npm26.cmd run build`

## 12. Test Scenarios
- Verify all 12 components in `/api/office-bridge/health` report functional `HEALTHY` status.
- Open `workspaces/verification-demo` in Evidence Viewer -> displays real Git commits (`fdc8f27`, `873123a`) and branch `main`.
- Attempt path traversal (`C:\Windows\System32\drivers\etc\hosts` or `config\secrets\...`) -> rejected with `403 Forbidden`.

## 13. Expected Results
Real-time KPIs match Paperclip; 12/12 health checks functional; arbitrary file reads blocked.

## 14. Actual Results
Verified in live browser (`final_step_97.png` showing `fdc8f27 | Fix null check and input sanitization` in Evidence Viewer) and API health check (`12/12 HEALTHY`).

## 15. Evidence
- `final_step_97.png`
- `office-bridge/server.js`

## 16. Root Cause (Issues Encountered)
`platform-watchdog.ps1` writes `last-health-snapshot.json` with a PowerShell UTF-8 BOM (`\uFEFF`), causing `JSON.parse` to fall back to cold CLI execution.

## 17. Corrective Actions
Added `.replace(/^\uFEFF/, "")` prior to `JSON.parse`, reducing `/api/office-bridge/health` latency from `~4.9s` to `<15ms` with all 12/12 components reporting `HEALTHY`.

## 18. Regression Test
Verified via `reload_and_verify.py` and Phase 36 test suite.

## 19. Acceptance Criteria
- [x] Dashboard uses authentic Paperclip, Hermes, and FindingsStore telemetry.
- [x] Statistics match Paperclip counts.
- [x] Health matrix reflects functional verification (not mere PID presence).
- [x] `UNKNOWN` values handled transparently.
- [x] Path-jailed Evidence Viewer verified.
- [x] Zero duplicate business databases.

## 20. Final Phase Status
`PASS`
