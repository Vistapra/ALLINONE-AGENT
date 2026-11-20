# INSTALLATION & DIRECTORY LAYOUT

## 1. Platform Directory Structure (`${ALLINONE_HOME}\`)

```text
${ALLINONE_HOME}\
├── ai-platform.cmd                # Unified platform operational CLI entrypoint
├── config\
│   ├── organization-roster.json   # Canonical 11-agent Paperclip roster & UUIDs
│   ├── resource-limits.json       # Concurrency, retry, and disk guardrails
│   └── secrets\                   # NTFS-ACL-locked secrets (excluded from Git/bundles)
│       └── office-bridge-auth.json
├── data\
│   ├── paperclip\                 # Paperclip PostgreSQL data (127.0.0.1:54329)
│   ├── findings\findings.db       # VulnClaw structured defensive findings SQLite DB
│   ├── workflow-ledger.db         # Telegram <-> Paperclip <-> Office correlation ledger
│   ├── maintenance\               # 03:00 WIB maintenance state & lockfiles
│   └── last-health-snapshot.json  # Atomic UTF-8 watchdog health telemetry
├── hermes3d\
│   └── source\                    # Hermes3D checkout (branch: integration/unified-ai-company)
├── integration\                   # Python Unified Integration Layer (Paperclip, VulnClaw, CLI)
├── office-bridge\                 # Node.js Office Bridge (127.0.0.1:3210)
│   ├── adapters\                  # Paperclip, VulnClaw Findings & Evidence adapters
│   ├── authorization\             # Token auth, Origin/CSRF, RBAC & audit logger
│   ├── contracts\                 # Event schema v1.0, 6D state machine, redaction, identity
│   ├── events\                    # Real-time WS + bounded polling synchronizer
│   ├── tests\                     # Unit & live integration test suite
│   └── server.js                  # Singleton HTTP + Dual-WebSocket server
├── office-data\                   # Persistent visual data outside Git checkout
│   ├── audit\                     # Governance mutation audit trail
│   ├── event-history\             # Bounded 500-event ring buffer
│   ├── layouts\                   # Saved 3D office layout preferences
│   └── meetings\                  # Governed virtual meeting summaries
├── runtime\bin\                   # Isolated Node 22.14, Paperclip & Office C# supervisors
├── scripts\                       # Watchdog, C# launcher sources, security boundary scanner
├── tests\                         # Multi-round 130-scenario E2E suite & deep JS probes
├── workspaces\                    # Authorized isolated Git project workspaces
├── docs\                          # Phase Gate reports (PHASE-00 through PHASE-38)
└── reports\                       # Machine-readable JSON & PNG verification evidence
```

---

## 2. Rebuilding or Verifying Existing Components (No Reinstall Needed)

```powershell
# 1. Rebuild Hermes3D production bundle on integration/unified-ai-company
cd ${ALLINONE_HOME}\hermes3d\source
${ALLINONE_HOME}\runtime\bin\npm26.cmd ci --no-fund
${ALLINONE_HOME}\runtime\bin\npm26.cmd run build

# 2. Recompile OfficeServiceLauncher.exe (only if scripts\OfficeServiceLauncher.cs changes)
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /out:${ALLINONE_HOME}\runtime\bin\OfficeServiceLauncher.exe ${ALLINONE_HOME}\scripts\OfficeServiceLauncher.cs

# 3. Verify health
${ALLINONE_HOME}\ai-platform.cmd status
```
