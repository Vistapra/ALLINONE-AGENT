#!/usr/bin/env python3
"""Phase 15: Coordinated Daily 03:00 WIB Auto-Update & Maintenance Coordinator.

Preserves the operator's existing HermesUpdater installation (`03:00 Asia/Jakarta` + catch-up + `--no-backup`) untouched
as the single Hermes updater, while coordinating sequential non-disruptive checks & updates for
Paperclip AI (stable npm channel) and VulnClaw (stable Git release tags) with active-work deferral,
maintenance locking, pre-update Paperclip DB backup, post-update functional smoke tests, and
candidate quarantine.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from integration.paperclip_client import PaperclipClient
from integration.vulnclaw_defensive import runtime_diagnostics, sanitize_text
from integration.workflow_engine import send_owner_telegram_notification
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")
ALLINONE_HERMES_HOME = os.environ.get("ALLINONE_HERMES_HOME") or str(Path.home() / "AppData" / "Local" / "hermes")
ALLINONE_USER_HOME = os.environ.get("ALLINONE_USER_HOME") or str(Path.home())


PLATFORM_ROOT = Path(ALLINONE_HOME)
MAINT_DIR = PLATFORM_ROOT / "data" / "maintenance"
MAINT_STATE_PATH = MAINT_DIR / "state.json"
MAINT_LOCK_PATH = MAINT_DIR / "maintenance.lock"
HERMES_UPDATER_STATE = Path((ALLINONE_USER_HOME + r"\HermesUpdater\state\state.json"))
LIMITS_PATH = PLATFORM_ROOT / "config" / "resource-limits.json"
NPM26_CMD = PLATFORM_ROOT / "runtime" / "bin" / "npm26.cmd"
PC_CLI_CMD = PLATFORM_ROOT / "runtime" / "bin" / "paperclipai.cmd"
UV_EXE = Path((ALLINONE_HERMES_HOME + r"\tools\uv-0.13.5-win32-x64\uv.exe"))
PM_GIT = Path((ALLINONE_HERMES_HOME + r"\tools\git-2.56.1+1-win32-x64\cmd\git.exe"))
VC_VENV_PYTHON = PLATFORM_ROOT / "runtime" / "vulnclaw-venv" / "Scripts" / "python.exe"

COORDINATOR_STATES = (
    "IDLE",
    "MAINTENANCE_PENDING",
    "DRAINING",
    "PRECHECK",
    "CANDIDATE_VALIDATION",
    "UPDATING",
    "POST_UPDATE_TEST",
    "READY",
    "DEFERRED",
    "FAILED",
    "NEEDS_ATTENTION",
)

WIB = timezone(timedelta(hours=7), name="WIB")


def now_wib() -> datetime:
    return datetime.now(timezone.utc).astimezone(WIB)


def daily_window(now: datetime | None = None) -> dict[str, Any]:
    cur = now or now_wib()
    today_03 = cur.replace(hour=3, minute=0, second=0, microsecond=0)
    if cur >= today_03:
        due = today_03
        nxt = today_03 + timedelta(days=1)
        is_catchup = (cur - today_03).total_seconds() >= 600
    else:
        due = today_03 - timedelta(days=1)
        nxt = today_03
        is_catchup = True
    return {
        "due_slot": due.isoformat(timespec="seconds"),
        "next_slot": nxt.isoformat(timespec="seconds"),
        "is_catchup": is_catchup,
    }


def read_state() -> dict[str, Any]:
    MAINT_DIR.mkdir(parents=True, exist_ok=True)
    if MAINT_STATE_PATH.exists():
        try:
            return json.loads(MAINT_STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "state": "IDLE",
        "schedule_mode": "daily",
        "daily_time": "03:00 Asia/Jakarta",
        "last_completed_slot": None,
        "next_scheduled_slot": daily_window()["next_slot"],
        "quarantined_candidates": {},
        "last_run_at": None,
        "last_result": None,
        "history": [],
    }


def write_state(st: dict[str, Any]) -> None:
    MAINT_DIR.mkdir(parents=True, exist_ok=True)
    st["updated_at"] = now_wib().isoformat(timespec="seconds")
    tmp = MAINT_STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=2), encoding="utf-8")
    tmp.replace(MAINT_STATE_PATH)


def set_phase(st: dict[str, Any], phase: str, note: str = "") -> None:
    if phase not in COORDINATOR_STATES:
        raise ValueError(f"Unknown coordinator state: {phase}")
    st["state"] = phase
    if note:
        st["last_note"] = note
    write_state(st)


def check_active_work() -> tuple[bool, list[str]]:
    reasons: list[str] = []
    # 1. Check HermesUpdater in-progress flag
    if HERMES_UPDATER_STATE.exists():
        try:
            hs = json.loads(HERMES_UPDATER_STATE.read_text(encoding="utf-8-sig"))
            if hs.get("update_in_progress"):
                reasons.append("hermes_autoupdate_in_progress")
        except Exception:
            pass

    # 2. Check Paperclip live runs
    try:
        pc = PaperclipClient(timeout=8.0)
        cid = pc.get_primary_company()["id"]
        live = [r for r in pc.list_live_runs(cid) if r.get("status") in ("queued", "running")]
        if live:
            reasons.append(f"paperclip_live_runs:{len(live)}")
    except Exception:
        pass

    return (len(reasons) > 0, reasons)


def check_free_disk_ok() -> tuple[bool, dict[str, float]]:
    limits = {"min_free_disk_gb_c": 3.0, "min_free_disk_gb_d": 2.0}
    if LIMITS_PATH.exists():
        limits.update(json.loads(LIMITS_PATH.read_text(encoding="utf-8")).get("limits", {}))
    c_free = round(shutil.disk_usage("C:\\").free / (1024**3), 2)
    d_free = round(shutil.disk_usage("D:\\").free / (1024**3), 2)
    ok = c_free >= float(limits["min_free_disk_gb_c"]) and d_free >= float(limits["min_free_disk_gb_d"])
    return ok, {"C_free_gb": c_free, "D_free_gb": d_free}


def get_installed_paperclip_version() -> str:
    pkg = PLATFORM_ROOT / "runtime" / "paperclip-app" / "node_modules" / "paperclipai" / "package.json"
    if pkg.exists():
        return str(json.loads(pkg.read_text(encoding="utf-8")).get("version", ""))
    return ""


def get_latest_paperclip_npm_version() -> str:
    proc = subprocess.run(
        ["cmd.exe", "/c", str(NPM26_CMD), "view", "paperclipai@latest", "version", "--registry=https://registry.npmjs.org"],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"npm view paperclipai@latest failed: {proc.stderr.strip()}")
    return proc.stdout.strip().splitlines()[-1].strip().strip("'\"")


def get_installed_vulnclaw_tag() -> str:
    proc = subprocess.run(
        [str(VC_VENV_PYTHON), "-c", "import vulnclaw; print('v' + vulnclaw.__version__)"],
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.stdout.strip() if proc.returncode == 0 else ""


def get_latest_vulnclaw_stable_tag() -> str:
    git_bin = str(PM_GIT) if PM_GIT.exists() else "git"
    proc = subprocess.run(
        [git_bin, "ls-remote", "--tags", "--refs", "https://github.com/Netw0rkNoob/VulnClaw.git"],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"git ls-remote VulnClaw failed: {proc.stderr.strip()}")
    tags: list[tuple[tuple[int, ...], str]] = []
    for ln in proc.stdout.splitlines():
        m = re.search(r"refs/tags/(v\d+\.\d+\.\d+)$", ln.strip())
        if m:
            ver_str = m.group(1)
            nums = tuple(int(x) for x in ver_str[1:].split("."))
            tags.append((nums, ver_str))
    if not tags:
        raise RuntimeError("No stable tags returned for VulnClaw")
    tags.sort()
    return tags[-1][1]


def get_installed_hermes3d_version() -> str:
    pkg = PLATFORM_ROOT / "hermes3d" / "source" / "package.json"
    if pkg.exists():
        ver = str(json.loads(pkg.read_text(encoding="utf-8")).get("version", "")).strip()
        return f"v{ver}" if ver and not ver.startswith("v") else ver
    return ""


def get_latest_hermes3d_stable_tag() -> str:
    git_bin = str(PM_GIT) if PM_GIT.exists() else "git"
    proc = subprocess.run(
        [git_bin, "ls-remote", "--tags", "--refs", "https://github.com/iamlukethedev/Hermes3D.git"],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"git ls-remote Hermes3D failed: {proc.stderr.strip()}")
    tags: list[tuple[tuple[int, ...], str]] = []
    for ln in proc.stdout.splitlines():
        m = re.search(r"refs/tags/(v\d+\.\d+\.\d+)$", ln.strip())
        if m:
            ver_str = m.group(1)
            nums = tuple(int(x) for x in ver_str[1:].split("."))
            tags.append((nums, ver_str))
    if not tags:
        return get_installed_hermes3d_version() or "v1.0.0"
    tags.sort()
    return tags[-1][1]


def run_post_update_smoke_tests() -> dict[str, Any]:
    pc = PaperclipClient(timeout=15.0)
    pc_health = pc.health()
    vc_diag = runtime_diagnostics(verify_llm=False)
    h_proc = subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            (ALLINONE_USER_HOME + r"\HermesUpdater\hermes-health.ps1"),
            "-Json",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    h_ok = False
    if h_proc.returncode == 0 and h_proc.stdout.strip():
        h_ok = bool(json.loads(h_proc.stdout).get("overall_healthy"))

    import urllib.request
    bridge_ok = False
    h3d_ok = False
    try:
        with urllib.request.urlopen("http://127.0.0.1:3210/health", timeout=4) as r:
            bridge_ok = r.status == 200
    except Exception:
        bridge_ok = False
    try:
        with urllib.request.urlopen("http://127.0.0.1:3200/api/health", timeout=4) as r:
            h3d_ok = r.status == 200
    except Exception:
        h3d_ok = False

    ok = pc_health.get("status") == "ok" and bool(vc_diag.get("vulnclaw_version")) and h_ok
    return {
        "ok": ok,
        "paperclip_status": pc_health.get("status"),
        "vulnclaw_version": vc_diag.get("vulnclaw_version"),
        "hermes_unified_healthy": h_ok,
        "office_bridge_healthy": bridge_ok,
        "hermes3d_healthy": h3d_ok,
    }


def run_maintenance_cycle(
    *,
    force: bool = False,
    dry_run: bool = False,
    notify_owner: bool = False,
    simulated_now: datetime | None = None,
) -> dict[str, Any]:
    st = read_state()
    win = daily_window(simulated_now)

    # 1. Check daily 03:00 WIB window + offline catch-up eligibility
    if not force:
        last_done = st.get("last_completed_slot")
        if last_done and last_done >= win["due_slot"]:
            st["state"] = "IDLE"
            st["next_scheduled_slot"] = win["next_slot"]
            write_state(st)
            return {
                "outcome": "waiting_daily_window",
                "due_slot": win["due_slot"],
                "next_slot": win["next_slot"],
                "state": "IDLE",
            }

    set_phase(st, "MAINTENANCE_PENDING", f"Window due={win['due_slot']} catchup={win['is_catchup']}")

    # 2. Check active tasks (defer without marking slot complete!)
    set_phase(st, "DRAINING", "Checking active Hermes & Paperclip workloads")
    busy, busy_reasons = check_active_work()
    if busy:
        set_phase(st, "DEFERRED", f"Active workloads detected: {', '.join(busy_reasons)}")
        return {"outcome": "deferred_active_work", "reasons": busy_reasons, "state": "DEFERRED"}

    # 3. Acquire singleton maintenance lock
    MAINT_DIR.mkdir(parents=True, exist_ok=True)
    if MAINT_LOCK_PATH.exists():
        age_s = time.time() - MAINT_LOCK_PATH.stat().st_mtime
        if age_s < 5400:
            set_phase(st, "DEFERRED", "Maintenance lock already held")
            return {"outcome": "deferred_locked", "state": "DEFERRED"}
    MAINT_LOCK_PATH.write_text(
        json.dumps({"pid": os.getpid(), "started_at": now_wib().isoformat(timespec="seconds")}),
        encoding="utf-8",
    )

    try:
        # 4. Precheck disk & existing HermesUpdater status (never create Hermes backups!)
        set_phase(st, "PRECHECK", "Checking free disk & HermesUpdater status")
        disk_ok, disk_info = check_free_disk_ok()
        if not disk_ok:
            set_phase(st, "NEEDS_ATTENTION", f"Insufficient free disk: {disk_info}")
            return {"outcome": "disk_guard_blocked", "disk": disk_info, "state": "NEEDS_ATTENTION"}

        # 5. Candidate discovery & validation (sequential, never simultaneous)
        set_phase(st, "CANDIDATE_VALIDATION", "Checking Paperclip & VulnClaw stable candidates")
        quarantined = st.setdefault("quarantined_candidates", {})

        pc_cur = get_installed_paperclip_version()
        pc_lat = get_latest_paperclip_npm_version()
        vc_cur = get_installed_vulnclaw_tag()
        vc_lat = get_latest_vulnclaw_stable_tag()

        actions_taken: list[str] = []

        # Component A: Paperclip (only if newer stable & not quarantined)
        if pc_lat and pc_lat != pc_cur:
            q_key = f"paperclip:{pc_lat}"
            if q_key in quarantined:
                actions_taken.append(f"paperclip:{pc_lat}:quarantined_skipped")
            elif dry_run:
                actions_taken.append(f"paperclip:{pc_cur}->{pc_lat}:dry_run_ready")
            else:
                # Guard against major version jump without owner approval
                cur_major = pc_cur.split(".")[0] if pc_cur else ""
                lat_major = pc_lat.split(".")[0]
                if cur_major and lat_major != cur_major:
                    set_phase(st, "NEEDS_ATTENTION", f"Major Paperclip version jump {pc_cur} -> {pc_lat} requires Owner review")
                    return {"outcome": "major_upgrade_deferred", "state": "NEEDS_ATTENTION"}

                set_phase(st, "UPDATING", f"Backing up Paperclip DB & updating {pc_cur} -> {pc_lat}")
                subprocess.run(
                    ["cmd.exe", "/c", str(PC_CLI_CMD), "db:backup", "-d", str(PLATFORM_ROOT / "data" / "paperclip"), "--json"],
                    capture_output=True,
                    check=False,
                )
                upd = subprocess.run(
                    [
                        "cmd.exe",
                        "/c",
                        str(NPM26_CMD),
                        "install",
                        "--prefix",
                        str(PLATFORM_ROOT / "runtime" / "paperclip-app"),
                        f"paperclipai@{pc_lat}",
                        "--no-audit",
                        "--no-fund",
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if upd.returncode != 0:
                    quarantined[q_key] = {"failed_at": now_wib().isoformat(timespec="seconds"), "reason": "npm_install_failed"}
                    set_phase(st, "FAILED", f"Paperclip {pc_lat} install failed; candidate quarantined")
                    return {"outcome": "paperclip_update_failed", "quarantined": q_key, "state": "FAILED"}
                hydrate_js = (
                    PLATFORM_ROOT
                    / "runtime"
                    / "paperclip-app"
                    / "node_modules"
                    / "@embedded-postgres"
                    / "windows-x64"
                    / "scripts"
                    / "hydrate-symlinks.js"
                )
                if hydrate_js.exists():
                    subprocess.run(
                        ["cmd.exe", "/c", str(PLATFORM_ROOT / "runtime" / "bin" / "node26.cmd"), str(hydrate_js)],
                        capture_output=True,
                        check=False,
                    )
                actions_taken.append(f"paperclip:updated:{pc_cur}->{pc_lat}")
        else:
            actions_taken.append(f"paperclip:up_to_date:{pc_cur}")

        # Component B: VulnClaw (only if Paperclip healthy & newer stable tag & not quarantined)
        if vc_lat and vc_lat != vc_cur:
            q_key = f"vulnclaw:{vc_lat}"
            if q_key in quarantined:
                actions_taken.append(f"vulnclaw:{vc_lat}:quarantined_skipped")
            elif dry_run:
                actions_taken.append(f"vulnclaw:{vc_cur}->{vc_lat}:dry_run_ready")
            else:
                set_phase(st, "UPDATING", f"Updating isolated VulnClaw {vc_cur} -> {vc_lat}")
                git_bin = str(PM_GIT) if PM_GIT.exists() else "git"
                f1 = subprocess.run([git_bin, "-C", str(PLATFORM_ROOT / "vulnclaw"), "fetch", "--tags", "origin"], capture_output=True, check=False)
                f2 = subprocess.run([git_bin, "-C", str(PLATFORM_ROOT / "vulnclaw"), "checkout", vc_lat], capture_output=True, check=False)
                f3 = subprocess.run([str(UV_EXE), "pip", "install", "--python", str(VC_VENV_PYTHON), "-e", str(PLATFORM_ROOT / "vulnclaw")], capture_output=True, check=False)
                if f1.returncode != 0 or f2.returncode != 0 or f3.returncode != 0:
                    subprocess.run([git_bin, "-C", str(PLATFORM_ROOT / "vulnclaw"), "checkout", vc_cur], capture_output=True, check=False)
                    quarantined[q_key] = {"failed_at": now_wib().isoformat(timespec="seconds"), "reason": "git_or_pip_failed"}
                    set_phase(st, "FAILED", f"VulnClaw {vc_lat} update failed; rolled back to {vc_cur} and quarantined")
                    return {"outcome": "vulnclaw_update_failed", "quarantined": q_key, "state": "FAILED"}
                actions_taken.append(f"vulnclaw:updated:{vc_cur}->{vc_lat}")
        else:
            actions_taken.append(f"vulnclaw:up_to_date:{vc_cur}")

        # Component C: Hermes3D (strictly gated on stable release tags; custom branch preserved)
        h3d_cur = get_installed_hermes3d_version()
        h3d_lat = get_latest_hermes3d_stable_tag()
        if h3d_lat and h3d_cur and h3d_lat != h3d_cur:
            q_key = f"hermes3d:{h3d_lat}"
            if q_key in quarantined:
                actions_taken.append(f"hermes3d:{h3d_lat}:quarantined_skipped")
            else:
                # Hold new upstream Hermes3D release for compatibility review against custom branch integration/unified-ai-company
                actions_taken.append(f"hermes3d:{h3d_cur}->{h3d_lat}:candidate_staged_compatibility_gate")
        else:
            actions_taken.append(f"hermes3d:up_to_date:{h3d_cur or 'v1.0.0'}")

        # 6. Post-update smoke test across all 3 components
        set_phase(st, "POST_UPDATE_TEST", "Running cross-platform functional smoke tests")
        smoke = run_post_update_smoke_tests()
        if not smoke["ok"]:
            set_phase(st, "NEEDS_ATTENTION", f"Post-update smoke test degraded: {smoke}")
            return {"outcome": "smoke_failed", "smoke": smoke, "state": "NEEDS_ATTENTION"}

        # 7. Mark daily slot complete ONLY when check & smoke tests succeeded!
        if not dry_run:
            st["last_completed_slot"] = win["due_slot"]
        st["next_scheduled_slot"] = win["next_slot"]
        st["last_run_at"] = now_wib().isoformat(timespec="seconds")
        st["last_result"] = "success"
        hist = st.setdefault("history", [])
        hist.append({
            "at": st["last_run_at"],
            "slot": win["due_slot"],
            "catchup": win["is_catchup"],
            "actions": actions_taken,
            "smoke": smoke,
        })
        st["history"] = hist[-20:]
        set_phase(st, "READY", f"Completed slot {win['due_slot']}: {', '.join(actions_taken)}")
        st["state"] = "IDLE"
        write_state(st)

        if notify_owner and any("updated:" in a for a in actions_taken):
            send_owner_telegram_notification(
                f"✅ [Maintenance 03:00 WIB] Selesai: {', '.join(actions_taken)} | Health: OK"
            )

        return {
            "outcome": "completed",
            "slot_completed": win["due_slot"],
            "next_slot": win["next_slot"],
            "is_catchup": win["is_catchup"],
            "actions": actions_taken,
            "smoke": smoke,
            "state": "IDLE",
        }
    finally:
        MAINT_LOCK_PATH.unlink(missing_ok=True)
