# Developer Guide

## Repository structure

```text
ALLINONE-AGENT/
  install.ps1 install.cmd setup.ps1 start.ps1 stop.ps1 restart.ps1 health.ps1 update.ps1 uninstall.ps1
  apps/            hermes3d/ (fully vendored, custom) · office-bridge/ (custom, no upstream)
  integration/      unified CLI Python package (platform_cli, org_provisioner, workflow_engine, ...)
  agents/roles/     11 role templates + instructions; identities generated fresh at install time
  automation/       C# launchers, watchdog, scheduled-task registrar, updater, maintenance scripts
  upstream/         components.lock.json + the Hermes3D customization patch
  config/           *.example.* configuration templates
  scripts/lib/      shared PowerShell modules (Preflight, InstallState)
  docs/             documentation (this file) + docs/legacy-platform-docs, docs/development-history (redacted archives)
  tests/            synthetic fixtures, unit/e2e tests
```

This layout, and the reasoning behind what was vendored fully (Hermes3D) vs. pinned-upstream-only (Paperclip, VulnClaw, Hermes Agent), is explained in [UPSTREAM-COMPONENTS.md](UPSTREAM-COMPONENTS.md).

## Building each component

These are the **actual commands that were run and verified to succeed** against a clean checkout during this effort's build-verification pass — not aspirational:

```powershell
# Hermes3D (Next.js / React Three Fiber / Phaser)
cd apps\hermes3d
npm install
npm run typecheck   # tsc --noEmit — 0 errors as of last verification
npm run build       # next build — succeeds, 32 routes generated

# Office Bridge (needs Node >= 22 — see docs/TROUBLESHOOTING.md)
cd apps\office-bridge
npm install

# Python unified CLI
# No third-party dependencies required (stdlib-only). Run from repo root, or set PYTHONPATH to it:
python -c "import integration.platform_cli"

# C# Windows launchers (needs .NET SDK 8)
dotnet build automation\launchers\OfficeServiceLauncher.csproj
dotnet build automation\launchers\PaperclipServiceLauncher.csproj
dotnet build automation\updater\CuaDriverProxy.csproj
```

Full build evidence and what's still untested: [TESTING.md](TESTING.md).

## Adding a new agent role

1. Duplicate an existing `agents/roles/<role>/` directory.
2. Register the new role (activation wave, budget, permissions) in `integration/org_provisioner.py`.
3. Add it to `config/permissions.example.json`'s `roles` section and wave lists.
4. Never hardcode a Paperclip UUID or real credential in the template — identities are always generated fresh by `org_provisioner.py` at install time.

## Adding a new office layout element

See [OFFICE-LAYOUT.md](OFFICE-LAYOUT.md) for the real 3D/2D feature structure before adding scenes/rooms — both modes must keep reading from the shared `src/features/office/` state layer rather than diverging.

## Branching and pull requests

See [../CONTRIBUTING.md](../CONTRIBUTING.md) for the workflow. CI runs on every PR — see [../.github/workflows/](../.github/workflows/) if present, and `CI-CD-GUIDE.md` (staging record from this effort's Phase 51) for what each workflow actually checks and what's deliberately deferred (`release.yml`, `integration-tests.yml` — both need infrastructure that doesn't exist yet).

## Security discipline for contributors

This repository has been through multiple real rounds of secret/privacy remediation during consolidation (see [README.md §14](../README.md#14-security--privacy)) — including bugs introduced by an earlier automated redaction pass itself. Before committing:

- Never hardcode a real path, username, Telegram ID, or API key — use the `ALLINONE_*` env-var scheme ([CONFIGURATION.md](CONFIGURATION.md)).
- An automated secret scanner alone is **not sufficient** — `detect-secrets` missed real low-entropy credentials during this effort's own audit. Review file contents manually for anything credential-shaped before committing, especially in `config/`.
