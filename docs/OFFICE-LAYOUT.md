# Office Layout — 3D & 2D Virtual Office

Reference for the vendored Hermes3D office template at `apps/hermes3d/`. Supersedes
`docs/legacy-platform-docs/OFFICE-LAYOUT.md` (kept as historical/redacted reference only).

## Structural verification performed in this pass

Spot-checked (file/directory presence and rough completeness, not full content review — that's Phase 49's
build verification and Phase 53's execution testing):

- **3D office** — `src/features/retro-office/`: scene (`scene/environment.tsx`), systems
  (`NavigationSystem.tsx`, `cameraLighting.tsx`, `atmosphere.tsx`, `visualSystems.tsx`), objects
  (`agents.tsx`, `furniture.tsx`, `kitchen.tsx`, `machines.tsx`), and a dedicated QA-lab navigation route
  (`core/navigation/qaLabRoute.ts`) alongside gym/phone-booth/server-room/SMS-booth routes — present and
  structurally non-trivial (14+ files under `core/` alone).
- **2D office** — `src/features/pixel-office/`: tile/sprite art pipeline (`art/`), a dedicated nav grid
  (`map/navGrid.ts`, `map/hermesHqMap.ts`), scene bridge (`PixelSceneBridge.ts`), and agent simulation
  (`sim/agentSimulation.ts`) — present.
- **Company Hub / live overlay** — `src/features/enterprise-company/` (`EnterpriseOfficeOverlay.tsx`,
  `useEnterpriseCompanyLive.ts`) — present; this is the feature with uncommitted custom work captured in
  `upstream/patches/hermes3d-unified-ai-company.patch` (Phase 42).
- **Shared data source for 3D and 2D** — both reference a common `src/features/office/` layer:
  `state/useOfficeBuilderStore.ts` plus hooks (`useOfficeFloorRuntimePersistence.ts`,
  `useOfficeStandupController.ts`, `useOfficeSkillTriggers.ts`, `useOfficeSkillsMarketplace.ts`,
  `useOfficeUsageAnalyticsViewModel.ts`). This is structural evidence that 3D and 2D are not two independent
  implementations with divergent state, consistent with `OFFICE-EVENT-SCHEMA.md`'s description of a shared
  event schema. **Not** independently runtime-verified in this pass (no dev server was started) — Phase 49
  (build) and Phase 53 (execution/browser testing) are the authoritative checks for actual behavioral parity.

## Department / room coverage

Keyword-level presence confirmed for: executive, engineering, QA lab, security center, meeting room,
operations, lobby (via `constants.ts`, `furnitureDefaults.ts`, `geometry.ts`, navigation routes, and the
pixel-office HQ map). Per-department desk assignment for all 11 roles (`exec-desk-01/02`, `eng-desk-01..03`,
`qa-desk-01`, `soc-desk-01..04`, `comp-desk-01`) is documented in the original `AGENT-ROLES.md` reference and
is the same assignment used by `docs/AGENT-ROLES.md`'s role table — no redesign performed in this pass.

## What this phase did NOT do

- Did not start a dev server or render either scene.
- Did not run or modify `hermes3d`'s own test suite (`tests/unit/officeEventTriggers.test.ts`,
  `useOfficeFloorRuntimePersistence.test.ts`, etc.) — those run for real as part of Phase 49/53.
- Did not touch any file under `apps/office-bridge/`, `scripts/`, or the installer/lifecycle scripts — that
  is Phase 48's scope (running concurrently).
