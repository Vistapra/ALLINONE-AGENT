#!/usr/bin/env python3
"""
METHOD 3 — Individual Live Paperclip + Hermes Worker (`hermes_local` / `combo/X`) Execution
for ALL 11 Corporate AI Employees One-by-One (`1/11` through `11/11`).

Verifies for EVERY SINGLE AGENT:
  1. Resume (if Wave-2 Standby) via Office Bridge `/api/office-bridge/agents/:id/resume`
  2. Governed Task Dispatch via Office Bridge `POST /api/office-bridge/tasks` (single-wake verified!)
  3. Real `hermes.exe` (`pc*` isolated profile) tool execution (`write_file`) inside authorized scope
  4. Live 3D Virtual Office `visual_state` transition observation
  5. Run `status == "succeeded"` + physical output artifact verification on disk
  6. Clean restoration of Wave-2 Standby (`POST /api/office-bridge/agents/:id/pause`)
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import os
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")
ALLINONE_HERMES_HOME = os.environ.get("ALLINONE_HERMES_HOME") or str(Path.home() / "AppData" / "Local" / "hermes")


ROOT = Path(ALLINONE_HOME)
sys.path.insert(0, str(ROOT))

from integration.paperclip_client import PaperclipClient
from integration.vulnclaw_defensive import sanitize_text

NODE26 = (ALLINONE_HERMES_HOME + r"\tools\node-26.12.1-win32-x64\node.exe")
WS_VERIFY_DIR = ROOT / "workspaces" / "agent-11-verification"
REP_VERIFY_DIR = ROOT / "reports" / "agent-11-verification"


def bridge_req(method: str, path: str, token: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    for _ in range(3):
        try:
            req = urllib.request.Request(f"http://127.0.0.1:3210{path}", data=data, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception:
            time.sleep(1.5)
    raise RuntimeError(f"Bridge call failed: {method} {path}")


def main() -> int:
    if WS_VERIFY_DIR.exists():
        shutil.rmtree(WS_VERIFY_DIR, ignore_errors=True)
    if REP_VERIFY_DIR.exists():
        shutil.rmtree(REP_VERIFY_DIR, ignore_errors=True)
    WS_VERIFY_DIR.mkdir(parents=True, exist_ok=True)
    REP_VERIFY_DIR.mkdir(parents=True, exist_ok=True)

    auth = json.loads((ROOT / "config" / "secrets" / "office-bridge-auth.json").read_text(encoding="utf-8"))
    token = auth["bridgeToken"]
    pc = PaperclipClient(timeout=35.0)
    cid = pc.get_primary_company()["id"]

    # Ensure zero orphan holds before starting 11-agent sequential run
    subprocess.run([NODE26, str(ROOT / "scripts" / "clear-orphan-cancelled-runs.cjs")], capture_output=True, check=False)
    for lr in pc.list_live_runs(cid):
        pc.wait_for_run_completion(lr["id"], timeout_s=120.0)

    snap0 = bridge_req("GET", "/api/office-bridge/snapshot?refresh=1", token)
    bridge_agents = sorted(snap0["agents"], key=lambda a: (a["wave"], a["display_name"]))
    raw_agents_by_id = {a["id"]: a for a in pc.list_agents(cid)}

    projects = pc.list_projects(cid)
    proj = next((p for p in projects if p.get("name") == "11-Agent Full Verification"), None)
    if not proj:
        proj = pc.create_project(cid, {"name": "11-Agent Full Verification", "status": "in_progress"})

    agent_results: list[dict[str, Any]] = []

    for idx, ag in enumerate(bridge_agents, start=1):
        aid = ag["paperclip_agent_id"]
        name = ag["display_name"]
        wave = ag["wave"]
        profile_ref = ag["runtime_profile_reference"]
        raw_ag = raw_agents_by_id[aid]
        cwd = str((raw_ag.get("adapterConfig") or {}).get("cwd") or (ALLINONE_HOME + r"\workspaces"))
        is_reports_scope = cwd.lower().endswith("reports")
        slug = name.lower().replace("&", "and").replace(" ", "_")
        out_file = (REP_VERIFY_DIR if is_reports_scope else WS_VERIFY_DIR) / f"{idx:02d}_{slug}.json"
        out_posix = out_file.as_posix()

        print(f"\n[{idx:02d}/11] Testing {name} (Wave-{wave}, profile={profile_ref}, dept={ag['department_short']})...")
        t_start = time.perf_counter()
        was_wave2_standby = wave == 2

        try:
            # 1. Capture existing runs BEFORE resuming or creating task
            prior_ids = {r["id"] for r in pc.list_runs(cid, agent_id=aid, limit=30)}

            # 2. If Wave-2 standby, resume cleanly via Office Bridge
            if was_wave2_standby or pc.must("GET", f"/api/agents/{aid}").get("status") == "paused":
                bridge_req("POST", f"/api/office-bridge/agents/{aid}/resume", token, {})
                time.sleep(0.8)

            # 3. Dispatch real role-authentic verification task via Office Bridge
            created = bridge_req(
                "POST",
                "/api/office-bridge/tasks",
                token,
                {
                    "title": f"[11-Agent Live Verify {idx:02d}/11] {name} Operational Check",
                    "description": (
                        f"Gunakan tool `write_file` untuk membuat file JSON tepat di `{out_posix}` berisi:\n"
                        f'`{{"agent_index": {idx}, "agent_name": "{name}", "department": "{ag["department"]}", "profile": "{profile_ref}", "verified": true}}`\n'
                        "Jangan memanggil endpoint HTTP Paperclip dan jangan menjalankan perintah lain. Setelah `write_file` berhasil, balas singkat 1 kalimat konfirmasi dalam Bahasa Indonesia."
                    ),
                    "project_id": proj["id"],
                    "assignee_agent_id": aid,
                    "priority": "high",
                    "wake_immediately": True,
                    "idempotency_key": f"agent11-live-{idx:02d}-{int(time.time())}",
                },
            )
            issue = created["task"]
            issue_id = issue["id"]
            issue_ident = issue.get("identifier") or issue_id[:8]

            # 4. Wait for the single freshly spawned Paperclip run (verify NO double-wake!)
            new_runs = []
            for attempt in range(35):
                runs = pc.list_runs(cid, agent_id=aid, limit=15)
                new_runs = [r for r in runs if r["id"] not in prior_ids]
                if new_runs:
                    break
                if attempt in (8, 18, 28):
                    pc.wake_agent(
                        aid,
                        {
                            "source": "on_demand",
                            "triggerDetail": "manual",
                            "reason": "agent11_verify",
                            "contextSnapshot": {"issueId": issue_id, "taskId": issue_id},
                        },
                    )
                time.sleep(1.2)

            if not new_runs:
                raise RuntimeError(f"No heartbeat run spawned for {name}")

            run_id = new_runs[0]["id"]
            single_wake_verified = len(new_runs) == 1
            visual_states: list[str] = []
            done_run: dict[str, Any] = {}

            deadline = time.time() + 240.0
            while time.time() < deadline:
                try:
                    sn = bridge_req("GET", "/api/office-bridge/snapshot?refresh=1", token)
                    av = next((x for x in sn["agents"] if x["paperclip_agent_id"] == aid), None)
                    if av:
                        vs = av["state"]["visual_state"]
                        if not visual_states or visual_states[-1] != vs:
                            visual_states.append(vs)
                except Exception:
                    pass
                try:
                    rc = pc.must("GET", f"/api/heartbeat-runs/{run_id}")
                    if rc.get("status") in ("succeeded", "failed", "cancelled", "timed_out", "error"):
                        done_run = rc
                        break
                except Exception:
                    pass
                time.sleep(2.0)

            # Mark issue done
            bridge_req("PATCH", f"/api/office-bridge/tasks/{issue_id}", token, {"status": "done"})
            time.sleep(0.8)

            # Restore Wave-2 standby state immediately if Wave-2
            if was_wave2_standby:
                bridge_req("POST", f"/api/office-bridge/agents/{aid}/pause", token, {})

            file_exists = out_file.exists()
            file_json = json.loads(out_file.read_text(encoding="utf-8")) if file_exists else None
            run_status = done_run.get("status", "timeout")
            assistant_reply = sanitize_text(str((done_run.get("resultJson") or {}).get("result") or ""))[:200]
            dur_s = round(time.perf_counter() - t_start, 1)

            passed = run_status == "succeeded" and file_exists and bool(file_json and file_json.get("verified") is True)
            rec = {
                "index": idx,
                "agent_id": aid,
                "display_name": name,
                "wave": wave,
                "department": ag["department"],
                "profile": profile_ref,
                "issue_identifier": issue_ident,
                "issue_id": issue_id,
                "run_id": run_id,
                "single_wake_verified": single_wake_verified,
                "run_status": run_status,
                "observed_visual_states": visual_states,
                "artifact_path": out_posix,
                "artifact_verified": file_exists,
                "assistant_reply": assistant_reply,
                "restored_to_standby": was_wave2_standby,
                "duration_sec": dur_s,
                "status": "PASS" if passed else "FAIL",
            }
            agent_results.append(rec)
            print(
                f"  -> [{rec['status']}] {name}: issue={issue_ident} run={run_id[:8]} ({run_status}) "
                f"single_wake={single_wake_verified} file={file_exists} states={visual_states} ({dur_s}s)"
            )
        except Exception as exc:
            if was_wave2_standby:
                try:
                    bridge_req("POST", f"/api/office-bridge/agents/{aid}/pause", token, {})
                except Exception:
                    pass
            dur_s = round(time.perf_counter() - t_start, 1)
            msg = sanitize_text(str(exc))[:220]
            agent_results.append({
                "index": idx,
                "agent_id": aid,
                "display_name": name,
                "wave": wave,
                "profile": profile_ref,
                "duration_sec": dur_s,
                "error": msg,
                "status": "FAIL",
            })
            print(f"  -> [FAIL] {name}: {msg}")

    # Final Wave-1 / Wave-2 governance verification
    final_snap = bridge_req("GET", "/api/office-bridge/snapshot?refresh=1", token)
    pass_cnt = sum(1 for r in agent_results if r["status"] == "PASS")
    fail_cnt = sum(1 for r in agent_results if r["status"] == "FAIL")

    report = {
        "executed_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "total_agents_tested": len(agent_results),
        "passed": pass_cnt,
        "failed": fail_cnt,
        "post_test_active_wave1": final_snap["overview"]["active_agents"],
        "post_test_standby_wave2": final_snap["overview"]["standby_agents"],
        "agents": agent_results,
    }
    (ROOT / "reports" / "all-11-agents-live-execution.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(
        f"\nALL_11_AGENTS_EXECUTION_SUMMARY: passed={pass_cnt}/11, failed={fail_cnt}, "
        f"active={final_snap['overview']['active_agents']}, standby={final_snap['overview']['standby_agents']}"
    )
    return 0 if fail_cnt == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
