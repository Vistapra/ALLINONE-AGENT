"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OfficeRenderMode } from "@/features/office/renderMode";
import { useEnterpriseCompanyLive } from "./useEnterpriseCompanyLive";
import type {
  AgentInspectorPayload,
  EnterpriseAgent,
  EnterpriseQualityPreset,
} from "./types";

type EnterpriseTab =
  | "employees"
  | "inspector"
  | "collaboration"
  | "security"
  | "governance"
  | "dashboard";

function visualStateBadgeColor(state: string): string {
  switch (state) {
    case "WORKING":
    case "CODING":
    case "BUILDING":
    case "TESTING":
    case "PLANNING":
    case "RESEARCHING":
    case "REVIEWING":
      return "border-emerald-400/40 bg-emerald-500/15 text-emerald-200";
    case "COLLABORATING":
      return "border-cyan-400/40 bg-cyan-500/15 text-cyan-200";
    case "WAITING_APPROVAL":
      return "border-amber-400/50 bg-amber-500/20 text-amber-200";
    case "BLOCKED":
    case "FAILED":
    case "OFFLINE":
      return "border-rose-400/50 bg-rose-500/20 text-rose-200";
    case "COMPLETED":
      return "border-teal-400/40 bg-teal-500/15 text-teal-200";
    case "MAINTENANCE":
      return "border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-200";
    case "PAUSED":
      return "border-slate-500/40 bg-slate-600/20 text-slate-300";
    default:
      return "border-sky-400/30 bg-sky-500/10 text-sky-200";
  }
}

function dispatchSceneCommand(detail: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("enterprise-office:command", { detail }));
}

export function EnterpriseOfficeOverlay({
  activeAdapterType,
  renderMode,
  onRenderModeChange,
  onSelectSceneAgent,
}: {
  activeAdapterType: string;
  renderMode: OfficeRenderMode;
  onRenderModeChange: (mode: OfficeRenderMode) => void;
  onSelectSceneAgent?: (agentId: string) => void;
}) {
  const isDemoMode = activeAdapterType === "demo";
  const {
    snapshot,
    events,
    wsConnected,
    lastError,
    perf,
    fetchSnapshot,
    fetchAgentInspector,
    createTask,
    patchTask,
    controlAgent,
    cancelRun,
    createMeeting,
    completeMeeting,
    resolveApproval,
    runGovernanceCommand,
    fetchHealthMatrix,
    fetchEvidence,
  } = useEnterpriseCompanyLive(!isDemoMode);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<EnterpriseTab>("employees");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [followedAgentId, setFollowedAgentId] = useState<string | null>(null);
  const [qualityPreset, setQualityPreset] = useState<EnterpriseQualityPreset>("AUTO");

  const [inspector, setInspector] = useState<AgentInspectorPayload | null>(null);
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [actionBanner, setActionBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Task creation form state
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskPriority, setTaskPriority] = useState("medium");
  const [taskWakeNow, setTaskWakeNow] = useState(true);
  const [taskNotifyTg, setTaskNotifyTg] = useState(false);
  const [taskCommentText, setTaskCommentText] = useState("");

  // Meeting creation form state
  const [mtgTitle, setMtgTitle] = useState("");
  const [mtgAgenda, setMtgAgenda] = useState("");
  const [mtgParticipants, setMtgParticipants] = useState<string[]>([]);

  // Dashboard & Evidence state
  const [healthMatrix, setHealthMatrix] = useState<Record<string, unknown> | null>(null);
  const [evidenceTarget, setEvidenceTarget] = useState("acceptance-invoice-app");
  const [evidenceResult, setEvidenceResult] = useState<Record<string, unknown> | null>(null);

  const agents = useMemo(() => snapshot?.agents ?? [], [snapshot]);

  const loadInspectorFor = useCallback(
    async (agentId: string) => {
      setSelectedAgentId(agentId);
      setInspectorLoading(true);
      try {
        const data = await fetchAgentInspector(agentId);
        setInspector(data);
      } catch (err) {
        setActionBanner({ kind: "err", text: err instanceof Error ? err.message : "Inspector load failed" });
      } finally {
        setInspectorLoading(false);
      }
    },
    [fetchAgentInspector]
  );

  // Listen for 3D scene avatar clicks
  useEffect(() => {
    const onSceneSelect = (event: Event) => {
      const custom = event as CustomEvent<{ agentId?: string }>;
      const aid = custom.detail?.agentId;
      if (aid && !isDemoMode) {
        setDrawerOpen(true);
        setActiveTab("inspector");
        void loadInspectorFor(aid);
      }
    };
    window.addEventListener("enterprise-office:agent-selected", onSceneSelect);
    return () => window.removeEventListener("enterprise-office:agent-selected", onSceneSelect);
  }, [isDemoMode, loadInspectorFor]);

  // Refresh health matrix when opening dashboard tab
  useEffect(() => {
    if (drawerOpen && activeTab === "dashboard" && !isDemoMode) {
      fetchHealthMatrix()
        .then((d) => setHealthMatrix(d))
        .catch(() => {});
    }
  }, [drawerOpen, activeTab, isDemoMode, fetchHealthMatrix]);

  const handleQualityChange = (preset: EnterpriseQualityPreset) => {
    setQualityPreset(preset);
    dispatchSceneCommand({ type: "quality", preset });
  };

  const handleFlyToDepartment = (deptId: string, x: number, y: number) => {
    setFollowedAgentId(null);
    dispatchSceneCommand({ type: "flyToCanvas", deptId, x, y, zoom: 72 });
  };

  const handleFollowAgent = (agent: EnterpriseAgent) => {
    const nextId = followedAgentId === agent.paperclip_agent_id ? null : agent.paperclip_agent_id;
    setFollowedAgentId(nextId);
    dispatchSceneCommand({ type: "followAgent", agentId: nextId });
    onSelectSceneAgent?.(agent.paperclip_agent_id);
  };

  const handleCreateTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    try {
      const targetId = selectedAgentId || agents.find((a) => a.role === "ceo")?.paperclip_agent_id || null;
      const res = await createTask({
        title: taskTitle.trim(),
        description: taskDesc.trim() || taskTitle.trim(),
        assignee_agent_id: targetId,
        priority: taskPriority,
        wake_immediately: taskWakeNow,
        notify_telegram_immediately: taskNotifyTg,
        idempotency_key: `ui-${targetId || "ceo"}-${taskTitle.trim().toLowerCase().slice(0, 48)}`,
      });
      setTaskTitle("");
      setTaskDesc("");
      setActionBanner({
        kind: "ok",
        text: `Created Paperclip Task ${res.task?.identifier || res.task?.id}${res.deduplicated ? " (Idempotent deduplicated)" : ""}`,
      });
      if (targetId) void loadInspectorFor(targetId);
    } catch (err) {
      setActionBanner({ kind: "err", text: err instanceof Error ? err.message : "Task creation failed" });
    }
  };

  return (
    <>
      {/* Top-Left Enterprise Telemetry & Department Camera Bar */}
      <div
        data-testid="enterprise-top-bar"
        className="pointer-events-auto absolute top-3 left-14 z-30 flex flex-wrap items-center gap-1.5 rounded-xl border border-cyan-500/25 bg-[#060c14]/92 px-3 py-1.5 text-[11px] text-slate-100 shadow-xl backdrop-blur-md"
      >
        {isDemoMode ? (
          <span
            data-testid="simulated-demo-banner"
            className="rounded-md border border-amber-400/60 bg-amber-500/25 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-200"
          >
            ⚠ SIMULATED DEMO MODE — NOT PRODUCTION DATA
          </span>
        ) : snapshot?.stale || !snapshot?.paperclip_reachable ? (
          <span
            data-testid="stale-telemetry-banner"
            className="rounded-md border border-rose-400/50 bg-rose-500/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-rose-200"
          >
            ● STALE / RECONNECTING {lastError ? `(${lastError})` : ""}
          </span>
        ) : (
          <span
            data-testid="live-sync-badge"
            className="rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-200"
          >
            ● LIVE COMPANY · {snapshot.overview.active_agents}/{snapshot.overview.total_agents} ACTIVE · SEQ #{snapshot.event_stream.latest_sequence} · {wsConnected ? "WS" : "POLL"}
          </span>
        )}

        <span className="hidden font-mono text-[10px] text-cyan-200/75 md:inline" data-testid="perf-hud">
          {perf.fps} FPS ({perf.frameTimeMs}ms){perf.jsHeapMb ? ` · ${perf.jsHeapMb}MB` : ""}
        </span>

        {/* Camera Controls: Overview, Zoom, & 8 Departments */}
        <div className="flex items-center gap-1 border-l border-white/10 pl-2">
          <button
            type="button"
            data-testid="cam-overview-btn"
            onClick={() => {
              setFollowedAgentId(null);
              dispatchSceneCommand({ type: "overview" });
            }}
            className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] hover:border-cyan-400/50 hover:text-cyan-200"
            title="Isometric Overview Camera"
          >
            ISO
          </button>
          <button
            type="button"
            data-testid="cam-zoom-in-btn"
            onClick={() => dispatchSceneCommand({ type: "zoomDelta", delta: 14 })}
            className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] hover:border-cyan-400/50"
            title="Zoom In"
          >
            +
          </button>
          <button
            type="button"
            data-testid="cam-zoom-out-btn"
            onClick={() => dispatchSceneCommand({ type: "zoomDelta", delta: -14 })}
            className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] hover:border-cyan-400/50"
            title="Zoom Out"
          >
            −
          </button>
          {(snapshot?.departments ?? []).map((dept) => (
            <button
              key={dept.id}
              type="button"
              data-testid={`dept-jump-${dept.id}`}
              onClick={() => handleFlyToDepartment(dept.id, dept.cameraTarget.x, dept.cameraTarget.y)}
              className="inline-block rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase hover:border-cyan-400/50 hover:text-cyan-200"
              title={`Jump to ${dept.name}`}
            >
              {dept.shortLabel}
            </button>
          ))}
        </div>

        {/* Graphics Quality Presets + 3D/2D Switch */}
        <div className="flex items-center gap-1 border-l border-white/10 pl-2">
          {(["LOW", "MEDIUM", "HIGH", "AUTO"] as const).map((q) => (
            <button
              key={q}
              type="button"
              data-testid={`quality-btn-${q.toLowerCase()}`}
              onClick={() => handleQualityChange(q)}
              className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${
                qualityPreset === q
                  ? "border border-cyan-400/60 bg-cyan-500/25 text-cyan-100"
                  : "border border-white/10 bg-white/5 text-white/60 hover:text-white"
              }`}
            >
              {q}
            </button>
          ))}
          <button
            type="button"
            data-testid="toggle-render-mode-btn"
            onClick={() => onRenderModeChange(renderMode === "3d" ? "2d" : "3d")}
            className="rounded border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-amber-200 hover:bg-amber-500/25"
          >
            {renderMode === "3d" ? "2D PIXEL" : "3D OFFICE"}
          </button>
        </div>

        {/* Toggle Enterprise Command Center Drawer */}
        {!isDemoMode ? (
          <button
            type="button"
            data-testid="open-command-center-btn"
            onClick={() => setDrawerOpen((v) => !v)}
            className="ml-1 rounded-md border border-cyan-400/50 bg-cyan-500/20 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-100 hover:bg-cyan-500/35"
          >
            {drawerOpen ? "Close Hub" : `Company Hub (${agents.length})`}
          </button>
        ) : null}
      </div>

      {/* Enterprise 6-Tab Interactive Command Center Drawer */}
      {!isDemoMode && drawerOpen ? (
        <div
          data-testid="enterprise-command-drawer"
          className="pointer-events-auto absolute top-14 right-3 bottom-3 z-30 flex w-[470px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-cyan-500/30 bg-[#070d17]/95 text-slate-100 shadow-2xl backdrop-blur-md"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
            <div>
              <div className="font-mono text-[10px] font-bold tracking-[0.2em] text-cyan-300 uppercase">
                {snapshot?.company?.name || "Unified Autonomous AI Company"}
              </div>
              <div className="text-[11px] text-slate-400">
                Paperclip Control Plane × Hermes Workers × VulnClaw SOC × Telegram
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="rounded border border-white/15 px-2 py-0.5 text-xs text-slate-300 hover:bg-white/10"
            >
              ✕
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="grid grid-cols-6 gap-1 border-b border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[9px] uppercase">
            {(
              [
                ["employees", "Roster"],
                ["inspector", "Inspector"],
                ["collaboration", "Collab"],
                ["security", "SOC"],
                ["governance", "Gov/Budget"],
                ["dashboard", "Ops/Evid"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                data-testid={`hub-tab-${id}`}
                onClick={() => setActiveTab(id)}
                className={`rounded py-1 text-center font-semibold transition ${
                  activeTab === id
                    ? "bg-cyan-500/25 text-cyan-200 border border-cyan-400/50"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {actionBanner ? (
            <div
              className={`flex items-center justify-between px-3 py-1.5 text-[11px] ${
                actionBanner.kind === "ok"
                  ? "bg-emerald-500/20 text-emerald-200 border-b border-emerald-400/30"
                  : "bg-rose-500/20 text-rose-200 border-b border-rose-400/30"
              }`}
            >
              <span>{actionBanner.text}</span>
              <button type="button" onClick={() => setActionBanner(null)} className="ml-2 text-xs opacity-75">
                ✕
              </button>
            </div>
          ) : null}

          {/* Tab Content */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs space-y-3">
            {/* TAB 1: EMPLOYEES & 6D STATE MACHINE */}
            {activeTab === "employees" ? (
              <div className="space-y-2" data-testid="roster-list">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Canonical Paperclip Roster ({agents.length} Employees)</span>
                  <button
                    type="button"
                    onClick={() => void fetchSnapshot(true)}
                    className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-white/10"
                  >
                    Reconcile
                  </button>
                </div>
                {agents.map((agent) => (
                  <div
                    key={agent.paperclip_agent_id}
                    data-testid={`roster-agent-${agent.paperclip_agent_id}`}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 hover:border-cyan-400/35"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-white">
                          {agent.badge_emoji} {agent.display_name}{" "}
                          <span className="font-mono text-[10px] text-slate-400">({agent.department_short})</span>
                        </div>
                        <div className="text-[11px] text-slate-400">{agent.title}</div>
                      </div>
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold ${visualStateBadgeColor(
                          agent.state.visual_state
                        )}`}
                      >
                        {agent.state.visual_state}
                      </span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap gap-1 font-mono text-[9px] text-slate-300">
                      <span className="rounded bg-black/40 px-1.5 py-0.5">ACT:{agent.state.activation_state}</span>
                      <span className="rounded bg-black/40 px-1.5 py-0.5">CONN:{agent.state.connectivity_state}</span>
                      <span className="rounded bg-black/40 px-1.5 py-0.5">EXEC:{agent.state.execution_state}</span>
                      <span className="rounded bg-black/40 px-1.5 py-0.5">TASK:{agent.state.task_state}</span>
                    </div>

                    {agent.current_task ? (
                      <div className="mt-1.5 rounded bg-cyan-950/40 px-2 py-1 text-[11px] text-cyan-200">
                        Active: <strong>{agent.current_task.identifier}</strong> — {agent.current_task.title}
                      </div>
                    ) : null}

                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        data-testid={`inspect-btn-${agent.paperclip_agent_id}`}
                        onClick={() => {
                          setActiveTab("inspector");
                          onSelectSceneAgent?.(agent.paperclip_agent_id);
                          void loadInspectorFor(agent.paperclip_agent_id);
                        }}
                        className="rounded border border-cyan-400/40 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/25"
                      >
                        Inspect &amp; Command
                      </button>
                      <button
                        type="button"
                        data-testid={`follow-btn-${agent.paperclip_agent_id}`}
                        onClick={() => handleFollowAgent(agent)}
                        className={`rounded border px-2 py-0.5 text-[10px] ${
                          followedAgentId === agent.paperclip_agent_id
                            ? "border-amber-400/60 bg-amber-500/25 text-amber-200"
                            : "border-white/15 bg-white/5 text-slate-300 hover:text-white"
                        }`}
                      >
                        {followedAgentId === agent.paperclip_agent_id ? "Unfollow" : "Follow 3D"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFlyToDepartment(agent.department_id, agent.desk_coords.x, agent.desk_coords.y)}
                        className="rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300 hover:text-white"
                      >
                        Desk
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* TAB 2: AGENT INSPECTOR & INTERACTIVE COMMAND CENTER */}
            {activeTab === "inspector" ? (
              <div className="space-y-3" data-testid="agent-inspector-panel">
                <div className="flex items-center gap-2">
                  <select
                    value={selectedAgentId || ""}
                    onChange={(e) => {
                      if (e.target.value) void loadInspectorFor(e.target.value);
                    }}
                    className="flex-1 rounded border border-white/20 bg-slate-900 px-2 py-1 text-xs text-white"
                  >
                    <option value="">Select AI Employee...</option>
                    {agents.map((a) => (
                      <option key={a.paperclip_agent_id} value={a.paperclip_agent_id}>
                        {a.display_name} ({a.activation_status} · {a.department_short})
                      </option>
                    ))}
                  </select>
                </div>

                {inspectorLoading ? <div className="text-slate-400">Loading live telemetry from Paperclip...</div> : null}

                {inspector ? (
                  <>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-white">
                          {inspector.overview.badge_emoji} {inspector.overview.display_name}
                        </span>
                        <span className={`rounded border px-2 py-0.5 font-mono text-[10px] ${visualStateBadgeColor(inspector.overview.state.visual_state)}`}>
                          {inspector.overview.state.visual_state}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-300">{inspector.overview.title}</div>
                      <div className="grid grid-cols-2 gap-1 pt-1 font-mono text-[10px] text-slate-400">
                        <div>ID: {inspector.overview.paperclip_agent_id.slice(0, 12)}…</div>
                        <div>Dept: {inspector.overview.department}</div>
                        <div>Runtime: {inspector.overview.runtime_type}</div>
                        <div>Profile: {inspector.overview.runtime_profile_reference || "default"}</div>
                        <div>Model: {inspector.overview.model_id}</div>
                        <div>Manager: {inspector.hierarchy.manager?.display_name || "Board / Human Owner"}</div>
                      </div>
                      {inspector.hierarchy.subordinates.length > 0 ? (
                        <div className="pt-1 text-[10px] text-slate-400">
                          Subordinates: {inspector.hierarchy.subordinates.map((s) => s.display_name).join(", ")}
                        </div>
                      ) : null}

                      {/* Lifecycle Controls */}
                      <div className="flex flex-wrap gap-1.5 pt-2">
                        <button
                          type="button"
                          data-testid="inspector-pause-btn"
                          onClick={() =>
                            controlAgent(inspector.overview.paperclip_agent_id, "pause")
                              .then(() => loadInspectorFor(inspector.overview.paperclip_agent_id))
                              .then(() => setActionBanner({ kind: "ok", text: "Agent paused in Paperclip." }))
                              .catch((e: Error) => setActionBanner({ kind: "err", text: e.message }))
                          }
                          className="rounded border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-[10px] text-amber-200"
                        >
                          Pause Agent
                        </button>
                        <button
                          type="button"
                          data-testid="inspector-resume-btn"
                          onClick={() =>
                            controlAgent(inspector.overview.paperclip_agent_id, "resume")
                              .then(() => loadInspectorFor(inspector.overview.paperclip_agent_id))
                              .then(() => setActionBanner({ kind: "ok", text: "Agent resumed to ACTIVE/idle." }))
                              .catch((e: Error) => setActionBanner({ kind: "err", text: e.message }))
                          }
                          className="rounded border border-emerald-400/40 bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-200"
                        >
                          Resume Agent
                        </button>
                        <button
                          type="button"
                          data-testid="inspector-wake-btn"
                          onClick={() =>
                            controlAgent(inspector.overview.paperclip_agent_id, "wake")
                              .then(() => loadInspectorFor(inspector.overview.paperclip_agent_id))
                              .then(() => setActionBanner({ kind: "ok", text: "Heartbeat wake triggered." }))
                              .catch((e: Error) => setActionBanner({ kind: "err", text: e.message }))
                          }
                          className="rounded border border-cyan-400/40 bg-cyan-500/15 px-2 py-1 text-[10px] text-cyan-200"
                        >
                          Wake Worker
                        </button>
                        {inspector.overview.current_run ? (
                          <button
                            type="button"
                            data-testid="inspector-cancel-run-btn"
                            onClick={() =>
                              cancelRun(inspector.overview.current_run!.id)
                                .then(() => loadInspectorFor(inspector.overview.paperclip_agent_id))
                                .then(() => setActionBanner({ kind: "ok", text: "Active run cancelled." }))
                                .catch((e: Error) => setActionBanner({ kind: "err", text: e.message }))
                            }
                            className="rounded border border-rose-400/50 bg-rose-500/20 px-2 py-1 text-[10px] text-rose-200"
                          >
                            Cancel Run ({inspector.overview.current_run.id.slice(0, 8)})
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {/* Assign New Task via Paperclip */}
                    <form onSubmit={handleCreateTaskSubmit} className="rounded-xl border border-cyan-500/25 bg-cyan-950/20 p-3 space-y-2">
                      <div className="font-mono text-[10px] font-bold uppercase text-cyan-300">
                        Assign Real Paperclip Task to {inspector.overview.display_name}
                      </div>
                      <input
                        data-testid="create-task-title-input"
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        placeholder="Task title (creates UNI-* issue in Paperclip)..."
                        className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white"
                      />
                      <textarea
                        data-testid="create-task-desc-input"
                        value={taskDesc}
                        onChange={(e) => setTaskDesc(e.target.value)}
                        rows={2}
                        placeholder="Detailed instructions, authorized workspace, and acceptance criteria..."
                        className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                        <select
                          value={taskPriority}
                          onChange={(e) => setTaskPriority(e.target.value)}
                          className="rounded border border-white/15 bg-slate-900 px-1.5 py-0.5 text-white"
                        >
                          <option value="high">High Priority</option>
                          <option value="medium">Medium Priority</option>
                          <option value="low">Low Priority</option>
                        </select>
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={taskWakeNow} onChange={(e) => setTaskWakeNow(e.target.checked)} />
                          Wake Worker
                        </label>
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={taskNotifyTg} onChange={(e) => setTaskNotifyTg(e.target.checked)} />
                          Notify Telegram
                        </label>
                        <button
                          type="submit"
                          data-testid="submit-task-btn"
                          className="rounded bg-cyan-600 px-2.5 py-1 font-semibold text-white hover:bg-cyan-500"
                        >
                          Dispatch Task
                        </button>
                      </div>
                    </form>

                    {/* Current Task & Feedback Comment */}
                    {inspector.current_task ? (
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 space-y-1.5">
                        <div className="font-mono text-[10px] uppercase text-amber-300">
                          Current Task: {inspector.current_task.identifier} ({inspector.current_task.status})
                        </div>
                        <div className="text-xs font-medium">{inspector.current_task.title}</div>
                        <div className="flex gap-1.5 pt-1">
                          <input
                            value={taskCommentText}
                            onChange={(e) => setTaskCommentText(e.target.value)}
                            placeholder="Send instruction / review feedback on task..."
                            className="flex-1 rounded border border-white/15 bg-slate-950 px-2 py-1 text-[11px]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!taskCommentText.trim()) return;
                              patchTask(inspector.current_task!.id, { comment: taskCommentText.trim() })
                                .then(() => {
                                  setTaskCommentText("");
                                  setActionBanner({ kind: "ok", text: "Feedback saved on Paperclip issue." });
                                })
                                .catch((e: Error) => setActionBanner({ kind: "err", text: e.message }));
                            }}
                            className="rounded border border-cyan-400/40 bg-cyan-500/20 px-2 py-1 text-[10px] text-cyan-200"
                          >
                            Send
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {/* Skills, Tools, Workspaces, Performance & Budget */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
                        <div className="font-mono text-[9px] uppercase text-slate-400">Skills &amp; Authorized Tools</div>
                        <div className="mt-1 text-[10px] text-cyan-200">{inspector.overview.skills.join(", ")}</div>
                        <div className="mt-1 text-[10px] text-slate-400">{inspector.overview.authorized_tools.join(", ")}</div>
                        <div className="mt-1 font-mono text-[9px] text-emerald-300">
                          Scope: {inspector.overview.authorized_workspaces.join(", ")}
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
                        <div className="font-mono text-[9px] uppercase text-slate-400">Performance &amp; Budget</div>
                        <div className="mt-1 text-[10px]">
                          Tasks Done: <strong>{inspector.performance.completed_tasks}</strong> · Runs: <strong>{inspector.performance.run_count}</strong>
                        </div>
                        <div className="text-[10px]">
                          Tokens: <strong>{inspector.budget.usage.total_tokens}</strong> · Retry Rate: <strong>{inspector.performance.retry_rate}</strong>
                        </div>
                        <div className="mt-1 font-mono text-[9px] text-amber-300">
                          {inspector.budget.usage.cost_label} · {inspector.budget.usage.usage_classification}
                        </div>
                      </div>
                    </div>

                    {/* Sanitized Execution Logs */}
                    <div className="rounded-xl border border-white/10 bg-black/50 p-2.5">
                      <div className="font-mono text-[9px] uppercase text-slate-400">
                        Sanitized Worker Execution Logs (Secret-Redacted)
                      </div>
                      <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-emerald-200/85">
                        {inspector.sanitized_logs || "No recent worker execution output recorded."}
                      </pre>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-white/10 p-4 text-center text-slate-400">
                    Click any AI employee avatar in the 3D office or select one above to inspect live telemetry and dispatch tasks.
                  </div>
                )}
              </div>
            ) : null}

            {/* TAB 3: MULTI-AGENT COLLABORATION & VIRTUAL MEETING ROOM */}
            {activeTab === "collaboration" ? (
              <div className="space-y-3" data-testid="collaboration-panel">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
                  <div className="font-mono text-[10px] font-bold uppercase text-cyan-300">
                    Verified Parent-Child Task Delegations ({snapshot?.collaboration.edges.length ?? 0})
                  </div>
                  {(snapshot?.collaboration.edges ?? []).length === 0 ? (
                    <div className="text-[11px] text-slate-400">No parent-child task delegations recorded yet.</div>
                  ) : (
                    (snapshot?.collaboration.edges ?? []).slice(0, 15).map((edge) => {
                      const fromName = agents.find((a) => a.paperclip_agent_id === edge.from_agent_id)?.display_name || edge.from_agent_id.slice(0, 8);
                      const toName = agents.find((a) => a.paperclip_agent_id === edge.to_agent_id)?.display_name || edge.to_agent_id.slice(0, 8);
                      return (
                        <div key={edge.edge_id} className="rounded border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11px]">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-cyan-200">
                              {fromName} ➔ {toName}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">{edge.status}</span>
                          </div>
                          <div className="text-slate-300">
                            {edge.parent_identifier} → <strong>{edge.child_identifier}</strong>: {edge.title}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Authorized Bounded Coordination Meeting Creator */}
                <div className="rounded-xl border border-cyan-500/25 bg-cyan-950/20 p-3 space-y-2">
                  <div className="font-mono text-[10px] font-bold uppercase text-cyan-300">
                    Schedule Authorized Paperclip Coordination Meeting (Bounded Turns &amp; Timeout)
                  </div>
                  <input
                    value={mtgTitle}
                    onChange={(e) => setMtgTitle(e.target.value)}
                    placeholder="Meeting title..."
                    className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-xs"
                  />
                  <textarea
                    value={mtgAgenda}
                    onChange={(e) => setMtgAgenda(e.target.value)}
                    rows={2}
                    placeholder="Authorized workflow agenda & concrete deliverables..."
                    className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-xs"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">
                      Participants ({mtgParticipants.length}/{agents.length}):
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        data-testid="select-all-11-agents-btn"
                        onClick={() => setMtgParticipants(agents.map((a) => a.paperclip_agent_id))}
                        className="rounded border border-cyan-400/40 bg-cyan-500/15 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/25"
                      >
                        Select All {agents.length} Agents
                      </button>
                      <button
                        type="button"
                        onClick={() => setMtgParticipants([])}
                        className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-slate-400 hover:text-white"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {agents.map((a) => {
                      const checked = mtgParticipants.includes(a.paperclip_agent_id);
                      return (
                        <button
                          key={a.paperclip_agent_id}
                          type="button"
                          onClick={() =>
                            setMtgParticipants((prev) =>
                              checked ? prev.filter((x) => x !== a.paperclip_agent_id) : [...prev, a.paperclip_agent_id]
                            )
                          }
                          className={`rounded border px-2 py-0.5 text-[10px] ${
                            checked ? "border-cyan-400 bg-cyan-500/25 text-cyan-100" : "border-white/15 text-slate-400"
                          }`}
                        >
                          {a.display_name}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    data-testid="start-authorized-meeting-btn"
                    onClick={() => {
                      const chosen = mtgParticipants.length >= 2 ? mtgParticipants : agents.map((a) => a.paperclip_agent_id);
                      createMeeting({
                        title: mtgTitle || "All-Hands Coordination Sync",
                        agenda: mtgAgenda || "Sinkronisasi arsitektur, keamanan, dan eksekusi lintas departemen.",
                        participant_agent_ids: chosen,
                        max_turns: 3,
                        timeout_sec: 180,
                      })
                        .then(() => {
                          setMtgTitle("");
                          setMtgAgenda("");
                          setActionBanner({
                            kind: "ok",
                            text: `Meeting started — ${chosen.length} agents gathering in 3D Meeting Room!`,
                          });
                        })
                        .catch((e: Error) => setActionBanner({ kind: "err", text: e.message }));
                    }}
                    className="rounded bg-cyan-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-cyan-500"
                  >
                    Gather in 3D Meeting Room &amp; Start Sync
                  </button>
                </div>

                {/* Active & Past Meetings */}
                {(snapshot?.collaboration.meetings ?? []).map((m) => (
                  <div key={m.meeting_id} className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">
                        {m.title} ({m.paperclip_identifier || m.meeting_id})
                      </span>
                      <span className="font-mono text-[10px] text-emerald-300">{m.status}</span>
                    </div>
                    <div className="text-[11px] text-slate-300">Agenda: {m.agenda}</div>
                    <div className="text-[10px] text-slate-400">
                      Participants: {m.participants.map((p) => p.display_name).join(", ")} · Max Turns: {m.max_turns}
                    </div>
                    <div className="text-[10px] text-cyan-200">Summary: {m.summary}</div>
                    {m.status === "ACTIVE" ? (
                      <button
                        type="button"
                        onClick={() =>
                          completeMeeting(m.meeting_id, "Action items verified and recorded in Paperclip.", ["Proceed on isolated Git branch"])
                            .then(() => setActionBanner({ kind: "ok", text: "Meeting completed & archived." }))
                            .catch((e: Error) => setActionBanner({ kind: "err", text: e.message }))
                        }
                        className="mt-1 rounded border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200"
                      >
                        Conclude &amp; Save Summary
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {/* TAB 4: VULNCLAW DEFENSIVE SECURITY OPERATIONS CENTER */}
            {activeTab === "security" ? (
              <div className="space-y-3" data-testid="security-center-panel">
                <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold uppercase text-rose-300">
                      VulnClaw Defensive Security Center
                    </span>
                    <span className="rounded border border-emerald-400/40 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] text-emerald-200">
                      {snapshot?.security_center.trust_boundary || "ISOLATED_DEFENSIVE_READONLY"}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-center font-mono text-[11px]">
                    <div className="rounded bg-black/40 p-1.5">
                      <div className="text-slate-400 text-[9px]">TOTAL</div>
                      <div className="font-bold text-white">{snapshot?.security_center.summary.total ?? 0}</div>
                    </div>
                    <div className="rounded bg-black/40 p-1.5">
                      <div className="text-rose-300 text-[9px]">OPEN</div>
                      <div className="font-bold text-rose-200">{snapshot?.security_center.summary.open ?? 0}</div>
                    </div>
                    <div className="rounded bg-black/40 p-1.5">
                      <div className="text-emerald-300 text-[9px]">RESOLVED</div>
                      <div className="font-bold text-emerald-200">{snapshot?.security_center.summary.resolved ?? 0}</div>
                    </div>
                    <div className="rounded bg-black/40 p-1.5">
                      <div className="text-amber-300 text-[9px]">FALSE POS</div>
                      <div className="font-bold text-amber-200">{snapshot?.security_center.summary.false_positives ?? 0}</div>
                    </div>
                  </div>
                </div>

                {(snapshot?.security_center.findings ?? []).map((f) => (
                  <div key={f.finding_id} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-bold text-amber-200">
                        {f.finding_id} · [{f.severity}] {f.cwe_reference || "STATIC"}
                      </span>
                      <span className="rounded border border-white/15 bg-black/40 px-1.5 py-0.5 font-mono text-[9px] text-cyan-200">
                        {f.verification_status}
                      </span>
                    </div>
                    <div className="font-semibold text-white">{f.finding_title}</div>
                    <div className="text-[10px] text-slate-400">
                      Project: {f.project_id} · Component: {f.affected_component} · Reviewer: {f.assigned_reviewer}
                    </div>
                    <div className="rounded bg-black/50 p-1.5 font-mono text-[10px] text-slate-300">
                      Evidence (Sanitized Data Literal): {f.sanitized_evidence}
                    </div>
                    <div className="text-[10px] text-emerald-200/90">Fix: {f.remediation_recommendation}</div>
                    <div className="font-mono text-[9px] text-slate-400">
                      Review Task: {f.paperclip_review_issue_id?.slice(0, 8) || "N/A"} · Remediation Task:{" "}
                      {f.paperclip_remediation_issue_id?.slice(0, 8) || "N/A"}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* TAB 5: APPROVAL, GOVERNANCE & BUDGET CONTROL */}
            {activeTab === "governance" ? (
              <div className="space-y-3" data-testid="governance-budget-panel">
                {/* Emergency Stop & Wave-1 Resume */}
                <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 space-y-2">
                  <div className="font-mono text-[10px] font-bold uppercase text-amber-300">
                    Executive Governance &amp; Emergency Fleet Control
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      data-testid="emergency-stop-btn"
                      onClick={() =>
                        runGovernanceCommand("emergency-stop")
                          .then(() => setActionBanner({ kind: "ok", text: "EMERGENCY STOP executed: all active runs cancelled & agents paused." }))
                          .catch((e: Error) => setActionBanner({ kind: "err", text: e.message }))
                      }
                      className="flex-1 rounded border border-rose-400/60 bg-rose-600/30 py-1.5 font-mono text-[10px] font-bold uppercase text-rose-100 hover:bg-rose-600/50"
                    >
                      ⛔ Emergency Stop All
                    </button>
                    <button
                      type="button"
                      data-testid="resume-wave1-btn"
                      onClick={() =>
                        runGovernanceCommand("resume-wave1")
                          .then(() => setActionBanner({ kind: "ok", text: "Wave-1 Core Agents (CEO, Backend, QA, Security) resumed." }))
                          .catch((e: Error) => setActionBanner({ kind: "err", text: e.message }))
                      }
                      className="flex-1 rounded border border-emerald-400/50 bg-emerald-600/25 py-1.5 font-mono text-[10px] font-bold uppercase text-emerald-100 hover:bg-emerald-600/40"
                    >
                      ▶ Resume Wave-1 Fleet
                    </button>
                  </div>
                </div>

                {/* Budget & Unpriced Usage Transparency */}
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold uppercase text-cyan-300">Budget &amp; Token Telemetry</span>
                    <span
                      data-testid="cost-transparency-badge"
                      className="rounded border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-200"
                    >
                      {snapshot?.governance_budget?.cost_transparency_status || "COST UNKNOWN"} ·{" "}
                      {snapshot?.governance_budget?.usage_mode_label || "UNPRICED USAGE"}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-300">
                    Model: <code>{snapshot?.governance_budget?.provider_model || "combo/X"}</code> · Observed Tokens:{" "}
                    <strong>{snapshot?.governance_budget?.total_observed_tokens ?? 0}</strong> · Total Run Time:{" "}
                    <strong>{Math.round((snapshot?.governance_budget?.total_execution_duration_ms ?? 0) / 1000)}s</strong>
                  </div>
                  <div className="max-h-44 overflow-y-auto space-y-1">
                    {(snapshot?.governance_budget?.policies ?? []).map((p) => (
                      <div key={p.policy_id} className="flex items-center justify-between rounded bg-black/30 px-2 py-1 text-[10px]">
                        <span>
                          {p.scope_name} <span className="text-slate-500">({p.scope_type})</span>
                        </span>
                        <span className="font-mono text-amber-200">
                          Quota: {p.quota_cents}¢ · Events: {p.unpriced_event_count} · {p.usage_label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Approval Center */}
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
                  <div className="font-mono text-[10px] font-bold uppercase text-cyan-300">
                    Paperclip Approval Center ({snapshot?.approvals.length ?? 0})
                  </div>
                  {(snapshot?.approvals ?? []).length === 0 ? (
                    <div className="text-[11px] text-slate-400">
                      No open Paperclip approval records. Production deploy gates remain enforced via Paperclip &amp; the configured Telegram Owner.
                    </div>
                  ) : (
                    (snapshot?.approvals ?? []).map((ap) => (
                      <div key={ap.id} className="rounded border border-white/10 bg-black/30 p-2 space-y-1">
                        <div className="flex justify-between font-mono text-[10px]">
                          <span>{ap.id.slice(0, 12)} ({ap.type || "gate"})</span>
                          <span className="text-amber-300">{ap.status}</span>
                        </div>
                        {ap.status === "pending" ? (
                          <div className="flex gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => void resolveApproval(ap.id, "approve", "Approved by Owner in Hermes3D")}
                              className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] text-white"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void resolveApproval(ap.id, "reject", "Rejected by Owner in Hermes3D")}
                              className="rounded bg-rose-600 px-2 py-0.5 text-[10px] text-white"
                            >
                              Reject
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {/* TAB 6: UNIFIED DASHBOARD, HEALTH, KANBAN & EVIDENCE VIEWER */}
            {activeTab === "dashboard" ? (
              <div className="space-y-3" data-testid="company-dashboard-panel">
                {/* KPI Overview */}
                <div className="grid grid-cols-3 gap-1.5 text-center font-mono text-[10px]">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <div className="text-slate-400">AGENTS</div>
                    <div className="text-sm font-bold text-white">
                      {snapshot?.overview.active_agents}/{snapshot?.overview.total_agents}
                    </div>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <div className="text-slate-400">TASKS DONE</div>
                    <div className="text-sm font-bold text-emerald-300">{snapshot?.overview.completed_tasks}</div>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <div className="text-slate-400">PROJECTS</div>
                    <div className="text-sm font-bold text-cyan-300">{snapshot?.overview.total_projects}</div>
                  </div>
                </div>

                {/* 12-Component Functional Operational Health */}
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold uppercase text-cyan-300">
                      12-Component Functional Health
                    </span>
                    <span className="font-mono text-[10px] text-emerald-300">
                      {String((healthMatrix as { overall_state?: string })?.overall_state || "CHECKING...")}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 font-mono text-[9px]">
                    {Object.entries(
                      ((healthMatrix as { components?: Record<string, { state: string }> })?.components) || {}
                    ).map(([name, info]) => (
                      <div key={name} className="flex items-center justify-between rounded bg-black/40 px-2 py-1">
                        <span className="text-slate-300">{name}</span>
                        <span
                          className={
                            info.state === "HEALTHY"
                              ? "text-emerald-300 font-bold"
                              : info.state === "MAINTENANCE"
                                ? "text-fuchsia-300"
                                : "text-amber-300"
                          }
                        >
                          {info.state}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Authorized Workspace Evidence Viewer */}
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 space-y-2">
                  <div className="font-mono text-[10px] font-bold uppercase text-cyan-300">
                    Authorized Workspace &amp; Git Evidence Viewer
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      data-testid="evidence-target-input"
                      value={evidenceTarget}
                      onChange={(e) => setEvidenceTarget(e.target.value)}
                      placeholder="Workspace name (e.g. acceptance-invoice-app)"
                      className="flex-1 rounded border border-white/15 bg-slate-950 px-2 py-1 font-mono text-[11px]"
                    />
                    <button
                      type="button"
                      data-testid="load-evidence-btn"
                      onClick={() =>
                        fetchEvidence(evidenceTarget)
                          .then((ev) => setEvidenceResult(ev as Record<string, unknown>))
                          .catch((e: Error) => setActionBanner({ kind: "err", text: e.message }))
                      }
                      className="rounded bg-cyan-600 px-2.5 py-1 text-[10px] font-semibold text-white"
                    >
                      Inspect
                    </button>
                  </div>
                  {evidenceResult ? (
                    <pre
                      data-testid="evidence-viewer-output"
                      className="max-h-40 overflow-auto rounded bg-black/60 p-2 font-mono text-[9px] text-cyan-100"
                    >
                      {JSON.stringify(evidenceResult, null, 2)}
                    </pre>
                  ) : null}
                </div>

                {/* Live Normalized Event Feed (`schema_version: 1.0`) */}
                <div className="rounded-xl border border-white/10 bg-black/40 p-2.5 space-y-1">
                  <div className="font-mono text-[9px] uppercase text-slate-400">
                    Normalized Event Stream v1.0 ({events.length} buffered)
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1 font-mono text-[9px]">
                    {[...events].reverse().slice(0, 20).map((ev) => (
                      <div key={ev.event_id} className="rounded bg-white/[0.03] px-1.5 py-0.5 text-slate-300">
                        <span className="text-cyan-300">#{ev.sequence}</span>{" "}
                        <span className="text-amber-200">{ev.event_type}</span>{" "}
                        <span className="text-slate-500">[{ev.source}]</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
