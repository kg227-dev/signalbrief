#!/usr/bin/env node
/**
 * SignalBrief — digest.js
 * Fetches news via Perplexity Sonar, summarizes via Claude,
 * delivers via Telegram + Gmail.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, "config.json"), "utf8")
);
const EMAIL_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "templates/email.html"),
  "utf8"
);
const { readUser, writeUser, allUsers } = require("./store");
const { sendEmail: sendEmailViaMailer, buildOpenTrackingPixel } = require("./mailer");
const { appendEngagementEvent, buildDigestId, loadEngagementEvents } = require("./engagement-events");
const { computeDigestQualityScore } = require("./quality-score");
const { applyAutoTopicLearning } = require("./personalization");
const {
  filterDigestItemsByTopics,
  scoreDigestItemsForUser,
  applyDigestDepth,
  reserveCustomKeywordSlot,
} = require("./digest-pipeline-seam");
const { selectItemsByPolicy } = require("./selection-domain");
const {
  buildCustomTopicQueries,
  customKeywordMatches,
  normalizeMatchText,
  normalizeTopicToken,
  topicsRelated,
} = require("./topic-domain");

const LOG_FILE = "/tmp/signalbrief.log";
const COST_LOG = path.join(__dirname, "data", "cost-log.json");
const DIGEST_RUN_LOCK = path.join(__dirname, "data", "digest-run.lock");
const DIGEST_INCIDENT_LOG = path.join(__dirname, "data", "digest-incident-log.jsonl");
const DIGEST_LOCK_STALE_MS = Math.max(5 * 60 * 1000, Number(process.env.DIGEST_LOCK_STALE_MS || (2 * 60 * 60 * 1000)));
const BASE_URL = process.env.BASE_URL || "https://getsignalbrief.com";

function buildPublicDigestUrl(dateKey) {
  const key = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  return `${BASE_URL}/digest/${key}`;
}

// ET time helpers
function getEtNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}
function toEtDateString(iso) {
  return iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null;
}
function toEtDateKey(date) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// API cost estimates
const PERPLEXITY_COST_PER_CALL  = 0.005;   // Sonar model per call
const CLAUDE_HAIKU_IN_PER_MTOK  = 0.80;    // $/million input tokens
const CLAUDE_HAIKU_OUT_PER_MTOK = 4.00;    // $/million output tokens

function appendCostLog(entry) {
  try {
    const dir = path.dirname(COST_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(COST_LOG, JSON.stringify(entry) + "\n");
  } catch (e) {
    log(`⚠️  Cost log write failed: ${e.message}`);
  }
}

function appendIncidentLog(entry) {
  try {
    const dir = path.dirname(DIGEST_INCIDENT_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(DIGEST_INCIDENT_LOG, JSON.stringify(entry) + "\n");
  } catch (e) {
    log(`⚠️ Incident log write failed: ${e.message}`);
  }
}

function incidentKeySeenRecently(eventKey, maxAgeHours = 24) {
  try {
    if (!eventKey || !fs.existsSync(DIGEST_INCIDENT_LOG)) return false;
    const cutoff = Date.now() - Math.max(1, Number(maxAgeHours || 24)) * 60 * 60 * 1000;
    const lines = fs.readFileSync(DIGEST_INCIDENT_LOG, "utf8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const row = JSON.parse(lines[i]);
        const ts = Date.parse(row?.ts_utc || "");
        if (Number.isFinite(ts) && ts < cutoff) break;
        if (String(row?.event_key || "") === String(eventKey)) return true;
      } catch (err) {
        log(`⚠️ Incident log row parse failed: ${err.message}`);
      }
    }
  } catch (err) {
    log(`⚠️ Incident log read failed: ${err.message}`);
  }
  return false;
}

async function emitDigestIncident(type, summary, metadata = {}) {
  const now = new Date();
  const hourBucket = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const eventKey = `digest-incident:${String(type || "unknown")}:${hourBucket}`;
  if (incidentKeySeenRecently(eventKey, 48)) return false;

  const entry = {
    ts_utc: now.toISOString(),
    date_et: toEtDateKey(now),
    event_key: eventKey,
    type: String(type || "unknown"),
    summary: String(summary || "").trim(),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };
  appendIncidentLog(entry);

  const opsChatId = process.env.OPS_ALERT_CHAT_ID || CONFIG?.user?.telegramChatId || null;
  if (opsChatId) {
    const lines = [
      "ALERT SignalBrief incident",
      `Type: ${entry.type}`,
      `Summary: ${entry.summary}`,
      `ET date: ${entry.date_et}`,
      `Mode: ${entry.metadata.mode || "scheduled"}`,
      `Due users: ${entry.metadata.due_users != null ? entry.metadata.due_users : "-"}`,
      `Standard topics: ${entry.metadata.standard_topics != null ? entry.metadata.standard_topics : "-"}`,
      `Selected items: ${entry.metadata.selected_items != null ? entry.metadata.selected_items : "-"}`,
    ];
    try {
      await sendTelegram(lines.join("\n"), opsChatId);
    } catch (e) {
      log(`⚠️ Incident alert send failed: ${e.message}`);
    }
  }
  return true;
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

function appendEngagementEventChecked(payload, context) {
  const outcome = appendEngagementEvent(payload);
  if (!outcome.ok) {
    const code = String(outcome.error_code || outcome.code || "unknown");
    const detail = outcome.detail ? ` (${outcome.detail})` : "";
    log(`⚠️ Engagement event write failed (${context}) code=${code}${detail}`);
  }
  return outcome;
}

let digestLockOwned = false;
function readDigestLock() {
  if (!fs.existsSync(DIGEST_RUN_LOCK)) return null;

  let rawText = "";
  try {
    rawText = fs.readFileSync(DIGEST_RUN_LOCK, "utf8");
  } catch (err) {
    return {
      state: "io_error",
      error: err.message,
      error_code: err?.code || null,
    };
  }

  let lock;
  try {
    lock = JSON.parse(rawText);
  } catch (err) {
    return {
      state: "corrupt",
      error: `invalid_json:${err.message}`,
    };
  }

  const ts = Date.parse(lock?.startedAt || "");
  if (!Number.isFinite(ts)) {
    return {
      state: "corrupt",
      error: "missing_or_invalid_startedAt",
      raw: lock,
    };
  }
  const ageMs = Math.max(0, Date.now() - ts);
  const state = ageMs > DIGEST_LOCK_STALE_MS ? "stale" : "valid";
  return { ...lock, state, ageMs, stale: state === "stale" };
}

function clearDigestLock() {
  try {
    if (fs.existsSync(DIGEST_RUN_LOCK)) fs.unlinkSync(DIGEST_RUN_LOCK);
    return true;
  } catch (err) {
    log(`⚠️ Failed to clear digest lock: ${err.message}`);
    return false;
  }
}

function acquireDigestLock(mode) {
  const existing = readDigestLock();
  if (existing) {
    if (existing.state === "stale") {
      if (!clearDigestLock()) {
        return {
          ok: false,
          reason: "stale_uncleared",
          lock: {
            ...existing,
            state: "stale_uncleared",
            error: "stale_lock_clear_failed",
          },
        };
      }
    } else if (existing.state === "valid") {
      return { ok: false, reason: "locked", lock: existing };
    } else {
      log(`⚠️ Digest lock requires manual intervention (state=${existing.state}, detail=${existing.error || "unknown"})`);
      return { ok: false, reason: existing.state, lock: existing };
    }
  }
  const dir = path.dirname(DIGEST_RUN_LOCK);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = {
    startedAt: new Date().toISOString(),
    pid: process.pid,
    mode: mode || "scheduled",
  };
  try {
    const fd = fs.openSync(DIGEST_RUN_LOCK, "wx");
    try {
      fs.writeFileSync(fd, JSON.stringify(payload));
    } finally {
      fs.closeSync(fd);
    }
    digestLockOwned = true;
    return { ok: true, lock: payload };
  } catch (err) {
    if (err?.code !== "EEXIST") {
      log(`⚠️ Failed to acquire digest lock: ${err.message}`);
    }
    const lock = readDigestLock();
    return { ok: false, reason: "race_or_locked", lock };
  }
}

function releaseDigestLock() {
  if (!digestLockOwned) return;
  digestLockOwned = false;
  clearDigestLock();
}

// ── User state helpers ────────────────────────────────────────────────────────
// Uses store.js — per-user JSON in data/ directory

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function httpsPost(hostname, path_, headers, body, isForm = false) {
  return new Promise((resolve, reject) => {
    const data = isForm ? body : JSON.stringify(body);
    const req = https.request(
      { hostname, path: path_, method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(out) }); }
          catch { resolve({ status: res.statusCode, body: out }); }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(new Error("HTTP timeout after 30s")); });
    req.write(data);
    req.end();
  });
}

async function httpsPostWithRetry(hostname, path_, headers, body, opts = {}) {
  const retries = Math.max(0, Number(opts.retries ?? 2));
  const retryDelayMs = Math.max(100, Number(opts.retryDelayMs ?? 1200));
  const isForm = !!opts.isForm;

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await httpsPost(hostname, path_, headers, body, isForm);
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || "");
      const retryable = /timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg);
      if (!retryable || attempt >= retries) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }

  throw lastErr || new Error("HTTP request failed");
}

// ── 1. Fetch news via Perplexity Sonar (with real URLs from citations) ───────

async function fetchTopicNews(topic) {
  log(`Fetching: ${topic.tag}`);
  const queries = Array.isArray(topic?.queries) && topic.queries.length
    ? topic.queries.map((q) => String(q || "").trim()).filter(Boolean)
    : [];
  if (!queries.length) {
    const empty = [];
    empty.__apiCalls = 0;
    return empty;
  }

  const maxAttempts = topic?.isCustom ? Math.min(3, queries.length) : 1;
  const collected = [];
  const seenUrl = new Set();
  const seenHeadline = new Set();
  let apiCalls = 0;

  for (let idx = 0; idx < maxAttempts; idx++) {
    const query = queries[idx];
    if (idx > 0) log(`↳ ${topic.tag} fallback query ${idx + 1}/${maxAttempts}`);

    let res;
    try {
      res = await httpsPostWithRetry(
        "api.perplexity.ai", "/chat/completions",
        { "Content-Type": "application/json", "Authorization": `Bearer ${CONFIG.keys.perplexity}` },
        {
          model: "sonar",
          messages: [
            {
              role: "system",
              content: `You are a business and strategy news researcher covering AI, technology, healthcare, financial services, private equity, M&A, energy, consumer, policy, and consulting.
Return ONLY a JSON array of up to 3 distinct news items from the last 48 hours.
Each item MUST include the direct article URL from your citations — not the homepage.
Format: [{"headline": string, "summary": string (1 sentence, max 20 words, factual lede only — no analysis), "source": string (domain, e.g. wsj.com), "url": string (full direct article URL from your citations), "tag": "${topic.tag}"}]
No markdown. No explanation. JSON array only.`,
            },
            {
              role: "user",
              content: `Find the 3 most important news items from the last 48 hours about: ${query}
IMPORTANT: Use the direct article URLs from your search citations. Do not use homepage URLs.`,
            },
          ],
          max_tokens: 1000,
        }
      );
      apiCalls += 1;
    } catch (e) {
      log(`⚠️ Perplexity ${topic.tag} query failed (${idx + 1}/${maxAttempts}): ${String(e?.message || e).slice(0, 180)}`);
      continue;
    }

    if (res.status >= 400) {
      const errDetail = res.body?.error?.message || res.body?.error || res.body?.message || `status ${res.status}`;
      log(`⚠️ Perplexity ${topic.tag} request returned ${res.status}: ${String(errDetail).slice(0, 180)}`);
      continue;
    }

    // Extract article URLs from Perplexity citations if available
    const citations = res.body?.citations || [];

    try {
      let content = res.body?.choices?.[0]?.message?.content || "[]";
      if (!res.body?.choices?.[0]?.message?.content) {
        const errDetail = res.body?.error?.message || res.body?.error || res.body?.message || "no choices content";
        log(`⚠️ Perplexity returned empty payload for ${topic.tag}: ${String(errDetail).slice(0, 180)}`);
      }
      content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      let items = JSON.parse(content);
      if (!Array.isArray(items)) {
        log(`⚠️ Perplexity payload for ${topic.tag} was not an array`);
        continue;
      }

      // Patch URLs: if item URL looks like a homepage (no path), try to match from citations
      items = items.map((item) => {
        if (!item.url || item.url === "#") return { ...item, tag: topic.tag };
        try {
          const u = new URL(item.url);
          // Homepage if path is "/" or empty
          if (u.pathname === "/" || u.pathname === "") {
            // Find citation from same domain
            const match = citations.find((c) => {
              try { return new URL(c).hostname === u.hostname; } catch { return false; }
            });
            if (match) return { ...item, url: match, tag: topic.tag };
          }
        } catch (err) {
          log(`⚠️ Invalid item URL for ${topic.tag}: ${err.message}`);
        }
        return { ...item, tag: topic.tag };
      });

      for (const item of items) {
        if (!item || !item.headline) continue;
        const headKey = String(item.headline || "").toLowerCase().trim().slice(0, 80);
        const urlKey = normalizeUrlForDedup(item.url || "");
        if (headKey && seenHeadline.has(headKey)) continue;
        if (urlKey && seenUrl.has(urlKey)) continue;
        if (headKey) seenHeadline.add(headKey);
        if (urlKey) seenUrl.add(urlKey);
        collected.push(item);
        if (collected.length >= 3) break;
      }
    } catch (e) {
      log(`Parse error for ${topic.tag}: ${e.message}`);
    }

    if (collected.length >= 3) break;
    if (!topic?.isCustom && collected.length >= 1) break;
    if (topic?.isCustom && collected.length >= 2) break;
  }

  const out = collected.slice(0, 3);
  out.__apiCalls = apiCalls;
  return out;
}

// ── 2. Select best N (interleaved, max per tag/source, capped custom share) ──

function parseSourceDomain(item) {
  const rawUrl = String(item?.url || "").trim();
  if (rawUrl) {
    try {
      return new URL(rawUrl).hostname.replace(/^www\./i, "").toLowerCase();
    } catch (err) {
      log(`⚠️ Unable to parse source domain from URL: ${err.message}`);
    }
  }

  const rawSource = String(item?.source || "").trim().toLowerCase();
  if (!rawSource) return "unknown";
  return rawSource.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\/\s]/)[0] || "unknown";
}

function normalizeUrlForDedup(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) parsed.pathname = parsed.pathname.slice(0, -1);
    return parsed.toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function headlineFingerprint(text, width = 60) {
  return normalizeMatchText(text).slice(0, width);
}

function loadRecentArchiveItems(days = 3) {
  const archiveDir = path.join(__dirname, "archive");
  if (!fs.existsSync(archiveDir)) return [];
  const files = fs.readdirSync(archiveDir).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) return [];

  const recent = files.slice(-Math.max(1, Number(days || 3)));
  const items = [];
  for (const file of recent) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(archiveDir, file), "utf8"));
      items.push(...(parsed?.items || []));
    } catch (err) {
      log(`⚠️ Failed to parse archive file ${file}: ${err.message}`);
    }
  }
  return items;
}

function dedupAgainstRecentArchives(items, opts = {}) {
  const dedupDays = Math.max(1, Number(opts.days || 3));
  const target = Math.max(1, Number(opts.targetCount || 7));
  const minBackfillItems = Math.max(1, Number(opts.minBackfillItems || 3));
  const recentItems = loadRecentArchiveItems(dedupDays);
  if (!recentItems.length) {
    return { items: items || [], removed: 0, archive_days_used: 0, backfilled: 0 };
  }

  const seenUrls = new Set(
    recentItems.map((i) => normalizeUrlForDedup(i?.url)).filter(Boolean)
  );
  const seenHeadlines = new Set(
    recentItems.map((i) => headlineFingerprint(i?.headline)).filter(Boolean)
  );

  const kept = [];
  const removed = [];
  for (const item of (items || [])) {
    const urlKey = normalizeUrlForDedup(item?.url);
    const headKey = headlineFingerprint(item?.headline);
    const duplicate = (urlKey && seenUrls.has(urlKey)) || (headKey && seenHeadlines.has(headKey));
    if (duplicate) removed.push(item);
    else kept.push(item);
  }

  let backfilled = 0;
  if (kept.length < minBackfillItems && removed.length > 0) {
    const backfillTarget = Math.min(target, minBackfillItems);
    const backfill = removed.slice(0, backfillTarget - kept.length);
    kept.push(...backfill);
    backfilled = backfill.length;
  }

  return {
    items: kept,
    removed: removed.length,
    archive_days_used: dedupDays,
    backfilled,
  };
}

function buildRecentRepeatIndex(days = 3) {
  const lookbackDays = Math.max(1, Number(days || 3));
  const recentItems = loadRecentArchiveItems(lookbackDays);
  const urlKeys = new Set(
    recentItems.map((i) => normalizeUrlForDedup(i?.url)).filter(Boolean)
  );
  const headlineKeys = new Set(
    recentItems.map((i) => headlineFingerprint(i?.headline)).filter(Boolean)
  );
  return {
    days: lookbackDays,
    urlKeys,
    headlineKeys,
  };
}

function isRecentRepeatItem(item, repeatIndex) {
  if (!repeatIndex || typeof repeatIndex !== "object") return false;
  const urlKey = normalizeUrlForDedup(item?.url);
  const headKey = headlineFingerprint(item?.headline);
  return (
    (urlKey && repeatIndex.urlKeys instanceof Set && repeatIndex.urlKeys.has(urlKey))
    || (headKey && repeatIndex.headlineKeys instanceof Set && repeatIndex.headlineKeys.has(headKey))
  );
}

function getUserRecentDigestUrlKeys(user, opts = {}) {
  const maxDigests = Math.max(1, Number(opts.maxDigests || 3));
  const keys = new Set();
  const history = Array.isArray(user?.recent_digest_url_history)
    ? user.recent_digest_url_history.slice(-maxDigests)
    : [];

  if (history.length > 0) {
    for (const row of history) {
      const urls = Array.isArray(row?.urls) ? row.urls : [];
      for (const url of urls) {
        const key = normalizeUrlForDedup(url);
        if (key) keys.add(key);
      }
    }
  } else if (Array.isArray(user?.last_digest_items)) {
    for (const item of user.last_digest_items) {
      const key = normalizeUrlForDedup(item?.url);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function suppressRecentlySentForUser(items, user, opts = {}) {
  const arr = Array.isArray(items) ? items : [];
  const minItems = Math.max(1, Number(opts.minItems || 3));
  const recentKeys = getUserRecentDigestUrlKeys(user, opts);
  if (!recentKeys.size) {
    return { items: arr, removed: 0, recent_keys: 0, backfilled: 0 };
  }

  const kept = [];
  const removed = [];
  for (const item of arr) {
    const key = normalizeUrlForDedup(item?.url);
    if (key && recentKeys.has(key)) removed.push(item);
    else kept.push(item);
  }

  let backfilled = 0;
  if (kept.length < minItems && removed.length > 0) {
    const add = removed.slice(0, minItems - kept.length);
    kept.push(...add);
    backfilled = add.length;
  }

  return {
    items: kept,
    removed: removed.length,
    recent_keys: recentKeys.size,
    backfilled,
  };
}

function selectItems(allItems, opts = {}) {
  const maxItems = Math.max(1, Number(opts.maxItems || CONFIG.digest.itemCount || 7));
  const maxItemsPerTag = Math.max(1, Number(opts.maxItemsPerTag || CONFIG.digest.maxItemsPerTag || 2));
  const maxItemsPerSourceDomain = Math.max(1, Number(opts.maxItemsPerSourceDomain || CONFIG.digest.maxItemsPerSourceDomain || 2));
  const customTagOrder = [...new Set((opts.customTags || []).map((t) => String(t || "").toLowerCase()).filter(Boolean))];
  const customTags = new Set(customTagOrder);
  const tagPriority = opts.tagPriority && typeof opts.tagPriority === "object" ? opts.tagPriority : {};
  const explicitCustomCap = Number(opts.maxCustomItems);
  const maxCustomItems = Number.isFinite(explicitCustomCap)
    ? Math.max(0, explicitCustomCap)
    : (customTags.size > 0 ? Math.max(1, Math.floor(maxItems * 0.4)) : Infinity);
  return selectItemsByPolicy(allItems, {
    maxItems,
    perTagCap: maxItemsPerTag,
    perSourceCap: maxItemsPerSourceDomain,
    customTagOrder,
    customTags,
    tagPriority,
    maxCustomItems,
  }, {
    normalizeUrl: normalizeUrlForDedup,
    parseDomain: parseSourceDomain,
    normalizeTopicToken,
    isCandidate: (_item, ctx) => Boolean(ctx.headlineKey),
  });
}

// ── 3. Enrich with Claude (sharp consultant lens) ────────────────────────────

async function enrichItems(items) {
  log("Enriching with Claude...");

  const prompt = `You are the editorial voice of SignalBrief — a daily news digest for senior strategy consultants and business professionals. Your readers work at MBB, Big 4, boutique strategy firms, corporate strategy functions, and PE/investment shops. They work across multiple industries and need to sound informed in client meetings across healthcare, tech, financial services, PE, energy, consumer, and policy. They are time-pressed, sophisticated, and allergic to generic analysis.

TASK: For each news item below, return five fields:

1. "wim_brief" — one sentence, max 18 words.
   RULES:
   - Capture only the core strategic punchline for a busy executive.
   - Keep this descriptive only (what changed + why now); do not include role-specific actions or "Watch:" language.
   - No filler, no hedging, no repetition of the headline.
   - Do not use HTML tags in this field.

2. "wim" — a "why it matters" analysis of exactly 2-3 sentences.
   RULES:
   - Use 2 sentences by default; use 3 only when there is a concrete near-term catalyst.
   - First sentence: sharp strategic implication with one named entity and one explicit business impact (pricing, margin, demand, cost, capex, valuation, or market share). Wrap in <strong> tags.
   - Second sentence: start with "For <role>," and state a concrete action for the next 1-2 quarters. Include a causal link ("because", "as", or "which means") plus at least one specific company, regulator, or investor type AND one business lever (pricing, margin, demand, cost, capex, valuation, or market share).
   - Second sentence must introduce at least one NEW fact not in sentence one (new actor, metric, catalyst, or timeline). Do not paraphrase sentence one.
   - Avoid hedging and filler: do NOT use "could", "may", "might", "potentially", "likely", "industry broadly", "stakeholders", or "monitor developments".
   - Include at least one concrete proper noun in sentence 1 or 2 (company, regulator, buyer segment, or fund type).
   - Include one concrete quantitative anchor when available from the source context (deal value, percentage, timeline, or count). If not available, use a bounded near-term qualifier (for example "next 2 quarters").
   - Third sentence (optional): must start with "Watch:" and name a specific catalyst in the next 2-4 weeks (filing, ruling, earnings call, close date, or vote). Skip only if no concrete catalyst exists.

3. "baseScore" — a number 0.0–10.0 measuring the story's strategic importance and consultant relevance, independent of any user's topic preferences.
   - 8.5–10.0: Major development (landmark M&A, significant policy shift, key earnings miss with broad implications)
   - 7.0–8.4: Notable development (meaningful deal, regulatory move, sector-level change)
   - 5.0–6.9: Moderate interest (incremental update, early-stage signal worth watching)
   - Below 5.0: Routine or narrow-interest item

4. "implications" — one actionable sentence naming a specific role (e.g. "CFO", "deal team", "payer CMO", "PE portfolio team") and the concrete action, question, or client meeting flag this story creates. Return null if it is fully covered by the wim already.

5. "watch_next" — one forward-looking sentence: name the specific signal, filing, earnings call, or regulatory decision to monitor in the next 2–4 weeks. Start with an entity name or date. Return null if this is a one-time development with no near-term pending catalysts.

WHAT TO AVOID (too generic):
❌ "This could have significant implications for the industry." (says nothing)
❌ "Companies should pay attention to this trend." (empty filler)
❌ "This may affect stakeholders over time." (vague hedge)
❌ "Keep an eye on developments." (no actionable signal)

WHAT TO AIM FOR (specific, implication-forward):
✅ "<strong>Another payer going full care-delivery stack — point-solution vendors in drug management will feel it.</strong> Your buyer is now also your competitor's parent company. Any vendor with Cigna in their top-3 logos needs to stress-test that relationship."

Return ONLY a JSON array with the same items plus "wim_brief", "wim", "baseScore", "implications", and "watch_next" fields. No markdown, no explanation.

Items:
${JSON.stringify(items.map(i => ({ headline: i.headline, summary: i.summary, tag: i.tag })), null, 2)}`;

  const res = await httpsPostWithRetry(
    "api.anthropic.com", "/v1/messages",
    { "Content-Type": "application/json", "x-api-key": CONFIG.keys.anthropic, "anthropic-version": "2023-06-01" },
    { model: "claude-haiku-4-5", max_tokens: 4500, messages: [{ role: "user", content: prompt }] }
  );

  const usage = {
    input_tokens:  res.body?.usage?.input_tokens  || 0,
    output_tokens: res.body?.usage?.output_tokens || 0,
  };

  function parseJsonArrayLenient(raw) {
    const cleaned = String(raw || "")
      .replace(/```json\n?/gi, "")
      .replace(/```\n?/g, "")
      .trim();
    if (!cleaned) return [];
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      // Claude occasionally appends prose after a valid JSON array.
      const start = cleaned.indexOf("[");
      if (start === -1) throw err;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === "\"") inString = false;
          continue;
        }
        if (ch === "\"") { inString = true; continue; }
        if (ch === "[") depth++;
        else if (ch === "]") {
          depth--;
          if (depth === 0) {
            const candidate = cleaned.slice(start, i + 1);
            return JSON.parse(candidate);
          }
        }
      }
      throw err;
    }
  }

  try {
    const enriched = parseJsonArrayLenient(res.body?.content?.[0]?.text || "[]");
    if (!Array.isArray(enriched)) throw new Error("Claude response was not a JSON array");
    // Merge wim + baseScore back onto original items (which have URLs)
    return {
      items: items.map((item, i) => ({
        ...item,
        wim_brief:    typeof enriched[i]?.wim_brief === "string" && enriched[i].wim_brief.trim() ? enriched[i].wim_brief.trim() : null,
        wim:          typeof enriched[i]?.wim === "string" && enriched[i].wim.trim() ? enriched[i].wim.trim() : null,
        baseScore:    typeof enriched[i]?.baseScore === "number" ? enriched[i].baseScore : 5.0,
        implications: typeof enriched[i]?.implications === "string" && enriched[i].implications.trim() ? enriched[i].implications.trim() : null,
        watch_next:   typeof enriched[i]?.watch_next === "string" && enriched[i].watch_next.trim() ? enriched[i].watch_next.trim() : null,
      })),
      usage,
    };
  } catch (e) {
    log(`Claude parse error: ${e.message}`);
    return {
      // Degrade gracefully (no "analysis unavailable" placeholder shown to end users).
      items: items.map((i) => ({ ...i, wim: null, implications: null, watch_next: null })),
      usage,
    };
  }
}

// ── 3b. Score items by relevance (zero extra API cost) ───────────────────────
// baseScore comes from enrichItems (already paid for in that call).
// topicMatch is computed locally — free.
// finalScore = baseScore (60%) + topicMatch (40%) + weightBonus (+ optional specialist bonus)
//
// topic_weights (from "more X" / "less X" commands) are keyed by whatever string
// Claude returns from intent parsing (e.g., "AI", "healthcare") — not necessarily
// the canonical tag. matchWeightToTag() does case-insensitive substring matching
// so "AI" matches "AI×TECH" and "health" matches "HEALTHCARE".
// Each weight unit = ±0.6 points on the 0–10 scale (range: -5 to +5 → -3.0 to +3.0).
// Specialist mode adds an additional boost/penalty for narrow-topic users so exact matches
// are preserved at the top of the ranking before broad balancing.

function scoreColor(score) {
  if (score >= 9.0) {
    return { dot: "#10B981", text: "#065F46", bg: "#ECFDF5", glow: "0 0 6px rgba(16,185,129,0.35)" };
  }
  if (score >= 7.0) {
    return { dot: "#34D399", text: "#065F46", bg: "#ECFDF5", glow: "0 0 6px rgba(52,211,153,0.3)" };
  }
  if (score >= 5.0) {
    return { dot: "#F59E0B", text: "#92400E", bg: "#FFFBEB", glow: "0 0 5px rgba(245,158,11,0.24)" };
  }
  return { dot: "#9CA3AF", text: "#4B5563", bg: "#F3F4F6", glow: "none" };
}

function stripInlineHtml(raw) {
  return String(raw || "")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeSingleLineModelOutput(raw) {
  return String(raw || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function callHaikuOneLine(prompt, maxTokens) {
  const res = await httpsPostWithRetry(
    "api.anthropic.com",
    "/v1/messages",
    { "Content-Type": "application/json", "x-api-key": CONFIG.keys.anthropic, "anthropic-version": "2023-06-01" },
    {
      model: "claude-haiku-4-5",
      max_tokens: Math.max(8, Number(maxTokens || 40)),
      messages: [{ role: "user", content: String(prompt || "").trim() }],
    }
  );
  const usage = {
    input_tokens: Number(res.body?.usage?.input_tokens || 0),
    output_tokens: Number(res.body?.usage?.output_tokens || 0),
  };
  if (res.status >= 400) throw new Error(`haiku status ${res.status}`);
  const text = sanitizeSingleLineModelOutput(res.body?.content?.[0]?.text || "");
  return { text, usage };
}

function fallbackSubjectLine(now) {
  const label = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
  return `Your signals for ${label}`;
}

async function generateLeadSubjectLine(leadItem, now) {
  const fallback = fallbackSubjectLine(now);
  if (!leadItem || !leadItem.headline) {
    return { subject: fallback, usage: { input_tokens: 0, output_tokens: 0 } };
  }

  const prompt = `Given this news headline and "why it matters" analysis, write a single email subject line (max 65 characters) for a daily briefing aimed at strategy consultants. The subject should hint at the strategic implication without being clickbait. No emoji. No "SignalBrief" in the subject.

Headline: ${stripInlineHtml(leadItem.headline)}
Why it matters: ${stripInlineHtml(leadItem.wim || leadItem.wim_brief || leadItem.summary || "")}

Reply with ONLY the subject line, no quotes, no explanation.`;

  try {
    const { text, usage } = await callHaikuOneLine(prompt, 60);
    if (!text || text.length > 100 || /[\r\n]/.test(text) || /signalbrief/i.test(text)) {
      return { subject: fallback, usage };
    }
    return { subject: text, usage };
  } catch {
    return { subject: fallback, usage: { input_tokens: 0, output_tokens: 0 } };
  }
}

async function generateEditorialNote(items) {
  const safeItems = Array.isArray(items) ? items.filter((item) => item && item.headline) : [];
  if (!safeItems.length) return { note: "", usage: { input_tokens: 0, output_tokens: 0 } };

  const stories = safeItems
    .map((item) => `[${String(item.tag || "news").trim()}] ${stripInlineHtml(item.headline)}`)
    .join(", ");
  const prompt = `Write a single editorial sentence (max 120 characters) for a strategy professional's morning briefing. It should flag the most important cross-sector or non-obvious pattern across today's ${safeItems.length} stories. Be specific. Name a sector or player. No hedging. No "today's digest" language.

Stories: ${stories}

Reply with ONLY the sentence, no quotes.`;

  try {
    const { text, usage } = await callHaikuOneLine(prompt, 40);
    if (!text || text.length > 120 || /[\r\n]/.test(text)) {
      return { note: "", usage };
    }
    return { note: text, usage };
  } catch {
    return { note: "", usage: { input_tokens: 0, output_tokens: 0 } };
  }
}

const STANDARD_TOPIC_TOKENS = new Set([
  "healthcare",
  "financial services",
  "pe m a",
  "energy",
  "consumer",
  "life sciences",
  "technology",
  "industrials",
  "real estate",
  "public sector",
  "ai tech",
  "strategy",
  "policy regulatory",
  "sustainability",
  "digital",
  "m a advisory",
  "talent",
]);

const TOPIC_ICON_MAP = {
  ai: "🤖",
  "ai tech": "🤖",
  technology: "⚙️",
  digital: "⚙️",
  healthcare: "🏥",
  "life sciences": "🧬",
  strategy: "🧭",
  finance: "📊",
  "financial services": "📊",
  markets: "📈",
  sustainability: "🌍",
  climate: "🌍",
  energy: "⚡",
  startups: "🚀",
  policy: "🏛",
  "policy regulatory": "🏛",
  pharma: "💊",
  cybersecurity: "🔐",
  "supply chain": "🚚",
  industrials: "🏭",
  manufacturing: "🏭",
  consumer: "🛍",
  economics: "📉",
  "public sector": "🏛",
  "real estate": "🏢",
  "pe m a": "🤝",
  "m a advisory": "🤝",
  talent: "👥",
};

function topicVisual(tagValue) {
  const raw = String(tagValue || "").trim();
  const token = normalizeTopicToken(raw);
  const isCustom = !!token && !STANDARD_TOPIC_TOKENS.has(token);
  let icon = TOPIC_ICON_MAP[token] || "";
  if (!icon && token.includes("health")) icon = "🏥";
  if (!icon && token.includes("policy")) icon = "🏛";
  if (!icon && token.includes("energy")) icon = "⚡";
  if (!icon && token.includes("climate")) icon = "🌍";
  if (!icon && token.includes("tech")) icon = "⚙️";
  if (!icon && token.includes("finance")) icon = "📊";
  if (!icon && token.includes("market")) icon = "📈";
  if (!icon && token.includes("pharma")) icon = "💊";
  if (!icon && token.includes("bio")) icon = "🧬";
  if (!icon && token.includes("supply")) icon = "🚚";
  if (!icon && token.includes("industrial")) icon = "🏭";
  if (!icon && token.includes("consumer")) icon = "🛍";
  if (!icon && token.includes("start")) icon = "🚀";
  if (!icon && token.includes("cyber")) icon = "🔐";
  if (!icon && token.includes("econ")) icon = "📉";
  if (!icon) icon = isCustom ? "✨" : "📰";

  return {
    icon,
    isCustom,
    chipBg: isCustom ? "rgba(139,92,246,0.14)" : "rgba(59,130,246,0.12)",
    chipText: isCustom ? "#7C3AED" : "#2563EB",
  };
}

function buildCustomRescueItemsFromStandard(standardItems, customKeywords = [], existingItems = [], maxPerKeyword = 1) {
  const standard = Array.isArray(standardItems) ? standardItems : [];
  const existing = Array.isArray(existingItems) ? existingItems : [];
  const out = [];
  const seenHeadlines = new Set(existing.map((i) => headlineFingerprint(i?.headline)).filter(Boolean));
  const seenUrls = new Set(existing.map((i) => normalizeUrlForDedup(i?.url)).filter(Boolean));
  const cap = Math.max(1, Number(maxPerKeyword || 1));

  for (const rawKeyword of customKeywords) {
    const keyword = normalizeTopicToken(rawKeyword);
    if (!keyword) continue;

    const alreadyCovered = existing.some((item) => {
      const text = normalizeMatchText(`${item?.headline || ""} ${item?.summary || ""}`);
      const tag = normalizeTopicToken(item?.tag || "");
      return customKeywordMatches(keyword, text, tag);
    });
    if (alreadyCovered) continue;

    const matches = standard.filter((item) => {
      const text = normalizeMatchText(`${item?.headline || ""} ${item?.summary || ""}`);
      const tag = normalizeTopicToken(item?.tag || "");
      return customKeywordMatches(keyword, text, tag);
    });
    if (!matches.length) continue;

    let used = 0;
    for (const item of matches) {
      if (used >= cap) break;
      const headKey = headlineFingerprint(item?.headline);
      const urlKey = normalizeUrlForDedup(item?.url);
      if ((headKey && seenHeadlines.has(headKey)) || (urlKey && seenUrls.has(urlKey))) continue;
      if (headKey) seenHeadlines.add(headKey);
      if (urlKey) seenUrls.add(urlKey);
      out.push({
        ...item,
        tag: String(rawKeyword || "").toUpperCase(),
        custom_rescue: true,
      });
      used += 1;
    }
  }

  return out;
}

// ── 4. Format Telegram message ───────────────────────────────────────────────

function buildCommandMenu(state) {
  const isNewUser = state.digests_received < 5;
  if (isNewUser) {
    return [
      "───",
      "📧 Deeper takes in your email",
      "",
      "💾 save 3 → bookmarks item 3",
      "💾 save 1,4,6 → bookmarks multiple",
      "📊 more AI → see more AI stories",
      "📉 less M&A → see fewer M&A stories",
      "➕ add GLP-1 → track a new topic",
      "⚙️ settings → view/change all preferences",
    ].join("\n");
  }
  return [
    "───",
    "📧 Deeper takes in your email",
    "💾 save [#] · 📊 more/less [topic] · ⚙️ settings",
  ].join("\n");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTopicDisplay(topic) {
  const raw = String(topic || "")
    .replace(/^custom_/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "topic";
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildLearningSummary(adjustments, maxTopics = 2) {
  const rows = (Array.isArray(adjustments) ? adjustments : [])
    .map((adj) => ({
      topic: formatTopicDisplay(adj?.topic),
      delta: Number(adj?.delta),
    }))
    .filter((row) => row.topic && Number.isFinite(row.delta) && row.delta !== 0);
  if (!rows.length) return "";

  const shown = rows.slice(0, Math.max(1, Number(maxTopics) || 2));
  const parts = shown.map((row) => `${row.topic} ${row.delta > 0 ? `+${row.delta}` : row.delta}`);
  const remaining = rows.length - shown.length;
  const suffix = remaining > 0 ? ` · +${remaining} more` : "";
  return `Applied from your recent saves, clicks, and skips: ${parts.join(" · ")}${suffix}.`;
}

function digestQualityLabel(digestQuality) {
  const score = Number(digestQuality?.score);
  if (!Number.isFinite(score)) return null;
  const rounded = Math.max(0, Math.min(100, Math.round(score)));
  const band = String(digestQuality?.band || "").toLowerCase();
  const bandLabel = band === "strong" ? "strong" : (band === "watch" ? "watch" : "tuning");
  return {
    score: rounded,
    band: bandLabel,
  };
}

function formatTelegram(items, dateStr, state, opts = {}) {
  const NUM_LABELS = ["1⃣","2⃣","3⃣","4⃣","5⃣","6⃣","7⃣","8⃣","9⃣","🔟"];
  const quality = digestQualityLabel(opts.digestQuality);
  const learningSummary = String(opts.learningSummary || "").trim();
  const publicDigestUrl = String(opts.publicDigestUrl || "").trim();
  const lines = [
    `☀️ *SignalBrief — ${dateStr}*`,
    `_Your daily signal across AI, strategy, and business_`,
  ];
  if (quality) lines.push(`🎯 Digest match: ${quality.score}% · ${quality.band}`);
  if (learningSummary) lines.push(`🧠 ${learningSummary}`);
  if (publicDigestUrl) lines.push(`🔗 [Share today's brief](${publicDigestUrl})`);
  lines.push("");
  items.forEach((item, i) => {
    const num = NUM_LABELS[i] || `${i + 1}.`;
    // Strip ALL HTML first (including <strong>) before splitting — bold asterisks break
    // the sentence-boundary lookbehind. Cap at 250 chars (plaintext sentence avg ~200).
    const rawWim = item.wim
      ? item.wim
          .replace(/<\/?[^>]+>/g, "")
          .split(/(?<=[a-z][.!?]|[!?])\s+(?=[A-Z])/)[0]
      : null;
    const wim = rawWim
      ? (rawWim.length > 250 ? rawWim.slice(0, 247).replace(/\s+\S*$/, "") + "…" : rawWim)
      : null;
    lines.push(`${num} *[${item.tag}]* ${item.headline}`);
    if (wim) lines.push(`_${wim}_`);
    if (item.url && item.url !== "#") {
      lines.push(`→ [${item.source}](${item.url})`);
    } else {
      lines.push(`→ ${item.source}`);
    }
    const whyShown = Array.isArray(item.why_shown) && item.why_shown.length
      ? item.why_shown.map((k) => String(k).replace(/_/g, " ")).join(", ")
      : null;
    if (whyShown) lines.push(`· why shown: ${whyShown}`);
    lines.push("");
  });
  lines.push(buildCommandMenu(state));
  return lines.join("\n");
}

function buildDigestInlineKeyboard(items) {
  const inlineKeyboard = [];
  const safeItems = Array.isArray(items) ? items : [];

  safeItems.slice(0, 10).forEach((_, idx) => {
    const itemNum = idx + 1;
    inlineKeyboard.push([
      { text: `💾 ${itemNum}`, callback_data: `sb:save:${itemNum}` },
      { text: `➕ ${itemNum}`, callback_data: `sb:more:${itemNum}` },
      { text: `➖ ${itemNum}`, callback_data: `sb:less:${itemNum}` },
    ]);
  });

  // P1-5 feedback capture row (one response per digest).
  inlineKeyboard.push([
    { text: "🔥 Great", callback_data: "sb:fb:great" },
    { text: "👍 Fine", callback_data: "sb:fb:fine" },
    { text: "👎 Meh", callback_data: "sb:fb:meh" },
  ]);

  return { inline_keyboard: inlineKeyboard };
}

// ── 5. Build HTML email ──────────────────────────────────────────────────────

function buildEmailHeaderMeta(itemsCount, digestQuality) {
  const quality = digestQualityLabel(digestQuality);
  const readMins = Math.max(2, Math.ceil(Number(itemsCount || 0) * 0.6));
  return `${itemsCount} signals • ${readMins} min read${quality ? ` • Match ${quality.score}%` : ""}`;
}

function buildWelcomeBanner(isFirstDigest, filterNote, userToken) {
  if (!isFirstDigest) return "";
  return `
  <div style="padding:24px 28px 22px;background:#F0FDF4;border-bottom:1px solid #BBF7D0;">
    <div style="font-size:21px;font-weight:700;color:#15803D;margin-bottom:8px;">👋 Welcome to SignalBrief</div>
    <div style="font-size:14px;color:#166534;line-height:1.6;margin-bottom:20px;">Your first briefing is below — ${filterNote}. Here's what you're looking at:</div>
    <div style="font-size:13px;color:#374151;margin-bottom:20px;">
      <div style="margin-bottom:12px;">
        <strong>📰 Headline + "Why it matters"</strong><br>
        <span style="color:#6B7280;">Each signal includes a strategic analysis written for how consultants think about implications — not just what happened, but who feels it and what moves next.</span>
      </div>
      <div style="margin-bottom:12px;">
        <strong>🎯 Relevance scores</strong> — shown as signal pills like <span style="display:inline-block;background:#ECFDF5;color:#065F46;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10B981;box-shadow:0 0 5px rgba(16,185,129,0.35);vertical-align:middle;margin-right:5px;"></span>8.5</span><br>
        <span style="color:#6B7280;">Ranked 0–10 per story: 40% topic match · 35% market significance · 25% strategic utility.</span>
      </div>
      <div>
        <strong>⚙️ Personalized to your topics</strong><br>
        <span style="color:#6B7280;">This digest is ${filterNote}. Tune anytime — email "more [topic]" or "less [topic]" to adjust what you see, or update your full preferences below.</span>
      </div>
    </div>
    <a href="${BASE_URL}/settings?token=${userToken}" style="display:inline-block;background:#15803D;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:999px;">Update preferences →</a>
  </div>`;
}

function buildPersonalizationNote(learningSummary) {
  const summary = String(learningSummary || "").trim();
  if (!summary) return "";
  return `
  <div style="padding:12px 28px;background:#F8FAFC;border-bottom:1px solid #EAECEF;">
    <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748B;margin-bottom:4px;">Personalization update</div>
    <div style="font-size:13px;line-height:1.5;color:#334155;">🧠 ${escapeHtml(summary)}</div>
  </div>`;
}

function buildEditorialNote(editorialNoteText) {
  const text = String(editorialNoteText || "").trim();
  if (!text) return "";
  return `
  <div style="padding:10px 28px;background:#F0F4FF;border-bottom:1px solid #EAECEF;">
    <p style="margin:0;font-size:13px;color:#4B5563;font-style:italic;">${escapeHtml(text)}</p>
  </div>`;
}

function renderDigestItemHtml(item, index, opts = {}) {
  const userToken = String(opts.userToken || "");
  const digestId = String(opts.digestId || "");
  const depth = String(opts.depth || "headline_plus_why");
  const linkUrl = item.url && item.url !== "#" ? item.url : `https://${item.source}`;
  const trackedLinkUrl = userToken && digestId
    ? `${BASE_URL}/api/click?token=${encodeURIComponent(userToken)}&did=${encodeURIComponent(digestId)}&item=${index + 1}&url=${encodeURIComponent(linkUrl)}`
    : linkUrl;
  const topic = topicVisual(item.tag);
  const tagText = escapeHtml(String(item.tag || "NEWS"));

  const score = Number(item.relevanceScore);
  const scoreHtml = Number.isFinite(score) ? (() => {
    const c = scoreColor(score);
    return `<span style="display:inline-block;font-size:12px;font-weight:700;color:${c.text};background:${c.bg};padding:4px 10px;border-radius:999px;letter-spacing:0.01em;line-height:1;">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.dot};box-shadow:${c.glow};vertical-align:middle;margin-right:6px;"></span>
      <span style="vertical-align:middle;">${score.toFixed(1)}</span>
    </span>`;
  })() : "";

  const wimHtml = item.wim
    ? `<div style="font-size:11px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#2563EB;margin-bottom:5px;">Why it matters</div>\n        <div style="font-size:14px;color:#374151;line-height:1.65;margin-bottom:10px;">${item.wim}</div>`
    : "";

  const isDeep = depth === "headline_plus_why" || depth === "full" || depth === "deep";
  const implHtml = (isDeep && item.implications)
    ? `<div style="font-size:13px;color:#1D4ED8;line-height:1.6;margin-bottom:6px;font-weight:500;">→ ${item.implications}</div>`
    : "";
  const watchHtml = (isDeep && item.watch_next)
    ? `<div style="font-size:12px;color:#6B7280;line-height:1.6;margin-bottom:12px;font-style:italic;">👀 ${item.watch_next}</div>`
    : "";
  const whyShownHtml = Array.isArray(item.why_shown) && item.why_shown.length
    ? `<div style="font-size:11px;color:#6B7280;line-height:1.5;margin-bottom:10px;">Why shown: ${item.why_shown.map((k) => String(k).replace(/_/g, " ")).join(" · ")}</div>`
    : "";

  const itemStyle = "background:#FFFFFF;border-radius:14px;border:1px solid #ECEFF3;box-shadow:0 2px 6px rgba(0,0,0,0.04);padding:20px;margin:0 0 18px;";
  return `
      <div class="item" style="${itemStyle}">
        <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-bottom:10px;">
          <tr>
            <td style="vertical-align:middle;padding:0 8px 0 0;">
              <span style="font-size:15px;color:#6B7280;font-weight:700;margin-right:8px;">${index + 1}</span>
              <span style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${topic.chipText};background:${topic.chipBg};padding:4px 9px;border-radius:7px;">${topic.icon} ${tagText}</span>
            </td>
            <td style="text-align:right;vertical-align:middle;padding:0;white-space:nowrap;">${scoreHtml}</td>
          </tr>
        </table>
        <div style="font-size:20px;font-weight:700;color:#111827;line-height:1.3;letter-spacing:-0.01em;margin-bottom:10px;">${item.headline}</div>
        <div style="font-size:15px;color:#374151;line-height:1.6;margin-bottom:14px;">${item.summary}</div>
        ${wimHtml}
        ${implHtml}
        ${watchHtml}
        ${whyShownHtml}
        <div style="font-size:14px;"><a href="${trackedLinkUrl}" style="color:#2563EB;text-decoration:none;font-weight:600;">Read more →</a><span style="font-size:12px;color:#9CA3AF;">&nbsp;&nbsp;${escapeHtml(item.source || "")}</span></div>
      </div>`;
}

function renderSettingsFooter(user, userToken) {
  if (!user) return "";
  const prefs = user.preferences || {};
  const [sh, sm] = (prefs.delivery_time || "07:00").split(":").map(Number);
  const sampm = sh >= 12 ? "PM" : "AM";
  const shour = sh % 12 || 12;
  const sTimeStr = `${shour}${sm === 0 ? "" : ":" + String(sm).padStart(2, "0")} ${sampm} ET`;
  const sDays = prefs.days_of_week || [1, 2, 3, 4, 5];
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let sDaysStr;
  if (sDays.length === 7) sDaysStr = "Every day";
  else if (sDays.length === 5 && !sDays.includes(0) && !sDays.includes(6)) sDaysStr = "Mon–Fri";
  else sDaysStr = sDays.map(d => DAY_NAMES[d]).join(", ");
  const SDEPTH = { headline_only: "Scan", scan: "Scan", headline_plus_oneliner: "Brief", headline_plus_why: "Deep", full: "Deep", deep: "Deep" };
  const sDepth = SDEPTH[prefs.depth] || "Deep";
  const sTopics = (user.topics || []).map((t) => formatTopicDisplay(t)).join(" · ") || "—";
  const sSettingsUrl = `${BASE_URL}/settings?token=${userToken}`;
  return `
    <div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #EAECEF;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#9CA3AF;margin-bottom:8px;">Your digest settings</div>
      <div style="font-size:13px;color:#6B7280;line-height:1.75;">
        <div><span style="color:#4B5563;font-weight:600;">Topics:</span> ${escapeHtml(sTopics)}</div>
        <div><span style="color:#4B5563;font-weight:600;">Delivery:</span> ${escapeHtml(`${sTimeStr} • ${sDaysStr}`)}</div>
        <div><span style="color:#4B5563;font-weight:600;">Depth:</span> ${escapeHtml(sDepth)}</div>
      </div>
      <div style="margin-top:6px;">
        <a href="${sSettingsUrl}" style="font-size:13px;font-weight:600;color:#2563EB;text-decoration:none;">Edit settings →</a>
      </div>
    </div>`;
}

function applyTemplateSlots(template, slots = {}) {
  return template
    .replace(/\{\{DATE\}\}/g, slots.dateStr || "")
    .replace("{{ITEM_COUNT}}", slots.headerMeta || "")
    .replace("{{QUICK_SCAN}}", slots.quickScan || "")
    .replace("{{WELCOME_BANNER}}", slots.welcomeBanner || "")
    .replace("{{PERSONALIZATION_NOTE}}", slots.personalizationNote || "")
    .replace("{{EDITORIAL_NOTE}}", slots.editorialNote || "")
    .replace("{{SETTINGS_FOOTER}}", slots.settingsFooter || "")
    .replace(/\{\{BASE_URL\}\}/g, slots.baseUrl || "")
    .replace(/\{\{PUBLIC_DIGEST_URL\}\}/g, slots.publicDigestUrl || "")
    .replace(/\{\{PUBLIC_DIGEST_URL_ENCODED\}\}/g, slots.publicDigestUrlEncoded || "")
    .replace(/\{\{SETTINGS_TOKEN\}\}/g, slots.userToken || "")
    .replace(/\{\{CURRENT_DIGEST_DATE\}\}/g, slots.digestDateKey || "")
    .replace(
      /<!-- Items -->[\s\S]*<!-- Footer -->/,
      `<!-- Items -->\n    <div class="items" style="padding:18px 18px 10px;background:#FFFFFF;">\n${slots.itemsHtml || ""}\n    </div>\n\n    <!-- Footer -->`
    );
}

function buildEmail(
  items,
  dateStr,
  quickScan,
  userToken = "",
  isFirstDigest = false,
  wasFiltered = true,
  depth = "headline_plus_why",
  user = null,
  digestDateKey = "",
  digestId = "",
  opts = {}
) {
  const filterNote = wasFiltered
    ? "filtered to your selected topics"
    : "today's top signals across all areas";
  const learningSummary = String(opts.learningSummary || "").trim();
  const editorialNoteText = String(opts.editorialNote || "").trim();
  const publicDigestUrlBase = String(opts.publicDigestUrl || "").trim()
    || buildPublicDigestUrl(digestDateKey)
    || BASE_URL;
  const publicDigestUrl = userToken
    ? `${publicDigestUrlBase}${publicDigestUrlBase.includes("?") ? "&" : "?"}ref=${encodeURIComponent(userToken)}`
    : publicDigestUrlBase;
  const publicDigestUrlEncoded = encodeURIComponent(publicDigestUrl);
  const headerMeta = buildEmailHeaderMeta(items.length, opts.digestQuality);
  const itemsHtml = items
    .map((item, index) => renderDigestItemHtml(item, index, { userToken, digestId, depth }))
    .join("\n");

  return applyTemplateSlots(EMAIL_TEMPLATE, {
    dateStr,
    headerMeta,
    quickScan,
    welcomeBanner: buildWelcomeBanner(isFirstDigest, filterNote, userToken),
    personalizationNote: buildPersonalizationNote(learningSummary),
    editorialNote: buildEditorialNote(editorialNoteText),
    settingsFooter: renderSettingsFooter(user, userToken),
    baseUrl: BASE_URL,
    publicDigestUrl,
    publicDigestUrlEncoded,
    userToken,
    digestDateKey: digestDateKey || "",
    itemsHtml,
  });
}

// ── 6. Send via SignalBrief bot ───────────────────────────────────────────────

async function sendTelegram(text, chatId, extra = {}) {
  const targetId = chatId || CONFIG.user.telegramChatId;
  log(`Sending Telegram to ${targetId}...`);
  const token = CONFIG.keys.signalBriefBotToken || CONFIG.keys.telegramBotToken;
  const res = await httpsPostWithRetry(
    "api.telegram.org", `/bot${token}/sendMessage`,
    { "Content-Type": "application/json" },
    { chat_id: targetId, text, parse_mode: "Markdown", disable_web_page_preview: false, ...extra }
  );
  if (res.body?.ok) {
    log(`✅ Telegram sent to ${targetId}`);
    return;
  }
  const detail = res.body?.description || JSON.stringify(res.body) || `status ${res.status}`;
  throw new Error(`telegram send failed: ${detail}`);
}

// ── 7. Send Email (via mailer.js — Resend if configured, Gmail fallback) ──────

async function sendEmail(toEmail, subject, html, token = null) {
  const target = toEmail || CONFIG.user.email;
  log(`Sending email to ${target}...`);
  const result = await sendEmailViaMailer(target, subject, html, token);
  if (result.ok) {
    log(`✅ Email sent via ${result.via}`);
    return;
  }
  throw new Error(`email send failed via ${result.via || "mailer"}`);
}

// ── Archive ───────────────────────────────────────────────────────────────────

function saveToArchive(date, items, dateStr, quickScan, opts = {}) {
  const { overwrite = false } = opts;
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) {
    log("⚠️ Archive write skipped: no items");
    return;
  }
  const archiveDir = path.join(__dirname, "archive");
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir);
  const key = toEtDateKey(date);
  const file = path.join(archiveDir, `${key}.json`);
  if (fs.existsSync(file) && !overwrite) return;
  const entry = {
    date: key,
    dateStr,
    quickScan,
    items: safeItems.map(i => ({
      tag:         i.tag,
      headline:    i.headline,
      summary:     i.summary,
      wim_brief:   i.wim_brief || null,
      wim:         i.wim,
      implications: i.implications || null,
      watch_next:  i.watch_next || null,
      url:         i.url,
      source:      i.source,
      source_domain: i.source_domain || parseSourceDomain(i),
      baseScore:   i.baseScore != null ? i.baseScore : null,
      why_shown:   Array.isArray(i.why_shown) ? i.why_shown : [],
    })),
    generatedAt: date.toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(entry, null, 2));
  log(`📁 Archived: ${key}${overwrite ? " (overwrite)" : ""}`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  // Support --chatId flag for on-demand single-user delivery (/digest command)
  const args = process.argv.slice(2);
  const chatIdIdx = args.indexOf("--chatId");
  const targetChatId = chatIdIdx !== -1 ? args[chatIdIdx + 1] : null;
  const dryRun = args.includes("--dry-run") || process.env.DIGEST_DRY_RUN === "1";
  const suppressWelcome = args.includes("--suppressWelcome");
  const runMode = targetChatId ? "targeted" : "scheduled";
  const runId = `${runMode}:${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const lock = acquireDigestLock(runMode);
  if (!lock.ok) {
    const started = lock.lock?.startedAt || "unknown";
    const mode = lock.lock?.mode || "unknown";
    const state = lock.lock?.state || lock.reason || "unknown";
    const detail = lock.lock?.error ? ` detail=${lock.lock.error}` : "";
    log(`⏭️ Digest skipped: lock unavailable (state=${state}, mode=${mode}, started=${started})${detail}`);
    process.exit(4);
  }

  // ── Check who's due BEFORE any API calls ──────────────────────────────────
  const etNow = getEtNow();
  const todayET = etNow.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const nowMinutes = etNow.getHours() * 60 + etNow.getMinutes();
  const allActive = allUsers().filter(u => u.status === "active");

  let dueUsers;
  if (targetChatId) {
    // On-demand: bypass scheduling — deliver to this user regardless of time
    dueUsers = allActive.filter(u => u.chatId === targetChatId);
  } else {
    const todayDOW = etNow.getDay(); // 0=Sun … 6=Sat
    const catchupWindowMinutes = Math.max(
      30,
      Number(CONFIG?.digest?.catchupWindowMinutes || (12 * 60))
    );
    dueUsers = allActive.filter(u => {
      const prefs = u.preferences || {};
      // Check day of week
      const allowedDays = prefs.days_of_week || [1, 2, 3, 4, 5];
      if (!allowedDays.includes(todayDOW)) return false;
      // Skip if already delivered today (prevents double-delivery from 30-min cron)
      if (toEtDateString(u.last_digest_at) === todayET) return false;
      // Catch-up window: up to catchupWindowMinutes after target handles missed windows.
      // Strict mode: never send before the configured target time.
      const [dh, dm] = (prefs.delivery_time || "07:00").split(":").map(Number);
      const userMinutes = dh * 60 + dm;
      let diff = nowMinutes - userMinutes; // positive = we're past target time
      // Midnight wraparound: e.g. target 23:45, now 00:05 → diff should be +20 not -1420
      if (diff < -(12 * 60)) diff += 24 * 60;
      if (diff > (12 * 60)) diff -= 24 * 60;
      return diff >= 0 && diff <= catchupWindowMinutes;
    });
  }

  // Log scheduling decisions on every cron fire — visible even on no-op runs.
  // Helps diagnose missed deliveries without needing --diagnose flags.
  if (!targetChatId && allActive.length > 0) {
    const parts = allActive.map(u => {
      const prefs = u.preferences || {};
      const alreadyToday = toEtDateString(u.last_digest_at) === todayET;
      if (alreadyToday) return `${u.email || u.chatId}: alreadyToday`;
      const [dh, dm] = (prefs.delivery_time || "07:00").split(":").map(Number);
      let diff = nowMinutes - (dh * 60 + dm);
      if (diff < -(12 * 60)) diff += 24 * 60;
      if (diff > (12 * 60)) diff -= 24 * 60;
      const isDue = dueUsers.some(d => d.chatId === u.chatId);
      return `${u.email || u.chatId}: target=${prefs.delivery_time} diff=${diff >= 0 ? "+" : ""}${diff}min → ${isDue ? "DUE" : "skip"}`;
    });
    log(`[schedule] ${todayET} ${etNow.getHours().toString().padStart(2,"0")}:${etNow.getMinutes().toString().padStart(2,"0")} ET — ${parts.join(" | ")}`);
  }

  if (dueUsers.length === 0) {
    if (targetChatId) {
      log(`No active user found for on-demand chatId ${targetChatId}`);
      process.exit(2);
    }
    process.exit(0); // no users due this window
  }

  if (dryRun) {
    const dueList = dueUsers.map((u) => u.email || u.chatId).filter(Boolean);
    log(`🧪 Dry run: ${dueUsers.length} user(s) due${dueList.length ? ` -> ${dueList.join(", ")}` : ""}`);
    process.exit(0);
  }

  if (targetChatId) log(`=== SignalBrief on-demand for ${targetChatId} ===`);
  else log(`=== SignalBrief starting — ${dueUsers.length} user(s) due ===`);

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    timeZone: CONFIG.user.timezone,
  });
  const shortDate = now.toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: CONFIG.user.timezone,
  });
  const digestDateKey = toEtDateKey(now);
  const publicDigestUrl = buildPublicDigestUrl(digestDateKey);
  const requestedCounts = dueUsers
    .map((u) => Number(u?.preferences?.items_per_digest))
    .filter((n) => Number.isFinite(n) && n > 0);
  const selectionTarget = Math.max(
    Number(CONFIG.digest.itemCount || 7),
    requestedCounts.length ? Math.max(...requestedCounts) : 0
  );
  const tagPriority = {};
  for (const u of dueUsers) {
    for (const topic of (u.topics || [])) {
      const key = normalizeTopicToken(topic);
      if (!key) continue;
      tagPriority[key] = (tagPriority[key] || 0) + 1;
    }
  }

  // For on-demand single-user runs, only fetch topics the user actually tracks.
  // For scheduled multi-user runs, fetch all 17 standard topics.
  let topicsToFetch = CONFIG.topics;
  if (targetChatId && dueUsers.length === 1) {
    const userStandardTopics = new Set(
      (dueUsers[0].topics || []).filter(t => !t.startsWith("custom_"))
    );
    if (userStandardTopics.size > 0) {
      topicsToFetch = CONFIG.topics.filter(t => userStandardTopics.has(t.tag));
      log(`On-demand: fetching ${topicsToFetch.length}/${CONFIG.topics.length} topic(s) for user`);
    }
  }
  const standardFetchCallsPlanned = topicsToFetch.length;
  let standardFetchCalls = 0;
  let customFetchCalls = 0;

  // Fetch standard topics in parallel
  const allResults = await Promise.all(topicsToFetch.map(fetchTopicNews));
  standardFetchCalls = allResults.reduce((sum, rows) => sum + Number(rows?.__apiCalls || 0), 0);
  const standardItems = allResults.flat();
  let allItems = standardItems.slice();
  log(`Fetched ${allItems.length} raw items`);
  const allStandardEmpty = standardFetchCallsPlanned > 0
    && allResults.every((rows) => Array.isArray(rows) && rows.length === 0);
  if (allStandardEmpty) {
    await emitDigestIncident(
      "zero-standard-results",
      `All ${standardFetchCallsPlanned} standard topic fetches returned zero items`,
      {
        mode: runMode,
        due_users: dueUsers.length,
        standard_topics: standardFetchCallsPlanned,
        selected_items: 0,
      }
    );
  }

  // Fetch custom topics for due users.
  // Scale cap with user count so custom coverage doesn't collapse as users grow.
  // Rank by demand frequency (how many due users follow each custom topic).
  const customTopicCounts = new Map();
  for (const u of dueUsers) {
    for (const topic of (u.topics || [])) {
      const topicRaw = String(topic || "");
      if (!topicRaw.startsWith("custom_")) continue;
      customTopicCounts.set(topicRaw, (customTopicCounts.get(topicRaw) || 0) + 1);
    }
  }
  const configuredMaxCustomFetch = Number(CONFIG.digest.maxCustomFetchPerRun);
  const dynamicCustomFetchCap = Number.isFinite(configuredMaxCustomFetch) && configuredMaxCustomFetch > 0
    ? configuredMaxCustomFetch
    : Math.min(18, Math.max(6, Math.ceil(dueUsers.length / 4)));
  const rankedCustomTopicSlugs = [...customTopicCounts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(([slug]) => slug);
  const customTopicSlugs = rankedCustomTopicSlugs.slice(0, dynamicCustomFetchCap);
  if (rankedCustomTopicSlugs.length > customTopicSlugs.length) {
    log(`Custom topic fetch cap hit: ${customTopicSlugs.length}/${rankedCustomTopicSlugs.length} topics this run`);
  }
  let customTags = [];

  if (customTopicSlugs.length > 0) {
    const customFetchTargets = customTopicSlugs.map(slug => {
      const keyword = slug.replace(/^custom_/, "").replace(/_/g, " ").trim();
      const queries = buildCustomTopicQueries(keyword);
      return {
        tag: keyword.toUpperCase(),   // e.g. "PFIZER", "GLP-1"
        queries: queries.length ? queries : [`${keyword} business strategy developments last 48 hours`],
        isCustom: true,
      };
    });
    customTags = customFetchTargets.map((t) => t.tag);
    customFetchCalls = 0;
    log(`Fetching ${customFetchTargets.length} custom topic(s): ${customFetchTargets.map(t => t.tag).join(", ")}`);
    const customResults = await Promise.all(customFetchTargets.map(fetchTopicNews));
    customFetchCalls = customResults.reduce((sum, rows) => sum + Number(rows?.__apiCalls || 0), 0);
    const customItems = customResults.flat();
    log(`Fetched ${customItems.length} custom topic item(s)`);
    // Prepend so selectItems() sees custom items first — they have unique tags so they
    // won't crowd out standard items; prepending ensures they're selected
    allItems.unshift(...customItems);

    const customKeywords = customTopicSlugs.map((slug) =>
      normalizeTopicToken(String(slug || "").replace(/^custom_/, "").replace(/_/g, " "))
    ).filter(Boolean);
    const rescueItems = buildCustomRescueItemsFromStandard(standardItems, customKeywords, allItems, 1);
    if (rescueItems.length > 0) {
      allItems.unshift(...rescueItems);
      log(`Custom keyword rescue added ${rescueItems.length} item(s) from standard pool`);
    }
  }
  if (allItems.length === 0) {
    await emitDigestIncident(
      "zero-raw-items",
      "No raw items available after standard and custom fetches",
      {
        mode: runMode,
        due_users: dueUsers.length,
        standard_topics: standardFetchCallsPlanned,
        selected_items: 0,
      }
    );
  }

  const crossDayDedupDays = Math.max(1, Number(CONFIG.digest.crossDayDedupDays || 3));
  const dedupRes = dedupAgainstRecentArchives(allItems, {
    days: crossDayDedupDays,
    targetCount: selectionTarget,
    minBackfillItems: Math.max(1, Number(CONFIG.digest.minBackfillItemsAfterDedup || 3)),
  });
  allItems = dedupRes.items;
  const repeatIndex = buildRecentRepeatIndex(crossDayDedupDays);
  const repeatPenalty = Math.max(0, Number(CONFIG.digest.crossDayRepeatPenalty || 0.8));
  if (dedupRes.removed > 0) {
    log(`Cross-day dedup removed ${dedupRes.removed} repeat item(s) using last ${dedupRes.archive_days_used} day(s) of archive history${dedupRes.backfilled > 0 ? ` (backfilled ${dedupRes.backfilled} to minimum)` : ""}`);
  }
  if ((repeatIndex.urlKeys.size > 0 || repeatIndex.headlineKeys.size > 0) && repeatPenalty > 0) {
    log(`Freshness penalty active (days=${repeatIndex.days}, penalty=${repeatPenalty.toFixed(2)})`);
  }

  const configuredMaxCustom = Number(CONFIG.digest.maxCustomItemsPerRun);
  const defaultMaxCustom = customTags.length > 0
    ? Math.max(1, Math.floor(selectionTarget * 0.4))
    : 0;
  const maxCustomItems = Number.isFinite(configuredMaxCustom) && configuredMaxCustom >= 0
    ? configuredMaxCustom
    : defaultMaxCustom;
  let selected = selectItems(allItems, {
    maxItems: selectionTarget,
    maxItemsPerTag: CONFIG.digest.maxItemsPerTag,
    customTags,
    maxCustomItems,
    tagPriority,
    maxItemsPerSourceDomain: CONFIG.digest.maxItemsPerSourceDomain,
  });
  if (selected.length === 0) {
    const fallbackPool = loadRecentArchiveItems(5);
    if (fallbackPool.length > 0) {
      selected = selectItems(fallbackPool, {
        maxItems: selectionTarget,
        maxItemsPerTag: CONFIG.digest.maxItemsPerTag,
        customTags: [],
        maxCustomItems: 0,
        tagPriority,
        maxItemsPerSourceDomain: CONFIG.digest.maxItemsPerSourceDomain,
      });
      log(`⚠️ Live fetch produced no selectable items; using archive fallback pool (${fallbackPool.length} items, selected=${selected.length})`);
      await emitDigestIncident(
        "archive-fallback-engaged",
        `Live fetch produced zero selectable items; archive fallback selected ${selected.length}`,
        {
          mode: runMode,
          due_users: dueUsers.length,
          standard_topics: standardFetchCallsPlanned,
          selected_items: selected.length,
        }
      );
    }
  }
  if (selected.length === 0) {
    await emitDigestIncident(
      "no-selectable-items",
      "No selectable items after archive fallback; digest run aborted",
      {
        mode: runMode,
        due_users: dueUsers.length,
        standard_topics: standardFetchCallsPlanned,
        selected_items: 0,
      }
    );
    throw new Error("No items available from live fetch or archive fallback; digest aborted");
  }
  log(`Selected ${selected.length} items (target=${selectionTarget}, customCap=${maxCustomItems}, sourceCap=${Number(CONFIG.digest.maxItemsPerSourceDomain || 2)})`);

  const enrichment = await enrichItems(selected);
  const enriched = enrichment.items;
  const claudeUsage = {
    input_tokens: Number(enrichment?.usage?.input_tokens || 0),
    output_tokens: Number(enrichment?.usage?.output_tokens || 0),
  };

  // Quick scan (shared archive/public page)
  const quickScan = enriched
    .map((i) => i.headline.split(":")[0].split("—")[0].trim())
    .join(" &nbsp;·&nbsp; ");

  // Archive once per run (shared, date-keyed) — uses full enriched set before user filtering
  // Must happen before per-user loop so the archive reflects all fetched items, not one user's filtered view
  saveToArchive(now, enriched, dateStr, quickScan, { overwrite: !targetChatId });

  log(`Delivering to ${dueUsers.length} user(s)...`);
  const deliveredUsers = [];
  const failedUsers = [];
  const engagementEvents = loadEngagementEvents({ max_age_days: 45, dedupe: true });

  for (let u of dueUsers) {
    try {
      const autoLearning = applyAutoTopicLearning(u, {
        events: engagementEvents,
        now,
        date_key: digestDateKey,
        run_id: runId,
      });
      const autoLearningEventFailures = Math.max(0, Number(autoLearning.event_write_failures || 0));
      if (autoLearningEventFailures > 0) {
        log(`⚠️ [auto-learning] ${u.email || u.chatId}: engagement event write failures=${autoLearningEventFailures}`);
      }
      if (autoLearning.changed) {
        writeUser(u.chatId, u);
        const changes = autoLearning.adjustments
          .map((a) => `${a.topic}:${a.prev}->${a.next}`)
          .join(", ");
        log(`  [auto-learning] ${u.email || u.chatId}: ${changes} (events=${autoLearning.processed_events})`);
      }
      const learningSummary = autoLearning.changed
        ? buildLearningSummary(autoLearning.adjustments, 2)
        : "";

      const prefs = u.preferences || {};

      // 1. Filter items by user's topic list (if set)
      let wasFiltered = false;
      let userItems = enriched;
      let standardTopicsLower = [];
      let customKeywords = [];
      let specialistMode = false;
      const filteredResult = filterDigestItemsByTopics(enriched, u.topics || [], {
        minItems: 3,
        strictZeroFallback: "specialist",
      });
      standardTopicsLower = filteredResult.standardTopicsLower || [];
      customKeywords = filteredResult.customKeywords || [];
      specialistMode = !!filteredResult.specialistMode;
      userItems = filteredResult.items;
      wasFiltered = filteredResult.wasFiltered;

      // 2. Score by relevance (free — uses baseScore + local topic match + user weight adjustments)
      const weights = u.topic_weights || {};
      const hasWeights = Object.values(weights).some(w => w !== 0);

      // Log pre-sort order when user has weight adjustments — lets us verify ranking is working
      if (hasWeights) {
        log(`  [weights] ${u.email || u.chatId}: ${JSON.stringify(weights)}`);
        log(`  [pre-sort] ${userItems.map(i => `${i.tag}(${i.baseScore})`).join(", ")}`);
      }

      userItems = scoreDigestItemsForUser(userItems, u.topics || [], weights, {
        specialistMode,
        repeatPenalty,
        isRecentRepeat: (item) => isRecentRepeatItem(item, repeatIndex),
        sourceDomainForItem: parseSourceDomain,
      });
      userItems.sort((a, b) => b.relevanceScore - a.relevanceScore);

      const minBaseScoreForFinal = Number(CONFIG.digest.minBaseScoreForFinal || 6.5);
      const requestedCount = Number(prefs.items_per_digest || CONFIG.digest.itemCount || 5);
      const perUserFreshnessMin = Math.max(1, Math.min(requestedCount, Number(CONFIG.digest.perUserFreshnessMinItems || 3)));
      const suppression = suppressRecentlySentForUser(userItems, u, {
        maxDigests: Math.max(1, Number(CONFIG.digest.perUserFreshnessDigests || 3)),
        minItems: perUserFreshnessMin,
      });
      if (suppression.removed > 0) {
        userItems = suppression.items;
        log(`  [freshness-user] ${u.email || u.chatId}: removed ${suppression.removed} recent URL repeat(s)${suppression.backfilled > 0 ? `, backfilled ${suppression.backfilled}` : ""}`);
      }

      const minStrongItems = Math.max(2, Math.min(requestedCount, 4));
      const stronger = userItems.filter((i) =>
        Number(i?.baseScore || 0) >= minBaseScoreForFinal
        || (Array.isArray(i?.why_shown) && i.why_shown.includes("custom_keyword"))
      );
      if (stronger.length >= minStrongItems) {
        userItems = stronger;
      }

      if (hasWeights) {
        log(`  [post-sort] ${userItems.map(i => `${i.tag}(${i.relevanceScore})`).join(", ")}`);
      }

      // 3. Trim to user's items_per_digest (top-N by relevance)
      const count = requestedCount;
      userItems = reserveCustomKeywordSlot(userItems, count, customKeywords);

      // Hard guardrail: never send an empty digest.
      if (userItems.length === 0) {
        const emergencyCount = Math.max(1, Math.min(3, count));
        const emergency = scoreDigestItemsForUser(enriched, u.topics || [], weights, {
          specialistMode: false,
          repeatPenalty,
          isRecentRepeat: (item) => isRecentRepeatItem(item, repeatIndex),
          sourceDomainForItem: parseSourceDomain,
        })
          .sort((a, b) => b.relevanceScore - a.relevanceScore)
          .slice(0, emergencyCount);
        if (emergency.length > 0) {
          userItems = emergency;
          wasFiltered = false;
          log(`⚠️ Emergency fallback items used for ${u.email || u.chatId} (count=${emergency.length})`);
        }
      }
      if (userItems.length === 0) {
        throw new Error("No deliverable items after emergency fallback");
      }

      // 4. Apply depth — strip wim if user wants headlines only or one-liner
      const depth = prefs.depth || "full";
      userItems = applyDigestDepth(userItems, depth);

      const previousDigestItems = Array.isArray(u.last_digest_items) ? u.last_digest_items : [];
      const digestQuality = computeDigestQualityScore({
        items: userItems,
        user: u,
        previous_items: previousDigestItems,
      });
      const userDigestId = buildDigestId(digestDateKey, u.chatId);
      const eventItems = userItems.map((item, idx) => ({
        index: idx + 1,
        headline: item?.headline || null,
        url: item?.url || null,
        tag: item?.tag || null,
        base_score: Number.isFinite(Number(item?.baseScore)) ? Number(item.baseScore) : null,
        topic_match: Number.isFinite(Number(item?.topicMatch)) ? Number(item.topicMatch) : null,
        relevance_score: Number.isFinite(Number(item?.relevanceScore)) ? Number(item.relevanceScore) : null,
      }));

      // 5. Build per-user quick scan + subject
      const userQuickScan = userItems.map((i, idx) => {
        const short = stripInlineHtml(i.headline).split(":")[0].split("—")[0].trim();
        const topic = topicVisual(i.tag);
        const safeTag = escapeHtml(String(i.tag || "News"));
        const safeShort = escapeHtml(short);
        return `<tr>
          <td style="font-size:14px;color:#111827;font-weight:700;padding:6px 10px 6px 0;vertical-align:top;line-height:1.5;white-space:nowrap;">${idx + 1}</td>
          <td style="padding:6px 0;vertical-align:top;line-height:1.5;">
            <div style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${topic.chipText};margin-bottom:2px;">${topic.icon} ${safeTag}</div>
            <div style="font-size:14px;color:#374151;line-height:1.5;">${safeShort}</div>
          </td>
        </tr>`;
      }).join("\n");
      // Admin-triggered sends can force regular framing (no first-briefing subject/banner).
      const isFirstDigest = !u.welcome_email_sent && !suppressWelcome;

      // 5. Deliver
      let delivered = false;
      let engagementWriteFailures = 0;
      if (u.chatId && !u.chatId.startsWith("email-") && prefs.telegram_enabled !== false) {
        const userTelegram = formatTelegram(userItems, shortDate, u, {
          digestQuality,
          learningSummary,
          publicDigestUrl,
        });
        const userKeyboard = buildDigestInlineKeyboard(userItems);
        try {
          await sendTelegram(userTelegram, u.chatId, { reply_markup: userKeyboard });
          const eventOutcome = appendEngagementEventChecked({
            event_type: "digest_sent",
            event_key: `digest_sent:${userDigestId}:telegram`,
            date_et: digestDateKey,
            user_chat_id: String(u.chatId),
            user_email: u.email || null,
            digest_id: userDigestId,
            run_id: runId,
            channel: "telegram",
            source: targetChatId ? "on-demand" : "scheduled-job",
            metadata: {
              item_count: userItems.length,
              depth,
              quality_score: digestQuality.score,
              quality_band: digestQuality.band,
              quality_components: digestQuality.components,
              items: eventItems,
            },
          }, `digest_sent:telegram:${u.email || u.chatId}`);
          if (!eventOutcome.ok) engagementWriteFailures += 1;
          delivered = true;
        } catch (err) {
          log(`⚠️ Telegram delivery failed for ${u.email || u.chatId}: ${err.message}`);
        }
      }
      if (u.email && prefs.email_enabled !== false) {
        const subjectResult = await generateLeadSubjectLine(userItems[0] || null, now);
        claudeUsage.input_tokens += Number(subjectResult?.usage?.input_tokens || 0);
        claudeUsage.output_tokens += Number(subjectResult?.usage?.output_tokens || 0);

        const noteResult = await generateEditorialNote(userItems);
        claudeUsage.input_tokens += Number(noteResult?.usage?.input_tokens || 0);
        claudeUsage.output_tokens += Number(noteResult?.usage?.output_tokens || 0);

        let userEmailHtml = buildEmail(
          userItems,
          dateStr,
          userQuickScan,
          u.token || "",
          isFirstDigest,
          wasFiltered,
          depth,
          u,
          digestDateKey,
          userDigestId,
          {
            digestQuality,
            learningSummary,
            publicDigestUrl,
            editorialNote: noteResult.note || "",
          }
        );
        if (u.token) {
          const trackingPixel = buildOpenTrackingPixel(userDigestId, u.token, BASE_URL);
          userEmailHtml = /<\/body>/i.test(userEmailHtml)
            ? userEmailHtml.replace(/<\/body>/i, `${trackingPixel}\n</body>`)
            : `${userEmailHtml}\n${trackingPixel}`;
        }
        try {
          await sendEmail(u.email, subjectResult.subject, userEmailHtml, u.token || null);
          const eventOutcome = appendEngagementEventChecked({
            event_type: "digest_sent",
            event_key: `digest_sent:${userDigestId}:email`,
            date_et: digestDateKey,
            user_chat_id: String(u.chatId),
            user_email: u.email || null,
            digest_id: userDigestId,
            run_id: runId,
            channel: "email",
            source: targetChatId ? "on-demand" : "scheduled-job",
            metadata: {
              item_count: userItems.length,
              depth,
              quality_score: digestQuality.score,
              quality_band: digestQuality.band,
              quality_components: digestQuality.components,
              items: eventItems,
            },
          }, `digest_sent:email:${u.email || u.chatId}`);
          if (!eventOutcome.ok) engagementWriteFailures += 1;
          delivered = true;
          if (isFirstDigest || suppressWelcome) u.welcome_email_sent = true; // avoid future welcome framing after manual/admin send
        } catch (err) {
          log(`⚠️ Email delivery failed for ${u.email || u.chatId}: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 600)); // Resend: 2 req/sec limit
      }
      if (!delivered) throw new Error("no channels succeeded");

      // 6. Persist state
      const currentUrlKeys = [...new Set(
        userItems
          .map((item) => normalizeUrlForDedup(item?.url))
          .filter(Boolean)
      )];
      const priorUrlHistory = Array.isArray(u.recent_digest_url_history)
        ? u.recent_digest_url_history.slice()
        : [];
      priorUrlHistory.push({
        date_et: digestDateKey,
        digest_id: userDigestId,
        urls: currentUrlKeys,
      });
      u.recent_digest_url_history = priorUrlHistory.slice(-Math.max(1, Number(CONFIG.digest.perUserFreshnessDigests || 3)));
      u.digests_received = (u.digests_received || 0) + 1;
      u.last_digest_at = now.toISOString();
      u.last_digest_items = userItems.map(i => ({
        headline: i.headline,
        url: i.url,
        tag: i.tag,
        source: i.source,
        source_domain: i.source_domain || parseSourceDomain(i),
        why_shown: Array.isArray(i.why_shown) ? i.why_shown : [],
      }));
      // Track which dates this user received a digest (for user-scoped archive)
      const todayDateKey = toEtDateKey(now);
      if (!u.digest_dates) u.digest_dates = [];
      if (!u.digest_dates.includes(todayDateKey)) u.digest_dates.push(todayDateKey);
      const history = Array.isArray(u.quality_history) ? u.quality_history.slice() : [];
      history.push({
        digest_id: userDigestId,
        date_et: digestDateKey,
        ts_utc: now.toISOString(),
        score: digestQuality.score,
        band: digestQuality.band,
        components: digestQuality.components,
      });
      if (history.length > 120) history.splice(0, history.length - 120);
      u.quality_history = history;
      u.last_quality_score = history[history.length - 1] || null;
      writeUser(u.chatId, u);
      deliveredUsers.push({
        id: u.email || u.chatId,
        on_demand: !!targetChatId,
        engagement_event_failures: engagementWriteFailures,
      });

      const eventWriteSuffix = engagementWriteFailures > 0
        ? `, event_writes_failed=${engagementWriteFailures}`
        : "";
      log(`✅ Delivered to ${u.email || u.chatId} (${userItems.length} items, depth=${depth}, dqs=${digestQuality.score.toFixed(1)}${eventWriteSuffix})`);
    } catch (err) {
      failedUsers.push({ id: u.email || u.chatId, error: err.message, on_demand: !!targetChatId });
      log(`❌ Failed delivery to ${u.email || u.chatId}: ${err.message}`);
    }
  }

  // ── Cost tracking ─────────────────────────────────────────────────────────
  const perplexityCalls = standardFetchCalls + customFetchCalls;
  const perplexityCost  = perplexityCalls * PERPLEXITY_COST_PER_CALL;
  const claudeCost = (claudeUsage.input_tokens  / 1_000_000 * CLAUDE_HAIKU_IN_PER_MTOK)
                   + (claudeUsage.output_tokens / 1_000_000 * CLAUDE_HAIKU_OUT_PER_MTOK);
  const totalCost = perplexityCost + claudeCost;

  appendCostLog({
    date:                  now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }), // ET date (not UTC)
    run_at:                now.toISOString(),
    run_at_et:             now.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }),
    on_demand:             !!targetChatId,
    perplexity_calls:      perplexityCalls,
    perplexity_calls_standard: standardFetchCalls,
    perplexity_calls_custom: customFetchCalls,
    perplexity_cost_usd:   parseFloat(perplexityCost.toFixed(5)),
    claude_tokens_in:      claudeUsage.input_tokens,
    claude_tokens_out:     claudeUsage.output_tokens,
    claude_cost_usd:       parseFloat(claudeCost.toFixed(6)),
    total_cost_usd:        parseFloat(totalCost.toFixed(5)),
    users_targeted:        dueUsers.length,
    users_served:          deliveredUsers.length,
    per_user:              deliveredUsers,
    per_user_failed:       failedUsers,
  });
  log(`💰 Run cost: $${totalCost.toFixed(4)} (Perplexity $${perplexityCost.toFixed(3)} · Claude in=${claudeUsage.input_tokens} out=${claudeUsage.output_tokens} $${claudeCost.toFixed(4)})`);

  log(`=== SignalBrief complete — ${deliveredUsers.length}/${dueUsers.length} user(s) delivered ===`);
  if (targetChatId && deliveredUsers.length === 0) process.exit(3);
}

process.on("exit", () => {
  releaseDigestLock();
});
["SIGINT", "SIGTERM"].forEach((sig) => {
  process.on(sig, () => {
    releaseDigestLock();
    process.exit(1);
  });
});

main().catch((e) => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
