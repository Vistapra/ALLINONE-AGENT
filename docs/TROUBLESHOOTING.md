# Troubleshooting

Only real issues this effort actually encountered — nothing generic or invented.

## `office-bridge/server.js` fails to load: `Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite`

```text
Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite
    at .../adapters/vulnclaw-findings-adapter.js:14:26
```

**Cause**: three Office Bridge adapters (`vulnclaw-findings-adapter.js`, `analytics-telemetry-adapter.js`, `paperclip-adapter.js`) use `node:sqlite`, a Node **22.5+** builtin. This is a **pre-existing platform limitation** — confirmed identical in the original, non-consolidated installation too, not something introduced by this repo.

**Fix**: install Node >= 22. `install.ps1`'s preflight check now hard-fails on Node < 22 for exactly this reason (see [../README.md §4](../README.md#4-system-requirements)).

## Preflight reports `node: Fail` even though Node is installed

Your Node version is below the required 22.0.0 minimum. Check with `node --version`; see the fix above.

## `npm install` for Hermes3D prints `npm warn EBADENGINE`

Several dependencies (`@exodus/bytes`, `camera-controls`, `html-encoding-sniffer`, `jsdom`, `vite`) want Node `^20.19.0`/`^22.x`. The install still succeeds (npm only warns), and it's consistent with the Node >= 22 requirement above — not a separate problem.

## `ai-platform` CLI fails with `ModuleNotFoundError`

`integration/` must be importable as a Python package from wherever you invoke it — either run from the repo root, or set `PYTHONPATH` to point at it. This exact class of bug (a folder-naming mismatch between vendored files and their own internal import statements) was found and fixed once already during this effort's build verification — if you see it again in a different form, it's worth double-checking the actual folder name on disk matches what the Python `import` statements expect.

## Port already in use during preflight

Expected and reported as a `Warn`, not a hard failure, if you're running `-Mode Adopt` against an already-running installation. If this is meant to be a fresh install on an unused port, change the relevant port in your local config (see [CONFIGURATION.md](CONFIGURATION.md)) — ports 3100/54329/3200/3210 are defaults, not fixed.

## Owner-only endpoints reject every request

This is intentional, fail-closed behavior: set `ALLINONE_TELEGRAM_OWNER_ID` in your local config. An earlier version of this check was fail-open (an unset expected ID could match an unset caller ID and silently authorize) — this was found and fixed during this effort's security remediation; the current behavior is deliberately strict.

## PowerShell refuses to run `install.ps1` (execution policy)

Use `install.cmd` instead — it invokes `install.ps1` with execution policy bypassed for that single process only, without changing your system-wide PowerShell execution policy.

## `npm audit` reports vulnerabilities after installing Hermes3D's dependencies

24 known vulnerabilities (1 low, 11 moderate, 10 high, 2 critical) exist in the current dependency tree as of this writing. This repo deliberately did **not** run `npm audit fix --force`, since that rewrites lockfile pins without review and can silently break the build. Review and remediate deliberately before any production use — don't assume this has been handled.

## Known gaps, not yet resolved

- No live model-provider connectivity check in `setup.ps1`.
- Hermes3D's bundled 3D/HDRI assets (`apps/hermes3d/public/office-assets/`) have no declared license and are not distributed with this repo — you'll need to supply your own.
- See [TESTING.md](TESTING.md) and [README.md's Known Limitations](../README.md#21-known-limitations-batasan-yang-diketahui) for the full honest list.
