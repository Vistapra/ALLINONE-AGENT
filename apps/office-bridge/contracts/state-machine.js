"use strict";

/**
 * Phase 27 — Multi-Dimensional Agent Behavior State Machine.
 *
 * Separates 6 orthogonal dimensions:
 *   1. activation_state
 *   2. connectivity_state
 *   3. execution_state
 *   4. task_state
 *   5. maintenance_state
 *   6. visual_state (derived strictly from verified telemetry — NEVER from job title alone!)
 */

const VISUAL_STATES = Object.freeze([
  "IDLE",
  "WALKING",
  "AT_DESK",
  "PLANNING",
  "WORKING",
  "CODING",
  "RESEARCHING",
  "BUILDING",
  "TESTING",
  "REVIEWING",
  "COLLABORATING",
  "WAITING_APPROVAL",
  "BLOCKED",
  "COMPLETED",
  "FAILED",
  "PAUSED",
  "MAINTENANCE",
  "OFFLINE",
  "UNKNOWN",
]);

const ACTIVATION_STATES = Object.freeze(["ACTIVE", "STANDBY", "PAUSING", "DEACTIVATED", "UNKNOWN"]);
const CONNECTIVITY_STATES = Object.freeze(["ONLINE", "STALE", "OFFLINE", "UNKNOWN"]);
const EXECUTION_STATES = Object.freeze(["IDLE", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT", "UNKNOWN"]);
const TASK_STATES = Object.freeze([
  "NONE",
  "ASSIGNED",
  "IN_PROGRESS",
  "IN_REVIEW",
  "WAITING_APPROVAL",
  "BLOCKED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "UNKNOWN",
]);
const MAINTENANCE_STATES = Object.freeze(["NORMAL", "DRAINING", "MAINTENANCE_ACTIVE", "UNKNOWN"]);

const COMPLETION_HOLD_MS = 12_000;
const FAILURE_HOLD_MS = 18_000;
const DEBOUNCE_MIN_MS = 350;

/**
 * Classify verified active activity kind ONLY when backed by real evidence
 * (verified tool/command output, workflow stage, or explicit collaboration link).
 * NEVER returns CODING/TESTING merely because an agent's title is Developer or QA!
 */
function resolveVerifiedActivityState(evidence) {
  if (!evidence || typeof evidence !== "object") return "WORKING";

  if (evidence.verifiedToolKind === "coding") return "CODING";
  if (evidence.verifiedToolKind === "testing") return "TESTING";
  if (evidence.verifiedToolKind === "building") return "BUILDING";
  if (evidence.verifiedToolKind === "researching") return "RESEARCHING";

  if (evidence.isCollaborating === true) return "COLLABORATING";

  const stage = String(evidence.workflowStage || "").toUpperCase();
  if (stage === "PLANNED" || stage === "TRIAGED" || evidence.isPlanningTask === true) {
    return "PLANNING";
  }
  if (stage === "IN_REVIEW" || stage === "UNDER_REVIEW" || evidence.isReviewTask === true) {
    return "REVIEWING";
  }
  if (stage === "IN_TESTING") {
    // Only show TESTING if test execution is actively running or stage explicitly verified IN_TESTING
    return evidence.verifiedTestCommand ? "TESTING" : "REVIEWING";
  }

  return "WORKING";
}

/**
 * Compute all 6 state dimensions deterministically from verified backend telemetry.
 * @param {{
 *   paperclipReachable: boolean,
 *   hermesReachable: boolean,
 *   dataComplete?: boolean,
 *   isStale?: boolean,
 *   maintenanceActive?: boolean,
 *   maintenanceDraining?: boolean,
 *   agentRecord?: Record<string, unknown> | null,
 *   activeRun?: Record<string, unknown> | null,
 *   latestRun?: Record<string, unknown> | null,
 *   currentIssue?: Record<string, unknown> | null,
 *   pendingApproval?: boolean,
 *   isWalking?: boolean,
 *   atDesk?: boolean,
 *   verifiedEvidence?: Record<string, unknown> | null,
 *   nowMs?: number,
 *   previousSnapshot?: Record<string, unknown> | null,
 * }} ctx
 */
function computeAgentStateDimensions(ctx) {
  const nowMs = typeof ctx.nowMs === "number" ? ctx.nowMs : Date.now();
  const prev = ctx.previousSnapshot || null;

  // 1. Connectivity State
  let connectivity_state = "ONLINE";
  if (ctx.paperclipReachable === false || ctx.hermesReachable === false) {
    connectivity_state = "OFFLINE";
  } else if (ctx.dataComplete === false || !ctx.agentRecord) {
    connectivity_state = "UNKNOWN";
  } else if (ctx.isStale === true) {
    connectivity_state = "STALE";
  }

  // 2. Maintenance State
  let maintenance_state = "NORMAL";
  if (ctx.maintenanceActive === true) {
    maintenance_state = "MAINTENANCE_ACTIVE";
  } else if (ctx.maintenanceDraining === true) {
    maintenance_state = "DRAINING";
  } else if (connectivity_state === "UNKNOWN") {
    maintenance_state = "UNKNOWN";
  }

  // 3. Activation State
  let activation_state = "UNKNOWN";
  if (ctx.agentRecord) {
    const rawStatus = String(ctx.agentRecord.status || "").toLowerCase();
    const lc = String(ctx.agentRecord.lifecycleState || "").toLowerCase();
    if (rawStatus === "terminated" || rawStatus === "archived" || rawStatus === "deleted") {
      activation_state = "DEACTIVATED";
    } else if (lc === "pausing" || lc === "stopping") {
      activation_state = "PAUSING";
    } else if (rawStatus === "paused") {
      activation_state = "STANDBY";
    } else if (rawStatus === "idle" || rawStatus === "running" || rawStatus === "active" || rawStatus === "error") {
      activation_state = "ACTIVE";
    }
  }

  // 4. Execution State
  let execution_state = "UNKNOWN";
  if (ctx.agentRecord) {
    if (ctx.activeRun) {
      const rs = String(ctx.activeRun.status || "").toLowerCase();
      execution_state = rs === "queued" ? "QUEUED" : "RUNNING";
    } else if (ctx.latestRun) {
      const ls = String(ctx.latestRun.status || "").toLowerCase();
      const finishedAtMs = ctx.latestRun.finishedAt ? Date.parse(String(ctx.latestRun.finishedAt)) : 0;
      const recentEnough = finishedAtMs > 0 && nowMs - finishedAtMs <= Math.max(COMPLETION_HOLD_MS, FAILURE_HOLD_MS);
      if (recentEnough) {
        if (ls === "succeeded") execution_state = "SUCCEEDED";
        else if (ls === "failed" || ls === "error") execution_state = "FAILED";
        else if (ls === "cancelled" || ls === "canceled") execution_state = "CANCELLED";
        else if (ls === "timed_out") execution_state = "TIMED_OUT";
        else execution_state = "IDLE";
      } else {
        execution_state = "IDLE";
      }
    } else {
      execution_state = "IDLE";
    }
  }

  // 5. Task State
  let task_state = "UNKNOWN";
  if (ctx.agentRecord) {
    if (!ctx.currentIssue) {
      task_state = "NONE";
    } else {
      const ist = String(ctx.currentIssue.status || "").toLowerCase();
      const wfStage = String(ctx.verifiedEvidence?.workflowStage || "").toUpperCase();
      if (ctx.pendingApproval === true || wfStage === "PENDING_APPROVAL") {
        task_state = "WAITING_APPROVAL";
      } else if (wfStage === "FAILED") {
        task_state = "FAILED";
      } else if (ist === "blocked" || wfStage === "BLOCKED") {
        task_state = "BLOCKED";
      } else if (ist === "in_progress" || execution_state === "RUNNING") {
        task_state = "IN_PROGRESS";
      } else if (ist === "in_review") {
        task_state = "IN_REVIEW";
      } else if (ist === "todo" || ist === "backlog") {
        task_state = "ASSIGNED";
      } else if (ist === "done") {
        task_state = "COMPLETED";
      } else if (ist === "cancelled" || ist === "canceled") {
        task_state = "CANCELLED";
      } else {
        task_state = "UNKNOWN";
      }
    }
  }

  // 6. Deterministic Visual State Priority Engine
  let visual_state = "UNKNOWN";
  let state_reason = "unknown";

  if (connectivity_state === "OFFLINE") {
    visual_state = "OFFLINE";
    state_reason = "runtime_unreachable";
  } else if (connectivity_state === "UNKNOWN" || activation_state === "UNKNOWN") {
    visual_state = "UNKNOWN";
    state_reason = "telemetry_unavailable";
  } else if (maintenance_state === "MAINTENANCE_ACTIVE") {
    visual_state = "MAINTENANCE";
    state_reason = "platform_maintenance_active";
  } else if (activation_state === "STANDBY" || activation_state === "PAUSING" || activation_state === "DEACTIVATED") {
    // Even if paused, if an active run hasn't finished stopping yet, show PAUSED cleanly
    visual_state = "PAUSED";
    state_reason = activation_state === "STANDBY" ? "wave2_standby_paused" : "agent_paused";
  } else if (task_state === "WAITING_APPROVAL") {
    visual_state = "WAITING_APPROVAL";
    state_reason = "owner_approval_pending";
  } else if (execution_state === "RUNNING" || execution_state === "QUEUED") {
    if (ctx.isWalking === true) {
      visual_state = "WALKING";
      state_reason = "walking_to_station";
    } else {
      visual_state = resolveVerifiedActivityState(ctx.verifiedEvidence);
      state_reason = `verified_run_${visual_state.toLowerCase()}`;
    }
  } else if (execution_state === "FAILED" || execution_state === "TIMED_OUT" || task_state === "FAILED") {
    visual_state = "FAILED";
    state_reason = execution_state === "TIMED_OUT" ? "run_timed_out" : "execution_failed";
  } else if (task_state === "BLOCKED") {
    visual_state = "BLOCKED";
    state_reason = "task_dependency_or_gate_blocked";
  } else if (execution_state === "SUCCEEDED") {
    visual_state = "COMPLETED";
    state_reason = "run_completed_recently";
  } else if (task_state === "IN_REVIEW") {
    visual_state = ctx.verifiedEvidence?.isCollaborating ? "COLLABORATING" : "REVIEWING";
    state_reason = "issue_in_review";
  } else if (task_state === "ASSIGNED" || task_state === "IN_PROGRESS") {
    visual_state = ctx.isWalking ? "WALKING" : "AT_DESK";
    state_reason = "task_assigned_at_workstation";
  } else if (ctx.verifiedEvidence?.isCollaborating === true) {
    visual_state = "COLLABORATING";
    state_reason = "active_collaboration";
  } else {
    visual_state = ctx.isWalking ? "WALKING" : "IDLE";
    state_reason = "agent_idle_ready";
  }

  // Visual debounce for non-critical rapid flicker (< 350ms), never delaying OFFLINE/FAILED/WAITING_APPROVAL/MAINTENANCE
  const criticalStates = new Set(["OFFLINE", "UNKNOWN", "MAINTENANCE", "FAILED", "WAITING_APPROVAL", "PAUSED"]);
  if (
    prev &&
    !criticalStates.has(visual_state) &&
    prev.visual_state &&
    prev.visual_state !== visual_state &&
    typeof prev.updated_at_ms === "number" &&
    nowMs - prev.updated_at_ms < DEBOUNCE_MIN_MS &&
    prev.execution_state === execution_state
  ) {
    visual_state = prev.visual_state;
    state_reason = prev.state_reason || state_reason;
  }

  // Map to Hermes3D RetroOffice3D legacy 3-status field ("working" | "idle" | "error") without losing rich 18-state metadata
  let retro_status = "idle";
  if (visual_state === "FAILED" || visual_state === "OFFLINE") {
    retro_status = "error";
  } else if (
    ["WALKING", "AT_DESK", "PLANNING", "WORKING", "CODING", "RESEARCHING", "BUILDING", "TESTING", "REVIEWING", "COLLABORATING"].includes(
      visual_state
    )
  ) {
    retro_status = "working";
  }

  return {
    activation_state,
    connectivity_state,
    execution_state,
    task_state,
    maintenance_state,
    visual_state,
    retro_status,
    state_reason,
    stale: connectivity_state === "STALE",
    updated_at: new Date(nowMs).toISOString(),
    updated_at_ms: nowMs,
  };
}

module.exports = {
  VISUAL_STATES,
  ACTIVATION_STATES,
  CONNECTIVITY_STATES,
  EXECUTION_STATES,
  TASK_STATES,
  MAINTENANCE_STATES,
  COMPLETION_HOLD_MS,
  FAILURE_HOLD_MS,
  resolveVerifiedActivityState,
  computeAgentStateDimensions,
};
