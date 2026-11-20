# STARTUP, SUPERVISOR & CRASH RECOVERY ARCHITECTURE

## 1. Dependency Boot Chain (Windows Logon, Least Privilege User `<owner-username>`)

```text
Windows Logon (<machine-name>\<owner-username>)
 ├── \Hermes_Gateway             -> Telegram CODEXE & Hermes Gateway
 ├── \cua-driver-serve           -> Interactive Desktop Computer Use Driver
 ├── \Hermes\PaperclipServer     -> PaperclipServiceLauncher.exe -> PostgreSQL (54329) + Paperclip (3100)
 ├── \Hermes\OfficeVirtualCompany-> OfficeServiceLauncher.exe:
 │     1. Acquires Named Mutex `Local\UnifiedAICompanyOfficeSupervisorMutex`
 │     2. Waits for Paperclip readiness (`127.0.0.1:3100/api/health`)
 │     3. Launches Office Bridge (`127.0.0.1:3210`, PID lock `office-bridge.pid`)
 │     4. Waits for Bridge readiness (`127.0.0.1:3210/health`)
 │     5. Launches Hermes3D Production Server (`127.0.0.1:3200`)
 └── \Hermes\PlatformHealthWatchdog (Every 1 minute) -> Monitors & self-heals wedged children
```

---

## 2. Self-Healing & Crash-Loop Protections
- **Child Crash Recovery:** If `office-bridge\server.js` or `hermes3d\source\server\index.js` exits unexpectedly, `OfficeServiceLauncher.exe` automatically restarts it with exponential backoff (`2s -> 4s -> 8s -> 16s -> 30s`), recovering `/health` in **`~2 seconds`** during live fault-injection testing.
- **Crash-Loop Circuit Breaker:** Capped at `5` restarts within any `10-minute` rolling window to prevent CPU thrashing; logs diagnostic details to `${ALLINONE_HOME}\logs\office-supervisor.log`.
- **Singleton Enforcement:** Dual-guarded by OS Named Mutex (`OfficeServiceLauncher.exe`) and `office-data\office-bridge.pid` (`SINGLETON_ALREADY_RUNNING`).
- **Fault Isolation:** Stopping or crashing Hermes3D / Office Bridge **never** interrupts Paperclip, Hermes Workers, VulnClaw, or Telegram.

---

## 3. Physical Cold-Boot Verification (`J10` / `G10` — VERIFIED `PASS`)
- Verified on real host cold boot (`LastBootUpTime: 2026-11-20T07:43:33.5000000+07:00` on `<machine-name>`): all **8 Scheduled Tasks** (`\Hermes_Gateway`, `\cua-driver-serve`, `\Hermes\HermesAutoUpdate`, `\Hermes\HermesPostRebootVerify`, `\Hermes\PaperclipServer`, `\Hermes\OfficeVirtualCompany`, `\Hermes\PlatformHealthWatchdog`, `\Hermes\PlatformMaintenance`) started automatically and windowless (`CreateNoWindow` / `winexe`) in the background with **`12/12` Unified Health Matrix components `HEALTHY`** and zero manual intervention.
