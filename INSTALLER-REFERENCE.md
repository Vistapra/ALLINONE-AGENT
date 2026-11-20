# ALLINONE-AGENT — Installer Script Reference

## `install.ps1`

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `-InstallPath` | string | `$env:ALLINONE_HOME` or `$HOME\ALLINONE-AGENT` | Root install directory. |
| `-Mode` | `Auto`\|`Fresh`\|`Adopt`\|`Repair`\|`Dev` | `Auto` | `Auto` detects via `Get-AllinoneInstallMode` (checks for an existing Hermes home dir, globally installed `hermes-agent` npm package, and registered platform scheduled tasks). |
| `-DryRun` | switch | off | Prints the plan and preflight results; makes zero changes. |
| `-Force` | switch | off | Re-runs stages already marked completed in `install-state.json`. |
| `-NonInteractive` | switch | off | Reserved for future prompts; `install.ps1` itself does not currently prompt (that's `setup.ps1`'s job). |

Exit codes: `0` success/dry-run, `1` blocking preflight failure.

Supports `-WhatIf` (via `SupportsShouldProcess`) on every mutating step (directory creation,
clones, config writes, task registration pointers).

## `install.cmd`

Thin wrapper: `install.cmd <args passed through to install.ps1>`. Sets
`-ExecutionPolicy Bypass` for its own process only.

## `setup.ps1`

| Parameter | Type | Notes |
|---|---|---|
| `-NonInteractive` | switch | Requires `-ConfigFile`; fails fast on any missing required field instead of prompting. |
| `-ConfigFile` | string | JSON with keys: `InstallPath`, `ModelApiBaseUrl`, `ModelName`, `EnableTelegram`, `TelegramBotToken`, `TelegramOwnerId`, `WorkspaceAllowlist` (array). |
| `-InstallPath` | string | Overrides the resolved `ALLINONE_HOME` for this run. |

Generates a fresh local owner-authentication token every run it's asked to (never reuses an old
one), writes `config\platform.local.env` and `config\workspace-allowlist.json`. Refuses to add an
entire drive root (e.g. `D:\`) to the workspace allowlist. Does not perform live provider or
Telegram API verification yet (marked `[NOT VERIFIED]` in its own output).

## `start.ps1` / `stop.ps1` / `restart.ps1`

No required parameters. Operate only on `PaperclipServer`, `OfficeVirtualCompany`,
`PlatformHealthWatchdog`, `PlatformMaintenance`. Use a singleton lock at
`$ALLINONE_HOME\runtime\allinone-agent.lock` (separate from, and never touching, Hermes Agent's
own internal lock files).

## `health.ps1`

| Parameter | Type | Default |
|---|---|---|
| `-PaperclipPort` | int | 3100 |
| `-Hermes3dPort` | int | 3200 |
| `-OfficeBridgePort` | int | 3210 |

Exit code `1` if any ALLINONE-managed task or endpoint check reports `FAIL`; `0` otherwise.
Upstream Hermes tasks are reported for information only and never affect the exit code.

## `update.ps1`

| Parameter | Type | Notes |
|---|---|---|
| `-CheckOnly` | switch | Reports `PlatformMaintenance` task state without triggering it. |

Triggers `PlatformMaintenance` on demand for Paperclip/VulnClaw/Office Bridge/Hermes3D updates.
Deliberately does not touch Hermes Agent's own updater or its scheduled task.

## `uninstall.ps1`

| Parameter | Type | Notes |
|---|---|---|
| `-DeleteData` | switch | Also offers to delete `$ALLINONE_HOME\data` and `\config`. Requires typing `DELETE` at a follow-up prompt - the switch alone does not delete anything. |

Only ever stops/unregisters the four tasks this project registers. Leaves upstream checkouts
under `upstream-checkouts\` and the global `hermes-agent` npm package untouched.

## Shared modules

- `scripts\lib\Preflight.psm1` — `Test-AllinoneOsCompatibility`, `Test-AllinoneHardware`,
  `Test-AllinoneDiskSpace`, `Test-AllinoneCommandPresent`, `Test-AllinonePortAvailable`,
  `Test-AllinoneNetworkConnectivity`, `Get-AllinoneInstallMode`. All read-only.
- `scripts\lib\InstallState.psm1` — `Get-AllinoneHome`, `Read-AllinoneInstallState`,
  `Save-AllinoneInstallState`, `Test-AllinoneStageCompleted`, `Add-AllinoneCompletedStage`,
  `Enter-AllinoneSingletonLock`, `Exit-AllinoneSingletonLock`, `Get-AllinoneLockFilePath`,
  `Get-AllinoneStateFilePath`.

Both modules were verified in Phase 45 via `Import-Module` (successful load, all expected
functions exported) and, for the read-only `Preflight` functions, an actual invocation against
the reference machine - not just static parsing. See `PHASE-45-windows-installer.md` for the
captured output.
