#!/usr/bin/env python3
"""Unified CLI & Health Engine (`ai-platform`) for Hermes x Paperclip x VulnClaw Platform (Phases 11, 16, 17)."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")
ALLINONE_USER_HOME = os.environ.get("ALLINONE_USER_HOME") or str(Path.home())


ROOT = Path(ALLINONE_HOME)
sys.path.insert(0, str(ROOT))

from integration.findings_engine import FindingsStore
from integration.maintenance_coordinator import (
    MAINT_LOCK_PATH,
    get_installed_paperclip_version,
    get_installed_vulnclaw_tag,
    read_state as read_maint_state,
    run_maintenance_cycle,
)
from integration.paperclip_client import PaperclipClient
from integration.vulnclaw_defensive import runtime_diagnostics, sanitize_text, scan_authorized_code
from integration.workflow_engine import (
    AUTHORIZED_OWNER_ID,
    WorkflowEngine,
    classify_owner_instruction,
    send_owner_telegram_notification,
)

HERMES_HEALTH_PS1 = Path((ALLINONE_USER_HOME + r"\HermesUpdater\hermes-health.ps1"))
HERMES_UPDATER_STATE = Path((ALLINONE_USER_HOME + r"\HermesUpdater\state\state.json"))


def collect_windows_metrics() -> dict[str, Any]:
    ps = (
        "$os = Get-CimInstance Win32_OperatingSystem; "
        "$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; "
        "$procs = (Get-Process).Count; "
        "$up = [int]((Get-Date) - $os.LastBootUpTime).TotalMinutes; "
        "[ordered]@{ "
        "cpu_pct = $cpu; "
        "ram_total_mb = [math]::Round($os.TotalVisibleMemorySize/1024,1); "
        "ram_free_mb = [math]::Round($os.FreePhysicalMemory/1024,1); "
        "ram_used_pct = [math]::Round((1 - ($os.FreePhysicalMemory/$os.TotalVisibleMemorySize))*100,1); "
        "process_count = $procs; "
        "uptime_minutes = $up "
        "} | ConvertTo-Json -Compress"
    )
    proc = subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps], capture_output=True, text=True, check=False)
    win = json.loads(proc.stdout) if proc.returncode == 0 and proc.stdout.strip() else {}
    win["disk_c_free_gb"] = round(shutil.disk_usage("C:\\").free / (1024**3), 2)
    win["disk_d_free_gb"] = round(shutil.disk_usage("D:\\").free / (1024**3), 2)
    return win


def collect_unified_health(*, deep_llm: bool = False) -> dict[str, Any]:
    # 1. Maintenance lock check
    in_maint = MAINT_LOCK_PATH.exists() and (time.time() - MAINT_LOCK_PATH.stat().st_mtime < 5400)

    # 2. Hermes health (fast ~1.1s COM check)
    hermes_info: dict[str, Any] = {"healthy": False}
    hp = subprocess.run(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(HERMES_HEALTH_PS1), "-Json"],
        capture_output=True,
        text=True,
        check=False,
    )
    if hp.stdout and hp.stdout.strip().startswith("{"):
        raw_h = json.loads(hp.stdout)
        au_state = json.loads(HERMES_UPDATER_STATE.read_text(encoding="utf-8-sig")) if HERMES_UPDATER_STATE.exists() else {}
        hermes_core_ok = bool(raw_h.get("overall_healthy")) or (
            bool(raw_h.get("hermes_config_ok")) and bool(raw_h.get("local_terminal_ok")) and bool((raw_h.get("gateway") or {}).get("running"))
        )
        hermes_info = {
            "healthy": hermes_core_ok,
            "installed_commit": au_state.get("installed_commit", ""),
            "channel": au_state.get("channel", "main"),
            "gateway_running": bool((raw_h.get("gateway") or {}).get("running")),
            "telegram_connected": bool((raw_h.get("gateway") or {}).get("telegram_connected")),
            "cua_status": (raw_h.get("computer_use") or {}).get("status"),
            "updater_schedule": f"{au_state.get('schedule_mode', 'daily')} @ 03:00 Asia/Jakarta",
            "last_update_success": au_state.get("last_update_success"),
            "next_maintenance_window": au_state.get("next_check"),
        }

    # 3. Paperclip functional & API check
    paperclip_info: dict[str, Any] = {"healthy": False, "version": get_installed_paperclip_version()}
    try:
        pc = PaperclipClient(timeout=10.0)
        h = pc.health()
        co = pc.get_primary_company()
        cid = co["id"]
        agents = pc.list_agents(cid)
        issues = pc.list_issues(cid)
        runs = pc.list_live_runs(cid)
        budget = pc.budget_overview(cid)
        by_status: dict[str, int] = {}
        for it in issues:
            s = str(it.get("status", "unknown"))
            by_status[s] = by_status.get(s, 0) + 1
        active_agents = [a for a in agents if a.get("status") not in ("paused", "terminated")]
        paperclip_info.update({
            "healthy": h.get("status") == "ok",
            "server_status": h.get("status"),
            "commit": h.get("commit"),
            "database_backup_status": (h.get("databaseBackup") or {}).get("status"),
            "company_id": cid,
            "company_name": co.get("name"),
            "total_agents": len(agents),
            "active_agents": len(active_agents),
            "queued_or_running_runs": len(runs),
            "tasks_todo": by_status.get("todo", 0) + by_status.get("backlog", 0),
            "tasks_running": by_status.get("in_progress", 0) + by_status.get("in_review", 0),
            "tasks_completed": by_status.get("done", 0),
            "tasks_blocked": by_status.get("blocked", 0),
            "budget_overview": budget,
        })
    except Exception as exc:
        paperclip_info["error"] = sanitize_text(str(exc))[:180]

    # 4. VulnClaw isolated runtime & findings metrics
    vulnclaw_info: dict[str, Any] = {"healthy": False, "version": get_installed_vulnclaw_tag()}
    try:
        vdiag = runtime_diagnostics(verify_llm=deep_llm)
        fcounts = FindingsStore().summary_counts()
        vulnclaw_info.update({
            "healthy": bool(vdiag.get("vulnclaw_version")) and not vdiag.get("hermes_or_telegram_env_leaked") and len(vdiag.get("enabled_mcp_servers", [])) == 0,
            "version": vdiag.get("vulnclaw_version"),
            "python": vdiag.get("python_version"),
            "model": vdiag.get("configured_model"),
            "isolation_verified": not vdiag.get("hermes_or_telegram_env_leaked") and len(vdiag.get("enabled_mcp_servers", [])) == 0,
            "findings": fcounts,
        })
    except Exception as exc:
        vulnclaw_info["error"] = sanitize_text(str(exc))[:180]

    # 5. Office Bridge & Hermes3D Virtual Office functional probe
    import urllib.request
    office_bridge_info: dict[str, Any] = {"healthy": False, "url": "http://127.0.0.1:3210"}
    try:
        with urllib.request.urlopen("http://127.0.0.1:3210/health", timeout=4) as r:
            bdata = json.loads(r.read().decode("utf-8", errors="replace"))
            office_bridge_info.update({
                "healthy": r.status == 200 and bool(bdata.get("ok")),
                "paperclip_reachable": bdata.get("paperclip_reachable"),
                "latest_sequence": bdata.get("latest_sequence"),
            })
    except Exception as exc:
        office_bridge_info["error"] = sanitize_text(str(exc))[:140]

    hermes3d_info: dict[str, Any] = {"healthy": False, "url": "http://127.0.0.1:3200/office"}
    try:
        with urllib.request.urlopen("http://127.0.0.1:3200/api/health", timeout=4) as r:
            hermes3d_info["healthy"] = r.status == 200
    except Exception as exc:
        hermes3d_info["error"] = sanitize_text(str(exc))[:140]

    # 6. Windows host & Scheduled Tasks
    win_info = collect_windows_metrics()
    sched_ps = (
        "$s = New-Object -ComObject 'Schedule.Service'; $s.Connect(); "
        "$out = [ordered]@{}; "
        "foreach ($pair in @( @('\\','Hermes_Gateway'), @('\\','cua-driver-serve'), @('\\Hermes','HermesAutoUpdate'), @('\\Hermes','PaperclipServer'), @('\\Hermes','OfficeVirtualCompany'), @('\\Hermes','PlatformMaintenance'), @('\\Hermes','PlatformHealthWatchdog') )) { "
        "  try { $t = $s.GetFolder($pair[0]).GetTask($pair[1]); $out[$pair[1]] = @{ enabled=$t.Enabled; state=$t.State } } catch { $out[$pair[1]] = @{ registered=$false } } "
        "}; $out | ConvertTo-Json -Compress"
    )
    sp = subprocess.run(["powershell.exe", "-NoProfile", "-Command", sched_ps], capture_output=True, text=True, check=False)
    tasks_info = json.loads(sp.stdout) if sp.returncode == 0 and sp.stdout.strip() else {}

    # Compute canonical platform state: HEALTHY | DEGRADED | MAINTENANCE | OFFLINE | BLOCKED | UNKNOWN
    if in_maint:
        overall_state = "MAINTENANCE"
    elif hermes_info["healthy"] and paperclip_info["healthy"] and vulnclaw_info["healthy"] and office_bridge_info["healthy"] and hermes3d_info["healthy"]:
        overall_state = "HEALTHY"
    elif not hermes_info["healthy"] and not paperclip_info["healthy"]:
        overall_state = "OFFLINE"
    else:
        overall_state = "DEGRADED"

    return {
        "platform_state": overall_state,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "hermes": hermes_info,
        "paperclip": paperclip_info,
        "vulnclaw": vulnclaw_info,
        "office_bridge": office_bridge_info,
        "hermes3d": hermes3d_info,
        "windows": win_info,
        "services": tasks_info,
        "maintenance": read_maint_state(),
    }


def handle_telegram_command(
    cmd: str,
    arg_text: str = "",
    *,
    caller_id: str = AUTHORIZED_OWNER_ID,
    message_id: str = "",
) -> dict[str, Any]:
    """Execute one of the 12 Phase 11 Telegram platform commands with strict Owner auth & idempotency."""
    wf = WorkflowEngine()
    wf.assert_owner_authorized(caller_id, f"telegram:{cmd}")

    c = cmd.strip().lower().lstrip("/")
    if c == "help_platform":
        msg = (
            "🤖 *Unified AI Platform Commands*\n"
            "• `/platform_status` — Ringkasan kesehatan Hermes, Paperclip, VulnClaw & Windows\n"
            "• `/agents` — Daftar agent organisasi & status aktif/standby\n"
            "• `/projects` — Daftar project terdaftar di Paperclip\n"
            "• `/tasks` — Daftar task terkini beserta statusnya\n"
            "• `/task_status <ID>` — Detail progress & run untuk satu task\n"
            "• `/create_task <judul> | <deskripsi>` — Buat task baru di Paperclip (idempotent)\n"
            "• `/pause_task <ID>` — Tunda task menjadi `BLOCKED`\n"
            "• `/resume_task <ID>` — Lanjutkan task menjadi `ASSIGNED`\n"
            "• `/cancel_task <ID>` — Batalkan task & hentikan run aktifnya\n"
            "• `/security_report [subpath]` — Jalankan review defensif VulnClaw / ringkasan temuan\n"
            "• `/update_status` — Status jadwal update harian pukul 03:00 WIB\n"
            "• `/help_platform` — Panduan perintah platform"
        )
        return {"ok": True, "reply": msg}

    if c == "platform_status":
        h = collect_unified_health(deep_llm=False)
        pc = h["paperclip"]
        hm = h["hermes"]
        vc = h["vulnclaw"]
        wn = h["windows"]
        msg = (
            f"📊 *Platform Status: {h['platform_state']}*\n"
            f"• *Hermes:* `{'OK' if hm.get('healthy') else 'DEGRADED'}` (commit `{str(hm.get('installed_commit',''))[:8]}`, TG=`{hm.get('telegram_connected')}`, CUA=`{hm.get('cua_status')}`)\n"
            f"• *Paperclip:* `{'OK' if pc.get('healthy') else 'OFFLINE'}` (`v{pc.get('version')}`, Active Agents=`{pc.get('active_agents')}/{pc.get('total_agents')}`, Done=`{pc.get('tasks_completed')}`, Running=`{pc.get('tasks_running')}`)\n"
            f"• *VulnClaw (Defensive):* `{'OK' if vc.get('healthy') else 'DEGRADED'}` (`v{vc.get('version')}`, Isolated=`{vc.get('isolation_verified')}`, Findings=`{(vc.get('findings') or {}).get('total', 0)}`)\n"
            f"• *Host:* CPU `{wn.get('cpu_pct')}%` | RAM `{wn.get('ram_free_mb')} MB` free | Disk C: `{wn.get('disk_c_free_gb')} GB` / D: `{wn.get('disk_d_free_gb')} GB`"
        )
        return {"ok": True, "reply": msg, "data": h}

    pc = PaperclipClient()
    cid = pc.get_primary_company()["id"]

    if c == "agents":
        agents = pc.list_agents(cid)
        lines = ["👥 *Organization Agents (`Unified AI Engineering & Operations`)*"]
        for a in agents:
            lines.append(f"• `{a.get('name')}` (`{a.get('role')}`) — status: `{a.get('status')}` | budget: `{a.get('budgetMonthlyCents', 0)}¢`")
        return {"ok": True, "reply": "\n".join(lines), "count": len(agents)}

    if c == "projects":
        projs = pc.list_projects(cid)
        lines = ["📁 *Paperclip Projects*"]
        for p in projs:
            lines.append(f"• `{p.get('name')}` (`{p['id'][:8]}`) — status: `{p.get('status')}`")
        return {"ok": True, "reply": "\n".join(lines), "count": len(projs)}

    if c == "tasks":
        issues = pc.list_issues(cid)[:15]
        lines = ["📋 *Recent Paperclip Tasks*"]
        for it in issues:
            lines.append(f"• `{it.get('identifier') or it['id'][:8]}` [{it.get('status')}] — {sanitize_text(str(it.get('title', ''))[:70])}")
        return {"ok": True, "reply": "\n".join(lines), "count": len(issues)}

    if c == "task_status":
        issue = wf.resolve_issue(pc, arg_text)
        comments = pc.list_issue_comments(issue["id"])
        last_comment = sanitize_text(str(comments[-1].get("body", ""))[:240]) if comments else "No comments yet."
        msg = (
            f"🔎 *Task `{issue.get('identifier') or issue['id'][:8]}`*\n"
            f"• *Title:* {sanitize_text(str(issue.get('title', '')))}\n"
            f"• *Status:* `{issue.get('status')}` | *Priority:* `{issue.get('priority')}`\n"
            f"• *Assignee:* `{issue.get('assigneeAgentId') or 'unassigned'}`\n"
            f"• *Latest Note:* {last_comment}"
        )
        return {"ok": True, "reply": msg, "issue": issue}

    if c == "create_task":
        raw = arg_text.strip()
        if not raw:
            raise ValueError("Usage: /create_task <title> | <description>")
        if "|" in raw:
            t_part, d_part = [x.strip() for x in raw.split("|", 1)]
        else:
            t_part, d_part = raw[:90], raw
        idem = f"tg:{caller_id}:{message_id}" if message_id else f"tg-sha:{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:20]}"
        projs = pc.list_projects(cid)
        proj_id = projs[0]["id"] if projs else None
        sub = wf.submit_task(
            caller_id=caller_id,
            title=t_part,
            description=d_part,
            role_slug="ceo_agent",
            priority="high",
            project_id=proj_id,
            idempotency_key=idem,
        )
        t_rec = sub["task"]
        ident = t_rec.get("paperclip_identifier") or t_rec["paperclip_issue_id"][:8]
        dup_note = " *(idempotent: existing task returned)*" if sub["deduplicated"] else ""
        msg = (
            f"✅ *Task Registered in Paperclip*{dup_note}\n"
            f"• *Task ID:* `{ident}` (`{t_rec['paperclip_issue_id']}`)\n"
            f"• *Stage:* `{t_rec['workflow_stage']}` -> Assigned Role: `{t_rec['assigned_role']}`"
        )
        return {"ok": True, "reply": msg, "submission": sub}

    if c == "pause_task":
        res = wf.update_stage(arg_text, "BLOCKED", caller_id=caller_id, comment="Paused by Owner via Telegram.")
        return {"ok": True, "reply": f"⏸️ Task `{res.get('identifier') or res['issue_id'][:8]}` paused (`BLOCKED`).", "result": res}

    if c == "resume_task":
        res = wf.update_stage(arg_text, "ASSIGNED", caller_id=caller_id, comment="Resumed by Owner via Telegram.")
        return {"ok": True, "reply": f"▶️ Task `{res.get('identifier') or res['issue_id'][:8]}` resumed (`ASSIGNED` / `todo`).", "result": res}

    if c == "cancel_task":
        res = wf.update_stage(arg_text, "CANCELLED", caller_id=caller_id, comment="Cancelled by Owner via Telegram.")
        return {"ok": True, "reply": f"🛑 Task `{res.get('identifier') or res['issue_id'][:8]}` cancelled (`CANCELLED`).", "result": res}

    if c == "security_report":
        fstore = FindingsStore()
        scan_note = ""
        if arg_text.strip():
            target = (ROOT / "workspaces" / arg_text.strip()) if not Path(arg_text.strip()).is_absolute() else Path(arg_text.strip())
            sc = scan_authorized_code(target)
            f_list = sc["scan_json"].get("findings", [])
            scan_note = f"\n• *Live Static Scan (`{target.name}`):* `{len(f_list)}` temuan dianalisis."
        counts = fstore.summary_counts()
        msg = (
            f"🛡️ *Defensive Security Findings Summary*\n"
            f"• *Total Findings:* `{counts['total']}`\n"
            f"• *Under Review:* `{counts['under_review']}` | *Active/Confirmed:* `{counts['confirmed']}`\n"
            f"• *False Positives:* `{counts['false_positive']}` | *Resolved:* `{counts['resolved']}`{scan_note}"
        )
        return {"ok": True, "reply": msg, "counts": counts}

    if c == "update_status":
        ms = read_maint_state()
        au = json.loads(HERMES_UPDATER_STATE.read_text(encoding="utf-8-sig")) if HERMES_UPDATER_STATE.exists() else {}
        msg = (
            f"🕒 *Coordinated Daily Auto-Update (03:00 WIB)*\n"
            f"• *Hermes Updater:* `{au.get('schedule_mode')}` (`last_slot={au.get('last_daily_slot_completed')}`, `next={au.get('next_check')}`, `--no-backup`)\n"
            f"• *Platform Coordinator:* state=`{ms.get('state')}`, `last_slot={ms.get('last_completed_slot')}`, `next={ms.get('next_scheduled_slot')}`"
        )
        return {"ok": True, "reply": msg, "maintenance": ms}

    raise ValueError(f"Unknown platform command: {cmd}")


def emergency_stop_all() -> dict[str, Any]:
    """Governance emergency stop: cancel all live/queued Paperclip runs & pause active worker agents."""
    pc = PaperclipClient()
    cid = pc.get_primary_company()["id"]
    cancelled_runs: list[str] = []
    for r in pc.list_runs(cid, limit=40):
        if r.get("status") in ("queued", "running"):
            pc.cancel_run(r["id"])
            cancelled_runs.append(r["id"])
    targets = [a for a in pc.list_agents(cid) if a.get("status") not in ("paused", "terminated")]
    for a in targets:
        pc.request("POST", f"/api/agents/{a['id']}/pause", {})
    dl = time.time() + 25.0
    while time.time() < dl:
        cur = {a["id"]: a for a in pc.list_agents(cid)}
        if all(cur.get(t["id"], {}).get("status") == "paused" for t in targets):
            break
        time.sleep(0.8)
    return {"cancelled_runs": cancelled_runs, "paused_agents": [t["name"] for t in targets]}


def resume_wave1_agents() -> dict[str, Any]:
    """Resume the 4 Wave-1 core agents after an emergency stop."""
    node_cmd = ROOT / "runtime" / "bin" / "node26.cmd"
    fix_cjs = ROOT / "scripts" / "clear-orphan-cancelled-runs.cjs"
    if node_cmd.exists() and fix_cjs.exists():
        subprocess.run([str(node_cmd), str(fix_cjs)], capture_output=True, timeout=10, check=False)
    pc = PaperclipClient()
    cid = pc.get_primary_company()["id"]
    wave1 = {"CEO Agent", "Backend Developer", "QA Engineer", "Security Reviewer"}
    # Wait briefly for any in-flight pausing transition to settle
    dl_wait = time.time() + 15.0
    while time.time() < dl_wait:
        rows = [a for a in pc.list_agents(cid) if a.get("name") in wave1]
        if not any(a.get("lifecycleState") in ("pausing", "stopping") for a in rows):
            break
        time.sleep(0.8)
    targets = [a for a in pc.list_agents(cid) if a.get("name") in wave1 and a.get("status") == "paused"]
    for a in targets:
        pc.request("POST", f"/api/agents/{a['id']}/resume", {})
    dl = time.time() + 25.0
    while time.time() < dl:
        cur = {a["id"]: a for a in pc.list_agents(cid)}
        if all(cur.get(t["id"], {}).get("status") != "paused" for t in targets):
            break
        time.sleep(0.8)
    return {"resumed_agents": [t["name"] for t in targets]}


def main() -> int:
    parser = argparse.ArgumentParser(prog="ai-platform", description="Unified Autonomous AI Agent Platform CLI")
    sub = parser.add_subparsers(dest="subcmd", required=True)

    for name in ("status", "health", "services", "agents", "tasks", "updates"):
        p = sub.add_parser(name)
        p.add_argument("--json", action="store_true")

    p_logs = sub.add_parser("logs")
    p_logs.add_argument("--tail", type=int, default=30)

    p_tg = sub.add_parser("telegram-cmd")
    p_tg.add_argument("command")
    p_tg.add_argument("--args", default="")
    p_tg.add_argument("--caller-id", default=AUTHORIZED_OWNER_ID)
    p_tg.add_argument("--message-id", default="")
    p_tg.add_argument("--notify", action="store_true")

    sub.add_parser("emergency-stop")
    sub.add_parser("resume-wave1")
    p_maint = sub.add_parser("run-maintenance")
    p_maint.add_argument("--force", action="store_true")
    p_maint.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()

    if args.subcmd in ("status", "health"):
        data = collect_unified_health(deep_llm=False)
        if getattr(args, "json", False):
            print(json.dumps(data, indent=2))
        else:
            print(f"Unified Platform State : {data['platform_state']} ({data['checked_at']})")
            print(f"  Hermes Agent         : healthy={data['hermes'].get('healthy')} commit={str(data['hermes'].get('installed_commit',''))[:10]} telegram={data['hermes'].get('telegram_connected')} cua={data['hermes'].get('cua_status')}")
            print(f"  Paperclip Control    : healthy={data['paperclip'].get('healthy')} v{data['paperclip'].get('version')} agents={data['paperclip'].get('active_agents')}/{data['paperclip'].get('total_agents')} done={data['paperclip'].get('tasks_completed')}")
            print(f"  VulnClaw Defensive   : healthy={data['vulnclaw'].get('healthy')} v{data['vulnclaw'].get('version')} isolated={data['vulnclaw'].get('isolation_verified')} findings={(data['vulnclaw'].get('findings') or {}).get('total', 0)}")
            w = data["windows"]
            print(f"  Windows Host         : CPU={w.get('cpu_pct')}% RAM_free={w.get('ram_free_mb')}MB C_free={w.get('disk_c_free_gb')}GB D_free={w.get('disk_d_free_gb')}GB")
        return 0 if data["platform_state"] in ("HEALTHY", "MAINTENANCE") else 1

    if args.subcmd == "services":
        data = collect_unified_health(deep_llm=False)["services"]
        print(json.dumps(data, indent=2))
        return 0

    if args.subcmd == "agents":
        pc = PaperclipClient()
        cid = pc.get_primary_company()["id"]
        rows = pc.list_agents(cid)
        if getattr(args, "json", False):
            print(json.dumps(rows, indent=2))
        else:
            for a in rows:
                print(f"{a['name']:<28} role={str(a.get('role')):<10} status={str(a.get('status')):<8} budget={a.get('budgetMonthlyCents',0)}c")
        return 0

    if args.subcmd == "tasks":
        pc = PaperclipClient()
        cid = pc.get_primary_company()["id"]
        rows = pc.list_issues(cid)
        if getattr(args, "json", False):
            print(json.dumps(rows, indent=2))
        else:
            for it in rows[:25]:
                print(f"{str(it.get('identifier') or it['id'][:8]):<10} [{str(it.get('status')):<11}] {sanitize_text(str(it.get('title',''))[:68])}")
        return 0

    if args.subcmd == "updates":
        out = {
            "platform_coordinator": read_maint_state(),
            "hermes_updater": json.loads(HERMES_UPDATER_STATE.read_text(encoding="utf-8-sig")) if HERMES_UPDATER_STATE.exists() else {},
        }
        print(json.dumps(out, indent=2))
        return 0

    if args.subcmd == "logs":
        log_file = ROOT / "logs" / "paperclip-launcher.log"
        if log_file.exists():
            lines = log_file.read_text(encoding="utf-8", errors="replace").splitlines()[-args.tail :]
            for ln in lines:
                print(sanitize_text(ln))
        return 0

    if args.subcmd == "telegram-cmd":
        res = handle_telegram_command(args.command, args.args, caller_id=args.caller_id, message_id=args.message_id)
        if args.notify and res.get("reply"):
            res["telegram_delivery"] = send_owner_telegram_notification(res["reply"])
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return 0

    if args.subcmd == "emergency-stop":
        print(json.dumps(emergency_stop_all(), indent=2))
        return 0

    if args.subcmd == "resume-wave1":
        print(json.dumps(resume_wave1_agents(), indent=2))
        return 0

    if args.subcmd == "run-maintenance":
        print(json.dumps(run_maintenance_cycle(force=args.force, dry_run=args.dry_run), indent=2))
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
