# Agent Roles — ALLINONE-AGENT

Canonical, current reference for the 11 agent roles. Supersedes `docs/legacy-platform-docs/AGENT-ROLES.md`,
which is kept only as a historical/redacted reference and is **not** authoritative — its wave/status
column was found to be stale against the real provisioning logic in `integration/org_provisioner.py`
(see "Activation wave" below).

All identities below (Paperclip agent IDs, company ID, Hermes profile paths) are **generated fresh on every
install** by `org_provisioner.py` + `hermes_worker_factory.py`. Nothing in this repository hardcodes a
production identity; see `agents/roles/organization-roster.example.json` for the shape of what gets generated,
with `<generated-at-install-time>` placeholders in place of real IDs.

## The 11 roles

| # | Role slug | Title | Reports to | Activation wave | Monthly budget |
|---|---|---|---|---|---|
| 1 | `ceo_agent` | Chief Executive Officer — Planning & Delegation | — | **Wave-1 (active)** | 2500¢ |
| 2 | `cto_agent` | Chief Technology Officer — Architecture & Standards | ceo_agent | Wave-2 (standby) | 1500¢ |
| 3 | `backend_developer` | Senior Full-Stack / Backend Software Engineer | ceo_agent | **Wave-1 (active)** | 3000¢ |
| 4 | `frontend_developer` | Senior Frontend & UI Engineer | cto_agent | Wave-2 (standby) | 1500¢ |
| 5 | `devops_engineer` | Senior DevOps & Runtime Diagnostics Engineer | cto_agent | Wave-2 (standby) | 1500¢ |
| 6 | `qa_engineer` | Lead Quality Assurance & Regression Engineer | ceo_agent | **Wave-1 (active)** | 2000¢ |
| 7 | `security_lead` | Defensive Security Architecture Lead | ceo_agent | Wave-2 (standby) | 1500¢ |
| 8 | `security_reviewer` | Defensive Code & Findings Security Reviewer | ceo_agent | **Wave-1 (active)** | 2000¢ |
| 9 | `findings_analyst` | Security Findings Triage & Deduplication Analyst | security_lead | Wave-2 (standby) | 1000¢ |
| 10 | `remediation_reviewer` | Security Remediation & Regression Verifier | security_lead | Wave-2 (standby) | 1000¢ |
| 11 | `compliance_reporter` | Audit Evidence & Acceptance Compliance Specialist | ceo_agent | Wave-2 (standby) | 1000¢ |

### Activation wave

**Wave-1 (active on fresh install): CEO Agent, Backend Developer, QA Engineer, Security Reviewer.**
**Wave-2 (standby, activated later): the remaining 7 roles.**

This is defined in exactly one place — the `active_initially` flag per role in
`integration/org_provisioner.py` — and verified directly against that source for this doc
(not assumed from the original brief). It also matches the original brief's claimed split exactly.

**Correction made in this pass:** `agents/roles/organization-roster.example.json` (an illustrative snapshot,
not itself read back by any code) previously showed `devops_engineer` and `security_lead` with
`"status": "idle"` (i.e. Wave-1/active), which contradicted `org_provisioner.py`'s actual
`active_initially: False` for both. Fixed to `"status": "paused"` to match the real provisioning logic.

## Per-role template layout

Each `agents/roles/<role>/` directory contains:
- `AGENTS.md` — the role's instructions/SOUL document. Content mirrors what
  `hermes_worker_factory.py` actually generates (reporting hierarchy, authorized workspace, permitted
  toolsets, prohibited actions, budget/timeout/turn limits), with real paths expressed as the portable
  `${ALLINONE_HOME}` / `${ALLINONE_HERMES_HOME}` placeholders the installer resolves at runtime.
- `role-manifest.json` — an **illustrative example** of the manifest `hermes_worker_factory.py` writes to
  disk during real provisioning. This file is write-only in the real system (nothing parses it back), so it
  is shipped here purely as a reference, not as a config template consumed by any script.
  **Correction made in this pass:** all 11 copies had a corrupted `hermes_home`/`hermes_exe` value — a
  prior redaction pass had both double-escaped the path separators and left a dead literal
  `<owner-username>` token in place of a real value. Fixed to `${ALLINONE_HERMES_HOME}\...`, consistent
  with the file's own `instructions_file`/`authorized_workspace` fields.

## Workspace authorization

Every role's `authorized_workspace` is `${ALLINONE_HOME}/workspaces` by default — there is no default that
grants access to an entire drive or to any path outside the platform's own workspace root. Per-installation
overrides are configured via `config/permissions.example.json` (see Phase 46), not by editing these role
templates.

## Fresh-install identity generation (verified, not assumed)

`org_provisioner.py::provision_organization()`:
1. Looks up (or creates, if none exists) a Paperclip company named "Unified AI Engineering & Operations" —
   `pc.get_primary_company()` creates a brand-new company via `POST /api/companies` when none exists yet,
   so a genuinely fresh Paperclip instance gets a fresh `company_id`, never a hardcoded one.
2. Creates each of the 11 agents via `POST /api/companies/{id}/agents`, which returns a server-assigned
   agent ID — again, never a hardcoded value.
3. Writes the resulting non-secret directory map to `config/organization-roster.json` (the real,
   machine-local counterpart of this repo's `.example` file).

One pre-existing robustness note, out of scope to fix in this pass: `get_primary_company()` falls back to
"return the first existing company" if a Paperclip instance already has companies under a *different* name —
on a shared/non-empty Paperclip instance this could silently attach the ALLINONE-AGENT roster to the wrong
company. Fine for a dedicated fresh install; worth hardening before Phase 52 acceptance testing on a
non-empty Paperclip instance.

See `docs/AGENT-PROVISIONING.md` for the full provisioning flow and `docs/OFFICE-LAYOUT.md` for how these
roles map onto the 3D/2D office.
