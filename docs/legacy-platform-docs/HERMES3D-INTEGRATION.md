# HERMES3D INTEGRATION & DEVELOPER GUIDE

## 1. Upstream Repository & Branch Strategy
- **Upstream Repository:** `https://github.com/iamlukethedev/Hermes3D`
- **Pinned Upstream Commit:** `beb76292747b816ef317aa6f9a3992e0014f81d9` (`main`, 4 commits ahead of `v1.0.0`, MIT License; 3D models/textures CC0 / MIT)
- **Local Checkout:** `${ALLINONE_HOME}\hermes3d\source`
- **Custom Integration Branch:** `integration/unified-ai-company`
- **Isolated Runtime:** Node.js `v22.14.0` (`${ALLINONE_HOME}\runtime\bin\node26.cmd` / `npm26.cmd`)
- **Production Loopback URL:** `http://127.0.0.1:3200/office` (gated by `/login` + `STUDIO_ACCESS_TOKEN`)

---

## 2. Architectural Role
Hermes3D operates strictly as the **Interactive 3D/2D Virtual Office Frontend & Command UI**. It **never** replaces Paperclip (`127.0.0.1:3100`) as orchestrator, **never** replaces Hermes (`profiles\pc*`) as execution runtime, **never** accesses VulnClaw directly (reading only sanitized findings via Office Bridge), and **never** runs a Telegram poller. Closing the browser has **zero impact** on active worker execution.

---

## 3. Modular Customizations on `integration/unified-ai-company`

### New Modules Created
- `src/app/api/company/[...slug]/route.ts`: Server-side same-origin CSRF-protected proxy to Office Bridge (`127.0.0.1:3210/api/office-bridge/*`), injecting `bridgeToken` server-side so browser bundles remain 100% secret-free.
- `src/features/enterprise-company/types.ts`: TypeScript contracts for the 6-dimensional state machine, 19 visual states, 8 corporate departments, findings, governance/budget (`COST UNKNOWN` / `UNPRICED USAGE`), and 12-component health matrix.
- `src/features/enterprise-company/useEnterpriseCompanyLive.ts`: Real-time Normalized Event WebSocket hook (`/api/company/events/ws` -> `ws://127.0.0.1:3210/api/events/ws`) with exponential backoff, `?sinceSeq=` missed-event replay, `snapshot.reconcile`, and `60s` `STALE` detection.
- `src/features/enterprise-company/EnterpriseOfficeOverlay.tsx`: Top-bar telemetry HUD, 8-department camera jump presets, `ISO`/`+`/`-`, `LOW/MEDIUM/HIGH/AUTO` quality selector, `3D`/`2D PIXEL` toggle, and 6-tab **Enterprise Command Center** (`Roster`, `Inspector`, `Collab`, `SOC`, `Gov/Budget`, `Ops/Evid`).
- `tests/unit/enterpriseCompanyIntegration.test.ts`: Automated Vitest suite verifying integration contracts.

### Upstream Files Minimally Hardened
- `server/access-gate.js`: Added `/login` token exchange setting `HttpOnly; SameSite=Strict` cookie and enforcing `STUDIO_ACCESS_TOKEN` across all routes & WS upgrades.
- `server/gateway-proxy.js` & `server/index.js`: Injected server-side `HERMES3D_GATEWAY_TOKEN` on `/api/gateway/ws` and added `/api/company/events/ws` server-side WS proxy.
- `next.config.ts`: Added strict `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.
- `src/app/api/{runtime/custom,path-suggestions,office/agent-state,skills/remove}/route.ts`: Locked SSRF/filesystem surfaces under `UNIFIED_COMPANY_GOVERNANCE=1`.
- `src/features/retro-office/RetroOffice3D.tsx` & `src/features/office/screens/OfficeScreen.tsx`: Wired `EnterpriseOfficeOverlay`, quality presets (`LOW/MEDIUM/HIGH/AUTO`), department camera jumps, and `2D PIXEL` fallback.

---

## 4. Developer Build, Test & Extension Workflow

```powershell
# Type-check
cd ${ALLINONE_HOME}\hermes3d\source
${ALLINONE_HOME}\runtime\bin\npm26.cmd exec tsc -- --noEmit

# Run Vitest unit suites (98+ tests across 12 suites)
${ALLINONE_HOME}\runtime\bin\npm26.cmd test

# Production build
${ALLINONE_HOME}\runtime\bin\npm26.cmd run build

# Verify zero secrets in client bundles & repository
python ${ALLINONE_HOME}\scripts\verify-security-boundaries.py
```

### Adding New Visual Profiles or Authorized Runtime Adapters
1. **New Visual Profile:** Add an entry in `${ALLINONE_HOME}\office-bridge\contracts\agent-identity.js` (`ROLE_VISUAL_CATALOG`) specifying `departmentId`, `deskCoords`, `color`, `visualProfileId`, and `badgeEmoji`. Dynamic Paperclip agents without a preset automatically receive deterministic fallback coordinates and department placement by role.
2. **New Authorized Runtime Adapter:** Add an adapter module under `${ALLINONE_HOME}\office-bridge\adapters\` implementing read-only sanitized telemetry and routing all mutations exclusively through Paperclip's official REST API.

### Upstream Update Strategy
Never pull unreviewed `main` commits automatically. During maintenance, candidate tags are fetched in dry-run, rebased onto `integration/unified-ai-company` in a staging worktree, validated via `tsc`, `vitest`, `next build`, `verify-security-boundaries.py`, and post-update smoke checks before activation.
