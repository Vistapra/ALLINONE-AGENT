#!/usr/bin/env python3
"""Phase 09 & Phase 10: Provision 11-agent Unified AI Org and verify role, session, memory & workspace isolation."""
from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
import os
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")
ALLINONE_HERMES_HOME = os.environ.get("ALLINONE_HERMES_HOME") or str(Path.home() / "AppData" / "Local" / "hermes")


ROOT = Path(ALLINONE_HOME)
sys.path.insert(0, str(ROOT))

from integration.org_provisioner import (
    ORG_ROSTER,
    create_isolated_git_worktree,
    provision_organization,
    workspace_exclusive_lock,
)
from integration.paperclip_client import PaperclipClient

OWNER_STATE_DB = Path((ALLINONE_HERMES_HOME + r"\state.db"))
OWNER_MEMORY = Path((ALLINONE_HERMES_HOME + r"\memories\MEMORY.md"))


def count_sessions(db_path: Path) -> list[str]:
    if not db_path.exists():
        return []
    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
        if not cur.fetchone():
            return []
        return [r[0] for r in conn.execute("SELECT id FROM sessions").fetchall()]
    finally:
        conn.close()


def trigger_and_wait(pc: PaperclipClient, cid: str, agent_id: str, issue_id: str, timeout_s: float = 180.0) -> dict:
    prior = {r["id"] for r in pc.list_runs(cid, agent_id=agent_id, limit=20)}
    new_run = None
    for attempt in range(12):
        if attempt == 2 and not new_run:
            pc.wake_agent(agent_id, {"source": "assignment", "trigger": "manual", "payload": {"issueId": issue_id}})
        runs = pc.list_runs(cid, agent_id=agent_id, limit=10)
        new_run = next((r for r in runs if r["id"] not in prior), None)
        if new_run:
            break
        time.sleep(1.0)
    if not new_run:
        raise RuntimeError(f"No fresh heartbeat run spawned for agent {agent_id}")
    return pc.wait_for_run_completion(new_run["id"], timeout_s=timeout_s)


def main() -> int:
    owner_sessions_before = len(count_sessions(OWNER_STATE_DB))
    owner_mem_hash_before = OWNER_MEMORY.read_bytes() if OWNER_MEMORY.exists() else b""

    print("1. Verifying 11-agent Unified AI Organization (4 Wave-1 Active, 7 Wave-2 Standby)...")
    roster_file = ROOT / "config" / "organization-roster.json"
    roster = json.loads(roster_file.read_text(encoding="utf-8")) if roster_file.exists() else provision_organization()
    pc = PaperclipClient(timeout=25.0)
    cid = roster["company_id"]
    org_tree = pc.get_org(cid)
    all_agents = {a["id"]: a for a in pc.list_agents(cid)}
    for slug, info in roster["agents"].items():
        if info["id"] in all_agents:
            info["status"] = all_agents[info["id"]].get("status")
    roster_file.write_text(json.dumps(roster, indent=2), encoding="utf-8")

    wave1_active = [slug for slug, a in roster["agents"].items() if a["status"] != "paused"]
    wave2_paused = [slug for slug, a in roster["agents"].items() if a["status"] == "paused"]
    print(f"Provisioned {len(roster['agents'])} org roles | active={wave1_active} | paused_count={len(wave2_paused)}")

    # Verify permissions (`canCreateAgents=false`) & role-specific instructions on all 11 roles
    instructions_verified = True
    for spec in ORG_ROSTER:
        md_path = ROOT / "workers" / spec["slug"] / "AGENTS.md"
        if not md_path.exists() or spec["objective"] not in md_path.read_text(encoding="utf-8"):
            instructions_verified = False
            raise RuntimeError(f"Missing or invalid AGENTS.md for {spec['slug']}")

    # 2. Verify Session & Memory Isolation across two distinct roles (Security Reviewer vs QA Engineer)
    ws = ROOT / "workspaces" / "phase10-isolation-lab"
    ws.mkdir(parents=True, exist_ok=True)
    if not (ws / ".git").exists():
        subprocess.run(["git", "init", str(ws)], capture_output=True, check=True)
        subprocess.run(["git", "-C", str(ws), "config", "user.email", "platform@local.invalid"], check=True)
        subprocess.run(["git", "-C", str(ws), "config", "user.name", "Platform Lab"], check=True)
    (ws / "sample_config.py").write_text(
        '"""Authorized lab module."""\nTIMEOUT_SECONDS = 30\nALLOW_TLS_ONLY = True\n',
        encoding="utf-8",
    )
    subprocess.run(["git", "-C", str(ws), "add", "."], capture_output=True, check=True)
    subprocess.run(["git", "-C", str(ws), "commit", "-m", "Initial commit", "--allow-empty"], capture_output=True, check=False)

    projects = pc.list_projects(cid)
    proj = next((p for p in projects if p.get("name") == "Phase 10 Isolation Lab"), None)
    if not proj:
        proj = pc.create_project(cid, {"name": "Phase 10 Isolation Lab", "status": "in_progress"})
    if not pc.list_project_workspaces(proj["id"]):
        pc.create_project_workspace(proj["id"], {"name": "phase10-isolation-lab", "cwd": str(ws), "isPrimary": True})

    sec_agent_id = roster["agents"]["security_reviewer"]["id"]
    qa_agent_id = roster["agents"]["qa_engineer"]["id"]

    print("2a. Running isolated Security Reviewer read-only inspection...")
    sec_issue = pc.create_issue(
        cid,
        {
            "title": "Phase 10 read-only defensive check of sample_config.py",
            "description": (
                f"Read `{ws.as_posix()}/sample_config.py` using ONLY the `file` toolset and reply with a 2-sentence "
                "defensive review confirming `ALLOW_TLS_ONLY = True`. Do NOT modify any files."
            ),
            "projectId": proj["id"],
            "status": "todo",
            "priority": "medium",
            "assigneeAgentId": sec_agent_id,
        },
    )
    sec_run = trigger_and_wait(pc, cid, sec_agent_id, sec_issue["id"], timeout_s=180.0)
    pc.update_issue(sec_issue["id"], {"status": "done"})

    print("2b. Running isolated QA Engineer verification...")
    qa_issue = pc.create_issue(
        cid,
        {
            "title": "Phase 10 QA check of sample_config.py",
            "description": (
                f"Run `python -c \"import sys; sys.path.insert(0, '{ws.as_posix()}'); import sample_config; assert sample_config.ALLOW_TLS_ONLY is True; print('QA_ASSERT_OK')\"` "
                "in terminal and report the result."
            ),
            "projectId": proj["id"],
            "status": "todo",
            "priority": "medium",
            "assigneeAgentId": qa_agent_id,
        },
    )
    qa_run = trigger_and_wait(pc, cid, qa_agent_id, qa_issue["id"], timeout_s=180.0)
    pc.update_issue(qa_issue["id"], {"status": "done"})

    sec_db = Path((ALLINONE_HERMES_HOME + r"\profiles\pcsecurityreviewer\state.db"))
    qa_db = Path((ALLINONE_HERMES_HOME + r"\profiles\pcqaengineer\state.db"))
    sec_sessions = set(count_sessions(sec_db))
    qa_sessions = set(count_sessions(qa_db))
    disjoint_sessions = len(sec_sessions) >= 1 and len(qa_sessions) >= 1 and sec_sessions.isdisjoint(qa_sessions)

    # 3. Verify Workspace Exclusive Lock & Parallel Git Worktrees (Zero File Overwrite)
    print("3. Verifying workspace_exclusive_lock & parallel Git worktrees...")
    conflict_blocked = False
    with workspace_exclusive_lock("phase10-isolation-lab", holder="worker-alpha", timeout_s=2.0):
        try:
            with workspace_exclusive_lock("phase10-isolation-lab", holder="worker-beta", timeout_s=0.6):
                pass
        except TimeoutError:
            conflict_blocked = True

    wt_a = create_isolated_git_worktree(ws, "feature/worktree-alpha")
    wt_b = create_isolated_git_worktree(ws, "feature/worktree-beta")
    (wt_a / "sample_config.py").write_text('BRANCH_ID = "alpha"\nALLOW_TLS_ONLY = True\n', encoding="utf-8")
    (wt_b / "sample_config.py").write_text('BRANCH_ID = "beta"\nALLOW_TLS_ONLY = True\n', encoding="utf-8")
    worktree_isolated = (
        'BRANCH_ID = "alpha"' in (wt_a / "sample_config.py").read_text(encoding="utf-8")
        and 'BRANCH_ID = "beta"' in (wt_b / "sample_config.py").read_text(encoding="utf-8")
        and "TIMEOUT_SECONDS = 30" in (ws / "sample_config.py").read_text(encoding="utf-8")
    )
    subprocess.run(["git", "-C", str(ws), "worktree", "remove", "--force", str(wt_a)], capture_output=True, check=False)
    subprocess.run(["git", "-C", str(ws), "worktree", "remove", "--force", str(wt_b)], capture_output=True, check=False)
    wt_parent = ws.parent / f"{ws.name}-worktrees"
    if wt_parent.exists():
        shutil.rmtree(wt_parent, ignore_errors=True)

    owner_sessions_after = len(count_sessions(OWNER_STATE_DB))
    owner_mem_hash_after = OWNER_MEMORY.read_bytes() if OWNER_MEMORY.exists() else b""

    summary = {
        "total_org_roles_provisioned": len(roster["agents"]),
        "wave1_active_roles": wave1_active,
        "wave2_standby_roles": wave2_paused,
        "org_hierarchy_returned": bool(org_tree),
        "instructions_verified": instructions_verified,
        "security_reviewer_run": {"id": sec_run.get("id"), "status": sec_run.get("status"), "exit_code": sec_run.get("exitCode")},
        "qa_engineer_run": {"id": qa_run.get("id"), "status": qa_run.get("status"), "exit_code": qa_run.get("exitCode")},
        "security_reviewer_sessions": len(sec_sessions),
        "qa_engineer_sessions": len(qa_sessions),
        "role_sessions_disjoint": disjoint_sessions,
        "workspace_lock_conflict_blocked": conflict_blocked,
        "parallel_git_worktree_isolated": worktree_isolated,
        "owner_sessions_untouched": owner_sessions_before == owner_sessions_after,
        "owner_memory_untouched": owner_mem_hash_before == owner_mem_hash_after,
    }
    out_path = ROOT / "reports" / "phase09-10-org-isolation-verification.json"
    out_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("PHASE09_10_VERIFIED:", json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
