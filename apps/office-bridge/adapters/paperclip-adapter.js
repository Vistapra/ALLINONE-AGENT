"use strict";

/**
 * Phase 23, 28, 29 & 30 — Official Paperclip Runtime Adapter for Office Bridge.
 *
 * - Reads Paperclip EXCLUSIVELY via official REST API (`http://127.0.0.1:3100/api/*`)
 *   and official Live Events WebSocket (`ws://127.0.0.1:3100/api/companies/:companyId/events/ws`).
 * - NEVER touches PostgreSQL directly and NEVER duplicates company/agent/task storage.
 * - Preserves `cost_usd: null` honestly as `COST UNKNOWN` / `UNPRICED USAGE` (never `$0.00`).
 * - Extracts verified tool/build/test signals ONLY from actual Paperclip run logs/events.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { mapPaperclipAgentIdentity, DEPARTMENTS } = require("../contracts/agent-identity");
const { sanitizePayload, sanitizeText } = require("../contracts/redaction");
const ALLINONE_HOME = process.env.ALLINONE_HOME || require("os").homedir() + "/ALLINONE-AGENT";


const BOARD_KEY_PATH = path.resolve(`${ALLINONE_HOME}\\config\\secrets\\paperclip-board-key.json`);
const OBSERVER_KEY_CACHE_PATH = path.resolve(`${ALLINONE_HOME}\\config\\secrets\\paperclip-ws-observer-key.json`);
const CLEAR_ORPHAN_RUNS_SCRIPT = path.resolve(`${ALLINONE_HOME}\\scripts\\clear-orphan-cancelled-runs.cjs`);
const DEFAULT_PAPERCLIP_URL = "http://127.0.0.1:3100";
const PRIMARY_COMPANY_NAME = "Unified AI Engineering & Operations";

function clearWindowsTerminalRunHolds() {
  if (!fs.existsSync(CLEAR_ORPHAN_RUNS_SCRIPT)) return;
  try {
    execFileSync(process.execPath, [CLEAR_ORPHAN_RUNS_SCRIPT], { timeout: 6000, stdio: "ignore", windowsHide: true });
  } catch {
    // non-fatal best effort
  }
}

function loadBoardToken() {
  const raw = JSON.parse(fs.readFileSync(BOARD_KEY_PATH, "utf8"));
  const tok = String(raw.token || "").trim();
  if (!tok) throw new Error("Paperclip board token is empty.");
  return tok;
}

/**
 * Inspect actual run log/event text to determine whether verified coding, testing,
 * building, or researching tool activity occurred. Never guesses from role name.
 */
function inspectRunEvidenceText(rawText) {
  const text = String(rawText || "");
  if (!text.trim()) return { verifiedToolKind: null, verifiedTools: [] };

  const verifiedTools = [];
  if (/\b(write_file|edit_file|patch|git\s+commit|git\s+checkout\s+-b)\b/i.test(text)) {
    verifiedTools.push("code_edit");
  }
  if (/\b(unittest|pytest|vitest|npm\s+test|Ran\s+\d+\s+tests?)\b/i.test(text)) {
    verifiedTools.push("test_execution");
  }
  if (/\b(py_compile|tsc\s+--noEmit|next\s+build|npm\s+run\s+build)\b/i.test(text)) {
    verifiedTools.push("build_verification");
  }
  if (/\b(codescan|search_files|grep|rg\s+|read_file)\b/i.test(text)) {
    verifiedTools.push("code_inspection");
  }

  // Latest prominent tool kind priority: test -> build -> coding -> researching
  let verifiedToolKind = null;
  const tail = text.slice(-1800);
  if (/\b(unittest|pytest|vitest|Ran\s+\d+\s+tests?)\b/i.test(tail)) {
    verifiedToolKind = "testing";
  } else if (/\b(py_compile|tsc\s+--noEmit|next\s+build|npm\s+run\s+build)\b/i.test(tail)) {
    verifiedToolKind = "building";
  } else if (/\b(write_file|edit_file|patch|git\s+commit)\b/i.test(tail)) {
    verifiedToolKind = "coding";
  } else if (/\b(codescan|search_files|grep|read_file)\b/i.test(tail)) {
    verifiedToolKind = "researching";
  }

  return {
    verifiedToolKind,
    verifiedTestCommand: verifiedTools.includes("test_execution"),
    verifiedBuildCommand: verifiedTools.includes("build_verification"),
    verifiedTools,
  };
}

class PaperclipRuntimeAdapter {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || DEFAULT_PAPERCLIP_URL).replace(/\/$/, "");
    this.apiKey = options.apiKey || loadBoardToken();
    this.timeoutMs = options.timeoutMs || 20_000;
    this.companyCache = null;
    this.runEvidenceCache = new Map();
  }

  async request(method, apiPath, body = undefined, extraHeaders = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = {
        Accept: "application/json",
        Origin: this.baseUrl,
        Authorization: `Bearer ${this.apiKey}`,
        ...extraHeaders,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      const res = await fetch(`${this.baseUrl}${apiPath}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      return { ok: res.ok, status: res.status, data: parsed };
    } finally {
      clearTimeout(timer);
    }
  }

  async must(method, apiPath, body = undefined, extraHeaders = {}) {
    const res = await this.request(method, apiPath, body, extraHeaders);
    if (!res.ok) {
      const err = new Error(`Paperclip ${method} ${apiPath} failed with HTTP ${res.status}`);
      err.status = res.status;
      err.details = sanitizePayload(res.data);
      throw err;
    }
    return res.data;
  }

  async checkHealth() {
    try {
      const data = await this.must("GET", "/api/health");
      return { reachable: data?.status === "ok" || Boolean(data), health: sanitizePayload(data) };
    } catch (err) {
      return { reachable: false, error: sanitizeText(err.message) };
    }
  }

  async getPrimaryCompany() {
    const companies = (await this.must("GET", "/api/companies")) || [];
    const found = companies.find((c) => c.name === PRIMARY_COMPANY_NAME) || companies[0];
    if (!found) {
      throw new Error("Primary company not found in Paperclip.");
    }
    this.companyCache = found;
    return found;
  }

  async getOrganizationSnapshot() {
    const company = await this.getPrimaryCompany();
    const cid = company.id;
    const [orgTree, rawAgents, projects, issues, liveRuns, recentRuns, budgetOverview, approvals] = await Promise.all([
      this.must("GET", `/api/companies/${cid}/org`).catch(() => []),
      this.must("GET", `/api/companies/${cid}/agents`),
      this.must("GET", `/api/companies/${cid}/projects`).catch(() => []),
      this.must("GET", `/api/companies/${cid}/issues`).catch(() => []),
      this.must("GET", `/api/companies/${cid}/live-runs`).catch(() => []),
      this.must("GET", `/api/companies/${cid}/heartbeat-runs?limit=60`).catch(() => []),
      this.must("GET", `/api/companies/${cid}/budgets/overview`).catch(() => null),
      this.must("GET", `/api/companies/${cid}/approvals`).catch(() => []),
    ]);

    // Deduplicate canonical agent identities strictly by Paperclip UUID
    const seenIds = new Set();
    const uniqueRawAgents = [];
    for (const a of rawAgents || []) {
      if (a && a.id && !seenIds.has(a.id)) {
        seenIds.add(a.id);
        uniqueRawAgents.push(a);
      }
    }

    const mappedAgents = uniqueRawAgents.map((a, idx) => mapPaperclipAgentIdentity(a, uniqueRawAgents, idx));

    return {
      company: {
        id: company.id,
        name: company.name,
        issuePrefix: company.issuePrefix || "UNI",
        status: company.status || "active",
      },
      departments: Object.values(DEPARTMENTS),
      orgTree: sanitizePayload(orgTree),
      rawAgents: uniqueRawAgents,
      agents: mappedAgents,
      projects: sanitizePayload(projects || []),
      issues: sanitizePayload(issues || []),
      liveRuns: sanitizePayload(liveRuns || []),
      recentRuns: sanitizePayload(recentRuns || []),
      budgetOverview: this.formatBudgetGovernance(budgetOverview, recentRuns || [], mappedAgents),
      approvals: sanitizePayload(approvals || []),
      observedAt: new Date().toISOString(),
    };
  }

  /**
   * Format Paperclip budget & cost metrics honestly.
   * Never converts null USD cost from custom provider `combo/X` into `$0.00`!
   */
  formatBudgetGovernance(budgetOverview, recentRuns = [], mappedAgents = []) {
    const policies = Array.isArray(budgetOverview?.policies) ? budgetOverview.policies : [];
    const formattedPolicies = policies.map((pol) => {
      const unpricedCount = Number(pol.unpricedEventCount || 0);
      const observedCents = Number(pol.observedAmount || 0);
      const hasUnpricedOnly = unpricedCount > 0 && observedCents === 0;
      return {
        policy_id: pol.policyId,
        scope_type: pol.scopeType,
        scope_id: pol.scopeId,
        scope_name: pol.scopeName,
        quota_cents: pol.amount,
        observed_cents: observedCents,
        unpriced_event_count: unpricedCount,
        unpriced_usage_policy: pol.unpricedUsagePolicy || "unknown",
        cost_status: hasUnpricedOnly ? "COST UNKNOWN" : observedCents > 0 ? "PRICED" : unpricedCount === 0 ? "COST UNKNOWN" : "UNPRICED USAGE",
        usage_label: hasUnpricedOnly || observedCents === 0 ? "UNPRICED USAGE" : `${(observedCents / 100).toFixed(2)} USD`,
        paused: Boolean(pol.paused),
        pause_reason: pol.pauseReason || null,
        hard_stop_enabled: Boolean(pol.hardStopEnabled),
        window_start: pol.windowStart,
        window_end: pol.windowEnd,
      };
    });

    // Aggregate real token usage & durations per agent from Paperclip heartbeat-runs
    const usageByAgent = {};
    let totalTokens = 0;
    let totalDurationMs = 0;
    for (const run of recentRuns) {
      const aid = run.agentId;
      if (!aid) continue;
      if (!usageByAgent[aid]) {
        usageByAgent[aid] = {
          agent_id: aid,
          run_count: 0,
          succeeded_runs: 0,
          failed_runs: 0,
          cancelled_runs: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          total_duration_ms: 0,
          cost_usd: null,
          cost_label: "COST UNKNOWN",
          usage_classification: "UNPRICED USAGE",
        };
      }
      const bucket = usageByAgent[aid];
      bucket.run_count += 1;
      const st = String(run.status || "").toLowerCase();
      if (st === "succeeded") bucket.succeeded_runs += 1;
      else if (st === "failed" || st === "timed_out") bucket.failed_runs += 1;
      else if (st === "cancelled" || st === "canceled") bucket.cancelled_runs += 1;

      const usage = run.usageJson || run.resultJson?.usage || {};
      const inTok = Number(usage.inputTokens ?? usage.prompt_tokens ?? 0) || 0;
      const outTok = Number(usage.outputTokens ?? usage.completion_tokens ?? 0) || 0;
      const totTok = Number(usage.totalTokens ?? usage.total_tokens ?? inTok + outTok) || 0;
      bucket.input_tokens += inTok;
      bucket.output_tokens += outTok;
      bucket.total_tokens += totTok;
      totalTokens += totTok;

      if (run.startedAt && run.finishedAt) {
        const dur = Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt));
        if (Number.isFinite(dur)) {
          bucket.total_duration_ms += dur;
          totalDurationMs += dur;
        }
      }
    }

    // Enrich observed tokens from dedicated Hermes SQLite profile DBs when `--quiet` runs record tokens in state.db
    if (Array.isArray(mappedAgents) && mappedAgents.length > 0) {
      try {
        const { DatabaseSync } = require("node:sqlite");
        const profilesRoot = path.join(
          process.env.ALLINONE_HERMES_HOME || path.join(require("os").homedir(), "AppData", "Local", "hermes"),
          "profiles"
        );
        let sqliteFleetTokens = 0;
        for (const ag of mappedAgents) {
          if (!ag?.runtime_profile_reference) continue;
          const dbFile = path.join(profilesRoot, ag.runtime_profile_reference, "state.db");
          if (!fs.existsSync(dbFile)) continue;
          const db = new DatabaseSync(dbFile, { open: true, readOnly: true });
          try {
            const agg = db
              .prepare(
                "SELECT COUNT(*) as c, COALESCE(SUM(input_tokens),0) as inp, COALESCE(SUM(output_tokens),0) as outp, COALESCE(SUM(cache_read_tokens),0) as cr, COALESCE(SUM(cache_write_tokens),0) as cw FROM sessions"
              )
              .get();
            const inT = Number(agg?.inp) || 0;
            const outT = Number(agg?.outp) || 0;
            const cacheT = (Number(agg?.cr) || 0) + (Number(agg?.cw) || 0);
            const sumT = inT + outT + cacheT;
            if (sumT > 0) {
              const aid = ag.paperclip_agent_id;
              if (!usageByAgent[aid]) {
                usageByAgent[aid] = {
                  agent_id: aid,
                  run_count: Number(agg?.c) || 0,
                  succeeded_runs: Number(agg?.c) || 0,
                  failed_runs: 0,
                  cancelled_runs: 0,
                  input_tokens: 0,
                  output_tokens: 0,
                  total_tokens: 0,
                  total_duration_ms: 0,
                  cost_usd: null,
                  cost_label: "COST UNKNOWN",
                  usage_classification: "UNPRICED USAGE",
                };
              }
              if (usageByAgent[aid].total_tokens < sumT) {
                usageByAgent[aid].input_tokens = inT;
                usageByAgent[aid].output_tokens = outT;
                usageByAgent[aid].total_tokens = sumT;
              }
              sqliteFleetTokens += sumT;
            }
          } finally {
            db.close();
          }
        }
        if (sqliteFleetTokens > totalTokens) {
          totalTokens = sqliteFleetTokens;
        }
      } catch {
        // non-fatal fallback
      }
    }

    return {
      provider_model: "combo/X",
      cost_transparency_status: "COST UNKNOWN",
      usage_mode_label: "UNPRICED USAGE",
      total_observed_tokens: totalTokens,
      total_execution_duration_ms: totalDurationMs,
      paused_agent_count: budgetOverview?.pausedAgentCount ?? 0,
      pending_approval_count: budgetOverview?.pendingApprovalCount ?? 0,
      active_incidents: sanitizePayload(budgetOverview?.activeIncidents || []),
      policies: formattedPolicies,
      per_agent_usage: usageByAgent,
    };
  }

  /**
   * Fetch sanitized run events/log excerpt for an active or completed run to prove tool/test/build execution.
   */
  async getVerifiedRunDetails(runId) {
    if (!runId) return { events: [], logExcerpt: "", evidence: { verifiedToolKind: null, verifiedTools: [] } };
    const cached = this.runEvidenceCache.get(runId);
    if (cached && Date.now() - cached.at < 2500) {
      return cached.value;
    }

    const [eventsRes, logRes] = await Promise.all([
      this.request("GET", `/api/heartbeat-runs/${encodeURIComponent(runId)}/events`),
      this.request("GET", `/api/heartbeat-runs/${encodeURIComponent(runId)}/log`),
    ]);

    const events = Array.isArray(eventsRes.data) ? eventsRes.data : eventsRes.data?.events || [];
    let logText = "";
    if (typeof logRes.data === "string") {
      logText = logRes.data;
    } else if (logRes.data && typeof logRes.data === "object") {
      logText = String(logRes.data.content || logRes.data.log || JSON.stringify(logRes.data));
    }
    const combinedForDetection = [
      logText,
      ...events.map((e) => (typeof e === "string" ? e : JSON.stringify(e))),
    ].join("\n");

    const sanitizedExcerpt = sanitizeText(combinedForDetection.slice(-4000));
    const evidence = inspectRunEvidenceText(sanitizedExcerpt);
    const value = {
      events: sanitizePayload(events.slice(-40)),
      logExcerpt: sanitizedExcerpt,
      evidence,
    };
    this.runEvidenceCache.set(runId, { at: Date.now(), value });
    if (this.runEvidenceCache.size > 200) {
      const firstKey = this.runEvidenceCache.keys().next().value;
      if (firstKey) this.runEvidenceCache.delete(firstKey);
    }
    return value;
  }

  /**
   * Provision or reuse an unscoped Paperclip agent key solely for subscribing to
   * Paperclip's native `ws://127.0.0.1:3100/api/companies/:companyId/events/ws` live stream.
   */
  async ensureLiveEventsWsToken(companyId, ceoAgentId) {
    if (fs.existsSync(OBSERVER_KEY_CACHE_PATH)) {
      try {
        const cached = JSON.parse(fs.readFileSync(OBSERVER_KEY_CACHE_PATH, "utf8"));
        if (cached && cached.companyId === companyId && typeof cached.token === "string" && cached.token.length > 10) {
          return cached.token;
        }
      } catch {
        // recreate below
      }
    }
    if (!ceoAgentId) return null;
    const created = await this.must("POST", `/api/agents/${encodeURIComponent(ceoAgentId)}/keys`, {
      name: "office-bridge-live-ws-observer",
    });
    const token = created?.token || created?.key || null;
    if (token) {
      fs.mkdirSync(path.dirname(OBSERVER_KEY_CACHE_PATH), { recursive: true });
      fs.writeFileSync(
        OBSERVER_KEY_CACHE_PATH,
        JSON.stringify({ companyId, agentId: ceoAgentId, keyId: created.id, token, createdAt: new Date().toISOString() }, null, 2) + "\n",
        "utf8"
      );
    }
    return token;
  }

  // --- Authorized Mutations via Official Paperclip APIs ---

  async ensureProject(companyId, projectName) {
    const cleanName = sanitizeText(String(projectName || "").trim()).slice(0, 100);
    if (!cleanName) return null;
    const existing = (await this.must("GET", `/api/companies/${encodeURIComponent(companyId)}/projects`).catch(() => [])) || [];
    const found = existing.find((p) => String(p.name || "").toLowerCase() === cleanName.toLowerCase());
    if (found) return sanitizePayload(found);
    return sanitizePayload(
      await this.must("POST", `/api/companies/${encodeURIComponent(companyId)}/projects`, {
        name: cleanName,
        status: "in_progress",
      })
    );
  }

  async createTask(companyId, payload, idempotencyKey = null) {
    const hdrs = {};
    if (idempotencyKey) {
      hdrs["Idempotency-Key"] = crypto.createHash("sha256").update(String(idempotencyKey)).digest("hex").slice(0, 32);
    }
    const cleanPayload = {
      title: sanitizeText(String(payload.title || "").trim()).slice(0, 200),
      description: sanitizeText(String(payload.description || "").trim()),
      status: payload.status || "todo",
      priority: ["critical", "high", "medium", "low"].includes(payload.priority) ? payload.priority : "medium",
    };
    if (payload.assigneeAgentId) cleanPayload.assigneeAgentId = String(payload.assigneeAgentId);
    if (payload.projectId) cleanPayload.projectId = String(payload.projectId);
    if (payload.parentId) cleanPayload.parentId = String(payload.parentId);
    if (cleanPayload.status === "blocked" && payload.unblockDescriptor) {
      cleanPayload.unblockDescriptor = payload.unblockDescriptor;
    }
    return sanitizePayload(await this.must("POST", `/api/companies/${encodeURIComponent(companyId)}/issues`, cleanPayload, hdrs));
  }

  async updateTask(issueId, patch) {
    const cleanPatch = {};
    if (patch.status) cleanPatch.status = String(patch.status);
    if (patch.priority) cleanPatch.priority = String(patch.priority);
    if (patch.assigneeAgentId !== undefined) cleanPatch.assigneeAgentId = patch.assigneeAgentId;
    if (patch.title) cleanPatch.title = sanitizeText(String(patch.title)).slice(0, 200);
    if (patch.description !== undefined) cleanPatch.description = sanitizeText(String(patch.description));
    if (cleanPatch.status === "blocked") {
      cleanPatch.unblockDescriptor = patch.unblockDescriptor || {
        kind: "manual_gate",
        reason: sanitizeText(patch.blockReason || "Awaiting owner review or prerequisite completion"),
      };
    }
    return sanitizePayload(await this.must("PATCH", `/api/issues/${encodeURIComponent(issueId)}`, cleanPatch));
  }

  async addTaskComment(issueId, bodyText) {
    const safeBody = sanitizeText(String(bodyText || "").trim());
    return sanitizePayload(await this.must("POST", `/api/issues/${encodeURIComponent(issueId)}/comments`, { body: safeBody }));
  }

  async getTaskDetail(issueId) {
    const [issue, comments, runsRes] = await Promise.all([
      this.must("GET", `/api/issues/${encodeURIComponent(issueId)}`),
      this.must("GET", `/api/issues/${encodeURIComponent(issueId)}/comments`).catch(() => []),
      this.must("GET", `/api/issues/${encodeURIComponent(issueId)}/live-runs`).catch(() => []),
    ]);
    return {
      issue: sanitizePayload(issue),
      comments: sanitizePayload(comments),
      liveRuns: sanitizePayload(runsRes),
    };
  }

  async pauseAgent(agentId) {
    const res = await this.request("POST", `/api/agents/${encodeURIComponent(agentId)}/pause`, {});
    if (!res.ok && res.status !== 409) {
      throw new Error(`Pause agent failed (${res.status})`);
    }
    clearWindowsTerminalRunHolds();
    let latest = await this.must("GET", `/api/agents/${encodeURIComponent(agentId)}`);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && latest.lifecycleState === "pausing") {
      clearWindowsTerminalRunHolds();
      await new Promise((r) => setTimeout(r, 350));
      latest = await this.must("GET", `/api/agents/${encodeURIComponent(agentId)}`);
    }
    return sanitizePayload(latest);
  }

  async resumeAgent(agentId) {
    clearWindowsTerminalRunHolds();
    let cur = await this.must("GET", `/api/agents/${encodeURIComponent(agentId)}`);
    const waitSettle = Date.now() + 6000;
    while (Date.now() < waitSettle && cur.lifecycleState === "pausing") {
      clearWindowsTerminalRunHolds();
      await new Promise((r) => setTimeout(r, 350));
      cur = await this.must("GET", `/api/agents/${encodeURIComponent(agentId)}`);
    }
    const res = await this.request("POST", `/api/agents/${encodeURIComponent(agentId)}/resume`, {});
    if (!res.ok && res.status !== 409) {
      throw new Error(`Resume agent failed (${res.status})`);
    }
    let latest = await this.must("GET", `/api/agents/${encodeURIComponent(agentId)}`);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && (latest.status === "paused" || latest.lifecycleState === "pausing")) {
      clearWindowsTerminalRunHolds();
      await new Promise((r) => setTimeout(r, 350));
      await this.request("POST", `/api/agents/${encodeURIComponent(agentId)}/resume`, {}).catch(() => {});
      latest = await this.must("GET", `/api/agents/${encodeURIComponent(agentId)}`);
    }
    return sanitizePayload(latest);
  }

  async wakeAgent(agentId, reason = "office_dispatch", contextSnapshot = {}) {
    return sanitizePayload(
      await this.must("POST", `/api/agents/${encodeURIComponent(agentId)}/wakeup`, {
        source: "on_demand",
        triggerDetail: "manual",
        reason,
        contextSnapshot: sanitizePayload(contextSnapshot),
      })
    );
  }

  async cancelRun(runId) {
    const res = await this.request("POST", `/api/heartbeat-runs/${encodeURIComponent(runId)}/cancel`, {});
    if (!res.ok && res.status !== 409) {
      throw new Error(`Cancel run failed (${res.status})`);
    }
    return sanitizePayload(await this.must("GET", `/api/heartbeat-runs/${encodeURIComponent(runId)}`));
  }

  async resolveApproval(approvalId, decision, note = "") {
    const action = decision === "approve" ? "approve" : "reject";
    return sanitizePayload(
      await this.must("POST", `/api/approvals/${encodeURIComponent(approvalId)}/${action}`, {
        decisionNote: sanitizeText(note || `Resolved by Owner via Hermes3D Virtual Office (${action}).`),
      })
    );
  }
}

module.exports = {
  PaperclipRuntimeAdapter,
  inspectRunEvidenceText,
};
