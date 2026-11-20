"use strict";
const ALLINONE_HOME = process.env.ALLINONE_HOME || require("os").homedir() + "/ALLINONE-AGENT";
// No local dev-stack convention is authorized by default. Operators opt in explicitly via
// ALLINONE_EXTRA_AUTHORIZED_ROOTS (a ";"-separated list of absolute paths), consistent with
// apps/office-bridge/contracts/redaction.js.
const EXTRA_AUTHORIZED_ROOTS = (process.env.ALLINONE_EXTRA_AUTHORIZED_ROOTS || "")
  .split(";")
  .map((p) => p.trim())
  .filter(Boolean);


/**
 * Phase 23 & Phase 26 — Canonical Paperclip Agent Identity Mapping,
 * 8-Department Spatial Layout Registry, and Deterministic Avatar Profiles.
 */

const DEPARTMENTS = Object.freeze({
  executive: {
    id: "executive",
    name: "Executive Office",
    shortLabel: "EXEC",
    color: "#f59e0b",
    cameraTarget: { x: 260, y: 210, preset: "executive" },
    facilities: ["Executive Desks", "Company Overview Board", "Strategy Monitor", "Delegation Board"],
  },
  engineering: {
    id: "engineering",
    name: "Engineering Department",
    shortLabel: "ENG",
    color: "#3b82f6",
    cameraTarget: { x: 560, y: 360, preset: "engineering" },
    facilities: ["Individual Workstations", "Project Monitors", "Development Status Board", "Build Status Display"],
  },
  qa_lab: {
    id: "qa_lab",
    name: "Quality Assurance Laboratory",
    shortLabel: "QA LAB",
    color: "#10b981",
    cameraTarget: { x: 1410, y: 310, preset: "qa_lab" },
    facilities: ["Test Dashboard", "Regression Status", "Test Execution Monitor", "Acceptance Board"],
  },
  soc: {
    id: "soc",
    name: "Security Operations Center",
    shortLabel: "SOC",
    color: "#ef4444",
    cameraTarget: { x: 860, y: 250, preset: "soc" },
    facilities: ["Findings Dashboard", "Risk Overview", "Remediation Board", "Defensive Review Status"],
  },
  compliance: {
    id: "compliance",
    name: "Compliance Office",
    shortLabel: "COMP",
    color: "#8b5cf6",
    cameraTarget: { x: 260, y: 540, preset: "compliance" },
    facilities: ["Evidence Archive", "Report Dashboard", "Documentation Board"],
  },
  meeting_room: {
    id: "meeting_room",
    name: "Meeting Room",
    shortLabel: "MEET",
    color: "#06b6d4",
    cameraTarget: { x: 145, y: 118, preset: "meeting_room" },
    facilities: ["Conference Table", "Delegation Handoff Display", "Action Item Tracker"],
  },
  ops_center: {
    id: "ops_center",
    name: "Operations Control Center",
    shortLabel: "OPS",
    color: "#ec4899",
    cameraTarget: { x: 960, y: 680, preset: "ops_center" },
    facilities: ["Service Health Rack", "Runtime Telemetry", "03:00 WIB Maintenance Monitor", "Resource & Error Console"],
  },
  lobby: {
    id: "lobby",
    name: "Lobby & Lounge",
    shortLabel: "LOBBY",
    color: "#64748b",
    cameraTarget: { x: 320, y: 880, preset: "lobby" },
    facilities: ["Reception Desk", "Standby Lounge", "Company Directory"],
  },
});

/**
 * Deterministic visual & spatial assignment for the 11 existing company roles,
 * keyed by normalized agent name or role slug so Paperclip UUID remains the canonical ID.
 */
const ROLE_VISUAL_CATALOG = Object.freeze({
  "ceo agent": {
    departmentId: "executive",
    officeLocationId: "dept-executive-desk-1",
    deskCoords: { x: 220, y: 190, facing: 0 },
    color: "#f59e0b",
    visualProfileId: "vp-ceo-01",
    wave: 1,
    badgeEmoji: "👑",
  },
  "cto agent": {
    departmentId: "executive",
    officeLocationId: "dept-executive-desk-2",
    deskCoords: { x: 340, y: 190, facing: 0 },
    color: "#d97706",
    visualProfileId: "vp-cto-02",
    wave: 2,
    badgeEmoji: "🏛️",
  },
  "backend developer": {
    departmentId: "engineering",
    officeLocationId: "dept-engineering-desk-1",
    deskCoords: { x: 480, y: 340, facing: 0 },
    color: "#2563eb",
    visualProfileId: "vp-backend-03",
    wave: 1,
    badgeEmoji: "⚙️",
  },
  "frontend developer": {
    departmentId: "engineering",
    officeLocationId: "dept-engineering-desk-2",
    deskCoords: { x: 600, y: 340, facing: 0 },
    color: "#0ea5e9",
    visualProfileId: "vp-frontend-04",
    wave: 2,
    badgeEmoji: "🎨",
  },
  "devops engineer": {
    departmentId: "engineering",
    officeLocationId: "dept-engineering-desk-3",
    deskCoords: { x: 720, y: 340, facing: 0 },
    color: "#4f46e5",
    visualProfileId: "vp-devops-05",
    wave: 2,
    badgeEmoji: "🚀",
  },
  "qa engineer": {
    departmentId: "qa_lab",
    officeLocationId: "dept-qa-station-1",
    deskCoords: { x: 1410, y: 300, facing: 180 },
    color: "#10b981",
    visualProfileId: "vp-qa-06",
    wave: 1,
    badgeEmoji: "🧪",
  },
  "security lead": {
    departmentId: "soc",
    officeLocationId: "dept-soc-desk-1",
    deskCoords: { x: 820, y: 210, facing: 0 },
    color: "#dc2626",
    visualProfileId: "vp-seclead-07",
    wave: 2,
    badgeEmoji: "🛡️",
  },
  "security reviewer": {
    departmentId: "soc",
    officeLocationId: "dept-soc-desk-2",
    deskCoords: { x: 940, y: 210, facing: 0 },
    color: "#ef4444",
    visualProfileId: "vp-secreview-08",
    wave: 1,
    badgeEmoji: "🔍",
  },
  "findings analyst": {
    departmentId: "soc",
    officeLocationId: "dept-soc-desk-3",
    deskCoords: { x: 820, y: 330, facing: 180 },
    color: "#f97316",
    visualProfileId: "vp-findings-09",
    wave: 2,
    badgeEmoji: "📊",
  },
  "remediation reviewer": {
    departmentId: "soc",
    officeLocationId: "dept-soc-desk-4",
    deskCoords: { x: 940, y: 330, facing: 180 },
    color: "#e11d48",
    visualProfileId: "vp-remreview-10",
    wave: 2,
    badgeEmoji: "✅",
  },
  "report & compliance agent": {
    departmentId: "compliance",
    officeLocationId: "dept-compliance-desk-1",
    deskCoords: { x: 260, y: 540, facing: 90 },
    color: "#8b5cf6",
    visualProfileId: "vp-compliance-11",
    wave: 2,
    badgeEmoji: "📋",
  },
});

function inferDepartmentByRole(roleStr) {
  const r = String(roleStr || "").toLowerCase();
  if (r === "ceo" || r === "cto") return "executive";
  if (r === "qa") return "qa_lab";
  if (r === "security" || r === "researcher") return "soc";
  if (r === "pm" || r === "compliance") return "compliance";
  if (r === "devops") return "ops_center";
  return "engineering";
}

const KNOWN_ROLE_PROFILES = Object.freeze({
  "ceo agent": "pcceoagent",
  "cto agent": "pcctoagent",
  "backend developer": "pcbackenddeveloper",
  "frontend developer": "pcfrontenddeveloper",
  "devops engineer": "pcdevopsengineer",
  "qa engineer": "pcqaengineer",
  "security lead": "pcsecuritylead",
  "security reviewer": "pcsecurityreviewer",
  "findings analyst": "pcfindingsanalyst",
  "remediation reviewer": "pcremediationreviewer",
  "report & compliance agent": "pccompliancereporter",
});

function extractHermesProfileRef(adapterConfig, normName = "") {
  const fs = require("node:fs");
  const path = require("node:path");
  if (adapterConfig && typeof adapterConfig === "object") {
    const env = adapterConfig.env && typeof adapterConfig.env === "object" ? adapterConfig.env : {};
    const rawHome = env.HERMES_HOME ?? adapterConfig.hermesHome ?? "";
    const hermesHome =
      rawHome && typeof rawHome === "object"
        ? String(rawHome.value || rawHome.default || "")
        : String(rawHome || "");
    if (hermesHome && hermesHome !== "[object Object]" && !hermesHome.includes("REDACTED")) {
      const parts = hermesHome.replace(/\\/g, "/").split("/").filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1];
    }
  }
  const known = KNOWN_ROLE_PROFILES[normName];
  if (known) {
    const hermesHomeRoot =
      process.env.ALLINONE_HERMES_HOME || path.join(require("os").homedir(), "AppData", "Local", "hermes");
    const profileDir = path.join(hermesHomeRoot, "profiles", known);
    if (fs.existsSync(profileDir)) {
      return known;
    }
  }
  return null;
}

/**
 * Map a raw Paperclip agent object into the canonical Office Bridge Agent Identity contract.
 * Never exposes adapter secrets or env values.
 * @param {Record<string, unknown>} agent
 * @param {Array<Record<string, unknown>>} allAgents
 * @param {number} index
 */
function mapPaperclipAgentIdentity(agent, allAgents = [], index = 0) {
  const canonicalId = String(agent.id || "").trim();
  const displayName = String(agent.name || `Agent ${index + 1}`).trim();
  const normName = displayName.toLowerCase();
  const preset = ROLE_VISUAL_CATALOG[normName] || null;
  const departmentId = preset ? preset.departmentId : inferDepartmentByRole(agent.role);
  const dept = DEPARTMENTS[departmentId] || DEPARTMENTS.engineering;

  const subordinates = allAgents
    .filter((other) => other && String(other.reportsTo || "") === canonicalId)
    .map((other) => String(other.id));

  const adapterCfg = agent.adapterConfig && typeof agent.adapterConfig === "object" ? agent.adapterConfig : {};
  const profileRef = extractHermesProfileRef(adapterCfg, normName);
  const rawStatus = String(agent.status || "unknown").toLowerCase();
  const rawLifecycle = String(agent.lifecycleState || "").toLowerCase();
  const activationStatus =
    rawStatus === "paused" || rawLifecycle === "pausing" || rawLifecycle === "paused"
      ? "STANDBY"
      : rawStatus === "idle" ||
          rawStatus === "running" ||
          rawStatus === "active" ||
          (rawStatus === "error" && rawLifecycle === "ready")
        ? "ACTIVE"
        : rawStatus === "terminated" || rawStatus === "archived"
          ? "DEACTIVATED"
          : "UNKNOWN";

  const fallbackX = 460 + (index % 5) * 95;
  const fallbackY = 480 + Math.floor(index / 5) * 95;

  return {
    paperclip_agent_id: canonicalId,
    company_id: String(agent.companyId || ""),
    display_name: displayName,
    department_id: departmentId,
    department: dept.name,
    department_short: dept.shortLabel,
    role: String(agent.role || "specialist"),
    title: String(agent.title || displayName),
    manager_id: agent.reportsTo ? String(agent.reportsTo) : null,
    subordinate_ids: subordinates,
    runtime_type: String(agent.adapterType || "hermes_local"),
    runtime_profile_reference: profileRef,
    model_id: String(adapterCfg.model || "combo/X"),
    visual_profile_id: preset ? preset.visualProfileId : `vp-dynamic-${canonicalId.slice(0, 8)}`,
    avatar_id: `avatar-${canonicalId.slice(0, 8)}`,
    color: preset ? preset.color : dept.color,
    badge_emoji: preset ? preset.badgeEmoji : "🤖",
    wave: preset ? preset.wave : 2,
    office_location_id: preset ? preset.officeLocationId : `dept-${departmentId}-slot-${index + 1}`,
    desk_coords: preset ? preset.deskCoords : { x: fallbackX, y: fallbackY, facing: 0 },
    authorized_workspaces: [`${ALLINONE_HOME}/workspaces`, `${ALLINONE_HOME}/reports`, ...EXTRA_AUTHORIZED_ROOTS],
    authorized_tools: resolveAuthorizedToolsForRole(String(agent.role || ""), normName),
    skills: resolveRoleSkills(String(agent.role || ""), normName),
    can_create_agents: Boolean(agent.permissions?.canCreateAgents ?? false),
    activation_status: activationStatus,
    raw_status: rawStatus,
    lifecycle_state: String(agent.lifecycleState || "unknown"),
    last_heartbeat_at: agent.lastHeartbeatAt || agent.updatedAt || null,
    observed_at: new Date().toISOString(),
  };
}

function resolveAuthorizedToolsForRole(role, normName) {
  const base = ["read_file", "search_files", "paperclip_api_scoped"];
  if (normName.includes("ceo") || normName.includes("cto") || role === "pm") {
    return [...base, "issue_decomposition", "comment_publish"];
  }
  if (role === "security" || role === "researcher") {
    return [...base, "vulnclaw_defensive_codescan_readonly", "findings_triage"];
  }
  if (role === "qa") {
    return [...base, "local_terminal_test_runner", "git_diff_readonly"];
  }
  return [...base, "write_file", "edit_file", "local_terminal", "git_branch_worktree"];
}

function resolveRoleSkills(role, normName) {
  const common = ["unified-ai-platform", "paperclip-task-bridge"];
  if (normName.includes("ceo")) return [...common, "strategic-planning", "multi-agent-delegation"];
  if (normName.includes("cto")) return [...common, "system-architecture", "technical-standards"];
  if (role === "security" || role === "researcher") return [...common, "defensive-static-review", "cwe-remediation-triage"];
  if (role === "qa") return [...common, "automated-regression-testing", "acceptance-verification"];
  return [...common, "clean-software-engineering", "isolated-branch-workflow"];
}

module.exports = {
  DEPARTMENTS,
  ROLE_VISUAL_CATALOG,
  mapPaperclipAgentIdentity,
};
