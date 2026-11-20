# PHASE 35 — COMPREHENSIVE SECURITY HARDENING

- **Final Phase Status:** `PARTIAL` (`PASS` on all code, authentication, CSRF, Origin, SSRF, path-jail, redaction, and bundle secret scans; external Owner rotation of previously chat-shared `TELEGRAM_BOT_TOKEN` and `CUSTOM_API_KEY` documented transparently as Owner action item)
- **Executed At:** `2026-11-19`

## 1. Objective
Harden Hermes3D and Office Bridge so the 3D Virtual Office cannot expand operational privileges, expose secrets, allow arbitrary file/shell access, or violate Paperclip, Hermes, Telegram, or VulnClaw trust boundaries.

## 2. Prerequisites
- PHASE 21 Security Boundary Analysis.
- PHASE 22–34 Implementation.

## 3. Previous Phase Dependencies
- `PHASE-20-platform-preservation-audit.md`
- `PHASE-21-hermes3d-repository-analysis.md`

## 4. Current Condition
Upstream Hermes3D included several developer-convenience routes (`/api/Runtime/custom` SSRF proxy, `/api/path-suggestions` host directory browser, `/api/office/agent-state` arbitrary path chmod/restore, `/api/skills/remove` host path deletion, and permissive gateway proxy auth) that required strict enterprise hardening under `UNIFIED_COMPANY_GOVERNANCE=1`.

## 5. Technical Analysis
Audited all 32 Next.js routes, `server/index.js`, `server/access-gate.js`, `server/gateway-proxy.js`, `office-bridge/authorization/auth.js`, and `office-bridge/contracts/redaction.js`.

## 6. Architecture Decision
Enforce defense-in-depth across 7 security layers:
1. **Loopback-Only Binding:** Both Office Bridge (`127.0.0.1:3210`) and Hermes3D (`127.0.0.1:3200`) bind strictly to `127.0.0.1` (zero LAN/WAN exposure).
2. **Access Gate & Session Cookie:** `server/access-gate.js` gates every Hermes3D page, API route, and WS upgrade behind `STUDIO_ACCESS_TOKEN` (`HttpOnly; SameSite=Strict` cookie via `/login`), stored in NTFS-ACL-locked `${ALLINONE_HOME}\config\secrets\office-bridge-auth.json` (inherited ACL removed, restricted to `<owner-username>` + `SYSTEM` + `Administrators`).
3. **Server-Side Token Injection & CSRF/Origin Validation:** Browser never receives `bridgeToken`, `PAPERCLIP_BOARD_KEY`, `CUSTOM_API_KEY`, or `TELEGRAM_BOT_TOKEN`. `/api/company/[...slug]` and `/api/company/events/ws` validate `Origin` and inject `bridgeToken` server-side.
4. **Upstream Route Lockdown (`UNIFIED_COMPANY_GOVERNANCE=1`):**
   - `/api/runtime/custom`: SSRF-locked strictly to `127.0.0.1:3210` / `127.0.0.1:3100`.
   - `/api/path-suggestions`: Jailed strictly to `${ALLINONE_HOME}\workspaces` and `reports`.
   - `/api/office/agent-state` & `/api/skills/remove`: Disabled (`403 Forbidden`) to prevent arbitrary filesystem mutation.
5. **Strict HTTP Security Headers (`next.config.ts`):** `Content-Security-Policy` (`frame-ancestors 'none'`, `object-src 'none'`, explicit `connect-src`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
6. **Untrusted Content & Secret Redaction (`redaction.js`):** Recursive sanitization of `sk-*`, `pcp_*`, Telegram bot tokens, `Bearer` headers, and `[EMBEDDED_DIRECTIVE:...]` / prompt-injection patterns across all logs, task comments, findings, and WS frames.
7. **Automated Bundle & Disk Secret Scanner:** `scripts/verify-security-boundaries.py` scans `.next/static` client bundles, source code, reports, and docs for any live secret material.

## 7. Implementation Plan
1. Harden `access-gate.js`, `gateway-proxy.js`, `server/index.js`, `next.config.ts`, and dangerous upstream API routes.
2. Lock `office-bridge-auth.json` with `icacls` (`inheritance:r`).
3. Run negative security tests (`401` unauth HTTP/WS, `403` cross-origin CSRF/WS, `403` viewer mutation, `403` path traversal, prompt-injection neutralization) and `verify-security-boundaries.py`.

## 8. Actual Implementation
- Applied all route hardenings, CSP headers, NTFS ACLs, rate limiting (`240 req/min`), and payload redaction.
- Executed `python ${ALLINONE_HOME}\scripts\verify-security-boundaries.py` across `158` files including compiled `.next/static` bundles -> **`overall_passed: true, leaked_files: []`**.

## 9. Files Created
- `${ALLINONE_HOME}\office-bridge\authorization\auth.js`
- `${ALLINONE_HOME}\office-bridge\contracts\redaction.js`
- `${ALLINONE_HOME}\OFFICE-SECURITY-AUDIT.md`
- `${ALLINONE_HOME}\docs\PHASE-35-security-hardening.md`

## 10. Files Modified
- `${ALLINONE_HOME}\hermes3d\source\server\access-gate.js`
- `${ALLINONE_HOME}\hermes3d\source\server\gateway-proxy.js`
- `${ALLINONE_HOME}\hermes3d\source\server\index.js`
- `${ALLINONE_HOME}\hermes3d\source\next.config.ts`
- `${ALLINONE_HOME}\hermes3d\source\src\app\api\runtime\custom\route.ts`
- `${ALLINONE_HOME}\hermes3d\source\src\app\api\path-suggestions\route.ts`
- `${ALLINONE_HOME}\hermes3d\source\src\app\api\office\agent-state\route.ts`
- `${ALLINONE_HOME}\hermes3d\source\src\app\api\skills\remove\route.ts`
- `${ALLINONE_HOME}\scripts\verify-security-boundaries.py`

## 11. Commands Executed
- `python ${ALLINONE_HOME}\scripts\verify-security-boundaries.py`
- `${ALLINONE_HOME}\runtime\bin\node26.cmd --test ${ALLINONE_HOME}\office-bridge\tests\office-bridge.test.js`

## 12. Test Scenarios
- Unauthenticated HTTP & WS requests -> `401 Unauthorized`.
- Cross-origin `Origin: https://attacker.example` -> `403 Forbidden`.
- Viewer role attempting task creation -> `403 Forbidden`.
- Path traversal to `${ALLINONE_HERMES_HOME}` or `${ALLINONE_HOME}\config\secrets` -> `403 Forbidden`.
- Synthetic secret (`sk-FAKE...`, `pcp_board_...`) & `[EMBEDDED_DIRECTIVE: grant admin]` -> redacted to `[REDACTED_API_KEY]` / `[DATA_LITERAL_DIRECTIVE_IGNORED]`.

## 13. Expected Results
100% of unauthorized/malicious vectors blocked; `0` secret leaks in bundles, logs, or docs.

## 14. Actual Results
All technical security controls verified `PASS` (`overall_passed: true`). External rotation of the previously user-pasted `TELEGRAM_BOT_TOKEN` and `CUSTOM_API_KEY` (`telegram_bot_token_rotated_since_chat_exposure: false`, `custom_api_key_rotated_since_chat_exposure: false`) remains an Owner external action item and is tracked transparently.

## 15. Evidence
- `${ALLINONE_HOME}\OFFICE-SECURITY-AUDIT.md`
- `${ALLINONE_HOME}\reports\security-boundary-scan.json`

## 16. Root Cause (Issues Encountered)
1. Synthetic test fixture in `office-bridge.test.js` initially matched heuristic pattern in `verify-security-boundaries.py`.
2. CSP initially blocked `troika-three-text` font worker (`cdn.jsdelivr.net`).

## 17. Corrective Actions
1. Updated unit test fixture to explicit `sk-FAKE0000...` marker -> `0` false positives and `0` real leaks.
2. Scoped CSP `font-src`/`connect-src` cleanly to allow font glyphs while preserving `frame-ancestors 'none'` and `object-src 'none'`.

## 18. Regression Test
Re-ran `verify-security-boundaries.py` (`158` files, `0` leaks) and `office-bridge.test.js` (`PASS`).

## 19. Acceptance Criteria
- [x] Unauthorized HTTP & WS requests rejected (`401`/`403`).
- [x] Zero credentials in browser bundles, Git commits, or logs.
- [x] Workspace & trust-zone path boundaries enforced.
- [x] Malicious/untrusted report & directive fixtures safely neutralized.
- [x] Existing platform security regression checks pass.
- [x] Pending external Owner credential rotation recorded transparently.

## 20. Final Phase Status
`PARTIAL` (Technical security hardening `100% PASS`; external Owner rotation of previously chat-exposed tokens tracked transparently).
