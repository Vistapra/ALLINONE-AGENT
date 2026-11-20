# PLATFORM & 3D VIRTUAL OFFICE SECURITY ARCHITECTURE

> Detailed 3D Virtual Office & Office Bridge audit evidence is also available in [OFFICE-SECURITY-AUDIT.md](file:///${ALLINONE_HOME}/OFFICE-SECURITY-AUDIT.md).

## 1. Six Strict Trust Zones

1. **Zone 1 — Owner Personal Hermes (`${ALLINONE_HERMES_HOME}`):** Owner Telegram session (`YOUR_TELEGRAM_OWNER_ID_HERE`), personal `state.db`, and `.env`. Strictly off-limits to Office Bridge Evidence Viewer, browser clients, and VulnClaw.
2. **Zone 2 — Paperclip Control Plane (`127.0.0.1:3100`):** Authenticated private mode; governs task creation, approvals, hierarchy, and budgets.
3. **Zone 3 — Isolated Hermes Worker Profiles (`profiles\pc*`):** 11 role-separated worker homes operating inside `${ALLINONE_HOME}\workspaces` on isolated Git branches (`main` protected).
4. **Zone 4 — Isolated VulnClaw Defensive Runtime (`data\vulnclaw` & `findings.db`):** Defensive static analysis only (`10` offensive capabilities explicitly blocked); Office Bridge opens `findings.db` in read-only mode (`?mode=ro`).
5. **Zone 5 — Office Bridge (`127.0.0.1:3210`):** Constant-time Bearer token auth, Origin/CSRF validation, Owner mutation RBAC, recursive secret redaction (`sk-*`, `pcp_*`, Telegram tokens, `Bearer`), and prompt-injection neutralization (`[DATA_LITERAL_DIRECTIVE_IGNORED]`).
6. **Zone 6 — Hermes3D Browser Client (`127.0.0.1:3200`):** Gated by `STUDIO_ACCESS_TOKEN` (`HttpOnly; SameSite=Strict` cookie), strict CSP headers, zero embedded secrets (`verify-security-boundaries.py` -> `0` leaks across `158+` files), and zero unrestricted shell or arbitrary file endpoints.

---

## 2. Credential Hygiene & Owner Rotation Notice
- All secret files (`config\secrets\*`, `.env`) reside outside Git with restrictive Windows NTFS ACLs (`<owner-username>`, `SYSTEM`, `Administrators`).
- **Transparent Owner Action Item:** Because `TELEGRAM_BOT_TOKEN` and `CUSTOM_API_KEY` were pasted in plain text by the Owner in earlier chat history (`PHASE 00–19`), rotating both upstream credentials via `@BotFather` and `work.example-provider.com` and applying them via `scripts\rotate-platform-credentials.ps1` remains recommended (`telegram_bot_token_rotated_since_chat_exposure: false`, `custom_api_key_rotated_since_chat_exposure: false`).
