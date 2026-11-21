# Admin Guide

Operator-focused reference. For the end-user walkthrough, see [USER-GUIDE.md](USER-GUIDE.md).

## Install modes

`install.ps1 -Mode <Auto|Fresh|Adopt|Repair|Dev>` (default `Auto`, self-detecting via `scripts/lib/Preflight.psm1`'s `Get-AllinoneInstallMode`):

- **Fresh** — no existing ALLINONE-AGENT/Hermes/Paperclip installation detected.
- **Adopt** — detects an existing installation (Hermes home directory, platform scheduled tasks, or `ALLINONE_HOME` already set) and reuses it without duplicating services, databases, or scheduled tasks. This is the realistic path on a machine that has already run the platform.
- **Repair** — fixes dependency/configuration issues without removing active data.
- **Dev** — sets up a development environment.

Installation is idempotent: re-running without `-Force` does not duplicate anything already recorded complete in `runtime/install-state.json`. Always run `-DryRun` first to see the plan without making changes.

**Known limitation, stated plainly**: no mode has been run end-to-end on any machine yet — see [TESTING.md](TESTING.md).

## Service lifecycle

`start.ps1`, `stop.ps1`, `restart.ps1`, `health.ps1`, `update.ps1` — full flag reference in [../INSTALLER-REFERENCE.md](../INSTALLER-REFERENCE.md). Day-to-day operational detail (startup/crash recovery, singleton locking, backoff) is in [SERVICE-MANAGEMENT.md](SERVICE-MANAGEMENT.md) and [STARTUP-RECOVERY.md](STARTUP-RECOVERY.md).

## Scheduled-task ownership boundary

This is the single most important operational fact for an admin to internalize: this installer manages **exactly 4** scheduled tasks — `PaperclipServer`, `OfficeVirtualCompany`, `PlatformHealthWatchdog`, `PlatformMaintenance`. There are 4 more tasks on a typical reference machine (`HermesAutoUpdate`, `Hermes_Gateway`, `HermesPostRebootVerify`, `cua-driver-serve`) that belong to the separately-installed upstream `hermes-agent` package. **This installer's scripts — including `uninstall.ps1` — never touch those 4**, verified directly from source, not assumed. See [SERVICE-MANAGEMENT.md](SERVICE-MANAGEMENT.md).

## Health checks

`health.ps1` / `ai-platform health` check each configured port and each owned scheduled task's actual state — never silently report healthy for something not actually checked. See [API-REFERENCE.md](API-REFERENCE.md) for the CLI's full command surface.

## Uninstalling

`uninstall.ps1` stops and removes registration only for the 4 tasks this installer owns, preserves data by default, and requires an explicit `-DeleteData` flag plus typed confirmation before removing anything. Full detail: [UNINSTALL-GUIDE.md](UNINSTALL-GUIDE.md).

## Credential rotation

The reference installation's Telegram bot token and model API key are confirmed **not rotated** since a prior exposure (per the platform's own security audit — see [README.md §14](../README.md#14-security--privacy)). For your own fresh install:

1. Never reuse any value from an old installation's `config/platform.local.env` or Hermes home directory.
2. Generate a new Telegram bot via @BotFather if you want Telegram integration — see [../TELEGRAM-SETUP.md](../TELEGRAM-SETUP.md).
3. Generate a new model-provider API key from your provider's own panel.
4. Let `setup.ps1` write these into a fresh local `config/platform.local.env` — never hand-edit a copied-over old file.
5. If you adopt an existing installation (`-Mode Adopt`) that still has unrotated credentials, `install.ps1` warns about this but does not block adoption of an already-running system — rotation remains the operator's decision and action.

## Known operational gaps

- Office Bridge requires Node >= 22 (see [TROUBLESHOOTING.md](TROUBLESHOOTING.md)) — a pre-existing platform limitation, not introduced by this repo. Verified working on an isolated Node 22 install as of 2026-11-21 (see [TESTING.md](TESTING.md)).
- No live model-provider connectivity check exists in `setup.ps1` yet.
- **(Resolved 2026-11-21)** `npm audit` on Hermes3D: 24 dependency vulnerabilities (2 critical) have been fixed (0 remaining) — see [TESTING.md](TESTING.md) and `VULNERABILITY-REMEDIATION-REPORT.md`.
- A scheduled task's `State` (e.g. `PaperclipServer`) can decouple from whether the real underlying server process is actually alive and healthy — confirmed on the reference machine (see [TESTING.md](TESTING.md)). Use `health.ps1`'s HTTP endpoint checks as the authoritative signal for service availability; treat scheduled-task state as a secondary signal about restart-on-crash supervision specifically.
- 8 scripts (`start.ps1`, `stop.ps1`, `restart.ps1`, `health.ps1`, `uninstall.ps1`, `update.ps1`, `automation\platform-watchdog.ps1`, `automation\scheduled-tasks\register-platform-tasks.ps1`, `automation\scheduled-tasks\register-paperclip-task.ps1`) hardcode the exact reference task names (`PaperclipServer`, `OfficeVirtualCompany`, etc.) with no override parameter. This is safe for the realistic Adopt-Existing path (which reuses these exact names by design, and `install.ps1` deliberately never re-registers tasks in Adopt mode — see Stage 7 in its own output). It would matter if this repo is ever extended to support multiple side-by-side instances on one machine, or a Fresh install that intentionally uses different task names — not needed for anything tested in this pass, but worth knowing before building on top of it.

## Per-agent status (reference install)

Querying the real production Paperclip company (read-only, via the existing Board API key) on 2026-11-21 showed 10 of 11 agents `idle` (healthy) and **CEO Agent in `error` status**, caused by an interrupted Hermes Agent self-update:

```
hermes: source-update completion failed: an update is still running; wait for it to exit,
then relaunch Hermes; running with the previous dependencies - run `hermes update` to finish it
```

This is a **Hermes Agent-level issue, outside this repository's scope** — it is caused by Hermes Agent's own update mechanism (`C:\Users\<user>\HermesUpdater\`), not by anything in ALLINONE-AGENT. It was not remediated as part of this effort. If you see this, run `hermes update` yourself (per the error message) to let the interrupted update finish, then check the agent's status again via the Paperclip dashboard or API.
