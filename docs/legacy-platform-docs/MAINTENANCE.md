# COORDINATED DAILY MAINTENANCE & UPDATE POLICY

## 1. Schedule & Non-Disruption Rules
- **Daily Window:** **`03:00 Asia/Jakarta` (`WIB`)** via `\Hermes\PlatformMaintenance` (`integration\maintenance_coordinator.py`) and `\Hermes\HermesAutoUpdate` (`${ALLINONE_USER_HOME}\HermesUpdater`).
- **Offline Catch-Up:** `StartWhenAvailable = True` + slot tracking in `data\maintenance\state.json`. If `<machine-name>` is powered off at `03:00 WIB`, maintenance automatically catches up once the PC boots and network connectivity returns.
- **Active-Work Deferral:** Before applying any update, `maintenance_coordinator.py` checks Paperclip for queued/running heartbeat runs and active Hermes worker processes. If work is in progress, updates are safely deferred without interrupting execution.
- **Watchdog vs Updater Separation:** `\Hermes\PlatformHealthWatchdog` runs every `1 minute` strictly for local liveness & task reconciliation—it **never** polls upstream GitHub/npm updates every 60 seconds.

---

## 2. Component Update Policies
1. **Hermes Agent:** Managed exclusively by the official `${ALLINONE_USER_HOME}\HermesUpdater` preserving the Owner's explicit zero-backup setting (`BACKUP_ENABLED: false`). No second Hermes updater exists.
2. **Paperclip AI & VulnClaw:** Candidate tags validated against disk guard (`D: >= 2.00 GB`), compatibility gate, and post-update functional smoke check (`paperclip_status == "ok"`, `vulnclaw_version`, `hermes_unified_healthy`).
3. **Hermes3D & Office Bridge:** Maintained on isolated branch `integration/unified-ai-company` (`pinned upstream beb762927`). Never tracks unreviewed upstream `main` commits blindly. Post-maintenance smoke gate verifies `127.0.0.1:3210/health` (`200 OK`) and `127.0.0.1:3200/login` (`200 OK`).
4. **Maintenance Lock:** While `data\maintenance\maintenance.lock` is active, `OfficeServiceLauncher.exe`, `platform-watchdog.ps1`, and Office Bridge emit `MAINTENANCE` state and pause restart actions cleanly.
