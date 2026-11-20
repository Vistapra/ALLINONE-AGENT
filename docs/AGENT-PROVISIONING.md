# Agent Provisioning — ALLINONE-AGENT

How the 11-agent organization gets created on a fresh install, and what is/isn't safe to redistribute.

## What's shipped vs. what's generated

| Shipped in this repo | Generated fresh at install/provisioning time |
|---|---|
| `agents/roles/<role>/AGENTS.md` — role instructions (portable, uses `${ALLINONE_HOME}` / `${ALLINONE_HERMES_HOME}`) | Real Paperclip company ID and 11 agent IDs (`org_provisioner.py`) |
| `agents/roles/<role>/role-manifest.json` — illustrative example only, **not** read by any code | Real per-role Hermes profile directories under `${ALLINONE_HERMES_HOME}/profiles/<profile_id>` (`hermes_worker_factory.py`) |
| `agents/roles/organization-roster.example.json` — shape reference with `<generated-at-install-time>` placeholders | The real `config/organization-roster.json` (non-secret directory map) |
| — | Per-agent Paperclip API keys, minted and bound once into each isolated Hermes profile's own `.env` (never written to the shared/shipped config) |

## Provisioning flow

1. `install.ps1` (Phase 45) calls into `integration/org_provisioner.py` as an explicit, reviewable
   step — it is **not** auto-run silently as part of a generic install stage.
2. `org_provisioner.py` gets-or-creates the Paperclip company, then for each of the 11 role specs:
   - Creates the agent via the Paperclip API (fresh server-assigned ID).
   - Sets budget policy, initial status (`idle` for Wave-1, `paused` for Wave-2 — see `docs/AGENT-ROLES.md`),
     and permission flags (`canCreateAgents: false` always; `canAssignTasks` only for `ceo_agent`,
     `cto_agent`, `security_lead`).
   - Calls `hermes_worker_factory.py` to materialize the role's isolated Hermes profile directory, write its
     `SOUL.md` / `AGENTS.md`, and bind a freshly-minted agent-scoped Paperclip API key into that profile's own
     `.env` (via `bind_agent_paperclip_key`) — keys are never shared across roles and never written into the
     repo-level config.
   - Writes the non-secret roster map to `config/organization-roster.json`.
3. None of the 11 agents are started as part of this step. Wave-1 agents are created with Paperclip status
   `idle` (ready, not yet given a task); Wave-2 agents are created `paused`. Actually running inference is a
   separate, explicit action (Phase 52/53 territory), never implied by provisioning alone.

## Exclusions enforced in this pass

Per `PUBLICATION-EXCLUSIONS.md` (binding), the following were confirmed **not** present in any file this
phase touched or added:
- Any current/live agent session state, task history, or private project context.
- Any real Paperclip company/agent UUID (checked against all 12 known real UUIDs from the live
  `D:\AI-Agent-Platform\AGENT-ROLES.md` reference — zero matches in the repo's `agents/` tree).
- Any real Hermes profile credentials, owner conversation history, or private memory content.

## Known gap (not fixed in this pass, flagged for Phase 52)

`get_primary_company()`'s "attach to the first existing company if the named one isn't found" fallback (see
`docs/AGENT-ROLES.md`) should be hardened — e.g. fail loudly instead of silently attaching — before relying
on this in an "Adopt Existing" scenario where Paperclip already has unrelated companies provisioned.
