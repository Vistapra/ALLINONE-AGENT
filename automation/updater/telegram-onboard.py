"""Official Hermes Telegram Onboarding & Strict Owner-Only Gateway Provisioner (Zero Secret Exposure).

Subcommands:
  start --qr-out <path.png>   Create official 30-min Hermes Telegram pairing & render QR PNG.
  apply-existing              Lock config.yaml + install Hermes_Gateway from existing .env credentials.
  watch                       Poll pending pairing (or .env) up to expiry, auto-lock owner ID, send live
                              verification DM + screenshot, and install/start Hermes_Gateway.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path
ALLINONE_HERMES_HOME = os.environ.get("ALLINONE_HERMES_HOME") or str(Path.home() / "AppData" / "Local" / "hermes")
ALLINONE_USER_HOME = os.environ.get("ALLINONE_USER_HOME") or str(Path.home())


REPO = (ALLINONE_USER_HOME + r"\AppData\Roaming\npm\node_modules\hermes-agent\runtime\hermes-agent")
sys._hermes_relaunched = True
if REPO not in sys.path:
    sys.path.insert(0, REPO)

from hermes_cli.config import (
    get_env_value,
    get_hermes_home,
    load_config,
    save_config,
    save_env_value,
)
from hermes_cli.telegram_managed_bot import (
    TelegramPairing,
    create_pairing,
    is_valid_telegram_bot_token,
    poll_pairing_result_once,
)

STATE_DIR = Path((ALLINONE_USER_HOME + r"\HermesUpdater\state"))
STATUS_FILE = STATE_DIR / "telegram_onboard_status.json"
SCREENSHOT_TEST = Path((ALLINONE_HERMES_HOME + r"\cache\deliveries\e2e_notepad_gui_test.png"))


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _pending_file() -> Path:
    p = Path(get_hermes_home()) / "pairing"
    p.mkdir(parents=True, exist_ok=True)
    return p / "telegram_onboarding_pending.json"


def _write_status(payload: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATUS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    tmp.replace(STATUS_FILE)


def lock_owner_configuration(token: str | None, owner_id: str, bot_username: str | None = None) -> None:
    """Save credentials & lock strict owner-only policy in .env and config.yaml without printing secrets."""
    owner_str = str(owner_id).strip()
    if not owner_str.isdigit():
        raise ValueError(f"Owner Telegram user ID must be numeric, got: {owner_str!r}")

    if token:
        if not is_valid_telegram_bot_token(token):
            raise ValueError("Invalid Telegram bot token shape")
        save_env_value("TELEGRAM_BOT_TOKEN", token)

    save_env_value("TELEGRAM_ALLOWED_USERS", owner_str)
    save_env_value("TELEGRAM_HOME_CHANNEL", owner_str)
    save_env_value("TELEGRAM_ALLOW_ALL_USERS", "false")
    save_env_value("GATEWAY_ALLOW_ALL_USERS", "false")

    cfg = load_config()
    cfg.setdefault("gateway", {})
    cfg["gateway"]["allow_all_users"] = False
    cfg["gateway"]["strict"] = False
    cfg["gateway"]["unauthorized_dm_behavior"] = "decline"
    cfg["gateway"]["unauthorized_dm_decline_message"] = (
        "Akses ditolak. Hermes Agent ini bersifat privat dan hanya dapat diakses oleh pemilik resmi."
    )

    cfg.setdefault("approvals", {})
    cfg["approvals"]["mode"] = "smart"
    cfg["approvals"]["timeout"] = 300
    cfg["approvals"]["cron_mode"] = "deny"
    cfg["approvals"]["single_query_mode"] = "deny"
    cfg["approvals"]["unattended_mode"] = "deny"
    cfg["approvals"]["destructive_slash_confirm"] = True
    cfg["approvals"]["approvers"] = [owner_str]

    cfg.setdefault("platforms", {})
    cfg["platforms"].setdefault("telegram", {})
    extra = cfg["platforms"]["telegram"].setdefault("extra", {})
    extra["dm_policy"] = "allowlist"
    extra["allow_from"] = [owner_str]
    extra["allow_admin_from"] = [owner_str]
    extra["group_allow_admin_from"] = [owner_str]
    extra["group_policy"] = "disabled"
    extra["guest_mode"] = False
    extra["unauthorized_dm_behavior"] = "decline"
    extra["status_indicator"] = True
    extra["status_online"] = "🟢 Online"
    extra["status_offline"] = "🔴 Offline"
    extra["gateway_restart_notification"] = True

    save_config(cfg)


async def _verify_bot_and_send_welcome(token: str, owner_id: str) -> dict:
    """Verify token via getMe and send initial welcome + GUI test screenshot to owner DM before gateway starts."""
    from telegram import Bot

    info: dict = {
        "bot_id": None,
        "bot_username": None,
        "welcome_sent": False,
        "welcome_message_id": None,
        "screenshot_sent": False,
        "screenshot_message_id": None,
        "dm_note": None,
    }
    bot = Bot(token=token)
    async with bot:
        me = await bot.get_me()
        info["bot_id"] = me.id
        info["bot_username"] = me.username
        # Ensure no stale webhook blocks outbound long polling
        await bot.delete_webhook(drop_pending_updates=False)
        try:
            msg = await bot.send_message(
                chat_id=int(owner_id),
                text=(
                    "✅ Hermes Agent Windows Remote Command Center AKTIF!\n\n"
                    f"• Host: Windows 10 Pro ({os.environ.get('COMPUTERNAME', 'LocalPC')})\n"
                    f"• Owner Telegram ID terkunci: {owner_id} (allowlist ketat, grup nonaktif)\n"
                    "• Akses aktif: File System (C:\\ & D:\\), Local Terminal, Coding, Browser, & GUI Computer Use\n"
                    "• Mode Keamanan: Smart Approvals + Hardline Guard\n\n"
                    "Silakan balas pesan ini (mis. 'cek status sistem' atau perintah apa saja) untuk uji kendali penuh."
                ),
            )
            info["welcome_sent"] = True
            info["welcome_message_id"] = msg.message_id
            if SCREENSHOT_TEST.exists() and SCREENSHOT_TEST.stat().st_size > 1000:
                with SCREENSHOT_TEST.open("rb") as fh:
                    photo_msg = await bot.send_photo(
                        chat_id=int(owner_id),
                        photo=fh,
                        caption="📸 Bukti uji tangkapan layar GUI Windows (Hermes computer_use / cua-driver).",
                    )
                info["screenshot_sent"] = True
                info["screenshot_message_id"] = photo_msg.message_id
        except Exception as exc:
            # If user hasn't pressed Start yet in a manual bot, record cleanly without leaking token
            info["dm_note"] = type(exc).__name__
    return info


def stop_gateway_cleanly() -> None:
    hermes_cmd = (ALLINONE_USER_HOME + r"\AppData\Roaming\npm\hermes.cmd")
    if not Path(hermes_cmd).exists():
        hermes_cmd = "hermes"
    subprocess.run(
        ["cmd.exe", "/d", "/s", "/c", f'"{hermes_cmd}" gateway stop < NUL'],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    subprocess.run(["schtasks.exe", "/End", "/TN", "Hermes_Gateway"], capture_output=True)
    subprocess.run(["taskkill.exe", "/F", "/IM", "HermesGatewayLauncher.exe"], capture_output=True)
    pid_file = Path(get_hermes_home()) / "gateway.pid"
    if pid_file.exists():
        try:
            gpid = json.loads(pid_file.read_text(encoding="utf-8")).get("pid")
            if gpid:
                subprocess.run(["taskkill.exe", "/F", "/PID", str(gpid)], capture_output=True)
        except Exception:
            pass
    time.sleep(1.5)


def start_gateway_via_scheduler() -> dict:
    """Start persistent Windows Scheduled Task Hermes_Gateway outside any shell Job Object."""
    hermes_cmd = (ALLINONE_USER_HOME + r"\AppData\Roaming\npm\hermes.cmd")
    if not Path(hermes_cmd).exists():
        hermes_cmd = "hermes"

    run_proc = subprocess.run(
        ["schtasks.exe", "/Run", "/TN", "Hermes_Gateway"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=20,
    )
    time.sleep(6)
    status_proc = subprocess.run(
        ["cmd.exe", "/d", "/s", "/c", f'"{hermes_cmd}" gateway status < NUL'],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    return {
        "schtasks_run_exit": run_proc.returncode,
        "status_exit": status_proc.returncode,
        "status_summary": (status_proc.stdout or "")[:800],
    }


def finalize_onboarding(token: str, owner_id: str, bot_username_hint: str | None = None) -> dict:
    stop_gateway_cleanly()
    lock_owner_configuration(token, owner_id, bot_username_hint)
    tg_info = asyncio.run(_verify_bot_and_send_welcome(token, owner_id))
    gw_info = start_gateway_via_scheduler()
    _pending_file().unlink(missing_ok=True)
    receipt = {
        "status": "completed",
        "completed_at": _now_iso(),
        "owner_user_id": str(owner_id),
        "bot_username": tg_info.get("bot_username") or bot_username_hint,
        "bot_id": tg_info.get("bot_id"),
        "welcome_sent": tg_info.get("welcome_sent"),
        "welcome_message_id": tg_info.get("welcome_message_id"),
        "screenshot_sent": tg_info.get("screenshot_sent"),
        "screenshot_message_id": tg_info.get("screenshot_message_id"),
        "dm_note": tg_info.get("dm_note"),
        "gateway": gw_info,
    }
    _write_status(receipt)
    return receipt


def cmd_start(args: argparse.Namespace) -> int:
    pairing = create_pairing(bot_name="Hermes Agent")
    if not pairing:
        _write_status({"status": "pairing_unreachable", "updated_at": _now_iso()})
        print("ERROR: Could not reach Hermes Telegram onboarding service.", file=sys.stderr)
        return 1

    if args.qr_out:
        import qrcode

        qr_path = Path(args.qr_out)
        qr_path.parent.mkdir(parents=True, exist_ok=True)
        img = qrcode.make(pairing.qr_payload)
        img.save(qr_path)

    _pending_file().write_text(
        json.dumps(
            {
                "pairing_id": pairing.pairing_id,
                "poll_token": pairing.poll_token,
                "suggested_username": pairing.suggested_username,
                "deep_link": pairing.deep_link,
                "qr_payload": pairing.qr_payload,
                "expires_at": pairing.expires_at,
                "created_at": _now_iso(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    status_payload = {
        "status": "waiting_for_owner",
        "suggested_username": pairing.suggested_username,
        "deep_link": pairing.deep_link,
        "expires_at": pairing.expires_at,
        "started_at": _now_iso(),
    }
    _write_status(status_payload)
    print(json.dumps(status_payload, indent=2))
    return 0


def cmd_apply_existing(_args: argparse.Namespace) -> int:
    token = get_env_value("TELEGRAM_BOT_TOKEN")
    allowed = (get_env_value("TELEGRAM_ALLOWED_USERS") or "").split(",")[0].strip()
    if not token or not is_valid_telegram_bot_token(token) or not allowed.isdigit():
        print("ERROR: Valid TELEGRAM_BOT_TOKEN and numeric TELEGRAM_ALLOWED_USERS are required in .env.", file=sys.stderr)
        return 1
    receipt = finalize_onboarding(token, allowed)
    print(json.dumps(receipt, indent=2))
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    pf = _pending_file()
    pairing = None
    if pf.exists():
        raw = json.loads(pf.read_text(encoding="utf-8"))
        pairing = TelegramPairing(
            pairing_id=raw["pairing_id"],
            poll_token=raw["poll_token"],
            suggested_username=raw["suggested_username"],
            deep_link=raw["deep_link"],
            qr_payload=raw["qr_payload"],
            expires_at=raw.get("expires_at"),
        )

    deadline = time.monotonic() + float(args.max_seconds)
    while time.monotonic() < deadline:
        # Check 1: Did the owner manually configure .env via `hermes gateway setup`?
        env_tok = get_env_value("TELEGRAM_BOT_TOKEN")
        env_uid = (get_env_value("TELEGRAM_ALLOWED_USERS") or "").split(",")[0].strip()
        if env_tok and is_valid_telegram_bot_token(env_tok) and env_uid.isdigit():
            receipt = finalize_onboarding(env_tok, env_uid)
            print(json.dumps(receipt, indent=2))
            return 0

        # Check 2: Poll official Hermes Telegram Managed Bot onboarding API
        if pairing is not None:
            try:
                res = poll_pairing_result_once(None, pairing)
                if res and is_valid_telegram_bot_token(res.token) and res.owner_user_id:
                    receipt = finalize_onboarding(res.token, str(res.owner_user_id), res.bot_username)
                    print(json.dumps(receipt, indent=2))
                    return 0
            except Exception:
                pass

        time.sleep(3.0)

    _write_status({"status": "expired", "expired_at": _now_iso()})
    return 2


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_start = sub.add_parser("start")
    p_start.add_argument("--qr-out", default="")
    p_start.set_defaults(func=cmd_start)

    p_apply = sub.add_parser("apply-existing")
    p_apply.set_defaults(func=cmd_apply_existing)

    p_watch = sub.add_parser("watch")
    p_watch.add_argument("--max-seconds", type=int, default=1750)
    p_watch.set_defaults(func=cmd_watch)

    parsed = parser.parse_args()
    return parsed.func(parsed)


if __name__ == "__main__":
    raise SystemExit(main())
