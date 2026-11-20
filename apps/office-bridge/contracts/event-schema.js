"use strict";

/**
 * Phase 24 — Normalized Office Event Schema v1.0, Validator, Deduplicator,
 * Stale Detector, and Bounded Ring Buffer.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { sanitizePayload } = require("./redaction");

const SCHEMA_VERSION = "1.0";

const ALLOWED_EVENT_TYPES = new Set([
  "agent.discovered",
  "agent.updated",
  "agent.activated",
  "agent.paused",
  "agent.health_changed",

  "task.created",
  "task.assigned",
  "task.started",
  "task.updated",
  "task.delegated",
  "task.blocked",
  "task.completed",
  "task.failed",
  "task.cancelled",

  "run.started",
  "run.heartbeat",
  "run.completed",
  "run.failed",
  "run.cancelled",

  "tool.started",
  "tool.completed",
  "tool.failed",

  "approval.requested",
  "approval.resolved",

  "build.started",
  "build.completed",
  "test.started",
  "test.completed",

  "finding.imported",
  "finding.confirmed",
  "finding.resolved",

  "maintenance.started",
  "maintenance.completed",

  "runtime.connected",
  "runtime.disconnected",

  "meeting.started",
  "meeting.updated",
  "meeting.completed",
]);

const ALLOWED_SOURCES = new Set([
  "paperclip",
  "hermes",
  "vulnclaw_findings",
  "workflow_ledger",
  "maintenance_coordinator",
  "office_bridge",
  "telegram_sync",
]);

const STALE_THRESHOLD_MS = 60_000;

function normalizeIsoTimestamp(ts) {
  if (!ts) return new Date().toISOString();
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function isStaleTimestamp(isoString, nowMs = Date.now(), maxAgeMs = STALE_THRESHOLD_MS) {
  const parsed = Date.parse(isoString);
  if (Number.isNaN(parsed)) return true;
  return nowMs - parsed > maxAgeMs;
}

/**
 * Validate a candidate normalized event against schema_version "1.0".
 * @param {Record<string, unknown>} evt
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateOfficeEvent(evt) {
  const errors = [];
  if (!evt || typeof evt !== "object" || Array.isArray(evt)) {
    return { valid: false, errors: ["Event must be a JSON object."] };
  }
  if (evt.schema_version !== SCHEMA_VERSION) {
    errors.push(`Invalid schema_version: expected ${SCHEMA_VERSION}`);
  }
  if (typeof evt.event_id !== "string" || evt.event_id.trim().length < 4) {
    errors.push("Missing or invalid event_id.");
  }
  if (typeof evt.event_type !== "string" || !ALLOWED_EVENT_TYPES.has(evt.event_type)) {
    errors.push(`Unsupported event_type: ${String(evt.event_type)}`);
  }
  if (typeof evt.source !== "string" || !ALLOWED_SOURCES.has(evt.source)) {
    errors.push(`Unsupported source: ${String(evt.source)}`);
  }
  if (typeof evt.company_id !== "string" || !evt.company_id.trim()) {
    errors.push("company_id is required.");
  }
  if (typeof evt.sequence !== "number" || !Number.isInteger(evt.sequence) || evt.sequence < 1) {
    errors.push("sequence must be a positive integer.");
  }
  if (typeof evt.timestamp !== "string" || Number.isNaN(Date.parse(evt.timestamp))) {
    errors.push("timestamp must be a valid ISO-8601 string.");
  }
  if (!evt.payload || typeof evt.payload !== "object" || Array.isArray(evt.payload)) {
    errors.push("payload must be an object.");
  }
  return { valid: errors.length === 0, errors };
}

class NormalizedEventBus {
  /**
   * @param {{
   *   companyId: string,
   *   maxRetention?: number,
   *   maxDedupeKeys?: number,
   *   staleThresholdMs?: number,
   *   historyFilePath?: string | null,
   * }} options
   */
  constructor(options) {
    this.companyId = options.companyId;
    this.maxRetention = options.maxRetention || 500;
    this.maxDedupeKeys = options.maxDedupeKeys || 2500;
    this.staleThresholdMs = options.staleThresholdMs || STALE_THRESHOLD_MS;
    this.historyFilePath = options.historyFilePath || null;

    this.sequence = 0;
    /** @type {Array<Record<string, unknown>>} */
    this.buffer = [];
    /** @type {Map<string, number>} */
    this.dedupeMap = new Map();
    /** @type {Set<(evt: Record<string, unknown>) => void>} */
    this.subscribers = new Set();
    this.stats = {
      emitted: 0,
      deduplicated: 0,
      rejectedSchema: 0,
      staleMarked: 0,
    };

    this._hydrateFromDisk();
  }

  _hydrateFromDisk() {
    if (!this.historyFilePath) return;
    try {
      if (!fs.existsSync(this.historyFilePath)) return;
      const lines = fs
        .readFileSync(this.historyFilePath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-this.maxRetention);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed.sequence === "number") {
            this.buffer.push(parsed);
            if (parsed.sequence > this.sequence) {
              this.sequence = parsed.sequence;
            }
          }
        } catch {
          // ignore malformed historical line
        }
      }
    } catch {
      // non-fatal
    }
  }

  _appendToDisk(eventObj) {
    if (!this.historyFilePath) return;
    try {
      fs.mkdirSync(path.dirname(this.historyFilePath), { recursive: true });
      fs.appendFileSync(this.historyFilePath, JSON.stringify(eventObj) + "\n", "utf8");
      if (this.sequence % 250 === 0 && this.buffer.length > 0) {
        // Rotate / compact file so disk usage stays strictly bounded
        const compacted = this.buffer.map((e) => JSON.stringify(e)).join("\n") + "\n";
        fs.writeFileSync(this.historyFilePath, compacted, "utf8");
      }
    } catch {
      // non-fatal
    }
  }

  /**
   * Publish a normalized event if valid and not a duplicate.
   * @param {{
   *   event_type: string,
   *   source: string,
   *   company_id?: string,
   *   agent_id?: string | null,
   *   task_id?: string | null,
   *   run_id?: string | null,
   *   correlation_id?: string | null,
   *   timestamp?: string | Date,
   *   dedupe_key?: string | null,
   *   payload?: Record<string, unknown>,
   * }} input
   * @returns {{ accepted: boolean, reason?: string, event?: Record<string, unknown> }}
   */
  publish(input) {
    const nowMs = Date.now();
    const dedupeKey = input.dedupe_key ? String(input.dedupe_key).trim() : null;
    if (dedupeKey && this.dedupeMap.has(dedupeKey)) {
      this.stats.deduplicated += 1;
      return { accepted: false, reason: "duplicate_suppressed" };
    }

    const timestamp = normalizeIsoTimestamp(input.timestamp);
    const stale = isStaleTimestamp(timestamp, nowMs, this.staleThresholdMs);
    if (stale) {
      this.stats.staleMarked += 1;
    }

    const nextSeq = this.sequence + 1;
    const rawPayload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
      ? input.payload
      : {};
    const sanitizedPayload = sanitizePayload({
      ...rawPayload,
      ...(stale ? { stale: true } : {}),
    });

    const candidate = {
      schema_version: SCHEMA_VERSION,
      event_id: `evt-${crypto.randomUUID()}`,
      event_type: input.event_type,
      source: input.source,
      company_id: input.company_id || this.companyId,
      agent_id: input.agent_id ?? null,
      task_id: input.task_id ?? null,
      run_id: input.run_id ?? null,
      correlation_id: input.correlation_id ?? null,
      sequence: nextSeq,
      timestamp,
      payload: sanitizedPayload,
    };

    const check = validateOfficeEvent(candidate);
    if (!check.valid) {
      this.stats.rejectedSchema += 1;
      return { accepted: false, reason: `schema_error:${check.errors.join(";")}` };
    }

    this.sequence = nextSeq;
    if (dedupeKey) {
      this.dedupeMap.set(dedupeKey, nowMs);
      if (this.dedupeMap.size > this.maxDedupeKeys) {
        const oldestKey = this.dedupeMap.keys().next().value;
        if (oldestKey !== undefined) this.dedupeMap.delete(oldestKey);
      }
    }

    this.buffer.push(candidate);
    if (this.buffer.length > this.maxRetention) {
      this.buffer.splice(0, this.buffer.length - this.maxRetention);
    }

    this.stats.emitted += 1;
    this._appendToDisk(candidate);

    for (const fn of this.subscribers) {
      try {
        fn(candidate);
      } catch {
        // isolate subscriber errors
      }
    }

    return { accepted: true, event: candidate };
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  getEventsSince(sinceSeq = 0, limit = 200) {
    const seqNum = Number(sinceSeq) || 0;
    const filtered = this.buffer.filter((e) => e.sequence > seqNum);
    return filtered.slice(-limit);
  }

  getRecentEvents(limit = 100) {
    return this.buffer.slice(-limit);
  }
}

module.exports = {
  SCHEMA_VERSION,
  ALLOWED_EVENT_TYPES,
  ALLOWED_SOURCES,
  STALE_THRESHOLD_MS,
  normalizeIsoTimestamp,
  isStaleTimestamp,
  validateOfficeEvent,
  NormalizedEventBus,
};
