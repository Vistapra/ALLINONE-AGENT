"use strict";

/**
 * Phase 25, 31 & 32 — Defensive Security Findings Reader, Workflow Ledger Reader,
 * Authorized Evidence Viewer, Health Aggregator, and Existing Platform CLI Bridge.
 *
 * Strictly enforces VulnClaw isolation:
 * - Reads structured SQLite rows ONLY as untrusted data literals (sanitized & directive-neutralized).
 * - NEVER exposes offensive capabilities, shell execution, or restricted paths.
 */

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const {
  sanitizePayload,
  sanitizeText,
  validateAuthorizedEvidencePath,
} = require("../contracts/redaction");

const execFileAsync = promisify(execFile);

const ALLINONE_HOME = process.env.ALLINONE_HOME || require("os").homedir() + "/ALLINONE-AGENT";
const PLATFORM_ROOT = path.resolve(`${ALLINONE_HOME}`);
const FINDINGS_DB_PATH = path.join(PLATFORM_ROOT, "data", "findings", "findings.db");
const WORKFLOW_DB_PATH = path.join(PLATFORM_ROOT, "data", "workflow-ledger.db");
const MAINT_STATE_PATH = path.join(PLATFORM_ROOT, "data", "maintenance", "state.json");
const MAINT_LOCK_PATH = path.join(PLATFORM_ROOT, "data", "maintenance", "maintenance.lock");
const AI_PLATFORM_CMD = path.join(PLATFORM_ROOT, "runtime", "bin", "ai-platform.cmd");

function readFindingsSnapshot() {
  if (!fs.existsSync(FINDINGS_DB_PATH)) {
    return { available: false, summary: { total: 0, open: 0, resolved: 0, false_positives: 0, accepted_risks: 0 }, findings: [], timeline: [] };
  }
  const db = new DatabaseSync(FINDINGS_DB_PATH, { open: true, readOnly: true });
  try {
    const findingsRows = db
      .prepare("SELECT * FROM findings ORDER BY updated_at DESC LIMIT 200")
      .all();
    const eventsRows = db
      .prepare("SELECT * FROM finding_events ORDER BY event_id DESC LIMIT 250")
      .all();

    const byStatus = {};
    let openCount = 0;
    let resolvedCount = 0;
    let fpCount = 0;
    let acceptedCount = 0;

    const findings = findingsRows.map((row) => {
      const st = String(row.verification_status || "UNKNOWN");
      byStatus[st] = (byStatus[st] || 0) + 1;
      if (st === "RESOLVED") resolvedCount += 1;
      else if (st === "FALSE_POSITIVE") fpCount += 1;
      else if (st === "ACCEPTED_RISK") acceptedCount += 1;
      else openCount += 1;

      return sanitizePayload({
        finding_id: row.finding_id,
        project_id: row.project_id,
        asset_reference: row.asset_reference,
        source_reference: row.source_reference,
        finding_title: row.finding_title,
        finding_description: row.finding_description,
        severity: row.severity,
        confidence: row.confidence,
        cwe_reference: row.cwe_reference,
        cve_reference: row.cve_reference,
        affected_component: row.affected_component,
        sanitized_evidence: row.sanitized_evidence,
        remediation_recommendation: row.remediation_recommendation,
        verification_status: st,
        occurrence_count: row.occurrence_count,
        assigned_reviewer: row.owner || "security_reviewer",
        paperclip_review_issue_id: row.paperclip_review_issue_id,
        paperclip_remediation_issue_id: row.paperclip_remediation_issue_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    });

    const timeline = eventsRows.map((ev) => {
      let detail = {};
      try {
        detail = JSON.parse(ev.detail_json || "{}");
      } catch {
        detail = { raw: String(ev.detail_json || "") };
      }
      return sanitizePayload({
        event_id: ev.event_id,
        finding_id: ev.finding_id,
        event_type: ev.event_type,
        from_status: ev.from_status,
        to_status: ev.to_status,
        actor: ev.actor,
        detail,
        created_at: ev.created_at,
      });
    });

    return {
      available: true,
      trust_boundary: "ISOLATED_DEFENSIVE_READONLY",
      summary: {
        total: findings.length,
        open: openCount,
        resolved: resolvedCount,
        false_positives: fpCount,
        accepted_risks: acceptedCount,
        by_status: byStatus,
      },
      findings,
      timeline,
    };
  } finally {
    db.close();
  }
}

function readWorkflowLedgerSnapshot() {
  if (!fs.existsSync(WORKFLOW_DB_PATH)) {
    return { available: false, tasks: [], byIssueId: {} };
  }
  const db = new DatabaseSync(WORKFLOW_DB_PATH, { open: true, readOnly: true });
  try {
    const rows = db.prepare("SELECT * FROM task_ledger ORDER BY updated_at DESC LIMIT 300").all();
    const byIssueId = {};
    const tasks = rows.map((r) => {
      let deps = [];
      let evidence = {};
      try {
        deps = JSON.parse(r.dependencies_json || "[]");
      } catch {}
      try {
        evidence = JSON.parse(r.evidence_json || "{}");
      } catch {}
      const item = sanitizePayload({
        task_uuid: r.task_uuid,
        paperclip_issue_id: r.paperclip_issue_id,
        paperclip_identifier: r.paperclip_identifier,
        idempotency_key: r.idempotency_key,
        parent_issue_id: r.parent_issue_id,
        delegation_depth: r.delegation_depth,
        assigned_role: r.assigned_role,
        assigned_agent_id: r.assigned_agent_id,
        priority: r.priority,
        scope_path: r.scope_path,
        dependencies: deps,
        acceptance_criteria: r.acceptance_criteria,
        workflow_stage: r.workflow_stage,
        retry_count: r.retry_count,
        last_run_id: r.last_run_id,
        evidence,
        created_at: r.created_at,
        updated_at: r.updated_at,
      });
      byIssueId[r.paperclip_issue_id] = item;
      return item;
    });
    return { available: true, tasks, byIssueId };
  } finally {
    db.close();
  }
}

function readMaintenanceSnapshot() {
  const lockActive = fs.existsSync(MAINT_LOCK_PATH);
  let state = { state: "UNKNOWN" };
  try {
    if (fs.existsSync(MAINT_STATE_PATH)) {
      state = JSON.parse(fs.readFileSync(MAINT_STATE_PATH, "utf8").replace(/^\uFEFF/, ""));
    }
  } catch {
    state = { state: "UNKNOWN" };
  }
  return {
    lock_active: lockActive,
    draining: state.state === "DRAINING",
    maintenance_active: lockActive || ["UPDATING", "POST_UPDATE_TEST", "PRECHECK"].includes(String(state.state || "")),
    state: sanitizePayload(state),
  };
}

function isSensitiveProjectFilename(fileName) {
  const base = String(fileName || "").trim();
  if (!base) return false;
  if (/^\.env$/i.test(base)) return true;
  if (/^\.env\./i.test(base) && !/^\.env\.example$/i.test(base)) return true;
  if (/secret|private[_-]?key|id_rsa|\.pem$|\.pfx$/i.test(base)) return true;
  return false;
}

/**
 * Inspect Git & unit test evidence inside an authorized workspace/project folder only.
 * Supports `$ALLINONE_HOME\{workspaces,reports,docs}` plus any operator-configured extra
 * root from ALLINONE_EXTRA_AUTHORIZED_ROOTS (e.g. a Laragon/XAMPP/WAMP www\ folder, if the
 * operator opts in), while strictly blocking `.env` / secret files and restricted OS/Hermes
 * zones. No local dev-stack convention is authorized by default.
 */
async function inspectWorkspaceEvidence(workspaceNameOrPath) {
  const rawInput = String(workspaceNameOrPath || "").trim();
  let candidate = rawInput;
  if (!path.isAbsolute(rawInput)) {
    const extraRoots = (process.env.ALLINONE_EXTRA_AUTHORIZED_ROOTS || "")
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean);
    const candidates = [
      path.join(PLATFORM_ROOT, "workspaces", rawInput),
      ...extraRoots.map((root) => path.join(root, rawInput)),
      path.join(PLATFORM_ROOT, "reports", rawInput),
    ];
    candidate = candidates.find((c) => fs.existsSync(c)) || candidates[0];
  }
  const check = validateAuthorizedEvidencePath(candidate);
  if (!check.ok || !check.resolvedPath) {
    const err = new Error(check.reason || "Unauthorized evidence path.");
    err.status = 403;
    throw err;
  }
  const target = check.resolvedPath;
  if (!fs.existsSync(target)) {
    const err = new Error("Requested workspace or artifact does not exist.");
    err.status = 404;
    throw err;
  }

  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (isSensitiveProjectFilename(path.basename(target))) {
      const err = new Error("Reading environment/secret files is forbidden by security policy.");
      err.status = 403;
      throw err;
    }
    const ext = path.extname(target).toLowerCase();
    const allowedExts = [
      ".json", ".md", ".txt", ".py", ".ts", ".tsx", ".js", ".jsx",
      ".php", ".vue", ".yaml", ".yml", ".xml", ".sql", ".html", ".css", ".sarif", ".example",
    ];
    if (!allowedExts.includes(ext)) {
      const err = new Error("Unsupported artifact file extension.");
      err.status = 403;
      throw err;
    }
    const raw = fs.readFileSync(target, "utf8").slice(0, 16_000);
    return {
      kind: "file",
      path: target.replace(/\\/g, "/"),
      content_excerpt: sanitizeText(raw),
    };
  }

  // Directory inside authorized workspace: inspect Git branch, commits, changed files
  const gitDir = path.join(target, ".git");
  let currentBranch = null;
  let branches = [];
  let recentCommits = [];
  let changedFiles = [];

  if (fs.existsSync(gitDir)) {
    try {
      const br = await execFileAsync("git", ["-C", target, "rev-parse", "--abbrev-ref", "HEAD"], { timeout: 6000 });
      currentBranch = br.stdout.trim();
    } catch {}
    try {
      const allBr = await execFileAsync("git", ["-C", target, "branch", "--list"], { timeout: 6000 });
      branches = allBr.stdout
        .split(/\r?\n/)
        .map((l) => l.replace(/^\*?\s+/, "").trim())
        .filter(Boolean);
    } catch {}
    try {
      const logOut = await execFileAsync(
        "git",
        ["-C", target, "log", "--all", "-n", "10", "--pretty=format:%h|%an|%ad|%s", "--date=iso"],
        { timeout: 6000 }
      );
      recentCommits = logOut.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [hash, author, date, ...msg] = line.split("|");
          return { hash, author, date, subject: sanitizeText(msg.join("|")) };
        });
    } catch {}
    try {
      const diffFiles = await execFileAsync("git", ["-C", target, "status", "--short"], { timeout: 6000 });
      changedFiles = diffFiles.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (changedFiles.length === 0 && branches.includes("main") && currentBranch && currentBranch !== "main") {
        const branchDiff = await execFileAsync("git", ["-C", target, "diff", "--name-status", `main..${currentBranch}`], {
          timeout: 6000,
        });
        changedFiles = branchDiff.stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } catch {}
  }

  const filesListing = fs
    .readdirSync(target, { withFileTypes: true })
    .filter((d) => !d.name.startsWith(".git") && !isSensitiveProjectFilename(d.name))
    .slice(0, 60)
    .map((d) => ({ name: d.name, type: d.isDirectory() ? "directory" : "file" }));

  return {
    kind: "workspace",
    path: target.replace(/\\/g, "/"),
    current_branch: currentBranch,
    branches,
    recent_commits: recentCommits,
    changed_files: changedFiles,
    entries: filesListing,
  };
}

/**
 * Safely summarize an authorized project directory's technology stack, modules, tests, and Git status
 * in <150ms without ever reading `.env` or secret files.
 */
function inspectProjectMetadataSummary(projectPath) {
  const check = validateAuthorizedEvidencePath(projectPath);
  if (!check.ok || !check.resolvedPath || !fs.existsSync(check.resolvedPath)) return null;
  const dir = check.resolvedPath;
  if (!fs.statSync(dir).isDirectory()) return null;

  const projectName = path.basename(dir);
  const stack = [];
  let packageName = null;
  let frameworkDetail = null;
  let modulesList = [];

  const composerPath = path.join(dir, "composer.json");
  if (fs.existsSync(composerPath)) {
    stack.push("PHP / Composer");
    try {
      const comp = JSON.parse(fs.readFileSync(composerPath, "utf8"));
      packageName = comp.name || packageName;
      const reqs = { ...(comp.require || {}), ...(comp["require-dev"] || {}) };
      if (reqs["laravel/framework"]) {
        frameworkDetail = `Laravel (${reqs["laravel/framework"]})`;
        stack.push(frameworkDetail);
      }
      if (reqs["nwidart/laravel-modules"]) {
        stack.push("Modular Laravel (nwidart/laravel-modules)");
      }
    } catch {}
  }

  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      packageName = packageName || pkg.name || null;
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.next) stack.push(`Next.js (${deps.next})`);
      else if (deps.react) stack.push("React");
      else if (deps.vue) stack.push("Vue.js");
      else if (deps.express) stack.push("Express.js");
      else stack.push("Node.js / NPM");
    } catch {}
  }

  if (fs.existsSync(path.join(dir, "pyproject.toml")) || fs.existsSync(path.join(dir, "requirements.txt"))) {
    stack.push("Python");
  }

  const modulesDir = path.join(dir, "Modules");
  if (fs.existsSync(modulesDir) && fs.statSync(modulesDir).isDirectory()) {
    try {
      modulesList = fs
        .readdirSync(modulesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name)
        .slice(0, 20);
    } catch {}
  }

  const topDirs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules" && d.name !== "vendor")
    .map((d) => d.name)
    .slice(0, 18);

  const hasTests = fs.existsSync(path.join(dir, "tests")) || fs.existsSync(path.join(dir, "phpunit.xml"));

  return {
    project_name: projectName,
    resolved_path: dir.replace(/\\/g, "/"),
    package_name: packageName,
    stack: stack.length > 0 ? stack : ["General Source Repository"],
    modules: modulesList,
    top_directories: topDirs,
    has_test_suite: hasTests,
  };
}

const PLATFORM_PY_SCRIPT = path.join(PLATFORM_ROOT, "integration", "platform_cli.py");
const ALLINONE_HERMES_HOME_FOR_PYTHON =
  process.env.ALLINONE_HERMES_HOME || path.join(require("os").homedir(), "AppData", "Local", "hermes");
const BUNDLED_PYTHON_EXE = path.join(
  ALLINONE_HERMES_HOME_FOR_PYTHON,
  "tools",
  "python-3.14.9+20261021-win32-x64",
  "python.exe"
);
const PYTHON_EXE = fs.existsSync(BUNDLED_PYTHON_EXE) ? BUNDLED_PYTHON_EXE : "python";

/**
 * Invoke existing `platform_cli.py` directly via Python for platform health, emergency-stop,
 * resume-wave1, or authorized Telegram synchronization — NEVER reading secrets into Node memory.
 */
async function invokePlatformCliJson(args, timeoutMs = 30_000) {
  const { stdout } = await execFileAsync(PYTHON_EXE, [PLATFORM_PY_SCRIPT, ...args], {
    cwd: PLATFORM_ROOT,
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });
  const trimmed = stdout.trim();
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace >= 0) {
    return sanitizePayload(JSON.parse(trimmed.slice(firstBrace)));
  }
  return { raw: sanitizeText(trimmed) };
}

/**
 * Send sanitized completion/status notification to Owner Telegram using the EXISTING
 * `workflow_engine.send_owner_telegram_notification` helper (no second Telegram poller,
 * no bot token loaded in Office Bridge or Hermes3D).
 */
async function sendTelegramNotificationViaExistingBridge(messageText, correlationId = "") {
  const safeMsg = sanitizeText(String(messageText || "").trim()).slice(0, 3200);
  const pyCode = [
    "import json, sys",
    `sys.path.insert(0, r'${ALLINONE_HOME}')`,
    "from integration.workflow_engine import send_owner_telegram_notification",
    "msg = sys.argv[1]",
    "res = send_owner_telegram_notification(msg)",
    "print(json.dumps(res))",
  ].join("; ");

  const { stdout } = await execFileAsync("python", ["-c", pyCode, safeMsg], {
    cwd: PLATFORM_ROOT,
    timeout: 20_000,
  });
  return sanitizePayload(JSON.parse(stdout.trim()));
}

module.exports = {
  FINDINGS_DB_PATH,
  WORKFLOW_DB_PATH,
  readFindingsSnapshot,
  readWorkflowLedgerSnapshot,
  readMaintenanceSnapshot,
  inspectWorkspaceEvidence,
  inspectProjectMetadataSummary,
  invokePlatformCliJson,
  sendTelegramNotificationViaExistingBridge,
};
