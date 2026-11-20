# PHASE 33 — STARTUP, RECOVERY & COORDINATED MAINTENANCE

- **Final Phase Status:** `PASS` (`100% PASS` including live cold-boot physical OS reboot `J10` verified at `LastBootUpTime = 2026-11-20T07:43:33+07:00` and autonomous `03:00 WIB` maintenance slot `2026-11-20T03:00:00+07:00`)
- **Executed At:** `2026-11-19` / Post-Reboot Verified `2026-11-20T07:57+07:00`

## 1. Objective
Integrate Office Bridge (`127.0.0.1:3210`) and Hermes3D (`127.0.0.1:3200`) into the Windows Task Scheduler startup, crash self-healing, watchdog, and `03:00 Asia/Jakarta` daily + offline catch-up maintenance lifecycle without Administrator/SYSTEM elevation or disrupting active work.

## 2. Prerequisites
- Existing Scheduled Tasks (`\Hermes_Gateway`, `\cua-driver-serve`, `\Hermes\HermesAutoUpdate`, `\Hermes\PaperclipServer`, `\Hermes\PlatformHealthWatchdog`, `\Hermes\PlatformMaintenance`) healthy.

## 3. Previous Phase Dependencies
- `PHASE-20-platform-preservation-audit.md`
- `PHASE-32-company-dashboard.md`

## 4. Current Condition
Paperclip runs under `PaperclipServiceLauncher.exe` (`\Hermes\PaperclipServer`). Maintenance runs daily at `03:00 Asia/Jakarta` with offline catch-up and active-work deferral via `integration/maintenance_coordinator.py`, while Hermes retains its official zero-backup updater (`BACKUP_ENABLED: false`).

## 5. Technical Analysis
Evaluated Windows user-level Task Scheduler (`InteractiveToken` / `LogonTrigger` for `<machine-name>\<owner-username>`, least privilege—no `SYSTEM` or `RunLevel Highest`), process dependency ordering (`Paperclip -> Office Bridge -> Hermes3D`), exponential backoff, crash-loop circuit breaking (`max 5 restarts / 10 min`), and maintenance lock deferral.

## 6. Architecture Decision
1. Compile a native windowless C# supervisor `${ALLINONE_HOME}\runtime\bin\OfficeServiceLauncher.exe` (`scripts\OfficeServiceLauncher.cs`) enforcing a system-wide Named Mutex (`Local\UnifiedAICompanyOfficeSupervisorMutex`), waiting for Paperclip readiness (`127.0.0.1:3100/api/health`), starting Office Bridge (`127.0.0.1:3210`) then Hermes3D (`127.0.0.1:3200`), monitoring child processes with exponential backoff (`2s..30s`) and crash-loop protection, and respecting `data\maintenance\maintenance.lock`.
2. Register `\Hermes\OfficeVirtualCompany` in Windows Task Scheduler under user `<owner-username>`.
3. Extend `scripts\platform-watchdog.ps1`, `integration\platform_cli.py`, and `integration\maintenance_coordinator.py` to monitor and validate Office Bridge & Hermes3D during the `03:00 WIB` / catch-up maintenance window while preserving `BACKUP_ENABLED: false` for Hermes.

## 7. Implementation Plan
1. Author & compile `scripts\OfficeServiceLauncher.cs` -> `runtime\bin\OfficeServiceLauncher.exe` and singleton PID lock in `office-bridge/server.js`.
2. Register & start `\Hermes\OfficeVirtualCompany`.
3. Update `platform-watchdog.ps1`, `platform_cli.py`, and `maintenance_coordinator.py`.
4. Inject crash recovery test (kill Office Bridge PID -> verify automatic recovery `<3s` and zero duplicate processes).

## 8. Actual Implementation
- Compiled `OfficeServiceLauncher.exe`, registered `\Hermes\OfficeVirtualCompany` (`State: Running`, `Enabled: True`), and updated watchdog, CLI, and maintenance coordinator.
- Verified crash self-healing: killing `office-bridge\server.js` PID resulted in `OfficeServiceLauncher.exe` automatically restarting and passing `/health` in `2 seconds` (`Office Bridge auto-healed in 2s!`).

## 9. Files Created
- `${ALLINONE_HOME}\scripts\OfficeServiceLauncher.cs`
- `${ALLINONE_HOME}\runtime\bin\OfficeServiceLauncher.exe`
- `${ALLINONE_HOME}\docs\PHASE-33-startup-maintenance.md`

## 10. Files Modified
- `${ALLINONE_HOME}\office-bridge\server.js`
- `${ALLINONE_HOME}\scripts\platform-watchdog.ps1`
- `${ALLINONE_HOME}\integration\platform_cli.py`
- `${ALLINONE_HOME}\integration\maintenance_coordinator.py`

## 11. Commands Executed
- `csc.exe /target:winexe /out:${ALLINONE_HOME}\runtime\bin\OfficeServiceLauncher.exe ${ALLINONE_HOME}\scripts\OfficeServiceLauncher.cs`
- `Start-ScheduledTask -TaskPath "\Hermes\" -TaskName "OfficeVirtualCompany"`
- `${ALLINONE_HOME}\ai-platform.cmd status --json`

## 12. Test Scenarios
- Verify `\Hermes\OfficeVirtualCompany` registered, enabled, and running without Administrator elevation.
- Attempt starting duplicate `office-bridge\server.js` -> exits immediately with `SINGLETON_ALREADY_RUNNING`.
- Terminate child Office Bridge process -> supervisor recovers service in `~2s`.
- Verify `03:00 Asia/Jakarta` schedule, offline catch-up, active-run deferral, and Hermes zero-backup policy (`BACKUP_ENABLED: false`) remain intact.
- Physical reboot (`J10`): intentionally not executed during active engineering session (`NOT_TESTED`).

## 13. Expected Results
Deterministic startup order, automatic crash recovery, zero duplicate processes, preserved `03:00 WIB` maintenance, honest `NOT_TESTED` status for physical reboot.

## 14. Actual Results
All 7 Scheduled Tasks enabled and healthy (`platform_state: "HEALTHY"`), crash recovery verified in `2s`, singleton locks verified, `J10` recorded transparently as `NOT_TESTED`.

## 15. Evidence
- `${ALLINONE_HOME}\data\last-health-snapshot.json` (`OfficeVirtualCompany: { state: 4, enabled: true }`)
- `${ALLINONE_HOME}\scripts\OfficeServiceLauncher.cs`

## 16. Root Cause (Issues Encountered)
`HERMES3D_GATEWAY_URL` without `HERMES3D_GATEWAY_TOKEN` in launcher environment caused `gateway-proxy.js` to omit upstream token fallback.

## 17. Corrective Actions
Updated `OfficeServiceLauncher.cs` to read `bridgeToken` from `office-bridge-auth.json` at launch and pass `HERMES3D_GATEWAY_TOKEN` in process environment (`0` secrets on command line).

## 18. Regression Test
Verified full WebSocket proxy handshake (`PROXY_CONNECT_OK: true, agents: 11`) and crash recovery.

## 19. Acceptance Criteria
- [x] Automatic logon startup configured (`\Hermes\OfficeVirtualCompany`).
- [x] Bounded service crash recovery verified (`~2s`).
- [x] Existing platform startup tasks healthy.
- [x] `03:00 WIB` + catch-up + deferral maintenance coordination verified (`2026-11-20T03:02:36+07:00` & `03:24:17+07:00` succeeded automatically).
- [x] Singleton uniqueness enforced (zero duplicate processes or restart loops).
- [x] Physical OS reboot (`J10` / `G10`) -> **`PASS`** (`LastBootUpTime: 2026-11-20T07:43:33+07:00`; all 8 Scheduled Tasks & all 12 Unified Health Matrix components came online automatically and windowless in the background).

## 20. Final Phase Status
`PASS`
