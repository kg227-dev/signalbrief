const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(APP_ROOT, "data");
const EVENTS_FILE = path.join(DATA_DIR, "engagement-events.jsonl");

function etDateKey(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function resolveEventsFile(filePath) {
  const raw = String(filePath || "").trim();
  return raw ? path.resolve(raw) : EVENTS_FILE;
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
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
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
    const eventsFile = ensureEventsFile(input?.events_file || EVENTS_FILE);
    fs.appendFileSync(eventsFile, `${JSON.stringify(payload)}\n`);
    return appendResult(true, payload);
  } catch (err) {
    return appendResult(false, null, "write_failed", err?.message || "unknown write error");
  }
}

function loadEngagementEvents(opts = {}) {
  const eventsFile = ensureEventsFile(opts.events_file || EVENTS_FILE);
  const maxAgeCandidate = Number(opts.max_age_days);
  const maxAgeDays = Number.isFinite(maxAgeCandidate) && maxAgeCandidate > 0
    ? maxAgeCandidate
    : 45;
  const includeInvalidTimestamps = opts.include_invalid_timestamps === true;
  const dedupe = opts.dedupe !== false;
  const raw = fs.readFileSync(eventsFile, "utf8");
  if (!raw.trim()) return [];
  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const rows = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean)
    .filter((ev) => {
      const ts = Date.parse(ev.ts_utc || "");
      if (!Number.isFinite(ts)) return includeInvalidTimestamps;
      return ts >= cutoffMs;
    });

  if (!dedupe) return rows;
  const seen = new Set();
  const out = [];
  for (const ev of rows) {
    const key = String(ev.event_key || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}

function emitIgnoredEventsIfDue(opts = {}) {
  const windowHours = Math.max(1, Number(opts.window_hours || 24));
  const events = loadEngagementEvents({ max_age_days: Number(opts.max_age_days || 45), dedupe: true });
  if (!events.length) return { emitted: 0, considered: 0 };

  const cutoffMs = Date.now() - windowHours * 60 * 60 * 1000;
  const digestsById = new Map();
  const engagedItems = new Set();
  const ignoredKeys = new Set();

  for (const ev of events) {
    const digestId = String(ev.digest_id || "");
    const itemIndex = Number(ev?.item?.index || 0);
    if (ev.event_type === "digest_sent" && digestId && Array.isArray(ev?.metadata?.items)) {
      if (!digestsById.has(digestId)) digestsById.set(digestId, ev);
      continue;
    }
    if ((ev.event_type === "item_saved" || ev.event_type === "item_clicked") && digestId && itemIndex > 0) {
      engagedItems.add(`${digestId}:${itemIndex}`);
      continue;
    }
    if (ev.event_type === "item_ignored_computed" && ev.event_key) ignoredKeys.add(String(ev.event_key));
  }

  let considered = 0;
  let emitted = 0;
  let appendFailures = 0;
  for (const [digestId, sent] of digestsById.entries()) {
    const sentMs = Date.parse(sent.ts_utc || "");
    if (!Number.isFinite(sentMs) || sentMs > cutoffMs) continue;

    for (const item of (sent.metadata.items || [])) {
      const itemIndex = Number(item?.index || 0);
      if (!Number.isFinite(itemIndex) || itemIndex <= 0) continue;
      considered++;
      const actionKey = `${digestId}:${itemIndex}`;
      const ignoreKey = `ignored:${digestId}:${itemIndex}:${windowHours}`;
      if (engagedItems.has(actionKey) || ignoredKeys.has(ignoreKey)) continue;

      const digestDate = String(digestId.split(":")[0] || sent.date_et || etDateKey()).trim();
      const appendOutcome = appendEngagementEvent({
        event_type: "item_ignored_computed",
        event_key: ignoreKey,
        date_et: digestDate,
        user_chat_id: sent.user_chat_id,
        user_email: sent.user_email || null,
        digest_id: digestId,
        run_id: sent.run_id || null,
        channel: "system",
        source: "derived-processor",
        item: {
          index: itemIndex,
          headline: item.headline || null,
          url: item.url || null,
          tag: item.tag || null,
          base_score: Number.isFinite(Number(item.base_score)) ? Number(item.base_score) : null,
          topic_match: Number.isFinite(Number(item.topic_match)) ? Number(item.topic_match) : null,
          relevance_score: Number.isFinite(Number(item.relevance_score)) ? Number(item.relevance_score) : null,
        },
        window_hours: windowHours,
        metadata: { derived_from: "digest_sent", algorithm: "no-save-no-click-within-window" },
      });
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
  appendEngagementEvent,
  loadEngagementEvents,
  emitIgnoredEventsIfDue,
};
