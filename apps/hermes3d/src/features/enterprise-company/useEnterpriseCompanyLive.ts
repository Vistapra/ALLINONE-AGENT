"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentInspectorPayload,
  EnterpriseSnapshot,
  NormalizedOfficeEvent,
} from "./types";

export type BrowserPerfSample = {
  fps: number;
  frameTimeMs: number;
  jsHeapMb: number | null;
};

export function useEnterpriseCompanyLive(enabled: boolean = true) {
  const [snapshot, setSnapshot] = useState<EnterpriseSnapshot | null>(null);
  const [events, setEvents] = useState<NormalizedOfficeEvent[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [perf, setPerf] = useState<BrowserPerfSample>({ fps: 60, frameTimeMs: 16.7, jsHeapMb: null });

  const latestSeqRef = useRef<number>(0);
  const seenEventIdsRef = useRef<Set<string>>(new Set());

  const fetchSnapshot = useCallback(async (forceRefresh = false) => {
    try {
      const qs = forceRefresh ? "?refresh=1" : "";
      const res = await fetch(`/api/company/snapshot${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        setLastError(errBody.error || `Snapshot HTTP ${res.status}`);
        return null;
      }
      const data = (await res.json()) as EnterpriseSnapshot;
      setSnapshot(data);
      if (data.event_stream?.latest_sequence > latestSeqRef.current) {
        latestSeqRef.current = data.event_stream.latest_sequence;
      }
      setLastError(null);
      return data;
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Network error");
      return null;
    }
  }, []);

  // Live Normalized Event WebSocket with exponential backoff reconnect & reconciliation
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffStep = 0;

    const appendUniqueEvents = (incoming: NormalizedOfficeEvent[]) => {
      if (!incoming.length) return;
      setEvents((prev) => {
        const next = [...prev];
        for (const ev of incoming) {
          if (!ev?.event_id || seenEventIdsRef.current.has(ev.event_id)) continue;
          seenEventIdsRef.current.add(ev.event_id);
          if (seenEventIdsRef.current.size > 600) {
            const first = seenEventIdsRef.current.values().next().value;
            if (first) seenEventIdsRef.current.delete(first);
          }
          if (ev.sequence > latestSeqRef.current) {
            latestSeqRef.current = ev.sequence;
          }
          next.push(ev);
        }
        return next.slice(-100);
      });
    };

    const connectWs = () => {
      if (cancelled) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${proto}//${window.location.host}/api/company/events/ws?sinceSeq=${latestSeqRef.current}`;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        if (cancelled) return;
        backoffStep = 0;
        setWsConnected(true);
        setLastError(null);
      };

      ws.onmessage = (msg) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(String(msg.data)) as {
            type?: string;
            snapshot?: EnterpriseSnapshot;
            replay_events?: NormalizedOfficeEvent[];
            event?: NormalizedOfficeEvent;
          };
          if (parsed.type === "snapshot.reconcile" && parsed.snapshot) {
            setSnapshot(parsed.snapshot);
            if (Array.isArray(parsed.replay_events)) {
              appendUniqueEvents(parsed.replay_events);
            }
          } else if (parsed.type === "office.event" && parsed.event) {
            appendUniqueEvents([parsed.event]);
            if (parsed.event.event_type === "meeting.started" || parsed.event.event_type === "meeting.completed") {
              window.dispatchEvent(new CustomEvent("enterprise-office:standup-sync", { detail: parsed.event }));
              if (parsed.event.event_type === "meeting.started") {
                window.dispatchEvent(
                  new CustomEvent("enterprise-office:command", {
                    detail: { type: "flyToCanvas", deptId: "meeting_room", x: 145, y: 118, zoom: 72 },
                  })
                );
              }
            }
            // Refresh snapshot smoothly when structural state changes
            void fetchSnapshot(false);
          } else if (parsed.type === "resync_required") {
            void fetchSnapshot(true);
          }
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setWsConnected(false);
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      const delays = [1000, 2000, 4500, 9000, 15000];
      const wait = delays[Math.min(backoffStep, delays.length - 1)];
      backoffStep += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWs();
      }, wait);
    };

    void fetchSnapshot(false);
    connectWs();

    // Bounded fallback reconciliation poll (every 5s while tab visible)
    const fallbackInterval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchSnapshot(false);
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(fallbackInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {}
    };
  }, [enabled, fetchSnapshot]);

  // Lightweight RAF FPS + JS Heap sampler (updates once every 2.5s, pauses when tab hidden)
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let rafId = 0;
    let frames = 0;
    let windowStart = performance.now();

    const tick = (now: number) => {
      frames += 1;
      const elapsed = now - windowStart;
      if (elapsed >= 2500) {
        const fps = Math.round((frames * 1000) / elapsed);
        const frameTimeMs = Number((elapsed / Math.max(frames, 1)).toFixed(1));
        const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
        const jsHeapMb = mem?.usedJSHeapSize ? Number((mem.usedJSHeapSize / (1024 * 1024)).toFixed(1)) : null;
        setPerf({ fps, frameTimeMs, jsHeapMb });
        frames = 0;
        windowStart = now;
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [enabled]);

  // --- Authorized API Helpers ---

  const fetchAgentInspector = useCallback(async (agentId: string): Promise<AgentInspectorPayload> => {
    const res = await fetch(`/api/company/agents/${encodeURIComponent(agentId)}`, { cache: "no-store" });
    const data = (await res.json()) as { ok: boolean; inspector?: AgentInspectorPayload; error?: string };
    if (!res.ok || !data.inspector) throw new Error(data.error || "Failed to load agent inspector.");
    return data.inspector;
  }, []);

  const createTask = useCallback(
    async (payload: {
      title: string;
      description: string;
      assignee_agent_id?: string | null;
      project_id?: string | null;
      priority?: string;
      wake_immediately?: boolean;
      notify_telegram_immediately?: boolean;
      idempotency_key?: string;
    }) => {
      const res = await fetch("/api/company/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create task.");
      await fetchSnapshot(true);
      return data;
    },
    [fetchSnapshot]
  );

  const patchTask = useCallback(
    async (taskId: string, patch: Record<string, unknown>) => {
      const res = await fetch(`/api/company/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update task.");
      await fetchSnapshot(true);
      return data;
    },
    [fetchSnapshot]
  );

  const controlAgent = useCallback(
    async (agentId: string, action: "pause" | "resume" | "wake") => {
      const res = await fetch(`/api/company/agents/${encodeURIComponent(agentId)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${action} agent.`);
      await fetchSnapshot(true);
      return data;
    },
    [fetchSnapshot]
  );

  const cancelRun = useCallback(
    async (runId: string) => {
      const res = await fetch(`/api/company/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel run.");
      await fetchSnapshot(true);
      return data;
    },
    [fetchSnapshot]
  );

  const createMeeting = useCallback(
    async (payload: {
      title: string;
      agenda: string;
      target_path?: string | null;
      participant_agent_ids: string[];
      max_turns?: number;
      timeout_sec?: number;
    }) => {
      const res = await fetch("/api/company/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create meeting.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("enterprise-office:standup-sync"));
        window.dispatchEvent(
          new CustomEvent("enterprise-office:command", {
            detail: { type: "flyToCanvas", deptId: "meeting_room", x: 145, y: 118, zoom: 72 },
          })
        );
      }
      await fetchSnapshot(true);
      return data;
    },
    [fetchSnapshot]
  );

  const completeMeeting = useCallback(
    async (meetingId: string, summary: string, decisions: string[]) => {
      const res = await fetch(`/api/company/meetings/${encodeURIComponent(meetingId)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, decisions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to complete meeting.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("enterprise-office:standup-sync"));
      }
      await fetchSnapshot(true);
      return data;
    },
    [fetchSnapshot]
  );

  const resolveApproval = useCallback(
    async (approvalId: string, decision: "approve" | "reject", note: string) => {
      const res = await fetch(`/api/company/approvals/${encodeURIComponent(approvalId)}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resolve approval.");
      await fetchSnapshot(true);
      return data;
    },
    [fetchSnapshot]
  );

  const runGovernanceCommand = useCallback(
    async (cmd: "emergency-stop" | "resume-wave1") => {
      const res = await fetch(`/api/company/${cmd}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Governance action ${cmd} failed.`);
      await fetchSnapshot(true);
      return data;
    },
    [fetchSnapshot]
  );

  const fetchHealthMatrix = useCallback(async () => {
    const res = await fetch("/api/company/health", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Health check failed.");
    return data;
  }, []);

  const fetchEvidence = useCallback(async (target: string) => {
    const res = await fetch(`/api/company/evidence?target=${encodeURIComponent(target)}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Evidence access denied or unavailable.");
    return data.evidence;
  }, []);

  return {
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
  };
}
