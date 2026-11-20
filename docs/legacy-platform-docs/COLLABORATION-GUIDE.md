# MULTI-AGENT COLLABORATION & VIRTUAL MEETING GUIDE

## 1. Evidence-Driven Collaboration Model
All collaboration lines, delegation badges, and Meeting Room states in Hermes3D derive **100% from verified Paperclip parent-child issues, assignee handoffs, structured comments, and FindingsStore transitions**. Fake inter-agent chatter is strictly prohibited.

## 2. Canonical Company Handoff Chain
1. **Owner -> CEO Agent (`Executive Office`):** Owner submits a goal from Hermes3D or Telegram -> Paperclip creates parent task -> `CEO Agent` runs on `hermes_local` (`combo/X`) and produces the decomposition plan.
2. **CEO / CTO -> Backend Developer (`Engineering`):** Child implementation/remediation task created with `parentId` -> `task.delegated` event emitted -> delegation edge rendered in `Collab` tab.
3. **VulnClaw / Security Reviewer (`SOC`):** Defensive code scan / synthetic report imported into `FindingsStore` (`OPEN`) -> `Security Reviewer` evaluates finding (`CONFIRMED`) -> automatically links remediation issue (`rem_issue_id`) to `Backend Developer`.
4. **Backend Developer -> QA Engineer (`QA Lab`):** Developer commits fix + tests on an isolated Git branch (`fix/*`, leaving `main` untouched) -> QA task assigned to `QA Engineer` -> `QA Engineer` runs `unittest` verification (`exitCode == 0`).
5. **QA & Security -> Final Report (`Compliance` / Owner):** Post-scan confirms `0` remaining findings (`RESOLVED`), parent issue transitions to `done` (`COMPLETED`), and sanitized report is delivered to both Hermes3D and Telegram.

## 3. Governed Virtual Meeting Room & Anti-Loop Safeguards
- **Endpoint:** `GET / POST /api/office-bridge/meetings`
- **Backing Store:** Creates an official bounded Paperclip parent coordination task and archives structured summaries in `${ALLINONE_HOME}\office-data\meetings\meetings.json`.
- **Loop & Token Protections:**
  - Maximum delegation depth enforced by `WorkflowEngine` (`max_delegation_depth: 3`, DAG cycle check `_check_no_cycle`).
  - Maximum concurrent Wave-1 runs capped (`max_concurrent_runs: 2`).
  - Bounded run timeout (`360–450s`) and max retries (`3`).
