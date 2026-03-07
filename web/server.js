#!/usr/bin/env node
/**
 * SignalBrief Web — server.js
 * Serves onboarding + settings UI, proxies store reads/writes.
 * Port 3003
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { initStore, readUser, writeUser, allUsers, generateToken, findUserByToken } = require("../src/runtime/store");
const { sendEmail, sendWelcomeEmail, sendReferralThankYou, signUnsubEmail } = require("../src/runtime/mailer");
const {
  appendEngagementEvent,
  buildDigestId,
  normalizeUrl: normalizeEngagementUrl,
  emitIgnoredEventsIfDue,
  loadEngagementEvents,
} = require("../src/runtime/engagement-events");
const { computeQualityTrend } = require("../src/runtime/quality-score");
const { triggerDigest, digestRunStatus } = require("../digest-runner");
const {
  verifyAdminPassword,
  createAdminSession,
  clearAdminSessionByRequest,
  getAdminActor,
  isAdminAuthed,
  checkLoginRate,
} = require("./admin-auth");
const { handleCoreApiRoutes } = require("./routes/core-api");
const { handleAdminApiRoutes } = require("./routes/admin-api");
const { handlePublicStaticRoutes } = require("./routes/public-static");

const PORT = parseInt(process.env.PORT, 10) || 3003;
const WEB_DIR = __dirname;
const APP_ROOT = path.resolve(__dirname, "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "../config.json"), "utf8"));
const CANONICAL_HOST = "getsignalbrief.com";
const PUBLIC_HOSTS = new Set([CANONICAL_HOST, `www.${CANONICAL_HOST}`]);
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

initStore();

// ── Rate limiting (in-memory, per-IP + per-email) ─────────────────────────────
function createServerState() {
  return {
    rateIp: new Map(),
    rateEmail: new Map(),
  };
}

let SERVER_STATE = createServerState();

function resetServerState() {
  SERVER_STATE = createServerState();
  return SERVER_STATE;
}

const IP_LIMIT   = 5;          // max signups per IP per window
const IP_WINDOW  = 15 * 60 * 1000; // 15 min
const EMAIL_COOLDOWN = 10 * 60 * 1000; // 10 min re-submit cooldown

function getClientIp(req) {
  // Respect Cloudflare's real-IP header
  return (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

function getRequestHost(req) {
  return String(req.headers.host || "").split(":")[0].trim().toLowerCase();
}

function getRequestScheme(req) {
  const cfVisitor = String(req.headers["cf-visitor"] || "").trim();
  if (cfVisitor) {
    try {
      const parsed = JSON.parse(cfVisitor);
      const scheme = String(parsed?.scheme || "").toLowerCase();
      if (scheme === "http" || scheme === "https") return scheme;
    } catch (err) {
      if (process.env.DEBUG_WEB_SERVER === "1") {
        console.warn(`[web] malformed cf-visitor header ignored: ${err.message}`);
      }
    }
  }

  const xForwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (xForwardedProto === "http" || xForwardedProto === "https") return xForwardedProto;

  return req.socket.encrypted ? "https" : "http";
}

function checkRateLimit(ip, email) {
  const now = Date.now();
  const rateIp = SERVER_STATE.rateIp;
  const rateEmail = SERVER_STATE.rateEmail;

  // Prune expired entries (keep map lean)
  for (const [k, v] of rateIp) if (v.resetAt < now) rateIp.delete(k);
  for (const [k, v] of rateEmail) if (v < now) rateEmail.delete(k);

  // Per-IP check
  const ipEntry = rateIp.get(ip) || { count: 0, resetAt: now + IP_WINDOW };
  if (ipEntry.resetAt < now) { ipEntry.count = 0; ipEntry.resetAt = now + IP_WINDOW; }
  if (ipEntry.count >= IP_LIMIT) return { limited: true, reason: "Too many signups from your network. Try again in 15 minutes." };
  ipEntry.count++;
  rateIp.set(ip, ipEntry);

  // Per-email cooldown
  const emailReset = rateEmail.get(email.toLowerCase());
  if (emailReset && emailReset > now) return { limited: true, reason: "This email was just submitted. Wait a few minutes before resubmitting." };
  rateEmail.set(email.toLowerCase(), now + EMAIL_COOLDOWN);

  return { limited: false };
}

const ADMIN_MESSAGE_LOG = path.join(__dirname, "../data/admin-message-log.json");
const ADMIN_ACTION_LOG = path.join(__dirname, "../data/admin-action-log.json");
const COST_LOG_PATH = path.join(__dirname, "../data/cost-log.json");
const ARCHIVE_LEGACY_USAGE_LOG = path.join(__dirname, "../data/archive-legacy-usage.jsonl");
const ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC = process.env.ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC || "2026-06-30T00:00:00Z";
const SCHEDULER_HEARTBEAT_FILE = process.env.SCHEDULER_HEARTBEAT_FILE
  ? path.resolve(process.env.SCHEDULER_HEARTBEAT_FILE)
  : path.join(__dirname, "../data/scheduler-heartbeat.json");

function appendJsonLineLog(filePath, entry, label) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(entry) + "\n");
  } catch (e) {
    console.error(`[${label}]`, e.message);
  }
}

function appendEngagementEventChecked(payload, context) {
  const outcome = appendEngagementEvent(payload);
  if (!outcome.ok) {
    const code = String(outcome.error_code || outcome.code || "unknown");
    const detail = outcome.detail ? ` (${outcome.detail})` : "";
    console.warn(`[web] engagement event write failed [${context}] code=${code}${detail}`);
  }
  return outcome;
}

function isLegacyArchiveEndpointEnabled() {
  if (String(process.env.ARCHIVE_LEGACY_FORCE_ENABLE || "") === "1") return true;
  const ts = Date.parse(String(ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC || ""));
  if (!Number.isFinite(ts)) return true;
  return Date.now() < ts;
}

function recordLegacyArchiveUsage(req, endpoint, outcome, metadata = {}) {
  appendJsonLineLog(ARCHIVE_LEGACY_USAGE_LOG, {
    ts_utc: new Date().toISOString(),
    endpoint,
    outcome,
    method: req.method,
    host: getRequestHost(req),
    ip: getClientIp(req),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  }, "archive-legacy-usage");
}

function readJsonLineTail(filePath, limit = 30, maxBytes = 512 * 1024) {
  if (!fs.existsSync(filePath)) return [];
  const requested = Math.max(1, Number(limit) || 1);
  let bytesToRead = Math.max(32 * 1024, Number(maxBytes) || (512 * 1024));
  const capBytes = 4 * 1024 * 1024; // hard ceiling to avoid large memory spikes

  while (bytesToRead <= capBytes) {
    const stat = fs.statSync(filePath);
    const size = stat.size || 0;
    if (size <= 0) return [];
    const readSize = Math.min(size, bytesToRead);
    const start = size - readSize;
    const fd = fs.openSync(filePath, "r");
    let raw = "";
    try {
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, start);
      raw = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
    if (start > 0) {
      const firstNl = raw.indexOf("\n");
      raw = firstNl >= 0 ? raw.slice(firstNl + 1) : "";
    }
    if (!raw) return [];
    const lines = raw.split("\n").filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < requested; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed) out.push(parsed);
      } catch (err) {
        if (process.env.DEBUG_WEB_SERVER === "1") {
          console.warn(`[web] skipping malformed JSONL line in ${filePath}: ${err.message}`);
        }
      }
    }
    if (out.length >= requested || start === 0) return out;
    bytesToRead = Math.min(capBytes, bytesToRead * 2);
  }
  return [];
}

function readJsonLineLog(filePath, limit = 30) {
  return readJsonLineTail(filePath, limit);
}

function parseIsoTs(iso) {
  const ts = Date.parse(String(iso || ""));
  return Number.isFinite(ts) ? ts : null;
}

function toNumericOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function feedbackTimestampMs(entry) {
  const direct = parseIsoTs(entry?.ts_utc);
  if (direct != null) return direct;
  const dateEt = String(entry?.date_et || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateEt)) return null;
  const guess = Date.parse(`${dateEt}T00:00:00-05:00`);
  return Number.isFinite(guess) ? guess : null;
}

function feedbackScoreValue(entry) {
  const score = toNumericOrNull(entry?.score);
  if (score != null) return Math.max(0, Math.min(2, score));
  const label = String(entry?.label || "").toLowerCase().trim();
  if (label === "great") return 2;
  if (label === "fine") return 1;
  if (label === "meh") return 0;
  return null;
}

function average(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr.reduce((sum, value) => sum + Number(value || 0), 0) / arr.length;
}

function computeFeedbackTrend(users) {
  const nowMs = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const currentStart = nowMs - (14 * DAY_MS);
  const previousStart = nowMs - (28 * DAY_MS);
  const entries = [];

  for (const user of (users || [])) {
    const userRows = Array.isArray(user?.digest_feedback) ? user.digest_feedback : [];
    for (const row of userRows) {
      const ts = feedbackTimestampMs(row);
      if (ts == null || ts < previousStart || ts > nowMs) continue;
      const score = feedbackScoreValue(row);
      if (score == null) continue;
      entries.push({
        ts,
        score,
        label: String(row?.label || "").toLowerCase().trim(),
      });
    }
  }

  const current = entries.filter((row) => row.ts >= currentStart);
  const previous = entries.filter((row) => row.ts >= previousStart && row.ts < currentStart);

  const currentScores = current.map((row) => row.score);
  const previousScores = previous.map((row) => row.score);
  const currentAvgRaw = average(currentScores);
  const previousAvgRaw = average(previousScores);
  const currentAvg = currentAvgRaw == null ? null : Number((currentAvgRaw * 50).toFixed(2));
  const previousAvg = previousAvgRaw == null ? null : Number((previousAvgRaw * 50).toFixed(2));
  const positiveCount = current.filter((row) => row.score >= 1).length;
  const greatCount = current.filter((row) => row.label === "great").length;
  const fineCount = current.filter((row) => row.label === "fine").length;
  const mehCount = current.filter((row) => row.label === "meh").length;
  const responses = current.length;
  const positiveRate = responses
    ? Number(((positiveCount / responses) * 100).toFixed(1))
    : null;
  const delta = (currentAvg != null && previousAvg != null)
    ? Number((currentAvg - previousAvg).toFixed(2))
    : null;
  let trendLabel = "Baseline forming";
  if (!responses) trendLabel = "No reactions in last 14 days";
  else if (delta == null) trendLabel = "Baseline forming";
  else if (Math.abs(delta) < 0.5) trendLabel = "Flat vs prior 14d";
  else trendLabel = `${delta > 0 ? "+" : ""}${delta.toFixed(1)} vs prior 14d`;

  return {
    responses_14d: responses,
    avg_score_14d: currentAvg,
    avg_score_prev_14d: previousAvg,
    positive_rate_14d: positiveRate,
    great_14d: greatCount,
    fine_14d: fineCount,
    meh_14d: mehCount,
    delta_14d: delta,
    trend_label: trendLabel,
  };
}

function getRecentAutoAdjustmentsForUser(user, limit = 8) {
  const maxRows = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const chatId = String(user?.chatId || "").trim();
  const email = String(user?.email || "").toLowerCase().trim();
  if (!chatId && !email) return [];

  return loadEngagementEvents({ max_age_days: 120, dedupe: true })
    .filter((ev) => String(ev?.event_type || "") === "topic_weight_adjusted")
    .filter((ev) => String(ev?.topic?.mode || "").toLowerCase() === "auto")
    .filter((ev) => {
      const evChat = String(ev?.user_chat_id || "").trim();
      if (chatId && evChat === chatId) return true;
      const evEmail = String(ev?.user_email || "").toLowerCase().trim();
      return !!(email && evEmail && evEmail === email);
    })
    .sort((a, b) => (parseIsoTs(b?.ts_utc) || 0) - (parseIsoTs(a?.ts_utc) || 0))
    .slice(0, maxRows)
    .map((ev) => {
      const topic = ev?.topic && typeof ev.topic === "object" ? ev.topic : {};
      const metadata = ev?.metadata && typeof ev.metadata === "object" ? ev.metadata : {};
      return {
        ts_utc: ev?.ts_utc || null,
        date_et: ev?.date_et || null,
        digest_id: ev?.digest_id || null,
        topic_key: topic.key || null,
        delta: toNumericOrNull(topic.delta),
        mode: topic.mode || "auto",
        reason: topic.reason || null,
        net: toNumericOrNull(metadata.net),
        count: toNumericOrNull(metadata.count),
        clicked: toNumericOrNull(metadata.clicked),
        saved: toNumericOrNull(metadata.saved),
        ignored: toNumericOrNull(metadata.ignored),
      };
    });
}

const COST_LOG_CACHE = {
  mtimeMs: 0,
  size: 0,
  runsNewest: [],
};

function loadCostRunsNewest() {
  if (!fs.existsSync(COST_LOG_PATH)) {
    COST_LOG_CACHE.mtimeMs = 0;
    COST_LOG_CACHE.size = 0;
    COST_LOG_CACHE.runsNewest = [];
    return [];
  }
  let stat;
  try {
    stat = fs.statSync(COST_LOG_PATH);
  } catch {
    return [];
  }
  if (
    COST_LOG_CACHE.runsNewest.length &&
    COST_LOG_CACHE.mtimeMs === stat.mtimeMs &&
    COST_LOG_CACHE.size === stat.size
  ) {
    return COST_LOG_CACHE.runsNewest;
  }
  const runs = fs.readFileSync(COST_LOG_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean)
    .reverse(); // newest first

  COST_LOG_CACHE.mtimeMs = stat.mtimeMs;
  COST_LOG_CACHE.size = stat.size;
  COST_LOG_CACHE.runsNewest = runs;
  return runs;
}

function readSchedulerHeartbeat() {
  if (!fs.existsSync(SCHEDULER_HEARTBEAT_FILE)) {
    return {
      available: false,
      healthy: false,
      summary: "No heartbeat file",
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SCHEDULER_HEARTBEAT_FILE, "utf8"));
    const updatedTs = Date.parse(raw?.updated_at || "");
    if (!Number.isFinite(updatedTs)) {
      return {
        available: true,
        healthy: false,
        summary: "Heartbeat malformed",
      };
    }
    const ageMs = Math.max(0, Date.now() - updatedTs);
    const pollMs = Math.max(60 * 1000, Number(raw?.poll_ms || 5 * 60 * 1000));
    const staleMs = Math.max(15 * 60 * 1000, pollMs * 3);
    const healthy = ageMs <= staleMs;
    return {
      available: true,
      healthy,
      pid: raw?.pid || null,
      in_flight: !!raw?.in_flight,
      poll_ms: pollMs,
      worker: raw?.worker || "scheduler-worker",
      updated_at: raw?.updated_at || null,
      age_seconds: Math.round(ageMs / 1000),
      last_run: raw?.last_run || null,
      summary: healthy
        ? `ok · heartbeat ${Math.round(ageMs / 1000)}s ago`
        : `stale · last heartbeat ${Math.round(ageMs / 1000)}s ago`,
    };
  } catch {
    return {
      available: true,
      healthy: false,
      summary: "Heartbeat unreadable",
    };
  }
}

function maskEmail(email) {
  const value = String(email || "").trim();
  const at = value.indexOf("@");
  if (at <= 1) return value;
  return value.slice(0, 2) + "***" + value.slice(at);
}

function summarizeMessage(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 120 ? clean.slice(0, 117) + "..." : clean;
}

function hashText(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function logAdminMessageEvent(req, payload) {
  appendJsonLineLog(ADMIN_MESSAGE_LOG, {
    at: new Date().toISOString(),
    actor: getAdminActor(req),
    ...payload,
  }, "admin-message-log");
}

function logAdminActionEvent(req, payload) {
  appendJsonLineLog(ADMIN_ACTION_LOG, {
    at: new Date().toISOString(),
    actor: getAdminActor(req),
    ...payload,
  }, "admin-action-log");
}

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".ico": "image/x-icon",
};

function serveFile(res, filePath) {
  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    res.end(content);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
}

const BASE_URL = process.env.BASE_URL || "http://localhost:3003";

function toEtDateKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function normalizeReferralToken(raw) {
  const token = String(raw || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(token) ? token : "";
}

// digestId is base64url-encoded in tracking pixel URLs to preserve the
// native digest id shape ("YYYY-MM-DD:chatId") as a single path segment.
function decodeDigestIdParam(encoded) {
  const raw = String(encoded || "").trim();
  if (!raw) return "";
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return Buffer.from(padded, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

function blankReengagementState() {
  return {
    day4_sent_at: null,
    day8_sent_at: null,
    auto_paused_at: null,
    reactivated_at: null,
  };
}

function resetReengagementState(user, opts = {}) {
  const preserveAutoPaused = !!opts.preserveAutoPaused;
  const prev = user && typeof user.reengagement_state === "object" ? user.reengagement_state : {};
  const next = blankReengagementState();
  if (preserveAutoPaused && prev.auto_paused_at) next.auto_paused_at = prev.auto_paused_at;
  return next;
}

function sendTransparentGif(res) {
  res.writeHead(200, {
    "Content-Type": "image/gif",
    "Content-Length": TRANSPARENT_GIF.length,
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.end(TRANSPARENT_GIF);
}

async function sendMagicLinkEmail(user) {
  const settingsUrl = `${BASE_URL}/settings?token=${user.token}`;
  const archiveUrl  = `${BASE_URL}/archive?token=${user.token}`;
  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;">
      <div style="font-size:22px;font-weight:700;margin-bottom:24px;">☀️ SignalBrief</div>
      <p style="font-size:16px;margin-bottom:16px;">Here's your personal SignalBrief access link:</p>
      <a href="${settingsUrl}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:14px 32px;border-radius:100px;">Manage preferences →</a>
      <p style="margin-top:20px;font-size:13px;color:#6B7280;">Or view your <a href="${archiveUrl}" style="color:#2563EB;">past digests</a>.<br>This link is personal — keep it private.</p>
    </div>`;
  await sendEmail(user.email, "Your SignalBrief access link", html);
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeArchiveTopic(topic) {
  return String(topic || "")
    .toLowerCase()
    .replace(/^custom_/, "")
    .replace(/_/g, " ")
    .trim();
}

function archiveTopicMatch(itemTag, itemHeadline, itemSummary, userTopics) {
  const tag = String(itemTag || "").toLowerCase();
  const headline = String(itemHeadline || "").toLowerCase();
  const summary = String(itemSummary || "").toLowerCase();
  const topics = (userTopics || []).map(normalizeArchiveTopic).filter(Boolean);
  if (topics.length === 0) return 3;

  for (const topic of topics) {
    if (tag === topic || topic === tag) return 10;
  }
  for (const topic of topics) {
    if (tag.includes(topic) || topic.includes(tag)) return 7;
  }
  for (const topic of topics) {
    if (headline.includes(topic) || summary.includes(topic)) return 7;
  }
  return 3;
}

function archiveWeightBonus(itemTag, topicWeights) {
  if (!topicWeights || typeof topicWeights !== "object") return 0;
  const tag = String(itemTag || "").toLowerCase();
  let total = 0;
  for (const [rawKey, rawWeight] of Object.entries(topicWeights)) {
    const weight = Number(rawWeight);
    if (!weight) continue;
    const key = normalizeArchiveTopic(rawKey);
    if (!key) continue;
    if (tag === key || tag.includes(key) || key.includes(tag)) total += weight;
  }
  return total;
}

function archiveRelevanceScore(item, userTopics, topicWeights) {
  const base = typeof item?.baseScore === "number" ? item.baseScore : 5;
  const topicMatch = archiveTopicMatch(item?.tag, item?.headline, item?.summary, userTopics);
  const weightBonus = archiveWeightBonus(item?.tag, topicWeights) * 0.5;
  const raw = base * 0.6 + topicMatch * 0.4 + weightBonus;
  return Math.min(10, Math.max(0, Math.round(raw * 10) / 10));
}

function readArchiveFiles(archiveDir) {
  if (!fs.existsSync(archiveDir)) return [];
  return fs.readdirSync(archiveDir)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse(); // newest first
}

function sanitizePublicUrl(rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function stripHtml(raw) {
  return String(raw || "")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPublicDigestDateLabel(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return dateKey || "SignalBrief";
  const [year, month, day] = String(dateKey).split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function renderPublicDigestPage({ dateKey, dateLabel, quickScan, items, refToken = "" }) {
  const referralToken = normalizeReferralToken(refToken);
  const shareUrl = referralToken
    ? `${BASE_URL}/digest/${dateKey}?ref=${encodeURIComponent(referralToken)}`
    : `${BASE_URL}/digest/${dateKey}`;
  const signupUrl = referralToken
    ? `${BASE_URL}/?ref=${encodeURIComponent(referralToken)}`
    : `${BASE_URL}/`;
  const safeDateLabel = escapeHtml(dateLabel || formatPublicDigestDateLabel(dateKey));
  const safeQuickScan = escapeHtml(String(quickScan || ""));
  const safeItems = Array.isArray(items) ? items : [];
  const cards = safeItems.map((item, idx) => {
    const tag = escapeHtml(item?.tag || "Signal");
    const headline = escapeHtml(item?.headline || "Untitled item");
    const summary = escapeHtml(item?.summary || "");
    const wim = escapeHtml(stripHtml(item?.wim || ""));
    const source = escapeHtml(item?.source || "source");
    const href = sanitizePublicUrl(item?.url);
    const sourceLink = href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">Read more -> ${source}</a>`
      : `<span>${source}</span>`;
    return `
      <article class="item-card">
        <div class="item-meta">
          <span class="item-index">${idx + 1}</span>
          <span class="item-tag">${tag}</span>
        </div>
        <h2>${headline}</h2>
        ${summary ? `<p class="item-summary">${summary}</p>` : ""}
        ${wim ? `<p class="item-wim">${wim}</p>` : ""}
        <div class="item-link">${sourceLink}</div>
      </article>
    `;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SignalBrief - ${safeDateLabel}</title>
  <meta name="description" content="SignalBrief public digest for ${safeDateLabel}.">
  <style>
    :root {
      --bg: #f7f8fc;
      --ink: #0f172a;
      --muted: #475569;
      --line: #dbe2ea;
      --card: #ffffff;
      --tag-bg: #e8f0ff;
      --tag-ink: #1d4ed8;
      --accent: #0f766e;
      --accent-ink: #ffffff;
      --accent-soft: #dcfce7;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: radial-gradient(circle at top right, #dbeafe 0%, var(--bg) 45%); }
    .wrap { max-width: 820px; margin: 0 auto; padding: 28px 16px 56px; }
    .hero { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 24px; margin-bottom: 18px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05); }
    .kicker { font-size: 11px; letter-spacing: 0.11em; text-transform: uppercase; color: #334155; font-weight: 700; margin-bottom: 8px; }
    h1 { margin: 0; font-size: 32px; line-height: 1.1; letter-spacing: -0.02em; }
    .hero-sub { margin: 10px 0 0; color: var(--muted); line-height: 1.5; font-size: 15px; }
    .hero-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
    .btn { text-decoration: none; border-radius: 999px; padding: 10px 16px; font-size: 13px; font-weight: 700; display: inline-block; }
    .btn-primary { background: var(--accent); color: var(--accent-ink); }
    .btn-secondary { background: var(--accent-soft); color: #166534; }
    .scan { background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 14px; padding: 12px 14px; color: #1e3a8a; font-size: 13px; line-height: 1.6; margin-top: 14px; }
    .item-list { display: grid; gap: 14px; }
    .item-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px 18px 16px; box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04); }
    .item-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .item-index { font-size: 12px; color: #64748b; font-weight: 700; }
    .item-tag { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; background: var(--tag-bg); color: var(--tag-ink); border-radius: 999px; padding: 4px 8px; }
    h2 { margin: 0 0 8px; font-size: 20px; line-height: 1.3; letter-spacing: -0.01em; }
    .item-summary { margin: 0 0 8px; color: #334155; line-height: 1.6; font-size: 15px; }
    .item-wim { margin: 0 0 10px; color: #0f172a; line-height: 1.6; font-size: 14px; }
    .item-link a { color: #2563eb; text-decoration: none; font-weight: 600; font-size: 14px; }
    .item-link span { color: #64748b; font-size: 14px; }
    .footer { margin-top: 18px; text-align: center; color: #64748b; font-size: 13px; }
    @media (max-width: 640px) {
      h1 { font-size: 28px; }
      .hero { padding: 18px; }
      .item-card { padding: 16px; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="kicker">SignalBrief Public Digest</div>
      <h1>${safeDateLabel}</h1>
      <p class="hero-sub">A shareable briefing from SignalBrief: daily intelligence across AI, strategy, and business.</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="${escapeHtml(signupUrl)}" target="_blank" rel="noopener">Get your own personalized brief</a>
        <a class="btn btn-secondary" href="mailto:?subject=SignalBrief%20Digest&body=${encodeURIComponent(shareUrl)}">Forward this brief</a>
      </div>
      ${safeQuickScan ? `<div class="scan"><strong>Quick scan:</strong> ${safeQuickScan}</div>` : ""}
    </section>
    <section class="item-list">
      ${cards || `<div class="item-card"><p class="item-summary">No items available for this date.</p></div>`}
    </section>
    <p class="footer">Built with SignalBrief · <a href="https://getsignalbrief.com" target="_blank" rel="noopener">getsignalbrief.com</a></p>
  </main>
</body>
</html>`;
}

function renderPublicDigestMissingPage(dateKey) {
  const safeDate = escapeHtml(dateKey || "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SignalBrief - Digest Not Found</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
    main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { max-width: 520px; background: #fff; border: 1px solid #dbe2ea; border-radius: 14px; padding: 24px; text-align: center; }
    .kicker { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; margin-bottom: 8px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0 0 16px; color: #475569; line-height: 1.6; }
    a { display: inline-block; text-decoration: none; background: #0f766e; color: #fff; border-radius: 999px; padding: 10px 16px; font-weight: 700; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <div class="card">
      <div class="kicker">SignalBrief</div>
      <h1>Digest not found</h1>
      <p>We could not find a public digest for ${safeDate || "that date"}.</p>
      <a href="https://getsignalbrief.com" target="_blank" rel="noopener">Get your own personalized brief</a>
    </div>
  </main>
</body>
</html>`;
}

function getAllowedArchiveDates(user, archiveDir, files) {
  let allowedList = Array.isArray(user.digest_dates) ? user.digest_dates.slice() : [];
  let changed = false;

  // Legacy backfill: older users may have digests_received ahead of digest_dates.
  if ((user.digests_received || 0) > allowedList.length) {
    const joinedET = toEtDateKey(user.joined_at);
    const inferred = files
      .map(f => f.replace(".json", ""))
      .filter(d => (!joinedET || d >= joinedET));
    const merged = [...new Set([...allowedList, ...inferred])].sort();
    if (merged.length > allowedList.length) {
      allowedList = merged;
      changed = true;
    }
  }

  // Safety backfill: include most recent delivered digest date from last_digest_at.
  // This covers cases where digest_dates missed a write on manual/on-demand sends.
  const lastDigestDate = toEtDateKey(user.last_digest_at);
  if (lastDigestDate && !allowedList.includes(lastDigestDate)) {
    const lastFile = path.join(archiveDir, `${lastDigestDate}.json`);
    if (fs.existsSync(lastFile)) {
      allowedList = [...new Set([...allowedList, lastDigestDate])].sort();
      changed = true;
    }
  }

  if (changed) {
    writeUser(user.chatId, {
      ...user,
      digest_dates: allowedList,
      last_updated: new Date().toISOString(),
    });
  }

  return new Set(allowedList);
}

function normalizeBookmarkUrl(rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function sendTelegramText(chatId, text) {
  const token = CONFIG.keys.signalBriefBotToken || CONFIG.keys.telegramBotToken;
  if (!token) return Promise.reject(new Error("Telegram bot token not configured"));
  const body = JSON.stringify({
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${token}/sendMessage`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (r) => {
      let out = "";
      r.on("data", c => out += c);
      r.on("end", () => {
        try {
          const data = JSON.parse(out || "{}");
          if (!data.ok) return reject(new Error(data.description || "telegram send failed"));
          resolve(data);
        } catch {
          reject(new Error("telegram response parse failed"));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// sendWelcomeEmail is defined in mailer.js and imported above

function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "X-Robots-Tag": "noindex, nofollow",
  });
  res.end(JSON.stringify(data));
}

const REQUEST_BODY_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    let size = 0;
    let tooLarge = false;
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on("data", (c) => {
      size += c.length;
      if (size > REQUEST_BODY_MAX_BYTES) {
        tooLarge = true;
        return;
      }
      if (tooLarge) return;
      body += c;
    });
    req.on("end", () => {
      if (tooLarge) {
        return settle({
          ok: false,
          code: "payload_too_large",
          max_bytes: REQUEST_BODY_MAX_BYTES,
        });
      }
      if (!body.trim()) return settle({ ok: true, body: {} });
      try {
        return settle({ ok: true, body: JSON.parse(body) });
      } catch {
        return settle({ ok: false, code: "invalid_json" });
      }
    });
    req.on("error", (err) => {
      if (process.env.DEBUG_WEB_SERVER === "1") {
        console.warn(`[web] request body read error: ${err.message}`);
      }
      settle({ ok: false, code: "body_read_error" });
    });
  });
}

function writeBodyParseError(res, parseResult) {
  if (parseResult.code === "payload_too_large") {
    return json(res, {
      error: "request payload too large",
      code: "payload_too_large",
      max_bytes: REQUEST_BODY_MAX_BYTES,
    }, 413);
  }
  return json(res, {
    error: "invalid JSON payload",
    code: parseResult.code || "invalid_json",
  }, 400);
}

async function requireJsonBody(req, res) {
  const parseResult = await readBody(req);
  if (parseResult.ok) return parseResult.body;
  writeBodyParseError(res, parseResult);
  return null;
}

const INDUSTRY_TOPICS = [
  "HEALTHCARE", "FINANCIAL SERVICES", "PE×M&A", "ENERGY", "CONSUMER",
  "LIFE SCIENCES", "TECHNOLOGY", "INDUSTRIALS", "REAL ESTATE", "PUBLIC SECTOR",
];
const CAPABILITY_TOPICS = [
  "AI×TECH", "STRATEGY", "POLICY×REGULATORY", "SUSTAINABILITY",
  "DIGITAL", "M&A ADVISORY", "TALENT",
];
const DEFAULT_TOPICS = [...INDUSTRY_TOPICS, ...CAPABILITY_TOPICS];

// Fields that must never be overwritten via /api/settings
const PROTECTED_FIELDS = [
  "chatId",
  "token",
  "joined_at",
  "digests_received",
  "bookmarks",
  "last_digest_items",
  "last_digest_at",
  "digest_dates",
  "last_email_open_at",
  "email_opens_total",
  "reengagement_state",
  "signup_referral_source",
];
const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseEtNowParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = t => parseInt(parts.find(p => p.type === t)?.value || "0", 10);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function formatTimeEt(h, m) {
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm} ET`;
}

function normalizeDeliveryTimeInput(raw) {
  const clean = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s*et\s*$/i, "")
    .replace(/\s+/g, " ");
  if (!clean) return null;

  let h;
  let m;

  // 24-hour format: HH:MM
  let match = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    h = parseInt(match[1], 10);
    m = parseInt(match[2], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // 12-hour format: H[:MM] AM/PM
  match = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!match) return null;
  h = parseInt(match[1], 10);
  m = match[2] != null ? parseInt(match[2], 10) : 0;
  const meridiem = match[3];
  if (h < 1 || h > 12 || m < 0 || m > 59) return null;
  if (meridiem === "am") {
    if (h === 12) h = 0;
  } else if (h !== 12) {
    h += 12;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDaysLabel(days) {
  const list = Array.isArray(days) ? [...new Set(days.map(Number))].sort((a, b) => a - b) : [1, 2, 3, 4, 5];
  if (list.length === 7) return "Every day";
  if (list.length === 6 && !list.includes(0)) return "Mon–Sat";
  if (list.length === 5 && [1, 2, 3, 4, 5].every(d => list.includes(d))) return "Mon–Fri";
  return list.map(d => DAY_NAMES_SHORT[d] || `D${d}`).join(", ");
}

function computeNextDeliveryEt(preferences) {
  const prefs = preferences || {};
  const [hRaw, mRaw] = String(prefs.delivery_time || "07:00").split(":").map(Number);
  const h = Number.isFinite(hRaw) ? hRaw : 7;
  const m = Number.isFinite(mRaw) ? mRaw : 0;
  const allowed = (Array.isArray(prefs.days_of_week) && prefs.days_of_week.length ? prefs.days_of_week : [1, 2, 3, 4, 5]).map(Number);
  const now = parseEtNowParts();
  const nowMins = now.hour * 60 + now.minute;
  const deliveryMins = h * 60 + m;

  for (let offset = 0; offset < 14; offset++) {
    const d = new Date(Date.UTC(now.year, now.month - 1, now.day + offset));
    const dow = d.getUTCDay();
    if (!allowed.includes(dow)) continue;
    if (offset === 0 && deliveryMins <= nowMins) continue;

    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    const dateKey = `${y}-${mo}-${da}`;
    const prettyDate = d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
    return {
      key: `${dateKey} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ET`,
      label: `${prettyDate} · ${formatTimeEt(h, m)}`,
    };
  }
  return null;
}

async function handleSignup(req, res) {
  const body = await requireJsonBody(req, res);
  if (body == null) return;
  const { name, email, telegram, topics, depth, delivery_time, frequency, days_of_week, items_per_digest } = body;
  const emailNorm = String(email || "").toLowerCase().trim();
  const referralToken = normalizeReferralToken(body.referral_token);

  if (!emailNorm || !name) return json(res, { error: "name and email required" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) return json(res, { error: "invalid email address" }, 400);
  if (!topics || topics.length < 2) return json(res, { error: "select at least 2 topics" }, 400);

  const ip = getClientIp(req);
  const rl = checkRateLimit(ip, emailNorm);
  if (rl.limited) return json(res, { error: rl.reason }, 429);

  const telegramClean = telegram ? String(telegram).replace(/^@+/, "").trim() : null;
  const users = allUsers();
  const existingEmail = users.find(u => (u.email || "").toLowerCase().trim() === emailNorm);
  if (existingEmail) {
    return json(res, {
      error: "An account with this email already exists. Use your existing settings link to access it.",
    }, 409);
  }

  if (telegramClean) {
    const telegramKey = telegramClean.toLowerCase();
    const existingTelegram = users.find(u => String(u.telegram || "").toLowerCase() === telegramKey);
    if (existingTelegram) {
      return json(res, { error: "That Telegram username is already linked to another account." }, 409);
    }
  }

  const chatId = `email-${Date.now()}`;
  let signupReferralSource = null;
  let referrerUser = null;
  if (referralToken) {
    const referrer = findUserByToken(referralToken);
    if (referrer) {
      referrerUser = referrer;
      signupReferralSource = {
        chatId: referrer.chatId,
        email: referrer.email || null,
        ts: new Date().toISOString(),
      };
    }
  }

  const user = {
    chatId,
    name,
    email: emailNorm,
    telegram: telegramClean || null,
    topics,
    status: "active",
    token: generateToken(),
    joined_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    digests_received: 0,
    bookmarks: [],
    topic_weights: {},
    custom_topics: topics.filter(t => !DEFAULT_TOPICS.includes(t)),
    signup_referral_source: signupReferralSource,
    digest_dates: [],
    last_digest_items: [],
    preferences: {
      depth: depth || "headline_plus_why",
      delivery_time: delivery_time || "07:00",
      frequency: frequency || "daily_weekday",
      days_of_week: Array.isArray(days_of_week) ? days_of_week : [1, 2, 3, 4, 5],
      items_per_digest: parseInt(items_per_digest) || 5,
      timezone: "America/New_York",
      email_enabled: true,
      telegram_enabled: !!telegramClean,
    },
  };

  writeUser(chatId, user);
  console.log(`[signup] ${name} <${email}>`);
  if (referrerUser) {
    console.log(`[signup] referred by ${referrerUser.email || referrerUser.chatId}`);
    sendReferralThankYou(referrerUser, user).catch(e => console.error("[referral thank-you]", e));
  }

  sendWelcomeEmail(user).catch(e => console.error("[welcome email]", e));

  triggerDigest({
    source: "web:signup_welcome",
    trigger: "signup_welcome",
    chatId,
    queue: true,
    maxAdmissionWaitMs: 10 * 60 * 1000,
    env: { BASE_URL },
  }).then((run) => {
    if (!run.ok && process.env.DEBUG_WEB_SERVER === "1") {
      console.warn(`[welcome digest] skipped for ${chatId}: ${run.code || "unknown"}`);
    }
  }).catch((err) => {
    console.error(`[welcome digest] failed for ${chatId}: ${err.message}`);
  });
  console.log(`[welcome digest] queued for ${chatId}`);

  return json(res, { success: true, chatId, token: user.token, archiveUrl: `${BASE_URL}/archive?token=${user.token}` });
}

async function handleSettings(req, res) {
  const body = await requireJsonBody(req, res);
  if (body == null) return;
  const { token } = body;
  if (!token) return json(res, { error: "token required" }, 400);

  const existing = findUserByToken(token);
  if (!existing) return json(res, { error: "invalid token" }, 401);

  const safeBody = Object.fromEntries(
    Object.entries(body).filter(([k]) => !PROTECTED_FIELDS.includes(k))
  );

  if (safeBody.telegram != null) {
    safeBody.telegram = String(safeBody.telegram).replace(/^@+/, "").trim() || null;
    if (safeBody.telegram) {
      const telegramKey = safeBody.telegram.toLowerCase();
      const telegramConflict = allUsers().find(u =>
        String(u.telegram || "").toLowerCase() === telegramKey &&
        String(u.chatId || "") !== String(existing.chatId || "")
      );
      if (telegramConflict) {
        return json(res, { error: "That Telegram username is already linked to another account." }, 409);
      }
    }
  }

  if (safeBody.email != null) {
    const nextEmail = String(safeBody.email).toLowerCase().trim();
    if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      return json(res, { error: "invalid email address" }, 400);
    }
    const emailConflict = allUsers().find(u =>
      String(u.email || "").toLowerCase().trim() === nextEmail &&
      String(u.chatId || "") !== String(existing.chatId || "")
    );
    if (emailConflict) {
      return json(res, { error: "That email is already linked to another account." }, 409);
    }
    safeBody.email = nextEmail;
  }

  const updated = {
    ...existing,
    ...safeBody,
    last_updated: new Date().toISOString(),
    preferences: { ...existing.preferences, ...safeBody.preferences },
    ...Object.fromEntries(PROTECTED_FIELDS.map(k => [k, existing[k]])),
  };

  if (updated.status === "unsubscribed" && existing.status !== "unsubscribed") {
    updated.email_unsubscribed_at = new Date().toISOString();
  }

  writeUser(existing.chatId, updated);
  return json(res, { success: true });
}

async function handleAdminRunDigest(req, res) {
  if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
  const body = await requireJsonBody(req, res);
  if (body == null) return;
  const targetChatId = body.chatId ? String(body.chatId).trim() : "";
  const digestLock = digestRunStatus();
  const lockState = String(digestLock.state || "");
  const lockUnhealthy = lockState === "corrupt" || lockState === "io_error" || lockState === "stale_uncleared";
  const lockStatus = lockUnhealthy ? 503 : 409;
  const lockMsg = digestLock.running
    ? (lockUnhealthy
      ? `Digest lock is unhealthy (${lockState}); manual intervention required before triggering runs.`
      : `Digest run already in progress (${digestLock.lock.mode || "scheduled"}, started ${digestLock.lock.startedAtIso || digestLock.lock.startedAt || "recently"}).`)
    : "";

  if (targetChatId) {
    if (digestLock.running) {
      logAdminActionEvent(req, {
        action: "run_digest_targeted",
        target_chat_id: targetChatId,
        success: false,
        details: {
          reason: lockUnhealthy ? "digest lock unhealthy" : "digest lock active",
          state: lockState || "unknown",
          mode: digestLock.lock.mode || "scheduled",
          error: digestLock.lock.error || null,
        },
      });
      return json(res, { error: lockMsg, code: lockState || "busy" }, lockStatus);
    }
    const targetUser = allUsers().find(u => String(u.chatId || "").trim() === targetChatId);
    if (!targetUser) return json(res, { error: `No user found for chatId ${targetChatId}` }, 404);
    if ((targetUser.status || "active") !== "active") {
      logAdminActionEvent(req, {
        action: "run_digest_targeted",
        target_email: targetUser.email || null,
        target_chat_id: targetChatId,
        success: false,
        details: { reason: `user status ${targetUser.status}` },
      });
      return json(res, { error: `User is ${targetUser.status}; re-activate before sending.` }, 400);
    }
    const prefs = targetUser.preferences || {};
    const emailReady = !!targetUser.email && prefs.email_enabled !== false;
    const tgReady = !!(targetUser.chatId && !String(targetUser.chatId).startsWith("email-") && prefs.telegram_enabled !== false);
    if (!emailReady && !tgReady) {
      logAdminActionEvent(req, {
        action: "run_digest_targeted",
        target_email: targetUser.email || null,
        target_chat_id: targetChatId,
        success: false,
        details: { reason: "no enabled delivery channels" },
      });
      return json(res, { error: "No enabled delivery channels for this user." }, 400);
    }

    try {
      const run = await triggerDigest({
        source: "web:admin_targeted",
        trigger: "admin_targeted",
        chatId: targetChatId,
        suppressWelcome: true,
        waitForExit: true,
        timeoutMs: 12 * 60 * 1000,
        queue: false,
        maxAdmissionWaitMs: 0,
        serializeAdmission: false,
      });
      if (!run.ok && run.code === "busy") {
        const detail = run.run?.stderr
          ? run.run.stderr.slice(-260)
          : "digest run lock active";
        logAdminActionEvent(req, {
          action: "run_digest_targeted",
          target_email: targetUser.email || null,
          target_chat_id: targetChatId,
          success: false,
          details: { detail, reason: "digest lock active" },
        });
        return json(res, { error: "Digest run already in progress. Try again shortly.", detail }, 409);
      }
      if (!run.ok && (run.code === "corrupt" || run.code === "io_error" || run.code === "stale_uncleared")) {
        const detail = run.admission?.lock?.error || "digest lock requires manual intervention";
        logAdminActionEvent(req, {
          action: "run_digest_targeted",
          target_email: targetUser.email || null,
          target_chat_id: targetChatId,
          success: false,
          details: { detail, reason: "digest lock unhealthy", state: run.code },
        });
        return json(res, {
          error: `Digest lock unhealthy (${run.code}). Clear or repair lock before retrying.`,
          detail,
          code: run.code,
        }, 503);
      }
      if (!run.ok || !run.run || run.run.code == null) {
        const detail = run.run?.stderr
          ? run.run.stderr.slice(-240)
          : (run.code || "unknown failure");
        logAdminActionEvent(req, {
          action: "run_digest_targeted",
          target_email: targetUser.email || null,
          target_chat_id: targetChatId,
          success: false,
          details: { detail },
        });
        return json(res, { error: `Digest failed for ${targetChatId}`, detail }, 500);
      }
      if (run.run.code !== 0) {
        const detail = run.run.stderr ? run.run.stderr.slice(-240) : `exit ${run.run.code}`;
        logAdminActionEvent(req, {
          action: "run_digest_targeted",
          target_email: targetUser.email || null,
          target_chat_id: targetChatId,
          success: false,
          details: { detail },
        });
        return json(res, { error: `Digest failed for ${targetChatId}`, detail }, 500);
      }
      logAdminActionEvent(req, {
        action: "run_digest_targeted",
        target_email: targetUser.email || null,
        target_chat_id: targetChatId,
        success: true,
      });
      return json(res, {
        success: true,
        message: `Digest sent to ${targetUser.email || targetChatId}`,
      });
    } catch (e) {
      logAdminActionEvent(req, {
        action: "run_digest_targeted",
        target_email: targetUser.email || null,
        target_chat_id: targetChatId,
        success: false,
        details: { detail: e.message },
      });
      return json(res, { error: `Failed to run digest: ${e.message}` }, 500);
    }
  }

  if (digestLock.running) {
    logAdminActionEvent(req, {
      action: "run_digest_full",
      success: false,
      details: {
        reason: lockUnhealthy ? "digest lock unhealthy" : "digest lock active",
        state: lockState || "unknown",
        mode: digestLock.lock.mode || "scheduled",
        error: digestLock.lock.error || null,
      },
    });
    return json(res, { error: lockMsg, code: lockState || "busy" }, lockStatus);
  }

  const run = await triggerDigest({
    source: "web:admin_full",
    trigger: "admin_full",
    suppressWelcome: true,
    queue: false,
    maxAdmissionWaitMs: 0,
    serializeAdmission: false,
  });
  if (!run.ok && run.code === "busy") {
    logAdminActionEvent(req, {
      action: "run_digest_full",
      success: false,
      details: { reason: "digest lock active", state: run.admission?.lockState || "valid", mode: digestLock.lock?.mode || "scheduled" },
    });
    return json(res, { error: "Digest run already in progress. Try again shortly." }, 409);
  }
  if (!run.ok && (run.code === "corrupt" || run.code === "io_error" || run.code === "stale_uncleared")) {
    const detail = run.admission?.lock?.error || "digest lock requires manual intervention";
    logAdminActionEvent(req, {
      action: "run_digest_full",
      success: false,
      details: { reason: "digest lock unhealthy", state: run.code, error: detail },
    });
    return json(res, {
      error: `Digest lock unhealthy (${run.code}). Clear or repair lock before retrying.`,
      detail,
      code: run.code,
    }, 503);
  }
  if (!run.ok) {
    logAdminActionEvent(req, {
      action: "run_digest_full",
      success: false,
      details: { reason: run.code || "spawn_failed", error: run.error || null },
    });
    return json(res, { error: "Failed to trigger full digest run." }, 500);
  }
  logAdminActionEvent(req, {
    action: "run_digest_full",
    success: true,
  });
  return json(res, { success: true, message: "Full scheduled digest run triggered" });
}

const ROUTE_DEPS = {
  // Core API routes
  json,
  DEFAULT_TOPICS,
  INDUSTRY_TOPICS,
  CAPABILITY_TOPICS,
  findUserByToken,
  handleSignup,
  handleSettings,
  signUnsubEmail,
  allUsers,
  writeUser,
  blankReengagementState,
  isLegacyArchiveEndpointEnabled,
  recordLegacyArchiveUsage,
  ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC,
  readArchiveFiles,
  getAllowedArchiveDates,
  archiveRelevanceScore,
  path,
  fs,
  APP_ROOT,
  decodeDigestIdParam,
  buildDigestId,
  toEtDateKey,
  appendEngagementEventChecked,
  resetReengagementState,
  sendTransparentGif,
  normalizeEngagementUrl,
  requireJsonBody,
  normalizeBookmarkUrl,
  sendMagicLinkEmail,

  // Admin API routes
  isAdminAuthed,
  getClientIp,
  checkLoginRate,
  CONFIG,
  verifyAdminPassword,
  createAdminSession,
  clearAdminSessionByRequest,
  BASE_URL,
  emitIgnoredEventsIfDue,
  loadCostRunsNewest,
  loadEngagementEvents,
  parseIsoTs,
  computeFeedbackTrend,
  digestRunStatus,
  readSchedulerHeartbeat,
  readJsonLineLog,
  ADMIN_MESSAGE_LOG,
  ADMIN_ACTION_LOG,
  maskEmail,
  getRecentAutoAdjustmentsForUser,
  logAdminActionEvent,
  normalizeDeliveryTimeInput,
  handleAdminRunDigest,
  logAdminMessageEvent,
  summarizeMessage,
  hashText,
  escapeHtml,
  sendEmail,
  sendTelegramText,
  formatTimeEt,
  parseEtNowParts,
  computeNextDeliveryEt,
  formatDaysLabel,
  computeQualityTrend,

  // Public digest + static routes
  renderPublicDigestMissingPage,
  formatPublicDigestDateLabel,
  renderPublicDigestPage,
  serveFile,
  WEB_DIR,
};

const server = http.createServer(async (req, res) => {
 try {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const host = getRequestHost(req);
  const scheme = getRequestScheme(req);

  // Enforce a single canonical public origin for SEO + cache consistency.
  if (PUBLIC_HOSTS.has(host) && (host !== CANONICAL_HOST || scheme !== "https")) {
    const location = `https://${CANONICAL_HOST}${pathname}${url.search}`;
    res.writeHead(301, {
      Location: location,
      "Cache-Control": "public, max-age=300",
    });
    return res.end();
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  const routeCtx = { req, res, url, pathname };

  const coreHandled = await handleCoreApiRoutes(routeCtx, ROUTE_DEPS);
  if (coreHandled !== false) return;

  const adminHandled = await handleAdminApiRoutes(routeCtx, ROUTE_DEPS);
  if (adminHandled !== false) return;

  const publicHandled = handlePublicStaticRoutes(routeCtx, ROUTE_DEPS);
  if (publicHandled !== false) return;

  res.writeHead(404);
  res.end("Not found");
 } catch (err) {
    console.error(`[server error] ${req.method} ${req.url} →`, err.message);
    if (!res.headersSent) { res.writeHead(500); res.end("Internal server error"); }
  }
});

// ── Crash protection — log + stay alive instead of dying ─────────────────────
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err.message, err.stack);
});
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});

server.listen(PORT, () => {
  console.log(`SignalBrief web running on http://localhost:${PORT}`);
});
