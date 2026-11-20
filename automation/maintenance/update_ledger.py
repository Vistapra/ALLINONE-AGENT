#!/usr/bin/env python3
"""Maintain IMPLEMENTATION-LEDGER.json and IMPLEMENTATION-LEDGER.md across PHASE-00..PHASE-38."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
import os
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")


ROOT = Path(ALLINONE_HOME)
JSON_PATH = ROOT / "IMPLEMENTATION-LEDGER.json"
MD_PATH = ROOT / "IMPLEMENTATION-LEDGER.md"

NEW_PHASES = [
    ("PHASE-20", "Existing Platform Preservation & Baseline Audit", (ALLINONE_HOME + r"\docs\PHASE-20-platform-preservation-audit.md")),
    ("PHASE-21", "Hermes3D Deep Repository & Compatibility Research", (ALLINONE_HOME + r"\docs\PHASE-21-hermes3d-repository-analysis.md")),
    ("PHASE-22", "Isolated Hermes3D Installation & Development Environment", (ALLINONE_HOME + r"\docs\PHASE-22-hermes3d-installation.md")),
    ("PHASE-23", "Paperclip Custom Runtime Provider", (ALLINONE_HOME + r"\docs\PHASE-23-paperclip-runtime-provider.md")),
    ("PHASE-24", "Unified Real-Time Event Bridge", (ALLINONE_HOME + r"\docs\PHASE-24-realtime-event-bridge.md")),
    ("PHASE-25", "VulnClaw Defensive Security Center", (ALLINONE_HOME + r"\docs\PHASE-25-vulnclaw-security-center.md")),
    ("PHASE-26", "Advanced 3D Office Design & Employee Mapping", (ALLINONE_HOME + r"\docs\PHASE-26-office-design.md")),
    ("PHASE-27", "Real-Time Agent Behavior Engine", (ALLINONE_HOME + r"\docs\PHASE-27-agent-behavior-engine.md")),
    ("PHASE-28", "Interactive Agent Command Center", (ALLINONE_HOME + r"\docs\PHASE-28-agent-command-center.md")),
    ("PHASE-29", "Multi-Agent Collaboration & Meeting System", (ALLINONE_HOME + r"\docs\PHASE-29-agent-collaboration.md")),
    ("PHASE-30", "Approval, Governance & Budget Control", (ALLINONE_HOME + r"\docs\PHASE-30-governance-budget.md")),
    ("PHASE-31", "Telegram & 3D Office Bidirectional Synchronization", (ALLINONE_HOME + r"\docs\PHASE-31-telegram-office-sync.md")),
    ("PHASE-32", "Unified Company Dashboard & Observability", (ALLINONE_HOME + r"\docs\PHASE-32-company-dashboard.md")),
    ("PHASE-33", "Startup, Recovery & Coordinated Maintenance", (ALLINONE_HOME + r"\docs\PHASE-33-startup-maintenance.md")),
    ("PHASE-34", "3D Performance & Resource Optimization", (ALLINONE_HOME + r"\docs\PHASE-34-performance-optimization.md")),
    ("PHASE-35", "Comprehensive Security Hardening", (ALLINONE_HOME + r"\docs\PHASE-35-security-hardening.md")),
    ("PHASE-36", "Comprehensive Multi-Round End-to-End Testing", (ALLINONE_HOME + r"\docs\PHASE-36-comprehensive-e2e-testing.md")),
    ("PHASE-37", "Final Production Acceptance Demonstration", (ALLINONE_HOME + r"\docs\PHASE-37-production-acceptance.md")),
    ("PHASE-38", "Documentation, Handover & Final Verification", (ALLINONE_HOME + r"\FINAL-REPORT.md")),
]


def main(updates: dict[str, str], overall_status: str | None = None, limitations: list[str] | None = None) -> None:
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    by_id = {p["id"]: p for p in data.get("phases", [])}
    for pid, name, report in NEW_PHASES:
        if pid not in by_id:
            entry = {"id": pid, "name": name, "status": "PENDING", "report": report}
            data["phases"].append(entry)
            by_id[pid] = entry
    for pid, status in updates.items():
        if pid in by_id:
            by_id[pid]["status"] = status
    now = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")
    data["platform_name"] = "UNIFIED AUTONOMOUS AI COMPANY — FULLY INTERACTIVE 3D VIRTUAL OFFICE"
    data["updated_at"] = now
    if overall_status is not None:
        data["overall_completion_status"] = overall_status
    if limitations is not None:
        data["documented_limitations"] = limitations

    JSON_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# UNIFIED AUTONOMOUS AI COMPANY — IMPLEMENTATION LEDGER",
        "",
        f"- **Host:** `{data.get('host', '<machine-name>')}`",
        f"- **Root Directory:** `{data.get('root_dir', ALLINONE_HOME)}`",
        f"- **Last Updated:** `{now}`",
        f"- **Overall Status:** `{data.get('overall_completion_status', '')}`",
        "",
        "| Phase | Name | Status | Report |",
        "|---|---|---|---|",
    ]
    for p in data["phases"]:
        lines.append(f"| `{p['id']}` | {p['name']} | `{p['status']}` | `{p['report']}` |")
    if data.get("documented_limitations"):
        lines.append("")
        lines.append("## Documented Limitations")
        for item in data["documented_limitations"]:
            lines.append(f"- {item}")
    MD_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    kv = {}
    for arg in sys.argv[1:]:
        if "=" in arg:
            k, v = arg.split("=", 1)
            kv[k.strip()] = v.strip()
    main(kv)
