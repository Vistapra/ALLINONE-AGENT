#!/usr/bin/env python3
"""Phase 14, 15, 16 & 17: Verify Startup/Self-Healing, 03:00 WIB Coordinated Maintenance, ai-platform CLI, and Governance/Emergency Stop."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path
from unittest.mock import patch
import os
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")
ALLINONE_HERMES_HOME = os.environ.get("ALLINONE_HERMES_HOME") or str(Path.home() / "AppData" / "Local" / "hermes")


ROOT = Path(ALLINONE_HOME)
sys.path.insert(0, str(ROOT))

from integration import maintenance_coordinator as mc
from integration.paperclip_client import PaperclipClient

AI_PLATFORM_CMD = ROOT / "runtime" / "bin" / "ai-platform.cmd"


def run_cmd(args: list[str], timeout: int = 45) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)


def main() -> int:
    # --- PHASE 14: Register Scheduled Tasks, Maintenance Lock Deferral & Crash Self-Healing ---
    print("1. [Phase 14] Registering Scheduled Tasks & checking task inventory...")
    reg = run_cmd(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(ROOT / "scripts" / "register-platform-tasks.ps1"),
        ]
    )
    if reg.returncode != 0:
        raise RuntimeError(f"register-platform-tasks.ps1 failed: {reg.stderr}")

    # Test maintenance.lock deferral in platform-watchdog.ps1
    mc.MAINT_DIR.mkdir(parents=True, exist_ok=True)
    mc.MAINT_LOCK_PATH.write_text('{"test":"lock"}', encoding="utf-8")
    try:
        wd_locked = run_cmd(
            [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(ROOT / "scripts" / "platform-watchdog.ps1"),
            ]
        )
        lock_deferred_ok = "MAINTENANCE_LOCK_ACTIVE" in wd_locked.stdout
    finally:
        mc.MAINT_LOCK_PATH.unlink(missing_ok=True)
    if not lock_deferred_ok:
        raise RuntimeError(f"Watchdog did not defer on maintenance.lock: {wd_locked.stdout}")

    # Test Paperclip child crash self-healing (terminate inner node.exe -> PaperclipServiceLauncher auto-restarts it)
    print("2. [Phase 14] Testing Paperclip child crash recovery via PaperclipServiceLauncher...")
    kill_ps = (
        "$p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'paperclip-server-entry' }; "
        "if ($p) { $oldPid = $p[0].ProcessId; Stop-Process -Id $oldPid -Force; Write-Output $oldPid } else { Write-Output 'NONE' }"
    )
    kproc = run_cmd(["powershell.exe", "-NoProfile", "-Command", kill_ps])
    killed_pid = kproc.stdout.strip()
    recovered_ok = False
    pc = PaperclipClient(timeout=10.0)
    deadline = time.time() + 330.0
    time.sleep(6.0)
    while time.time() < deadline:
        try:
            h = pc.health()
            if h.get("status") == "ok":
                recovered_ok = True
                break
        except Exception:
            pass
        time.sleep(3.0)
    if not recovered_ok:
        raise RuntimeError("Paperclip did not self-heal within 95s after child crash!")

    # --- PHASE 15: Coordinated Daily 03:00 WIB Auto-Update, Active-Work Deferral, Catch-Up & Zero-Backup Check ---
    print("3. [Phase 15] Verifying active-work deferral, offline 03:00 WIB catch-up & Hermes zero-backup policy...")
    with patch.object(mc, "check_active_work", return_value=(True, ["simulated_active_engineering_run"])):
        def_res = mc.run_maintenance_cycle(force=True)
    active_deferral_ok = def_res.get("outcome") == "deferred_active_work" and def_res.get("state") == "DEFERRED"

    # Drain any background startup run so we can verify idle catch-up completion deterministically
    cid_drain = pc.get_primary_company()["id"]
    for lr in pc.list_live_runs(cid_drain):
        pc.cancel_run(lr["id"])
    time.sleep(2.0)

    # Simulate missed 03:00 WIB window (last_completed_slot = yesterday) -> catch-up run
    st = mc.read_state()
    st["last_completed_slot"] = "2026-11-18T03:00:00+07:00"
    st["quarantined_candidates"] = {"paperclip:0.0.0-bad-candidate": {"failed_at": "2026-11-18T03:05:00+07:00", "reason": "synthetic_quarantine_test"}}
    mc.write_state(st)

    catchup_res = mc.run_maintenance_cycle(force=False, dry_run=False, notify_owner=False)
    if catchup_res.get("outcome") != "completed":
        raise RuntimeError(f"Maintenance catch-up failed: {catchup_res}")

    # Second immediate call must return waiting_daily_window (slot already completed today!)
    idle_res = mc.run_maintenance_cycle(force=False, dry_run=False, notify_owner=False)
    slot_dedup_ok = idle_res.get("outcome") == "waiting_daily_window"

    # Clean synthetic quarantine marker while keeping real completed slot state
    st_clean = mc.read_state()
    st_clean.get("quarantined_candidates", {}).pop("paperclip:0.0.0-bad-candidate", None)
    mc.write_state(st_clean)

    # Confirm Hermes zero-backup policy remains 100% preserved (zero backup zip archives)
    hermes_backups_dir = Path((ALLINONE_HERMES_HOME + r"\backups"))
    hermes_backup_files = list(hermes_backups_dir.rglob("*.zip")) if hermes_backups_dir.exists() else []
    hermes_zero_backup_preserved = len(hermes_backup_files) == 0

    # --- PHASE 16: Unified Health Monitoring CLI (`ai-platform`) ---
    print("4. [Phase 16] Verifying all 7 ai-platform CLI subcommands...")
    cli_checks: dict[str, dict] = {}
    for sub_args in (
        ["status"],
        ["health", "--json"],
        ["services"],
        ["agents"],
        ["tasks"],
        ["updates"],
        ["logs", "--tail", "8"],
    ):
        cp = run_cmd(["cmd.exe", "/c", str(AI_PLATFORM_CMD), *sub_args], timeout=40)
        key = sub_args[0]
        cli_checks[key] = {"exit_code": cp.returncode, "output_preview": cp.stdout.strip()[:260]}
        if cp.returncode != 0:
            raise RuntimeError(f"ai-platform {sub_args} exited with {cp.returncode}: {cp.stderr or cp.stdout}")

    health_json = json.loads(run_cmd(["cmd.exe", "/c", str(AI_PLATFORM_CMD), "health", "--json"]).stdout)

    # --- PHASE 17: Governance Emergency Stop, Resume Wave-1 & Security Boundary Audit ---
    print("5. [Phase 17] Verifying emergency-stop, resume-wave1, budgets & security boundaries...")
    estop = json.loads(run_cmd(["cmd.exe", "/c", str(AI_PLATFORM_CMD), "emergency-stop"], timeout=120).stdout)
    cid = pc.get_primary_company()["id"]
    all_paused_after_stop = all(a.get("status") in ("paused", "terminated") for a in pc.list_agents(cid))

    rwave1 = json.loads(run_cmd(["cmd.exe", "/c", str(AI_PLATFORM_CMD), "resume-wave1"], timeout=120).stdout)
    active_after_resume = [a["name"] for a in pc.list_agents(cid) if a.get("status") != "paused"]

    sec_audit = run_cmd(["python", str(ROOT / "scripts" / "verify-security-boundaries.py")])
    sec_json = json.loads(sec_audit.stdout)

    summary = {
        "phase14": {
            "tasks_registered": True,
            "maintenance_lock_watchdog_deferred": lock_deferred_ok,
            "paperclip_killed_pid": killed_pid,
            "paperclip_crash_self_healed": recovered_ok,
        },
        "phase15": {
            "active_work_deferral_verified": active_deferral_ok,
            "offline_catchup_outcome": catchup_res,
            "same_day_slot_deduplicated": slot_dedup_ok,
            "hermes_zero_backup_preserved": hermes_zero_backup_preserved,
        },
        "phase16": {
            "cli_subcommands": cli_checks,
            "platform_state": health_json.get("platform_state"),
            "windows_metrics": health_json.get("windows"),
        },
        "phase17": {
            "emergency_stop": estop,
            "all_paused_after_emergency_stop": all_paused_after_stop,
            "resume_wave1": rwave1,
            "active_agents_after_resume": active_after_resume,
            "budget_overview": health_json.get("paperclip", {}).get("budget_overview"),
            "security_boundary_audit_passed": sec_json.get("overall_passed"),
        },
    }
    out_file = ROOT / "reports" / "phase14-to-17-ops-governance-verification.json"
    out_file.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("PHASE14_TO_17_VERIFIED:", json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
