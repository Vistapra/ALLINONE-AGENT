## What changed and why

## Checklist

- [ ] No real credential, token, UUID, username, or private path was added anywhere in this diff
      (see `PUBLICATION-EXCLUSIONS.md` / `docs/SECURITY.md` for what counts).
- [ ] If this touches `apps/office-bridge/**` authorization code, workspace-allowlist logic, or
      anything reading `ALLINONE_*` environment variables for access control: I re-checked that
      the default behavior is fail-closed (deny/empty by default), not fail-open.
- [ ] If this touches a `.ps1`/`.psm1` file: it still parses with
      `[System.Management.Automation.Language.Parser]::ParseFile` (CI checks this, but verify
      locally too — several real bugs in this project's history parsed fine but were
      semantically broken, e.g. `${VAR}` trapped in a single-quoted string).
- [ ] If this touches `apps/hermes3d/**`: `npm run typecheck` and `npm run build` pass locally.
- [ ] If this touches a C# launcher under `automation/launchers/` or `automation/updater/`:
      `dotnet build` passes locally.
- [ ] I did not vendor a new copy of Paperclip/VulnClaw/Hermes-Agent source — those are
      pinned-upstream by design (see `upstream/components.lock.json`); changes there belong
      upstream or in `upstream/patches/`.

## Testing performed

## Anything a reviewer should double-check
