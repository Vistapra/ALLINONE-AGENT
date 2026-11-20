# Architecture

Expanded companion to [README.md §3](../README.md#3-arsitektur). This file adds component-level detail verified during this consolidation effort; it does not restate or contradict the README's diagram or trust-boundary description — read that first.

## Components and real default ports/protocols

Derived directly from an actual grep of ports/URLs/imports across `apps/office-bridge/` and `integration/` (not from the original brief's narrative) — see `DEPENDENCY-MAP.json` (Phase 39, staging record) for the raw data this table summarizes:

| Component | Default port | Protocol | Role |
|---|---|---|---|
| Paperclip | 3100 | HTTP, WS | Control plane: company/agent/task/approval/budget source of truth. Pinned upstream, not vendored. |
| PostgreSQL (embedded) | 54329 | postgres | Paperclip's own datastore — probed by Office Bridge for health, not owned by this repo. |
| Hermes3D | 3200 | HTTP | 3D/2D office frontend (Next.js). Endpoints observed: `/office`, `/login`, `/api/health`. |
| Office Bridge | 3210 | HTTP, WS | Realtime sync hub + auth boundary. Endpoints: `/ws` (Hermes3D Gateway Protocol v3), `/api/events/ws` (Normalized Event Stream v1.0). See [API-REFERENCE.md](API-REFERENCE.md). |
| VulnClaw | — | — | Defensive security scan engine. Output consumed via a findings adapter; no live network dependency was observed from Office Bridge to VulnClaw directly in this grep pass. |
| Hermes Agent | — | — | Execution engine / optional Telegram gateway. Invoked by `integration/hermes_worker_factory.py`; not observed calling Office Bridge directly. |
| Unified CLI (`integration/platform_cli.py`) | — | — | Operator CLI; polls health of Office Bridge and Hermes3D. |

## Trust boundary (expanded)

The README's Mermaid diagram already shows the one boundary that matters most: **VulnClaw is read-only from Office Bridge's perspective** — findings flow one direction, never commands. This was re-verified during Phase 49/the security remediation passes: the adapter that reads VulnClaw findings (`apps/office-bridge/adapters/vulnclaw-findings-adapter.js`) only ever reads; nothing in this repo writes back into VulnClaw's own data.

A second boundary, found and hardened during this effort's security remediation passes (see [README §14](../README.md#14-security--privacy)): every owner-only mutation endpoint in Office Bridge is **fail-closed** — if `ALLINONE_TELEGRAM_OWNER_ID` isn't configured, those endpoints reject every caller rather than silently authorizing. This was an actual bug (fail-open) found and fixed, not a feature invented after the fact.

## 3D / 2D shared state

`apps/hermes3d/src/features/retro-office` (3D) and `apps/hermes3d/src/features/pixel-office` (2D) both consume a common `src/features/office/` state/hooks layer (e.g. `useOfficeBuilderStore.ts`, `useOfficeStandupController.ts`). This is **structurally confirmed** — both features import from the same modules — but **not runtime-proven**: no dev server has been run end-to-end to confirm the two modes render identical state in practice. See [TESTING.md](TESTING.md) and [MEETING-GUIDE.md](MEETING-GUIDE.md) for exactly what is and isn't verified here.

## Where to look next

- Config/env var resolution: [CONFIGURATION.md](CONFIGURATION.md)
- Real HTTP/WS API surface: [API-REFERENCE.md](API-REFERENCE.md)
- Service lifecycle and scheduled-task ownership: [SERVICE-MANAGEMENT.md](SERVICE-MANAGEMENT.md)
- Upstream components and licensing: [UPSTREAM-COMPONENTS.md](UPSTREAM-COMPONENTS.md), [../THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)
