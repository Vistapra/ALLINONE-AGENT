"use strict";

/**
 * Phase 24, 27, 29 & 31 — Unified Real-Time Synchronizer.
 *
 * Bridges:
 *   - Native Paperclip Live Events WebSocket (`ws://127.0.0.1:3100/api/companies/:companyId/events/ws`)
 *   - Bounded Paperclip REST delta reconciliation (agents, issues, live-runs, heartbeat-runs, approvals)
 *   - Defensive VulnClaw SQLite findings (`findings.db`)
 *   - Central Workflow Ledger (`workflow-ledger.db`)
 *   - Maintenance Coordinator lock & state (`maintenance.lock`, `state.json`)
 *
 * Produces:
 *   - Normalized schema v1.0 events on `NormalizedEventBus`
 *   - Live 6-dimensional `AgentStateMachine` snapshots for all 11+ company agents
 *   - Verified Multi-Agent Collaboration & Delegation graph
 *   - Deduplicated Office -> Telegram completion notifications
 */

const fs = require("node:fs");
const path = require("node:path");
const { loadWsModule } = require("../contracts/ws-loader");
const { computeAgentStateDimensions } = require("../contracts/state-machine");
const { sanitizePayload, sanitizeText } = require("../contracts/redaction");
const ALLINONE_HOME = process.env.ALLINONE_HOME || require("os").homedir() + "/ALLINONE-AGENT";

const {
  readFindingsSnapshot,
  readWorkflowLedgerSnapshot,
  readMaintenanceSnapshot,
  sendTelegramNotificationViaExistingBridge,
} = require("../adapters/vulnclaw-findings-adapter");

const NOTIFIED_FILE = path.resolve(`${ALLINONE_HOME}\\office-data\\event-history\\notified-completions.json`);
const MEETINGS_FILE = path.resolve(`${ALLINONE_HOME}\\office-data\\event-history\\meetings.json`);
const STUDIO_STANDUP_STORE_FILE = path.resolve(
  `${ALLINONE_HOME}\\office-data\\studio-state\\hermes3d\\standup-store.json`
);

function buildRoleMeetingFocus(agentObj, agendaText) {
  const shortAgenda = sanitizeText(String(agendaText || "Sinkronisasi proyek")).slice(0, 90);
  const name = String(agentObj?.display_name || "Agent");
  const norm = name.toLowerCase();
  if (norm.includes("ceo")) return `Memimpin rapat, menetapkan prioritas & pembagian tugas: ${shortAgenda}`;
  if (norm.includes("cto")) return `Meninjau arsitektur sistem, modularitas & standar teknis: ${shortAgenda}`;
  if (norm.includes("backend")) return `Menganalisis endpoint API, controller, skema database & performa: ${shortAgenda}`;
  if (norm.includes("frontend")) return `Memeriksa kontrak integrasi UI/klien & kompatibilitas respons API: ${shortAgenda}`;
  if (norm.includes("devops")) return `Memeriksa konfigurasi deployment, skrip otomasi & kesiapan runtime: ${shortAgenda}`;
  if (norm.includes("qa")) return `Menyusun cakupan pengujian regresi, PHPUnit/unit test & validasi kualitas: ${shortAgenda}`;
  if (norm.includes("security lead")) return `Menetapkan kebijakan keamanan defensif, autentikasi & kontrol akses: ${shortAgenda}`;
  if (norm.includes("security reviewer")) return `Melakukan audit kode statis defensif & pemeriksaan celah keamanan: ${shortAgenda}`;
  if (norm.includes("findings")) return `Mengklasifikasi & mendeduplikasi temuan risiko secara terstruktur: ${shortAgenda}`;
  if (norm.includes("remediation")) return `Memverifikasi rencana mitigasi & pencegahan regresi keamanan: ${shortAgenda}`;
  if (norm.includes("compliance") || norm.includes("report")) return `Menyusun laporan eksekutif, bukti audit & kepatuhan kriteria penerimaan: ${shortAgenda}`;
  return `Berkolaborasi pada agenda: ${shortAgenda}`;
}

function writeHermes3dStandupStore(activeMeetingObj) {
  try {
    fs.mkdirSync(path.dirname(STUDIO_STANDUP_STORE_FILE), { recursive: true });
    let lastMeeting = null;
    if (fs.existsSync(STUDIO_STANDUP_STORE_FILE)) {
      try {
        const prev = JSON.parse(fs.readFileSync(STUDIO_STANDUP_STORE_FILE, "utf8"));
        lastMeeting = prev?.lastMeeting || prev?.activeMeeting || null;
      } catch {}
    }
    const nextStore = {
      activeMeeting: activeMeetingObj,
      lastMeeting: activeMeetingObj || lastMeeting,
    };
    fs.writeFileSync(STUDIO_STANDUP_STORE_FILE, JSON.stringify(nextStore, null, 2) + "\n", "utf8");
  } catch {}
}

function loadJsonSet(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const arr = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch {}
  return new Set();
}

function saveJsonSet(filePath, setObj) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const arr = [...setObj].slice(-500);
    fs.writeFileSync(filePath, JSON.stringify(arr, null, 2) + "\n", "utf8");
  } catch {}
}

function loadMeetingsList() {
  try {
    if (fs.existsSync(MEETINGS_FILE)) {
      const arr = JSON.parse(fs.readFileSync(MEETINGS_FILE, "utf8"));
      if (Array.isArray(arr)) return arr;
    }
  } catch {}
  return [];
}

function saveMeetingsList(meetings) {
  try {
    fs.mkdirSync(path.dirname(MEETINGS_FILE), { recursive: true });
    fs.writeFileSync(MEETINGS_FILE, JSON.stringify(meetings.slice(-100), null, 2) + "\n", "utf8");
  } catch {}
}

class RealtimeSynchronizer {
  /**
   * @param {{
   *   paperclip: import("../adapters/paperclip-adapter").PaperclipRuntimeAdapter,
   *   eventBus: import("../contracts/event-schema").NormalizedEventBus,
   *   pollIntervalMs?: number,
   * }} opts
   */
  constructor(opts) {
    this.paperclip = opts.paperclip;
    this.eventBus = opts.eventBus;
    this.pollIntervalMs = opts.pollIntervalMs || 3000;

    this.running = false;
    this.pollTimer = null;
    this.reconciling = false;

    this.upstreamWs = null;
    this.upstreamWsConnected = false;
    this.upstreamBackoffIdx = 0;
    this.upstreamReconnectTimer = null;

    // Latest reconciled truth snapshot
    this.lastGoodSnapshotAtMs = 0;
    this.paperclipReachable = false;
    this.hermesReachable = true;
    this.company = null;
    this.departments = [];
    this.orgTree = [];
    this.agentsById = new Map();
    this.agentStatesById = new Map();
    this.issuesById = new Map();
    this.runsById = new Map();
    this.approvalsById = new Map();
    this.findingsById = new Map();
    this.projects = [];
    this.budgetOverview = null;
    this.findingsSnapshot = { available: false, summary: {}, findings: [], timeline: [] };
    this.workflowSnapshot = { available: false, tasks: [], byIssueId: {} };
    this.maintenanceSnapshot = { lock_active: false, draining: false, maintenance_active: false, state: {} };
    this.collaborationEdges = [];
    this.meetings = loadMeetingsList();

    // Tracking office-created tasks for bidirectional Telegram completion notification
    this.officeTrackedIssueIds = new Set();
    this.notifiedCompletionKeys = loadJsonSet(NOTIFIED_FILE);
    this.hermesGatewayListeners = new Set();
  }

  onHermesGatewayFrame(fn) {
    this.hermesGatewayListeners.add(fn);
    return () => this.hermesGatewayListeners.delete(fn);
  }

  _emitHermesGatewayFrame(frame) {
    for (const fn of this.hermesGatewayListeners) {
      try {
        fn(frame);
      } catch {}
    }
  }

  trackOfficeCreatedTask(issueId, correlationId = null, notifyTelegramOnComplete = true) {
    if (!issueId) return;
    if (notifyTelegramOnComplete) {
      this.officeTrackedIssueIds.add(String(issueId));
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await this.reconcileNow("initial_boot");
    this._connectUpstreamPaperclipWs();
    this.pollTimer = setInterval(() => {
      this.reconcileNow("periodic_poll").catch(() => {});
    }, this.pollIntervalMs);
    if (this.pollTimer.unref) this.pollTimer.unref();
  }

  stop() {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.upstreamReconnectTimer) {
      clearTimeout(this.upstreamReconnectTimer);
      this.upstreamReconnectTimer = null;
    }
    if (this.upstreamWs) {
      try {
        this.upstreamWs.terminate();
      } catch {}
      this.upstreamWs = null;
    }
  }

  async _connectUpstreamPaperclipWs() {
    if (!this.running) return;
    try {
      const company = this.company || (await this.paperclip.getPrimaryCompany());
      const ceo = [...this.agentsById.values()].find((a) => a.role === "ceo") || [...this.agentsById.values()][0];
      if (!company || !ceo) {
        this._scheduleWsReconnect();
        return;
      }
      const wsToken = await this.paperclip.ensureLiveEventsWsToken(company.id, ceo.paperclip_agent_id);
      if (!wsToken) {
        this._scheduleWsReconnect();
        return;
      }

      const { WebSocket } = loadWsModule();
      const wsUrl = `ws://127.0.0.1:3100/api/companies/${encodeURIComponent(company.id)}/events/ws`;
      const ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${wsToken}`,
          Origin: "http://127.0.0.1:3100",
        },
      });
      this.upstreamWs = ws;

      ws.on("open", () => {
        this.upstreamWsConnected = true;
        this.upstreamBackoffIdx = 0;
        this.eventBus.publish({
          event_type: "runtime.connected",
          source: "office_bridge",
          company_id: company.id,
          dedupe_key: `ws_up_conn:${Math.floor(Date.now() / 5000)}`,
          payload: { upstream: "paperclip_live_events_ws", url: wsUrl },
        });
      });

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString("utf8"));
          this._handleNativePaperclipLiveEvent(msg);
        } catch {}
      });

      ws.on("close", () => {
        const wasConnected = this.upstreamWsConnected;
        this.upstreamWsConnected = false;
        this.upstreamWs = null;
        if (wasConnected && this.company) {
          this.eventBus.publish({
            event_type: "runtime.disconnected",
            source: "office_bridge",
            company_id: this.company.id,
            payload: { upstream: "paperclip_live_events_ws", reason: "socket_closed" },
          });
        }
        this._scheduleWsReconnect();
      });

      ws.on("error", () => {
        // handled by close
      });
    } catch {
      this._scheduleWsReconnect();
    }
  }

  _scheduleWsReconnect() {
    if (!this.running || this.upstreamReconnectTimer) return;
    const delays = [1500, 3000, 6000, 12_000, 25_000];
    const waitMs = delays[Math.min(this.upstreamBackoffIdx, delays.length - 1)];
    this.upstreamBackoffIdx += 1;
    this.upstreamReconnectTimer = setTimeout(() => {
      this.upstreamReconnectTimer = null;
      this._connectUpstreamPaperclipWs();
    }, waitMs);
    if (this.upstreamReconnectTimer.unref) this.upstreamReconnectTimer.unref();
  }

  _handleNativePaperclipLiveEvent(liveEvt) {
    if (!liveEvt || typeof liveEvt !== "object") return;
    // Trigger immediate reconciliation whenever Paperclip pushes a live event!
    this.reconcileNow(`native_ws:${liveEvt.type || "event"}`).catch(() => {});
  }

  async reconcileNow(triggerReason = "manual") {
    if (this._inFlightReconcile) {
      await this._inFlightReconcile.catch(() => {});
      if (triggerReason === "poll" || triggerReason.startsWith("native_ws:")) {
        return;
      }
    }
    this.reconciling = true;
    this._inFlightReconcile = this._runReconcilePass(triggerReason).finally(() => {
      this.reconciling = false;
      this._inFlightReconcile = null;
    });
    return this._inFlightReconcile;
  }

  async _runReconcilePass(triggerReason = "manual") {
    const nowMs = Date.now();

    try {
      // 1. Read local SQLite defensive findings, workflow ledger & maintenance state
      const prevMaintActive = this.maintenanceSnapshot.maintenance_active;
      this.maintenanceSnapshot = readMaintenanceSnapshot();
      if (!prevMaintActive && this.maintenanceSnapshot.maintenance_active && this.company) {
        this.eventBus.publish({
          event_type: "maintenance.started",
          source: "maintenance_coordinator",
          company_id: this.company.id,
          dedupe_key: `maint_start:${this.maintenanceSnapshot.state?.updated_at || Math.floor(nowMs / 10000)}`,
          payload: { state: this.maintenanceSnapshot.state?.state || "MAINTENANCE_ACTIVE" },
        });
      } else if (prevMaintActive && !this.maintenanceSnapshot.maintenance_active && this.company) {
        this.eventBus.publish({
          event_type: "maintenance.completed",
          source: "maintenance_coordinator",
          company_id: this.company.id,
          dedupe_key: `maint_done:${this.maintenanceSnapshot.state?.updated_at || Math.floor(nowMs / 10000)}`,
          payload: { result: this.maintenanceSnapshot.state?.last_result || "completed" },
        });
      }

      this.findingsSnapshot = readFindingsSnapshot();
      this.workflowSnapshot = readWorkflowLedgerSnapshot();

      // 2. Query Paperclip Official Snapshot
      const snap = await this.paperclip.getOrganizationSnapshot();
      const wasReachable = this.paperclipReachable;
      this.paperclipReachable = true;
      this.lastGoodSnapshotAtMs = nowMs;
      this.company = snap.company;
      this.departments = snap.departments;
      this.orgTree = snap.orgTree;
      this.projects = snap.projects;
      this.budgetOverview = snap.budgetOverview;

      if (!wasReachable) {
        this.eventBus.publish({
          event_type: "runtime.connected",
          source: "paperclip",
          company_id: snap.company.id,
          dedupe_key: `pc_online:${Math.floor(nowMs / 10000)}`,
          payload: { trigger: triggerReason, company_name: snap.company.name },
        });
      }

      // 3. Diff Findings -> Normalized Events
      for (const f of this.findingsSnapshot.findings || []) {
        const prevF = this.findingsById.get(f.finding_id);
        if (!prevF) {
          this.findingsById.set(f.finding_id, f);
          if (triggerReason !== "initial_boot") {
            this.eventBus.publish({
              event_type: "finding.imported",
              source: "vulnclaw_findings",
              company_id: snap.company.id,
              task_id: f.paperclip_review_issue_id || null,
              dedupe_key: `finding_imp:${f.finding_id}`,
              timestamp: f.created_at,
              payload: {
                finding_id: f.finding_id,
                severity: f.severity,
                title: f.finding_title,
                status: f.verification_status,
              },
            });
          }
        } else if (prevF.verification_status !== f.verification_status) {
          this.findingsById.set(f.finding_id, f);
          const evType =
            f.verification_status === "RESOLVED"
              ? "finding.resolved"
              : f.verification_status === "CONFIRMED" || f.verification_status === "REMEDIATION_REQUIRED"
                ? "finding.confirmed"
                : "finding.imported";
          this.eventBus.publish({
            event_type: evType,
            source: "vulnclaw_findings",
            company_id: snap.company.id,
            task_id: f.paperclip_remediation_issue_id || f.paperclip_review_issue_id || null,
            dedupe_key: `finding_st:${f.finding_id}:${f.verification_status}:${f.updated_at}`,
            timestamp: f.updated_at,
            payload: {
              finding_id: f.finding_id,
              from_status: prevF.verification_status,
              to_status: f.verification_status,
              severity: f.severity,
            },
          });
        }
      }

      // 4. Diff Approvals -> Normalized Events
      const nextApprovalsMap = new Map();
      for (const ap of snap.approvals || []) {
        if (!ap || !ap.id) continue;
        nextApprovalsMap.set(ap.id, ap);
        const prevAp = this.approvalsById.get(ap.id);
        if (!prevAp) {
          if (triggerReason !== "initial_boot" && ap.status === "pending") {
            this.eventBus.publish({
              event_type: "approval.requested",
              source: "paperclip",
              company_id: snap.company.id,
              agent_id: ap.requestedByAgentId || null,
              dedupe_key: `appr_req:${ap.id}`,
              timestamp: ap.createdAt,
              payload: { approval_id: ap.id, type: ap.type, status: ap.status },
            });
          }
        } else if (prevAp.status !== ap.status && ap.status !== "pending") {
          this.eventBus.publish({
            event_type: "approval.resolved",
            source: "paperclip",
            company_id: snap.company.id,
            agent_id: ap.requestedByAgentId || null,
            dedupe_key: `appr_res:${ap.id}:${ap.status}`,
            timestamp: ap.decidedAt || ap.updatedAt,
            payload: { approval_id: ap.id, from_status: prevAp.status, to_status: ap.status },
          });
        }
      }
      this.approvalsById = nextApprovalsMap;

      // 5. Diff Issues / Tasks -> Normalized Events & Outbound Telegram Sync
      const nextIssuesMap = new Map();
      for (const issue of snap.issues || []) {
        if (!issue || !issue.id) continue;
        nextIssuesMap.set(issue.id, issue);
        const prevIssue = this.issuesById.get(issue.id);
        const ledgerRow = this.workflowSnapshot.byIssueId[issue.id] || null;
        const corrId = ledgerRow?.task_uuid || issue.identifier || issue.id;

        if (!prevIssue) {
          if (triggerReason !== "initial_boot") {
            this.eventBus.publish({
              event_type: "task.created",
              source: "paperclip",
              company_id: snap.company.id,
              agent_id: issue.assigneeAgentId || null,
              task_id: issue.id,
              correlation_id: corrId,
              dedupe_key: `task_new:${issue.id}`,
              timestamp: issue.createdAt,
              payload: {
                identifier: issue.identifier,
                title: issue.title,
                status: issue.status,
                parent_id: issue.parentId || null,
              },
            });
            if (issue.parentId && issue.assigneeAgentId) {
              this.eventBus.publish({
                event_type: "task.delegated",
                source: "paperclip",
                company_id: snap.company.id,
                agent_id: issue.assigneeAgentId,
                task_id: issue.id,
                correlation_id: corrId,
                dedupe_key: `task_del:${issue.id}:${issue.assigneeAgentId}`,
                timestamp: issue.createdAt,
                payload: {
                  parent_task_id: issue.parentId,
                  child_task_id: issue.id,
                  identifier: issue.identifier,
                  assignee_agent_id: issue.assigneeAgentId,
                },
              });
            } else if (issue.assigneeAgentId) {
              this.eventBus.publish({
                event_type: "task.assigned",
                source: "paperclip",
                company_id: snap.company.id,
                agent_id: issue.assigneeAgentId,
                task_id: issue.id,
                correlation_id: corrId,
                dedupe_key: `task_asg:${issue.id}:${issue.assigneeAgentId}`,
                timestamp: issue.updatedAt || issue.createdAt,
                payload: { identifier: issue.identifier, title: issue.title },
              });
            }
          }
        } else {
          if (prevIssue.assigneeAgentId !== issue.assigneeAgentId && issue.assigneeAgentId) {
            this.eventBus.publish({
              event_type: issue.parentId ? "task.delegated" : "task.assigned",
              source: "paperclip",
              company_id: snap.company.id,
              agent_id: issue.assigneeAgentId,
              task_id: issue.id,
              correlation_id: corrId,
              dedupe_key: `task_reasg:${issue.id}:${issue.assigneeAgentId}:${issue.updatedAt}`,
              timestamp: issue.updatedAt,
              payload: {
                identifier: issue.identifier,
                title: issue.title,
                parent_id: issue.parentId || null,
              },
            });
          }
          if (prevIssue.status !== issue.status) {
            const st = String(issue.status || "").toLowerCase();
            let evType = "task.updated";
            if (st === "in_progress") evType = "task.started";
            else if (st === "blocked") evType = "task.blocked";
            else if (st === "done") evType = "task.completed";
            else if (st === "cancelled" || st === "canceled") evType = "task.cancelled";

            this.eventBus.publish({
              event_type: evType,
              source: "paperclip",
              company_id: snap.company.id,
              agent_id: issue.assigneeAgentId || null,
              task_id: issue.id,
              correlation_id: corrId,
              dedupe_key: `task_st:${issue.id}:${st}:${issue.updatedAt}`,
              timestamp: issue.updatedAt,
              payload: {
                identifier: issue.identifier,
                title: issue.title,
                from_status: prevIssue.status,
                to_status: issue.status,
              },
            });

            // Bidirectional Sync: if an Office-created task completes, send deduplicated Telegram summary
            if (st === "done" && this.officeTrackedIssueIds.has(issue.id)) {
              const notifyKey = `done:${issue.id}`;
              if (!this.notifiedCompletionKeys.has(notifyKey)) {
                this.notifiedCompletionKeys.add(notifyKey);
                saveJsonSet(NOTIFIED_FILE, this.notifiedCompletionKeys);
                const msg = `[Hermes3D Virtual Office] Task ${issue.identifier || issue.id} selesai (DONE): ${issue.title}`;
                sendTelegramNotificationViaExistingBridge(msg, corrId).catch(() => {});
              }
            }
          }
        }
      }
      this.issuesById = nextIssuesMap;

      // 6. Diff Runs + Inspect Verified Tool/Build/Test Evidence on Active Runs
      const allRuns = [...(snap.liveRuns || []), ...(snap.recentRuns || [])];
      const activeRunByAgentId = new Map();
      const latestRunByAgentId = new Map();
      const verifiedEvidenceByAgentId = new Map();

      for (const run of allRuns) {
        if (!run || !run.id) continue;
        const st = String(run.status || "").toLowerCase();
        const isLive = st === "running" || st === "queued";
        if (isLive && run.agentId && !activeRunByAgentId.has(run.agentId)) {
          activeRunByAgentId.set(run.agentId, run);
        }
        if (run.agentId && !latestRunByAgentId.has(run.agentId)) {
          latestRunByAgentId.set(run.agentId, run);
        }

        const prevRun = this.runsById.get(run.id);
        const taskId = run.contextSnapshot?.issueId || run.contextSnapshot?.taskId || run.issueId || null;

        if (!prevRun) {
          this.runsById.set(run.id, run);
          if (triggerReason !== "initial_boot") {
            const evType =
              isLive
                ? "run.started"
                : st === "succeeded"
                  ? "run.completed"
                  : st === "cancelled" || st === "canceled"
                    ? "run.cancelled"
                    : "run.failed";
            this.eventBus.publish({
              event_type: evType,
              source: "hermes",
              company_id: snap.company.id,
              agent_id: run.agentId || null,
              task_id: taskId,
              run_id: run.id,
              dedupe_key: `run_init:${run.id}:${st}`,
              timestamp: run.startedAt || run.createdAt,
              payload: { status: run.status, exit_code: run.exitCode ?? null },
            });
            this._emitHermesGatewayFrame({
              type: "event",
              event: "agent",
              payload: {
                runId: run.id,
                sessionKey: `agent:${run.agentId}:main`,
                stream: "lifecycle",
                data: { phase: isLive ? "start" : st === "succeeded" ? "end" : "error" },
              },
            });
          }
        } else if (prevRun.status !== run.status) {
          this.runsById.set(run.id, run);
          let evType = "run.heartbeat";
          if (st === "running") evType = "run.started";
          else if (st === "succeeded") evType = "run.completed";
          else if (st === "cancelled" || st === "canceled") evType = "run.cancelled";
          else if (st === "failed" || st === "timed_out") evType = "run.failed";

          this.eventBus.publish({
            event_type: evType,
            source: "hermes",
            company_id: snap.company.id,
            agent_id: run.agentId || null,
            task_id: taskId,
            run_id: run.id,
            dedupe_key: `run_st:${run.id}:${st}`,
            timestamp: run.finishedAt || run.updatedAt || new Date().toISOString(),
            payload: { from_status: prevRun.status, to_status: run.status, exit_code: run.exitCode ?? null },
          });

          this._emitHermesGatewayFrame({
            type: "event",
            event: "agent",
            payload: {
              runId: run.id,
              sessionKey: `agent:${run.agentId}:main`,
              stream: "lifecycle",
              data: { phase: st === "running" ? "start" : st === "succeeded" ? "end" : "error" },
            },
          });
        }

        // For live runs, fetch real run events/logs to detect verified tool/build/test execution
        if (isLive && run.agentId) {
          const details = await this.paperclip.getVerifiedRunDetails(run.id).catch(() => null);
          if (details && details.evidence) {
            verifiedEvidenceByAgentId.set(run.agentId, details.evidence);
            if (details.evidence.verifiedToolKind === "coding") {
              this.eventBus.publish({
                event_type: "tool.started",
                source: "hermes",
                company_id: snap.company.id,
                agent_id: run.agentId,
                task_id: taskId,
                run_id: run.id,
                dedupe_key: `tool_coding:${run.id}`,
                payload: { tool_category: "coding", verified_tools: details.evidence.verifiedTools },
              });
            } else if (details.evidence.verifiedToolKind === "testing") {
              this.eventBus.publish({
                event_type: "test.started",
                source: "hermes",
                company_id: snap.company.id,
                agent_id: run.agentId,
                task_id: taskId,
                run_id: run.id,
                dedupe_key: `test_run:${run.id}`,
                payload: { verified_tools: details.evidence.verifiedTools },
              });
            } else if (details.evidence.verifiedToolKind === "building") {
              this.eventBus.publish({
                event_type: "build.started",
                source: "hermes",
                company_id: snap.company.id,
                agent_id: run.agentId,
                task_id: taskId,
                run_id: run.id,
                dedupe_key: `build_run:${run.id}`,
                payload: { verified_tools: details.evidence.verifiedTools },
              });
            }
          }
        }
      }

      // 7. Build Real Collaboration Graph (Parent-Child Tasks + Security Findings -> Reviewer/Dev)
      const edges = [];
      const collaboratingAgentIds = new Set();
      for (const issue of nextIssuesMap.values()) {
        if (issue.parentId && nextIssuesMap.has(issue.parentId)) {
          const parent = nextIssuesMap.get(issue.parentId);
          const fromAgent = parent.assigneeAgentId || null;
          const toAgent = issue.assigneeAgentId || null;
          if (fromAgent && toAgent && fromAgent !== toAgent) {
            const isActiveEdge = ["todo", "in_progress", "in_review"].includes(String(issue.status || "").toLowerCase());
            edges.push({
              edge_id: `del-${parent.id.slice(0, 8)}-${issue.id.slice(0, 8)}`,
              kind: "task_delegation",
              from_agent_id: fromAgent,
              to_agent_id: toAgent,
              parent_task_id: parent.id,
              parent_identifier: parent.identifier,
              child_task_id: issue.id,
              child_identifier: issue.identifier,
              title: issue.title,
              status: issue.status,
              active: isActiveEdge,
            });
            if (isActiveEdge && String(issue.status).toLowerCase() === "in_review") {
              collaboratingAgentIds.add(fromAgent);
              collaboratingAgentIds.add(toAgent);
            }
          }
        }
      }
      // Active recent meetings (within 30 minutes) mark participants as collaborating
      for (const m of this.meetings) {
        const ageMs = m.created_at ? nowMs - Date.parse(m.created_at) : 0;
        if (m.status === "ACTIVE" && (!Number.isFinite(ageMs) || ageMs <= 30 * 60 * 1000)) {
          for (const pid of m.participant_agent_ids || []) {
            collaboratingAgentIds.add(pid);
          }
        }
      }
      this.collaborationEdges = edges;

      // 8. Reconcile Canonical Agents & Compute 6-Dimensional State Machine
      const nextAgentsMap = new Map();
      const nextStatesMap = new Map();
      const pendingApprovalAgentIds = new Set(
        [...this.approvalsById.values()]
          .filter((a) => a.status === "pending" && a.requestedByAgentId)
          .map((a) => a.requestedByAgentId)
      );

      for (const mappedAgent of snap.agents) {
        const aid = mappedAgent.paperclip_agent_id;
        const prevAgent = this.agentsById.get(aid);

        if (!prevAgent) {
          this.eventBus.publish({
            event_type: "agent.discovered",
            source: "paperclip",
            company_id: snap.company.id,
            agent_id: aid,
            dedupe_key: `agent_disc:${aid}`,
            payload: {
              display_name: mappedAgent.display_name,
              department: mappedAgent.department,
              role: mappedAgent.role,
              activation_status: mappedAgent.activation_status,
            },
          });
        } else if (prevAgent.activation_status !== mappedAgent.activation_status) {
          this.eventBus.publish({
            event_type: mappedAgent.activation_status === "ACTIVE" ? "agent.activated" : "agent.paused",
            source: "paperclip",
            company_id: snap.company.id,
            agent_id: aid,
            dedupe_key: `agent_act:${aid}:${mappedAgent.activation_status}:${nowMs}`,
            payload: {
              display_name: mappedAgent.display_name,
              from_activation: prevAgent.activation_status,
              to_activation: mappedAgent.activation_status,
            },
          });
        }

        // Determine agent's current highest-priority active/assigned issue
        const agentIssues = [...nextIssuesMap.values()].filter((iss) => iss.assigneeAgentId === aid);
        const currentIssue =
          agentIssues.find((i) => i.status === "in_progress") ||
          agentIssues.find((i) => i.status === "in_review") ||
          agentIssues.find((i) => i.status === "blocked") ||
          agentIssues.find((i) => i.status === "todo") ||
          null;

        const ledgerInfo = currentIssue ? this.workflowSnapshot.byIssueId[currentIssue.id] : null;
        const runEv = verifiedEvidenceByAgentId.get(aid) || {};
        const isPlanningTask =
          Boolean(currentIssue) &&
          (mappedAgent.role === "ceo" || mappedAgent.role === "cto") &&
          /\b(plan|rencana|decompos|analisis)\b/i.test(String(currentIssue?.title || ""));
        const isReviewTask =
          Boolean(currentIssue) &&
          (String(currentIssue?.status || "").toLowerCase() === "in_review" ||
            /\b(review|triage|audit|verif)\b/i.test(String(currentIssue?.title || "")));

        const stateDimensions = computeAgentStateDimensions({
          paperclipReachable: true,
          hermesReachable: this.hermesReachable,
          dataComplete: true,
          isStale: false,
          maintenanceActive: this.maintenanceSnapshot.maintenance_active,
          maintenanceDraining: this.maintenanceSnapshot.draining,
          agentRecord: {
            status: mappedAgent.raw_status,
            lifecycleState: mappedAgent.lifecycle_state,
          },
          activeRun: activeRunByAgentId.get(aid) || null,
          latestRun: latestRunByAgentId.get(aid) || null,
          currentIssue,
          pendingApproval:
            pendingApprovalAgentIds.has(aid) || String(ledgerInfo?.workflow_stage || "") === "PENDING_APPROVAL",
          verifiedEvidence: {
            ...runEv,
            workflowStage: ledgerInfo?.workflow_stage || null,
            isCollaborating: collaboratingAgentIds.has(aid),
            isPlanningTask,
            isReviewTask,
          },
          nowMs,
          previousSnapshot: this.agentStatesById.get(aid) || null,
        });

        nextAgentsMap.set(aid, {
          ...mappedAgent,
          current_task: currentIssue
            ? {
                id: currentIssue.id,
                identifier: currentIssue.identifier,
                title: currentIssue.title,
                status: currentIssue.status,
                priority: currentIssue.priority,
                project_id: currentIssue.projectId || null,
                parent_id: currentIssue.parentId || null,
                workflow_stage: ledgerInfo?.workflow_stage || null,
              }
            : null,
          current_run: activeRunByAgentId.get(aid)
            ? {
                id: activeRunByAgentId.get(aid).id,
                status: activeRunByAgentId.get(aid).status,
                started_at: activeRunByAgentId.get(aid).startedAt,
              }
            : null,
          queued_task_count: agentIssues.filter((i) => i.status === "todo" || i.status === "backlog").length,
          completed_task_count: agentIssues.filter((i) => i.status === "done").length,
          state: stateDimensions,
        });
        nextStatesMap.set(aid, stateDimensions);
      }

      // Detect removed agents cleanly
      for (const oldId of this.agentsById.keys()) {
        if (!nextAgentsMap.has(oldId)) {
          this.eventBus.publish({
            event_type: "agent.updated",
            source: "paperclip",
            company_id: snap.company.id,
            agent_id: oldId,
            dedupe_key: `agent_removed:${oldId}:${nowMs}`,
            payload: { removed: true },
          });
        }
      }

      this.agentsById = nextAgentsMap;
      this.agentStatesById = nextStatesMap;

      // Broadcast updated presence frame to any connected Hermes3D WebSocket clients
      const activeRecent = [...nextAgentsMap.values()]
        .filter((a) => a.state.retro_status === "working")
        .map((a) => ({ key: `agent:${a.paperclip_agent_id}:main`, updatedAt: nowMs }));
      this._emitHermesGatewayFrame({
        type: "event",
        event: "presence",
        payload: {
          sessions: {
            recent: activeRecent,
            byAgent: [...nextAgentsMap.values()].map((a) => ({
              agentId: a.paperclip_agent_id,
              recent: a.state.retro_status === "working" ? [{ key: `agent:${a.paperclip_agent_id}:main`, updatedAt: nowMs }] : [],
            })),
          },
        },
      });
    } catch (err) {
      const wasReachable = this.paperclipReachable;
      this.paperclipReachable = false;
      const isStale = this.lastGoodSnapshotAtMs > 0 && nowMs - this.lastGoodSnapshotAtMs > 15_000;

      // Preserve last known roster with explicit OFFLINE / STALE marker (never reset active work to fake idle!)
      for (const [aid, agentObj] of this.agentsById.entries()) {
        const offlineState = computeAgentStateDimensions({
          paperclipReachable: false,
          hermesReachable: this.hermesReachable,
          dataComplete: true,
          isStale: true,
          agentRecord: { status: agentObj.raw_status, lifecycleState: agentObj.lifecycle_state },
          nowMs,
          previousSnapshot: this.agentStatesById.get(aid) || null,
        });
        this.agentStatesById.set(aid, offlineState);
        this.agentsById.set(aid, {
          ...agentObj,
          state: {
            ...offlineState,
            last_known_visual_state: agentObj.state?.visual_state || "UNKNOWN",
            stale: isStale || true,
          },
        });
      }

      if (wasReachable && this.company) {
        this.eventBus.publish({
          event_type: "runtime.disconnected",
          source: "paperclip",
          company_id: this.company.id,
          dedupe_key: `pc_offline:${Math.floor(nowMs / 10000)}`,
          payload: { error: sanitizeText(err.message), stale: true },
        });
      }
    }
  }

  /**
   * Create an authorized, bounded coordination meeting workflow backed by real Paperclip issues.
   * Never fabricates fake agent dialogue; records agenda, participants, maxTurns, timeout, and action items.
   */
  async createAuthorizedMeeting(input) {
    if (!this.company) {
      await this.reconcileNow("meeting_init");
    }
    const title = sanitizeText(String(input.title || "Engineering Coordination Sync").trim()).slice(0, 140);
    const agenda = sanitizeText(String(input.agenda || "").trim()).slice(0, 2000);
    if (!agenda) {
      const err = new Error("Meeting agenda is required.");
      err.status = 400;
      throw err;
    }
    const participantIds = Array.isArray(input.participant_agent_ids)
      ? [...new Set(input.participant_agent_ids.map(String))].filter((id) => this.agentsById.has(id)).slice(0, 20)
      : [];
    if (participantIds.length < 2) {
      const err = new Error("At least 2 registered Paperclip agent IDs are required for a collaboration meeting.");
      err.status = 400;
      throw err;
    }

    const maxTurns = Math.max(1, Math.min(4, Number(input.max_turns) || 2));
    const timeoutSec = Math.max(30, Math.min(360, Number(input.timeout_sec) || 180));
    const leadAgentId = participantIds[0];

    // Close any older lingering ACTIVE meetings cleanly before starting the new meeting
    for (const oldMtg of this.meetings) {
      if (oldMtg.status === "ACTIVE") {
        oldMtg.status = "SUPERSEDED";
        oldMtg.updated_at = new Date().toISOString();
      }
    }

    // Persist authorized parent coordination issue in Paperclip for audit trail & governance
    const issue = await this.paperclip.createTask(
      this.company.id,
      {
        title: `[Meeting] ${title}`,
        description:
          `## Authorized Multi-Agent Coordination Workflow\n\n` +
          `- **Agenda:** ${agenda}\n` +
          (input.target_path ? `- **Target Project Path:** \`${sanitizeText(String(input.target_path))}\`\n` : "") +
          `- **Participants (${participantIds.length}):** ${participantIds.map((id) => this.agentsById.get(id)?.display_name || id).join(", ")}\n` +
          `- **Max Turns:** \`${maxTurns}\` | **Timeout:** \`${timeoutSec}s\`\n`,
        assigneeAgentId: input.wake_immediately === true ? leadAgentId : null,
        projectId: input.project_id || null,
        priority: input.priority || "high",
        status: input.wake_immediately === true ? "todo" : "backlog",
      },
      input.idempotency_key || null
    );

    const nowIso = new Date().toISOString();
    const meetingId = `mtg-${issue.id.slice(0, 8)}`;
    const meetingRecord = sanitizePayload({
      meeting_id: meetingId,
      paperclip_issue_id: issue.id,
      paperclip_identifier: issue.identifier,
      title,
      agenda,
      target_path: input.target_path ? sanitizeText(String(input.target_path)) : null,
      project_id: input.project_id || null,
      participant_agent_ids: participantIds,
      participants: participantIds.map((id) => ({
        agent_id: id,
        display_name: this.agentsById.get(id)?.display_name || id,
        role: this.agentsById.get(id)?.role || "specialist",
        department: this.agentsById.get(id)?.department || "Operations",
      })),
      max_turns: maxTurns,
      timeout_sec: timeoutSec,
      status: input.status === "COMPLETED" ? "COMPLETED" : "ACTIVE",
      decisions: Array.isArray(input.decisions) ? input.decisions.map(sanitizeText) : [],
      action_items: Array.isArray(input.action_items) ? input.action_items.map(sanitizePayload) : [],
      summary: sanitizeText(input.summary || "Authorized coordination workflow active in 3D Meeting Room & Paperclip."),
      created_at: nowIso,
      updated_at: nowIso,
    });

    this.meetings = [
      meetingRecord,
      ...this.meetings.filter((m) => m.meeting_id !== meetingId),
    ].slice(0, 50);
    saveMeetingsList(this.meetings);

    // Synchronize physical 3D Meeting Room gathering (`standup-store.json`) so all participating avatars walk to the conference table!
    if (meetingRecord.status === "ACTIVE") {
      const standupCards = participantIds.map((id) => {
        const ag = this.agentsById.get(id);
        const agName = ag?.display_name || id;
        const focusTask = buildRoleMeetingFocus(ag, agenda);
        const headline = `${agName}: ${focusTask}`;
        return {
          agentId: id,
          agentName: agName,
          speech: headline.length <= 120 ? headline : `${headline.slice(0, 117).trimEnd()}...`,
          currentTask: focusTask,
          blockers: [],
          recentCommits: [],
          activeTickets: [
            {
              id: issue.id,
              key: issue.identifier || "MTG",
              title: `[Meeting] ${title}`,
              status: "ACTIVE",
              url: null,
            },
          ],
          manualNotes: [agenda.slice(0, 240)],
          sourceStates: [{ kind: "manual", ready: true, stale: false, updatedAt: nowIso, error: null }],
        };
      });

      writeHermes3dStandupStore({
        id: meetingId,
        trigger: "manual",
        phase: "gathering",
        scheduledFor: null,
        startedAt: nowIso,
        updatedAt: nowIso,
        completedAt: null,
        currentSpeakerAgentId: null,
        speakerStartedAt: null,
        speakerDurationMs: 12000,
        participantOrder: participantIds,
        arrivedAgentIds: [],
        cards: standupCards,
      });
    }

    this.eventBus.publish({
      event_type: "meeting.started",
      source: "office_bridge",
      company_id: this.company.id,
      agent_id: leadAgentId,
      task_id: issue.id,
      dedupe_key: `mtg_start:${meetingRecord.meeting_id}`,
      payload: {
        meeting_id: meetingRecord.meeting_id,
        paperclip_identifier: issue.identifier,
        participants: meetingRecord.participants,
        max_turns: maxTurns,
        timeout_sec: timeoutSec,
      },
    });

    await this.reconcileNow("meeting_created");
    return meetingRecord;
  }

  async completeAuthorizedMeeting(meetingId, summaryData = {}) {
    const idx = this.meetings.findIndex((m) => m.meeting_id === meetingId);
    if (idx === -1) {
      const err = new Error(`Meeting ${meetingId} not found.`);
      err.status = 404;
      throw err;
    }
    const existing = this.meetings[idx];
    const summary = sanitizeText(String(summaryData.summary || existing.summary || "Meeting concluded.")).slice(0, 4000);
    const decisions = Array.isArray(summaryData.decisions) ? summaryData.decisions.map(sanitizeText) : existing.decisions;
    const actionItems = Array.isArray(summaryData.action_items) ? summaryData.action_items.map(sanitizePayload) : existing.action_items;

    if (existing.paperclip_issue_id) {
      await this.paperclip
        .addTaskComment(
          existing.paperclip_issue_id,
          `### Meeting Summary (${meetingId})\n\n${summary}\n\n**Decisions:**\n${decisions.map((d) => `- ${d}`).join("\n") || "- None"}`
        )
        .catch(() => {});
      await this.paperclip.updateTask(existing.paperclip_issue_id, { status: "done" }).catch(() => {});
    }

    const updated = {
      ...existing,
      status: "COMPLETED",
      summary,
      decisions,
      action_items: actionItems,
      updated_at: new Date().toISOString(),
    };
    this.meetings[idx] = updated;
    saveMeetingsList(this.meetings);
    writeHermes3dStandupStore(null);

    if (this.company) {
      this.eventBus.publish({
        event_type: "meeting.completed",
        source: "office_bridge",
        company_id: this.company.id,
        task_id: existing.paperclip_issue_id,
        dedupe_key: `mtg_done:${meetingId}:${updated.updated_at}`,
        payload: { meeting_id: meetingId, summary },
      });
    }
    await this.reconcileNow("meeting_completed");
    return updated;
  }

  getFullSnapshot() {
    const nowMs = Date.now();
    const isStale = !this.paperclipReachable || (this.lastGoodSnapshotAtMs > 0 && nowMs - this.lastGoodSnapshotAtMs > 15_000);
    const agents = [...this.agentsById.values()];
    const issues = [...this.issuesById.values()];
    const runs = [...this.runsById.values()].sort(
      (a, b) => Date.parse(b.createdAt || b.startedAt || 0) - Date.parse(a.createdAt || a.startedAt || 0)
    );

    const overviewCounts = {
      total_agents: agents.length,
      active_agents: agents.filter((a) => a.activation_status === "ACTIVE").length,
      standby_agents: agents.filter((a) => a.activation_status === "STANDBY").length,
      running_agents: agents.filter((a) => a.state?.execution_state === "RUNNING" || a.state?.execution_state === "QUEUED").length,
      idle_agents: agents.filter((a) => a.activation_status === "ACTIVE" && a.state?.execution_state === "IDLE").length,
      unknown_agents: agents.filter((a) => a.state?.visual_state === "UNKNOWN" || a.state?.visual_state === "OFFLINE").length,
      total_projects: this.projects.length,
      total_tasks: issues.length,
      running_tasks: issues.filter((i) => i.status === "in_progress" || i.status === "in_review").length,
      queued_tasks: issues.filter((i) => i.status === "todo" || i.status === "backlog").length,
      blocked_tasks: issues.filter((i) => i.status === "blocked").length,
      completed_tasks: issues.filter((i) => i.status === "done").length,
      cancelled_tasks: issues.filter((i) => i.status === "cancelled" || i.status === "canceled").length,
      failed_tasks: (this.workflowSnapshot.tasks || []).filter((t) => t.workflow_stage === "FAILED").length,
      pending_approvals: [...this.approvalsById.values()].filter((a) => a.status === "pending").length +
        (this.workflowSnapshot.tasks || []).filter((t) => t.workflow_stage === "PENDING_APPROVAL").length,
      open_findings: this.findingsSnapshot.summary?.open ?? 0,
      resolved_findings: this.findingsSnapshot.summary?.resolved ?? 0,
    };

    return {
      ok: true,
      stale: isStale,
      paperclip_reachable: this.paperclipReachable,
      upstream_ws_connected: this.upstreamWsConnected,
      last_good_snapshot_at: this.lastGoodSnapshotAtMs ? new Date(this.lastGoodSnapshotAtMs).toISOString() : null,
      observed_at: new Date(nowMs).toISOString(),
      company: this.company,
      overview: overviewCounts,
      departments: this.departments,
      org_tree: this.orgTree,
      agents,
      projects: this.projects,
      tasks: issues.slice(0, 150),
      runs: runs.slice(0, 80),
      collaboration: {
        edges: this.collaborationEdges,
        meetings: this.meetings.slice(-30),
      },
      approvals: [...this.approvalsById.values()],
      governance_budget: this.budgetOverview,
      security_center: this.findingsSnapshot,
      maintenance: this.maintenanceSnapshot,
      event_stream: {
        latest_sequence: this.eventBus.sequence,
        stats: this.eventBus.stats,
      },
    };
  }
}

module.exports = { RealtimeSynchronizer };
