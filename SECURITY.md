# Security Policy

## Reporting a vulnerability

Open a private security advisory on this repository's GitHub "Security" tab, or contact the repository owner directly. **Never include actual tokens, API keys, passwords, or other live credential values in a public issue, pull request, or commit message** — if you believe a credential has been exposed, report it privately first.

## Known, disclosed security-relevant facts about this project

This section exists because this repository's publication process involved several rounds of real security auditing, not one scan treated as sufficient. The following are disclosed deliberately rather than hidden:

- **The original reference installation's Telegram bot token and model API key have not been rotated** since they were previously exposed in chat history (confirmed directly from that platform's own security audit document, not assumed). A fresh install from this repository **never** reads, copies, or reuses those values — `setup.ps1` always generates new local configuration from `.example` templates. If you are the owner of the original installation, rotate both via @BotFather (`/revoke` + `/token`) and your model provider's panel before using those credentials for anything.
- **Automated secret scanning alone is not sufficient for this project.** During the publication audit, `detect-secrets` (a trusted, widely-used scanner) returned zero findings when pointed directly at a directory manually confirmed to contain real JWT secrets, API keys, and auth tokens — the values were low-entropy enough to evade detection. Manual classification by file path, key name, and content review is the primary safety net here, not a backstop.
- **Real bugs found and fixed during the publication audit** (listed without naming the actual leaked values, since the values themselves were never real production secrets of this repository — they belonged to the original reference installation and were never copied in):
  - A fail-open owner-authorization check in the Office Bridge auth module: an unset expected owner ID could previously match an unset caller ID and silently authorize. Now fail-closed.
  - A credential-access protection list (`FORBIDDEN_ROOTS` in `apps/office-bridge/contracts/redaction.js`) had been left containing dead placeholder text instead of a real path by an earlier automated redaction pass, silently disabling the protection. Fixed.
  - A hardcoded default-trust filesystem path pointing at one specific private project folder, used as an implicit authorized root for agent file access. Now configuration-driven via an explicit opt-in environment variable, with no default trust.
- **VulnClaw is integrated strictly defensively.** This project does not extend VulnClaw's capabilities beyond the existing findings-analysis integration, and Office Bridge only ever reads VulnClaw findings — it never writes to or invokes VulnClaw in an offensive capacity.
- **Owner-only access control is fail-closed by design**: any endpoint gated on `ALLINONE_TELEGRAM_OWNER_ID` (or the equivalent authorization check) rejects all callers until that value is explicitly configured — verified at runtime during Phase 49's build verification, not just asserted in code review.
- Hermes3D's bundled 3D/HDRI assets have an undeclared license and are excluded from this repository (see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)) — this is a licensing gap, not a security one, but is disclosed here for completeness since it affects what you may distribute if you add your own assets.

## Scope

This policy covers the code in this repository. It does not cover the security posture of any specific deployment, model provider, or third-party service you configure (e.g. Telegram, your chosen LLM provider) — those are your own responsibility to secure once configured.
