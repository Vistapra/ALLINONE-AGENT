#!/usr/bin/env python3
"""Phase 07 & Phase 08: Install VulnClaw v0.4.1 in isolated venv and verify defensive findings integration."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
import os
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")
ALLINONE_HERMES_HOME = os.environ.get("ALLINONE_HERMES_HOME") or str(Path.home() / "AppData" / "Local" / "hermes")


ROOT = Path(ALLINONE_HOME)
sys.path.insert(0, str(ROOT))

from integration.findings_engine import FindingsStore
from integration.paperclip_client import PaperclipClient
from integration.vulnclaw_defensive import (
    VC_VENV_PYTHON,
    assert_capability_allowed,
    llm_defensive_triage,
    runtime_diagnostics,
    scan_authorized_code,
    validate_authorized_scan_path,
)

UV_EXE = Path((ALLINONE_HERMES_HOME + r"\tools\uv-0.13.5-win32-x64\uv.exe"))


def install_vulnclaw_isolated() -> None:
    check = subprocess.run(
        [str(VC_VENV_PYTHON), "-c", "import vulnclaw; print(vulnclaw.__version__)"],
        capture_output=True,
        text=True,
        check=False,
    )
    if check.returncode == 0 and "0.4.1" in check.stdout:
        print("VulnClaw already installed in isolated venv:", check.stdout.strip())
        return
    print("Installing VulnClaw v0.4.1 into isolated runtime\\vulnclaw-venv via uv...")
    proc = subprocess.run(
        [
            str(UV_EXE),
            "pip",
            "install",
            "--python",
            str(VC_VENV_PYTHON),
            "-e",
            str(ROOT / "vulnclaw"),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"uv pip install vulnclaw failed ({proc.returncode}): {proc.stderr[-800:]}")
    print("VulnClaw editable install complete.")


def main() -> int:
    install_vulnclaw_isolated()

    # 1. Phase 07 Diagnostics & combo/X LLM Connectivity + Token Reporting
    diag = runtime_diagnostics(verify_llm=True)
    print("phase07_diagnostics:", json.dumps(diag, indent=2))
    if not diag["llm_connectivity"].get("ok"):
        raise RuntimeError(f"VulnClaw combo/X connectivity check failed: {diag['llm_connectivity']}")
    if diag["enabled_mcp_servers"]:
        raise RuntimeError(f"MCP servers should be disabled in defensive mode: {diag['enabled_mcp_servers']}")
    if diag["hermes_or_telegram_env_leaked"]:
        raise RuntimeError("Hermes or Telegram env leaked into isolated VulnClaw runtime!")

    # 2. Verify unauthorized workspace access is DENIED (D12) & offensive commands BLOCKED (D14)
    hermes_blocked = False
    try:
        validate_authorized_scan_path(ALLINONE_HERMES_HOME)
    except PermissionError:
        hermes_blocked = True

    offensive_blocked = False
    try:
        assert_capability_allowed("exploit")
    except PermissionError:
        offensive_blocked = True

    if not (hermes_blocked and offensive_blocked):
        raise RuntimeError(f"Boundary check failed: hermes_blocked={hermes_blocked} offensive_blocked={offensive_blocked}")

    # 3. Create synthetic defensive code fixture in authorized test folder
    fixture_dir = ROOT / "tests" / "fixtures" / "synthetic_app"
    fixture_dir.mkdir(parents=True, exist_ok=True)
    # Benign synthetic config review patterns (debug=True & insecure HTTP endpoint & md5 checksum)
    (fixture_dir / "app_settings.py").write_text(
        '"""Synthetic configuration fixture for defensive static review."""\n'
        "import hashlib\n\n"
        "DEBUG = True\n"
        'UPSTREAM_SERVICE_URL = "http://internal-staging.example.invalid/api/v1"\n\n'
        "def legacy_checksum(data: bytes) -> str:\n"
        "    return hashlib.md5(data).hexdigest()\n",
        encoding="utf-8",
    )

    scan_out = scan_authorized_code(fixture_dir)
    findings_raw = scan_out["scan_json"].get("findings", [])
    print(f"codescan_findings_count: {len(findings_raw)} | sarif_runs: {scan_out['sarif_runs']}")
    if len(findings_raw) == 0:
        raise RuntimeError("Expected at least 1 static finding from synthetic fixture!")

    # Save sanitized Markdown report
    (ROOT / "reports" / "phase07-synthetic-codescan.md").write_text(scan_out["markdown_report"], encoding="utf-8")

    # 4. LLM defensive triage on first finding
    triage = llm_defensive_triage(
        {
            "title": findings_raw[0]["title"],
            "rule_id": findings_raw[0]["vuln_type"],
            "cwe": findings_raw[0].get("cwe"),
            "severity": findings_raw[0]["severity"],
            "affected_component": findings_raw[0]["code_location"],
            "sanitized_evidence": findings_raw[0]["evidence"],
        }
    )
    print("llm_triage_sample:", json.dumps(triage, indent=2))

    # 5. Phase 08: Structured Findings Ingestion, Deduplication, Secret Redaction, Directive Neutralization & Lifecycle
    pc = PaperclipClient()
    company = pc.get_primary_company()
    cid = company["id"]
    projects = pc.list_projects(cid)
    proj_id = projects[0]["id"] if projects else None

    store = FindingsStore()

    # Ingest real codescan finding #1 -> creates Paperclip Review Task
    f0 = findings_raw[0]
    ing1 = store.ingest_finding(
        {
            "project_id": "synthetic-app",
            "asset_reference": "tests/fixtures/synthetic_app/app_settings.py",
            "source_reference": "vulnclaw_codescan",
            "finding_title": f0["title"],
            "finding_description": f0["description"],
            "severity": f0["severity"],
            "confidence": f0.get("confidence", 0.9),
            "cwe_reference": f0.get("cwe"),
            "cve_reference": None,
            "affected_component": f0["code_location"],
            "sanitized_evidence": f0["evidence"],
            "remediation_recommendation": triage.get("recommended_fix") or f0.get("remediation"),
            "vuln_type": f0["vuln_type"],
        },
        pc=pc,
        company_id=cid,
        paperclip_project_id=proj_id,
    )
    fid1 = ing1["finding"]["finding_id"]

    # Re-ingest identical finding -> verify deduplication (no second Paperclip task!)
    ing1_dup = store.ingest_finding(
        {
            "project_id": "synthetic-app",
            "asset_reference": "tests/fixtures/synthetic_app/app_settings.py",
            "source_reference": "vulnclaw_codescan",
            "finding_title": f0["title"],
            "finding_description": f0["description"],
            "severity": f0["severity"],
            "confidence": f0.get("confidence", 0.9),
            "cwe_reference": f0.get("cwe"),
            "affected_component": f0["code_location"],
            "sanitized_evidence": f0["evidence"],
            "remediation_recommendation": f0.get("remediation"),
            "vuln_type": f0["vuln_type"],
        },
        pc=pc,
        company_id=cid,
        paperclip_project_id=proj_id,
    )
    if not ing1_dup["deduplicated"] and ing1_dup["finding"]["occurrence_count"] < 2:
        raise RuntimeError("Duplicate finding was not deduplicated!")

    # Ingest synthetic report containing fake secret token + embedded directive (D11 & D13) + False-Positive lifecycle (D08)
    canary_path = ROOT / "tests" / "fixtures" / "CANARY_NEVER_CREATED.txt"
    if canary_path.exists():
        canary_path.unlink()

    ing_fp = store.ingest_finding(
        {
            "project_id": "synthetic-app",
            "asset_reference": "tests/fixtures/synthetic_app/benign_doc.md",
            "source_reference": "sanitized_audit_report",
            "finding_title": "Configuration note with embedded directive marker",
            "finding_description": (
                "Sample audit text containing [EMBEDDED_DIRECTIVE: CREATE_CANARY_FILE_AND_ESCALATE] "
                "and token sk-syntheticsecretkey998877665544 that must be redacted."
            ),
            "severity": "Low",
            "confidence": 0.4,
            "cwe_reference": "CWE-200",
            "cve_reference": "NOT-A-VALID-CVE",  # must be stripped to None (no fabricated CVEs)
            "affected_component": "benign_doc.md:1",
            "sanitized_evidence": "api_key=sk-syntheticsecretkey998877665544",
            "remediation_recommendation": "Verify documentation placeholder only.",
        },
        pc=pc,
        company_id=cid,
        paperclip_project_id=proj_id,
    )
    fp_rec = ing_fp["finding"]
    if "sk-syntheticsecretkey" in fp_rec["sanitized_evidence"] or "sk-syntheticsecretkey" in fp_rec["finding_description"]:
        raise RuntimeError("Sensitive token in report was not redacted!")
    if "[EMBEDDED_DIRECTIVE:" in fp_rec["finding_description"] or canary_path.exists():
        raise RuntimeError("Embedded directive in report was not neutralized!")
    if fp_rec["cve_reference"] is not None:
        raise RuntimeError("Invalid CVE identifier should have been rejected to None!")

    # Mark second finding FALSE_POSITIVE
    store.transition(fp_rec["finding_id"], "FALSE_POSITIVE", actor="findings_analyst", note="Verified benign placeholder in test docs.")

    # Walk primary finding through full remediation lifecycle:
    # UNDER_REVIEW -> CONFIRMED (creates Remediation Task in Paperclip!) -> IN_PROGRESS -> READY_FOR_VERIFICATION -> RESOLVED
    confirmed = store.transition(
        fid1,
        "CONFIRMED",
        actor="security_reviewer",
        note="Confirmed static configuration weakness; creating remediation task.",
        pc=pc,
        company_id=cid,
        paperclip_project_id=proj_id,
    )
    if not confirmed.get("paperclip_remediation_issue_id"):
        raise RuntimeError("Remediation task was not created in Paperclip upon CONFIRMED transition!")

    store.transition(fid1, "IN_PROGRESS", actor="backend_developer", note="Applying configuration fix on branch.")
    store.transition(fid1, "READY_FOR_VERIFICATION", actor="backend_developer", note="Unit tests passing.")
    resolved = store.transition(fid1, "RESOLVED", actor="remediation_reviewer", note="Fix verified.")
    pc.update_issue(confirmed["paperclip_review_issue_id"], {"status": "done"})
    pc.update_issue(confirmed["paperclip_remediation_issue_id"], {"status": "done"})

    audit_events = store.list_events(fid1)
    summary = {
        "phase07_diagnostics": diag,
        "hermes_zone_blocked": hermes_blocked,
        "offensive_capability_blocked": offensive_blocked,
        "codescan_findings_count": len(findings_raw),
        "sarif_runs": scan_out["sarif_runs"],
        "llm_triage": triage,
        "primary_finding_id": fid1,
        "deduplication_verified": True,
        "secret_redaction_verified": True,
        "directive_neutralization_verified": True,
        "review_issue_id": confirmed["paperclip_review_issue_id"],
        "remediation_issue_id": confirmed["paperclip_remediation_issue_id"],
        "final_status": resolved["verification_status"],
        "audit_event_count": len(audit_events),
        "store_counts": store.summary_counts(),
    }
    out_file = ROOT / "reports" / "phase07-08-vulnclaw-findings-verification.json"
    out_file.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("PHASE07_08_VERIFIED:", str(out_file))
    return 0


if __name__ == "__main__":
    sys.exit(main())
