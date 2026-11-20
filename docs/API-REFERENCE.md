# API Reference

Real surfaces only, verified directly against source — nothing here is invented or assumed from the original brief.

## Office Bridge HTTP endpoints (`apps/office-bridge/server.js`)

Verified directly from the file's own routing logic (a raw `http` server with manual path matching, not Express):

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Basic liveness check |
| GET | `/state` | Current synchronized state snapshot |
| GET | `/registry` | Component/agent registry |
| POST | `/v1/chat/completions` | OpenAI-compatible chat completion passthrough |
| GET | `/api/office-bridge/snapshot` | Full office state snapshot |
| GET | `/api/office-bridge/events` | Recent event history |
| GET | `/api/office-bridge/agents` | Agent roster and live status |
| GET | `/api/office-bridge/tasks` | Task list |
| POST | `/api/office-bridge/tasks` | Create a task |
| GET | `/api/office-bridge/findings` | VulnClaw findings (read-only — see [ARCHITECTURE.md](ARCHITECTURE.md) trust boundary) |
| GET | `/api/office-bridge/collaboration` | Collaboration/meeting state |
| POST | `/api/office-bridge/meetings` | Create/trigger a meeting |
| GET | `/api/office-bridge/analytics` | Analytics/telemetry data |
| GET | `/api/office-bridge/governance` | Governance/approval state |
| POST | `/api/office-bridge/emergency-stop` | Owner-only — fail-closed if `ALLINONE_TELEGRAM_OWNER_ID` unset |
| POST | `/api/office-bridge/resume-wave1` | Owner-only — same fail-closed behavior |
| GET | `/api/office-bridge/health` | Office Bridge's own health detail |
| GET | `/api/office-bridge/evidence` | Task/execution evidence |
| GET or POST | `/api/office-bridge/layout` | 3D/2D office layout data |

## WebSocket endpoints

| Path | Protocol | Purpose |
|---|---|---|
| `/ws` (or `/`) | Hermes3D Gateway Protocol v3 | Realtime office state sync with the Hermes3D frontend |
| `/api/events/ws` | Normalized Event Stream v1.0 | Normalized event bus subscription |

## Unified CLI (`integration/platform_cli.py`)

Confirmed real via its actual `argparse` setup — matches the original brief's claimed surface, plus genuine additional commands the brief didn't mention:

```text
ai-platform status [--json]
ai-platform health [--json]
ai-platform services [--json]
ai-platform agents [--json]
ai-platform tasks [--json]
ai-platform updates [--json]
ai-platform logs [--tail N]
ai-platform telegram-cmd <command> [--args ...] [--caller-id ...] [--message-id ...] [--notify]
ai-platform emergency-stop
ai-platform resume-wave1
ai-platform run-maintenance [--force] [--dry-run]
```

## Paperclip integration

Paperclip is a pinned-upstream dependency, not vendored into this repo — refer to its own docs (`paperclip/doc/instance-configuration.md`, `agent-configuration-yaml.md` in the upstream checkout) for its native API. This repo's integration surface against it is: company/agent creation via `integration/org_provisioner.py` (`get_primary_company()`, `POST /api/companies`, `POST /api/companies/{id}/agents`), and per-agent scoped API keys via `POST /api/agents/:id/keys` (see [CONFIGURATION.md](CONFIGURATION.md)'s `paperclip-agent-profile.example.env`).

## Not yet implemented

A live model-provider connectivity check in `setup.ps1` is **not implemented** as of this writing — marked `[NOT VERIFIED]` in source, not claimed to work. See [TESTING.md](TESTING.md).
