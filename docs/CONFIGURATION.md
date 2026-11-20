# Configuration Reference

## Environment variables and path resolution

| Variable | Purpose | Default when unset |
|---|---|---|
| `ALLINONE_HOME` | Platform root (equivalent of the original reference machine's platform directory) | OS user-profile API (`Path.home()` / `Environment.GetFolderPath` / `$HOME`) + `\ALLINONE-AGENT` — never a hardcoded path |
| `ALLINONE_HERMES_HOME` | Hermes Agent home directory | `%LOCALAPPDATA%\hermes` |
| `ALLINONE_USER_HOME` | The installing user's profile root | current user's home directory |
| `ALLINONE_TELEGRAM_OWNER_ID` | Numeric Telegram ID authorized for owner-only Office Bridge mutations | unset — mutation endpoints **fail-closed** (reject everyone) until you set this |
| `ALLINONE_EXTRA_AUTHORIZED_ROOTS` | Extra filesystem roots an agent may read/scan, beyond `$ALLINONE_HOME/workspaces` and `$ALLINONE_HOME/reports` | empty — no extra roots trusted by default |

`ALLINONE_DATA_DIR` / `ALLINONE_RUNTIME_DIR` / `ALLINONE_CONFIG_DIR` / `ALLINONE_LOG_DIR` / `ALLINONE_WORKSPACE_DIR` are **not** separate env vars today — in the current source they're simple subpaths of `ALLINONE_HOME` (`data/`, `runtime/`, `config/`, `logs/`, `workspaces/`). Introduce a dedicated variable only if you actually need to relocate one of them independently.

### Precedence order

1. Built-in default (derived from OS user-profile APIs, never a hardcoded path).
2. `ALLINONE_HOME` / `ALLINONE_HERMES_HOME` / `ALLINONE_USER_HOME` environment variables, when set.
3. Local configuration files (`config/platform.local.env`, etc.) — read later in each component's own startup sequence, so an explicit value there wins over the env-var-derived default.
4. Explicit CLI/runtime overrides (e.g. a flag passed to `platform_cli.py`), where a command supports one.

No layer here lets upstream or remote configuration override a locally-set credential or permission — these variables only ever resolve **paths**, never secrets or permissions.

## Configuration templates (`config/*.example.*`)

Copy each to its non-`.example` name and fill in real values. **Never commit the filled-in copy** — `.gitignore` excludes the real filenames already, this is defense-in-depth, not the only protection.

| Template | What it configures | Notes |
|---|---|---|
| `platform.local.env.example` | Platform-wide env vars (`ALLINONE_HOME`, Telegram/API keys, etc.) | `install.ps1` copies this to `config/platform.local.env` for you. Derived from an actual grep of `process.env.*`/`os.environ[...]` usage across the real source — a starting point, not guaranteed exhaustive. |
| `office-bridge-auth.example.json` | Office Bridge access token, owner RBAC ID, CORS allowlist, rate limit | Schema derived from public architecture docs only — the real file is a mandatory publication exclusion and was never opened to build this template. Field names are marked `TODO: unconfirmed` where not independently verified against a running instance. |
| `telegram.example.yaml` | Human-readable reference for the Telegram bot token / owner ID | **Not read directly by the platform today** — real values live in `platform.local.env` as `TELEGRAM_BOT_TOKEN`/`TELEGRAM_OWNER_ID`. This file documents what those mean; don't build a code path that reads this `.yaml` until a structured-config migration happens. |
| `maintenance.example.json` | Maintenance window (default 03:00 Asia/Jakarta), offline catch-up, active-task deferral | Thresholds generalized from the reference install's hardcoded disk-guard value to be portable across drive layouts. |
| `permissions.example.json` | Agent workspace allowlist, Wave-1/Wave-2 activation plan, per-role tool permissions | Deliberately contains **no** Paperclip UUIDs — those are generated fresh per install by `integration/org_provisioner.py`, never copied from a template. `workspace_allowlist` never defaults to a whole drive; `setup.ps1` actively refuses that pattern. |
| `paperclip-agent-profile.example.env` | Per-agent Paperclip API key scoping | Each Hermes worker profile (`profiles/pc<role>/.env`) gets its own scoped key, kept separate from the platform-wide env file. Paperclip itself is a pinned-reference dependency with its own configuration docs — this only covers the per-agent key surface. |
| `resource-limits.example.json` | Concurrency/turn/timeout limits tuned for low-spec hardware | Reflects the actual reference machine's profile (Pentium G5400, ~8GB RAM, Docker disabled) as one real example, not a universal requirement. |

## Credential rotation

The reference installation's Telegram bot token and model API key are **not rotated** as of this writing (confirmed from the platform's own security audit). A fresh install from this repo never reads or reuses those values — it always starts from the `.example` templates above. See [ADMIN-GUIDE.md](ADMIN-GUIDE.md#credential-rotation) for how to set up fresh credentials, and [README.md §14](../README.md#14-security--privacy) for the full rotation-status disclosure.
