# User Guide

**Honesty notice up front**: the walkthrough below describes what the vendored office code is *built* to support, based on real source (`apps/hermes3d/src/features/retro-office`, `pixel-office`, `enterprise-company`) and the real `agents/roles/` provisioning flow. **Full end-to-end usage of this flow has not yet been runtime-tested** (that's Phase 52/53 in this effort's own terms — see [TESTING.md](TESTING.md)). If something here doesn't match what you see, trust what you observe and open an issue — don't assume the doc is right and your install is broken.

## 1. Opening the office

After `install.ps1`, `setup.ps1`, and `start.ps1` have run (see [../INSTALLATION.md](../INSTALLATION.md)):

- **3D mode** (default, needs WebGL): `http://127.0.0.1:3200/office`
- **2D mode** (Phaser fallback for low-GPU machines): same URL, with a toggle in the UI.

Log in with the owner credential `setup.ps1` generated for you — never an old installation's token.

## 2. Selecting an agent

The office displays all 11 role-based agents (see [AGENT-ROLES.md](AGENT-ROLES.md)). On a fresh install, **Wave-1 agents (CEO, Backend Developer, QA Engineer, Security Reviewer) are active**; the remaining 7 (Wave-2) start in standby and must be explicitly activated — this is a deliberate default, not a bug, to avoid running all 11 agents in parallel on first boot. Click an agent in the office or the Agent Inspector panel to view its current state.

## 3. Assigning a task

Tasks route through Paperclip (the control plane) — see [API-REFERENCE.md](API-REFERENCE.md) for the real endpoint surface. A typical flow: select an agent (or address the CEO agent to delegate), describe the task in natural language, confirm the workspace scope is within your configured `workspace_allowlist` (see [CONFIGURATION.md](CONFIGURATION.md)) — the platform does not default to whole-drive access.

Example prompts (use only against a synthetic/authorized workspace):

- "CEO, susun rencana pengembangan fitur X untuk 2 minggu ke depan."
- "Backend Developer, buatkan unit test untuk modul Y."
- "QA Engineer, verifikasi perubahan pada PR #123."

See [README.md §10](../README.md#10-contoh-prompt) for more.

## 4. Calling a meeting

The brief's "11 agents in one meeting" feature has real underlying mechanism — pathfinding and Paperclip task delegation both exist in the vendored Hermes3D source, and 3D/2D share a common office-state layer (see [ARCHITECTURE.md](ARCHITECTURE.md)). **What is not yet confirmed**: a fully executed, evidenced multi-agent meeting from start to finish. Read [MEETING-GUIDE.md](MEETING-GUIDE.md) before relying on this feature for anything important — it describes exactly what's verified vs. not.

## 5. Viewing evidence and findings

- Security findings from VulnClaw surface read-only through Office Bridge (`GET /api/office-bridge/findings` — see [API-REFERENCE.md](API-REFERENCE.md)).
- Task evidence/history: `GET /api/office-bridge/evidence`.
- Overall platform health: `health.ps1`, or `ai-platform health` (see [../INSTALLER-REFERENCE.md](../INSTALLER-REFERENCE.md)).

## 6. Stopping / restarting

Use `stop.ps1` / `restart.ps1` / `health.ps1` at the repo root, or the `ai-platform` CLI. See [SERVICE-MANAGEMENT.md](SERVICE-MANAGEMENT.md) for exactly which scheduled tasks this installer manages (and, just as importantly, which 4 it never touches).
