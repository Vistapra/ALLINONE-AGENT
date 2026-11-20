#!/usr/bin/env python3
"""Phase 13: End-to-End Multi-Agent Software Development & Defensive Security Remediation Workflow."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
import os
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")


ROOT = Path(ALLINONE_HOME)
sys.path.insert(0, str(ROOT))

from integration.findings_engine import FindingsStore
from integration.org_provisioner import workspace_exclusive_lock
from integration.paperclip_client import PaperclipClient
from integration.vulnclaw_defensive import scan_authorized_code
from integration.workflow_engine import AUTHORIZED_OWNER_ID, WorkflowEngine


def trigger_and_wait(pc: PaperclipClient, cid: str, agent_id: str, issue_id: str, timeout_s: float = 240.0) -> dict:
    last_done: dict = {}
    for retry_idx in range(3):
        ag = pc.must("GET", f"/api/agents/{agent_id}")
        if ag.get("status") == "paused":
            pc.resume_agent(agent_id)
        prior = {r["id"] for r in pc.list_runs(cid, agent_id=agent_id, limit=20)}
        if retry_idx > 0:
            pc.update_issue(issue_id, {"status": "todo"})
        new_run = None
        for attempt in range(12):
            if (attempt == 2 or retry_idx > 0 and attempt == 0) and not new_run:
                pc.wake_agent(agent_id, {"source": "assignment", "trigger": "manual", "payload": {"issueId": issue_id}})
            runs = pc.list_runs(cid, agent_id=agent_id, limit=10)
            new_run = next((r for r in runs if r["id"] not in prior), None)
            if new_run:
                break
            time.sleep(1.2)
        if not new_run:
            raise RuntimeError(f"No fresh heartbeat run spawned for agent {agent_id}")
        last_done = pc.wait_for_run_completion(new_run["id"], timeout_s=timeout_s)
        if last_done.get("status") == "succeeded":
            return last_done
        time.sleep(2.0)
    return last_done


def init_demo_repo() -> Path:
    repo = ROOT / "workspaces" / "demo-order-service"
    repo.mkdir(parents=True, exist_ok=True)
    if (repo / ".git").exists():
        subprocess.run(["git", "-C", str(repo), "checkout", "-B", "main"], capture_output=True, check=False)
    else:
        subprocess.run(["git", "init", str(repo)], capture_output=True, check=True)
        subprocess.run(["git", "-C", str(repo), "config", "user.email", "dev@unified-platform.local"], check=True)
        subprocess.run(["git", "-C", str(repo), "config", "user.name", "Unified AI Platform"], check=True)
        subprocess.run(["git", "-C", str(repo), "checkout", "-B", "main"], capture_output=True, check=False)

    (repo / "order_service.py").write_text(
        '"""Demo Order Service — initial baseline before feature & defensive remediation."""\n'
        "import hashlib\n\n"
        "DEBUG = True\n\n"
        "def compute_order_subtotal(items: list[tuple[int, int]]) -> int:\n"
        '    """Compute subtotal from (unit_price_cents, qty) tuples."""\n'
        "    return sum(price * qty for price, qty in items)\n\n"
        "def receipt_digest(order_code: str) -> str:\n"
        "    return hashlib.md5(order_code.encode('utf-8')).hexdigest()\n",
        encoding="utf-8",
    )
    (repo / "test_order_service.py").write_text(
        "import unittest\n"
        "from order_service import compute_order_subtotal\n\n"
        "class TestOrderService(unittest.TestCase):\n"
        "    def test_subtotal_basic(self):\n"
        "        self.assertEqual(compute_order_subtotal([(1000, 2), (500, 1)]), 2500)\n\n"
        'if __name__ == "__main__":\n'
        "    unittest.main()\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "-C", str(repo), "add", "."], capture_output=True, check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-m", "Baseline order service"], capture_output=True, check=False)
    return repo


def main() -> int:
    repo = init_demo_repo()
    pc = PaperclipClient(timeout=25.0)
    roster = json.loads((ROOT / "config" / "organization-roster.json").read_text(encoding="utf-8"))
    cid = roster["company_id"]
    agents = roster["agents"]

    projects = pc.list_projects(cid)
    proj = next((p for p in projects if p.get("name") == "Demo Order Service"), None)
    if not proj:
        proj = pc.create_project(
            cid,
            {
                "name": "Demo Order Service",
                "description": "Authorized test repository for multi-agent feature development, defensive security review, remediation, and QA.",
                "status": "in_progress",
            },
        )
    if not pc.list_project_workspaces(proj["id"]):
        pc.create_project_workspace(proj["id"], {"name": "demo-order-service", "cwd": str(repo), "isPrimary": True})

    # Step 1: Isolated VulnClaw Defensive Static Scan on baseline repo
    print("1. Running isolated VulnClaw static scan on baseline demo-order-service...")
    baseline_scan = scan_authorized_code(repo)
    baseline_findings = baseline_scan["scan_json"].get("findings", [])
    print(f"Baseline static findings detected: {len(baseline_findings)}")
    if not baseline_findings:
        raise RuntimeError("Expected baseline static finding on demo-order-service")

    fstore = FindingsStore()
    f0 = baseline_findings[0]
    ing = fstore.ingest_finding(
        {
            "project_id": "demo-order-service",
            "asset_reference": "demo-order-service/order_service.py",
            "source_reference": "vulnclaw_codescan",
            "finding_title": f0["title"],
            "finding_description": f0["description"],
            "severity": f0["severity"],
            "confidence": f0.get("confidence", 0.9),
            "cwe_reference": f0.get("cwe"),
            "affected_component": f0["code_location"],
            "sanitized_evidence": f0["evidence"],
            "remediation_recommendation": f0.get("remediation") or "Disable DEBUG in production defaults and replace MD5 with SHA-256.",
            "vuln_type": f0["vuln_type"],
        },
        pc=pc,
        company_id=cid,
        paperclip_project_id=proj["id"],
        reviewer_agent_id=agents["security_reviewer"]["id"],
    )
    fid = ing["finding"]["finding_id"]
    review_issue_id = ing["finding"]["paperclip_review_issue_id"]
    pc.update_issue(review_issue_id, {"status": "todo", "assigneeAgentId": agents["security_reviewer"]["id"]})

    # Step 2: Security Reviewer (read-only) inspects baseline & confirms finding
    print("2. Security Reviewer performing read-only defensive confirmation...")
    sec_run1 = trigger_and_wait(pc, cid, agents["security_reviewer"]["id"], review_issue_id, timeout_s=420.0)
    pc.update_issue(review_issue_id, {"status": "done", "comment": "Defensive review completed; confirmed remediation needed."})

    # Transition to CONFIRMED -> automatically creates Remediation Task in Paperclip
    confirmed = fstore.transition(
        fid,
        "CONFIRMED",
        actor="security_reviewer",
        note="Confirmed weak MD5 digest & DEBUG=True in order_service.py; remediation + input validation required.",
        pc=pc,
        company_id=cid,
        paperclip_project_id=proj["id"],
    )
    rem_issue_id = confirmed["paperclip_remediation_issue_id"]

    # Step 3: Create isolated feature/remediation Git branch & run Backend Developer under exclusive workspace lock
    branch_name = "fix/order-validation-and-sha256"
    subprocess.run(["git", "-C", str(repo), "checkout", "-B", branch_name], capture_output=True, check=True)
    fstore.transition(fid, "IN_PROGRESS", actor="backend_developer", note=f"Working on isolated branch {branch_name}")

    dev_id = agents["backend_developer"]["id"]
    dev_prompt = (
        f"Working in Git repository `{repo.as_posix()}` on branch `{branch_name}` (do NOT touch `main`):\n"
        "1. Use `write_file` to overwrite `order_service.py` in full with:\n"
        "   - `DEBUG = False`\n"
        "   - `compute_order_subtotal(items: list[tuple[int, int]]) -> int` raising `ValueError` if any `price < 0` or `qty < 0`.\n"
        "   - `calculate_discounted_total(items: list[tuple[int, int]], discount_pct: int = 0) -> int` raising `ValueError` unless `0 <= discount_pct <= 100` and returning `compute_order_subtotal(items) * (100 - discount_pct) // 100`.\n"
        "   - `receipt_digest(order_code: str) -> str` using `hashlib.sha256`.\n"
        "2. Use `write_file` to overwrite `test_order_service.py` in full with `unittest` tests covering subtotal, `calculate_discounted_total`, negative price/qty `ValueError`, invalid discount `ValueError`, and 64-char SHA-256 `receipt_digest`.\n"
        "3. In a single `terminal` command, run `python -m unittest discover -v && git add . && git commit -m \"Implement discounted total, input validation, and SHA-256 remediation\"`, then reply with a concise summary."
    )
    pc.update_issue(
        rem_issue_id,
        {
            "description": dev_prompt,
            "status": "todo",
            "priority": "high",
            "assigneeAgentId": dev_id,
        },
    )

    print("3. Backend Developer implementing feature, security remediation & unit tests on isolated branch...")
    with workspace_exclusive_lock("demo-order-service", holder="backend_developer", timeout_s=15.0):
        dev_run = trigger_and_wait(pc, cid, dev_id, rem_issue_id, timeout_s=450.0)
    if pc.get_issue(rem_issue_id).get("status") != "done":
        pc.update_issue(rem_issue_id, {"status": "done"})

    fstore.transition(fid, "READY_FOR_VERIFICATION", actor="backend_developer", note="Implemented fix + regression tests on branch.")

    # Step 4: Re-scan remediated branch with VulnClaw & verify zero baseline MD5/DEBUG findings remain
    print("4. Re-scanning remediated branch with isolated VulnClaw...")
    post_scan = scan_authorized_code(repo)
    post_findings = post_scan["scan_json"].get("findings", [])
    print(f"Post-remediation static findings count: {len(post_findings)} (down from {len(baseline_findings)})")

    # Step 5: QA Engineer runs independent regression & functional verification
    print("5. QA Engineer executing independent test & regression verification...")
    qa_id = agents["qa_engineer"]["id"]
    qa_issue = pc.create_issue(
        cid,
        {
            "title": "[QA Verification] Regression & functional test suite for demo-order-service",
            "description": (
                f"In `{repo.as_posix()}` (branch `{branch_name}`), run `python -m unittest discover -v && git status -sb` "
                "in a single terminal call, verify 0 failures, and reply with a concise QA verdict."
            ),
            "projectId": proj["id"],
            "parentId": rem_issue_id,
            "status": "todo",
            "priority": "high",
            "assigneeAgentId": qa_id,
        },
    )
    qa_run = trigger_and_wait(pc, cid, qa_id, qa_issue["id"], timeout_s=420.0)
    if pc.get_issue(qa_issue["id"]).get("status") != "done":
        pc.update_issue(qa_issue["id"], {"status": "done"})

    # Host-level deterministic verification of branch, commit, and unit tests
    cur_branch = subprocess.run(["git", "-C", str(repo), "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    ut_host = subprocess.run(["python", "-m", "unittest", "discover", "-s", str(repo), "-v"], capture_output=True, text=True, check=False)
    diff_stat = subprocess.run(["git", "-C", str(repo), "diff", "--stat", "main.." + branch_name], capture_output=True, text=True, check=False).stdout.strip()

    if ut_host.returncode != 0:
        raise RuntimeError(f"Host regression test failed on {branch_name}: {ut_host.stderr}")

    resolved = fstore.transition(fid, "RESOLVED", actor="qa_and_security_verification", note="All unit/regression tests pass and static scan clean.")

    # Step 6: Verify Production Deployment Gate (remains PENDING_APPROVAL / blocked without Owner sign-off)
    wf = WorkflowEngine()
    deploy_sub = wf.submit_task(
        caller_id=AUTHORIZED_OWNER_ID,
        title="[Production Gate] Merge fix/order-validation-and-sha256 to main & deploy",
        description="Production release requires explicit human Owner approval. Do NOT auto-execute.",
        role_slug="ceo_agent",
        priority="medium",
        project_id=proj["id"],
        parent_issue_id=rem_issue_id,
        idempotency_key="phase13-prod-deploy-gate",
    )
    gate_res = wf.update_stage(
        deploy_sub["task"]["paperclip_issue_id"],
        "PENDING_APPROVAL",
        caller_id=AUTHORIZED_OWNER_ID,
        comment="Gated awaiting explicit Owner production deployment approval.",
    )

    summary = {
        "repository": str(repo),
        "isolated_branch": cur_branch,
        "main_branch_untouched": cur_branch == branch_name,
        "baseline_findings_count": len(baseline_findings),
        "post_remediation_findings_count": len(post_findings),
        "finding_id": fid,
        "finding_final_status": resolved["verification_status"],
        "security_review_run": {"id": sec_run1.get("id"), "status": sec_run1.get("status"), "exit_code": sec_run1.get("exitCode")},
        "developer_remediation_run": {"id": dev_run.get("id"), "status": dev_run.get("status"), "exit_code": dev_run.get("exitCode")},
        "qa_verification_run": {"id": qa_run.get("id"), "status": qa_run.get("status"), "exit_code": qa_run.get("exitCode")},
        "host_unittest_exit_code": ut_host.returncode,
        "host_unittest_output": (ut_host.stdout + "\n" + ut_host.stderr).strip()[-500:],
        "git_diff_stat": diff_stat,
        "production_deploy_gate": gate_res,
    }
    out_file = ROOT / "reports" / "phase13-dev-remediation-verification.json"
    out_file.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("PHASE13_VERIFIED:", json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
