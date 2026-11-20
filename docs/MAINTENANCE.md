# Maintenance

Real schedule semantics, cross-checked between `config/maintenance.example.json` and the actual
`integration/maintenance_coordinator.py` source (not assumed to agree — verified by grep in this phase):

- **Window**: `03:00 Asia/Jakarta` by default, configurable via `config/maintenance.local.json`
  (copy of the `.example` template).
- **Offline catch-up**: if the machine is off at the scheduled window, maintenance runs once it's back
  online. Real source confirms a `>= 600` second grace/catch-up check (`is_catchup` logic in
  `maintenance_coordinator.py`).
- **Active-work deferral**: before applying any update, the coordinator checks Paperclip for
  queued/running work and defers rather than interrupting it (`DEFERRED` state, confirmed in source).
- **Maintenance lock**: a lock file prevents the watchdog (`PlatformHealthWatchdog`, every 1 minute)
  from fighting an in-progress maintenance cycle — confirmed both in `maintenance_coordinator.py` and
  independently in `automation/watchdog/platform-watchdog.ps1`.
- **Component update policy**, read directly from source, not invented:
  - `hermes_agent`: **exclusively managed by the official HermesUpdater** (or whatever updater ships
    with Hermes Agent) — `update.ps1` in this repository deliberately does not duplicate it.
  - `paperclip` / `vulnclaw`: candidate version bumps go through a disk-space guard, a compatibility
    gate, and a post-update smoke check before being considered applied.
  - `hermes3d` / `office-bridge`: tracked on a pinned branch only (this repo's own vendored customization,
    not auto-updated from upstream without review).

## On the brief's "no-backup" policy

The brief notes the existing installation's Hermes Agent updater runs with a deliberate `--no-backup`
policy the owner already chose for that specific installation, and warns not to apply that policy
automatically to new installs or other databases. Confirmed in source: this phase found no evidence
that `maintenance_coordinator.py`'s handling of Paperclip/VulnClaw/Hermes3D updates defaults to
no-backup — the no-backup choice is scoped to Hermes Agent's own updater, which this repository
explicitly does not touch or reconfigure (see `component_update_policy.hermes_agent.managed_by` above).

This document supersedes `docs/legacy-platform-docs/MAINTENANCE.md` (kept for historical reference).
