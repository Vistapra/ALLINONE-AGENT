"use strict";

/**
 * Phase 23, 24, 30 & 35 — Office Bridge Authentication, Authorization,
 * WebSocket Origin Validation, Rate Limiting, and Audit Trail.
 *
 * Strictly zero sharing of TELEGRAM_BOT_TOKEN or CUSTOM_API_KEY.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ALLINONE_HOME = process.env.ALLINONE_HOME || require("os").homedir() + "/ALLINONE-AGENT";


const SECRET_FILE_PATH = path.resolve(`${ALLINONE_HOME}\\config\\secrets\\office-bridge-auth.json`);
const AUDIT_LOG_PATH = path.resolve(`${ALLINONE_HOME}\\logs\\office-bridge-audit.jsonl`);
// Owner-only mutation authorization is fail-closed: if ALLINONE_TELEGRAM_OWNER_ID
// is not configured, AUTHORIZED_OWNER_ID is null and every requireMutationOwner
// check below is denied, rather than silently matching an empty string.
const AUTHORIZED_OWNER_ID = process.env.ALLINONE_TELEGRAM_OWNER_ID || null;
if (!AUTHORIZED_OWNER_ID) {
  // eslint-disable-next-line no-console
  console.warn(
    "[office-bridge/auth] ALLINONE_TELEGRAM_OWNER_ID is not set — owner-only mutation endpoints will reject all callers until it is configured."
  );
}

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:3200",
  "http://localhost:3200",
  "http://127.0.0.1:3210",
  "http://localhost:3210",
]);

function timingSafeStringEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length === 0 || bufA.length !== bufB.length) {
    const dummy = Buffer.alloc(32, 0);
    crypto.timingSafeEqual(dummy, dummy);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function lockSecretFileAcl(filePath) {
  if (process.platform !== "win32") return;
  try {
    const username = `${process.env.USERDOMAIN || process.env.COMPUTERNAME || ""}\\${process.env.USERNAME || "vista"}`.replace(/^\\/, "");
    execFileSync(
      "icacls.exe",
      [
        filePath,
        "/inheritance:r",
        "/grant:r",
        `${username}:(F)`,
        "NT AUTHORITY\\SYSTEM:(F)",
        "BUILTIN\\Administrators:(F)",
      ],
      { stdio: "ignore", timeout: 8000 }
    );
  } catch {
    // Parent secrets directory is already ACL-locked from Phase 03
  }
}

/**
 * Load or generate isolated internal credentials for Office Bridge <-> Hermes3D Studio.
 * Never reads or stores TELEGRAM_BOT_TOKEN or CUSTOM_API_KEY.
 */
function ensureOfficeBridgeSecrets() {
  if (fs.existsSync(SECRET_FILE_PATH)) {
    const raw = JSON.parse(fs.readFileSync(SECRET_FILE_PATH, "utf8"));
    if (raw && typeof raw.bridgeToken === "string" && raw.bridgeToken.length >= 32 && typeof raw.studioAccessToken === "string") {
      return raw;
    }
  }
  fs.mkdirSync(path.dirname(SECRET_FILE_PATH), { recursive: true });
  const generated = {
    createdAt: new Date().toISOString(),
    bridgeToken: `ob_tok_${crypto.randomBytes(32).toString("hex")}`,
    studioAccessToken: `st_tok_${crypto.randomBytes(24).toString("hex")}`,
    allowedOwnerId: AUTHORIZED_OWNER_ID,
  };
  fs.writeFileSync(SECRET_FILE_PATH, JSON.stringify(generated, null, 2) + "\n", { encoding: "utf8" });
  lockSecretFileAcl(SECRET_FILE_PATH);
  return generated;
}

function appendAuditEntry(entry) {
  try {
    fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    const record = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // non-fatal
  }
}

function extractBearerOrHeaderToken(req, urlObj) {
  const authHeader = req.headers?.authorization;
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }
  const customHeader = req.headers?.["x-office-bridge-token"];
  if (typeof customHeader === "string" && customHeader.trim()) {
    return customHeader.trim();
  }
  if (urlObj && urlObj.searchParams) {
    const qt = urlObj.searchParams.get("token");
    if (qt && qt.trim()) return qt.trim();
  }
  return "";
}

class OfficeSecurityGuard {
  constructor(options = {}) {
    this.secrets = options.secrets || ensureOfficeBridgeSecrets();
    this.allowedOrigins = options.allowedOrigins || DEFAULT_ALLOWED_ORIGINS;
    this.maxFailuresPerMinute = options.maxFailuresPerMinute || 20;
    this.maxRequestsPerMinute = options.maxRequestsPerMinute || 600;
    this.failedAuthByIp = new Map();
    this.requestsByIp = new Map();
  }

  _clientIp(req) {
    return String(req.socket?.remoteAddress || "127.0.0.1");
  }

  _checkRateLimit(map, ip, maxCount, windowMs = 60_000) {
    const now = Date.now();
    const cur = map.get(ip);
    if (!cur || now - cur.start > windowMs) {
      map.set(ip, { count: 1, start: now });
      return true;
    }
    cur.count += 1;
    return cur.count <= maxCount;
  }

  validateOrigin(req, requireOrigin = false) {
    const origin = req.headers?.origin;
    if (!origin) {
      return !requireOrigin;
    }
    return this.allowedOrigins.has(String(origin).trim().toLowerCase().replace(/\/$/, ""));
  }

  /**
   * Authorize an incoming HTTP request.
   * @param {import("node:http").IncomingMessage} req
   * @param {URL} urlObj
   * @param {{ requireMutationOwner?: boolean, actionName?: string }} opts
   */
  authorizeHttp(req, urlObj, opts = {}) {
    const ip = this._clientIp(req);
    if (!this._checkRateLimit(this.requestsByIp, ip, this.maxRequestsPerMinute)) {
      appendAuditEntry({ ip, action: opts.actionName || urlObj.pathname, allowed: false, reason: "rate_limited" });
      return { ok: false, status: 429, error: "Rate limit exceeded." };
    }

    const failEntry = this.failedAuthByIp.get(ip);
    if (failEntry && Date.now() - failEntry.start <= 60_000 && failEntry.count >= this.maxFailuresPerMinute) {
      return { ok: false, status: 429, error: "Too many failed authentication attempts." };
    }

    if (!this.validateOrigin(req, false)) {
      appendAuditEntry({ ip, origin: req.headers?.origin, action: opts.actionName || urlObj.pathname, allowed: false, reason: "forbidden_origin" });
      return { ok: false, status: 403, error: "Forbidden Origin header." };
    }

    const token = extractBearerOrHeaderToken(req, null);
    if (!timingSafeStringEqual(token, this.secrets.bridgeToken)) {
      this._checkRateLimit(this.failedAuthByIp, ip, this.maxFailuresPerMinute);
      appendAuditEntry({ ip, action: opts.actionName || urlObj.pathname, allowed: false, reason: "invalid_or_missing_token" });
      return { ok: false, status: 401, error: "Authentication required (valid Office Bridge Bearer token missing)." };
    }

    const callerId = String(req.headers?.["x-office-caller-id"] || req.headers?.["x-office-owner-id"] || AUTHORIZED_OWNER_ID || "").trim();
    const actorRole = String(req.headers?.["x-office-actor-role"] || "owner").trim().toLowerCase();

    if (opts.requireMutationOwner) {
      if (!AUTHORIZED_OWNER_ID || callerId !== AUTHORIZED_OWNER_ID || actorRole === "viewer" || actorRole === "unauthorized" || actorRole === "guest") {
        appendAuditEntry({
          ip,
          callerId,
          actorRole,
          action: opts.actionName || urlObj.pathname,
          allowed: false,
          reason: "unauthorized_caller_or_role",
        });
        return {
          ok: false,
          status: 403,
          error: `Forbidden: caller '${callerId}' (role '${actorRole}') is not authorized to mutate company state.`,
        };
      }
      appendAuditEntry({
        ip,
        callerId,
        actorRole,
        action: opts.actionName || urlObj.pathname,
        allowed: true,
        reason: "owner_mutation_authorized",
      });
    }

    return { ok: true, status: 200, callerId, actorRole };
  }

  /**
   * Authorize an incoming WebSocket upgrade request.
   * Note: For Hermes3D Gateway protocol `/ws`, the token can also arrive in the `connect` frame,
   * while Origin + IP loopback checks apply immediately on upgrade.
   */
  authorizeWsUpgrade(req, urlObj, { requireUpgradeToken = true } = {}) {
    const ip = this._clientIp(req);
    const isLoopback = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
    if (!isLoopback) {
      appendAuditEntry({ ip, action: `ws:${urlObj.pathname}`, allowed: false, reason: "non_loopback_ws" });
      return { ok: false, status: 403, error: "Loopback connections only." };
    }
    if (!this.validateOrigin(req, false)) {
      appendAuditEntry({ ip, origin: req.headers?.origin, action: `ws:${urlObj.pathname}`, allowed: false, reason: "forbidden_ws_origin" });
      return { ok: false, status: 403, error: "Untrusted WebSocket Origin." };
    }
    if (requireUpgradeToken) {
      const token = extractBearerOrHeaderToken(req, urlObj);
      if (!timingSafeStringEqual(token, this.secrets.bridgeToken)) {
        this._checkRateLimit(this.failedAuthByIp, ip, this.maxFailuresPerMinute);
        appendAuditEntry({ ip, action: `ws:${urlObj.pathname}`, allowed: false, reason: "missing_or_invalid_ws_token" });
        return { ok: false, status: 401, error: "Unauthorized WebSocket upgrade." };
      }
    }
    return { ok: true, status: 101 };
  }

  verifyConnectFrameToken(tokenCandidate) {
    return timingSafeStringEqual(String(tokenCandidate || "").trim(), this.secrets.bridgeToken);
  }
}

module.exports = {
  AUTHORIZED_OWNER_ID,
  SECRET_FILE_PATH,
  AUDIT_LOG_PATH,
  timingSafeStringEqual,
  ensureOfficeBridgeSecrets,
  appendAuditEntry,
  OfficeSecurityGuard,
};
