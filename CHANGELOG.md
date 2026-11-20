# Changelog

All notable changes to this repository are recorded here. Dates use the actual date this work was performed.

## [Unreleased] — 2026-11-20 — Initial consolidation into ALLINONE-AGENT

First publication-candidate assembly of the platform as a single, installable repository. This was a multi-pass consolidation effort, not a single commit of existing files — summarized here at a level useful to someone deciding whether to trust/use this repo, not as an exhaustive diff.

### Added
- `install.ps1`, `install.cmd`, `setup.ps1`, `start.ps1`, `stop.ps1`, `restart.ps1`, `health.ps1`, `update.ps1`, `uninstall.ps1` — new installer and lifecycle scripts, statically validated and partially live-tested against a real machine, but not yet run end-to-end.
- `scripts/lib/Preflight.psm1`, `scripts/lib/InstallState.psm1` — shared installer modules, including a hard Node >= 22.0.0 version check.
- `automation/launchers/*.csproj`, `automation/updater/CuaDriverProxy.csproj` — new .NET project files enabling the existing C# launcher source to actually compile (none existed before; all three launchers now build clean with 0 errors on .NET 8).
- `apps/office-bridge/package.json` — Office Bridge had no package manifest in the original platform; added one so dependencies (currently just `ws`) are declared and installable.
- Configuration templates under `config/` (`.example` files for Telegram, maintenance schedule, permissions, Office Bridge auth shape, Paperclip agent profile, platform environment variables).
- Documentation: this `README.md` / `README_EN.md`, `SECURITY.md`, `CONTRIBUTING.md`, plus the install/setup/telegram/model-provider/agent-role/service-management/maintenance guides.

### Fixed (real bugs found during consolidation, not hypothetical)
- A fail-open owner-authorization check in Office Bridge's auth logic (unset expected ID could match unset caller ID) — now fail-closed.
- Dead placeholder text left by an earlier automated redaction pass in a credential-access protection list (`FORBIDDEN_ROOTS`), which had silently disabled that protection.
- A hardcoded default-trust filesystem path pointing at a specific private project — replaced with a configuration-driven, opt-in, fail-closed mechanism.
- A Python package-naming mismatch (`integrations/unified-cli/` vs. the code's own `integration.<module>` imports) that would have crashed the CLI, health-check, and maintenance coordinator on first real use.
- Several PowerShell scripts with `${VAR}`-style tokens trapped inside single-quoted strings (never expanded), including one that silently disabled a post-update health-heal call.
- Several instances of dead literal placeholder text (e.g. `<owner-username>`) left in real path strings by an earlier automated redaction pass — these parsed fine but matched no real path at runtime.

### Changed
- Node.js requirement raised to >= 22.0.0 (from an undocumented, inconsistently-enforced "Node 20-ish" assumption), because Office Bridge's VulnClaw-findings/analytics adapters require the `node:sqlite` builtin (Node 22.5+). This is a pre-existing incompatibility in the original platform, not introduced here — it is now explicitly checked and documented instead of silently failing.

### Known limitations as of this entry
See the **Known Limitations** section of [README.md](README.md) / [README_EN.md](README_EN.md) for the full, current list (end-to-end install testing not yet performed, Hermes3D 3D-asset licensing undeclared, this repo's own code license not yet chosen, and others).
