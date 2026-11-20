"use strict";

/**
 * METHOD 2 & PART OF METHOD 3 — Exhaustive Feature-by-Feature & 11-Agent Conversational Suite.
 * Tests every HTTP route, Same-Origin Proxy, Access Gate, CSRF/SSRF/Path-Jail, Dual WebSockets,
 * Gateway v3 RPC methods, Kanban, Meetings, SOC, Governance, Emergency-Stop/Resume-Wave1,
 * Health, Evidence Viewer, AND live `chat.send` + `chat.history` across ALL 11 AI Employees!
 */

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { loadWsModule } = require(`${ALLINONE_HOME}\\office-bridge\\contracts\\ws-loader`);
const { sanitizeText } = require(`${ALLINONE_HOME}\\office-bridge\\contracts\\redaction`);
const ALLINONE_HOME = process.env.ALLINONE_HOME || require("os").homedir() + "/ALLINONE-AGENT";
const ALLINONE_HERMES_HOME = process.env.ALLINONE_HERMES_HOME || require("os").homedir() + "/AppData/Local/hermes";


const { WebSocket } = loadWsModule();
const AUTH_PATH = `${ALLINONE_HOME}\\config\\secrets\\office-bridge-auth.json`;
const REPORT_OUT = `${ALLINONE_HOME}\\reports\\exhaustive-feature-matrix.json`;

const H3D = "http://127.0.0.1:3200";
const BRIDGE = "http://127.0.0.1:3210";

async function main() {
  const secrets = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
  const bridgeToken = secrets.bridgeToken;
  const studioToken = secrets.studioAccessToken;

  const results = [];
  let cookieHeader = "";

  async function check(id, category, feature, fn) {
    const t0 = performance.now();
    try {
      const detail = await fn();
      const ms = Math.round((performance.now() - t0) * 10) / 10;
      results.push({ id, category, feature, status: "PASS", duration_ms: ms, detail: sanitizeText(String(detail)) });
      console.log(`[PASS] ${id} (${ms}ms): ${feature} -> ${sanitizeText(String(detail)).slice(0, 110)}`);
    } catch (err) {
      const ms = Math.round((performance.now() - t0) * 10) / 10;
      const msg = sanitizeText(err.stack || err.message || String(err));
      results.push({ id, category, feature, status: "FAIL", duration_ms: ms, detail: msg.slice(0, 300) });
      console.error(`[FAIL] ${id} (${ms}ms): ${feature} -> ${msg.slice(0, 180)}`);
    }
  }

  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg || "Assertion failed");
  };

  // --- 1. Access Gate, Login, Cookie & Same-Origin Security ---
  await check("F01", "Access Gate", "GET /login renders Owner authentication gate", async () => {
    const r = await fetch(`${H3D}/login`);
    const html = await r.text();
    assert(r.status === 200 && html.includes("Unified Autonomous AI Company"), `Unexpected HTTP ${r.status}`);
    return `HTTP 200 (${html.length} bytes)`;
  });

  await check("F02", "Access Gate", "Unauthenticated GET /office redirects to /login (302)", async () => {
    const r = await fetch(`${H3D}/office`, { headers: { Accept: "text/html" }, redirect: "manual" });
    assert(r.status === 302 && r.headers.get("location") === "/login", `Got ${r.status} loc=${r.headers.get("location")}`);
    return `HTTP 302 -> /login`;
  });

  await check("F03", "Access Gate", "Invalid Studio token rejected with 401", async () => {
    const r = await fetch(`${H3D}/api/studio-auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "st_tok_invalid_attempt" }),
    });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
    return `HTTP 401 Unauthorized`;
  });

  await check("F04", "Access Gate", "Valid Studio token issues 30-day HttpOnly SameSite=Strict cookie", async () => {
    const r = await fetch(`${H3D}/api/studio-auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: studioToken }),
    });
    const setCookie = r.headers.get("set-cookie") || "";
    assert(r.status === 200 && setCookie.includes("HttpOnly") && setCookie.includes("SameSite=Strict") && setCookie.includes("Max-Age=2592000"), `Bad cookie: ${setCookie}`);
    cookieHeader = setCookie.split(";")[0];
    return `Cookie issued (HttpOnly; SameSite=Strict; Max-Age=2592000)`;
  });

  await check("F05", "Access Gate", "Authenticated GET /office serves 3D Virtual Office app", async () => {
    const r = await fetch(`${H3D}/office`, { headers: { Cookie: cookieHeader, Accept: "text/html" } });
    assert(r.status === 200, `Got HTTP ${r.status}`);
    return `HTTP 200 OK`;
  });

  await check("F06", "Proxy & Security", "Same-origin proxy GET /api/company/snapshot returns 11 real employees", async () => {
    const r = await fetch(`${H3D}/api/company/snapshot`, { headers: { Cookie: cookieHeader } });
    const d = await r.json();
    assert(r.status === 200 && d.agents?.length === 11, `Got ${r.status} agents=${d.agents?.length}`);
    return `11/11 agents loaded via /api/company/snapshot`;
  });

  await check("F07", "Proxy & Security", "CSRF protection blocks cross-origin POST /api/company/tasks (403)", async () => {
    const r = await fetch(`${H3D}/api/company/tasks`, {
      method: "POST",
      headers: { Cookie: cookieHeader, Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "CSRF attempt" }),
    });
    assert(r.status === 403, `Expected 403, got ${r.status}`);
    return `Cross-origin mutation blocked (HTTP 403)`;
  });

  await check("F08", "Upstream Hardening", "SSRF guard on /api/runtime/custom blocks external hosts", async () => {
    const r = await fetch(`${H3D}/api/runtime/custom`, {
      method: "POST",
      headers: { Cookie: cookieHeader, Origin: H3D, "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: "http://example.com:8080", path: "/health", method: "GET" }),
    });
    assert(r.status === 400 || r.status === 403, `Expected 400/403, got ${r.status}`);
    return `External SSRF blocked (HTTP ${r.status})`;
  });

  await check("F09", "Upstream Hardening", "Host skill deletion route /api/gateway/skills/remove locked (403)", async () => {
    const r = await fetch(`${H3D}/api/gateway/skills/remove`, {
      method: "POST",
      headers: { Cookie: cookieHeader, Origin: H3D, "Content-Type": "application/json" },
      body: JSON.stringify({ skillKey: "test" }),
    });
    assert(r.status === 403, `Expected 403, got ${r.status}`);
    return `Locked (HTTP 403)`;
  });

  await check("F10", "Upstream Hardening", "Arbitrary path mutation route /api/gateway/agent-state locked (403)", async () => {
    const r = await fetch(`${H3D}/api/gateway/agent-state`, {
      method: "POST",
      headers: { Cookie: cookieHeader, Origin: H3D, "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "test" }),
    });
    assert(r.status === 403, `Expected 403, got ${r.status}`);
    return `Locked (HTTP 403)`;
  });

  await check("F11", "Upstream Hardening", "Directory autocomplete /api/path-suggestions blocks C:/Windows", async () => {
    const r = await fetch(`${H3D}/api/path-suggestions?q=${encodeURIComponent("C:\\Windows\\")}`, {
      headers: { Cookie: cookieHeader },
    });
    assert(r.status === 403 || r.status === 400 || (await r.json()).suggestions?.length === 0, `Unexpected status ${r.status}`);
    return `C:\\Windows jailed (HTTP ${r.status})`;
  });

  // --- 2. Custom Runtime HTTP Seam ---
  await check("F12", "Custom Runtime Seam", "Office Bridge /health, /state, and /registry endpoints", async () => {
    const h = await (await fetch(`${BRIDGE}/health`)).json();
    const st = await (await fetch(`${BRIDGE}/state`, { headers: { Authorization: `Bearer ${bridgeToken}` } })).json();
    const reg = await (await fetch(`${BRIDGE}/registry`, { headers: { Authorization: `Bearer ${bridgeToken}` } })).json();
    assert(h.ok && st.runtime?.active_model === "combo/X" && reg.models?.["combo/X"], "Invalid seam payload");
    return `/health + /state + /registry verified (combo/X)`;
  });

  await check("F13", "Custom Runtime Seam", "POST /v1/chat/completions answers in Bahasa Indonesia via combo/X", async () => {
    const r = await fetch(`${BRIDGE}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bridgeToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Halo singkat saja, siapa nama jabatanmu?" }] }),
    });
    const d = await r.json();
    const reply = d.choices?.[0]?.message?.content || "";
    assert(r.status === 200 && reply.length > 10 && !reply.includes("koneksi model lambat"), `Bad completion: ${JSON.stringify(d)}`);
    return reply.replace(/\s+/g, " ").slice(0, 95);
  });

  // --- 3. Proxied Hermes3D Gateway WebSocket (`ws://127.0.0.1:3200/api/gateway/ws`) & ALL RPC Methods ---
  const gwWs = new WebSocket("ws://127.0.0.1:3200/api/gateway/ws", {
    headers: { Cookie: cookieHeader, Origin: H3D },
  });
  const gwPending = new Map();
  let gwReqCounter = 1;

  const gwCall = (method, params = {}, timeoutMs = 45_000) =>
    new Promise((resolve, reject) => {
      const id = `req-${gwReqCounter++}`;
      const t = setTimeout(() => {
        gwPending.delete(id);
        reject(new Error(`WS RPC timeout on ${method}`));
      }, timeoutMs);
      gwPending.set(id, {
        resolve: (frame) => {
          clearTimeout(t);
          resolve(frame);
        },
      });
      gwWs.send(JSON.stringify({ type: "req", id, method, params }));
    });

  await check("F14", "Gateway WS v3", "Browser-proxied Gateway WS handshake (server-side token injection)", async () => {
    await new Promise((resolve, reject) => {
      gwWs.on("message", (raw) => {
        const frame = JSON.parse(raw.toString("utf8"));
        if (frame.type === "event" && frame.event === "connect.challenge") {
          // Intentionally omit auth.token to verify server-side token injection in gateway-proxy.js!
          gwCall("connect", { client: { id: "exhaustive-verifier", mode: "webchat" }, scopes: ["operator.admin"] })
            .then((res) => {
              if (res.ok) resolve();
              else reject(new Error(JSON.stringify(res.error)));
            })
            .catch(reject);
        } else if (frame.type === "res" && gwPending.has(frame.id)) {
          const entry = gwPending.get(frame.id);
          gwPending.delete(frame.id);
          entry.resolve(frame);
        }
      });
      gwWs.on("error", reject);
    });
    return `Connected via /api/gateway/ws without client-exposed token`;
  });

  let gwAgentList = [];
  await check("F15", "Gateway WS v3", "RPC agents.list returns all 11 canonical Paperclip agents", async () => {
    const res = await gwCall("agents.list", {});
    assert(res.ok && res.payload?.agents?.length === 11, `Expected 11, got ${res.payload?.agents?.length}`);
    gwAgentList = res.payload.agents;
    return `11/11 agents (${gwAgentList.map((a) => a.name).join(", ")})`;
  });

  await check("F16", "Gateway WS v3", "RPC status returns active session map for all 11 agents", async () => {
    const res = await gwCall("status", {});
    assert(res.ok && res.payload?.sessions?.byAgent?.length === 11, "Invalid status sessions");
    return `byAgent=11`;
  });

  await check("F17", "Gateway WS v3", "RPC models.list returns combo/X", async () => {
    const res = await gwCall("models.list", {});
    assert(res.ok && res.payload?.models?.[0]?.id === "combo/X", "Missing combo/X");
    return `model=combo/X`;
  });

  await check("F18", "Gateway WS v3", "RPC skills.status returns TypeScript-compliant SkillStatusEntry[]", async () => {
    const res = await gwCall("skills.status", {});
    assert(res.ok && res.payload?.skills?.every((s) => Boolean(s.skillKey)), "Missing skillKey");
    return `skills=${res.payload.skills.length}`;
  });

  await check("F19", "Gateway WS v3", "RPC cron.list returns 03:00 Asia/Jakarta maintenance schedule", async () => {
    const res = await gwCall("cron.list", {});
    assert(res.ok && res.payload?.jobs?.[0]?.schedule?.tz === "Asia/Jakarta", "Missing cron job");
    return `job=${res.payload.jobs[0].id} (0 3 * * * Asia/Jakarta)`;
  });

  await check("F20", "Gateway WS v3", "RPC config.get and exec.approvals.get", async () => {
    const c = await gwCall("config.get", {});
    const a = await gwCall("exec.approvals.get", {});
    assert(c.ok && a.ok && a.payload?.file?.defaults?.security === "governed", "Invalid config/approvals");
    return `config.get + exec.approvals.get OK`;
  });

  await check("F21", "Gateway WS v3", "RPC sessions.list, sessions.preview, and agents.files.get", async () => {
    const sl = await gwCall("sessions.list", {});
    const sp = await gwCall("sessions.preview", { keys: [`agent:${gwAgentList[0].id}:main`] });
    const af = await gwCall("agents.files.get", { agentId: gwAgentList[0].id, name: "IDENTITY.md" });
    assert(sl.ok && sl.payload?.sessions?.length === 11 && sp.ok && af.ok && af.payload?.file?.content?.length > 10, "Invalid session/file RPC");
    return `sessions=11, IDENTITY.md loaded`;
  });

  await check("F22", "Gateway WS v3", "RPC agents.create & agents.delete blocked (governed_by_paperclip)", async () => {
    const c = await gwCall("agents.create", { name: "Rogue" });
    const d = await gwCall("agents.delete", { agentId: gwAgentList[0].id });
    assert(c.ok === false && c.error?.code === "governed_by_paperclip" && d.ok === false, "Should block agent mutation");
    return `Blocked cleanly (${c.error.code})`;
  });

  await check("F23", "Kanban Board", "RPC tasks.list -> tasks.create -> tasks.update synced with Paperclip", async () => {
    const list1 = await gwCall("tasks.list", {});
    assert(list1.ok && Array.isArray(list1.payload?.tasks), "tasks.list failed");
    const cr = await gwCall("tasks.create", {
      title: "[Exhaustive Kanban Test] Verify Board Card Lifecycle",
      description: "Automated Kanban verification card.",
      assignedAgentId: gwAgentList.find((a) => a.name.includes("QA"))?.id,
    });
    assert(cr.ok && cr.payload?.id?.startsWith("kanban:"), "tasks.create failed");
    const up = await gwCall("tasks.update", { id: cr.payload.id, status: "done" });
    assert(up.ok && up.payload?.status === "done", "tasks.update failed");
    return `Kanban card ${cr.payload.title} -> done`;
  });

  // --- 4. Proxied Normalized Event Stream WS (`ws://127.0.0.1:3200/api/company/events/ws`) ---
  await check("F24", "Normalized Event WS", "Proxied /api/company/events/ws snapshot.reconcile & live event push", async () => {
    const evWs = new WebSocket("ws://127.0.0.1:3200/api/company/events/ws", {
      headers: { Cookie: cookieHeader, Origin: H3D },
    });
    const reconcile = await new Promise((resolve, reject) => {
      evWs.on("message", (raw) => {
        const m = JSON.parse(raw.toString("utf8"));
        if (m.type === "snapshot.reconcile") {
          evWs.close();
          resolve(m);
        }
      });
      evWs.on("error", reject);
    });
    assert(reconcile.snapshot?.overview?.total_agents === 11, "Bad reconcile snapshot");
    return `latest_seq=${reconcile.snapshot.event_stream.latest_sequence}, replay=${reconcile.replay_events.length}`;
  });

  // --- 5. All 6 Command Center Tabs & Features ---
  const snap = await (await fetch(`${H3D}/api/company/snapshot?refresh=1`, { headers: { Cookie: cookieHeader } })).json();

  await check("F25", "Inspector (All 11)", "GET /api/company/agents/:id returns full 11-section Inspector for ALL 11 employees", async () => {
    const profiles = [];
    for (const ag of snap.agents) {
      const r = await fetch(`${H3D}/api/company/agents/${ag.paperclip_agent_id}`, { headers: { Cookie: cookieHeader } });
      const d = await r.json();
      assert(r.status === 200 && d.ok && d.inspector?.overview?.runtime_profile_reference, `Missing profile on ${ag.display_name}`);
      assert(d.inspector?.budget?.usage?.cost_label === "COST UNKNOWN", `Bad cost label on ${ag.display_name}`);
      profiles.push(`${ag.display_name}:${d.inspector.overview.runtime_profile_reference}`);
    }
    return `11/11 verified (${profiles.length} profiles)`;
  });

  await check("F26", "Task Command Center", "Create task (no double-wake), idempotency dedup, comment & cancel", async () => {
    const idem = `exhaustive-idem-${Date.now()}`;
    const qaId = snap.agents.find((a) => a.role === "qa").paperclip_agent_id;
    const r1 = await (
      await fetch(`${H3D}/api/company/tasks`, {
        method: "POST",
        headers: { Cookie: cookieHeader, Origin: H3D, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "[Exhaustive Command Test] Idempotent Task", assignee_agent_id: qaId, status: "backlog", wake_immediately: false, idempotency_key: idem }),
      })
    ).json();
    const r2 = await (
      await fetch(`${H3D}/api/company/tasks`, {
        method: "POST",
        headers: { Cookie: cookieHeader, Origin: H3D, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "[Exhaustive Command Test] Idempotent Task", assignee_agent_id: qaId, status: "backlog", wake_immediately: false, idempotency_key: idem }),
      })
    ).json();
    assert(r1.ok && r2.deduplicated === true && r1.task.id === r2.task.id, "Idempotency failed");
    const rPatch = await (
      await fetch(`${H3D}/api/company/tasks/${r1.task.id}`, {
        method: "PATCH",
        headers: { Cookie: cookieHeader, Origin: H3D, "Content-Type": "application/json" },
        body: JSON.stringify({ comment: "Verified feedback comment.", status: "cancelled" }),
      })
    ).json();
    assert(rPatch.ok && rPatch.comment && rPatch.task.status === "cancelled", "Task patch/cancel failed");
    return `Task ${r1.task.identifier} created, deduplicated, commented & cancelled`;
  });

  await check("F27", "Collaboration & Meetings", "Start governed Paperclip Meeting & conclude with archived summary", async () => {
    const ceoId = snap.agents.find((a) => a.role === "ceo").paperclip_agent_id;
    const qaId = snap.agents.find((a) => a.role === "qa").paperclip_agent_id;
    const m1 = await (
      await fetch(`${H3D}/api/company/meetings`, {
        method: "POST",
        headers: { Cookie: cookieHeader, Origin: H3D, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Exhaustive QA Architecture Sync", agenda: "Verify zero defects across 11 agents", participant_agent_ids: [ceoId, qaId], max_turns: 2, timeout_sec: 120 }),
      })
    ).json();
    assert(m1.ok && m1.meeting?.meeting_id, `Create meeting failed: ${JSON.stringify(m1)}`);
    const m2 = await (
      await fetch(`${H3D}/api/company/meetings/${m1.meeting.meeting_id}/complete`, {
        method: "POST",
        headers: { Cookie: cookieHeader, Origin: H3D, "Content-Type": "application/json" },
        body: JSON.stringify({ summary: "All participants aligned; proceeding with 11-agent verification.", decisions: ["Verify all 11 profiles"] }),
      })
    ).json();
    assert(m2.ok && m2.meeting?.status === "COMPLETED", `Complete meeting failed: ${JSON.stringify(m2)}`);
    // Cancel the backing coordination issue if still open so CEO doesn't run an unnecessary background job
    if (m1.meeting.paperclip_issue_id) {
      await fetch(`${H3D}/api/company/tasks/${m1.meeting.paperclip_issue_id}`, {
        method: "PATCH",
        headers: { Cookie: cookieHeader, Origin: H3D, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
    }
    return `Meeting ${m1.meeting.meeting_id} -> COMPLETED & summary saved`;
  });

  await check("F28", "VulnClaw SOC", "GET /api/company/findings returns isolated read-only findings & timelines", async () => {
    const d = await (await fetch(`${H3D}/api/company/findings`, { headers: { Cookie: cookieHeader } })).json();
    assert(d.ok && d.findings?.length >= 1 && d.security_center?.trust_boundary === "ISOLATED_DEFENSIVE_READONLY", "SOC findings invalid");
    return `total=${d.security_center.summary.total}, resolved=${d.security_center.summary.resolved}`;
  });

  await check("F29", "Governance & Budget", "GET /api/company/governance enforces COST UNKNOWN / UNPRICED USAGE", async () => {
    const d = await (await fetch(`${H3D}/api/company/governance`, { headers: { Cookie: cookieHeader } })).json();
    assert(d.ok && d.budget?.cost_transparency_status === "COST UNKNOWN" && d.budget?.usage_mode_label === "UNPRICED USAGE", "Cost honesty failed");
    return `${d.budget.cost_transparency_status} · ${d.budget.usage_mode_label} (${d.budget.policies.length} policies)`;
  });

  await check("F30", "Fleet Emergency Controls", "Emergency Stop pauses entire fleet -> Resume Wave-1 restores exact 4 Wave-1 agents", async () => {
    const stopRes = await (
      await fetch(`${H3D}/api/company/emergency-stop`, {
        method: "POST",
        headers: { Cookie: cookieHeader, Origin: H3D, "Content-Type": "application/json" },
        body: "{}",
      })
    ).json();
    assert(stopRes.ok, "Emergency stop failed");
    const sPaused = await (await fetch(`${H3D}/api/company/snapshot?refresh=1`, { headers: { Cookie: cookieHeader } })).json();
    assert(sPaused.overview.active_agents === 0 && sPaused.overview.standby_agents === 11, `Expected 0 active after emergency stop, got ${sPaused.overview.active_agents}`);

    const resWave1 = await (
      await fetch(`${H3D}/api/company/resume-wave1`, {
        method: "POST",
        headers: { Cookie: cookieHeader, Origin: H3D, "Content-Type": "application/json" },
        body: "{}",
      })
    ).json();
    assert(resWave1.ok, "Resume wave1 failed");
    const sRestored = await (await fetch(`${H3D}/api/company/snapshot?refresh=1`, { headers: { Cookie: cookieHeader } })).json();
    assert(sRestored.overview.active_agents === 4 && sRestored.overview.standby_agents === 7, `Expected 4 active / 7 standby, got ${sRestored.overview.active_agents}/${sRestored.overview.standby_agents}`);
    return `0/11 paused -> 4/11 Wave-1 ACTIVE restored cleanly`;
  });

  await check("F31", "Operational Health", "GET /api/company/health verifies 12/12 functional components HEALTHY", async () => {
    const d = await (await fetch(`${H3D}/api/company/health`, { headers: { Cookie: cookieHeader } })).json();
    const healthyCount = Object.values(d.components || {}).filter((c) => c.state === "HEALTHY").length;
    assert(d.ok && d.overall_state === "HEALTHY" && healthyCount === 12, `overall=${d.overall_state} healthy=${healthyCount}/12`);
    return `12/12 HEALTHY`;
  });

  await check("F32", "Evidence Viewer & Jail", "Relative & absolute workspace inspection (200) + restricted path rejection (403)", async () => {
    const rel = await fetch(`${H3D}/api/company/evidence?target=office-acceptance-portal`, { headers: { Cookie: cookieHeader } });
    const abs = await fetch(`${H3D}/api/company/evidence?target=${encodeURIComponent(`${ALLINONE_HOME}/workspaces/office-acceptance-portal`)}`, { headers: { Cookie: cookieHeader } });
    const bad1 = await fetch(`${H3D}/api/company/evidence?target=${encodeURIComponent("C:/Windows/System32/drivers/etc/hosts")}`, { headers: { Cookie: cookieHeader } });
    const bad2 = await fetch(`${H3D}/api/company/evidence?target=${encodeURIComponent(`${ALLINONE_HERMES_HOME}/state.db`)}`, { headers: { Cookie: cookieHeader } });
    const relJson = await rel.json();
    assert(rel.status === 200 && abs.status === 200 && relJson.evidence?.current_branch === "fix/office-portal-remediation", "Valid evidence failed");
    assert(bad1.status === 403 && bad2.status === 403, `Expected 403 on restricted paths, got ${bad1.status}/${bad2.status}`);
    return `branch=${relJson.evidence.current_branch}, restricted zones=403`;
  });

  await check("F33", "Layout Persistence", "PUT & GET /api/company/layout persists 3D office settings", async () => {
    const put = await fetch(`${H3D}/api/company/layout`, {
      method: "PUT",
      headers: { Cookie: cookieHeader, Origin: H3D, "Content-Type": "application/json" },
      body: JSON.stringify({ layout: { default_quality: "AUTO", verified_at: new Date().toISOString() } }),
    });
    const get = await (await fetch(`${H3D}/api/company/layout`, { headers: { Cookie: cookieHeader } })).json();
    assert(put.status === 200 && get.departments?.length === 8 && get.saved_layout, "Layout persistence failed");
    return `8 departments + saved_layout verified`;
  });

  await check("F34", "Payload Size Guard", "300 KB request body rejected with HTTP 413", async () => {
    const huge = "x".repeat(300 * 1024);
    const r = await fetch(`${BRIDGE}/api/office-bridge/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bridgeToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: huge }),
    });
    assert(r.status === 413, `Expected 413, got ${r.status}`);
    return `HTTP 413 Payload Too Large`;
  });

  await check("F35", "RBAC Guard", "Viewer role & non-owner caller ID rejected with HTTP 403", async () => {
    const r1 = await fetch(`${BRIDGE}/api/office-bridge/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bridgeToken}`, "X-Office-Actor-Role": "viewer", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Denied" }),
    });
    const r2 = await fetch(`${BRIDGE}/api/office-bridge/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bridgeToken}`, "X-Office-Caller-Id": "999999", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Denied" }),
    });
    assert(r1.status === 403 && r2.status === 403, `Expected 403/403, got ${r1.status}/${r2.status}`);
    return `Viewer=403, Stranger=403`;
  });

  // --- 6. Live Conversational Test (`chat.send` + `chat.history`) on ALL 11 Agents One-by-One! ---
  const orderedAgents = [...snap.agents].sort((a, b) => a.wave - b.wave || a.display_name.localeCompare(b.display_name));
  let idx = 1;
  for (const ag of orderedAgents) {
    const code = `CHAT_${String(idx).padStart(2, "0")}`;
    idx += 1;
    await check(code, "11-Agent Live Chat (WS)", `Live Gateway WS chat.send + chat.history with ${ag.display_name} (${ag.department_short})`, async () => {
      const sessionKey = `agent:${ag.paperclip_agent_id}:main`;
      const prompt = `Halo ${ag.display_name}, sebutkan dalam 2 kalimat Bahasa Indonesia: nama peranmu, departemenmu di kantor 3D, dan bagaimana kamu berkolaborasi dengan tim!`;
      const sendRes = await gwCall("chat.send", {
        sessionKey,
        message: prompt,
        idempotencyKey: `chat-verify-${ag.paperclip_agent_id.slice(0, 8)}-${Date.now()}`,
      });
      assert(
        sendRes.ok &&
          typeof sendRes.payload?.text === "string" &&
          sendRes.payload.text.length > 20 &&
          !sendRes.payload.text.includes("koneksi model lambat") &&
          !sendRes.payload.text.toLowerCase().includes("no longer available"),
        `Non-live or empty chat reply for ${ag.display_name}: ${sendRes.payload?.text}`
      );
      const histRes = await gwCall("chat.history", { sessionKey });
      assert(histRes.ok && histRes.payload?.messages?.length >= 2, `History not persisted for ${ag.display_name}`);
      return sendRes.payload.text.replace(/\s+/g, " ").slice(0, 120);
    });
  }

  gwWs.close();

  const passCount = results.filter((r) => r.status === "PASS").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  const summary = {
    executed_at: new Date().toISOString(),
    total_checks: results.length,
    passed: passCount,
    failed: failCount,
    results,
  };
  fs.writeFileSync(REPORT_OUT, JSON.stringify(summary, null, 2) + "\n", "utf8");
  console.log(`\nEXHAUSTIVE_FEATURE_MATRIX_SUMMARY: passed=${passCount}/${results.length}, failed=${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
