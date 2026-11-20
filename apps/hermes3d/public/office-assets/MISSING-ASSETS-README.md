# Missing 3D/HDRI/Background Assets

The following assets were deliberately **excluded** from this public repository because
their license/provenance could not be verified (see `PHASE-42-license-compliance.md` and
`THIRD-PARTY-NOTICES.md` in the project's analysis records for the full finding):

- `models/furniture/*.glb` (17 files: desk, chair, bookcase, kitchen appliances, lounge furniture, plants)
- `env/office_env_1k.hdr` (HDRI environment map)
- `backgrounds/office-bg.png` (background image)

No credits/attribution file exists anywhere in the original checkout confirming where these
came from. Filenames resemble a known free asset pack (possibly CC0), but this is an
**unverified naming-pattern inference, not a confirmed match** -- no credits.txt exists to confirm it.

## Before using this repository to build the 3D office

You must supply your own replacement assets at these exact paths, or source and verify the
license of the original assets yourself:

- `public/office-assets/models/furniture/` -- GLB models matching the names referenced in
  `src/features/retro-office/` (check that source for the exact filenames expected).
- `public/office-assets/env/office_env_1k.hdr` -- any CC0/public-domain or owned HDRI.
- `public/office-assets/backgrounds/office-bg.png` -- any background image you have rights to use.

Until these are supplied, the 3D office scene will fail to load these assets (expect 404s /
missing-texture placeholders in the Three.js scene).
