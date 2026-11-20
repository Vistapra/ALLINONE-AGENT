"""Zero-leak local Telegram Bot token verifier, owner DM detector, and gateway provisioner.
Reads bot token strictly from stdin (never argv, never stdout, never logs)."""

from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import sys
import os
from pathlib import Path
ALLINONE_USER_HOME = os.environ.get("ALLINONE_USER_HOME") or str(Path.home())


REPO = (ALLINONE_USER_HOME + r"\AppData\Roaming\npm\node_modules\hermes-agent\runtime\hermes-agent")
UPDATER = (ALLINONE_USER_HOME + r"\HermesUpdater")
sys._hermes_relaunched = True
for p in (REPO, UPDATER):
    if p not in sys.path:
        sys.path.insert(0, p)

from hermes_cli.telegram_managed_bot import is_valid_telegram_bot_token

onboard = importlib.import_module("telegram-onboard")


async def _detect_owner(token: str, wait_seconds: int) -> dict:
    from telegram import Bot

    bot = Bot(token=token)
    async with bot:
        me = await bot.get_me()
        await bot.delete_webhook(drop_pending_updates=False)
        deadline_loops = max(1, wait_seconds // 5)
        offset = None
        for _ in range(deadline_loops):
            updates = await bot.get_updates(offset=offset, timeout=5, allowed_updates=["message"])
            for upd in reversed(updates):
                msg = getattr(upd, "message", None)
                chat = getattr(msg, "chat", None) if msg else None
                user = getattr(msg, "from_user", None) if msg else None
                if chat and getattr(chat, "type", "") == "private" and user and not getattr(user, "is_bot", False):
                    return {
                        "ok": True,
                        "bot_id": me.id,
                        "bot_username": me.username,
                        "bot_name": me.first_name,
                        "detected_user": {
                            "id": str(user.id),
                            "username": user.username or "",
                            "first_name": user.first_name or "",
                            "last_name": user.last_name or "",
                            "text_preview": (msg.text or "")[:40],
                        },
                    }
            if updates:
                offset = updates[-1].update_id + 1
        return {
            "ok": True,
            "bot_id": me.id,
            "bot_username": me.username,
            "bot_name": me.first_name,
            "detected_user": None,
        }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["detect", "finalize"], required=True)
    ap.add_argument("--owner-id", default="")
    ap.add_argument("--bot-username", default="")
    ap.add_argument("--wait-seconds", type=int, default=25)
    args = ap.parse_args()

    token = sys.stdin.read().lstrip("\ufeff").strip()
    if not is_valid_telegram_bot_token(token):
        print(json.dumps({"ok": False, "error": "Format TELEGRAM_BOT_TOKEN tidak valid (harus angka:kode_rahasia)."}))
        return 1

    try:
        if args.mode == "detect":
            out = asyncio.run(_detect_owner(token, args.wait_seconds))
            print(json.dumps(out))
            return 0
        else:
            owner_id = args.owner_id.strip()
            if not owner_id.isdigit():
                print(json.dumps({"ok": False, "error": "Owner User ID harus berupa angka."}))
                return 1
            receipt = onboard.finalize_onboarding(token, owner_id, args.bot_username.strip() or None)
            print(json.dumps({"ok": True, "receipt": receipt}))
            return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: gagal menghubungi API Telegram (periksa token/koneksi)."}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
