"use strict";

/**
 * Defensive secret redaction, untrusted-data directive neutralization,
 * and strict workspace path validation for Office Bridge & Hermes3D.
 */

const path = require("node:path");
const fs = require("node:fs");
const ALLINONE_HOME = process.env.ALLINONE_HOME || require("os").homedir() + "/ALLINONE-AGENT";
const ALLINONE_HERMES_HOME =
  process.env.ALLINONE_HERMES_HOME || path.join(require("os").homedir(), "AppData", "Local", "hermes");

// No local dev-stack convention (Laragon, XAMPP, WAMP, etc.) is authorized by default: operators
// opt in explicitly via ALLINONE_EXTRA_AUTHORIZED_ROOTS (a ";"-separated list of absolute paths).
const EXTRA_AUTHORIZED_ROOTS = (process.env.ALLINONE_EXTRA_AUTHORIZED_ROOTS || "")
  .split(";")
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => path.resolve(p));


const SECRET_PATTERNS = [
  { re: /\bsk-[A-Za-z0-9_-]{12,}\b/g, replacement: "[REDACTED_API_KEY]" },
  { re: /\bpcp_(?:board|agent|live|sec|tok)_[A-Za-z0-9_-]{8,}\b/gi, replacement: "[REDACTED_PAPERCLIP_KEY]" },
  { re: /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, replacement: "[REDACTED_TELEGRAM_TOKEN]" },
  { re: /(Authorization\s*:\s*Bearer\s+)[^\s"',;]+/gi, replacement: "$1[REDACTED_BEARER]" },
  { re: /((?:api[_-]?key|bot[_-]?token|access[_-]?token|secret|password)\s*[=:]\s*["']?)[^\s"',;&]+/gi, replacement: "$1[REDACTED_SECRET]" },
];

const DIRECTIVE_PATTERN = /(\[embedded_directive:[^\]]*\]|ignore\s+previous\s+instructions|system\s*override\s*:|grant\s+admin\s+privileges\s*:)/gi;

/**
 * Redact secrets and neutralize embedded prompt-injection directives in untrusted strings.
 * @param {unknown} input
 * @returns {string}
 */
function sanitizeText(input) {
  if (input === null || input === undefined) return "";
  let text = typeof input === "string" ? input : String(input);
  for (const { re, replacement } of SECRET_PATTERNS) {
    text = text.replace(re, replacement);
  }
  text = text.replace(DIRECTIVE_PATTERN, "[DATA_LITERAL_DIRECTIVE_IGNORED]");
  return text;
}

const SENSITIVE_KEY_RE = /^(?:token|api_?key|apikey|secret|password|authorization|cookie|telegram_bot_token|custom_api_key|better_auth_secret|paperclip_board_key|paperclip_agent_jwt_secret|bridge_?token|studio_access_token)$/i;

/**
 * Recursively sanitize an arbitrary JSON-compatible value so no secret or directive leaks.
 * @param {unknown} value
 * @param {number} depth
 * @returns {unknown}
 */
function sanitizePayload(value, depth = 0) {
  if (depth > 12) return "[TRUNCATED_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((entry) => sanitizePayload(entry, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = "[REDACTED_SECRET]";
      } else {
        out[k] = sanitizePayload(v, depth + 1);
      }
    }
    return out;
  }
  return sanitizeText(String(value));
}

const ALLOWED_EVIDENCE_ROOTS = [
  path.resolve(`${ALLINONE_HOME}\\workspaces`),
  path.resolve(`${ALLINONE_HOME}\\reports`),
  path.resolve(`${ALLINONE_HOME}\\docs`),
  ...EXTRA_AUTHORIZED_ROOTS,
];

const FORBIDDEN_ROOTS = [
  path.resolve(ALLINONE_HERMES_HOME),
  path.resolve(`${ALLINONE_HOME}\\config\\secrets`),
  path.resolve(`${ALLINONE_HOME}\\data\\vulnclaw`),
  path.resolve("C:\\Windows"),
];

/**
 * Verify a requested evidence/workspace path stays strictly within authorized roots,
 * rejecting path traversal, symlinks escaping roots, and forbidden directories.
 * @param {string} candidatePath
 * @returns {{ ok: boolean, resolvedPath: string | null, reason?: string }}
 */
function validateAuthorizedEvidencePath(candidatePath) {
  if (typeof candidatePath !== "string" || !candidatePath.trim()) {
    return { ok: false, resolvedPath: null, reason: "Path is empty." };
  }
  const raw = candidatePath.trim();
  if (raw.includes("\0")) {
    return { ok: false, resolvedPath: null, reason: "Null byte in path." };
  }
  const abs = path.resolve(raw);
  let real = abs;
  try {
    if (fs.existsSync(abs)) {
      real = fs.realpathSync(abs);
    }
  } catch {
    return { ok: false, resolvedPath: null, reason: "Unable to resolve real path." };
  }

  const normReal = real.toLowerCase();
  for (const forbidden of FORBIDDEN_ROOTS) {
    const normF = forbidden.toLowerCase();
    if (normReal === normF || normReal.startsWith(normF + path.sep)) {
      return { ok: false, resolvedPath: null, reason: "Access to restricted trust zone is forbidden." };
    }
  }

  for (const allowed of ALLOWED_EVIDENCE_ROOTS) {
    const normA = allowed.toLowerCase();
    if (normReal === normA || normReal.startsWith(normA + path.sep)) {
      return { ok: true, resolvedPath: real };
    }
  }

  return { ok: false, resolvedPath: null, reason: "Path is outside authorized workspace/evidence directories." };
}

module.exports = {
  sanitizeText,
  sanitizePayload,
  validateAuthorizedEvidencePath,
  ALLOWED_EVIDENCE_ROOTS,
  FORBIDDEN_ROOTS,
};
