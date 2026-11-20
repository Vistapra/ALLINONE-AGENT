# PHASE 28 — INTERACTIVE AGENT COMMAND CENTER

- **Final Phase Status:** `PASS`
- **Executed At:** `2026-11-19`

## 1. Objective
Enable the authorized Owner to inspect any virtual employee's real telemetry and issue governed Paperclip tasks, assignments, status queries, pause/resume, run cancellations, and evidence inspections directly from Hermes3D without exposing raw shell access or private credentials.

## 2. Prerequisites
- PHASE 23 Paperclip Custom Runtime Provider.
- PHASE 27 Real-Time Agent Behavior Engine.

## 3. Previous Phase Dependencies
- `PHASE-23-paperclip-runtime-provider.md`
- `PHASE-27-agent-behavior-engine.md`

## 4. Current Condition
Hermes3D's default chat/inspector assumed OpenClaw/Hermes direct gateway sessions rather than Paperclip governed issue creation, hierarchy, budget policies, and sanitized run logs.

## 5. Technical Analysis
Evaluated Paperclip official mutation endpoints (`POST /api/companies/:id/issues`, `PATCH /api/issues/:id`, `POST /api/issues/:id/comments`, `POST /api/agents/:id/pause|resume|wakeup`, `POST /api/heartbeat-runs/:id/cancel`) and Hermes worker profile isolation (`${ALLINONE_HERMES_HOME}\profiles\pc*`).

## 6. Architecture Decision
Build the **Agent Inspector & Command Center** inside `EnterpriseOfficeOverlay.tsx` (`Inspector` tab) backed by `/api/company/*` -> Office Bridge `/api/office-bridge/agents/:id`, `/api/office-bridge/tasks`, `/api/office-bridge/runs/:id/cancel`, and `/v1/chat/completions` (governed instruction-to-task bridge). Never share the Owner's private Telegram session with workers, and never expose unrestricted terminal execution in the browser.

## 7. Implementation Plan
1. Build `buildAgentInspectorPayload(agentId)` in `office-bridge/server.js` returning Overview, Current Task, Task Queue, Activity, Skills, Authorized Tools, Authorized Workspaces, Hierarchy (Manager & Subordinates), Execution History, Sanitized Run Logs, Performance, Budget (`COST UNKNOWN / UNPRICED USAGE`), and Health.
2. Wire authorized actions: Create & Assign Task (with `idempotency_key` deduplication), Pause Agent, Resume Agent, Wake Agent, Cancel Active Run, Add Review/Feedback Comment, and Open Evidence Viewer.
3. Enforce Owner authorization (`YOUR_TELEGRAM_OWNER_ID_HERE` + `studio_access` cookie + CSRF same-origin check), returning `401`/`403` on unauthorized mutations.

## 8. Actual Implementation
- Implemented `GET /api/office-bridge/agents/:id`, `POST /api/office-bridge/agents/:id/(pause|resume|wake)`, `POST /api/office-bridge/tasks`, `PATCH /api/office-bridge/tasks/:id`, and `POST /api/office-bridge/runs/:id/cancel` in `office-bridge/server.js`.
- Resolved Paperclip's redacted `HERMES_HOME` env by filesystem-verifying worker profile directories (`pcceoagent` .. `pccompliancereporter`) in `agent-identity.js`.
- Rendered all Inspector sections and action controls in `EnterpriseOfficeOverlay.tsx`.

## 9. Files Created
- `${ALLINONE_HOME}\docs\PHASE-28-agent-command-center.md`

## 10. Files Modified
- `${ALLINONE_HOME}\office-bridge\server.js`
- `${ALLINONE_HOME}\office-bridge\contracts\agent-identity.js`
- `${ALLINONE_HOME}\hermes3d\source\src\app\api\company\[...slug]\route.ts`
- `${ALLINONE_HOME}\hermes3d\source\src\features\enterprise-company\EnterpriseOfficeOverlay.tsx`

## 11. Commands Executed
- `${ALLINONE_HOME}\runtime\bin\npm26.cmd run build`
- `${ALLINONE_HOME}\runtime\bin\node26.cmd --test ${ALLINONE_HOME}\office-bridge\tests\office-bridge.test.js`

## 12. Test Scenarios
- Click `CEO Agent` -> verify real UUID `00000004-0000-4000-8000-000000000004`, profile `pcceoagent`, model `combo/X`, subordinates, skills, tools, workspace, and sanitized run history.
- Create task with `idempotency_key` -> creates Paperclip issue once; duplicate submission returns deduplicated task.
- Submit mutation with `X-Office-Actor-Role: viewer` -> rejected with `403 Forbidden`.

## 13. Expected Results
All Inspector panels display real Paperclip/Hermes data; governed mutations persist in Paperclip and reject unauthorized callers.

## 14. Actual Results
Verified via API tests and live browser inspection (`final_step_97.png`). Private chain-of-thought and credentials are never exposed.

## 15. Evidence
- `office-bridge/tests/office-bridge.test.js` (`PASS`)
- Live UI verification screenshot `final_step_97.png`

## 16. Root Cause (Issues Encountered)
Paperclip REST API redacts `adapterConfig.env.HERMES_HOME` to `***REDACTED***` (and stores raw env entries as `{ type: "plain", value: "..." }`).

## 17. Corrective Actions
Updated `extractHermesProfileRef` in `agent-identity.js` to unwrap object values and verify canonical worker profile directories (`pcceoagent`, etc.) on disk without reading any secret files.

## 18. Regression Test
Verified `/api/office-bridge/agents` returns exact verified profile names for all 11 agents.

## 19. Acceptance Criteria
- [x] Avatars selectable in 3D/2D view and Roster.
- [x] Inspector populated from real Paperclip + Hermes telemetry.
- [x] Tasks created, assigned, paused/resumed, and cancelled via official Paperclip APIs.
- [x] Unauthorized actions rejected (`401`/`403`).
- [x] No unrestricted browser terminal interface exposed.

## 20. Final Phase Status
`PASS`
