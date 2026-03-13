"use strict";

const fs = require("fs");

const LEVELS = new Set(["debug", "info", "warn", "error"]);
const RESERVED_FIELDS = new Set(["ts_utc", "service", "event", "level"]);
const STABLE_FIELDS = ["run_id", "user_id", "provider", "outcome"];

function normalizeLevel(level) {
  const candidate = String(level || "").trim().toLowerCase();
  if (LEVELS.has(candidate)) return candidate;
  return "info";
}

function normalizeEvent(event) {
  const candidate = String(event || "").trim();
  return candidate || "log";
}

function normalizeService(service) {
  const candidate = String(service || "").trim();
  return candidate || "signalbrief";
}

function normalizeScalar(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return String(value);
}

function normalizeFields(rawFields) {
  const out = {};
  if (!rawFields || typeof rawFields !== "object") return out;
  for (const [key, value] of Object.entries(rawFields)) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || RESERVED_FIELDS.has(normalizedKey)) continue;
    out[normalizedKey] = normalizeScalar(value);
  }
  return out;
}

function resolveNowIso(nowFactory) {
  if (typeof nowFactory !== "function") return new Date().toISOString();
  const value = nowFactory();
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const asDate = new Date(value);
  if (!Number.isNaN(asDate.getTime())) return asDate.toISOString();
  return new Date().toISOString();
}

function createStructuredLogger(options = {}) {
  const service = normalizeService(options.service);
  const sink = typeof options.sink === "function"
    ? options.sink
    : (line) => process.stdout.write(`${line}\n`);
  const filePath = String(options.filePath || "").trim();
  const now = typeof options.now === "function" ? options.now : null;
  const baseFields = normalizeFields(options.context || {});

  function emit(level, event, fields = {}) {
    const merged = {
      ...baseFields,
      ...normalizeFields(fields),
    };
    const payload = {
      ts_utc: resolveNowIso(now),
      level: normalizeLevel(level),
      service,
      event: normalizeEvent(event),
      run_id: null,
      user_id: null,
      provider: null,
      outcome: null,
    };

    for (const key of STABLE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(merged, key)) continue;
      payload[key] = normalizeScalar(merged[key]);
      delete merged[key];
    }

    if (Object.prototype.hasOwnProperty.call(merged, "message")) {
      payload.message = String(merged.message || "");
      delete merged.message;
    }

    Object.assign(payload, merged);
    const line = JSON.stringify(payload);
    sink(line, payload);

    if (filePath) {
      try {
        fs.appendFileSync(filePath, `${line}\n`);
      } catch {
        // best-effort file append
      }
    }

    return payload;
  }

  function withContext(extraFields = {}) {
    return createStructuredLogger({
      service,
      sink,
      filePath,
      now,
      context: {
        ...baseFields,
        ...normalizeFields(extraFields),
      },
    });
  }

  return {
    log: emit,
    debug(event, fields = {}) {
      return emit("debug", event, fields);
    },
    info(event, fields = {}) {
      return emit("info", event, fields);
    },
    warn(event, fields = {}) {
      return emit("warn", event, fields);
    },
    error(event, fields = {}) {
      return emit("error", event, fields);
    },
    withContext,
    child: withContext,
  };
}

module.exports = {
  createStructuredLogger,
  normalizeLevel,
  normalizeEvent,
  normalizeService,
  normalizeFields,
};
