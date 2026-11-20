# USER GUIDE — UNIFIED AUTONOMOUS AI COMPANY (3D VIRTUAL OFFICE)

## 1. Opening & Authenticating to the 3D Virtual Office
1. Open Chrome or Microsoft Edge on `<machine-name>` and navigate to:
   - **3D Virtual Office URL:** `http://127.0.0.1:3200/office`
   - **Paperclip Control Plane URL:** `http://127.0.0.1:3100`
2. When prompted at `http://127.0.0.1:3200/login`, enter your **Studio Access Token** stored locally in `${ALLINONE_HOME}\config\secrets\office-bridge-auth.json` (`studioAccessToken` — readable only by Windows user `<owner-username>`).
3. Authentication sets an `HttpOnly; SameSite=Strict` session cookie and loads the live **Unified AI Engineering & Operations** 3D Virtual Office (`LIVE COMPANY` green indicator in the top bar; if Demo Mode is ever inspected, it is explicitly labeled `SIMULATED DEMO`; if snapshot age exceeds 60s, it shows `STALE`).

---

## 2. Camera, Room & Graphics Quality Controls
- **Orbit / Rotate Camera:** Hold **Left Mouse Button** and drag.
- **Pan Camera:** Hold **Right Mouse Button** and drag.
- **Zoom In / Out:** Scroll mouse wheel, or click **`+`** / **`-`** in the top bar.
- **Isometric Reset:** Click **`ISO`** to snap back to isometric overview.
- **8-Department Quick Jump:** Click **`Exec`**, **`Eng`**, **`QA Lab`**, **`SOC`**, **`Compliance`**, **`Meeting`**, **`Ops`**, or **`Lobby`** in the top bar to jump directly to any department room.
- **Graphics Quality (`LOW` / `MEDIUM` / `HIGH` / `AUTO`) & `2D PIXEL` Mode:**
  - On `<machine-name>` (`GT 710` `2 GB VRAM`), **`LOW`** or **`AUTO`** is recommended in 3D mode (`~9–11 FPS`, `~175 MB` heap).
  - Click **`2D PIXEL`** at any time to switch to ultra-lightweight 2D Pixel Office mode (`20+ FPS`, `113 MB` heap), or close the browser completely—active workers keep executing uninterrupted!

---

## 3. Selecting Employees & Using the 6-Tab Enterprise Command Center
Click **`Company Hub`** (top right) or click any **3D/2D Employee Avatar** to open the 6-tab Command Center:
1. **`Roster` Tab (Company Overview & Hierarchy):**
   - View all 11 employees (`4 Wave-1 ACTIVE`, `7 Wave-2 STANDBY`), their reporting hierarchy (`CEO Agent` -> Managers & Specialists), and 6-dimensional live state badges.
2. **`Inspector` Tab (Assigning Tasks, Viewing Progress & Cancelling):**
   - View canonical Paperclip UUID, isolated Hermes profile (`pcceoagent`, `pcbackenddeveloper`, etc.), `combo/X` model, skills, authorized tools, authorized workspaces, current task, run queue, sanitized execution logs, and performance counters.
   - **Assign a Task:** Enter task title & instructions in the Inspector form and click **Create & Assign Task** (creates an official Paperclip issue with automatic `idempotency_key` deduplication).
   - **Pause / Resume / Cancel:** Click **Pause**, **Resume**, or **Cancel Run** to govern agent execution directly through Paperclip.
3. **`Collab` Tab (Delegation & Virtual Meeting Room):**
   - Inspect live parent-child task delegations (`CEO -> Dev -> Security -> QA`) and governed Meeting Room agendas & archived summaries.
4. **`SOC` Tab (VulnClaw Defensive Security Center):**
   - View defensive static-analysis & synthetic audit findings (`finding_id`, CWE, severity, confidence, sanitized evidence, `OPEN -> CONFIRMED -> IN_PROGRESS -> READY_FOR_VERIFICATION -> RESOLVED` lifecycle, and linked Paperclip remediation tasks).
5. **`Gov/Budget` Tab (Approvals, Governance, Budget & Emergency Stop):**
   - Inspect pending Owner approvals (`Approve` / `Reject`), concurrency limits (`4 active / 7 standby`), token usage, transparent **`COST UNKNOWN` / `UNPRICED USAGE`** indicator (`combo/X` `cost_usd: null`), and **Emergency Stop (`PAUSE ALL`)** / **`Resume Wave-1`**.
6. **`Ops/Evid` Tab (12-Service Health, Maintenance & Evidence Viewer):**
   - Monitor functional health across all 12 platform components (`Paperclip`, `PostgreSQL`, `Hermes Agent`, `Hermes Gateway`, `Telegram`, `VulnClaw`, `Computer Use`, `Office Bridge`, `Hermes3D`, `Event Stream`, `Maintenance Coordinator`, `Auto-Updater`).
   - Use the **Evidence Viewer** to inspect Git branches, commits, changed files, and test reports inside authorized `${ALLINONE_HOME}\workspaces` and `reports`.

---

## 4. Using Telegram (`@YOUR_BOT_HANDLE_HERE`) Together with Hermes3D
- Send instructions via Telegram from Owner account `YOUR_TELEGRAM_OWNER_ID_HERE` (e.g., `/create_task ...`, `/task_status`, `/platform_status`, `/security_report`, `/cancel_task`).
- Every task created in Telegram automatically appears in the 3D Virtual Office, and tasks executed from the 3D Virtual Office can deliver sanitized completion summaries back to Telegram.

---

## 5. Quick Troubleshooting
- **Stuck or slow 3D frame rate during heavy builds:** Switch quality to **`LOW`** or click **`2D PIXEL`**.
- **`STALE` badge in top bar:** Indicates snapshot age `>60s`; check `${ALLINONE_HOME}\ai-platform.cmd status` or restart `\Hermes\OfficeVirtualCompany` via Task Scheduler.
- See [TROUBLESHOOTING.md](file:///${ALLINONE_HOME}/TROUBLESHOOTING.md) for detailed diagnostics.
