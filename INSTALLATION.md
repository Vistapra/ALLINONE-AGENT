# ALLINONE-AGENT — Installation

> Status: these scripts exist and are statically parse-validated plus smoke-tested for their
> read-only preflight checks (Phase 45). They have **not** been run end-to-end on a real machine
> yet — that is Phase 52's job. Do not assume every stage below actually completes successfully
> until Phase 52's fresh-install test report says so.

## Quick start

```powershell
git clone https://github.com/Vistapra/ALLINONE-AGENT.git
cd ALLINONE-AGENT
.\install.ps1 -DryRun       # see the plan first, makes no changes
.\install.ps1               # actually install
.\setup.ps1                 # first-run configuration wizard
.\start.ps1
.\health.ps1
```

Or via the batch wrapper (no PowerShell execution-policy change required):

```text
install.cmd
```

## What `install.ps1` actually does, stage by stage

1. **Preflight** — Windows version/edition, RAM (informational only, no hard minimum),
   disk space, Node >= 22.0.0 / Git / Python presence (hard requirement, checked by version,
   not just presence), port availability (3100/54329/3200/3210, all configurable), network
   reachability to github.com.

   **Why Node >= 22, not 20**: Office Bridge's VulnClaw-findings adapters use the `node:sqlite`
   built-in, which requires Node 22.5+; on Node 20 those adapters fail to load at all
   (confirmed during Phase 49 build verification, and confirmed to be true of the original
   platform too, not something this repo introduced). Several Hermes3D dependencies also
   warn (`EBADENGINE`) wanting `^22.x`. If your machine only has Node 20.x, Preflight will
   report a hard `Fail` for Node — this is intentional, not a bug.
2. **Install Plan** — prints what will happen; `-DryRun` stops here with no changes.
3. **Mode detection** — `Fresh`, `Adopt` (an existing Hermes/Paperclip/ALLINONE install is
   detected — this is the realistic path on a machine that already runs the platform),
   `Repair`, or `Dev`. Override with `-Mode`.
4. **Dependency resolution & upstream retrieval** — clones Paperclip/VulnClaw at their pinned
   commits (`upstream\components.lock.json`) in Fresh mode only; Hermes3D is vendored in this
   repo already (`apps\hermes3d\`), not cloned; Hermes Agent itself is left to you to install via
   `npm install -g hermes-agent@<version>` (this installer does not install global npm packages
   without your explicit action).
5. **Local configuration** — copies `.example` templates to real local config files **only if
   they don't already exist** (never overwrites an adopted config). This is a minimal Phase-45
   config set; run `.\setup.ps1` afterward for the full interactive wizard (owner auth
   generation, model provider, optional Telegram, workspace allowlist).
6. **Database initialization — `[STUB]`**. Not yet scripted. The reference install's PostgreSQL
   instance is managed outside this installer; a real embedded-Postgres bootstrap is future work.
7. **Agent & office provisioning** — role templates are already present
   (`agents\roles\*\`); actually materializing live agent identities
   (`integration\org_provisioner.py`) is intentionally **not** run automatically —
   review `config\organization-roster.json` first, then run it yourself.
8. **Scheduled tasks** — in Fresh/Repair mode, points you at
   `automation\scheduled-tasks\register-platform-tasks.ps1` and `register-paperclip-task.ps1`
   rather than auto-running them (registering scheduled tasks is a system-wide change this
   installer does not take without you reviewing the script first). Adopt mode leaves existing
   tasks untouched.
9. **Health verification & report** — writes `$ALLINONE_HOME\runtime\installation-report.md`
   with next steps and the application URLs.

Idempotent: re-running `install.ps1` without `-Force` skips stages already recorded in
`$ALLINONE_HOME\runtime\install-state.json`.

## Lifecycle scripts

| Script | Purpose |
|---|---|
| `start.ps1` / `stop.ps1` / `restart.ps1` | Start/stop/restart only the tasks this installer manages: `PaperclipServer`, `OfficeVirtualCompany`, `PlatformHealthWatchdog`, `PlatformMaintenance`. Never touches Hermes Agent's own tasks. |
| `health.ps1` | PASS/FAIL/UNKNOWN table for managed tasks, upstream Hermes tasks (informational), and the three HTTP endpoints. Never reports healthy for something it didn't check. |
| `update.ps1` | Triggers the `PlatformMaintenance` task on demand. Does **not** reimplement Hermes Agent's own updater — that's `automation\updater\hermes-autoupdate.ps1` and its own scheduled task. |
| `uninstall.ps1` | Stops/unregisters only this project's own tasks. Preserves data by default; `-DeleteData` requires typed `DELETE` confirmation. |

## Application URLs (defaults)

- Paperclip: http://127.0.0.1:3100
- Hermes3D (3D/2D office): http://127.0.0.1:3200/office
- Office Bridge: http://127.0.0.1:3210

All three ports are configurable (see `config\platform.local.env.example` and each script's
parameters) — these are the reference install's defaults, not hardcoded requirements.

## Credential rotation — read this before using an adopted installation

If you're adopting an existing installation, `setup.ps1` will warn you if it detects the
Telegram bot token or model API key have not been rotated since any prior exposure. This
installer never reads or copies your existing live `.env`/`auth.json`/`config.yaml` as a
template — it always starts local config from the sanitized `.example` files. See
`CREDENTIAL-ROTATION-STATUS.md` (local audit artifact, not part of this repo) and
`docs/TELEGRAM-SETUP.md` / `docs/MODEL-PROVIDER-GUIDE.md` (Phase 50) for rotation instructions.

## See also

- `INSTALLER-REFERENCE.md` — every script's parameters.
- `upstream/components.lock.json` — pinned upstream versions.
- `docs/legacy-platform-docs/INSTALLATION.md` — the original reference-machine installation
  narrative (superseded by this document, kept for historical/forensic reference only).
