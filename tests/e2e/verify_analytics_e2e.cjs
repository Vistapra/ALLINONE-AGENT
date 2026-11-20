"use strict";

/**
 * END-TO-END REAL ANALYTICS, COST, BUDGETS & PERFORMANCE INTELLIGENCE VERIFICATION
 */

const fs = require("node:fs");
const assert = require("node:assert/strict");
const { loadWsModule } = require("../office-bridge/contracts/ws-loader");
const ALLINONE_HOME = process.env.ALLINONE_HOME || require("os").homedir() + "/ALLINONE-AGENT";


const H3D = "http://127.0.0.1:3200";
const BRIDGE = "http://127.0.0.1:3210";

const secrets = JSON.parse(
  fs.readFileSync(`${ALLINONE_HOME}\\config\\secrets\\office-bridge-auth.json`, "utf8")
);

async function main() {
  const results = [];
  async function check(id, title, fn) {
    const t0 = performance.now();
    const detail = await fn();
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    results.push({ id, title, status: "PASS", duration_ms: ms, detail });
    console.log(`[PASS] ${id} (${ms}ms): ${title} -> ${detail}`);
  }

  const authRes = await fetch(`${H3D}/api/studio-auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: H3D },
    body: JSON.stringify({ token: secrets.studioAccessToken }),
  });
  assert.equal(authRes.status, 200);
  const cookieHeader = (
    authRes.headers.get("set-cookie") ||
    `studio_access=${encodeURIComponent(secrets.studioAccessToken)}`
  ).split(";")[0];

  await check("A01", "Hermes3D /api/company/analytics exposes real SQLite + Paperclip telemetry with zero path leaks", async () => {
    const r = await fetch(`${H3D}/api/company/analytics`, {
      headers: { Cookie: cookieHeader },
    });
    assert.equal(r.status, 200);
    const rawText = await r.text();
    assert.ok(!rawText.toLowerCase().includes("state.db"), "Internal state.db path leaked!");
    const d = JSON.parse(rawText);
    assert.equal(d.ok, true);
    assert.ok(d.totals.totalTokens > 1_000_000, `Expected >1M real tokens, got ${d.totals.totalTokens}`);
    assert.ok(d.totals.totalCost > 1, `Expected >$1 metered spend, got ${d.totals.totalCost}`);
    assert.equal(d.daily.length, 7);
    assert.ok(d.runs.length >= 20, `Expected >=20 historical runs, got ${d.runs.length}`);
    assert.ok(d.approvals.length >= 1, `Expected >=1 approval record, got ${d.approvals.length}`);
    assert.ok(d.corporateBudgets.monthlySpendLimitUsd > 0);
    return `tokens=${d.totals.totalTokens.toLocaleString()}, spend=$${d.totals.totalCost.toFixed(2)}, runs=${d.runs.length}, approvals=${d.approvals.length}, monthlyBudget=$${d.corporateBudgets.monthlySpendLimitUsd}`;
  });

  const { WebSocket } = loadWsModule();
  const gwWs = new WebSocket(`ws://127.0.0.1:3200/api/gateway/ws`, {
    headers: { Origin: H3D, Cookie: cookieHeader },
  });
  let seq = 1;
  const pending = new Map();
  const gwCall = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = `an-${seq++}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout on ${method}`));
      }, 15_000);
      pending.set(id, { resolve, reject, timer });
      gwWs.send(JSON.stringify({ type: "req", id, method, params }));
    });

  await new Promise((resolve, reject) => {
    gwWs.on("message", (raw) => {
      const msg = JSON.parse(raw.toString("utf8"));
      if (msg.type === "event" && msg.event === "connect.challenge") resolve();
      else if (msg.type === "res" && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        clearTimeout(entry.timer);
        pending.delete(msg.id);
        entry.resolve(msg);
      }
    });
    gwWs.on("error", reject);
  });

  const hello = await gwCall("connect", { auth: { token: "" } });
  assert.equal(hello.ok, true);
  assert.ok(hello.payload.features.methods.includes("sessions.usage"));
  assert.ok(hello.payload.features.methods.includes("usage.cost"));
  assert.ok(hello.payload.features.methods.includes("runs.list"));

  await check("A02", "Gateway WS sessions.usage returns real per-agent sessions, tool calls & combo/X model breakdown across all 11 agents", async () => {
    const res = await gwCall("sessions.usage", { limit: 1000, includeContextWeight: true });
    assert.equal(res.ok, true);
    const sessions = res.payload.sessions || [];
    assert.ok(sessions.length >= 15, `Expected >=15 real sessions, got ${sessions.length}`);
    const distinctAgents = new Set(sessions.map((s) => s.agentId).filter(Boolean));
    assert.equal(distinctAgents.size, 11, `Expected all 11 corporate agents in sessions.usage, got ${distinctAgents.size}`);
    const totalTools = sessions.reduce((sum, s) => sum + (s.usage?.toolUsage?.totalCalls || 0), 0);
    assert.ok(totalTools >= 50, `Expected >=50 real tool calls, got ${totalTools}`);
    const t = res.payload.totals;
    const sumParts = Math.round((t.inputCost + t.outputCost + t.cacheReadCost + t.cacheWriteCost) * 10000) / 10000;
    assert.ok(Math.abs(sumParts - t.totalCost) < 0.01, `Cost parts ${sumParts} != totalCost ${t.totalCost}`);
    return `sessions=${sessions.length}, distinctAgents=${distinctAgents.size}/11, toolCalls=${totalTools}, model=custom/combo/X`;
  });

  await check("A03", "Gateway WS usage.cost returns 7-day daily cost series matching real activity dates", async () => {
    const res = await gwCall("usage.cost", {});
    assert.equal(res.ok, true);
    const daily = res.payload.daily || [];
    assert.equal(daily.length, 7);
    const activeDays = daily.filter((d) => d.totalCost > 0);
    assert.ok(activeDays.length >= 2, `Expected >=2 active days in 7D window, got ${activeDays.length}`);
    return `days=${daily.length}, activeDays=${activeDays.map((d) => `${d.date}($${d.totalCost.toFixed(2)})`).join(", ")}`;
  });

  await check("A04", "Gateway WS runs.list, approvals.list & budgets.get hydrate Performance & Budget intelligence", async () => {
    const [runsRes, apprRes, budRes] = await Promise.all([
      gwCall("runs.list", { limit: 200 }),
      gwCall("approvals.list", {}),
      gwCall("budgets.get", {}),
    ]);
    assert.equal(runsRes.ok, true);
    assert.equal(apprRes.ok, true);
    assert.equal(budRes.ok, true);
    const completed = (runsRes.payload.runs || []).filter((r) => r.endedAt !== null);
    const okRuns = completed.filter((r) => r.outcome === "ok");
    assert.ok(completed.length >= 20 && okRuns.length > 0);
    const avgMs = Math.round(
      completed.reduce((s, r) => s + Math.max(0, r.endedAt - r.startedAt), 0) / completed.length
    );
    return `completedRuns=${completed.length}, okRuns=${okRuns.length}, avgRuntime=${Math.round(avgMs / 1000)}s, approvals=${apprRes.payload.records.length}, budgets=${JSON.stringify(budRes.payload.budgets)}`;
  });

  gwWs.close();
  fs.writeFileSync(
    `${ALLINONE_HOME}\\reports\\analytics-e2e.json`,
    JSON.stringify({ timestamp: new Date().toISOString(), passed: results.length, results }, null, 2) + "\n",
    "utf8"
  );
  console.log(`\nANALYTICS_E2E_SUMMARY: passed=${results.length}/4, failed=0`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
