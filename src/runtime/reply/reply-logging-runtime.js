"use strict";

const LOG_LEVEL_ORDER = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function normalizeLogLevel(value) {
  const level = String(value || "").toLowerCase().trim();
  return LOG_LEVEL_ORDER[level] !== undefined ? level : "warn";
}

function pickSinkMethod(sink, level) {
  if (level === "debug" && typeof sink.debug === "function") return sink.debug.bind(sink);
  if (typeof sink[level] === "function") return sink[level].bind(sink);
  return typeof sink.log === "function" ? sink.log.bind(sink) : () => {};
}

function createReplyLogger(options = {}) {
  const sink = options.sink && typeof options.sink === "object" ? options.sink : console;
  const prefix = String(options.prefix || "[reply-handler]");
  const level = normalizeLogLevel(options.level || process.env.REPLY_HANDLER_LOG_LEVEL || "warn");
  const threshold = LOG_LEVEL_ORDER[level];

  function isEnabled(targetLevel) {
    const normalized = normalizeLogLevel(targetLevel);
    return LOG_LEVEL_ORDER[normalized] <= threshold;
  }

  function emit(targetLevel, message, payload) {
    if (!isEnabled(targetLevel)) return false;
    const method = pickSinkMethod(sink, targetLevel);
    if (payload !== undefined) {
      method(`${prefix} ${message}`, payload);
    } else {
      method(`${prefix} ${message}`);
    }
    return true;
  }

  return {
    level,
    isEnabled,
    error: (message, payload) => emit("error", message, payload),
    warn: (message, payload) => emit("warn", message, payload),
    info: (message, payload) => emit("info", message, payload),
    debug: (message, payload) => emit("debug", message, payload),
  };
}

function parseSampleRate(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function safeChatId(chatId) {
  const raw = String(chatId || "").trim();
  if (!raw) return "";
  if (raw.length <= 4) return "***";
  return `***${raw.slice(-4)}`;
}

function redactIntentForLogs(intent) {
  const input = intent && typeof intent === "object" ? intent : {};
  return {
    action: String(input.action || "unknown"),
    topic: input.topic ? String(input.topic).slice(0, 64) : "",
    items_count: Array.isArray(input.items) ? input.items.length : 0,
    email_present: Boolean(input.email),
    code_present: Boolean(input.code),
    question_present: Boolean(input.question),
  };
}

function createReplyIntentTracer(options = {}) {
  const logger = options.logger || createReplyLogger();
  const enabled = options.enabled !== undefined
    ? Boolean(options.enabled)
    : process.env.REPLY_HANDLER_TRACE_INTENT === "1";
  const sampleRate = parseSampleRate(
    options.sampleRate !== undefined
      ? options.sampleRate
      : process.env.REPLY_HANDLER_TRACE_SAMPLE_RATE,
    0
  );
  const random = typeof options.random === "function" ? options.random : Math.random;

  function shouldTrace() {
    if (!enabled) return false;
    if (sampleRate >= 1) return true;
    if (sampleRate <= 0) return false;
    return random() < sampleRate;
  }

  function traceIntent(intent, context = {}) {
    if (!shouldTrace()) return false;
    return logger.debug("intent_trace", {
      action: String(context.action || intent?.action || "unknown"),
      message_len: Math.max(0, Number(context.messageLen || 0)),
      chat_id: safeChatId(context.chatId),
      intent: redactIntentForLogs(intent),
    });
  }

  return {
    enabled,
    sampleRate,
    traceIntent,
  };
}

module.exports = {
  createReplyLogger,
  createReplyIntentTracer,
  redactIntentForLogs,
};
