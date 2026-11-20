# Telegram Setup

Telegram integration is **optional**. Skip this entirely to run the 3D/2D office without it —
`setup.ps1` defaults to disabled.

> **This guide is for connecting a NEW bot/token to a NEW installation.** It is not a guide for
> reusing any existing bot or token from a prior installation. If you are adopting an existing
> installation on this machine and its Telegram credentials were ever exposed (pasted into a
> chat, a log, a screenshot, or committed anywhere), rotate them in BotFather **before** reusing
> them — see `CREDENTIAL-ROTATION-STATUS.md` for why this matters.

## 1. Create your own bot

1. Open a chat with **@BotFather** in Telegram.
2. Send `/newbot` and follow its prompts (choose a name and a `_bot`-suffixed username).
3. BotFather replies with a token shaped like `123456789:AAExampleExampleExampleExampleExample`.
   This is a secret — treat it like a password. Never paste it into a chat, commit it to git, or
   put it in a file you intend to share.

If you're rotating an existing bot's token instead of creating a new one: open the bot in
BotFather, use `/revoke` (or the token-regeneration option in its menu) to invalidate the old
token and issue a new one.

## 2. Find your numeric owner ID

Message **@userinfobot** (or any similar "what's my ID" bot) and it will reply with your numeric
Telegram user ID. This is **not** your `@username` — it's a plain number. This becomes the single
authorized owner for platform commands; every other caller is rejected.

## 3. Configure locally

Run `.\setup.ps1`, answer `y` to the Telegram prompt, and paste the token and numeric ID when
asked. This writes `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_ID` into
`config\platform.local.env` — a local file, never committed, never published. See
[config/telegram.example.yaml](config/telegram.example.yaml) for what each value means and how
the single-consumer polling / fail-closed authorization model works.

Alternatively, edit `config\platform.local.env` directly instead of re-running the wizard.

## 4. Run the gateway and test

```powershell
.\start.ps1
.\health.ps1
```

From your own Telegram account (the one matching the owner ID you configured), send:

```
/help_platform
```

You should get a reply listing the supported commands. This confirms: the bot token works, the
gateway is polling, and your owner ID is correctly recognized.

## 5. Confirm unauthorized access is actually rejected

From a **different** Telegram account (or ask a friend), send the same bot any command, e.g.
`/platform_status`. It should be silently rejected or receive an explicit permission error — it
must **not** receive platform status, task data, or any other authorized response. If an
unauthorized account gets a real response, stop and treat this as a security bug before using
the integration further — do not proceed to connect it to anything containing real task or
findings data.

## What this project does NOT verify for you

`setup.ps1` does not call the Telegram API to confirm your token/ID are valid before writing
them — it trusts what you typed and marks this `[NOT VERIFIED]` in its own output. Steps 4 and 5
above are the actual verification; don't skip them.
