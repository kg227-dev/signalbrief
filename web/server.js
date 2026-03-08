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
const {
  digestRunStatus,
  queueDigestTrigger,
  runDigestTrigger,
  startDigestTrigger,
} = require("../digest-runner");
const {
  estimateCost: estimateSandboxCost,
  runPipeline: runSandboxPipeline,
} = require("../src/sandbox-pipeline-runtime");
const {
  verifyAdminPassword,
  createAdminSession,
  clearAdminSessionByRequest,
  getAdminActor,
  isAdminAuthed,
  checkLoginRate,
} = require("./admin-auth");
const { createCoreApiRouteHandler } = require("./routes/core-api");
const { createAdminApiRouteHandler } = require("./routes/admin-api");
const { createPublicStaticRouteHandler } = require("./routes/public-static");
const { createAdminOpsService } = require("./services/admin-ops");
const { getClientIp, getRequestHost, getRequestScheme } = require("./services/request-metadata");
const { createSignupRateLimiter } = require("./services/web-rate-limit");
const { blankReengagementState, resetReengagementState } = require("./services/reengagement-state");
const { archiveRelevanceScore } = require("./services/archive-scoring");
const {
  parseEtNowParts,
  formatTimeEt,
  normalizeDeliveryTimeInput,
  formatDaysLabel,
  computeNextDeliveryEt,
} = require("./services/delivery-schedule");
const { createWebUserHandlers } = require("./services/web-user-handlers");

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
const { checkRateLimit } = createSignupRateLimiter({
  ipLimit: 5,
  ipWindowMs: 15 * 60 * 1000,
  emailCooldownMs: 10 * 60 * 1000,
});

const ADMIN_MESSAGE_LOG = path.join(__dirname, "../data/admin-message-log.json");
const ADMIN_ACTION_LOG = path.join(__dirname, "../data/admin-action-log.json");
const COST_LOG_PATH = path.join(__dirname, "../data/cost-log.json");
const ARCHIVE_LEGACY_USAGE_LOG = path.join(__dirname, "../data/archive-legacy-usage.jsonl");
const ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC = process.env.ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC || "2026-06-30T00:00:00Z";
const SCHEDULER_HEARTBEAT_FILE = process.env.SCHEDULER_HEARTBEAT_FILE
  ? path.resolve(process.env.SCHEDULER_HEARTBEAT_FILE)
  : path.join(__dirname, "../data/scheduler-heartbeat.json");

function appendEngagementEventChecked(payload, context) {
  const outcome = appendEngagementEvent(payload);
  if (!outcome.ok) {
    const code = String(outcome.error_code || outcome.code || "unknown");
    const detail = outcome.detail ? ` (${outcome.detail})` : "";
    console.warn(`[web] engagement event write failed [${context}] code=${code}${detail}`);
  }
  return outcome;
}

const {
  isLegacyArchiveEndpointEnabled,
  recordLegacyArchiveUsage,
  readJsonLineLog,
  parseIsoTs,
  computeFeedbackTrend,
  getRecentAutoAdjustmentsForUser,
  loadCostRunsNewest,
  getCachedOrRefreshSchedulerHeartbeat,
  maskEmail,
  summarizeMessage,
  hashText,
  logAdminMessageEvent,
  logAdminActionEvent,
} = createAdminOpsService({
  fs,
  path,
  costLogPath: COST_LOG_PATH,
  schedulerHeartbeatFile: SCHEDULER_HEARTBEAT_FILE,
  adminMessageLog: ADMIN_MESSAGE_LOG,
  adminActionLog: ADMIN_ACTION_LOG,
  archiveLegacyUsageLog: ARCHIVE_LEGACY_USAGE_LOG,
  archiveLegacyDeprecationDeadlineUtc: ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC,
  getRequestHost,
  getClientIp,
  getAdminActor,
  loadEngagementEvents,
});

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

const {
  handleSignup,
  handleSettings,
  handleAdminRunDigest,
} = createWebUserHandlers({
  requireJsonBody,
  json,
  getClientIp,
  checkRateLimit,
  allUsers,
  findUserByToken,
  normalizeReferralToken,
  generateToken,
  writeUser,
  sendReferralThankYou,
  sendWelcomeEmail,
  queueDigestTrigger,
  runDigestTrigger,
  startDigestTrigger,
  BASE_URL,
  DEFAULT_TOPICS,
  PROTECTED_FIELDS,
  isAdminAuthed,
  logAdminActionEvent,
});

const CORE_ROUTE_DEPS = {
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
};

const ADMIN_ROUTE_DEPS = {
  json,
  isAdminAuthed,
  getClientIp,
  checkLoginRate,
  requireJsonBody,
  CONFIG,
  verifyAdminPassword,
  createAdminSession,
  clearAdminSessionByRequest,
  BASE_URL,
  emitIgnoredEventsIfDue,
  loadCostRunsNewest,
  allUsers,
  loadEngagementEvents,
  parseIsoTs,
  computeFeedbackTrend,
  digestRunStatus,
  getCachedOrRefreshSchedulerHeartbeat,
  readJsonLineLog,
  ADMIN_MESSAGE_LOG,
  ADMIN_ACTION_LOG,
  maskEmail,
  getRecentAutoAdjustmentsForUser,
  logAdminActionEvent,
  normalizeDeliveryTimeInput,
  writeUser,
  sendMagicLinkEmail,
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
  estimateSandboxCost,
  runSandboxPipeline,
};

const PUBLIC_ROUTE_DEPS = {
  path,
  fs,
  APP_ROOT,
  readArchiveFiles,
  renderPublicDigestMissingPage,
  formatPublicDigestDateLabel,
  renderPublicDigestPage,
  isAdminAuthed,
  serveFile,
  WEB_DIR,
};

const handleCoreApiRoute = createCoreApiRouteHandler(CORE_ROUTE_DEPS);
const handleAdminApiRoute = createAdminApiRouteHandler(ADMIN_ROUTE_DEPS);
const handlePublicStaticRoute = createPublicStaticRouteHandler(PUBLIC_ROUTE_DEPS);

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

  const coreHandled = await handleCoreApiRoute(routeCtx);
  if (coreHandled !== false) return;

  const adminHandled = await handleAdminApiRoute(routeCtx);
  if (adminHandled !== false) return;

  const publicHandled = handlePublicStaticRoute(routeCtx);
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
