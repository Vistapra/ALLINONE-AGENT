# ADMIN & OPERATIONS GUIDE — UNIFIED AUTONOMOUS AI COMPANY

## 1. Service Topology & Scheduled Tasks (User `<machine-name>\<owner-username>`)

| Scheduled Task | Role | Loopback Endpoint / Schedule |
| --- | --- | --- |
| `\Hermes_Gateway` | Single Telegram (`@YOUR_BOT_HANDLE_HERE`) consumer & Hermes gateway | Continuous logon service |
| `\cua-driver-serve` | Windows Computer Use GUI driver | Interactive desktop session |
| `\Hermes\PaperclipServer` | `PaperclipServiceLauncher.exe` -> Paperclip `v2026.1117.0` + PostgreSQL | `127.0.0.1:3100` (`PG: 54329`) |
| `\Hermes\OfficeVirtualCompany` | `OfficeServiceLauncher.exe` -> Office Bridge + Hermes3D | `127.0.0.1:3210` & `127.0.0.1:3200` |
| `\Hermes\PlatformHealthWatchdog` | `scripts\platform-watchdog.ps1` self-healing & atomic health snapshot | Every `1 minute` (health only, NOT updates!) |
| `\Hermes\PlatformMaintenance` | `integration\maintenance_coordinator.py` coordinated updates | Daily `03:00 Asia/Jakarta` + catch-up |
| `\Hermes\HermesAutoUpdate` | Official `${ALLINONE_USER_HOME}\HermesUpdater` (`BACKUP_ENABLED: false`) | Daily `03:00 Asia/Jakarta` + catch-up |

---

## 2. Routine Operational Commands

```powershell
# Full 12-component functional status & health JSON
${ALLINONE_HOME}\ai-platform.cmd status --json
${ALLINONE_HOME}\ai-platform.cmd health --json

# Emergency Stop (pause active Paperclip agents) & Resume Wave-1 (restore 4 Wave-1 agents)
${ALLINONE_HOME}\ai-platform.cmd emergency-stop
${ALLINONE_HOME}\ai-platform.cmd resume-wave1

# Run security boundary & bundle secret verification
python ${ALLINONE_HOME}\scripts\verify-security-boundaries.py

# Run Office Bridge unit + live integration suite
${ALLINONE_HOME}\runtime\bin\node26.cmd --test --test-force-exit ${ALLINONE_HOME}\office-bridge\tests\office-bridge.test.js

# Run full 3-round 130-scenario E2E verification suite
python ${ALLINONE_HOME}\tests\run_office_e2e_130.py
```

---

## 3. Credential Storage & Rotation Procedure
- **Office Bridge & Studio Tokens:** `${ALLINONE_HOME}\config\secrets\office-bridge-auth.json` (NTFS ACL restricted to `<owner-username>`, `SYSTEM`, `Administrators`). Deleting or editing tokens and restarting `\Hermes\OfficeVirtualCompany` rotates access immediately.
- **Telegram & Model API Keys:** Stored in user-ACL-protected Hermes/platform secret files (`${ALLINONE_HERMES_HOME}\.env` and `${ALLINONE_HOME}\config\secrets\`). Use `${ALLINONE_HOME}\scripts\rotate-platform-credentials.ps1` after rotating `@BotFather` token or `work.example-provider.com` `CUSTOM_API_KEY`.

---

## 4. Data Locations & Maintenance Policy
- **Paperclip Persistent DB:** `${ALLINONE_HOME}\data\paperclip` (PostgreSQL `54329`)
- **Defensive Findings Store:** `${ALLINONE_HOME}\data\findings\findings.db`
- **Workflow Correlation Ledger:** `${ALLINONE_HOME}\data\workflow-ledger.db`
- **Office Runtime Data (Outside Git):** `${ALLINONE_HOME}\office-data\{event-history,layouts,meetings,audit}`
- **Disk Guardrail:** Maintenance coordinator requires `D:` free space `>= 2.00 GB` (`~3.54 GB` currently available) and defers updates whenever active runs are executing. Hermes preserves its zero-backup policy (`BACKUP_ENABLED: false`).
