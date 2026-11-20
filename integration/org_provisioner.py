#!/usr/bin/env python3
"""Phase 09 & Phase 10: Provision Unified AI Engineering & Operations org chart, role-specific instructions, budgets, and workspace locks."""
from __future__ import annotations

import contextlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Iterator
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")
ALLINONE_HERMES_HOME = os.environ.get("ALLINONE_HERMES_HOME") or str(Path.home() / "AppData" / "Local" / "hermes")


ROOT = Path(ALLINONE_HOME)
sys.path.insert(0, str(ROOT))

from integration.hermes_worker_factory import HERMES_EXE, bind_agent_paperclip_key, provision_worker_home
from integration.paperclip_client import PaperclipClient

LOCKS_DIR = ROOT / "data" / "workspace-locks"

# Complete 11-agent organizational structure defined in Phase 09 & Phase 10.
# Only the 4 core roles (`active_initially: True`) start active (`idle`); the remaining 7
# are provisioned in `paused` state per Phase 09 staged activation strategy.
ORG_ROSTER: list[dict[str, Any]] = [
    {
        "slug": "ceo_agent",
        "name": "CEO Agent",
        "role": "ceo",
        "title": "Chief Executive Officer — Planning & Delegation",
        "reports_to_slug": None,
        "active_initially": True,
        "budget_monthly_cents": 2500,
        "timeout_sec": 240,
        "max_turns": 20,
        "toolsets": ["file", "terminal"],
        "workspace_scope": (ALLINONE_HOME + r"\workspaces"),
        "objective": "Translate Owner objectives into structured plans, prioritized subtasks, assignments, and executive completion summaries.",
        "responsibilities": [
            "Decompose complex goals into bounded subtasks (max depth 2, max 6 subtasks).",
            "Assign tasks to Developer, QA, or Security Reviewer according to role boundaries.",
            "Track task blockers, acceptance criteria, and synthesize final reports.",
        ],
        "prohibited": [
            "Direct modification of production databases or system OS settings.",
            "Approving high-risk destructive actions on behalf of the human Owner.",
            "Creating unbounded new agents (`canCreateAgents=false`).",
        ],
        "expected_output": "Structured Markdown plan, child task breakdown, delegation summary, and final acceptance report.",
    },
    {
        "slug": "cto_agent",
        "name": "CTO Agent",
        "role": "cto",
        "title": "Chief Technology Officer — Architecture & Standards",
        "reports_to_slug": "ceo_agent",
        "active_initially": False,
        "budget_monthly_cents": 1500,
        "timeout_sec": 240,
        "max_turns": 18,
        "toolsets": ["file", "terminal"],
        "workspace_scope": (ALLINONE_HOME + r"\workspaces"),
        "objective": "Define software architecture, technical contracts, dependency boundaries, and code review standards.",
        "responsibilities": [
            "Produce architecture notes and implementation specifications.",
            "Review cross-module dependencies and engineering quality.",
        ],
        "prohibited": ["Bypassing QA/Security gates or changing host OS settings."],
        "expected_output": "Architecture Decision Record (ADR) and engineering review verdict.",
    },
    {
        "slug": "backend_developer",
        "name": "Backend Developer",
        "role": "engineer",
        "title": "Senior Full-Stack / Backend Software Engineer",
        "reports_to_slug": "ceo_agent",
        "active_initially": True,
        "budget_monthly_cents": 3000,
        "timeout_sec": 420,
        "max_turns": 25,
        "toolsets": ["file", "terminal"],
        "workspace_scope": (ALLINONE_HOME + r"\workspaces"),
        "objective": "Implement backend/application features, bug fixes, security remediations, and unit tests on isolated Git branches.",
        "responsibilities": [
            "Inspect authorized repository code and root causes.",
            "Create or switch to an isolated feature/fix Git branch before modifying code.",
            "Write clean modular code and unit/regression tests and verify they pass locally.",
        ],
        "prohibited": [
            "Pushing to remote repositories or deploying to production without explicit Owner approval.",
            "Modifying files outside the assigned project workspace.",
        ],
        "expected_output": "Git branch diff summary, files changed, unit test command & exit code, and remediation notes.",
    },
    {
        "slug": "frontend_developer",
        "name": "Frontend Developer",
        "role": "designer",
        "title": "Senior Frontend & UI Engineer",
        "reports_to_slug": "cto_agent",
        "active_initially": False,
        "budget_monthly_cents": 1500,
        "timeout_sec": 240,
        "max_turns": 20,
        "toolsets": ["file", "terminal"],
        "workspace_scope": (ALLINONE_HOME + r"\workspaces"),
        "objective": "Build accessible, responsive UI components and frontend tests inside authorized project workspaces.",
        "responsibilities": ["Implement UI components, styling, and frontend unit tests."],
        "prohibited": ["Modifying backend credentials or host OS settings."],
        "expected_output": "UI implementation summary and frontend test results.",
    },
    {
        "slug": "devops_engineer",
        "name": "DevOps Engineer",
        "role": "devops",
        "title": "Senior DevOps & Runtime Diagnostics Engineer",
        "reports_to_slug": "cto_agent",
        "active_initially": False,
        "budget_monthly_cents": 1500,
        "timeout_sec": 240,
        "max_turns": 18,
        "toolsets": ["file", "terminal"],
        "workspace_scope": (ALLINONE_HOME + r"\workspaces"),
        "objective": "Verify build pipelines, runtime configuration files, and non-destructive service health diagnostics.",
        "responsibilities": ["Validate build recipes, configuration templates, and service readiness."],
        "prohibited": ["Altering Windows Firewall/UAC, stopping production services, or running elevated commands."],
        "expected_output": "Build & runtime readiness report with diagnostic exit codes.",
    },
    {
        "slug": "qa_engineer",
        "name": "QA Engineer",
        "role": "qa",
        "title": "Lead Quality Assurance & Regression Engineer",
        "reports_to_slug": "ceo_agent",
        "active_initially": True,
        "budget_monthly_cents": 2000,
        "timeout_sec": 240,
        "max_turns": 20,
        "toolsets": ["file", "terminal"],
        "workspace_scope": (ALLINONE_HOME + r"\workspaces"),
        "objective": "Execute functional, integration, and regression test suites and verify acceptance criteria.",
        "responsibilities": [
            "Run automated test suites independently in the target branch/workspace.",
            "Verify edge cases, regression coverage, and adherence to acceptance criteria.",
            "Report PASS/FAIL verdicts with concrete command outputs.",
        ],
        "prohibited": [
            "Marking untested code as PASS.",
            "Modifying production configuration outside test scope.",
        ],
        "expected_output": "QA Verification Report containing executed test commands, pass/fail counts, exit codes, and regression verdict.",
    },
    {
        "slug": "security_lead",
        "name": "Security Lead",
        "role": "security",
        "title": "Defensive Security Architecture Lead",
        "reports_to_slug": "ceo_agent",
        "active_initially": False,
        "budget_monthly_cents": 1500,
        "timeout_sec": 180,
        "max_turns": 15,
        "toolsets": ["file"],
        "workspace_scope": (ALLINONE_HOME + r"\workspaces"),
        "objective": "Govern defensive security review policies, risk prioritization, and scope compliance.",
        "responsibilities": ["Prioritize confirmed defensive findings and verify authorization boundaries."],
        "prohibited": ["Any offensive probing, network scanning, exploit generation, or shell execution."],
        "expected_output": "Risk prioritization matrix and defensive security governance sign-off.",
    },
    {
        "slug": "security_reviewer",
        "name": "Security Reviewer",
        "role": "security",
        "title": "Defensive Code & Findings Security Reviewer",
        "reports_to_slug": "ceo_agent",
        "active_initially": True,
        "budget_monthly_cents": 2000,
        "timeout_sec": 180,
        "max_turns": 15,
        "toolsets": ["file"],
        "workspace_scope": (ALLINONE_HOME + r"\workspaces"),
        "objective": "Perform read-only defensive review of sanitized security findings, dependency advisories, and code remediations.",
        "responsibilities": [
            "Evaluate sanitized static analysis findings and source code using read-only file inspection.",
            "Assess false positives vs confirmed defensive weaknesses without inventing CVE IDs.",
            "Verify whether code remediations properly address root causes.",
        ],
        "prohibited": [
            "Terminal/shell execution (`terminal` toolset is intentionally disabled).",
            "Offensive testing, live network requests, or reading files outside authorized workspaces.",
        ],
        "expected_output": "Structured Defensive Security Review (`CONFIRMED` / `FALSE_POSITIVE` / `VERIFIED`) with CWE rationale and remediation guidance.",
    },
    {
        "slug": "findings_analyst",
        "name": "Findings Analyst",
        "role": "researcher",
        "title": "Security Findings Triage & Deduplication Analyst",
        "reports_to_slug": "security_lead",
        "active_initially": False,
        "budget_monthly_cents": 1000,
        "timeout_sec": 180,
        "max_turns": 12,
        "toolsets": ["file"],
        "workspace_scope": (ALLINONE_HOME + r"\reports"),
        "objective": "Classify, deduplicate, and summarize sanitized defensive audit reports.",
        "responsibilities": ["Normalize severity, check evidence quality, and flag duplicates."],
        "prohibited": ["Shell execution, network scanning, or fabricating vulnerability identifiers."],
        "expected_output": "Normalized findings summary table.",
    },
    {
        "slug": "remediation_reviewer",
        "name": "Remediation Reviewer",
        "role": "security",
        "title": "Security Remediation & Regression Verifier",
        "reports_to_slug": "security_lead",
        "active_initially": False,
        "budget_monthly_cents": 1000,
        "timeout_sec": 180,
        "max_turns": 12,
        "toolsets": ["file"],
        "workspace_scope": (ALLINONE_HOME + r"\workspaces"),
        "objective": "Verify that security remediations eliminate the reported weakness without introducing insecure patterns.",
        "responsibilities": ["Inspect remediation diffs and regression test coverage."],
        "prohibited": ["Shell execution or modifying source code directly."],
        "expected_output": "Remediation verification sign-off (`RESOLVED` or `REWORK_REQUIRED`).",
    },
    {
        "slug": "compliance_reporter",
        "name": "Report & Compliance Agent",
        "role": "pm",
        "title": "Audit Evidence & Acceptance Compliance Specialist",
        "reports_to_slug": "ceo_agent",
        "active_initially": False,
        "budget_monthly_cents": 1000,
        "timeout_sec": 180,
        "max_turns": 12,
        "toolsets": ["file"],
        "workspace_scope": (ALLINONE_HOME + r"\reports"),
        "objective": "Compile auditable engineering & security reports and verify acceptance criteria completeness.",
        "responsibilities": ["Aggregate run evidence, test results, and compliance checklists."],
        "prohibited": ["Shell execution, secret access, or altering task evidence."],
        "expected_output": "Executive & technical compliance summary document.",
    },
]


def render_role_instructions_md(spec: dict[str, Any]) -> str:
    resp_lines = "\n".join(f"- {r}" for r in spec["responsibilities"])
    proh_lines = "\n".join(f"- {p}" for p in spec["prohibited"])
    tools_csv = ", ".join(spec["toolsets"])
    ws = spec["workspace_scope"].replace("\\", "/")
    return f"""# {spec['name']} — {spec['title']}

## 1. Role Definition & Objective
- **Role Slug:** `{spec['slug']}` (Paperclip role: `{spec['role']}`)
- **Objective:** {spec['objective']}

## 2. Responsibilities
{resp_lines}

## 3. Authorized Workspace & Available Tools
- **Authorized Workspace Root:** `{ws}`
- **Permitted Hermes Toolsets:** `{tools_csv}`
- For parallel coding tasks, operate on a dedicated Git branch or worktree inside the project workspace.

## 4. Prohibited Actions
{proh_lines}
- Never read or write `{ALLINONE_HERMES_HOME}` root files (Owner private zone) or `{ALLINONE_HOME}/config/secrets`.
- Never include secrets, tokens, or API keys in issue comments, logs, or memory.

## 5. Input, Expected Output & Acceptance Criteria
- **Input Requirements:** Assigned Paperclip issue context (`$PAPERCLIP_TASK_ID`), project path, and explicit acceptance criteria.
- **Expected Output:** {spec['expected_output']}
- **Acceptance Criteria:** All claims must be backed by real file/test evidence; zero out-of-scope file edits; zero secret exposure.

## 6. Reporting Format, Escalation, Budget & Delegation Limits
- **Reporting Format:** Concise Markdown summary with `Summary`, `Actions/Files`, `Verification Evidence`, and `Status`.
- **Escalation Rules:** If an action requires production deployment, destructive deletion, Windows UAC elevation, or out-of-scope access, mark the issue `blocked` and escalate to the Board/Owner.
- **Budget & Runtime Limits:** Monthly budget cap `{spec['budget_monthly_cents']} cents` (tracked in Paperclip), timeout `{spec['timeout_sec']}s`, max `{spec['max_turns']}` turns per run, max delegation depth `2`.
"""


@contextlib.contextmanager
def workspace_exclusive_lock(workspace_name: str, holder: str, timeout_s: float = 30.0) -> Iterator[Path]:
    """File-based atomic exclusive lock (`O_CREAT | O_EXCL`) preventing concurrent conflicting edits."""
    LOCKS_DIR.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in workspace_name)
    lock_file = LOCKS_DIR / f"{safe}.lock"
    deadline = time.time() + timeout_s
    acquired = False
    while time.time() < deadline:
        try:
            fd = os.open(str(lock_file), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump({"holder": holder, "pid": os.getpid(), "acquired_at": time.time()}, fh)
            acquired = True
            break
        except FileExistsError:
            # Reclaim stale lock > 15 min old
            try:
                if time.time() - lock_file.stat().st_mtime > 900:
                    lock_file.unlink(missing_ok=True)
                    continue
            except OSError:
                pass
            time.sleep(0.25)
    if not acquired:
        raise TimeoutError(f"Workspace '{workspace_name}' is exclusively locked by another active worker.")
    try:
        yield lock_file
    finally:
        lock_file.unlink(missing_ok=True)


def create_isolated_git_worktree(repo_dir: Path, branch_name: str) -> Path:
    """Create an isolated Git worktree for parallel branch development so concurrent workers never overwrite files."""
    wt_root = repo_dir.parent / f"{repo_dir.name}-worktrees"
    wt_root.mkdir(parents=True, exist_ok=True)
    safe_branch = branch_name.replace("/", "-")
    wt_path = wt_root / safe_branch
    if wt_path.exists():
        subprocess.run(["git", "-C", str(repo_dir), "worktree", "remove", "--force", str(wt_path)], capture_output=True, check=False)
    subprocess.run(
        ["git", "-C", str(repo_dir), "worktree", "add", "-B", branch_name, str(wt_path)],
        capture_output=True,
        text=True,
        check=True,
    )
    return wt_path


def provision_organization() -> dict[str, Any]:
    pc = PaperclipClient()
    company = pc.get_primary_company("Unified AI Engineering & Operations")
    cid = company["id"]

    # Set company-level monthly budget ($120.00 = 12000 cents) with unpricedUsagePolicy="allow"
    # because custom provider `combo/X` (a user-configured ALLINONE_CUSTOM_PROVIDER_URL) may report
    # token counts without USD pricing metadata.
    pc.must(
        "POST",
        f"/api/companies/{cid}/budgets/policies",
        {
            "scopeType": "company",
            "scopeId": cid,
            "amount": 12000,
            "isActive": True,
            "windowKind": "calendar_month_utc",
            "unpricedUsagePolicy": "allow",
        },
    )

    existing_agents = {a["name"]: a for a in pc.list_agents(cid)}
    slug_to_agent: dict[str, dict[str, Any]] = {}

    for spec in ORG_ROSTER:
        instructions_md = render_role_instructions_md(spec)
        worker_meta = provision_worker_home(
            spec["slug"],
            role_title=spec["title"],
            authorized_workspace=spec["workspace_scope"],
            allowed_toolsets=spec["toolsets"],
            extra_soul_rules=instructions_md,
        )

        reports_to_id = None
        if spec["reports_to_slug"] and spec["reports_to_slug"] in slug_to_agent:
            reports_to_id = slug_to_agent[spec["reports_to_slug"]]["id"]

        adapter_cfg = {
            "hermesCommand": HERMES_EXE,
            "model": "combo/X",
            "provider": "auto",
            "timeoutSec": spec["timeout_sec"],
            "graceSec": 10,
            "maxTurnsPerRun": spec["max_turns"],
            "toolsets": ",".join(spec["toolsets"]),
            "persistSession": False,
            "worktreeMode": False,
            "quiet": True,
            "cwd": spec["workspace_scope"],
            "instructionsFilePath": worker_meta["instructions_file"],
            "paperclipApiUrl": "http://127.0.0.1:3100/api",
            "env": {
                "HERMES_HOME": worker_meta["hermes_home"],
            },
        }

        if spec["name"] not in existing_agents:
            created = pc.create_agent(
                cid,
                {
                    "name": spec["name"],
                    "role": spec["role"],
                    "title": spec["title"],
                    "reportsTo": reports_to_id,
                    "capabilities": spec["objective"],
                    "adapterType": "hermes_local",
                    "adapterConfig": adapter_cfg,
                    "instructionsBundle": {
                        "entryFile": "AGENTS.md",
                        "files": {"AGENTS.md": instructions_md},
                    },
                    "budgetMonthlyCents": spec["budget_monthly_cents"],
                    "permissions": {
                        "canCreateAgents": False,
                        "canCreateSkills": False,
                    },
                    "metadata": {
                        "role_slug": spec["slug"],
                        "hermes_profile": worker_meta["profile_id"],
                        "activation_tier": "wave_1_active" if spec["active_initially"] else "wave_2_standby",
                    },
                },
            )
        else:
            cur = existing_agents[spec["name"]]
            cur_cfg = cur.get("adapterConfig") or {}
            cfg_matches = (
                cur.get("adapterType") == "hermes_local"
                and cur_cfg.get("toolsets") == adapter_cfg["toolsets"]
                and cur_cfg.get("instructionsFilePath") == adapter_cfg["instructionsFilePath"]
                and (cur_cfg.get("env") or {}).get("HERMES_HOME") == adapter_cfg["env"]["HERMES_HOME"]
            )
            if cfg_matches:
                created = cur
            else:
                created = pc.update_agent(
                    cur["id"],
                    {
                        "role": spec["role"],
                        "title": spec["title"],
                        "reportsTo": reports_to_id,
                        "capabilities": spec["objective"],
                        "adapterType": "hermes_local",
                        "adapterConfig": adapter_cfg,
                        "replaceAdapterConfig": True,
                        "budgetMonthlyCents": spec["budget_monthly_cents"],
                    },
                )
            pc.update_agent_permissions(
                created["id"],
                {
                    "canCreateAgents": False,
                    "canAssignTasks": spec["slug"] in ("ceo_agent", "cto_agent", "security_lead"),
                },
            )

        pc.must(
            "POST",
            f"/api/companies/{cid}/budgets/policies",
            {
                "scopeType": "agent",
                "scopeId": created["id"],
                "amount": spec["budget_monthly_cents"],
                "isActive": True,
                "windowKind": "calendar_month_utc",
                "unpricedUsagePolicy": "allow",
            },
        )

        desired_status = "idle" if spec["active_initially"] else "paused"
        cur_ag = pc.must("GET", f"/api/agents/{created['id']}")
        if desired_status == "paused" and cur_ag.get("status") != "paused":
            created = pc.pause_agent(created["id"])
        elif desired_status == "idle" and cur_ag.get("status") == "paused":
            created = pc.resume_agent(created["id"])
        else:
            created = cur_ag

        bind_agent_paperclip_key(worker_meta["hermes_home"], pc, created["id"], spec["slug"])
        slug_to_agent[spec["slug"]] = created

    # Persist non-secret org directory map for fast CLI & Telegram routing
    roster_map = {
        "company_id": cid,
        "company_name": company["name"],
        "agents": {
            slug: {
                "id": ag["id"],
                "name": ag["name"],
                "role": ag.get("role"),
                "title": ag.get("title"),
                "status": ag.get("status"),
                "reportsTo": ag.get("reportsTo"),
                "budgetMonthlyCents": ag.get("budgetMonthlyCents"),
            }
            for slug, ag in slug_to_agent.items()
        },
    }
    (ROOT / "config" / "organization-roster.json").write_text(json.dumps(roster_map, indent=2), encoding="utf-8")
    return roster_map


if __name__ == "__main__":
    res = provision_organization()
    print(json.dumps(res, indent=2))
