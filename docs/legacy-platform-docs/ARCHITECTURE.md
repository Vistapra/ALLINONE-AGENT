# SYSTEM ARCHITECTURE — UNIFIED AUTONOMOUS AI COMPANY

## 1. End-to-End Topology

```text
                       HUMAN OWNER (YOUR_TELEGRAM_OWNER_ID_HERE)
                                  |
            +---------------------+---------------------+
            |                                           |
   Telegram CODEXE Bot                         Hermes3D Virtual Office
(@YOUR_BOT_HANDLE_HERE)               (http://127.0.0.1:3200/office)
  Single Poller: \Hermes_Gateway             3D Three.js + 2D Phaser Fallback
            |                                           |
            +---------------------+---------------------+
                                  |
                   Unified Integration Layer (Python)
                   + Office Bridge (127.0.0.1:3210)
             [Auth, CSRF/Origin, Redaction, Event Bus v1.0]
                                  |
                   Paperclip AI Control Plane (v2026.1117.0)
               (http://127.0.0.1:3100 | PostgreSQL 127.0.0.1:54329)
        [Company, 11 Agents, Hierarchy, Issues, Approvals, Budgets]
                                  |
            +---------------------+---------------------+
            |                                           |
     Hermes Workers                              VulnClaw v0.4.1
  (profiles\pc* | combo/X)                  (Isolated Defensive Scan)
  [Coding, Git Branch, Tests]               [SQLite findings.db (RO)]
            |                                           |
            +---------------------+---------------------+
                                  |
               Normalized Real-Time Event Stream (WS v1.0)
             + Hermes3D Gateway Protocol v3 (127.0.0.1:3210)
                                  |
                     Hermes3D 3D/2D Virtual Office
```

---

## 2. Strict Separation of Responsibilities

| Component | Authoritative Responsibility | Explicit Non-Responsibilities |
| --- | --- | --- |
| **Paperclip AI** | Single source of truth for Company, 11 Agent UUIDs, Hierarchy, Tasks/Issues, Approvals, and Budget policies. | Never bypassed by direct DB writes or duplicate task engines. |
| **Hermes Agent** | Actual software engineering, file/Git branch work, local terminal & test execution (`profiles\pc*`), and Owner personal gateway (`state.db`). | Worker sessions never share Owner personal Telegram memory. |
| **VulnClaw** | Isolated defensive static code analysis; findings stored in `data\findings\findings.db`. | Zero offensive capabilities (`exploit`, `recon`, `scan_network`, `shell_command` blocked); zero browser execution path. |
| **Office Bridge** | Normalized REST & Dual-WS (`v1.0` + Gateway `v3`), 6D state machine, RBAC, and secret/directive redaction. | Stores only visual layouts, bounded event ring buffer, and meeting notes—never business state. |
| **Hermes3D** | Interactive 3D Three.js & 2D Phaser Virtual Office, 8 corporate departments, 11 employee avatars, and 6-tab Command Center. | Strictly stateless visual & command client; closing browser never stops worker runs. |
| **Telegram** | Single-poller Owner mobile/chat command & completion notification channel. | Never polled by Office Bridge or Hermes3D (zero HTTP 409 conflicts). |
| **Health & Maintenance** | 1-minute self-healing watchdog (`platform-watchdog.ps1`) + `03:00 Asia/Jakarta` daily/catch-up maintenance (`maintenance_coordinator.py`). | Watchdog never checks upstream updates every 60s; Hermes preserves `BACKUP_ENABLED: false`. |
