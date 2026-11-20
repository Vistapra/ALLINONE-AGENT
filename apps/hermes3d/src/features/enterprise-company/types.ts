// Custom Modular Integration — Unified Autonomous AI Company Types

export type AgentStateDimensions = {
  activation_state: "ACTIVE" | "STANDBY" | "PAUSING" | "DEACTIVATED" | "UNKNOWN";
  connectivity_state: "ONLINE" | "STALE" | "OFFLINE" | "UNKNOWN";
  execution_state: "IDLE" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT" | "UNKNOWN";
  task_state:
    | "NONE"
    | "ASSIGNED"
    | "IN_PROGRESS"
    | "IN_REVIEW"
    | "WAITING_APPROVAL"
    | "BLOCKED"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED"
    | "UNKNOWN";
  maintenance_state: "NORMAL" | "DRAINING" | "MAINTENANCE_ACTIVE" | "UNKNOWN";
  visual_state:
    | "IDLE"
    | "WALKING"
    | "AT_DESK"
    | "PLANNING"
    | "WORKING"
    | "CODING"
    | "RESEARCHING"
    | "BUILDING"
    | "TESTING"
    | "REVIEWING"
    | "COLLABORATING"
    | "WAITING_APPROVAL"
    | "BLOCKED"
    | "COMPLETED"
    | "FAILED"
    | "PAUSED"
    | "MAINTENANCE"
    | "OFFLINE"
    | "UNKNOWN";
  retro_status: "working" | "idle" | "error";
  state_reason: string;
  stale: boolean;
  updated_at: string;
};

export type EnterpriseDepartment = {
  id: string;
  name: string;
  shortLabel: string;
  color: string;
  cameraTarget: { x: number; y: number; preset: string };
  facilities: string[];
};

export type EnterpriseAgent = {
  paperclip_agent_id: string;
  company_id: string;
  display_name: string;
  department_id: string;
  department: string;
  department_short: string;
  role: string;
  title: string;
  manager_id: string | null;
  subordinate_ids: string[];
  runtime_type: string;
  runtime_profile_reference: string | null;
  model_id: string;
  visual_profile_id: string;
  avatar_id: string;
  color: string;
  badge_emoji: string;
  wave: number;
  office_location_id: string;
  desk_coords: { x: number; y: number; facing: number };
  authorized_workspaces: string[];
  authorized_tools: string[];
  skills: string[];
  can_create_agents: boolean;
  activation_status: string;
  raw_status: string;
  lifecycle_state: string;
  last_heartbeat_at: string | null;
  current_task: {
    id: string;
    identifier: string;
    title: string;
    status: string;
    priority: string;
    project_id: string | null;
    parent_id: string | null;
    workflow_stage: string | null;
  } | null;
  current_run: {
    id: string;
    status: string;
    started_at: string | null;
  } | null;
  queued_task_count: number;
  completed_task_count: number;
  state: AgentStateDimensions;
};

export type EnterpriseTask = {
  id: string;
  identifier?: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  assigneeAgentId?: string | null;
  projectId?: string | null;
  parentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type SecurityFinding = {
  finding_id: string;
  project_id: string;
  asset_reference: string;
  source_reference: string;
  finding_title: string;
  finding_description: string;
  severity: string;
  confidence: number;
  cwe_reference: string | null;
  cve_reference: string | null;
  affected_component: string;
  sanitized_evidence: string;
  remediation_recommendation: string;
  verification_status: string;
  occurrence_count: number;
  assigned_reviewer: string;
  paperclip_review_issue_id: string | null;
  paperclip_remediation_issue_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CollaborationEdge = {
  edge_id: string;
  kind: string;
  from_agent_id: string;
  to_agent_id: string;
  parent_task_id: string;
  parent_identifier?: string;
  child_task_id: string;
  child_identifier?: string;
  title: string;
  status: string;
  active: boolean;
};

export type AuthorizedMeeting = {
  meeting_id: string;
  paperclip_issue_id: string;
  paperclip_identifier?: string;
  title: string;
  agenda: string;
  participant_agent_ids: string[];
  participants: Array<{ agent_id: string; display_name: string; role: string }>;
  max_turns: number;
  timeout_sec: number;
  status: "ACTIVE" | "COMPLETED";
  decisions: string[];
  action_items: unknown[];
  summary: string;
  created_at: string;
  updated_at: string;
};

export type NormalizedOfficeEvent = {
  schema_version: string;
  event_id: string;
  event_type: string;
  source: string;
  company_id: string;
  agent_id: string | null;
  task_id: string | null;
  run_id: string | null;
  correlation_id: string | null;
  sequence: number;
  timestamp: string;
  payload: Record<string, unknown>;
};

export type EnterpriseSnapshot = {
  ok: boolean;
  stale: boolean;
  paperclip_reachable: boolean;
  upstream_ws_connected: boolean;
  last_good_snapshot_at: string | null;
  observed_at: string;
  company: { id: string; name: string; issuePrefix: string; status: string } | null;
  overview: {
    total_agents: number;
    active_agents: number;
    standby_agents: number;
    running_agents: number;
    idle_agents: number;
    unknown_agents: number;
    total_projects: number;
    total_tasks: number;
    running_tasks: number;
    queued_tasks: number;
    blocked_tasks: number;
    completed_tasks: number;
    cancelled_tasks: number;
    failed_tasks: number;
    pending_approvals: number;
    open_findings: number;
    resolved_findings: number;
  };
  departments: EnterpriseDepartment[];
  agents: EnterpriseAgent[];
  projects: Array<{ id: string; name: string; status: string }>;
  tasks: EnterpriseTask[];
  runs: Array<{ id: string; agentId?: string; status: string; exitCode?: number | null; startedAt?: string; finishedAt?: string }>;
  collaboration: {
    edges: CollaborationEdge[];
    meetings: AuthorizedMeeting[];
  };
  approvals: Array<{
    id: string;
    type?: string;
    status: string;
    requestedByAgentId?: string | null;
    createdAt?: string;
    payload?: Record<string, unknown>;
  }>;
  governance_budget: {
    provider_model: string;
    cost_transparency_status: string;
    usage_mode_label: string;
    total_observed_tokens: number;
    total_execution_duration_ms: number;
    paused_agent_count: number;
    pending_approval_count: number;
    policies: Array<{
      policy_id: string;
      scope_type: string;
      scope_id: string;
      scope_name: string;
      quota_cents: number;
      observed_cents: number;
      unpriced_event_count: number;
      unpriced_usage_policy: string;
      cost_status: string;
      usage_label: string;
      paused: boolean;
      pause_reason: string | null;
    }>;
    per_agent_usage: Record<
      string,
      {
        agent_id: string;
        run_count: number;
        succeeded_runs: number;
        failed_runs: number;
        cancelled_runs: number;
        total_tokens: number;
        total_duration_ms: number;
        cost_label: string;
        usage_classification: string;
      }
    >;
  } | null;
  security_center: {
    available: boolean;
    trust_boundary?: string;
    summary: {
      total: number;
      open: number;
      resolved: number;
      false_positives: number;
      accepted_risks: number;
      by_status?: Record<string, number>;
    };
    findings: SecurityFinding[];
    timeline: Array<{
      event_id: number;
      finding_id: string;
      event_type: string;
      from_status: string | null;
      to_status: string | null;
      actor: string;
      created_at: string;
    }>;
  };
  maintenance: {
    lock_active: boolean;
    draining: boolean;
    maintenance_active: boolean;
    state: Record<string, unknown>;
  };
  event_stream: {
    latest_sequence: number;
    stats: { emitted: number; deduplicated: number; rejectedSchema: number; staleMarked: number };
  };
};

export type AgentInspectorPayload = {
  overview: EnterpriseAgent;
  hierarchy: {
    manager: { paperclip_agent_id: string; display_name: string; role: string } | null;
    subordinates: Array<{ paperclip_agent_id: string; display_name: string; role: string; activation_status: string }>;
  };
  current_task: EnterpriseAgent["current_task"];
  task_queue: EnterpriseTask[];
  task_history: EnterpriseTask[];
  delegation_history: CollaborationEdge[];
  execution_history: Array<{
    id: string;
    status: string;
    exit_code: number | null;
    started_at?: string;
    finished_at?: string;
    issue_id: string | null;
  }>;
  sanitized_logs: string;
  verified_run_evidence: { verifiedToolKind: string | null; verifiedTools: string[] };
  performance: {
    completed_tasks: number;
    failed_runs: number;
    succeeded_runs: number;
    run_count: number;
    total_execution_duration_ms: number;
    retry_count: number;
    retry_rate: number;
  };
  budget: {
    policy: Record<string, unknown> | null;
    usage: {
      run_count: number;
      total_tokens: number;
      total_duration_ms: number;
      cost_label: string;
      usage_classification: string;
    };
  };
  health: {
    connectivity_state: string;
    activation_state: string;
    execution_state: string;
    visual_state: string;
    last_activity_at: string | null;
  };
  allowed_settings: {
    can_pause: boolean;
    can_resume: boolean;
    can_assign_task: boolean;
    can_cancel_active_run: boolean;
    direct_shell_exposed: boolean;
  };
};

export type EnterpriseQualityPreset = "LOW" | "MEDIUM" | "HIGH" | "AUTO";
