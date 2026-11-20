# PAPERCLIP CUSTOM RUNTIME PROVIDER & IDENTITY CONTRACT

## 1. Single Source of Truth Principle
Paperclip AI (`http://127.0.0.1:3100`, `v2026.1117.0`, PostgreSQL `127.0.0.1:54329`) is the **sole authoritative source** for company identity (`Unified AI Engineering & Operations`, `0000000b-0000-4000-8000-00000000000b`), the 11 organizational agents, reporting hierarchy (`reportsTo`), projects, parent-child issues, heartbeat runs, approvals, and budget policies.

Office Bridge (`adapters/paperclip-adapter.js`) connects exclusively via **official Paperclip REST endpoints and native WebSocket live events**—never reading or mutating Paperclip's PostgreSQL database directly.

---

## 2. Official Paperclip Interfaces Consumed
- `GET /api/companies` & `GET /api/companies/:companyId/agents`
- `GET /api/companies/:companyId/projects` & `GET /api/companies/:companyId/issues`
- `POST /api/companies/:companyId/issues`, `GET /api/issues/:id`, `PATCH /api/issues/:id`, `GET/POST /api/issues/:id/comments`
- `GET /api/companies/:companyId/heartbeat-runs`, `GET /api/heartbeat-runs/:id/events`, `GET /api/heartbeat-runs/:id/log`, `POST /api/heartbeat-runs/:id/cancel`
- `POST /api/agents/:id/pause`, `POST /api/agents/:id/resume`, `POST /api/agents/:id/wakeup`
- `GET /api/companies/:companyId/approvals`, `POST /api/approvals/:id/(approve|reject)`
- `GET /api/companies/:companyId/budgets/overview`
- `ws://127.0.0.1:3100/api/companies/:companyId/events/ws` (authenticated via dedicated unscoped observer key)

---

## 3. Canonical Agent Identity Mapping Contract
Every virtual employee in Hermes3D uses `paperclip_agent_id` as its canonical primary key, eliminating duplicate avatars on reconnect:

| Internal Contract Field | Source / Derivation | Example (`CEO Agent`) |
| --- | --- | --- |
| `paperclip_agent_id` | Paperclip `agent.id` | `00000004-0000-4000-8000-000000000004` |
| `company_id` | Paperclip `agent.companyId` | `0000000b-0000-4000-8000-00000000000b` |
| `display_name` | Paperclip `agent.name` | `CEO Agent` |
| `department_id` / `department` | `ROLE_VISUAL_CATALOG` / `agent.role` | `executive` / `Executive Office` |
| `role` / `title` | Paperclip `agent.role` / `agent.title` | `ceo` / `Chief Executive Officer` |
| `manager_id` | Paperclip `agent.reportsTo` | `null` (Root) |
| `subordinate_ids` | Computed reverse `reportsTo` | `[CTO, Security Lead, Report & Compliance, ...]` |
| `runtime_type` | Paperclip `agent.adapterType` | `hermes_local` |
| `runtime_profile_reference` | Verified `${ALLINONE_HERMES_HOME}\profiles\pc*` | `pcceoagent` |
| `model_id` | Paperclip `adapterConfig.model` | `combo/X` |
| `visual_profile_id` / `avatar_id` | Deterministic catalog | `vp-exec-ceo-01` / `avatar-53eb2a21` |
| `office_location_id` | Assigned workstation slot | `exec-desk-01` |
| `activation_status` | `ACTIVE` (Wave-1) · `STANDBY` (Wave-2 `paused`) · `DEACTIVATED` | `ACTIVE` |
| `observed_at` | ISO-8601 snapshot timestamp | `2026-11-19T...` |
