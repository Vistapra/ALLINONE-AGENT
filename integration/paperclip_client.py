#!/usr/bin/env python3
"""Official Paperclip REST API client for Unified Autonomous AI Agent Platform."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any
import os
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")


PLATFORM_ROOT = Path(ALLINONE_HOME)
BOARD_KEY_PATH = PLATFORM_ROOT / "config" / "secrets" / "paperclip-board-key.json"
DEFAULT_BASE_URL = "http://127.0.0.1:3100"


class PaperclipApiError(RuntimeError):
    def __init__(self, status: int, body: Any, path: str) -> None:
        super().__init__(f"Paperclip API {path} returned HTTP {status}: {body}")
        self.status = status
        self.body = body
        self.path = path


class PaperclipClient:
    def __init__(
        self,
        *,
        base_url: str = DEFAULT_BASE_URL,
        api_key: str | None = None,
        timeout: float = 45.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        if api_key is None:
            data = json.loads(BOARD_KEY_PATH.read_text(encoding="utf-8"))
            api_key = str(data["token"]).strip()
        self.api_key = api_key
        self.timeout = timeout

    def request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        *,
        auth: bool = True,
        extra_headers: dict[str, str] | None = None,
    ) -> tuple[int, Any]:
        url = f"{self.base_url}{path}"
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers: dict[str, str] = {
            "Accept": "application/json",
            "Origin": self.base_url,
        }
        if auth and self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if body is not None:
            headers["Content-Type"] = "application/json"
        if extra_headers:
            headers.update(extra_headers)

        for attempt in range(2):
            req = urllib.request.Request(url, data=payload, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read().decode("utf-8", errors="replace")
                    try:
                        return resp.status, json.loads(raw) if raw else None
                    except json.JSONDecodeError:
                        return resp.status, raw
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", errors="replace")
                try:
                    parsed = json.loads(raw) if raw else None
                except json.JSONDecodeError:
                    parsed = raw
                return exc.code, parsed
            except (TimeoutError, OSError, urllib.error.URLError):
                if attempt == 0 and method == "GET":
                    time.sleep(2.5)
                    continue
                raise
        raise RuntimeError("Unreachable")

    def must(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        *,
        expected: tuple[int, ...] = (200, 201, 202, 204),
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        code, data = self.request(method, path, body, extra_headers=extra_headers)
        if code not in expected:
            raise PaperclipApiError(code, data, path)
        return data

    # --- Health & Companies ---
    def health(self) -> dict[str, Any]:
        return self.must("GET", "/api/health")

    def list_companies(self) -> list[dict[str, Any]]:
        return self.must("GET", "/api/companies") or []

    def get_primary_company(self, name: str = "Unified AI Engineering & Operations") -> dict[str, Any]:
        companies = self.list_companies()
        for c in companies:
            if c.get("name") == name:
                return c
        if companies:
            return companies[0]
        return self.must("POST", "/api/companies", {"name": name})

    def get_org(self, company_id: str) -> Any:
        return self.must("GET", f"/api/companies/{company_id}/org")

    # --- Agents ---
    def list_agents(self, company_id: str) -> list[dict[str, Any]]:
        return self.must("GET", f"/api/companies/{company_id}/agents") or []

    def create_agent(self, company_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.must("POST", f"/api/companies/{company_id}/agents", payload)

    def update_agent(self, agent_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.must("PATCH", f"/api/agents/{agent_id}", payload)

    def update_agent_permissions(self, agent_id: str, payload: dict[str, Any]) -> Any:
        return self.must("PATCH", f"/api/agents/{agent_id}/permissions", payload)

    def pause_agent(self, agent_id: str) -> dict[str, Any]:
        cur = self.must("GET", f"/api/agents/{agent_id}")
        wait_dl = time.time() + 45.0
        while time.time() < wait_dl and cur.get("lifecycleState") in ("verifying", "configuring", "initializing"):
            time.sleep(1.0)
            cur = self.must("GET", f"/api/agents/{agent_id}")
        if cur.get("status") == "paused" and cur.get("lifecycleState") not in ("pausing", "stopping"):
            return cur
        code, res = self.request("POST", f"/api/agents/{agent_id}/pause", {})
        if code == 409:
            time.sleep(2.0)
            res = self.must("GET", f"/api/agents/{agent_id}")
        deadline = time.time() + 30.0
        while time.time() < deadline and (
            res.get("status") != "paused" or res.get("lifecycleState") in ("pausing", "stopping", "verifying", "configuring")
        ):
            time.sleep(1.0)
            res = self.must("GET", f"/api/agents/{agent_id}")
        return res

    def resume_agent(self, agent_id: str) -> dict[str, Any]:
        cur = self.must("GET", f"/api/agents/{agent_id}")
        deadline_wait = time.time() + 45.0
        while time.time() < deadline_wait and cur.get("lifecycleState") in (
            "pausing",
            "stopping",
            "verifying",
            "configuring",
            "initializing",
        ):
            time.sleep(1.0)
            cur = self.must("GET", f"/api/agents/{agent_id}")
        if cur.get("status") != "paused" and cur.get("lifecycleState") == "ready":
            return cur
        code, res = self.request("POST", f"/api/agents/{agent_id}/resume", {})
        if code == 409:
            time.sleep(2.5)
            res = self.must("GET", f"/api/agents/{agent_id}")
            if res.get("status") == "paused" and res.get("lifecycleState") in ("paused", "ready"):
                _, res = self.request("POST", f"/api/agents/{agent_id}/resume", {})
        deadline = time.time() + 30.0
        while time.time() < deadline and (res.get("status") == "paused" or res.get("lifecycleState") != "ready"):
            time.sleep(1.0)
            res = self.must("GET", f"/api/agents/{agent_id}")
        return res

    def wake_agent(self, agent_id: str, payload: dict[str, Any] | None = None) -> Any:
        return self.must("POST", f"/api/agents/{agent_id}/wakeup", payload or {"source": "on_demand", "trigger": "manual"})

    def create_agent_key(self, agent_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.must("POST", f"/api/agents/{agent_id}/keys", payload)

    # --- Projects & Workspaces ---
    def list_projects(self, company_id: str) -> list[dict[str, Any]]:
        return self.must("GET", f"/api/companies/{company_id}/projects") or []

    def create_project(self, company_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.must("POST", f"/api/companies/{company_id}/projects", payload)

    def list_project_workspaces(self, project_id: str) -> list[dict[str, Any]]:
        return self.must("GET", f"/api/projects/{project_id}/workspaces") or []

    def create_project_workspace(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.must("POST", f"/api/projects/{project_id}/workspaces", payload)

    # --- Issues / Tasks ---
    def list_issues(self, company_id: str, *, status: str | None = None, project_id: str | None = None) -> list[dict[str, Any]]:
        q: dict[str, str] = {}
        if status:
            q["status"] = status
        if project_id:
            q["projectId"] = project_id
        qs = f"?{urllib.parse.urlencode(q)}" if q else ""
        return self.must("GET", f"/api/companies/{company_id}/issues{qs}") or []

    def create_issue(
        self,
        company_id: str,
        payload: dict[str, Any],
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        hdrs = {"Idempotency-Key": idempotency_key} if idempotency_key else None
        return self.must("POST", f"/api/companies/{company_id}/issues", payload, extra_headers=hdrs)

    def get_issue(self, issue_id: str) -> dict[str, Any]:
        return self.must("GET", f"/api/issues/{issue_id}")

    def update_issue(self, issue_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.must("PATCH", f"/api/issues/{issue_id}", payload)

    def add_issue_comment(self, issue_id: str, body: str) -> dict[str, Any]:
        return self.must("POST", f"/api/issues/{issue_id}/comments", {"body": body})

    def list_issue_comments(self, issue_id: str) -> list[dict[str, Any]]:
        return self.must("GET", f"/api/issues/{issue_id}/comments") or []

    # --- Heartbeat Runs ---
    def list_runs(self, company_id: str, *, agent_id: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        q: dict[str, str] = {"limit": str(limit)}
        if agent_id:
            q["agentId"] = agent_id
        return self.must("GET", f"/api/companies/{company_id}/heartbeat-runs?{urllib.parse.urlencode(q)}") or []

    def list_live_runs(self, company_id: str) -> list[dict[str, Any]]:
        return self.must("GET", f"/api/companies/{company_id}/live-runs") or []

    def get_run(self, run_id: str) -> dict[str, Any]:
        return self.must("GET", f"/api/heartbeat-runs/{run_id}")

    def cancel_run(self, run_id: str) -> Any:
        code, data = self.request("POST", f"/api/heartbeat-runs/{run_id}/cancel", {})
        if code in (200, 201, 202, 204, 409):
            return data
        time.sleep(2.0)
        cur = self.get_run(run_id)
        if str(cur.get("status", "")).lower() in ("cancelled", "canceled", "timed_out", "succeeded", "failed"):
            return cur
        return self.must("POST", f"/api/heartbeat-runs/{run_id}/cancel", {})

    def list_run_events(self, run_id: str, limit: int = 200) -> list[dict[str, Any]]:
        return self.must("GET", f"/api/heartbeat-runs/{run_id}/events?limit={limit}") or []

    # --- Secrets & Budgets ---
    def list_secrets(self, company_id: str) -> list[dict[str, Any]]:
        return self.must("GET", f"/api/companies/{company_id}/secrets") or []

    def create_secret(self, company_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.must("POST", f"/api/companies/{company_id}/secrets", payload)

    def budget_overview(self, company_id: str) -> Any:
        return self.must("GET", f"/api/companies/{company_id}/budgets/overview")

    def update_company_budget(self, company_id: str, payload: dict[str, Any]) -> Any:
        return self.must("PATCH", f"/api/companies/{company_id}/budgets", payload)

    def update_agent_budget(self, agent_id: str, payload: dict[str, Any]) -> Any:
        return self.must("PATCH", f"/api/agents/{agent_id}/budgets", payload)

    def wait_for_run_completion(self, run_id: str, timeout_s: float = 240.0) -> dict[str, Any]:
        deadline = time.time() + timeout_s
        terminal = {"succeeded", "completed", "failed", "error", "cancelled", "canceled", "timed_out"}
        last: dict[str, Any] = {}
        while time.time() < deadline:
            try:
                last = self.get_run(run_id)
                st = str(last.get("status", "")).lower()
                if st in terminal:
                    return last
            except (TimeoutError, OSError, urllib.error.URLError):
                pass
            time.sleep(2.5)
        raise TimeoutError(f"Run {run_id} did not finish within {timeout_s}s (last status={last.get('status')})")
