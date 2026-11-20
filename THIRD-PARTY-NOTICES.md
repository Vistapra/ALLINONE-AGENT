# Third-Party Notices

ALLINONE-AGENT incorporates or depends on the following third-party components. Each retains its own license and copyright, reproduced below from the actual upstream LICENSE/NOTICE files.

---

## Hermes Agent (npm bridge)
Repository: https://github.com/wyrtensi/hermes-agent-npm
License: MIT
Copyright (c) 2026 wyrtensi

## Hermes Agent (upstream, fetched by the bridge)
Repository: https://github.com/NousResearch/hermes-agent
License: MIT
Copyright (c) 2025 Nous Research

The npm bridge above does not claim ownership of Hermes Agent, its source, or Nous Research's marks. The published npm package contains bridge/orchestration code only; actual upstream source is fetched at install time at a pinned release tag.

---

## Paperclip
Repository: https://github.com/paperclipai/paperclip
License: MIT
Copyright (c) 2025 Paperclip AI

---

## VulnClaw
Repository: https://github.com/Netw0rkNoob/VulnClaw
License: MIT
Copyright (c) 2026 UncleC

Used here strictly as a defensive-security integration, per existing project scope; this project does not extend VulnClaw's capabilities beyond that integration.

---

## Hermes3D
Repository: https://github.com/iamlukethedev/Hermes3D
License: MIT
Copyright (c) 2026 Luke The Dev

This project includes local modifications to Hermes3D (see `upstream/patches/hermes3d-unified-ai-company.patch`). Modifications are provided under the same MIT terms as the original; original copyright notice above is preserved per MIT's attribution requirement.

**Bundled 3D/texture/HDRI assets under `public/office-assets/`: license status UNDECLARED.** No credits or license file accompanies these binary assets in the upstream repository. Provenance has not been confirmed. These assets are excluded from any public release pending owner confirmation of source and license — see PHASE-42-license-compliance.md and PUBLICATION-EXCLUSIONS.md (maintained by the Phase 41 secret/privacy audit).

---

*This file is a draft generated during license-compliance review. All copyright lines above were copied verbatim from each project's own LICENSE/NOTICE file — none were invented.*
