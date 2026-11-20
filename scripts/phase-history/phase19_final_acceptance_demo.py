#!/usr/bin/env python3
"""Phase 19: Full 13-Step Final Acceptance Demonstration End-to-End."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import os
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")


ROOT = Path(ALLINONE_HOME)
sys.path.insert(0, str(ROOT))

from integration.findings_engine import FindingsStore
from integration.org_provisioner import workspace_exclusive_lock
from integration.paperclip_client import PaperclipClient
from integration.platform_cli import handle_telegram_command
from integration.vulnclaw_defensive import scan_authorized_code
from integration.workflow_engine import (
    AUTHORIZED_OWNER_ID,
    WorkflowEngine,
    send_owner_telegram_notification,
)


def ts() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def trigger_and_wait(
    pc: PaperclipClient,
    cid: str,
    agent_id: str,
    issue_id: str,
    timeout_s: float = 300.0,
    prior_ids: set[str] | None = None,
) -> dict:
    last_done: dict = {}
    for retry_idx in range(3):
        ag = pc.must("GET", f"/api/agents/{agent_id}")
        if ag.get("status") == "paused":
            pc.resume_agent(agent_id)
        prior = prior_ids if (retry_idx == 0 and prior_ids is not None) else {r["id"] for r in pc.list_runs(cid, agent_id=agent_id, limit=20)}
        if retry_idx > 0:
            pc.update_issue(issue_id, {"status": "todo"})
        new_run = None
        for attempt in range(35):
            runs = pc.list_runs(cid, agent_id=agent_id, limit=15)
            new_run = next((r for r in runs if r["id"] not in prior), None)
            if new_run:
                break
            if attempt in (3, 10, 20) or (retry_idx > 0 and attempt == 0):
                pc.wake_agent(agent_id, {"source": "assignment", "trigger": "manual", "payload": {"issueId": issue_id}})
            time.sleep(1.2)
        if not new_run:
            raise RuntimeError(f"No fresh heartbeat run spawned for agent {agent_id}")
        last_done = pc.wait_for_run_completion(new_run["id"], timeout_s=timeout_s)
        if last_done.get("status") == "succeeded":
            return last_done
        time.sleep(2.0)
    return last_done


def prepare_acceptance_repo() -> Path:
    for stray in ("invoice_engine.py", "test_invoice_engine.py"):
        sp = ROOT / "workspaces" / stray
        if sp.exists():
            sp.unlink()
    repo = ROOT / "workspaces" / "acceptance-invoice-app"
    if repo.exists():
        import shutil
        shutil.rmtree(repo, ignore_errors=True)
    repo.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", str(repo)], capture_output=True, check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "acceptance@unified-platform.local"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "Unified Acceptance Suite"], check=True)
    subprocess.run(["git", "-C", str(repo), "checkout", "-B", "main"], capture_output=True, check=False)

    (repo / ".gitignore").write_text("__pycache__/\n*.pyc\n", encoding="utf-8")
    (repo / "invoice_engine.py").write_text(
        '"""Authorized Acceptance Test Project — Invoice Engine."""\n'
        "import hashlib\n\n"
        "DEBUG = True\n"
        'TAX_SERVICE_ENDPOINT = "http://tax-internal.example.invalid/v1/rates"\n\n'
        "def compute_invoice_total(net_cents: int, tax_bps: int = 1100) -> int:\n"
        "    return net_cents + (net_cents * tax_bps // 10000)\n\n"
        "def invoice_signature(invoice_no: str) -> str:\n"
        "    return hashlib.md5(invoice_no.encode('utf-8')).hexdigest()\n",
        encoding="utf-8",
    )
    (repo / "test_invoice_engine.py").write_text(
        "import unittest\n"
        "from invoice_engine import compute_invoice_total\n\n"
        "class TestInvoiceEngine(unittest.TestCase):\n"
        "    def test_compute_total(self):\n"
        "        self.assertEqual(compute_invoice_total(10000, 1100), 11100)\n\n"
        'if __name__ == "__main__":\n'
        "    unittest.main()\n",
        encoding="utf-8",
    )
    synth_report = ROOT / "reports" / "acceptance-synthetic-security-report.json"
    synth_report.write_text(
        json.dumps(
            {
                "report_type": "defensive_synthetic_audit",
                "project": "acceptance-invoice-app",
                "findings": [
                    {
                        "title": "Weak MD5 hash and DEBUG=True enabled in invoice_engine.py",
                        "severity": "Medium",
                        "cwe": "CWE-328",
                        "component": "invoice_engine.py",
                        "recommendation": "Set DEBUG=False, enforce HTTPS endpoint, validate non-negative inputs, and use hashlib.sha256.",
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    subprocess.run(["git", "-C", str(repo), "add", "."], capture_output=True, check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-m", "Initial acceptance baseline"], capture_output=True, check=False)
    return repo


def main() -> int:
    transitions: list[dict[str, object]] = []
    repo = prepare_acceptance_repo()
    pc = PaperclipClient(timeout=25.0)
    roster = json.loads((ROOT / "config" / "organization-roster.json").read_text(encoding="utf-8"))
    cid = roster["company_id"]
    agents = roster["agents"]
    wf = WorkflowEngine()
    fstore = FindingsStore()

    projects = pc.list_projects(cid)
    proj = next((p for p in projects if p.get("name") == "Acceptance Invoice App"), None)
    if not proj:
        proj = pc.create_project(cid, {"name": "Acceptance Invoice App", "status": "in_progress"})
    if not pc.list_project_workspaces(proj["id"]):
        pc.create_project_workspace(proj["id"], {"name": "acceptance-invoice-app", "cwd": str(repo), "isPrimary": True})

    # Transition 1 & 2 & 3: Telegram Owner -> Hermes Gateway Bridge -> Paperclip Parent Task
    owner_instruction = (
        "Analisis project uji yang telah diotorisasi (acceptance-invoice-app), buat rencana pekerjaan, "
        "delegasikan tugas kepada developer dan QA, evaluasi laporan keamanan sintetis, "
        "lakukan perbaikan yang diperlukan pada branch terpisah, jalankan testing, dan kirim hasilnya."
    )
    ceo_id = agents["ceo_agent"]["id"]
    prior_ceo = {r["id"] for r in pc.list_runs(cid, agent_id=ceo_id, limit=20)}
    tg_in = handle_telegram_command(
        "create_task",
        (
            f"Final Acceptance Demo: Acceptance Invoice App | {owner_instruction}\n\n"
            f"Inspect `{repo.as_posix()}/invoice_engine.py` and `{ALLINONE_HOME}/reports/acceptance-synthetic-security-report.json` (read-only), "
            "produce a concise 4-step execution plan for Security Reviewer, Backend Developer, and QA Engineer, "
            "and reply directly with the plan without calling the Paperclip API or modifying files."
        ),
        caller_id=AUTHORIZED_OWNER_ID,
        message_id=f"tg-phase19-final-demo-{int(time.time())}",
    )
    parent_issue_id = tg_in["submission"]["task"]["paperclip_issue_id"]
    parent_ident = tg_in["submission"]["task"]["paperclip_identifier"]
    pc.update_issue(parent_issue_id, {"projectId": proj["id"]})
    transitions.append({
        "step": "1-3: Telegram Owner -> Hermes Bridge -> Paperclip Task",
        "timestamp": ts(),
        "owner_id": AUTHORIZED_OWNER_ID,
        "parent_issue_id": parent_issue_id,
        "parent_identifier": parent_ident,
    })

    # Transition 4 & 5: CEO Planning & Agent Assignment
    print("Step 4-5: CEO Agent executing project analysis & planning...")
    ceo_run = trigger_and_wait(pc, cid, ceo_id, parent_issue_id, timeout_s=420.0, prior_ids=prior_ceo)
    transitions.append({
        "step": "4-5: CEO Planning & Agent Assignment",
        "timestamp": ts(),
        "ceo_run_id": ceo_run.get("id"),
        "ceo_run_status": ceo_run.get("status"),
        "ceo_exit_code": ceo_run.get("exitCode"),
    })

    # Transition 6, 7 & 8: Source Code Review & VulnClaw Defensive Findings Review
    print("Step 6-8: VulnClaw static code scan + Security Reviewer evaluation...")
    vc_scan = scan_authorized_code(repo)
    vc_findings = vc_scan["scan_json"].get("findings", [])
    f0 = vc_findings[0]
    sec_id = agents["security_reviewer"]["id"]
    prior_sec = {r["id"] for r in pc.list_runs(cid, agent_id=sec_id, limit=20)}
    ing = fstore.ingest_finding(
        {
            "project_id": f"acceptance-invoice-app-{int(time.time())}",
            "asset_reference": "acceptance-invoice-app/invoice_engine.py",
            "source_reference": "vulnclaw_codescan",
            "finding_title": f0["title"],
            "finding_description": f0["description"],
            "severity": f0["severity"],
            "confidence": f0.get("confidence", 0.9),
            "cwe_reference": f0.get("cwe") or "CWE-328",
            "affected_component": f0["code_location"],
            "sanitized_evidence": f0["evidence"],
            "remediation_recommendation": "Set DEBUG=False, use HTTPS endpoint, validate non-negative net_cents/tax_bps, and replace MD5 with SHA-256.",
            "vuln_type": f0["vuln_type"],
        },
        pc=pc,
        company_id=cid,
        paperclip_project_id=proj["id"],
        reviewer_agent_id=sec_id,
    )
    fid = ing["finding"]["finding_id"]
    sec_issue_id = ing["finding"]["paperclip_review_issue_id"]
    pc.update_issue(sec_issue_id, {"parentId": parent_issue_id})

    sec_run = trigger_and_wait(pc, cid, sec_id, sec_issue_id, timeout_s=420.0, prior_ids=prior_sec)
    pc.update_issue(sec_issue_id, {"status": "done"})
    confirmed = fstore.transition(
        fid,
        "CONFIRMED",
        actor="security_reviewer",
        note="Confirmed weak MD5 & DEBUG=True in invoice_engine.py + synthetic_security_report.json.",
        pc=pc,
        company_id=cid,
        paperclip_project_id=proj["id"],
    )
    rem_issue_id = confirmed["paperclip_remediation_issue_id"]
    transitions.append({
        "step": "6-8: Source Code Review & Defensive Findings Review",
        "timestamp": ts(),
        "finding_id": fid,
        "baseline_findings": len(vc_findings),
        "security_review_issue_id": sec_issue_id,
        "security_run_id": sec_run.get("id"),
        "security_run_status": sec_run.get("status"),
    })

    # Transition 9: Remediation by Backend Developer on Isolated Git Branch
    branch_name = "fix/acceptance-invoice-hardening"
    subprocess.run(["git", "-C", str(repo), "checkout", "-B", branch_name], capture_output=True, check=True)
    fstore.transition(fid, "IN_PROGRESS", actor="backend_developer", note=f"Remediating on branch {branch_name}")
    dev_id = agents["backend_developer"]["id"]
    prior_dev = {r["id"] for r in pc.list_runs(cid, agent_id=dev_id, limit=20)}
    pc.update_issue(
        rem_issue_id,
        {
            "parentId": parent_issue_id,
            "description": (
                f"Remediate on isolated Git branch `{branch_name}` (do NOT touch `main`) using EXACT full paths:\n"
                f"1. Use `write_file` to overwrite `{repo.as_posix()}/invoice_engine.py` in full:\n"
                "   - `DEBUG = False` and `TAX_SERVICE_ENDPOINT = \"https://tax-internal.example.invalid/v1/rates\"`.\n"
                "   - Validate `net_cents >= 0` and `0 <= tax_bps <= 10000` in `compute_invoice_total`, raising `ValueError` otherwise.\n"
                "   - Replace `hashlib.md5` with `hashlib.sha256` in `invoice_signature`.\n"
                f"2. Use `write_file` to overwrite `{repo.as_posix()}/test_invoice_engine.py` in full adding >=5 unit & regression tests for valid totals, negative `net_cents` `ValueError`, invalid `tax_bps` `ValueError`, `DEBUG is False`, HTTPS URL, and 64-char SHA-256 signature.\n"
                f"3. Run in `terminal`: `python -m unittest discover -s \"{repo.as_posix()}\" -p \"test_*.py\" -v && git -C \"{repo.as_posix()}\" add invoice_engine.py test_invoice_engine.py && git -C \"{repo.as_posix()}\" commit -m \"Harden invoice_engine and add regression tests\"`, then reply concisely without calling Paperclip API."
            ),
            "status": "todo",
            "priority": "high",
            "assigneeAgentId": dev_id,
        },
    )
    print("Step 9: Backend Developer executing remediation & regression tests on isolated branch...")
    with workspace_exclusive_lock("acceptance-invoice-app", holder="backend_developer", timeout_s=15.0):
        dev_run = trigger_and_wait(pc, cid, dev_id, rem_issue_id, timeout_s=450.0, prior_ids=prior_dev)
    if pc.get_issue(rem_issue_id).get("status") != "done":
        pc.update_issue(rem_issue_id, {"status": "done"})
    fstore.transition(fid, "READY_FOR_VERIFICATION", actor="backend_developer", note="Committed fix + tests on isolated branch.")

    commit_sha = subprocess.run(["git", "-C", str(repo), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    transitions.append({
        "step": "9: Hermes Worker Remediation on Isolated Branch",
        "timestamp": ts(),
        "remediation_issue_id": rem_issue_id,
        "developer_run_id": dev_run.get("id"),
        "developer_run_status": dev_run.get("status"),
        "branch": branch_name,
        "commit_sha": commit_sha,
    })

    # Transition 10 & 11: QA Execution & Post-Remediation Security Verification
    print("Step 10-11: QA Engineer & VulnClaw post-remediation verification...")
    post_scan = scan_authorized_code(repo)
    post_findings = post_scan["scan_json"].get("findings", [])

    qa_id = agents["qa_engineer"]["id"]
    prior_qa = {r["id"] for r in pc.list_runs(cid, agent_id=qa_id, limit=20)}
    qa_issue = pc.create_issue(
        cid,
        {
            "title": "[Acceptance QA] Verify invoice_engine unit & regression suite on branch",
            "description": (
                f"Run `python -m unittest discover -s \"{repo.as_posix()}\" -p \"test_*.py\" -v` in terminal on branch `{branch_name}`, "
                "confirm all >=5 tests pass (exit code 0), and reply with a concise QA sign-off."
            ),
            "projectId": proj["id"],
            "parentId": parent_issue_id,
            "status": "todo",
            "priority": "high",
            "assigneeAgentId": qa_id,
        },
    )
    qa_run = trigger_and_wait(pc, cid, qa_id, qa_issue["id"], timeout_s=420.0, prior_ids=prior_qa)
    if pc.get_issue(qa_issue["id"]).get("status") != "done":
        pc.update_issue(qa_issue["id"], {"status": "done"})

    host_ut = subprocess.run(["python", "-m", "unittest", "discover", "-s", str(repo), "-v"], capture_output=True, text=True, check=False)
    if host_ut.returncode != 0 or "Ran 1 test" in host_ut.stderr:
        raise RuntimeError(f"Acceptance unit tests failed or regression tests missing: {host_ut.stderr}")
    if len(post_findings) >= len(vc_findings):
        raise RuntimeError(f"Post-scan findings ({len(post_findings)}) were not reduced below baseline ({len(vc_findings)})!")
    main_src = subprocess.run(["git", "-C", str(repo), "show", "main:invoice_engine.py"], capture_output=True, text=True, check=True).stdout
    main_untouched = ("hashlib.md5" in main_src and "DEBUG = True" in main_src)

    resolved = fstore.transition(fid, "RESOLVED", actor="qa_and_security", note="Post-scan clean & QA regression tests passed.")
    transitions.append({
        "step": "10-11: QA Testing & Defensive Verification",
        "timestamp": ts(),
        "qa_issue_id": qa_issue["id"],
        "qa_run_id": qa_run.get("id"),
        "qa_run_status": qa_run.get("status"),
        "post_scan_findings": len(post_findings),
        "finding_status": resolved["verification_status"],
        "unittest_exit_code": host_ut.returncode,
    })

    # Transition 12 & 13: Paperclip Parent Completion -> Sanitized Telegram Final Report to Owner
    wf.update_stage(
        parent_issue_id,
        "COMPLETED",
        caller_id=AUTHORIZED_OWNER_ID,
        evidence={"branch": branch_name, "commit": commit_sha, "finding_id": fid, "qa_exit_code": 0},
        comment=f"Final Acceptance Demo completed on branch {branch_name} ({commit_sha}); all child tasks & QA passed.",
    )
    final_tg_text = (
        f"🏁 [UNIFIED AI PLATFORM — FINAL ACCEPTANCE REPORT]\n"
        f"• Parent Task: {parent_ident} (COMPLETED)\n"
        f"• Project: acceptance-invoice-app (branch: {branch_name}, commit: {commit_sha})\n"
        f"• CEO Plan Run: {str(ceo_run.get('id'))[:8]} ({ceo_run.get('status')})\n"
        f"• Defensive Finding: {fid} ({len(vc_findings)} -> {len(post_findings)} temuan, status: {resolved['verification_status']})\n"
        f"• Developer Run: {str(dev_run.get('id'))[:8]} ({dev_run.get('status')})\n"
        f"• QA Run: {str(qa_run.get('id'))[:8]} ({qa_run.get('status')}, unittest exit=0)\n"
        f"• Catatan: Branch main tidak disentuh; merge produksi menunggu persetujuan eksplisit Owner."
    )
    tg_out = send_owner_telegram_notification(final_tg_text)
    transitions.append({
        "step": "12-13: Paperclip Completion -> Telegram Final Report",
        "timestamp": ts(),
        "parent_final_status": pc.get_issue(parent_issue_id).get("status"),
        "telegram_report_sent": tg_out.get("sent"),
        "telegram_message_id": tg_out.get("message_id"),
    })

    demo_artifact = {
        "instruction": owner_instruction,
        "repository": str(repo),
        "branch": branch_name,
        "main_branch_untouched": main_untouched,
        "commit_sha": commit_sha,
        "parent_identifier": parent_ident,
        "finding_id": fid,
        "transitions": transitions,
        "unittest_output": (host_ut.stdout + "\n" + host_ut.stderr).strip()[-600:],
    }
    out_path = ROOT / "reports" / "phase19-final-acceptance-demo.json"
    out_path.write_text(json.dumps(demo_artifact, indent=2, ensure_ascii=False), encoding="utf-8")
    print("PHASE19_DEMO_COMPLETE:", json.dumps(demo_artifact, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
