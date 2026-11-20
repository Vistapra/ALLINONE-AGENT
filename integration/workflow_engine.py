#!/usr/bin/env python3
"""Phase 11 & Phase 12: Central Task Lifecycle, Workflow Engine, Idempotency & Telegram Bridge."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from integration.findings_engine import FindingsStore
from integration.paperclip_client import PaperclipClient
from integration.vulnclaw_defensive import sanitize_text, scan_authorized_code
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")
ALLINONE_HERMES_HOME = os.environ.get("ALLINONE_HERMES_HOME") or str(Path.home() / "AppData" / "Local" / "hermes")


PLATFORM_ROOT = Path(ALLINONE_HOME)
WORKFLOW_DB_PATH = PLATFORM_ROOT / "data" / "workflow-ledger.db"
ROSTER_PATH = PLATFORM_ROOT / "config" / "organization-roster.json"
LIMITS_PATH = PLATFORM_ROOT / "config" / "resource-limits.json"
AUTHORIZED_OWNER_ID = os.environ.get("ALLINONE_TELEGRAM_OWNER_ID") or ""

# Map 13-stage platform workflow states <-> native Paperclip IssueStatus
WORKFLOW_TO_PAPERCLIP_STATUS: dict[str, str] = {
    "RECEIVED": "backlog",
    "TRIAGED": "backlog",
    "PLANNED": "todo",
    "PENDING_APPROVAL": "blocked",
    "ASSIGNED": "todo",
    "IN_PROGRESS": "in_progress",
    "IN_REVIEW": "in_review",
    "IN_TESTING": "in_review",
    "READY_FOR_ACCEPTANCE": "in_review",
    "COMPLETED": "done",
    "FAILED": "blocked",
    "BLOCKED": "blocked",
    "CANCELLED": "cancelled",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def classify_owner_instruction(text: str) -> str:
    """Classify natural-language or slash instruction into the 8 canonical Phase 11 categories."""
    t = (text or "").strip().lower()
    if t.startswith(("/approve", "/deny")) or any(k in t for k in ("setujui", "izinkan tindakan", "approve request")):
        return "approval_request"
    if t.startswith(("/platform_status", "/update_status")) or any(k in t for k in ("status platform", "kesehatan sistem", "health check", "status hermes")):
        return "system_health"
    if t.startswith(("/task_status", "/tasks")) or any(k in t for k in ("status task", "progress task", "daftar task")):
        return "task_status"
    if t.startswith(("/security_report",)) or any(k in t for k in ("audit keamanan", "review keamanan", "vulnclaw", "security review", "temuan keamanan")):
        return "defensive_security_review"
    if t.startswith(("/projects", "/agents", "/pause_task", "/resume_task", "/cancel_task")):
        return "project_management"
    if t.startswith("/create_task") or any(k in t for k in ("buat aplikasi", "implementasi fitur", "refactor", "delegasikan", "perbaiki bug", "jalur branch", "unit test")):
        return "software_development"
    if any(k in t for k in ("buka aplikasi", "screenshot", "kapasitas drive", "proses windows", "file explorer", "buka browser")):
        return "windows_operational"
    return "personal_assistant"


class WorkflowEngine:
    def __init__(self, db_path: Path = WORKFLOW_DB_PATH) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS task_ledger (
                    task_uuid TEXT PRIMARY KEY,
                    paperclip_issue_id TEXT NOT NULL UNIQUE,
                    paperclip_identifier TEXT,
                    idempotency_key TEXT UNIQUE,
                    parent_issue_id TEXT,
                    delegation_depth INTEGER NOT NULL DEFAULT 0,
                    assigned_role TEXT,
                    assigned_agent_id TEXT,
                    priority TEXT NOT NULL,
                    scope_path TEXT,
                    dependencies_json TEXT NOT NULL DEFAULT '[]',
                    acceptance_criteria TEXT,
                    workflow_stage TEXT NOT NULL,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    last_run_id TEXT,
                    evidence_json TEXT NOT NULL DEFAULT '{}',
                    owner_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS auth_audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    caller_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    allowed INTEGER NOT NULL,
                    detail TEXT,
                    created_at TEXT NOT NULL
                );
                """
            )

    def assert_owner_authorized(self, caller_id: str, action: str) -> None:
        cid = str(caller_id or "").strip()
        # Fail closed: an unconfigured AUTHORIZED_OWNER_ID must never match an
        # empty/anonymous caller_id.
        allowed = bool(AUTHORIZED_OWNER_ID) and cid == AUTHORIZED_OWNER_ID
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO auth_audit_log (caller_id, action, allowed, detail, created_at) VALUES (?, ?, ?, ?, ?)",
                (cid or "anonymous", action, 1 if allowed else 0, "owner_check", _now_iso()),
            )
        if not allowed:
            raise PermissionError(f"Unauthorized Telegram/caller ID '{cid}'. Access restricted exclusively to Owner {AUTHORIZED_OWNER_ID}.")

    def _load_limits(self) -> dict[str, Any]:
        if LIMITS_PATH.exists():
            return json.loads(LIMITS_PATH.read_text(encoding="utf-8")).get("limits", {})
        return {"max_delegation_depth": 2, "max_subtasks_per_parent": 6, "max_retries_per_task": 2, "max_parallel_engineering_tasks": 1}

    def _load_roster(self) -> dict[str, Any]:
        if ROSTER_PATH.exists():
            return json.loads(ROSTER_PATH.read_text(encoding="utf-8"))
        return {"agents": {}}

    def _check_no_cycle(self, issue_id: str, depends_on: list[str]) -> None:
        with self._connect() as conn:
            visited: set[str] = {issue_id}
            stack = list(depends_on)
            while stack:
                cur = stack.pop()
                if cur in visited:
                    raise ValueError(f"Circular task dependency detected involving {cur}")
                visited.add(cur)
                row = conn.execute("SELECT dependencies_json FROM task_ledger WHERE paperclip_issue_id = ?", (cur,)).fetchone()
                if row:
                    stack.extend(json.loads(row["dependencies_json"] or "[]"))

    def submit_task(
        self,
        *,
        caller_id: str,
        title: str,
        description: str,
        role_slug: str = "ceo_agent",
        priority: str = "medium",
        project_id: str | None = None,
        parent_issue_id: str | None = None,
        scope_path: str | None = None,
        acceptance_criteria: str = "All requested outputs verified with exit code 0 and zero out-of-scope changes.",
        dependencies: list[str] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        self.assert_owner_authorized(caller_id, "submit_task")
        limits = self._load_limits()
        deps = dependencies or []

        # 1. Idempotency check (duplicate Telegram message or retry returns existing task cleanly)
        if idempotency_key:
            with self._connect() as conn:
                dup = conn.execute("SELECT * FROM task_ledger WHERE idempotency_key = ?", (idempotency_key,)).fetchone()
                if dup:
                    return {"deduplicated": True, "task": dict(dup)}

        # 2. Enforce delegation depth & max subtasks per parent
        depth = 0
        if parent_issue_id:
            with self._connect() as conn:
                prow = conn.execute("SELECT delegation_depth FROM task_ledger WHERE paperclip_issue_id = ?", (parent_issue_id,)).fetchone()
                depth = (int(prow["delegation_depth"]) + 1) if prow else 1
                if depth > int(limits.get("max_delegation_depth", 2)):
                    raise ValueError(f"Delegation depth {depth} exceeds limit {limits.get('max_delegation_depth', 2)}")
                child_cnt = conn.execute("SELECT COUNT(*) FROM task_ledger WHERE parent_issue_id = ?", (parent_issue_id,)).fetchone()[0]
                if int(child_cnt) >= int(limits.get("max_subtasks_per_parent", 6)):
                    raise ValueError(f"Subtask count for parent {parent_issue_id} reached cap {limits.get('max_subtasks_per_parent', 6)}")

        pc = PaperclipClient()
        roster = self._load_roster()
        company = pc.get_primary_company()
        cid = company["id"]

        agent_entry = roster.get("agents", {}).get(role_slug)
        assignee_id = agent_entry["id"] if agent_entry else None

        # Check dependency readiness: if any blocker dependency is not COMPLETED/done, start in backlog
        initial_stage = "ASSIGNED" if assignee_id else "TRIAGED"
        if deps:
            for dep_id in deps:
                dep_issue = pc.get_issue(dep_id)
                if dep_issue.get("status") != "done":
                    initial_stage = "PLANNED"
                    break

        pc_status = WORKFLOW_TO_PAPERCLIP_STATUS[initial_stage] if initial_stage != "PLANNED" else "backlog"
        safe_title = sanitize_text(title.strip())[:200]
        safe_desc = sanitize_text(description.strip())
        full_body = (
            f"{safe_desc}\n\n"
            f"---\n"
            f"- **Workflow Stage:** `{initial_stage}`\n"
            f"- **Authorized Scope:** `{scope_path or (ALLINONE_HOME + '/workspaces')}`\n"
            f"- **Acceptance Criteria:** {sanitize_text(acceptance_criteria)}\n"
        )

        payload: dict[str, Any] = {
            "title": safe_title,
            "description": full_body,
            "status": pc_status,
            "priority": priority if priority in ("critical", "high", "medium", "low") else "medium",
        }
        if project_id:
            payload["projectId"] = project_id
        if parent_issue_id:
            payload["parentId"] = parent_issue_id
        if assignee_id and pc_status != "backlog":
            payload["assigneeAgentId"] = assignee_id

        idem_hdr = hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()[:32] if idempotency_key else None
        created = pc.create_issue(cid, payload, idempotency_key=idem_hdr)

        if deps:
            self._check_no_cycle(created["id"], deps)

        now = _now_iso()
        with self._connect() as conn:
            existing_issue = conn.execute(
                "SELECT * FROM task_ledger WHERE paperclip_issue_id = ?", (created["id"],)
            ).fetchone()
            if existing_issue:
                return {"deduplicated": True, "task": dict(existing_issue), "paperclip_issue": created}
            conn.execute(
                """
                INSERT INTO task_ledger (
                    task_uuid, paperclip_issue_id, paperclip_identifier, idempotency_key,
                    parent_issue_id, delegation_depth, assigned_role, assigned_agent_id,
                    priority, scope_path, dependencies_json, acceptance_criteria,
                    workflow_stage, retry_count, last_run_id, evidence_json, owner_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, '{}', ?, ?, ?)
                """,
                (
                    created["id"],
                    created["id"],
                    created.get("identifier"),
                    idempotency_key,
                    parent_issue_id,
                    depth,
                    role_slug,
                    assignee_id,
                    payload["priority"],
                    scope_path or str(PLATFORM_ROOT / "workspaces"),
                    json.dumps(deps),
                    acceptance_criteria,
                    initial_stage,
                    str(caller_id),
                    now,
                    now,
                ),
            )
            row = dict(conn.execute("SELECT * FROM task_ledger WHERE paperclip_issue_id = ?", (created["id"],)).fetchone())

        return {"deduplicated": False, "task": row, "paperclip_issue": created}

    def update_stage(
        self,
        issue_ref: str,
        new_stage: str,
        *,
        caller_id: str = AUTHORIZED_OWNER_ID,
        evidence: dict[str, Any] | None = None,
        comment: str | None = None,
    ) -> dict[str, Any]:
        self.assert_owner_authorized(caller_id, f"update_stage:{new_stage}")
        if new_stage not in WORKFLOW_TO_PAPERCLIP_STATUS:
            raise ValueError(f"Unsupported workflow stage: {new_stage}")
        pc = PaperclipClient()
        issue = self.resolve_issue(pc, issue_ref)
        iid = issue["id"]
        pc_status = WORKFLOW_TO_PAPERCLIP_STATUS[new_stage]

        patch: dict[str, Any] = {"status": pc_status}
        if pc_status == "blocked":
            patch["unblockDescriptor"] = {
                "owner": "board",
                "action": sanitize_text(comment or f"Awaiting Owner review/unblock for stage {new_stage}.")[:500],
            }
        else:
            patch["unblockDescriptor"] = None
        if comment:
            patch["comment"] = sanitize_text(comment)
        updated_issue = pc.update_issue(iid, patch)

        # If cancelling, also cancel any active heartbeat run for this agent/issue
        if new_stage == "CANCELLED":
            cid = updated_issue["companyId"]
            for run in pc.list_live_runs(cid):
                if run.get("agentId") == updated_issue.get("assigneeAgentId"):
                    pc.cancel_run(run["id"])

        now = _now_iso()
        with self._connect() as conn:
            existing = conn.execute("SELECT * FROM task_ledger WHERE paperclip_issue_id = ?", (iid,)).fetchone()
            if existing:
                merged_ev = json.loads(existing["evidence_json"] or "{}")
                if evidence:
                    merged_ev.update(evidence)
                conn.execute(
                    "UPDATE task_ledger SET workflow_stage = ?, evidence_json = ?, updated_at = ? WHERE paperclip_issue_id = ?",
                    (new_stage, json.dumps(merged_ev), now, iid),
                )
        return {"issue_id": iid, "identifier": updated_issue.get("identifier"), "workflow_stage": new_stage, "paperclip_status": pc_status}

    def retry_task(self, issue_ref: str, *, caller_id: str = AUTHORIZED_OWNER_ID) -> dict[str, Any]:
        self.assert_owner_authorized(caller_id, "retry_task")
        limits = self._load_limits()
        max_retries = int(limits.get("max_retries_per_task", 2))
        pc = PaperclipClient()
        issue = self.resolve_issue(pc, issue_ref)
        iid = issue["id"]
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM task_ledger WHERE paperclip_issue_id = ?", (iid,)).fetchone()
            if row:
                rc = int(row["retry_count"])
                if rc >= max_retries:
                    raise RuntimeError(f"Retry limit ({max_retries}) reached for task {issue.get('identifier') or iid}; manual review required.")
                conn.execute(
                    "UPDATE task_ledger SET retry_count = ?, workflow_stage = 'IN_PROGRESS', updated_at = ? WHERE paperclip_issue_id = ?",
                    (rc + 1, _now_iso(), iid),
                )
        pc.update_issue(iid, {"status": "todo"})
        if issue.get("assigneeAgentId"):
            try:
                pc.wake_agent(issue["assigneeAgentId"], {"source": "on_demand", "trigger": "manual"})
            except Exception:
                pass
        return {"retried": True, "issue_id": iid, "identifier": issue.get("identifier")}

    @staticmethod
    def resolve_issue(pc: PaperclipClient, issue_ref: str) -> dict[str, Any]:
        ref = issue_ref.strip()
        try:
            return pc.get_issue(ref)
        except Exception:
            cid = pc.get_primary_company()["id"]
            for it in pc.list_issues(cid):
                if str(it.get("identifier", "")).upper() == ref.upper() or it["id"].startswith(ref):
                    return it
            raise KeyError(f"Task not found: {issue_ref}")

    def reconcile_tasks(self) -> dict[str, Any]:
        """Reconcile ledger stages against Paperclip DB & unblock dependent tasks when prerequisites complete."""
        pc = PaperclipClient()
        cid = pc.get_primary_company()["id"]
        issues_by_id = {i["id"]: i for i in pc.list_issues(cid)}
        unblocked = 0
        synced = 0
        roster = self._load_roster()
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM task_ledger").fetchall()
            for r in rows:
                iid = r["paperclip_issue_id"]
                pc_issue = issues_by_id.get(iid)
                if not pc_issue:
                    continue
                if pc_issue.get("status") == "done" and r["workflow_stage"] != "COMPLETED":
                    conn.execute(
                        "UPDATE task_ledger SET workflow_stage = 'COMPLETED', updated_at = ? WHERE paperclip_issue_id = ?",
                        (_now_iso(), iid),
                    )
                    synced += 1
                elif r["workflow_stage"] == "PLANNED":
                    deps = json.loads(r["dependencies_json"] or "[]")
                    if deps and all(issues_by_id.get(d, {}).get("status") == "done" for d in deps):
                        ag_id = r["assigned_agent_id"] or roster.get("agents", {}).get(r["assigned_role"] or "", {}).get("id")
                        patch: dict[str, Any] = {"status": "todo"}
                        if ag_id:
                            patch["assigneeAgentId"] = ag_id
                        pc.update_issue(iid, patch)
                        conn.execute(
                            "UPDATE task_ledger SET workflow_stage = 'ASSIGNED', updated_at = ? WHERE paperclip_issue_id = ?",
                            (_now_iso(), iid),
                        )
                        unblocked += 1
        return {"synced_completed": synced, "dependencies_unblocked": unblocked}


def send_owner_telegram_notification(message: str) -> dict[str, Any]:
    """Send a strictly sanitized status/completion report to the configured
    platform owner (ALLINONE_TELEGRAM_OWNER_ID) ONLY.

    Uses one-shot HTTPS sendMessage (never getUpdates), so it never competes with \\Hermes_Gateway polling.
    """
    safe_msg = sanitize_text(message)[:3900]
    hermes_env = Path((ALLINONE_HERMES_HOME + r"\.env"))
    bot_token = ""
    if hermes_env.exists():
        for ln in hermes_env.read_text(encoding="utf-8", errors="ignore").splitlines():
            if ln.strip().startswith("TELEGRAM_BOT_TOKEN="):
                bot_token = ln.split("=", 1)[1].strip().strip('"').strip("'")
                break
    if not bot_token:
        return {"sent": False, "reason": "no_token"}
    if not AUTHORIZED_OWNER_ID:
        return {"sent": False, "reason": "no_owner_id_configured"}

    payload = json.dumps({
        "chat_id": AUTHORIZED_OWNER_ID,
        "text": safe_msg,
        "disable_web_page_preview": True,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{bot_token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            body = json.loads(resp.read().decode("utf-8", errors="replace"))
            return {"sent": bool(body.get("ok")), "message_id": (body.get("result") or {}).get("message_id")}
    except Exception as exc:
        return {"sent": False, "reason": sanitize_text(str(exc))[:120]}
