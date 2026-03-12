#!/usr/bin/env node
/**
 * SignalBrief — digest.js
 * Fetches news via Perplexity Sonar, summarizes via Claude,
 * delivers via Telegram + Gmail.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { loadConfig } = require("../platform/config");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const { createStore, USER_STATUS } = require("../platform/store");
const { sendEmail: sendEmailViaMailer, buildOpenTrackingPixel } = require("../platform/mailer");
const {
  appendEngagementEventChecked,
  buildDigestId,
  loadEngagementEvents,
} = require("../domains/engagement");
const {
  LOCK_STATES,
  readDigestLockState,
  clearDigestLockFile,
  getDigestLockOwnerStatus,
} = require("../platform/scheduler");
const { computeDigestQualityScore } = require("../domains/digest");
const { applyAutoTopicLearning } = require("../domains/personalization");
const {
  selectDigestItems,
  createDigestPolicies,
} = require("../domains/digest");
const {
  normalizeUrlForDedup,
  headlineFingerprint,
  createRepeatIndex,
  isRepeatedItem,
  dedupItemsAgainstRepeatIndex,
} = require("../domains/digest");
const {
  buildCustomTopicQueries,
  customKeywordMatches,
  filterItemsByTopics,
  applyTopicRelevanceScores,
  applyDigestDepth,
  reserveCustomKeywordSlot,
  normalizeMatchText,
  normalizeTopicToken,
  topicsRelated,
} = require("../domains/digest");
const { parseSourceDomain: parseSourceDomainShared } = require("../domains/digest");
const { createDigestFormattingRuntime } = require("../domains/digest");
const { createDigestDataRuntime } = require("../domains/digest");
const { createDigestArchiveRuntime } = require("../domains/digest");
const { resolveDueUsers } = require("./digest-orchestrator-schedule-runtime");
const { createDigestOrchestratorDeliveryRuntime } = require("./digest-orchestrator-delivery-runtime");
const { createDigestOrchestratorFetchRuntime } = require("./digest-orchestrator-fetch-runtime");
const { createDigestOrchestratorSelectionRuntime } = require("./digest-orchestrator-selection-runtime");
const { createDigestOrchestratorEnrichmentRuntime } = require("./digest-orchestrator-enrichment-runtime");

const digestStore = createStore();
const { initStore, readUser, writeUser, allUsers } = digestStore;

const LOG_FILE = "/tmp/signalbrief.log";
const COST_LOG = path.join(APP_ROOT, "data", "cost-log.json");
const DIGEST_RUN_LOCK = path.join(APP_ROOT, "data", "digest-run.lock");
const DIGEST_INCIDENT_LOG = path.join(APP_ROOT, "data", "digest-incident-log.jsonl");
const DIGEST_LOCK_STALE_MS = Math.max(5 * 60 * 1000, Number(process.env.DIGEST_LOCK_STALE_MS || (2 * 60 * 60 * 1000)));
let configCache = null;
let emailTemplateCache = null;
let digestFormattingRuntimeCache = null;
let digestDataRuntimeCache = null;
let digestArchiveRuntimeCache = null;
let runtimeBootstrapDone = false;

function getConfig() {
  if (!configCache) configCache = loadConfig();
  return configCache;
}

const CONFIG = new Proxy({}, {
  get(_target, prop) {
    return getConfig()[prop];
  },
  has(_target, prop) {
    return prop in getConfig();
  },
  ownKeys() {
    return Reflect.ownKeys(getConfig());
  },
  getOwnPropertyDescriptor(_target, prop) {
    const desc = Object.getOwnPropertyDescriptor(getConfig(), prop);
    if (!desc) return undefined;
    return { ...desc, configurable: true };
  },
});

function getEmailTemplate() {
  if (!emailTemplateCache) {
    emailTemplateCache = fs.readFileSync(path.join(APP_ROOT, "templates/email.html"), "utf8");
  }
  return emailTemplateCache;
}

function getBaseUrl() {
  return process.env.BASE_URL || "https://getsignalbrief.com";
}

function ensureDigestRuntimeBootstrap() {
  if (runtimeBootstrapDone) return;
  initStore();
  process.on("exit", () => {
    releaseDigestLock();
  });
  ["SIGINT", "SIGTERM"].forEach((sig) => {
    process.on(sig, () => {
      releaseDigestLock();
      process.exit(1);
    });
  });
  runtimeBootstrapDone = true;
}

function buildPublicDigestUrl(dateKey) {
  const key = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  return `${getBaseUrl()}/digest/${key}`;
}

// ET time helpers
function getEtNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}
function toEtDateString(iso) {
  return iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null;
}
function formatEtDateKey(date) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// API cost estimates
const PERPLEXITY_COST_PER_CALL  = 0.005;   // Sonar model per call
const CLAUDE_HAIKU_IN_PER_MTOK  = 0.80;    // $/million input tokens
const CLAUDE_HAIKU_OUT_PER_MTOK = 4.00;    // $/million output tokens

// Model cost lookup maps (used by sandbox for dynamic model selection)
const MODEL_COSTS = {
  "claude-haiku-4-5":  { input: 0.80,  output: 4.00  },
  "claude-sonnet-4-6": { input: 3.00,  output: 15.00 },
  "claude-opus-4-6":   { input: 15.00, output: 75.00 },
};
const SEARCH_COSTS = {
  "sonar": 0.005,
  "sonar-pro": 0.01,
  "sonar-reasoning": 0.01,
};

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
    date_et: formatEtDateKey(now),
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

let digestLockOwned = false;
function readDigestLock() {
  return readDigestLockState(DIGEST_RUN_LOCK, DIGEST_LOCK_STALE_MS);
}

function clearDigestLock() {
  const outcome = clearDigestLockFile(DIGEST_RUN_LOCK);
  if (!outcome.ok) {
    const detail = outcome.message ? ` (${outcome.message})` : "";
    log(`⚠️ Failed to clear digest lock [${outcome.code || "unknown"}]${detail}`);
  }
  return outcome;
}

function acquireDigestLock(mode) {
  const existing = readDigestLock();
  if (existing) {
    if (existing.state === LOCK_STATES.STALE) {
      const clearOutcome = clearDigestLock();
      if (!clearOutcome.ok) {
        return {
          ok: false,
          reason: "stale_uncleared",
          lock: {
            ...existing,
            state: "stale_uncleared",
            error: `stale_lock_clear_failed:${clearOutcome.code || "unknown"}`,
            clear_error: clearOutcome.message || null,
            clear_error_code: clearOutcome.error_code || null,
          },
        };
      }
    } else if (existing.state === LOCK_STATES.VALID) {
      const owner = getDigestLockOwnerStatus(existing);
      if (owner.alive === false) {
        const clearOutcome = clearDigestLock();
        if (!clearOutcome.ok) {
          return {
            ok: false,
            reason: "pid_dead_uncleared",
            lock: {
              ...existing,
              state: "pid_dead_uncleared",
              error: `dead_pid_lock_clear_failed:${clearOutcome.code || "unknown"}`,
              clear_error: clearOutcome.message || null,
              clear_error_code: clearOutcome.error_code || null,
              owner_pid: owner.pid,
              owner_alive: false,
            },
          };
        }
      } else {
        return { ok: false, reason: "locked", lock: existing };
      }
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

function httpsPostRuntime(hostname, path_, headers, body, isForm = false) {
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

function httpsPost(hostname, path_, headers, body) {
  return httpsPostRuntime(hostname, path_, headers, body, false);
}

async function httpsPostWithRetry(hostname, path_, headers, body, opts = {}) {
  const retries = Math.max(0, Number(opts.retries ?? 2));
  const retryDelayMs = Math.max(100, Number(opts.retryDelayMs ?? 1200));
  const isForm = !!opts.isForm;

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await httpsPostRuntime(hostname, path_, headers, body, isForm);
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

function getDigestFormattingRuntime() {
  if (!digestFormattingRuntimeCache) {
    digestFormattingRuntimeCache = createDigestFormattingRuntime({
      CONFIG: getConfig(),
      EMAIL_TEMPLATE: getEmailTemplate(),
      BASE_URL: getBaseUrl(),
      httpsPostWithRetry,
      buildPublicDigestUrl,
      normalizeTopicToken,
      customKeywordMatches,
      normalizeMatchText,
      headlineFingerprint,
      normalizeUrlForDedup,
    });
  }
  return digestFormattingRuntimeCache;
}

function getDigestDataRuntime() {
  if (!digestDataRuntimeCache) {
    digestDataRuntimeCache = createDigestDataRuntime({
      CONFIG: getConfig(),
      log,
      httpsPostWithRetry,
      normalizeUrlForDedup,
    });
  }
  return digestDataRuntimeCache;
}

function getDigestArchiveRuntime() {
  if (!digestArchiveRuntimeCache) {
    digestArchiveRuntimeCache = createDigestArchiveRuntime({
      APP_ROOT,
      fs,
      path,
      log,
      formatEtDateKey,
      createRepeatIndex,
      isRepeatedItem,
      dedupItemsAgainstRepeatIndex,
      normalizeUrlForDedup,
      parseSourceDomainShared,
    });
  }
  return digestArchiveRuntimeCache;
}

function scoreColor(...args) {
  return getDigestFormattingRuntime().scoreColor(...args);
}

function stripInlineHtml(...args) {
  return getDigestFormattingRuntime().stripInlineHtml(...args);
}

function generateLeadSubjectLine(...args) {
  return getDigestFormattingRuntime().generateLeadSubjectLine(...args);
}

function generateEditorialNote(...args) {
  return getDigestFormattingRuntime().generateEditorialNote(...args);
}

function topicVisual(...args) {
  return getDigestFormattingRuntime().topicVisual(...args);
}

function buildCustomRescueItemsFromStandard(...args) {
  return getDigestFormattingRuntime().buildCustomRescueItemsFromStandard(...args);
}

function escapeHtml(...args) {
  return getDigestFormattingRuntime().escapeHtml(...args);
}

function buildLearningSummary(...args) {
  return getDigestFormattingRuntime().buildLearningSummary(...args);
}

function formatTelegram(...args) {
  return getDigestFormattingRuntime().formatTelegram(...args);
}

function buildDigestInlineKeyboard(...args) {
  return getDigestFormattingRuntime().buildDigestInlineKeyboard(...args);
}

function buildEmailHeaderMeta(...args) {
  return getDigestFormattingRuntime().buildEmailHeaderMeta(...args);
}

function renderDigestItemHtml(...args) {
  return getDigestFormattingRuntime().renderDigestItemHtml(...args);
}

function applyTemplateSlots(...args) {
  return getDigestFormattingRuntime().applyTemplateSlots(...args);
}

function buildEmail(...args) {
  return getDigestFormattingRuntime().buildEmail(...args);
}

function fetchTopicNews(...args) {
  return getDigestDataRuntime().fetchTopicNews(...args);
}

function enrichItems(...args) {
  return getDigestDataRuntime().enrichItems(...args);
}

function parseSourceDomain(...args) {
  return getDigestArchiveRuntime().parseSourceDomain(...args);
}

function loadRecentArchiveItems(...args) {
  return getDigestArchiveRuntime().loadRecentArchiveItems(...args);
}

function dedupAgainstRecentArchives(...args) {
  return getDigestArchiveRuntime().dedupAgainstRecentArchives(...args);
}

function buildRecentRepeatIndex(...args) {
  return getDigestArchiveRuntime().buildRecentRepeatIndex(...args);
}

function isRecentRepeatItem(...args) {
  return getDigestArchiveRuntime().isRecentRepeatItem(...args);
}

function suppressRecentlySentForUser(...args) {
  return getDigestArchiveRuntime().suppressRecentlySentForUser(...args);
}

function saveToArchive(...args) {
  return getDigestArchiveRuntime().saveToArchive(...args);
}

function selectItems(allItems, opts = {}) {
  return selectDigestItems(allItems, {
    maxItems: opts.maxItems || CONFIG.digest.itemCount || 7,
    maxItemsPerTag: opts.maxItemsPerTag || CONFIG.digest.maxItemsPerTag || 2,
    maxItemsPerSourceDomain: opts.maxItemsPerSourceDomain || CONFIG.digest.maxItemsPerSourceDomain || 2,
    customTags: opts.customTags || [],
    tagPriority: opts.tagPriority,
    maxCustomItems: opts.maxCustomItems,
    normalizeUrl: normalizeUrlForDedup,
    parseDomain: parseSourceDomain,
    normalizeTopicToken,
    isCandidate: (_item, ctx) => Boolean(ctx.headlineKey),
  });
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

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  ensureDigestRuntimeBootstrap();
  // Support --chatId flag for on-demand single-user delivery (/digest command)
  const args = process.argv.slice(2);
  const chatIdIdx = args.indexOf("--chatId");
  const targetChatId = chatIdIdx !== -1 ? args[chatIdIdx + 1] : null;
  const dryRun = args.includes("--dry-run") || process.env.DIGEST_DRY_RUN === "1";
  const suppressWelcome = args.includes("--suppressWelcome");
  const runMode = targetChatId ? "targeted" : "scheduled";
  const runId = `${runMode}:${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const allowExampleEmails = (
    String(process.env.ALLOW_EXAMPLE_SIGNUPS || "").trim() === "1"
    || String(process.env.NODE_ENV || "").toLowerCase() !== "production"
  );

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
  const dueContext = resolveDueUsers({
    targetChatId,
    allUsers,
    USER_STATUS,
    getEtNow,
    toEtDateString,
    CONFIG,
    log,
    allowExampleEmails,
  });
  const {
    dueUsers,
  } = dueContext;

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
  const digestDateKey = formatEtDateKey(now);
  const publicDigestUrl = buildPublicDigestUrl(digestDateKey);
  const fetchRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG,
    log,
    normalizeTopicToken,
    fetchTopicNews,
    buildCustomTopicQueries,
    buildCustomRescueItemsFromStandard,
    emitDigestIncident,
  });
  const {
    selectionTarget,
    tagPriority,
    allItems: fetchedItems,
    customTags,
    standardFetchCallsPlanned,
    standardFetchCalls,
    customFetchCalls,
  } = await fetchRuntime.orchestrateFetch({
    dueUsers,
    targetChatId,
    runMode,
  });
  let allItems = fetchedItems;

  const selectionRuntime = createDigestOrchestratorSelectionRuntime({
    CONFIG,
    log,
    createDigestPolicies,
    dedupAgainstRecentArchives,
    buildRecentRepeatIndex,
    selectItems,
    loadRecentArchiveItems,
    emitDigestIncident,
  });
  const {
    selected,
    repeatIndex,
    repeatPenalty,
    rankingPolicy,
    depthPolicy,
  } = await selectionRuntime.selectForEnrichment({
    allItems,
    selectionTarget,
    customTags,
    tagPriority,
    runMode,
    dueUsersCount: dueUsers.length,
    standardFetchCallsPlanned,
  });

  const enrichmentRuntime = createDigestOrchestratorEnrichmentRuntime({
    enrichItems,
  });
  const {
    enriched,
    claudeUsage,
  } = await enrichmentRuntime.enrichSelectedItems({
    selected,
  });

  // Quick scan (shared archive/public page)
  const quickScan = enriched
    .map((i) => i.headline.split(":")[0].split("—")[0].trim())
    .join(" &nbsp;·&nbsp; ");

  // Archive once per run (shared, date-keyed) — uses full enriched set before user filtering
  // Must happen before per-user loop so the archive reflects all fetched items, not one user's filtered view
  saveToArchive(now, enriched, dateStr, quickScan, { overwrite: !targetChatId });

  log(`Delivering to ${dueUsers.length} user(s)...`);
  const engagementEvents = loadEngagementEvents({ max_age_days: 45, dedupe: true });
  const deliveryRuntime = createDigestOrchestratorDeliveryRuntime({
    CONFIG,
    log,
    applyAutoTopicLearning,
    writeUser,
    buildLearningSummary,
    filterItemsByTopics,
    applyTopicRelevanceScores,
    suppressRecentlySentForUser,
    isRecentRepeatItem,
    parseSourceDomain,
    reserveCustomKeywordSlot,
    applyDigestDepth,
    computeDigestQualityScore,
    buildDigestId,
    appendEngagementEventChecked,
    sendTelegram,
    formatTelegram,
    buildDigestInlineKeyboard,
    generateLeadSubjectLine,
    generateEditorialNote,
    buildEmail,
    buildOpenTrackingPixel,
    getBaseUrl,
    sendEmail,
    normalizeUrlForDedup,
    formatEtDateKey,
    stripInlineHtml,
    topicVisual,
    escapeHtml,
  });
  const {
    deliveredUsers,
    failedUsers,
  } = await deliveryRuntime.deliverDueUsers({
    dueUsers,
    enriched,
    now,
    shortDate,
    dateStr,
    digestDateKey,
    runId,
    repeatIndex,
    repeatPenalty,
    depthPolicy,
    rankingPolicy,
    publicDigestUrl,
    suppressWelcome,
    targetChatId,
    claudeUsage,
    engagementEvents,
  });

  // ── Cost tracking ─────────────────────────────────────────────────────────
  const perplexityCalls = standardFetchCalls + customFetchCalls;
  const perplexityCost  = perplexityCalls * PERPLEXITY_COST_PER_CALL;
  const claudeCost = (claudeUsage.input_tokens  / 1_000_000 * CLAUDE_HAIKU_IN_PER_MTOK)
                   + (claudeUsage.output_tokens / 1_000_000 * CLAUDE_HAIKU_OUT_PER_MTOK);
  const totalCost = perplexityCost + claudeCost;

  appendCostLog({
    date:                  now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }), // ET date (not UTC)
    run_id:                runId,
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
    digest_url:            publicDigestUrl,
    per_user:              deliveredUsers,
    per_user_failed:       failedUsers,
  });
  log(`💰 Run cost: $${totalCost.toFixed(4)} (Perplexity $${perplexityCost.toFixed(3)} · Claude in=${claudeUsage.input_tokens} out=${claudeUsage.output_tokens} $${claudeCost.toFixed(4)})`);

  log(`=== SignalBrief complete — ${deliveredUsers.length}/${dueUsers.length} user(s) delivered ===`);
  if (targetChatId && deliveredUsers.length === 0) process.exit(3);
}

function runCli() {
  return main().catch((e) => {
    log(`FATAL: ${e.message}`);
    process.exit(1);
  });
}

if (require.main === module) {
  runCli();
}

module.exports = {
  // Pipeline stages
  fetchTopicNews,
  enrichItems,
  selectItems,
  dedupAgainstRecentArchives,
  buildRecentRepeatIndex,

  // Formatting
  formatTelegram,
  buildEmail,
  buildEmailHeaderMeta,
  renderDigestItemHtml,
  applyTemplateSlots,
  escapeHtml,
  topicVisual,
  scoreColor,
  stripInlineHtml,
  buildDigestInlineKeyboard,
  generateLeadSubjectLine,
  generateEditorialNote,

  // Helpers
  httpsPost,
  httpsPostWithRetry,
  parseSourceDomain,
  normalizeUrlForDedup,
  headlineFingerprint,

  // Cost constants
  PERPLEXITY_COST_PER_CALL,
  CLAUDE_HAIKU_IN_PER_MTOK,
  CLAUDE_HAIKU_OUT_PER_MTOK,
  MODEL_COSTS,
  SEARCH_COSTS,

  // Config + template (lazy read-only references)
  get CONFIG() {
    return getConfig();
  },
  get EMAIL_TEMPLATE() {
    return getEmailTemplate();
  },
  get BASE_URL() {
    return getBaseUrl();
  },

  // Entrypoint helpers
  main,
  runCli,
};
