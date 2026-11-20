# Service Management

Real, vendored lifecycle scripts at the repository root (built Phase 45, extended Phase 48):

| Script | Purpose | Scope |
|---|---|---|
| `start.ps1` | Starts the 4 platform-owned scheduled tasks if not already running | `PaperclipServer`, `OfficeVirtualCompany`, `PlatformHealthWatchdog`, `PlatformMaintenance` only |
| `stop.ps1` | Stops the same 4 tasks | same |
| `restart.ps1` | `stop.ps1` then a 3s pause then `start.ps1` | same |
| `health.ps1` | TCP/HTTP reachability check per configured port + scheduled-task `State` | reports PASS/FAIL/UNKNOWN per check, never silently reports healthy for something it didn't check |
| `uninstall.ps1` | Unregisters the 4 tasks; preserves data by default, requires `-DeleteData` + typed confirmation for destructive removal | same 4 tasks only |

None of these scripts touch `HermesAutoUpdate`, `Hermes_Gateway`, `HermesPostRebootVerify`, or
`cua-driver-serve` — those belong to the separately-installed `hermes-agent` upstream package. Verified
directly in each script's source (`$managedTasks` array) during this phase, not assumed.

## Unified CLI (`ai-platform`)

A real Python CLI exists at `integration/platform_cli.py` (renamed from `integrations/unified-cli/` in
this phase — see `STARTUP-RECOVERY.md` for why). Its actual subcommands, read directly from the
`argparse` setup rather than copied from the original brief:

```
ai-platform status            # alias of health
ai-platform health [--json]
ai-platform services [--json]
ai-platform agents   [--json]
ai-platform tasks    [--json]
ai-platform updates  [--json]
ai-platform logs [--tail N]
ai-platform telegram-cmd <command> [--args ...] [--caller-id ...] [--message-id ...] [--notify]
ai-platform emergency-stop
ai-platform resume-wave1
ai-platform run-maintenance [--force] [--dry-run]
```

This **matches** the brief's claimed `status/health/services/agents/tasks/updates` core set, and the
real CLI has additional real commands beyond what the brief mentioned (`logs`, `telegram-cmd`,
`emergency-stop`, `resume-wave1`, `run-maintenance`) — documented here because they exist in the
source, not invented.

**Known limitation, confirmed by actually running the command** (not assumed): `ai-platform health`
currently raises an unhandled `FileNotFoundError` instead of degrading gracefully if VulnClaw's pinned
virtual environment hasn't been created yet (it shells out to a venv-specific Python to read VulnClaw's
installed version). On a bare repository checkout — before the installer's dependency-resolution stage
has actually provisioned that venv — `ai-platform health`/`status` will not run to completion. This is
expected for an incomplete install, not a code regression, but it means these commands are only usable
after a real `install.ps1` dependency-install pass (Phase 52's job to exercise end-to-end).

## Singleton / crash-loop protection

See `STARTUP-RECOVERY.md` for the verified (not assumed) mutex name, PID-lock mechanism, and the real
backoff formula implemented in `automation/launchers/OfficeServiceLauncher.cs`.
