# Uninstall Guide

`uninstall.ps1` (repository root, built Phase 45, scope re-verified Phase 48):

1. Stops and unregisters **only** the 4 scheduled tasks this installer owns: `PaperclipServer`,
   `OfficeVirtualCompany`, `PlatformHealthWatchdog`, `PlatformMaintenance`. Confirmed directly in the
   script's `$managedTasks` array — it does not enumerate or touch any other scheduled task on the
   machine, including the 4 belonging to the separately-installed `hermes-agent` package.
2. **Preserves data by default.** Running `.\uninstall.ps1` with no flags removes only the task
   registrations this installer created; `data/`, `config/*.local.*`, and logs are left untouched.
3. Destructive data removal requires both an explicit `-DeleteData` switch **and** a typed
   confirmation prompt (not just a single `-Force` flag) before anything under `data/` is deleted.
4. Does not affect any other application on the machine, and does not touch Hermes Agent, its own
   updater, or its own scheduled tasks.

## What this does NOT do

- Does not uninstall Hermes Agent, Paperclip, or VulnClaw themselves (those are separate,
  independently-installed/updated components this repository only orchestrates, per
  `upstream/components.lock.json`).
- Does not revoke or rotate any credentials — if you're decommissioning an installation, rotate your
  Telegram bot token and any API keys separately (see `docs/TELEGRAM-SETUP.md` /
  `docs/MODEL-PROVIDER-GUIDE.md`).

Not executed end-to-end in this phase (would affect a real live installation) — static review and
scope verification only. Full uninstall/reinstall testing is Phase 52's job.
