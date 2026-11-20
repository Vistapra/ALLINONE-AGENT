# UNIFIED AUTONOMOUS AI AGENT PLATFORM — END-TO-END TEST REPORT

## 1. Ringkasan Eksekusi Pengujian
- **Waktu Eksekusi:** `2026-11-19T12:30:34+0700`
- **Total Skenario Uji:** `110` (`A01` s/d `I10` dalam 3 Putaran)
- **PASS:** `109`
- **FAIL:** `0`
- **BLOCKED:** `0`
- **NOT_APPLICABLE:** `0`
- **NOT_TESTED:** `1` (`G10`: Reboot fisik penuh OS Windows pasca-registrasi Task Scheduler Fase 14 menunggu reboot mesin berikutnya oleh Owner; cold-boot Hermes pada `07:45 WIB` dan self-healing crash Paperclip `<45s` telah terverifikasi `PASS`).
- **Artefak Bukti Mentah:** `${ALLINONE_HOME}\reports\phase18-e2e-results.json`

---

## Round 1 — Component Testing (Groups A, B, D, H)
Ringkasan Putaran 1: **55 PASS**, **0 NOT_TESTED**, **0 FAIL** (Total: 55 skenario).

| ID | Group | Scenario | Method | Expected | Actual | Exit | ms | Evidence | Status |
|---|---|---|---|---|---|---:|---:|---|---|
| `A01` | `A-Hermes` | Hermes CLI binary responds | CLI --version | Exit 0 with version | `Hermes Agent v0.23.2+1033.g31ce88f.dirty (2026.9.24) · upstream 31ce88f8 Install directory: C:\Users` | 0 | 3621.5 | `hermes.exe --version` | **PASS** |
| `A02` | `A-Hermes` | Model combo/X configured | Read config.yaml | default: combo/X | `combo/X` | 0 | 0.5 | `${ALLINONE_HERMES_HOME}/config.yaml` | **PASS** |
| `A03` | `A-Hermes` | Existing provider custom preserved | Read config.yaml | https://work.example-provider.com/v1 | `custom -> work.example-provider.com/v1` | 0 | 0.3 | `config.yaml` | **PASS** |
| `A04` | `A-Hermes` | Telegram Owner-only authentication | Inspect allow_from & gateway health | Exclusive Owner YOUR_TELEGRAM_OWNER_ID_HERE + connected | `owner=YOUR_TELEGRAM_OWNER_ID_HERE connected=True` | 0 | 0.3 | `hermes-health.ps1` | **PASS** |
| `A05` | `A-Hermes` | Windows local terminal execution | Subprocess PowerShell | WIN_TERM_OK | `WIN_TERM_OK` | 0 | 713.6 | `powershell probe` | **PASS** |
| `A06` | `A-Hermes` | File operations verified | Phase 06/13 Hermes worker file R/W | Files created & read | `calculator.py + order_service.py R/W OK` | 0 | 0.0 | `phase06-adapter-verification.json` | **PASS** |
| `A07` | `A-Hermes` | Coding & unit test capability | Phase 06/13 Hermes coding runs | unittest exit 0 | `unittest exit_code=0` | 0 | 0.0 | `phase06-adapter-verification.json` | **PASS** |
| `A08` | `A-Hermes` | Computer Use (cua-driver-serve) ready | hermes-health CUA check | status=ready | `ready` | 0 | 0.0 | `hermes-health.ps1` | **PASS** |
| `A09` | `A-Hermes` | Owner Memory access & integrity | Verify MEMORY.md intact | MEMORY.md exists & untouched | `Owner MEMORY.md intact` | 0 | 0.2 | `phase09-10-org-isolation-verification.json` | **PASS** |
| `A10` | `A-Hermes` | Existing sessions preserved | SQLite count on Owner state.db | >=26 sessions preserved | `sessions=26` | 0 | 4.8 | `${ALLINONE_HERMES_HOME}/state.db` | **PASS** |
| `A11` | `A-Hermes` | Existing skills preserved | Count skills directory | >=64 skills present | `skills=65` | 0 | 68.3 | `${ALLINONE_HERMES_HOME}/skills` | **PASS** |
| `A12` | `A-Hermes` | Existing HermesUpdater preserved | Check task & config.json | Task enabled & BACKUP_ENABLED=false | `backup_enabled=False` | 0 | 0.0 | `${ALLINONE_USER_HOME}/HermesUpdater/config.json` | **PASS** |
| `A13` | `A-Hermes` | Daily schedule 03:00 WIB active | Inspect HermesUpdater config & state | daily @ 03:00 Asia/Jakarta | `daily 03:00` | 0 | 0.0 | `${ALLINONE_USER_HOME}/HermesUpdater/config.json` | **PASS** |
| `A14` | `A-Hermes` | Hermes offline catch-up enabled | Inspect UPDATE_ON_STARTUP/RECONNECT & state | Catch-up enabled & slot tracked | `last_slot=2026-11-19T03:00:00+07:00` | 0 | 0.0 | `${ALLINONE_USER_HOME}/HermesUpdater/state/state.json` | **PASS** |
| `A15` | `A-Hermes` | Existing local customization preserved | Check agent/error_classifier.py | File intact in checkout | `agent/error_classifier.py present` | 0 | 0.1 | `hermes-agent/agent/error_classifier.py` | **PASS** |
| `B01` | `B-Paperclip` | Server startup & health | GET /api/health | status=ok | `status=ok` | 0 | 86.4 | `GET /api/health` | **PASS** |
| `B02` | `B-Paperclip` | Dashboard UI served on loopback | HTTP GET http://127.0.0.1:3100/ | HTTP 200 HTML | `HTTP 200` | 0 | 6.0 | `http://127.0.0.1:3100/` | **PASS** |
| `B03` | `B-Paperclip` | Embedded PostgreSQL & DB backup | Inspect /api/health databaseBackup | databaseBackup.status=ok | `PostgreSQL 54329 + backup ok` | 0 | 7.2 | `GET /api/health` | **PASS** |
| `B04` | `B-Paperclip` | Authenticated deployment mode | Board API key request | HTTP 200 with Bearer key | `Authenticated Board key OK` | 0 | 9.1 | `GET /api/companies` | **PASS** |
| `B05` | `B-Paperclip` | REST API projects/agents/issues | Query Paperclip APIs | Non-empty lists returned | `projects=3 agents=11` | 0 | 96.3 | `Paperclip REST API` | **PASS** |
| `B06` | `B-Paperclip` | Organization structure & hierarchy | GET /api/companies/:id/org | Org tree returned | `Unified AI Engineering & Operations` | 0 | 8.4 | `GET /api/companies/:id/org` | **PASS** |
| `B07` | `B-Paperclip` | 11 role agents provisioned | GET /api/companies/:id/agents | >=11 agents configured | `roles=11` | 0 | 0.0 | `organization-roster.json` | **PASS** |
| `B08` | `B-Paperclip` | Task/issue creation | GET /api/companies/:id/issues | Issues created with UNI-* IDs | `issues=38` | 0 | 215.1 | `GET /api/companies/:id/issues` | **PASS** |
| `B09` | `B-Paperclip` | Task assignment to role agent | Check assigneeAgentId on completed issues | Assigned & executed | `assigneeAgentId verified` | 0 | 99.9 | `Paperclip issues` | **PASS** |
| `B10` | `B-Paperclip` | Heartbeat run execution | GET /api/companies/:id/heartbeat-runs | Succeeded runs recorded | `succeeded heartbeat runs present` | 0 | 50.9 | `GET /api/companies/:id/heartbeat-runs` | **PASS** |
| `B11` | `B-Paperclip` | Task completion transition | Check done issues count | tasks_completed >= 3 | `done=24` | 0 | 0.0 | `ai-platform health` | **PASS** |
| `B12` | `B-Paperclip` | Company & per-agent budget caps | GET /api/companies/:id/budgets/overview | Budget overview returned | `Company 12000c + role caps active` | 0 | 253.1 | `GET /api/companies/:id/budgets/overview` | **PASS** |
| `B13` | `B-Paperclip` | Data persistence across server restart | Phase 05 & Phase 14 restart checks | Company & agents persisted | `company_id=b298afd0 persisted` | 0 | 0.0 | `phase14-to-17-ops-governance-verification.json` | **PASS** |
| `B14` | `B-Paperclip` | Unauthorized API access rejected | Unauthenticated GET /api/companies | HTTP 401 or 403 | `HTTP 403` | 0 | 8.2 | `GET /api/companies (no token)` | **PASS** |
| `D01` | `D-VulnClaw` | Isolated Python 3.14 venv initialization | runtime_diagnostics() | vulnclaw 0.4.1 loaded | `v0.4.1 py=3.14.9` | 0 | 0.0 | `vulnclaw-venv` | **PASS** |
| `D02` | `D-VulnClaw` | Dependency isolation from Hermes | Compare venv paths & env scrub | Zero Hermes/Telegram env leak | `hermes_or_telegram_env_leaked=False` | 0 | 0.0 | `vulnclaw_defensive.py` | **PASS** |
| `D03` | `D-VulnClaw` | Model combo/X connectivity & tokens | Phase 07 LLM triage readiness check | ok=True with token counts | `2761 tokens` | 0 | 0.0 | `phase07-08-vulnclaw-findings-verification.json` | **PASS** |
| `D04` | `D-VulnClaw` | Sanitized report & SARIF/Markdown processing | Phase 07 codescan output | SARIF + sanitized MD generated | `SARIF + Markdown generated` | 0 | 0.1 | `phase07-synthetic-codescan.md` | **PASS** |
| `D05` | `D-VulnClaw` | Structured findings SQLite schema | FindingsStore.summary_counts() | total >= 2 structured rows | `{"total": 3, "imported": 0, "under_review": 0, "confirmed": 0, "false_positive": 1, "resolved": 2, "by_state": {"FALSE_POSITIVE": 1, "RESOLVED": 2}}` | 0 | 4.5 | `findings.db` | **PASS** |
| `D06` | `D-VulnClaw` | Severity & CWE normalization (no fake CVE) | FindingsStore.normalize_severity/validate_cve | Invalid CVE rejected to None | `Strict CVE/CWE validation` | 0 | 0.0 | `findings_engine.py` | **PASS** |
| `D07` | `D-VulnClaw` | Duplicate findings suppression | Phase 08 duplicate ingest test | deduplicated=True | `occurrence_count incremented, 0 dup tasks` | 0 | 0.0 | `phase07-08-vulnclaw-findings-verification.json` | **PASS** |
| `D08` | `D-VulnClaw` | False-positive lifecycle state | Check FALSE_POSITIVE count in findings.db | false_positive >= 1 | `false_positive=1` | 0 | 2.5 | `findings.db` | **PASS** |
| `D09` | `D-VulnClaw` | Defensive remediation recommendation | Phase 07 LLM & static remediation guidance | Non-empty recommended_fix | `Remediation guidance populated` | 0 | 0.0 | `phase07-08-vulnclaw-findings-verification.json` | **PASS** |
| `D10` | `D-VulnClaw` | Findings import to Paperclip review/remediation tasks | Check linked Paperclip issue IDs | Both review & remediation issues created | `rem_issue=52d1bb2c` | 0 | 0.0 | `phase07-08-vulnclaw-findings-verification.json` | **PASS** |
| `D11` | `D-VulnClaw` | Sensitive token redaction in findings | Phase 08 synthetic token scrub test | sk-* replaced with [REDACTED_API_KEY] | `Redacted before DB & Paperclip` | 0 | 0.0 | `phase07-08-vulnclaw-findings-verification.json` | **PASS** |
| `D12` | `D-VulnClaw` | Unauthorized workspace access denied | validate_authorized_scan_path(HermesHome) | PermissionError raised | `PermissionError raised for Hermes Home` | 0 | 0.3 | `validate_authorized_scan_path` | **PASS** |
| `D13` | `D-VulnClaw` | Embedded report directives neutralized | Phase 08 canary & directive strip check | Directive replaced with literal marker | `Canary untouched; directive neutralized` | 0 | 0.0 | `phase07-08-vulnclaw-findings-verification.json` | **PASS** |
| `D14` | `D-VulnClaw` | Offensive capabilities blocked in integration | assert_capability_allowed('exploit') | PermissionError + 0 MCP servers | `Offensive capabilities blocked + MCP=0` | 0 | 0.0 | `assert_capability_allowed` | **PASS** |
| `H01` | `H-Maint` | Daily 03:00 WIB maintenance schedule registered | Inspect PlatformMaintenance & HermesAutoUpdate | Both enabled @ 03:00 WIB | `03:00 Asia/Jakarta` | 0 | 0.0 | `PlatformMaintenance task` | **PASS** |
| `H02` | `H-Maint` | Missed 03:00 schedule offline catch-up | Phase 15 catch-up simulation | outcome=completed, is_catchup=True | `slot=2026-11-19T03:00:00+07:00` | 0 | 0.0 | `phase14-to-17-ops-governance-verification.json` | **PASS** |
| `H03` | `H-Maint` | Active task deferral during workload | Phase 15 simulated active run check | outcome=deferred_active_work | `DEFERRED without advancing slot` | 0 | 0.0 | `phase14-to-17-ops-governance-verification.json` | **PASS** |
| `H04` | `H-Maint` | Singleton maintenance lock enforcement | Inspect maintenance.lock handling | Prevents concurrent maintenance | `Lock verified` | 0 | 0.0 | `maintenance_coordinator.py` | **PASS** |
| `H05` | `H-Maint` | Upstream stable candidate detection | npm view paperclipai & git ls-remote VulnClaw | Versions resolved cleanly | `paperclip:up_to_date:2026.1117.0, vulnclaw:up_to_date:v0.4.1` | 0 | 0.0 | `maintenance state.json` | **PASS** |
| `H06` | `H-Maint` | No-update idempotent behavior | Same-day repeat run check | waiting_daily_window (no restart) | `waiting_daily_window` | 0 | 0.0 | `phase14-to-17-ops-governance-verification.json` | **PASS** |
| `H07` | `H-Maint` | Major-version & candidate compatibility guard | Inspect major_upgrade_deferred & quarantine | Quarantines failed candidates | `Major jump & quarantine guard active` | 0 | 0.0 | `maintenance_coordinator.py` | **PASS** |
| `H08` | `H-Maint` | Component failure isolation | Sequential component update architecture | Paperclip/VulnClaw isolated from HermesUpdater | `HermesUpdater independent & healthy` | 0 | 0.0 | `HermesUpdater/state/state.json` | **PASS** |
| `H09` | `H-Maint` | Post-update cross-component smoke test | Check smoke.ok in maintenance history | smoke.ok=True | `Hermes+Paperclip+VulnClaw smoke=ok` | 0 | 0.0 | `maintenance state.json` | **PASS** |
| `H10` | `H-Maint` | Watchdog respects maintenance.lock | Phase 14 watchdog lock test | MAINTENANCE_LOCK_ACTIVE | `Watchdog deferred cleanly` | 0 | 0.0 | `platform-watchdog.ps1` | **PASS** |
| `H11` | `H-Maint` | Hermes zero-backup policy preserved | Check Hermes backups folder & BACKUP_ENABLED=false | 0 Hermes backup archives created | `0 Hermes backup archives` | 0 | 0.0 | `HermesUpdater/config.json` | **PASS** |
| `H12` | `H-Maint` | Telegram Gateway continuity across maintenance check | Verify Gateway running & connected | telegram_connected=True | `Gateway online continuously` | 0 | 0.0 | `hermes-health.ps1` | **PASS** |

## Round 2 — Integration & Recovery Testing (Groups C, E, F, G)
Ringkasan Putaran 2: **44 PASS**, **1 NOT_TESTED**, **0 FAIL** (Total: 45 skenario).

| ID | Group | Scenario | Method | Expected | Actual | Exit | ms | Evidence | Status |
|---|---|---|---|---|---|---:|---:|---|---|
| `C01` | `C-Adapter` | Official hermes_local & hermes_gateway adapter connection | Phase 06 adapter verification | Both adapters registered & verified | `gw=succeeded local=succeeded` | 0 | 0.0 | `phase06-adapter-verification.json` | **PASS** |
| `C02` | `C-Adapter` | Paperclip issue submission triggers Hermes run | Phase 06 issue -> run dispatch | Run spawned automatically | `run_id=87eb3d69` | 0 | 0.0 | `phase06-adapter-verification.json` | **PASS** |
| `C03` | `C-Adapter` | Actual Hermes worker file & test execution | Check calculator.py & unittest on disk | Files written & tests pass | `calculator.py + 2 unit tests OK` | 0 | 0.0 | `workspaces/phase06-smoke` | **PASS** |
| `C04` | `C-Adapter` | Structured resultJson & session_id capture | Inspect run resultJson | session_id captured | `local-ca9b644722d7e18fbc61f0` | 0 | 0.0 | `phase06-adapter-verification.json` | **PASS** |
| `C05` | `C-Adapter` | Clean process exit status 0 | Inspect run exitCode | exitCode == 0 | `exit_code=0` | 0 | 0.0 | `phase06-adapter-verification.json` | **PASS** |
| `C06` | `C-Adapter` | Role & worker session isolation | Phase 10 disjoint SQLite sessions check | role_sessions_disjoint=True | `Separate profiles/<id>/state.db` | 0 | 0.0 | `phase09-10-org-isolation-verification.json` | **PASS** |
| `C07` | `C-Adapter` | Workspace & parallel Git worktree isolation | Phase 10 worktree & lock check | Zero file overwrite across branches | `Worktrees + O_EXCL lock verified` | 0 | 0.0 | `phase09-10-org-isolation-verification.json` | **PASS** |
| `C08` | `C-Adapter` | Run timeout enforcement | Phase 06 4s timeout probe | status == timed_out | `timed_out` | 0 | 0.0 | `phase06-adapter-verification.json` | **PASS** |
| `C09` | `C-Adapter` | Explicit run cancellation | Phase 06 POST /cancel probe | status == cancelled | `cancelled` | 0 | 0.0 | `phase06-adapter-verification.json` | **PASS** |
| `C10` | `C-Adapter` | Duplicate run / task idempotency prevention | Phase 11/12 idempotency key test | deduplicated=True | `Duplicate submission suppressed` | 0 | 0.0 | `phase11-12-telegram-workflow-verification.json` | **PASS** |
| `C11` | `C-Adapter` | Adapter connection recovery after Paperclip restart | Run live agent list & health after Phase 14 crash test | API & workers responsive | `Recovered & responsive` | 0 | 0.0 | `phase14-to-17-ops-governance-verification.json` | **PASS** |
| `C12` | `C-Adapter` | Owner Telegram sessions & memory untouched | Compare Owner state.db before/after | owner_sessions_untouched=True | `Owner sessions 100% isolated` | 0 | 0.0 | `phase06 & phase09-10 reports` | **PASS** |
| `E01` | `E-Telegram` | Owner instruction classification (8 categories) | Phase 11 classifier verification | 8/8 categories accurate | `8/8 categories matched` | 0 | 0.0 | `phase11-12-telegram-workflow-verification.json` | **PASS** |
| `E02` | `E-Telegram` | Create Paperclip task via Telegram bridge | /create_task command | Task persisted in Paperclip + ledger | `create_task=True` | 0 | 0.0 | `phase11-12-telegram-workflow-verification.json` | **PASS** |
| `E03` | `E-Telegram` | Task ID acknowledgement returned | Live /tasks & /create_task reply format | UNI-* identifier in reply | `UNI-* identifier included` | 0 | 123.9 | `handle_telegram_command('tasks')` | **PASS** |
| `E04` | `E-Telegram` | Task progress retrieval (/task_status) | Phase 11 /task_status test | Status & latest comment returned | `task_status=True` | 0 | 0.0 | `phase11-12-telegram-workflow-verification.json` | **PASS** |
| `E05` | `E-Telegram` | Role agent assignment on routed tasks | Inspect task_ledger assigned_role | ceo_agent / role bound | `Role assignment verified` | 0 | 0.0 | `workflow-ledger.db` | **PASS** |
| `E06` | `E-Telegram` | Outbound completion report delivered to Owner Telegram | Inspect send_owner_telegram_notification result | sent=True with Telegram message_id | `msg_id=75` | 0 | 0.0 | `phase11-12-telegram-workflow-verification.json` | **PASS** |
| `E07` | `E-Telegram` | Task pause/resume/cancel from Telegram | Phase 11 /pause_task, /resume_task, /cancel_task | All 3 transitions PASS | `pause/resume/cancel=True` | 0 | 0.0 | `phase11-12-telegram-workflow-verification.json` | **PASS** |
| `E08` | `E-Telegram` | Non-owner Telegram ID rejected & logged | Caller 8888888888 test | PermissionError + audit row | `Unauthorized caller blocked` | 0 | 0.0 | `workflow-ledger.db auth_audit_log` | **PASS** |
| `E09` | `E-Telegram` | Duplicate Telegram message idempotency | Repeat message_id tg-p11-idem-001 | deduplicated=True | `Zero duplicate tasks created` | 0 | 0.0 | `phase11-12-telegram-workflow-verification.json` | **PASS** |
| `E10` | `E-Telegram` | Single Telegram consumer & restart persistence | Verify only \Hermes_Gateway polls Bot API | Zero 409 polling conflicts | `Single consumer \Hermes_Gateway` | 0 | 0.0 | `hermes-health.ps1` | **PASS** |
| `E11` | `E-Telegram` | Zero secret exposure in Telegram payloads & logs | verify-security-boundaries.py scan | leaks_found=0 | `0 secret leaks across platform` | 0 | 0.0 | `verify-security-boundaries.py` | **PASS** |
| `F01` | `F-DevFlow` | Authorized test repository discovery | Inspect workspaces/demo-order-service | Git repo initialized | `demo-order-service ready` | 0 | 0.1 | `workspaces/demo-order-service` | **PASS** |
| `F02` | `F-DevFlow` | Project & workflow planning | Paperclip project & parent-child ledger | Project & plan active | `finding=FND-1C3FCD9F8E` | 0 | 0.0 | `phase13-dev-remediation-verification.json` | **PASS** |
| `F03` | `F-DevFlow` | Task decomposition across Reviewer, Dev & QA | Inspect Phase 13 multi-role runs | 3 distinct roles executed | `Security + Dev + QA runs succeeded` | 0 | 0.0 | `phase13-dev-remediation-verification.json` | **PASS** |
| `F04` | `F-DevFlow` | Git branch isolation (main untouched) | Check isolated_branch in Phase 13 | fix/order-validation-and-sha256 | `fix/order-validation-and-sha256` | 0 | 0.0 | `phase13-dev-remediation-verification.json` | **PASS** |
| `F05` | `F-DevFlow` | Source code feature & validation editing | Inspect order_service.py on branch | calculate_discounted_total + SHA-256 | `SHA-256 & validation implemented` | 0 | 0.2 | `demo-order-service/order_service.py` | **PASS** |
| `F06` | `F-DevFlow` | Python bytecode compilation / build check | py_compile order_service.py | Exit 0 | `py_compile exit 0` | 0 | 198.4 | `order_service.py` | **PASS** |
| `F07` | `F-DevFlow` | Automated unit tests pass | Phase 13 unittest suite | exit_code == 0 | `unittest OK` | 0 | 0.0 | `phase13-dev-remediation-verification.json` | **PASS** |
| `F08` | `F-DevFlow` | Independent QA Engineer agent verification | Check qa_verification_run | succeeded (exit 0) | `{'id': '2ac6de43-d2a4-456e-8803-e171567c2a2c', 'status': 'succeeded', 'exit_code': 0}` | 0 | 0.0 | `phase13-dev-remediation-verification.json` | **PASS** |
| `F09` | `F-DevFlow` | Static security finding detection on baseline | Check baseline_findings_count | >=1 finding detected | `baseline=2` | 0 | 0.0 | `phase13-dev-remediation-verification.json` | **PASS** |
| `F10` | `F-DevFlow` | Security remediation reduces static findings | Compare baseline vs post-remediation scan | post < baseline & RESOLVED | `2 -> 0 (RESOLVED)` | 0 | 0.0 | `phase13-dev-remediation-verification.json` | **PASS** |
| `F11` | `F-DevFlow` | Regression test suite covers remediated code | Run unittest discover on demo-order-service | Exit 0 | `All regression tests pass` | 0 | 247.3 | `demo-order-service/test_order_service.py` | **PASS** |
| `F12` | `F-DevFlow` | Production deployment gated on Owner approval | Check production_deploy_gate stage | PENDING_APPROVAL / blocked | `PENDING_APPROVAL (blocked)` | 0 | 0.0 | `phase13-dev-remediation-verification.json` | **PASS** |
| `G01` | `G-Recovery` | All 6 scheduled tasks registered & enabled | Inspect Schedule.Service tasks | All enabled=True | `{"Hermes_Gateway": {"state": 4, "enabled": true}, "cua-driver-serve": {"state": 3, "enabled": true}, "HermesAutoUpdate": {"state": 4, "enabled": true}, "Papercl` | 0 | 0.0 | `ai-platform services` | **PASS** |
| `G02` | `G-Recovery` | Staggered logon delay & dependency order | Inspect task XML delays | Paperclip -> Watchdog (45s) -> Maint (2m) | `Staggered triggers configured` | 0 | 0.1 | `register-platform-tasks.ps1` | **PASS** |
| `G03` | `G-Recovery` | Hermes Gateway watchdog & loop liveness | Inspect gateway.loop_watchdog & task state | state=4 (Running) | `Hermes_Gateway Running` | 0 | 0.0 | `Schedule.Service` | **PASS** |
| `G04` | `G-Recovery` | Paperclip child crash automatic recovery | Phase 14 kill child node.exe test | Auto-restarted & /api/health ok | `Recovered from killed PID 16088` | 0 | 0.0 | `phase14-to-17-ops-governance-verification.json` | **PASS** |
| `G05` | `G-Recovery` | Platform CLI & watchdog recovery | Run platform-watchdog.ps1 | Exit 0 & health snapshot updated | `Watchdog exit 0` | 0 | 7008.1 | `platform-watchdog.ps1` | **PASS** |
| `G06` | `G-Recovery` | Network reconnect / fallback IP resilience | Inspect Telegram fallback_ips & force_ipv4 | force_ipv4 + fallback_ips configured | `force_ipv4=true + fallback_ips` | 0 | 0.4 | `config.yaml` | **PASS** |
| `G07` | `G-Recovery` | Singleton mutex & IgnoreNew duplicate prevention | Inspect PaperclipServiceLauncher.cs mutex | Local\PaperclipServer_Singleton | `Named OS Mutex + IgnoreNew` | 0 | 0.2 | `PaperclipServiceLauncher.cs` | **PASS** |
| `G08` | `G-Recovery` | Automatic task dependency reconciliation | Phase 12 reconcile_tasks() test | dependencies_unblocked >= 1 | `{"synced_completed": 0, "dependencies_unblocked": 1}` | 0 | 0.0 | `phase11-12-telegram-workflow-verification.json` | **PASS** |
| `G09` | `G-Recovery` | Exponential backoff crash-loop protection | Inspect PaperclipServiceLauncher.cs backoff | 6 quick exits -> 180s cool-down | `Backoff 3s..60s -> 180s verified` | 0 | 0.2 | `PaperclipServiceLauncher.cs` | **PASS** |
| `G10` | `G-Recovery` | Full OS physical reboot after new platform tasks | Audit logon triggers (live session cannot reboot mid-turn) | Documented honestly as NOT_TESTED until next physical reboot | `Logon triggers registered & Hermes cold-boot verified at 07:45 WIB; full OS reboot post-Phase-14 pending Owner reboot` |  | 0.0 | `STARTUP-RECOVERY.md` | **NOT_TESTED** |

## Round 3 — End-to-End, Performance, Governance & Regression Testing (Group I)
Ringkasan Putaran 3: **10 PASS**, **0 NOT_TESTED**, **0 FAIL** (Total: 10 skenario).

| ID | Group | Scenario | Method | Expected | Actual | Exit | ms | Evidence | Status |
|---|---|---|---|---|---|---:|---:|---|---|
| `I01` | `I-GovPerf` | Idle/baseline host resource footprint | Measure Windows CPU/RAM/Disk | Free disk > thresholds & responsive | `CPU=0% RAM_free=707.5MB C=45.64GB D=4.44GB` | 0 | 0.0 | `collect_windows_metrics` | **PASS** |
| `I02` | `I-GovPerf` | Single-agent coding workload completion | Phase 06 & 13 single-worker execution | Succeeded within timeout | `Single-worker runs succeeded` | 0 | 0.0 | `phase06 & phase13 reports` | **PASS** |
| `I03` | `I-GovPerf` | Bounded concurrency & standby agent pausing (4 active / 7 paused) | Check active vs paused org agents | Wave-1 active, Wave-2 paused | `active=['CEO Agent', 'QA Engineer', 'Security Reviewer', 'Backend Developer']` | 0 | 0.0 | `phase14-to-17-ops-governance-verification.json` | **PASS** |
| `I04` | `I-GovPerf` | Paperclip monthly budget enforcement configured | Inspect company & agent budgets | 12000c company + role caps | `Budgets active in Paperclip DB` | 0 | 0.0 | `phase14-to-17-ops-governance-verification.json` | **PASS** |
| `I05` | `I-GovPerf` | Run timeout termination | Phase 06 timeout probe | timed_out enforced | `timed_out` | 0 | 0.0 | `phase06-adapter-verification.json` | **PASS** |
| `I06` | `I-GovPerf` | Bounded task retry limit (max 2) | Phase 12 retry_cap_enforced check | 3rd retry blocked with RuntimeError | `Max 2 retries enforced` | 0 | 0.0 | `phase11-12-telegram-workflow-verification.json` | **PASS** |
| `I07` | `I-GovPerf` | Free disk space guard before updates | maintenance_coordinator.check_free_disk_ok() | Guard active (C>=3GB, D>=2GB) | `C=45.64GB D=4.44GB` | 0 | 0.0 | `resource-limits.json` | **PASS** |
| `I08` | `I-GovPerf` | Automatic secret & token redaction across logs/reports | verify-security-boundaries.py full scan | 0 leaks across all files | `0 secret leaks` | 0 | 0.0 | `verify-security-boundaries.py` | **PASS** |
| `I09` | `I-GovPerf` | Workspace scope & exclusive lock enforcement | Live lock + forbidden path check | Out-of-scope & concurrent lock blocked | `Scope & lock guards active` | 0 | 251.1 | `org_provisioner + vulnclaw_defensive` | **PASS** |
| `I10` | `I-GovPerf` | Emergency stop & Wave-1 resume governance | Phase 17 emergency-stop + resume-wave1 | All paused on stop; 4 resumed | `emergency-stop & resume-wave1 PASS` | 0 | 0.0 | `phase14-to-17-ops-governance-verification.json` | **PASS** |
