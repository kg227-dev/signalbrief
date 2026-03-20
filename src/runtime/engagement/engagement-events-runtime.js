const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { normalizeCanonicalUrl } = require("../url-normalization-runtime");
const { resolveSignalBriefRuntimePaths } = require("../runtime-state-paths-runtime");

const EVENTS_FILE = resolveSignalBriefRuntimePaths().engagementEventsPath;
const ENGAGEMENT_CACHE = new Map();
const DEFAULT_CACHE_RETENTION_DAYS = 90;
const MAX_CACHE_INVALID_TS_EVENTS = 2000;
const MAX_CACHE_PARSE_ERROR_LINES = 2000;

function etDateKey(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function resolveEventsFile(filePath) {
  const raw = String(filePath || "").trim();
  return raw ? path.resolve(raw) : resolveSignalBriefRuntimePaths().engagementEventsPath;
}

function ensureEventsFile(filePath = EVENTS_FILE) {
  const target = resolveEventsFile(filePath);
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(target)) fs.writeFileSync(target, "");
  return target;
}

function buildDigestId(dateKey, chatId) {
  return `${String(dateKey || "").trim()}:${String(chatId || "").trim()}`;
}

function normalizeUrl(rawUrl) {
  return normalizeCanonicalUrl(rawUrl);
}

function appendResult(ok, event = null, code = "ok", detail = null) {
  return {
    ok: !!ok,
    code,
    error_code: code,
    detail,
    error_detail: detail,
    event,
  };
}

function appendEngagementEvent(input) {
  if (!input || typeof input !== "object") {
    return appendResult(false, null, "invalid_input", "input must be an object");
  }

  const now = new Date();
  const payload = {
    event_version: "v1",
    event_id: input.event_id || crypto.randomUUID(),
    event_type: String(input.event_type || "").trim(),
    event_key: String(input.event_key || "").trim(),
    ts_utc: input.ts_utc || now.toISOString(),
    date_et: input.date_et || etDateKey(now),
    user_chat_id: String(input.user_chat_id || "").trim(),
    user_email: input.user_email || null,
    digest_id: String(input.digest_id || "").trim(),
    run_id: input.run_id || null,
    channel: input.channel || "system",
    source: input.source || "scheduled-job",
    item: input.item || null,
    topic: input.topic || null,
    feedback: input.feedback || null,
    window_hours: Number.isFinite(Number(input.window_hours)) ? Number(input.window_hours) : null,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };

  if (!payload.event_type || !payload.event_key || !payload.user_chat_id || !payload.digest_id) {
    return appendResult(false, null, "missing_required_fields", "event_type, event_key, user_chat_id, and digest_id are required");
  }

  try {
    const eventsFile = ensureEventsFile(resolveEventsFile(input?.events_file));
    fs.appendFileSync(eventsFile, `${JSON.stringify(payload)}\n`);
    return appendResult(true, payload);
  } catch (err) {
    return appendResult(false, null, "write_failed", err?.message || "unknown write error");
  }
}

function appendEngagementEventChecked(input, opts = {}) {
  const outcome = appendEngagementEvent(input);
  if (outcome.ok) return outcome;

  const code = String(outcome.error_code || outcome.code || "unknown");
  const detail = outcome.detail ? ` (${outcome.detail})` : "";
  const scope = String(opts.scope || "engagement");
  const context = String(opts.context || "event");
  const logger = typeof opts.log === "function" ? opts.log : console.warn;
  logger(`[${scope}] engagement event write failed [${context}] code=${code}${detail}`);
  return outcome;
}

function readFileRangeSync(filePath, start, length) {
  if (!Number.isFinite(length) || length <= 0) return "";
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    let bytesReadTotal = 0;
    while (bytesReadTotal < length) {
      const bytesRead = fs.readSync(fd, buffer, bytesReadTotal, length - bytesReadTotal, start + bytesReadTotal);
      if (bytesRead <= 0) break;
      bytesReadTotal += bytesRead;
    }
    if (bytesReadTotal <= 0) return "";
    return buffer.subarray(0, bytesReadTotal).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function parseEventLines(raw, opts = {}) {
  const startLine = Math.max(1, Number(opts.start_line || 1));
  const parsedRows = String(raw || "").split("\n");
  const events = [];
  const parseErrorLines = [];
  let parseErrors = 0;
  for (let index = 0; index < parsedRows.length; index += 1) {
    const line = String(parsedRows[index] || "").trim();
    if (!line) continue;
    const parsed = parseEventLine(line);
    if (!parsed.ok) {
      parseErrors += 1;
      parseErrorLines.push(startLine + index);
      continue;
    }
    events.push(parsed.event);
  }
  return {
    events,
    parseErrors,
    parseErrorLines,
    lineCount: parsedRows.length,
  };
}

function createEngagementCacheEntry(filePath, stats, parsed, cacheRetentionDays) {
  return {
    filePath,
    fileSize: Number(stats?.size || 0),
    mtimeMs: Number(stats?.mtimeMs || 0),
    totalLines: Number(parsed.lineCount || 0),
    parseErrors: Number(parsed.parseErrors || 0),
    parseErrorLines: Array.isArray(parsed.parseErrorLines)
      ? parsed.parseErrorLines.slice(-MAX_CACHE_PARSE_ERROR_LINES)
      : [],
    events: pruneCachedEvents(parsed.events, cacheRetentionDays),
  };
}

function pruneCachedEvents(events, cacheRetentionDays) {
  const retentionDays = Number.isFinite(Number(cacheRetentionDays)) && Number(cacheRetentionDays) > 0
    ? Number(cacheRetentionDays)
    : DEFAULT_CACHE_RETENTION_DAYS;
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const fresh = [];
  const invalid = [];
  for (const event of Array.isArray(events) ? events : []) {
    const ts = Date.parse(event?.ts_utc || "");
    if (Number.isFinite(ts)) {
      if (ts >= cutoffMs) fresh.push(event);
      continue;
    }
    invalid.push(event);
  }
  const invalidTail = invalid.slice(-MAX_CACHE_INVALID_TS_EVENTS);
  return [...fresh, ...invalidTail];
}

function rebuildEngagementCache(eventsFile, cacheRetentionDays) {
  const raw = fs.readFileSync(eventsFile, "utf8");
  const parsed = parseEventLines(raw, { start_line: 1 });
  const stats = fs.statSync(eventsFile);
  const entry = createEngagementCacheEntry(eventsFile, stats, parsed, cacheRetentionDays);
  ENGAGEMENT_CACHE.set(eventsFile, entry);
  return entry;
}

function loadIncrementalEngagementCache(eventsFile, cacheRetentionDays) {
  const stats = fs.statSync(eventsFile);
  const cached = ENGAGEMENT_CACHE.get(eventsFile);
  if (!cached) return rebuildEngagementCache(eventsFile, cacheRetentionDays);

  const currentSize = Number(stats.size || 0);
  const currentMtime = Number(stats.mtimeMs || 0);
  const cachedSize = Number(cached.fileSize || 0);
  if (!Number.isFinite(cachedSize) || currentSize < cachedSize) {
    return rebuildEngagementCache(eventsFile, cacheRetentionDays);
  }
  if (currentSize === cachedSize && currentMtime === Number(cached.mtimeMs || 0)) {
    return cached;
  }
  if (currentSize === cachedSize && currentMtime !== Number(cached.mtimeMs || 0)) {
    return rebuildEngagementCache(eventsFile, cacheRetentionDays);
  }

  const appendedRaw = readFileRangeSync(eventsFile, cachedSize, currentSize - cachedSize);
  const parsed = parseEventLines(appendedRaw, { start_line: Number(cached.totalLines || 0) + 1 });
  cached.fileSize = currentSize;
  cached.mtimeMs = currentMtime;
  cached.totalLines = Number(cached.totalLines || 0) + Number(parsed.lineCount || 0);
  cached.parseErrors = Number(cached.parseErrors || 0) + Number(parsed.parseErrors || 0);
  cached.parseErrorLines = [...cached.parseErrorLines, ...parsed.parseErrorLines].slice(-MAX_CACHE_PARSE_ERROR_LINES);
  cached.events = pruneCachedEvents([...(Array.isArray(cached.events) ? cached.events : []), ...parsed.events], cacheRetentionDays);
  ENGAGEMENT_CACHE.set(eventsFile, cached);
  return cached;
}

function parseEventLine(line) {
  try {
    return { event: JSON.parse(line), ok: true };
  } catch (err) {
    return { event: null, ok: false, error: err };
  }
}

function isEventWithinRetention(event, cutoffMs, includeInvalidTimestamps) {
  const ts = Date.parse(event.ts_utc || "");
  if (!Number.isFinite(ts)) return includeInvalidTimestamps;
  return ts >= cutoffMs;
}

function dedupeEventsByKey(events) {
  const seen = new Set();
  const deduped = [];
  for (const event of events) {
    const key = String(event.event_key || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }
  return deduped;
}

function withParseMeta(events, parseErrors, parseErrorLines, returnMeta) {
  if (returnMeta === true) {
    return {
      events,
      parse_errors: parseErrors,
      parse_error_lines: parseErrorLines,
    };
  }
  events.parse_errors = parseErrors;
  events.parse_error_lines = parseErrorLines;
  return events;
}

function loadEngagementEvents(opts = {}) {
  const eventsFile = ensureEventsFile(resolveEventsFile(opts.events_file));
  const maxAgeCandidate = Number(opts.max_age_days);
  const maxAgeDays = Number.isFinite(maxAgeCandidate) && maxAgeCandidate > 0
    ? maxAgeCandidate
    : 45;
  const cacheRetentionDays = Math.max(
    maxAgeDays,
    Number.isFinite(Number(opts.cache_retention_days)) && Number(opts.cache_retention_days) > 0
      ? Number(opts.cache_retention_days)
      : DEFAULT_CACHE_RETENTION_DAYS
  );
  const includeInvalidTimestamps = opts.include_invalid_timestamps === true;
  const dedupe = opts.dedupe !== false;
  const captureParseErrorLines = opts.capture_parse_error_lines !== false;
  const returnMeta = opts.return_meta === true;
  if (opts.force_cache_rebuild === true) ENGAGEMENT_CACHE.delete(eventsFile);
  const cached = loadIncrementalEngagementCache(eventsFile, cacheRetentionDays);
  if (!Array.isArray(cached.events) || cached.events.length === 0) {
    return withParseMeta([], Number(cached.parseErrors || 0), captureParseErrorLines ? cached.parseErrorLines : [], returnMeta);
  }

  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const rows = cached.events
    .filter((event) => isEventWithinRetention(event, cutoffMs, includeInvalidTimestamps));
  const events = dedupe ? dedupeEventsByKey(rows) : rows;
  const parseErrors = Number(cached.parseErrors || 0);
  const parseErrorLines = captureParseErrorLines
    ? (Array.isArray(cached.parseErrorLines) ? cached.parseErrorLines.slice() : [])
    : [];
  return withParseMeta(events, parseErrors, parseErrorLines, returnMeta);
}

function indexDigestEvents(events) {
  const digestsById = new Map();
  const engagedItems = new Set();
  const ignoredKeys = new Set();

  for (const event of events) {
    const digestId = String(event.digest_id || "");
    const itemIndex = Number(event?.item?.index || 0);
    if (event.event_type === "digest_sent" && digestId && Array.isArray(event?.metadata?.items)) {
      if (!digestsById.has(digestId)) digestsById.set(digestId, event);
      continue;
    }
    if ((event.event_type === "item_saved" || event.event_type === "item_clicked") && digestId && itemIndex > 0) {
      engagedItems.add(`${digestId}:${itemIndex}`);
      continue;
    }
    if (event.event_type === "item_ignored_computed" && event.event_key) {
      ignoredKeys.add(String(event.event_key));
    }
  }

  return { digestsById, engagedItems, ignoredKeys };
}

function toIgnoredItemPayload(item, itemIndex) {
  return {
    index: itemIndex,
    headline: item.headline || null,
    url: item.url || null,
    tag: item.tag || null,
    base_score: Number.isFinite(Number(item.base_score)) ? Number(item.base_score) : null,
    topic_match: Number.isFinite(Number(item.topic_match)) ? Number(item.topic_match) : null,
    relevance_score: Number.isFinite(Number(item.relevance_score)) ? Number(item.relevance_score) : null,
  };
}

function buildIgnoredEventInput({ digestId, sentEvent, item, itemIndex, windowHours }) {
  const digestDate = String(digestId.split(":")[0] || sentEvent.date_et || etDateKey()).trim();
  return {
    event_type: "item_ignored_computed",
    event_key: `ignored:${digestId}:${itemIndex}:${windowHours}`,
    date_et: digestDate,
    user_chat_id: sentEvent.user_chat_id,
    user_email: sentEvent.user_email || null,
    digest_id: digestId,
    run_id: sentEvent.run_id || null,
    channel: "system",
    source: "derived-processor",
    item: toIgnoredItemPayload(item, itemIndex),
    window_hours: windowHours,
    metadata: { derived_from: "digest_sent", algorithm: "no-save-no-click-within-window" },
  };
}

function emitIgnoredEventsIfDue(opts = {}) {
  const windowHours = Math.max(1, Number(opts.window_hours || 24));
  const events = loadEngagementEvents({ max_age_days: Number(opts.max_age_days || 45), dedupe: true });
  if (!events.length) return { emitted: 0, considered: 0 };

  const cutoffMs = Date.now() - windowHours * 60 * 60 * 1000;
  const { digestsById, engagedItems, ignoredKeys } = indexDigestEvents(events);

  let considered = 0;
  let emitted = 0;
  let appendFailures = 0;
  for (const [digestId, sentEvent] of digestsById.entries()) {
    const sentMs = Date.parse(sentEvent.ts_utc || "");
    if (!Number.isFinite(sentMs) || sentMs > cutoffMs) continue;

    for (const item of (sentEvent.metadata.items || [])) {
      const itemIndex = Number(item?.index || 0);
      if (!Number.isFinite(itemIndex) || itemIndex <= 0) continue;
      considered++;
      const actionKey = `${digestId}:${itemIndex}`;
      const ignoreKey = `ignored:${digestId}:${itemIndex}:${windowHours}`;
      if (engagedItems.has(actionKey) || ignoredKeys.has(ignoreKey)) continue;

      const appendOutcome = appendEngagementEvent(buildIgnoredEventInput({
        digestId,
        sentEvent,
        item,
        itemIndex,
        windowHours,
      }));
      if (!appendOutcome.ok) {
        appendFailures++;
        continue;
      }
      ignoredKeys.add(ignoreKey);
      emitted++;
    }
  }

  return { emitted, considered, append_failures: appendFailures };
}

module.exports = {
  EVENTS_FILE,
  etDateKey,
  buildDigestId,
  normalizeUrl,
  resolveEventsFile,
  appendEngagementEvent,
  appendEngagementEventChecked,
  loadEngagementEvents,
  emitIgnoredEventsIfDue,
};
