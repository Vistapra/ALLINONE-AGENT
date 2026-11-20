# First-Run Setup

This walks through `setup.ps1`, the first-run configuration wizard. Run it after `install.ps1`
has completed (see [INSTALLATION.md](INSTALLATION.md)).

## Interactive mode

```powershell
.\setup.ps1
```

You'll be prompted for, in order:

1. **Model provider** — a base URL and model name. The reference installation this project was
   consolidated from used a custom provider named `combo/X`; that remains a supported example,
   but it is **not validated or endorsed by this project** — it's one configuration a prior user
   happened to use, not a recommendation. Any OpenAI-compatible endpoint should work. Leave blank
   to configure this later by editing `config\platform.local.env` directly.
2. **Owner authentication token** — generated fresh, every run, from a cryptographically random
   32-byte value. It is printed to your terminal **once**. Store it in a password manager
   immediately; it is not logged anywhere and `setup.ps1` will not show it to you again.
3. **Telegram integration (optional)** — answer `N` (the default) to skip entirely and run the
   3D/2D office without it. If you answer `y`, read [TELEGRAM-SETUP.md](TELEGRAM-SETUP.md)
   before pasting a token.
4. **Workspace allowlist** — comma-separated folder paths the agents are authorized to operate
   on. `setup.ps1` actively refuses an entire drive root (e.g. `D:\`); give it specific project
   folders instead. You can leave this blank and add paths later by re-running `setup.ps1` or
   editing `config\workspace-allowlist.json` directly.

What gets written:
- `config\platform.local.env` — merged from `config\platform.local.env.example`, with your
  answers for `HERMES_API_URL`, `HERMES_MODEL`, `STUDIO_ACCESS_TOKEN`, and (if enabled)
  `TELEGRAM_BOT_TOKEN` / `TELEGRAM_OWNER_ID`.
- `config\workspace-allowlist.json` — your authorized folder list.

## Non-interactive mode (scripted / CI)

```powershell
.\setup.ps1 -NonInteractive -ConfigFile answers.json
```

`answers.json` keys: `InstallPath`, `ModelApiBaseUrl`, `ModelName`, `EnableTelegram`,
`TelegramBotToken`, `TelegramOwnerId`, `WorkspaceAllowlist` (array of paths). Any required field
missing from the file causes `setup.ps1` to fail fast rather than silently guessing a value —
see [INSTALLER-REFERENCE.md](INSTALLER-REFERENCE.md) for the full parameter reference.

**Never put a real `TelegramBotToken` or API key directly in a config file you intend to commit
to version control or share.** Treat `answers.json` the same as `config\platform.local.env` —
local-only, never published.

## What this script does NOT do yet

- It does not call out to your model provider to verify the base URL/model actually work —
  connectivity verification is a known gap, marked `[NOT VERIFIED]` in the script's own output.
- It does not call the Telegram API to verify a pasted token/owner ID are valid — test with one
  safe command after setup, per [TELEGRAM-SETUP.md](TELEGRAM-SETUP.md).
- It does not register scheduled tasks or start any service — that's `install.ps1`'s job (for
  registration) and `start.ps1` (to bring services up). Run `.\health.ps1` first to confirm
  what's actually reachable before starting anything.

## Next steps

```powershell
.\health.ps1
.\start.ps1
```
