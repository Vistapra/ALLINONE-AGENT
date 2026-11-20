# Startup, Supervisor & Crash-Recovery Architecture

This document describes the **real, vendored** automation under `automation/` and the lifecycle
scripts at the repo root (`start.ps1`, `stop.ps1`, `restart.ps1`, `health.ps1`). It supersedes
`docs/legacy-platform-docs/STARTUP-RECOVERY.md` (kept for historical reference only — a few of its
numbers do not match the actual vendored source; see "Corrections vs. the legacy doc" below).

## 1. Task ownership boundary

This repository's installer (`install.ps1`/`uninstall.ps1`/`start.ps1`/`stop.ps1`) manages **exactly
four** Windows Scheduled Tasks:

| Task | Registered by | Launcher |
|---|---|---|
| `PaperclipServer` | `automation/scheduled-tasks/register-paperclip-task.ps1` | `automation/launchers/PaperclipServiceLauncher.cs` |
| `OfficeVirtualCompany` | `automation/scheduled-tasks/register-platform-tasks.ps1` | `automation/launchers/OfficeServiceLauncher.cs` |
| `PlatformHealthWatchdog` | `automation/scheduled-tasks/register-platform-tasks.ps1` | `automation/watchdog/platform-watchdog.ps1` |
| `PlatformMaintenance` | `automation/scheduled-tasks/register-platform-tasks.ps1` | `integration/maintenance_coordinator.py` |

Four other tasks exist on the reference machine but belong to the **upstream `hermes-agent`
npm package's own installer**, not to this repository, and are never touched by any script here:
`HermesAutoUpdate`, `Hermes_Gateway`, `HermesPostRebootVerify`, `cua-driver-serve`.

**Note on `Hermes_Gateway` / `HermesGatewayLauncher.cs`**: this source file does genuinely exist
(`%LOCALAPPDATA%\hermes\gateway-service\HermesGatewayLauncher.cs` on a real Hermes Agent
installation), so the brief's reference to it was not fabricated — but it is part of Hermes Agent's
own install footprint (sits alongside its own `.vbs`/`.cmd` wrapper, managed by Hermes Agent's own
updater), not custom ALLINONE-AGENT code. Per the ownership boundary above, it is deliberately **not**
vendored into this repository, for the same reason the other three Hermes-Agent-owned tasks aren't.
Likewise, `cua-driver-serve`'s actual driver binary is resolved by `automation/updater/CuaDriverProxy.cs`
(vendored here as a reference tool, since it was found alongside the updater scripts) — this proxy is a
support utility for Hermes Agent's own Computer-Use driver, not a service this repo's installer registers.

## 2. Boot chain (as implemented, Fresh/Repair mode)

```text
Scheduled Tasks (registered by register-platform-tasks.ps1 / register-paperclip-task.ps1)
 ├── PaperclipServer      -> PaperclipServiceLauncher.exe -> PostgreSQL + Paperclip (configurable ports,
 │                           default 54329 / 3100)
 ├── OfficeVirtualCompany -> OfficeServiceLauncher.exe:
 │     1. Acquires Named Mutex `Local\OfficeVirtualCompany_Singleton`
 │     2. Waits for Paperclip readiness (`/api/health`)
 │     3. Launches Office Bridge (default port 3210), writes a PID lock
 │     4. Waits for Bridge readiness (`/health`)
 │     5. Launches Hermes3D production server (default port 3200)
 └── PlatformHealthWatchdog (every 1 minute) -> runs automation/watchdog/platform-watchdog.ps1
```

`PlatformMaintenance` runs on its own daily schedule (see `docs/MAINTENANCE.md`), independent of the
minute-interval watchdog above.

## 3. Self-healing & crash-loop protection (verified against actual source, not assumed)

- **Child crash recovery**: `OfficeServiceLauncher.cs` restarts a crashed Office Bridge or Hermes3D
  child process with an exponential-ish backoff: `3 * 2^min(quick_fails, 3)` seconds, capped at 30s,
  escalating to a 180s cooldown after 6 quick failures in a row (see `WriteLauncherState` / the restart
  loop around line 290-340 of `OfficeServiceLauncher.cs`).
- **Singleton enforcement**: OS named mutex (`Local\OfficeVirtualCompany_Singleton`) plus a PID lock
  file for the Office Bridge child process.
- **Fault isolation**: a crash in Hermes3D or Office Bridge never stops or restarts Paperclip — they
  are independent scheduled tasks.
- **Watchdog-level recovery** (`platform-watchdog.ps1`, runs every minute via `PlatformHealthWatchdog`):
  re-triggers a stopped `PaperclipServer`/`OfficeVirtualCompany` task via Task Scheduler; if the task
  is "running" but the HTTP health endpoint doesn't respond twice in a row and the process has been
  up ≥1.5 minutes, force-kills the wedged `node.exe` child so the launcher's own restart logic takes
  over. The watchdog itself backs off via a maintenance-lock check (skips entirely if a maintenance
  cycle has run in the last 90 minutes) rather than fighting an in-progress update.

### Corrections vs. the legacy doc

- The legacy doc names the mutex `Local\UnifiedAICompanyOfficeSupervisorMutex`; the actual vendored
  source (`OfficeServiceLauncher.cs`) uses `Local\OfficeVirtualCompany_Singleton`. This document uses
  the real, verified name.
- The legacy doc states a fixed backoff sequence (`2s -> 4s -> 8s -> 16s -> 30s`); the actual source
  implements a different (but comparable) formula — see above. Verified by reading the restart loop
  directly, not assumed from the doc.

### A real structural bug found and fixed in this phase

`platform-watchdog.ps1` (and `integration/maintenance_coordinator.py`, `integration/platform_cli.py`,
and 4 other modules) all import each other as `integration.<module>` — i.e., they require a Python
package literally named `integration` sitting directly under `$ALLINONE_HOME`. Phase 43 vendored these
same files under `integrations/unified-cli/` instead (plural, nested). This is a silent bug: every file
involved still passes `py_compile` (which only checks syntax, not whether an import target exists), but
every real invocation of `ai-platform status`/`health`, the watchdog's health-snapshot write, and
`maintenance_coordinator` would have failed with `ModuleNotFoundError` on a fresh install. **Fixed in
this phase** by renaming `integrations/unified-cli/` back to `integration/` (matching the reference
machine's real, original layout and every internal import statement) and updating the handful of
docs/config files that referenced the old path. Verified by actually importing all 8 modules with
`ALLINONE_HOME` pointed at this repo — all succeed. See `PHASE-48-lifecycle-packaging.md` for the full
verification transcript.

## 4. What is NOT yet proven

- None of the scripts above have been executed end-to-end against a live install in this phase —
  only static parsing (Phase 45), module-import verification (this phase), and the pre-existing
  read-only Preflight smoke test (Phase 45) have actually run. Full orchestrated execution is Phase 52.
- `ai-platform health`/`status` will currently raise an unhandled exception rather than degrade
  gracefully if VulnClaw's pinned venv hasn't been created yet (it shells out to a venv-specific
  Python interpreter to read VulnClaw's version) — confirmed by actually running the command against
  this bare repo checkout. This is expected on an incomplete install, not a regression, but it means
  the CLI is not usable for health checks until the dependency-install stage (Phase 45's
  "Dependency resolution" stage, exercised for real in Phase 52) has actually run.
