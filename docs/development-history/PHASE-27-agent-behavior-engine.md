# PHASE 27 — REAL-TIME AGENT BEHAVIOR ENGINE

- **Final Phase Status:** `PASS`
- **Executed At:** `2026-11-19`

## 1. Objective
Bind real backend Paperclip + Hermes runtime telemetry to 3D avatar behavior using 6 orthogonal state dimensions and 19 verified visual states—never fabricating `CODING`, `TESTING`, or `COLLABORATING` animations without verified runtime/task evidence.

## 2. Prerequisites
- PHASE 24 Normalized Real-Time Event Bridge (`v1.0`).
- PHASE 26 3D Office & Avatar System.

## 3. Previous Phase Dependencies
- `PHASE-24-realtime-event-bridge.md`
- `PHASE-26-office-design.md`

## 4. Current Condition
Native Hermes3D collapsed agent state into a simplified UI string (`idle`, `working`, `thinking`, `error`), which could conflate a paused Wave-2 agent with an idle Wave-1 agent or imply active coding merely from an agent's job title.

## 5. Technical Analysis
Analyzed Paperclip agent lifecycle (`status`, `lifecycleState`), issue status (`backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`), heartbeat runs (`queued`, `running`, `succeeded`, `failed`, `cancelled`), and run log evidence (`inspectRunEvidenceText`).

## 6. Architecture Decision
Implement a pure deterministic 6-dimensional state machine in `office-bridge/contracts/state-machine.js`:
1. `activation_state` (`ACTIVE`, `STANDBY`, `DEACTIVATED`, `UNKNOWN`)
2. `connectivity_state` (`ONLINE`, `STALE`, `OFFLINE`, `UNKNOWN`)
3. `execution_state` (`IDLE`, `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `PAUSED`, `UNKNOWN`)
4. `task_state` (`NONE`, `ASSIGNED`, `IN_PROGRESS`, `IN_REVIEW`, `WAITING_APPROVAL`, `BLOCKED`, `COMPLETED`, `FAILED`, `CANCELLED`, `UNKNOWN`)
5. `maintenance_state` (`NORMAL`, `MAINTENANCE_ACTIVE`, `UPDATE_DEFERRED`)
6. `visual_state` (`19` canonical states: `IDLE`, `WALKING`, `AT_DESK`, `PLANNING`, `WORKING`, `CODING`, `RESEARCHING`, `BUILDING`, `TESTING`, `REVIEWING`, `COLLABORATING`, `WAITING_APPROVAL`, `BLOCKED`, `COMPLETED`, `FAILED`, `PAUSED`, `MAINTENANCE`, `OFFLINE`, `UNKNOWN`).

## 7. Implementation Plan
1. Encode strict priority precedence (`MAINTENANCE` > `OFFLINE` > `UNKNOWN` > `PAUSED` > `WAITING_APPROVAL` > `BLOCKED` > `FAILED` > verified `CODING/TESTING/BUILDING/RESEARCHING/REVIEWING/PLANNING/COLLABORATING` > generic `WORKING` > `WALKING/AT_DESK` > `COMPLETED` > `IDLE`).
2. Require verified run event/log tool markers before emitting `CODING`, `TESTING`, `BUILDING`, or `RESEARCHING`; fall back honestly to generic `WORKING`.
3. Distinguish `OFFLINE` (unreachable service) from `UNKNOWN` (missing telemetry) and `STALE` (`>60s` snapshot age).
4. Reconcile active runs seamlessly across browser disconnect/reconnect without resetting active workers to `IDLE`.

## 8. Actual Implementation
- Created `office-bridge/contracts/state-machine.js` and wired it into `office-bridge/events/realtime-synchronizer.js` and `EnterpriseOfficeOverlay.tsx`.
- Added unit and integration verification in `office-bridge/tests/office-bridge.test.js` and `tests/unit/enterpriseCompanyIntegration.test.ts`.

## 9. Files Created
- `${ALLINONE_HOME}\office-bridge\contracts\state-machine.js`
- `${ALLINONE_HOME}\AGENT-STATE-MACHINE.md`
- `${ALLINONE_HOME}\docs\PHASE-27-agent-behavior-engine.md`

## 10. Files Modified
- `${ALLINONE_HOME}\office-bridge\events\realtime-synchronizer.js`
- `${ALLINONE_HOME}\hermes3d\source\src\features\enterprise-company\useEnterpriseCompanyLive.ts`

## 11. Commands Executed
- `${ALLINONE_HOME}\runtime\bin\node26.cmd --test ${ALLINONE_HOME}\office-bridge\tests\office-bridge.test.js`
- `${ALLINONE_HOME}\runtime\bin\npm26.cmd test -- tests/unit/enterpriseCompanyIntegration.test.ts`

## 12. Test Scenarios
- Developer running without verified coding tool -> `WORKING` (not `CODING`).
- Developer running with verified file-edit tool -> `CODING`.
- Wave-2 standby agent -> `activation_state=STANDBY`, `visual_state=PAUSED`.
- Pending approval -> `WAITING_APPROVAL`.
- Unreachable Paperclip vs incomplete telemetry -> `OFFLINE` vs `UNKNOWN`.

## 13. Expected Results
100% deterministic state transitions; browser animation is strictly read-only consumer of backend state.

## 14. Actual Results
All state machine unit tests (`office-bridge.test.js` & `enterpriseCompanyIntegration.test.ts`) passed (`PASS`). Live office shows 4 Wave-1 `ACTIVE / IDLE` and 7 Wave-2 `STANDBY / PAUSED` at rest, transitioning dynamically on real Paperclip runs.

## 15. Evidence
- `${ALLINONE_HOME}\AGENT-STATE-MACHINE.md`
- `${ALLINONE_HOME}\office-bridge\contracts\state-machine.js`

## 16. Root Cause (Issues Encountered)
None during state-machine verification.

## 17. Corrective Actions
None required.

## 18. Regression Test
Included in automated Office Bridge & Vitest suites.

## 19. Acceptance Criteria
- [x] Virtual activity matches real backend events.
- [x] State transitions tested and verified.
- [x] Reconnect preserves active work without resetting to `IDLE`.
- [x] Animations never trigger backend execution.
- [x] `OFFLINE` and `UNKNOWN` clearly distinguished; zero fake activity.

## 20. Final Phase Status
`PASS`
