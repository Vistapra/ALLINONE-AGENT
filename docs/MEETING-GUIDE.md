# Multi-Agent Meeting — What's Verified and What Isn't

This feature received more scrutiny than any other during this consolidation effort, because the original brief's claims about it were found to be partially unsubstantiated. Read this file before relying on the meeting feature for anything important.

## What is structurally verified

- **The real customization exists**: `apps/hermes3d/` carries a genuine 24-file customization (23 modified + 1 new test file, captured as `upstream/patches/hermes3d-unified-ai-company.patch` against clean upstream commit `21215d7`) touching `src/features/enterprise-company/` (`EnterpriseOfficeOverlay.tsx`, `useEnterpriseCompanyLive.ts`), `src/features/office/hooks/useOfficeStandupController.ts`, and `src/app/api/path-suggestions/route.ts` — this is real, specific, in-progress work, not invented.
- **A new test exists for exactly this**: `tests/unit/standup3dAll11Agents.test.ts` was found as a new, untracked file in the same customization — its name strongly suggests it's the "all 11 agents" meeting test the original brief references.
- **3D and 2D share a state layer**: both `retro-office` (3D) and `pixel-office` (2D) import from a common `src/features/office/` hooks/store layer — confirmed by reading the actual imports, not assumed.
- **Organization structure is real**: the Wave-1 (CEO, Backend Developer, QA Engineer, Security Reviewer) / Wave-2 (remaining 7) split is verified directly against `integration/org_provisioner.py`'s `active_initially` flags — one of the few claims from the original brief that held up exactly as stated.
- **(New, 2026-11-21) The meeting test actually passes, repeatedly**: `tests/unit/standup3dAll11Agents.test.ts` was executed for real as part of the full Hermes3D test suite (`vitest run`) — it passed in **5 of 5 full-suite runs**, alongside 1233/1233 other tests across 186 test files. This is real evidence the meeting *logic* (as exercised by this test's assertions) behaves correctly, not just that the file compiles.

## What is NOT yet verified

- **No dev server has been run end-to-end** to confirm 3D and 2D actually render identical meeting state at runtime — the shared-module evidence is structural (same imports), not behavioral (same observed output).
- **No live, visual, multi-agent meeting with real LLM calls has been executed** as part of this effort. This was a deliberate scope decision, not an oversight: credential rotation for the Telegram bot token and model API key is confirmed not done on the reference installation, and the owner's explicit choice for this testing pass was to use existing live credentials for read-only status checks only — not to run new paid inference or create new agents/companies. The original brief's claim that "Meeting Room untuk 11 agent" is complete, with documented evidence of a finished multi-agent meeting, was specifically investigated and **not found** as a separate artifact — the unit test above is the closest real evidence available as of this writing.
- **Pathfinding and task delegation mechanisms are present in code and covered by the passing unit test above**, but whether they produce a coherent, *visually observable* working meeting experience (agents correctly navigating to a meeting room on screen, correctly reporting status, correctly returning to prior state afterward) has not been observed in a running browser session.

## What this means practically

Treat the meeting feature as: **the plumbing is there, the wiring is consistent, and its core logic now has a real passing automated test — but nobody has watched it work live, on screen, with real agents talking to a real model, end-to-end yet.** If you use this feature for anything important, verify the live outcome yourself rather than assuming the passing unit test guarantees a correct visual/live result. Live multi-agent execution remains explicitly out of scope until credentials are rotated by the owner.

See also: [ARCHITECTURE.md](ARCHITECTURE.md#3d--2d-shared-state), [TESTING.md](TESTING.md), [USER-GUIDE.md](USER-GUIDE.md#4-calling-a-meeting), and [README.md's Known Limitations](../README.md#21-known-limitations-batasan-yang-diketahui).
