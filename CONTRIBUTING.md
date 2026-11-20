# Contributing to ALLINONE-AGENT

## Before you start

Read [README.md](README.md) / [README_EN.md](README_EN.md) in full, especially **Known Limitations** — several things described there as "not yet tested" or "not yet decided" are real, open problems a contribution could usefully address, not just disclaimers.

## Reporting bugs / requesting features

Open a GitHub issue. Include:
- What you expected vs. what happened.
- Exact command(s) run (e.g. `.\install.ps1 -Mode Fresh -DryRun`).
- Your OS version, Node version, .NET SDK version if relevant (`node --version`, `dotnet --version`).

**Never include real credentials, tokens, or private file paths from your own machine in an issue.** Redact them first.

## Making a change

1. Create a branch off `main`.
2. For changes under `apps/hermes3d/`: run `npm install && npm run typecheck && npm run build` before opening a PR — these must stay passing (the project's build-verification baseline: 0 TypeScript errors, successful `next build` with 32 routes, as of the last verified build).
3. For changes under `automation/launchers/*.cs`: run `dotnet build` on the relevant `.csproj` and confirm 0 errors.
4. For changes under `integration/`: confirm `python -c "import integration.<your_module>"` works with the repo root on `PYTHONPATH` — this project has a documented history of package-naming bugs that passed syntax checks but failed at import time; don't assume a parse pass means it works.
5. For PowerShell changes: confirm the file still parses (`[System.Management.Automation.Language.Parser]::ParseFile(...)`) **and** actually import/run the function you changed — this project has also found real bugs (variable-expansion issues, parameter-block ordering) that passed static parsing but were broken at runtime.
6. Never commit real credentials, tokens, absolute paths from your own machine, or any file matching the patterns excluded by `.gitignore`.
7. Open a pull request describing what changed and why, referencing the issue if any.

## Code of conduct

Be respectful. This is a small, early-stage project — assume good faith, ask questions before assuming malice, and keep discussion focused on the code.

## Security issues

Do not open a public issue for a security vulnerability — see [SECURITY.md](SECURITY.md).
