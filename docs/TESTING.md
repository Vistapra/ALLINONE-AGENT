# Testing Status

Honest, as-of-this-writing status. "Verified" below means a real command was actually executed and its real output checked — not that the capability was merely read through or assumed to work.

## Verified so far (build/compile/static verification)

| Target | Result | Evidence |
|---|---|---|
| Hermes3D: `npm install` | PASS | 637 packages installed clean on a genuinely empty `node_modules` |
| Hermes3D: `npm run typecheck` (`tsc --noEmit`) | PASS | 0 TypeScript errors, including files touched across three security-remediation passes |
| Hermes3D: `npm run build` (`next build`) | PASS | Production build succeeded, 32 routes generated |
| Python `integration/` package | PASS | All modules import cleanly from a fresh process with `PYTHONPATH` set to repo root; stdlib-only, no third-party deps needed |
| C# launchers (`OfficeServiceLauncher`, `PaperclipServiceLauncher`, `CuaDriverProxy`) | PASS | `dotnet build` with .NET SDK 8.0.428 — 0 compile errors across all three, first time any of them has actually been compiled in this effort |
| Office Bridge: `npm install` | PASS | A missing `package.json` was found and added; install succeeds |
| Office Bridge: smoke-load | PARTIAL | Fail-closed owner-auth behavior confirmed firing correctly at runtime; load fails on Node < 22 due to `node:sqlite` (see [TROUBLESHOOTING.md](TROUBLESHOOTING.md)) — a pre-existing platform limitation |
| Full-tree syntax validation | PASS | JavaScript/CJS/MJS 41/41, Python 38/38, PowerShell 18/18 (via `node --check`, `py_compile`, and PowerShell's real AST parser — not just "looks fine") |

## NOT yet verified (scheduled, not done)

- **Full end-to-end installation** (`install.ps1` run from a truly clean machine through to all services healthy) — has never been executed on any machine, including the reference machine. Individual stages have been statically validated and a handful of read-only Preflight functions have been run live, but the orchestrator has never been run start-to-finish.
- **Real agent execution** — the 11 agent roles are provisioned-by-design (verified via `org_provisioner.py`'s logic), but no agent has actually been run against a live task as part of this effort.
- **Multi-agent meeting, end-to-end** — see [MEETING-GUIDE.md](MEETING-GUIDE.md) for exactly what is and isn't confirmed here.
- **3D/2D runtime parity** — confirmed structurally (shared code), not behaviorally (no dev server run to compare).
- **Browser-based UI testing** — not performed.
- **Cross-interface testing** (Telegram → Paperclip → Hermes → 3D Office and reverse) — not performed; Telegram integration itself requires a freshly rotated token the reference install does not have configured for this purpose.
- **Load/performance testing** beyond the single low-spec reference machine's informal build timings.

## Why the gap

This effort's own discipline (see [README.md's status banner](../README.md)) is to never claim a test passed unless it actually ran. The items above are real, scoped next steps — not forgotten, not hidden. If you run any of them yourself, please report results via an issue (see [../SECURITY.md](../SECURITY.md) for security-sensitive findings specifically) so this file can be updated with real evidence rather than being the only perpetually-"pending" status.

## A note on an old test-count discrepancy

The original platform's own historical reports contained a self-contradiction: one section claimed "390/390 PASS, 0 NOT_TESTED," while another section of the *same document* said "387 PASS, 0 FAIL, 3 NOT_TESTED." This repo does not republish either figure as settled fact.

This repo does ship one of the raw source artifacts behind that claim, unmodified, at
[`docs/development-history/test-evidence/office-e2e-results.json`](../docs/development-history/test-evidence/office-e2e-results.json)
— it reports "390/390, 0 FAIL, 0 NOT_TESTED" internally. It is kept as-is for historical/audit
transparency (this is what the original platform actually produced), **not** as a verified
claim by this repository. Treat it, and the other files under `test-evidence/`, as primary
source material to independently re-check — not as ground truth — exactly like the rest of
the original platform's historical reports.
