#!/usr/bin/env python3
"""Phase 06: Empirical evaluation & end-to-end verification of hermes_gateway and hermes_local adapters."""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")
ALLINONE_HERMES_HOME = os.environ.get("ALLINONE_HERMES_HOME") or str(Path.home() / "AppData" / "Local" / "hermes")
ALLINONE_USER_HOME = os.environ.get("ALLINONE_USER_HOME") or str(Path.home())


ROOT = Path(ALLINONE_HOME)
sys.path.insert(0, str(ROOT))

from integration.hermes_worker_factory import HERMES_EXE, bind_agent_paperclip_key, provision_worker_home
from integration.paperclip_client import PaperclipClient

OWNER_STATE_DB = Path((ALLINONE_HERMES_HOME + r"\state.db"))
SECRET_DIR = ROOT / "config" / "secrets"


def count_sqlite_sessions(db_path: Path) -> int:
    if not db_path.exists():
        return 0
    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
        if not cur.fetchone():
            return 0
        return int(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0])
    finally:
        conn.close()


def read_env_key(path: Path, key: str) -> str:
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise KeyError(f"{key} not found in {path}")


def http_raw(url: str, headers: dict[str, str] | None = None) -> tuple[int, str]:
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")


def evaluate_hermes_gateway_architecture_and_auth(pc: PaperclipClient, company_id: str) -> dict[str, object]:
    """Verify hermes_gateway adapter registration, fail-closed auth rejection, and Hermes SHARED_LISTENER_MIRROR constraint."""
    # Start a minimal mock loopback auth-checking server on 127.0.0.1:8655 that enforces Bearer API_SERVER_KEY
    # to verify Paperclip's hermes_gateway transport/auth rejection without exposing Owner's default Hermes profile.
    import http.server
    import threading

    iso_key = read_env_key(SECRET_DIR / "hermes-api-test.env", "HERMES_ISOLATED_API_KEY")

    class AuthCheckHandler(http.server.BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: object) -> None:
            return

        def _check_auth(self) -> bool:
            auth = self.headers.get("Authorization", "")
            if auth != f"Bearer {iso_key}":
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error":"unauthorized"}')
                return False
            return True

        def do_GET(self) -> None:
            if self.path == "/health":
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status":"ok"}')
                return
            if not self._check_auth():
                return
            if self.path.startswith("/v1/runs/run_gw_eval_01/events"):
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                self.wfile.write(
                    b'event: run.completed\ndata: {"id":"run_gw_eval_01","status":"completed","output":"GATEWAY_TRANSPORT_CONTRACT_VERIFIED"}\n\n'
                )
                return
            if self.path.startswith("/v1/runs/run_gw_eval_01"):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(
                    b'{"id":"run_gw_eval_01","status":"completed","output":"GATEWAY_TRANSPORT_CONTRACT_VERIFIED"}'
                )
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"data":[{"id":"combo/X"}]}')

        def do_POST(self) -> None:
            if not self._check_auth():
                return
            if self.path == "/v1/runs":
                sess_key = self.headers.get("X-Hermes-Session-Key", "")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                body = json.dumps({
                    "id": "run_gw_eval_01",
                    "status": "completed",
                    "session_key_received": bool(sess_key),
                    "output": "GATEWAY_TRANSPORT_CONTRACT_VERIFIED",
                }).encode("utf-8")
                self.wfile.write(body)
                return
            self.send_response(404)
            self.end_headers()

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8655), AuthCheckHandler)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    try:
        unauth_code, _ = http_raw("http://127.0.0.1:8655/v1/models")
        wrong_code, _ = http_raw("http://127.0.0.1:8655/v1/models", {"Authorization": "Bearer invalid-key"})
        auth_code, _ = http_raw("http://127.0.0.1:8655/v1/models", {"Authorization": f"Bearer {iso_key}"})

        # Also test unauthorized Paperclip request with bad Bearer token
        bad_pc_code, _ = http_raw("http://127.0.0.1:3100/api/companies", {"Authorization": "Bearer invalid-paperclip-key"})

        existing_secrets = pc.list_secrets(company_id)
        sec_row = next((s for s in existing_secrets if s.get("name") == "hermes-isolated-gw-eval-key"), None)
        if not sec_row:
            sec_row = pc.create_secret(
                company_id,
                {
                    "name": "hermes-isolated-gw-eval-key",
                    "value": iso_key,
                    "description": "Isolated loopback key for Phase 06 hermes_gateway contract check",
                },
            )

        agents = pc.list_agents(company_id)
        gw_agent = next((a for a in agents if a.get("name") == "Phase06 Gateway Probe"), None)
        gw_cfg = {
            "apiBaseUrl": "http://127.0.0.1:8655",
            "apiKey": {"type": "secret_ref", "secretId": sec_row["id"]},
            "sessionKeyStrategy": "issue",
            "timeoutSec": 60,
            "paperclipApiUrl": "http://127.0.0.1:3100/api",
        }
        if not gw_agent:
            gw_agent = pc.create_agent(
                company_id,
                {
                    "name": "Phase06 Gateway Probe",
                    "role": "general",
                    "title": "Hermes Gateway Contract Evaluator",
                    "adapterType": "hermes_gateway",
                    "adapterConfig": gw_cfg,
                    "permissions": {"canCreateAgents": False, "canCreateSkills": False},
                },
            )
        else:
            gw_agent = pc.update_agent(gw_agent["id"], {"adapterConfig": gw_cfg, "replaceAdapterConfig": True})
            if gw_agent.get("status") == "paused":
                gw_agent = pc.resume_agent(gw_agent["id"])

        prior_gw_ids = {r["id"] for r in pc.list_runs(company_id, agent_id=gw_agent["id"], limit=20)}
        issue = pc.create_issue(
            company_id,
            {
                "title": "Phase 06 hermes_gateway contract & X-Hermes-Session-Key verification",
                "description": "Verify hermes_gateway POST /v1/runs contract and issue-scoped session header.",
                "status": "todo",
                "priority": "low",
                "assigneeAgentId": gw_agent["id"],
            },
        )
        new_gw_run = None
        for attempt in range(10):
            if attempt == 2 and not new_gw_run:
                pc.wake_agent(gw_agent["id"], {"source": "assignment", "trigger": "manual", "payload": {"issueId": issue["id"]}})
            runs = pc.list_runs(company_id, agent_id=gw_agent["id"], limit=10)
            new_gw_run = next((r for r in runs if r["id"] not in prior_gw_ids), None)
            if new_gw_run:
                break
            time.sleep(1.0)
        if not new_gw_run:
            raise RuntimeError("No fresh heartbeat run spawned for Phase06 Gateway Probe")
        run_done = pc.wait_for_run_completion(new_gw_run["id"], timeout_s=45.0)
        pc.update_issue(issue["id"], {"status": "done"})
        pc.pause_agent(gw_agent["id"])

        return {
            "hermes_upstream_finding": "gateway/config.py:333 SHARED_LISTENER_MIRROR_PLATFORMS={'api_server','webhook'}: secondary profiles cannot bind independent api_server port; enabling api_server on default profile would expose Owner profile. Selected hermes_local + named profiles (<root>/profiles/<id>) for strict isolation & 0 MB idle overhead.",
            "unauth_rejected_status": unauth_code,
            "wrong_key_rejected_status": wrong_code,
            "bad_paperclip_token_rejected_status": bad_pc_code,
            "valid_key_status": auth_code,
            "gateway_adapter_run_id": run_done.get("id"),
            "gateway_adapter_run_status": run_done.get("status"),
            "gateway_exit_code": run_done.get("exitCode"),
            "gateway_summary_preview": str((run_done.get("resultJson") or {}).get("output") or run_done.get("summary") or "")[:200],
        }
    finally:
        srv.shutdown()
        srv.server_close()


def verify_hermes_local_e2e(pc: PaperclipClient, company_id: str) -> dict[str, object]:
    """Verify hermes_local adapter end-to-end: file read, code write, unit test, task update, timeout, and cancellation."""
    ws = ROOT / "workspaces" / "phase06-smoke"
    ws.mkdir(parents=True, exist_ok=True)
    for stale in ("calculator.py", "test_calculator.py"):
        (ws / stale).unlink(missing_ok=True)
    if (ws / "__pycache__").exists():
        shutil.rmtree(ws / "__pycache__", ignore_errors=True)
    if not (ws / ".git").exists():
        subprocess.run(["git", "init", str(ws)], capture_output=True, check=True)
    (ws / "requirements_spec.md").write_text(
        "# Smoke Spec\n"
        "1. Create `calculator.py` defining `add_numbers(a: int, b: int) -> int` and `multiply_numbers(a: int, b: int) -> int`.\n"
        "2. Create `test_calculator.py` using Python `unittest` with at least 3 assertions testing both functions.\n"
        "3. Run `python -m unittest discover -v` in this workspace and confirm all tests pass.\n",
        encoding="utf-8",
    )

    local_worker = provision_worker_home(
        "phase06_local_worker",
        role_title="Phase 06 Local Hermes Engineer",
        authorized_workspace=str(ws),
        allowed_toolsets=["file", "terminal"],
    )

    # Create Project & Workspace
    projects = pc.list_projects(company_id)
    proj = next((p for p in projects if p.get("name") == "Phase 06 Smoke Project"), None)
    if not proj:
        proj = pc.create_project(
            company_id,
            {
                "name": "Phase 06 Smoke Project",
                "description": "Isolated test workspace for official Paperclip <-> Hermes adapter verification.",
                "status": "in_progress",
            },
        )
    pws = pc.list_project_workspaces(proj["id"])
    if not pws:
        pc.create_project_workspace(
            proj["id"],
            {
                "name": "phase06-smoke",
                "cwd": str(ws),
                "isPrimary": True,
            },
        )

    # Create hermes_local agent
    agents = pc.list_agents(company_id)
    loc_agent = next((a for a in agents if a.get("name") == "Phase06 Local Engineer"), None)
    loc_cfg = {
        "hermesCommand": HERMES_EXE,
        "model": "combo/X",
        "provider": "auto",
        "timeoutSec": 240,
        "graceSec": 10,
        "maxTurnsPerRun": 15,
        "toolsets": "file,terminal",
        "persistSession": True,
        "worktreeMode": False,
        "quiet": True,
        "cwd": str(ws),
        "instructionsFilePath": local_worker["instructions_file"],
        "paperclipApiUrl": "http://127.0.0.1:3100/api",
        "env": {
            "HERMES_HOME": local_worker["hermes_home"],
        },
    }
    if not loc_agent:
        loc_agent = pc.create_agent(
            company_id,
            {
                "name": "Phase06 Local Engineer",
                "role": "engineer",
                "title": "Hermes Local Verification Engineer",
                "adapterType": "hermes_local",
                "adapterConfig": loc_cfg,
                "permissions": {"canCreateAgents": False, "canCreateSkills": False},
            },
        )
    else:
        loc_agent = pc.update_agent(loc_agent["id"], {"adapterConfig": loc_cfg, "replaceAdapterConfig": True})
        if loc_agent.get("status") == "paused":
            loc_agent = pc.resume_agent(loc_agent["id"])

    bind_agent_paperclip_key(local_worker["hermes_home"], pc, loc_agent["id"], "phase06_local_worker")
    prior_loc_ids = {r["id"] for r in pc.list_runs(company_id, agent_id=loc_agent["id"], limit=20)}

    issue = pc.create_issue(
        company_id,
        {
            "title": "Implement and test calculator module from requirements_spec.md",
            "description": (
                f"Working in `{ws.as_posix()}`, read `requirements_spec.md`, create `calculator.py` and "
                "`test_calculator.py`, run `python -m unittest discover -v`, and update this Paperclip issue "
                "status to `done` using Python `urllib.request` in terminal with `$PAPERCLIP_API_KEY` and `$PAPERCLIP_TASK_ID`."
            ),
            "projectId": proj["id"],
            "status": "todo",
            "priority": "high",
            "assigneeAgentId": loc_agent["id"],
        },
    )

    new_loc_run = None
    for attempt in range(12):
        if attempt == 2 and not new_loc_run:
            pc.wake_agent(loc_agent["id"], {"source": "assignment", "trigger": "manual", "payload": {"issueId": issue["id"]}})
        runs = pc.list_runs(company_id, agent_id=loc_agent["id"], limit=10)
        new_loc_run = next((r for r in runs if r["id"] not in prior_loc_ids), None)
        if new_loc_run:
            break
        time.sleep(1.0)
    if not new_loc_run:
        raise RuntimeError("No fresh heartbeat run spawned for Phase06 Local Engineer")

    run_done = pc.wait_for_run_completion(new_loc_run["id"], timeout_s=260.0)

    # Independently verify created files & unit tests on host
    calc_exists = (ws / "calculator.py").exists()
    test_exists = (ws / "test_calculator.py").exists()
    ut = subprocess.run(
        ["python", "-m", "unittest", "discover", "-s", str(ws), "-v"],
        capture_output=True,
        text=True,
        check=False,
    )
    updated_issue = pc.get_issue(issue["id"])
    issue_updated_by_agent = updated_issue.get("status") == "done"
    if not issue_updated_by_agent and calc_exists and test_exists and ut.returncode == 0:
        updated_issue = pc.update_issue(issue["id"], {"status": "done", "comment": "Verified passing unit tests on host."})

    # Verify Timeout handling (timeoutSec = 4 on a deliberate 20s sleep task)
    to_agent_cfg = dict(loc_cfg, timeoutSec=4, graceSec=2, persistSession=False)
    probe_name = f"Phase06 Lifecycle Probe {int(time.time()) % 10000}"
    to_agent = pc.create_agent(
        company_id,
        {
            "name": probe_name,
            "role": "general",
            "adapterType": "hermes_local",
            "adapterConfig": to_agent_cfg,
            "permissions": {"canCreateAgents": False, "canCreateSkills": False},
        },
    )

    prior_to_ids = {r["id"] for r in pc.list_runs(company_id, agent_id=to_agent["id"], limit=20)}
    to_issue = pc.create_issue(
        company_id,
        {
            "title": "Phase 06 timeout verification",
            "description": "Run `python -c \"import time; time.sleep(25)\"` in terminal and wait for it.",
            "projectId": proj["id"],
            "status": "todo",
            "priority": "low",
            "assigneeAgentId": to_agent["id"],
        },
    )
    new_to_run = None
    for attempt in range(10):
        if attempt == 2 and not new_to_run:
            pc.wake_agent(to_agent["id"], {"source": "assignment", "trigger": "manual", "payload": {"issueId": to_issue["id"]}})
        to_runs = pc.list_runs(company_id, agent_id=to_agent["id"], limit=10)
        new_to_run = next((r for r in to_runs if r["id"] not in prior_to_ids), None)
        if new_to_run:
            break
        time.sleep(1.0)
    if not new_to_run:
        raise RuntimeError("No fresh timeout run spawned")
    to_run_done = pc.wait_for_run_completion(new_to_run["id"], timeout_s=60.0)
    pc.update_issue(to_issue["id"], {"status": "cancelled"})

    # Verify explicit Run Cancellation
    cancel_cfg = dict(loc_cfg, timeoutSec=120, persistSession=False)
    to_agent = pc.update_agent(to_agent["id"], {"adapterConfig": cancel_cfg, "replaceAdapterConfig": True})
    if to_agent.get("status") == "paused" or to_agent.get("lifecycleState") != "ready":
        to_agent = pc.resume_agent(to_agent["id"])
    prior_cancel_ids = {r["id"] for r in pc.list_runs(company_id, agent_id=to_agent["id"], limit=20)}
    cancel_issue = pc.create_issue(
        company_id,
        {
            "title": "Phase 06 cancellation verification",
            "description": "Run `python -c \"import time; time.sleep(45)\"` in terminal before replying.",
            "projectId": proj["id"],
            "status": "todo",
            "priority": "low",
            "assigneeAgentId": to_agent["id"],
        },
    )
    deadline = time.time() + 25.0
    cancel_run_id = None
    while time.time() < deadline:
        c_runs = pc.list_runs(company_id, agent_id=to_agent["id"], limit=10)
        active = next((r for r in c_runs if r["id"] not in prior_cancel_ids and r.get("status") == "running"), None)
        if active:
            cancel_run_id = active["id"]
            break
        time.sleep(1.0)
    if not cancel_run_id:
        pc.wake_agent(to_agent["id"], {"source": "assignment", "trigger": "manual", "payload": {"issueId": cancel_issue["id"]}})
        time.sleep(3.0)
        c_runs = pc.list_runs(company_id, agent_id=to_agent["id"], limit=10)
        cand = next((r for r in c_runs if r["id"] not in prior_cancel_ids), c_runs[0])
        cancel_run_id = cand["id"]
    else:
        time.sleep(2.5)

    pc.cancel_run(cancel_run_id)
    cancel_done = pc.wait_for_run_completion(cancel_run_id, timeout_s=45.0)
    pc.update_issue(cancel_issue["id"], {"status": "cancelled"})
    # Terminate ephemeral Phase 06 probe agent so it doesn't clutter the production org roster!
    pc.request("POST", f"/api/agents/{to_agent['id']}/terminate", {})
    time.sleep(2.0)
    pc.request("DELETE", f"/api/agents/{to_agent['id']}")
    pc.pause_agent(loc_agent["id"])

    worker_sessions = count_sqlite_sessions(Path(local_worker["hermes_home"]) / "state.db")

    return {
        "issue_id": issue["id"],
        "issue_identifier": updated_issue.get("identifier"),
        "issue_final_status": updated_issue.get("status"),
        "issue_updated_by_agent": issue_updated_by_agent,
        "run_id": run_done.get("id"),
        "run_status": run_done.get("status"),
        "exit_code": run_done.get("exitCode"),
        "session_id_captured": (run_done.get("resultJson") or {}).get("session_id") if isinstance(run_done.get("resultJson"), dict) else run_done.get("sessionIdDisplay"),
        "calculator_created": calc_exists,
        "test_created": test_exists,
        "unittest_exit_code": ut.returncode,
        "unittest_output": (ut.stdout + "\n" + ut.stderr).strip()[-400:],
        "timeout_run_id": to_run_done.get("id"),
        "timeout_run_status": to_run_done.get("status"),
        "timeout_flag": to_run_done.get("timedOut"),
        "cancelled_run_id": cancel_done.get("id"),
        "cancelled_run_status": cancel_done.get("status"),
        "worker_isolated_sessions_count": worker_sessions,
    }


def main() -> int:
    owner_sessions_before = count_sqlite_sessions(OWNER_STATE_DB)
    pc = PaperclipClient()
    company = pc.get_primary_company()
    cid = company["id"]

    print("1. Evaluating hermes_gateway adapter contract, auth rejection & profile architecture...")
    gw_res = evaluate_hermes_gateway_architecture_and_auth(pc, cid)
    print("hermes_gateway_result:", json.dumps(gw_res, indent=2))

    print("2. Verifying production hermes_local adapter end-to-end...")
    loc_res = verify_hermes_local_e2e(pc, cid)
    print("hermes_local_result:", json.dumps(loc_res, indent=2))

    owner_sessions_after = count_sqlite_sessions(OWNER_STATE_DB)
    health_proc = subprocess.run(
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
        check=True,
    )
    h_json = json.loads(health_proc.stdout)

    summary = {
        "owner_sessions_before": owner_sessions_before,
        "owner_sessions_after": owner_sessions_after,
        "owner_sessions_untouched": owner_sessions_before == owner_sessions_after,
        "telegram_gateway_healthy": bool(h_json.get("overall_healthy")),
        "hermes_gateway_eval": gw_res,
        "hermes_local_e2e": loc_res,
    }
    out_path = ROOT / "reports" / "phase06-adapter-verification.json"
    out_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("PHASE06_SUMMARY_SAVED:", str(out_path))
    print("owner_sessions_untouched:", summary["owner_sessions_untouched"], f"({owner_sessions_before} -> {owner_sessions_after})")
    print("telegram_gateway_healthy:", summary["telegram_gateway_healthy"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
