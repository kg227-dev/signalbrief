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
const { spawn, execFileSync } = require("child_process");
const { readUser, writeUser, allUsers, generateToken, findUserByToken } = require("../store");
const { sendEmail, sendWelcomeEmail, signUnsubEmail } = require("../mailer");
const {
  appendEngagementEvent,
  buildDigestId,
  normalizeUrl: normalizeEngagementUrl,
  emitIgnoredEventsIfDue,
  loadEngagementEvents,
} = require("../engagement-events");
const { computeQualityTrend } = require("../quality-score");

const PORT = parseInt(process.env.PORT, 10) || 3003;
const WEB_DIR = __dirname;
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "../config.json"), "utf8"));
const CANONICAL_HOST = "getsignalbrief.com";
const PUBLIC_HOSTS = new Set([CANONICAL_HOST, `www.${CANONICAL_HOST}`]);

// ── Rate limiting (in-memory, per-IP + per-email) ─────────────────────────────
const RATE_IP    = new Map(); // ip  → { count, resetAt }
const RATE_EMAIL = new Map(); // email → resetAt (cooldown)
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
    } catch {
      // Ignore malformed cf-visitor headers.
    }
  }

  const xForwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (xForwardedProto === "http" || xForwardedProto === "https") return xForwardedProto;

  return req.socket.encrypted ? "https" : "http";
}

function checkRateLimit(ip, email) {
  const now = Date.now();

  // Prune expired entries (keep map lean)
  for (const [k, v] of RATE_IP) if (v.resetAt < now) RATE_IP.delete(k);
  for (const [k, v] of RATE_EMAIL) if (v < now) RATE_EMAIL.delete(k);

  // Per-IP check
  const ipEntry = RATE_IP.get(ip) || { count: 0, resetAt: now + IP_WINDOW };
  if (ipEntry.resetAt < now) { ipEntry.count = 0; ipEntry.resetAt = now + IP_WINDOW; }
  if (ipEntry.count >= IP_LIMIT) return { limited: true, reason: "Too many signups from your network. Try again in 15 minutes." };
  ipEntry.count++;
  RATE_IP.set(ip, ipEntry);

  // Per-email cooldown
  const emailReset = RATE_EMAIL.get(email.toLowerCase());
  if (emailReset && emailReset > now) return { limited: true, reason: "This email was just submitted. Wait a few minutes before resubmitting." };
  RATE_EMAIL.set(email.toLowerCase(), now + EMAIL_COOLDOWN);

  return { limited: false };
}

// ── Admin auth (session-based, in-memory) ────────────────────────────────────
const ADMIN_SESSIONS = new Map(); // token → { email, createdAt }
const ADMIN_SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const LOGIN_RATE = new Map(); // ip → { count, resetAt }
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW = 15 * 60 * 1000;
const ADMIN_LOCAL_BYPASS = process.env.ADMIN_LOCAL_BYPASS === "1";
const ADMIN_MESSAGE_LOG = path.join(__dirname, "../data/admin-message-log.json");
const ADMIN_ACTION_LOG = path.join(__dirname, "../data/admin-action-log.json");
const ADMIN_SERVICE_LOG = path.join(__dirname, "../data/admin-service-log.json");
const COST_LOG_PATH = path.join(__dirname, "../data/cost-log.json");
const DIGEST_RUN_LOCK_FILE = path.join(__dirname, "../data/digest-run.lock");
const DIGEST_RUN_LOCK_STALE_MS = Math.max(5 * 60 * 1000, Number(process.env.DIGEST_LOCK_STALE_MS || (2 * 60 * 60 * 1000)));

function verifyAdminPassword(password) {
  const { salt, passwordHash } = CONFIG.admin || {};
  if (!salt || !passwordHash) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(passwordHash, "hex"));
}

function createAdminSession(email) {
  const token = crypto.randomBytes(32).toString("hex");
  ADMIN_SESSIONS.set(token, { email, createdAt: Date.now() });
  return token;
}

function getAdminSession(req) {
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader.match(/(?:^|;\s*)sb_admin=([a-f0-9]{64})/);
  if (!match) return null;
  const session = ADMIN_SESSIONS.get(match[1]);
  if (!session) return null;
  if (Date.now() - session.createdAt > ADMIN_SESSION_TTL) {
    ADMIN_SESSIONS.delete(match[1]);
    return null;
  }
  return session;
}

function validateAdminSession(req) {
  return !!getAdminSession(req);
}

function isLocalRequest(req) {
  const ip = req.socket.remoteAddress || "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function getAdminActor(req) {
  const session = getAdminSession(req);
  if (session?.email) return session.email;
  if (ADMIN_LOCAL_BYPASS && isLocalRequest(req)) return "local-bypass";
  return "unknown";
}

function appendJsonLineLog(filePath, entry, label) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(entry) + "\n");
  } catch (e) {
    console.error(`[${label}]`, e.message);
  }
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
      } catch {
        // skip bad line
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
  const guess = Date.parse(`${dateEt}T12:00:00-05:00`);
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

function readDigestRunLock() {
  if (!fs.existsSync(DIGEST_RUN_LOCK_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(DIGEST_RUN_LOCK_FILE, "utf8"));
    const startedAtIso = raw?.startedAt || null;
    const startedAtTs = Date.parse(startedAtIso || "");
    if (!Number.isFinite(startedAtTs)) return { stale: true, raw };
    const ageMs = Date.now() - startedAtTs;
    return { ...raw, startedAtIso, startedAtTs, ageMs, stale: ageMs > DIGEST_RUN_LOCK_STALE_MS };
  } catch {
    return { stale: true };
  }
}

function clearDigestRunLock() {
  try {
    if (fs.existsSync(DIGEST_RUN_LOCK_FILE)) fs.unlinkSync(DIGEST_RUN_LOCK_FILE);
  } catch {
    // ignore lock cleanup failures
  }
}

function digestRunStatus() {
  const lock = readDigestRunLock();
  if (!lock) return { running: false, lock: null };
  if (lock.stale) {
    clearDigestRunLock();
    return { running: false, lock: null };
  }
  return { running: true, lock };
}

function appendAdminMessageLog(entry) {
  appendJsonLineLog(ADMIN_MESSAGE_LOG, entry, "admin-message-log");
}

function readAdminMessageLog(limit = 30) {
  return readJsonLineLog(ADMIN_MESSAGE_LOG, limit);
}

function appendAdminActionLog(entry) {
  appendJsonLineLog(ADMIN_ACTION_LOG, entry, "admin-action-log");
}

function readAdminActionLog(limit = 60) {
  return readJsonLineLog(ADMIN_ACTION_LOG, limit);
}

function appendAdminServiceLog(entry) {
  appendJsonLineLog(ADMIN_SERVICE_LOG, entry, "admin-service-log");
}

function readAdminServiceLog(limit = 20) {
  return readJsonLineLog(ADMIN_SERVICE_LOG, limit);
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
  appendAdminMessageLog({
    at: new Date().toISOString(),
    actor: getAdminActor(req),
    ...payload,
  });
}

function logAdminActionEvent(req, payload) {
  appendAdminActionLog({
    at: new Date().toISOString(),
    actor: getAdminActor(req),
    ...payload,
  });
}

function isAdminAuthed(req) {
  if (validateAdminSession(req)) return true;
  if (!ADMIN_LOCAL_BYPASS) return false;
  return isLocalRequest(req);
}

function checkLoginRate(ip) {
  const now = Date.now();
  for (const [k, v] of LOGIN_RATE) if (v.resetAt < now) LOGIN_RATE.delete(k);
  const entry = LOGIN_RATE.get(ip) || { count: 0, resetAt: now + LOGIN_WINDOW };
  if (entry.resetAt < now) { entry.count = 0; entry.resetAt = now + LOGIN_WINDOW; }
  if (entry.count >= LOGIN_LIMIT) return true;
  entry.count++;
  LOGIN_RATE.set(ip, entry);
  return false;
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
const LAUNCH_AGENT_SERVICES = [
  { key: "web", label: "com.jarvis.signalbrief-web", expected_running: true },
  { key: "bot", label: "com.jarvis.signalbrief-bot", expected_running: true },
  { key: "digest", label: "com.jarvis.signalbrief-digest", expected_running: false },
  { key: "tunnel", label: "com.jarvis.signalbrief-tunnel", expected_running: true },
];
const LAUNCH_AGENT_CACHE_MS = 15000;
let launchAgentCache = { at: 0, data: null };

function getLaunchAgentServiceByKey(key) {
  const normalized = String(key || "").trim().toLowerCase();
  return LAUNCH_AGENT_SERVICES.find(s => s.key === normalized) || null;
}

function parseLaunchctlList(raw) {
  const rows = new Map();
  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^PID\s+Status\s+Label$/i.test(trimmed)) continue;
    const match = trimmed.match(/^(\S+)\s+(\S+)\s+(\S+)$/);
    if (!match) continue;
    const pidRaw = match[1];
    const statusRaw = match[2];
    const label = match[3];
    const pid = pidRaw === "-" ? null : parseInt(pidRaw, 10);
    const lastExit = statusRaw === "-" ? null : parseInt(statusRaw, 10);
    rows.set(label, {
      pid: Number.isFinite(pid) ? pid : null,
      last_exit: Number.isFinite(lastExit) ? lastExit : null,
    });
  }
  return rows;
}

function getLaunchAgentHealth(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && launchAgentCache.data && (now - launchAgentCache.at) < LAUNCH_AGENT_CACHE_MS) {
    return launchAgentCache.data;
  }

  try {
    const output = execFileSync("launchctl", ["list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 1800,
    });
    const launchctlRows = parseLaunchctlList(output);

    const services = LAUNCH_AGENT_SERVICES.map(service => {
      const row = launchctlRows.get(service.label);
      if (!row) {
        return {
          key: service.key,
          label: service.label,
          expected_running: service.expected_running,
          loaded: false,
          running: false,
          ok: false,
          state: "missing",
          pid: null,
          last_exit: null,
        };
      }

      const running = Number.isInteger(row.pid) && row.pid > 0;
      const loaded = true;
      const hasErrorExit = row.last_exit != null && row.last_exit !== 0;
      let state = "loaded";
      let ok = true;

      if (service.expected_running) {
        if (running) {
          state = "running";
          ok = true;
        } else if (hasErrorExit) {
          state = "error";
          ok = false;
        } else {
          state = "stopped";
          ok = false;
        }
      } else if (running) {
        state = "running";
      } else if (hasErrorExit) {
        state = "error";
        ok = false;
      }

      return {
        key: service.key,
        label: service.label,
        expected_running: service.expected_running,
        loaded,
        running,
        ok,
        state,
        pid: row.pid,
        last_exit: row.last_exit,
      };
    });

    const total = services.length;
    const loadedCount = services.filter(s => s.loaded).length;
    const runningCount = services.filter(s => s.running).length;
    const okCount = services.filter(s => s.ok).length;
    const overall = okCount === total ? "healthy" : "degraded";
    const summary = `${runningCount}/${total} running · ${loadedCount}/${total} loaded`;

    const data = {
      available: true,
      overall,
      summary,
      checked_at: new Date().toISOString(),
      services,
    };
    launchAgentCache = { at: now, data };
    return data;
  } catch (e) {
    const err = String((e && (e.stderr || e.message)) || e || "").trim();
    const data = {
      available: false,
      overall: "unknown",
      summary: "LaunchAgent status unavailable",
      checked_at: new Date().toISOString(),
      error: err.slice(0, 180),
      services: [],
    };
    launchAgentCache = { at: now, data };
    return data;
  }
}

function restartLaunchAgent(label) {
  const attempts = [];
  const uid = (typeof process.getuid === "function" && Number.isInteger(process.getuid()))
    ? String(process.getuid())
    : "";
  const targets = uid
    ? [`gui/${uid}/${label}`, label]
    : [label];

  for (const target of targets) {
    try {
      execFileSync("launchctl", ["kickstart", "-k", target], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 3500,
      });
      return { ok: true, target, attempts };
    } catch (e) {
      const stderr = String((e && (e.stderr || e.message)) || e || "").trim();
      attempts.push({ target, error: stderr.slice(0, 220) });
    }
  }
  return { ok: false, target: null, attempts };
}

function toEtDateKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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

function renderPublicDigestPage({ dateKey, dateLabel, quickScan, items }) {
  const shareUrl = `${BASE_URL}/digest/${dateKey}`;
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
        <a class="btn btn-primary" href="https://getsignalbrief.com" target="_blank" rel="noopener">Get your own personalized brief</a>
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

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    let size = 0;
    const MAX = 1 * 1024 * 1024; // 1 MB guard against oversized payloads
    req.on("data", c => {
      size += c.length;
      if (size > MAX) { req.destroy(); resolve({}); return; }
      body += c;
    });
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
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
const PROTECTED_FIELDS = ["chatId", "token", "joined_at", "digests_received", "bookmarks", "last_digest_items", "last_digest_at", "digest_dates"];
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

function runDigestChild(digestPath, args = [], opts = {}) {
  const timeoutMs = Math.max(15_000, Number(opts.timeoutMs || (12 * 60 * 1000)));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [digestPath, ...args], {
      env: { ...process.env },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 1500);
    }, timeoutMs);
    child.stderr.on("data", c => {
      stderr += c.toString();
      if (stderr.length > 6000) stderr = stderr.slice(-6000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr });
    });
  });
}

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

  // ── API routes ──────────────────────────────────────────────────────────────

  // GET /api/topics — default topic list (flat + grouped)
  if (pathname === "/api/topics" && req.method === "GET") {
    return json(res, { topics: DEFAULT_TOPICS, industries: INDUSTRY_TOPICS, capabilities: CAPABILITY_TOPICS });
  }

  // GET /api/user?token=... — load user by token
  if (pathname === "/api/user" && req.method === "GET") {
    const token = url.searchParams.get("token");
    if (!token) return json(res, { error: "token required" }, 400);
    const user = findUserByToken(token);
    if (!user) return json(res, { error: "not found" }, 404);
    return json(res, user);
  }

  // POST /api/signup — new user onboarding
  if (pathname === "/api/signup" && req.method === "POST") {
    const body = await readBody(req);
    const { name, email, telegram, topics, depth, delivery_time, frequency, days_of_week, items_per_digest } = body;
    const emailNorm = String(email || "").toLowerCase().trim();

    if (!emailNorm || !name) return json(res, { error: "name and email required" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) return json(res, { error: "invalid email address" }, 400);
    if (!topics || topics.length < 2) return json(res, { error: "select at least 2 topics" }, 400);

    // Rate limiting
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, emailNorm);
    if (rl.limited) return json(res, { error: rl.reason }, 429);

    // Sanitize telegram: strip leading @ characters
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

    // Send welcome email (non-blocking)
    sendWelcomeEmail(user).catch(e => console.error("[welcome email]", e));

    // Spawn welcome digest in background — user gets their first briefing immediately
    const digestPath = path.join(__dirname, "../digest.js");
    const child = spawn(process.execPath, [digestPath, "--chatId", chatId], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, BASE_URL },
    });
    child.unref();
    console.log(`[welcome digest] spawned for ${chatId}`);

    return json(res, { success: true, chatId, token: user.token, archiveUrl: `${BASE_URL}/archive?token=${user.token}` });
  }

  // POST /api/settings — update existing user (token-authenticated)
  if (pathname === "/api/settings" && req.method === "POST") {
    const body = await readBody(req);
    const { token } = body;
    if (!token) return json(res, { error: "token required" }, 400);

    const existing = findUserByToken(token);
    if (!existing) return json(res, { error: "invalid token" }, 401);

    // Strip protected fields from body so they can never be overwritten
    const safeBody = Object.fromEntries(
      Object.entries(body).filter(([k]) => !PROTECTED_FIELDS.includes(k))
    );

    // Sanitize telegram if present
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

    // Sanitize + protect email uniqueness if present
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
      // Always restore protected fields from existing record
      ...Object.fromEntries(PROTECTED_FIELDS.map(k => [k, existing[k]])),
    };

    // Track unsubscription timestamp when status changes to unsubscribed
    if (updated.status === "unsubscribed" && existing.status !== "unsubscribed") {
      updated.email_unsubscribed_at = new Date().toISOString();
    }

    writeUser(existing.chatId, updated);
    return json(res, { success: true });
  }

  // GET|POST /api/unsubscribe — one-click unsubscribe (RFC 8058)
  // GET:  requires ?token=TOKEN (human-readable redirect to settings)
  // POST: accepts ?token=TOKEN or ?email=... (email client one-click per RFC 8058)
  if (pathname === "/api/unsubscribe" && (req.method === "GET" || req.method === "POST")) {
    const tokenParam = url.searchParams.get("token") || "";
    const emailParam = url.searchParams.get("email") || "";
    let existing = null;

    // GET requires token (no unauthenticated email-based unsubscribe)
    if (req.method === "GET" && !tokenParam) {
      return json(res, { error: "token required" }, 400);
    }

    if (tokenParam) {
      existing = findUserByToken(decodeURIComponent(tokenParam));
    } else if (emailParam && req.method === "POST") {
      // POST-only: email-based lookup for RFC 8058 one-click from email clients.
      // Requires HMAC signature (?sig=...) to prevent unauthenticated unsubscribes (B-3).
      const sigParam = url.searchParams.get("sig") || "";
      const targetEmail = decodeURIComponent(emailParam).toLowerCase().trim();
      if (!sigParam || sigParam !== signUnsubEmail(targetEmail)) {
        return json(res, { error: "invalid signature" }, 403);
      }
      existing = allUsers().find(u => u.email && u.email.toLowerCase() === targetEmail);
    }

    if (!tokenParam && !emailParam) return json(res, { error: "token or email required" }, 400);

    if (existing) {
      writeUser(existing.chatId, { ...existing, status: "unsubscribed", email_unsubscribed_at: new Date().toISOString() });
      console.log(`[unsubscribe] ${existing.email}`);
    }
    // Always succeed (idempotent — if user not found, silently ok)
    if (req.method === "POST") return json(res, { success: true });
    // GET: redirect to settings confirmation page on the same host that handled unsubscribe.
    // Using a relative path avoids localhost/public host bounce loops.
    const confirmUrl = existing?.token
      ? `/settings?token=${existing.token}&unsubscribed=1`
      : `/settings?unsubscribed=1`;
    res.writeHead(302, { Location: confirmUrl });
    return res.end();
  }

  // GET /api/archive?token=... — user-specific archive (filtered to dates they received)
  // Without token: returns empty (archive requires auth)
  if (pathname === "/api/archive" && req.method === "GET") {
    const token = url.searchParams.get("token");
    if (!token) return json(res, { digests: [], requiresAuth: true });

    const user = findUserByToken(token);
    if (!user) return json(res, { error: "invalid token" }, 401);

    const archiveDir = path.join(__dirname, "../archive");
    const files = readArchiveFiles(archiveDir);
    if (files.length === 0) return json(res, { digests: [] });

    const allowedDates = getAllowedArchiveDates(user, archiveDir, files);
    const digests = files.flatMap(f => {
      const dateKey = f.replace(".json", "");
      if (!allowedDates.has(dateKey)) return [];
      try {
        const d = JSON.parse(fs.readFileSync(path.join(archiveDir, f), "utf8"));
        return [{ date: d.date, dateStr: d.dateStr, quickScan: d.quickScan, itemCount: d.items?.length || 0 }];
      } catch {
        return [];
      }
    });
    return json(res, { digests });
  }

  // GET /api/archive/all?token=... — flattened archive feed for search/discovery
  if ((pathname === "/api/archive/all" || pathname === "/api/archive/all/") && req.method === "GET") {
    const token = url.searchParams.get("token");
    if (!token) return json(res, { items: [], requiresAuth: true });

    const user = findUserByToken(token);
    if (!user) return json(res, { error: "invalid token" }, 401);

    const archiveDir = path.join(__dirname, "../archive");
    const files = readArchiveFiles(archiveDir);
    if (files.length === 0) return json(res, { items: [], digestCount: 0 });

    const allowedDates = getAllowedArchiveDates(user, archiveDir, files);
    const userTopics = Array.isArray(user.topics) ? user.topics : [];
    const topicWeights = user.topic_weights || {};
    const items = [];
    let digestCount = 0;

    for (const f of files) {
      const dateKey = f.replace(".json", "");
      if (!allowedDates.has(dateKey)) continue;
      try {
        const d = JSON.parse(fs.readFileSync(path.join(archiveDir, f), "utf8"));
        digestCount++;
        const digestItems = Array.isArray(d.items) ? d.items : [];
        digestItems.forEach((item, idx) => {
          items.push({
            date: d.date || dateKey,
            dateStr: d.dateStr || dateKey,
            generatedAt: d.generatedAt || null,
            rank: idx + 1,
            tag: item?.tag || "",
            headline: item?.headline || "",
            summary: item?.summary || "",
            wim: item?.wim || null,
            implications: item?.implications || null,
            watch_next: item?.watch_next || null,
            url: item?.url || "",
            source: item?.source || "",
            baseScore: typeof item?.baseScore === "number" ? item.baseScore : null,
            relevanceScore: archiveRelevanceScore(item, userTopics, topicWeights),
          });
        });
      } catch {
        // Skip malformed files so one bad archive does not break discovery feed.
      }
    }

    items.sort((a, b) => {
      if (a.date === b.date) return (a.rank || 0) - (b.rank || 0);
      return a.date < b.date ? 1 : -1;
    });

    return json(res, { items, digestCount });
  }

  // GET /api/archive/:date?token=... — full digest for a specific date
  if (pathname.startsWith("/api/archive/") && req.method === "GET") {
    const rawDate = pathname.replace("/api/archive/", "").replace(/\/+$/, "");
    // Sanitize: only allow YYYY-MM-DD format to prevent path traversal
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return json(res, { error: "invalid date" }, 400);

    // Token auth required: verify user received this digest
    const token = url.searchParams.get("token");
    if (!token) return json(res, { error: "token required" }, 400);
    const user = findUserByToken(token);
    if (!user) return json(res, { error: "invalid token" }, 401);

    const archiveDir = path.join(__dirname, "../archive");
    const files = readArchiveFiles(archiveDir);
    const allowedDates = getAllowedArchiveDates(user, archiveDir, files);
    if (!allowedDates.has(rawDate)) return json(res, { error: "not found" }, 404);

    const file = path.join(archiveDir, `${rawDate}.json`);
    if (!fs.existsSync(file)) return json(res, { error: "not found" }, 404);
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const userTopics = Array.isArray(user.topics) ? user.topics : [];
      const topicWeights = user.topic_weights || {};
      if (Array.isArray(raw.items)) {
        raw.items = raw.items.map(item => ({
          tag: item?.tag || "",
          headline: item?.headline || "",
          summary: item?.summary || "",
          wim: item?.wim || null,
          implications: item?.implications || null,
          watch_next: item?.watch_next || null,
          url: item?.url || "",
          source: item?.source || "",
          baseScore: typeof item?.baseScore === "number" ? item.baseScore : null,
          relevanceScore: archiveRelevanceScore(item, userTopics, topicWeights),
        }));
      }
      return json(res, raw);
    } catch {
      return json(res, { error: "malformed archive file" }, 500);
    }
  }

  // GET /api/click?token=...&did=...&item=...&url=... — tracked outbound link redirect
  if (pathname === "/api/click" && req.method === "GET") {
    const rawUrl = String(url.searchParams.get("url") || "").trim();
    if (!rawUrl) return json(res, { error: "url required" }, 400);

    let target;
    try {
      target = new URL(rawUrl);
      if (!/^https?:$/i.test(target.protocol)) throw new Error("unsupported protocol");
    } catch {
      return json(res, { error: "invalid url" }, 400);
    }

    const token = String(url.searchParams.get("token") || "").trim();
    const itemIndex = Number(url.searchParams.get("item") || 0);
    const did = String(url.searchParams.get("did") || "").trim();
    const user = token ? findUserByToken(token) : null;

    if (user) {
      const fallbackDate = toEtDateKey(new Date().toISOString()) || new Date().toISOString().slice(0, 10);
      const dateKey = did ? String(did.split(":")[0]).trim() : fallbackDate;
      const digestId = did || buildDigestId(dateKey, user.chatId);
      const normalizedUrl = normalizeEngagementUrl(target.toString());
      const indexToken = Number.isFinite(itemIndex) && itemIndex > 0 ? itemIndex : "unknown";
      appendEngagementEvent({
        event_type: "item_clicked",
        event_key: `item_clicked:${digestId}:${indexToken}:${normalizedUrl}`,
        date_et: dateKey,
        user_chat_id: String(user.chatId),
        user_email: user.email || null,
        digest_id: digestId,
        channel: "email",
        source: "email-click",
        item: {
          index: Number.isFinite(itemIndex) && itemIndex > 0 ? itemIndex : null,
          url: target.toString(),
        },
      });
    }

    res.writeHead(302, {
      Location: target.toString(),
      "Cache-Control": "no-store",
    });
    return res.end();
  }

  // POST /api/bookmarks — add/remove bookmark by URL
  if ((pathname === "/api/bookmarks" || pathname === "/api/bookmarks/") && req.method === "POST") {
    const body = await readBody(req);
    const token = String(body.token || "").trim();
    const action = String(body.action || "").toLowerCase().trim();
    const item = body.item || {};
    const itemUrl = String(item.url || "").trim();

    if (!token) return json(res, { error: "token required" }, 400);
    if (action !== "add" && action !== "remove") return json(res, { error: "action must be add or remove" }, 400);
    if (!itemUrl) return json(res, { error: "item.url required" }, 400);

    const user = findUserByToken(token);
    if (!user) return json(res, { error: "invalid token" }, 401);

    const bookmarks = Array.isArray(user.bookmarks) ? user.bookmarks.slice() : [];
    const target = normalizeBookmarkUrl(itemUrl);

    if (action === "add") {
      const exists = bookmarks.some(b => normalizeBookmarkUrl(b?.url) === target);
      if (!exists) {
        const itemDate = String(item.date || "").trim();
        const digestDateKey = /^\d{4}-\d{2}-\d{2}$/.test(itemDate)
          ? itemDate
          : toEtDateKey(new Date().toISOString());
        const digestId = buildDigestId(digestDateKey, user.chatId);
        bookmarks.push({
          date: String(item.date || ""),
          headline: String(item.headline || "").trim() || itemUrl,
          url: itemUrl,
          tag: item.tag ? String(item.tag) : null,
          source: item.source ? String(item.source) : null,
          saved_at: new Date().toISOString(),
        });
        const itemIndex = Number(item.item_num || item.index || 0);
        appendEngagementEvent({
          event_type: "item_saved",
          event_key: `item_saved:${digestId}:${itemIndex > 0 ? itemIndex : normalizeBookmarkUrl(itemUrl)}`,
          date_et: digestDateKey,
          user_chat_id: String(user.chatId),
          user_email: user.email || null,
          digest_id: digestId,
          channel: "web",
          source: "web-ui",
          item: {
            index: itemIndex > 0 ? itemIndex : null,
            headline: String(item.headline || "").trim() || null,
            url: itemUrl,
            tag: item.tag ? String(item.tag) : null,
          },
          metadata: {
            action: "bookmark_add",
            from: "archive",
          },
        });
      }
      writeUser(user.chatId, {
        ...user,
        bookmarks,
        last_updated: new Date().toISOString(),
      });
      return json(res, {
        success: true,
        bookmarked: true,
        deduped: exists,
        count: bookmarks.length,
      });
    }

    const filtered = bookmarks.filter(b => normalizeBookmarkUrl(b?.url) !== target);
    const removed = filtered.length !== bookmarks.length;
    writeUser(user.chatId, {
      ...user,
      bookmarks: filtered,
      last_updated: new Date().toISOString(),
    });
    return json(res, {
      success: true,
      bookmarked: false,
      removed,
      count: filtered.length,
    });
  }

  // POST /api/request-link — send magic access link to user's email
  if (pathname === "/api/request-link" && req.method === "POST") {
    const body = await readBody(req);
    const email = String(body.email || "").toLowerCase().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(res, { error: "valid email required" }, 400);
    }
    // Always return success (don't reveal whether email exists)
    const user = allUsers().find(u => (u.email || "").toLowerCase().trim() === email);
    if (user && user.token) {
      sendMagicLinkEmail(user).catch(e => console.error("[magic link]", e));
    }
    return json(res, { success: true });
  }

  // POST /api/admin/login — authenticate admin user
  if (pathname === "/api/admin/login" && req.method === "POST") {
    const ip = getClientIp(req);
    if (checkLoginRate(ip)) return json(res, { error: "Too many attempts. Try again in 15 minutes." }, 429);

    const body = await readBody(req);
    const { email, password } = body;
    if (!email || !password) return json(res, { error: "Email and password required" }, 400);

    const adminEmail = (CONFIG.admin && CONFIG.admin.email) || "";
    if (email.toLowerCase().trim() !== adminEmail.toLowerCase() || !verifyAdminPassword(password)) {
      return json(res, { error: "Invalid credentials" }, 401);
    }

    const sessionToken = createAdminSession(email);
    const isSecure = BASE_URL.startsWith("https");
    const cookieFlags = [
      `sb_admin=${sessionToken}`,
      "HttpOnly",
      "Path=/",
      `Max-Age=${7 * 24 * 60 * 60}`,
      "SameSite=Strict",
      isSecure ? "Secure" : "",
    ].filter(Boolean).join("; ");

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Set-Cookie": cookieFlags,
    });
    return res.end(JSON.stringify({ success: true }));
  }

  // POST /api/admin/logout — clear admin session
  if (pathname === "/api/admin/logout" && req.method === "POST") {
    const cookieHeader = req.headers.cookie || "";
    const match = cookieHeader.match(/(?:^|;\s*)sb_admin=([a-f0-9]{64})/);
    if (match) ADMIN_SESSIONS.delete(match[1]);

    const isSecure = BASE_URL.startsWith("https");
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": [
        "sb_admin=deleted",
        "HttpOnly",
        "Path=/",
        "Max-Age=0",
        "SameSite=Strict",
        isSecure ? "Secure" : "",
      ].filter(Boolean).join("; "),
    });
    return res.end(JSON.stringify({ success: true }));
  }

  // GET /api/admin/check — check if current session is authenticated
  if (pathname === "/api/admin/check" && req.method === "GET") {
    return json(res, { authenticated: isAdminAuthed(req) });
  }

  // GET /api/admin/stats — cost dashboard data
  if (pathname === "/api/admin/stats" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    let ignoredBackfill = { emitted: 0, considered: 0 };
    try {
      ignoredBackfill = emitIgnoredEventsIfDue({
        window_hours: Number(CONFIG?.digest?.ignoredWindowHours || 24),
        max_age_days: 45,
      }) || ignoredBackfill;
    } catch {
      // Keep stats endpoint resilient if engagement backfill fails.
    }
    const runs = loadCostRunsNewest();

    const now = new Date();
    // Use ET date for month prefix so runs at 10 PM ET (= 3 AM UTC next day) aren't miscounted
    const monthPrefix = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
    const monthLabel  = now.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" });
    const monthRuns = runs.filter(r => String(r?.date || "").startsWith(monthPrefix));
    const sum = (arr, key) => arr.reduce((s, r) => s + (r[key] || 0), 0);
    const monthDeliveries = sum(monthRuns, "users_served");
    const monthUniqueUsersLog = new Set();
    for (const r of monthRuns) {
      for (const u of (Array.isArray(r?.per_user) ? r.per_user : [])) {
        if (u && u.id) monthUniqueUsersLog.add(String(u.id));
      }
    }
    const usersAll = allUsers();

    // Per-user rollup across all runs — divide run cost by number of users served
    const userMap = {};
    for (const r of runs) {
      const usersServed = r.users_served || 1;
      for (const u of (Array.isArray(r?.per_user) ? r.per_user : [])) {
        if (!userMap[u.id]) userMap[u.id] = { id: u.id, runs: 0, total_cost: 0 };
        userMap[u.id].runs++;
        // Attribute each user their fair share of the run cost
        userMap[u.id].total_cost += (r.total_cost_usd || 0) / usersServed;
      }
    }
    const perUser = Object.values(userMap)
      .map(u => ({ ...u, total_cost: parseFloat(u.total_cost.toFixed(5)) }))
      .sort((a, b) => b.total_cost - a.total_cost);

    // User roster for admin view
    // Convert UTC timestamps to ET dates (users signing up after 7 PM ET appear as next UTC day)
    const toETDate = iso => iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null;
    const depthLabel = d => ({ headline_only: "Scan", headline_plus_oneliner: "Brief", headline_plus_why: "Deep", full: "Deep", deep: "Deep" }[d] || "Deep");

    // Count scheduled delivery days elapsed since last_digest_at with no delivery.
    // Walks back from yesterday (excludes today — delivery may still be pending).
    const DOW_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    function calcDaysMissed(lastDigestAtIso, daysOfWeek) {
      if (!lastDigestAtIso) return 0; // never delivered — not "missed"
      const toET = iso => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const todayET  = toET(new Date().toISOString());
      const lastET   = toET(lastDigestAtIso);
      if (lastET >= todayET) return 0; // delivered today
      let missed = 0;
      const cursor = new Date();
      cursor.setDate(cursor.getDate() - 1); // start from yesterday
      for (let i = 0; i < 14; i++) {
        const curET = toET(cursor.toISOString());
        if (curET <= lastET) break;
        const dowET = DOW_NAMES.indexOf(
          cursor.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" })
        );
        if ((daysOfWeek || [1,2,3,4,5]).includes(dowET)) missed++;
        cursor.setDate(cursor.getDate() - 1);
      }
      return missed;
    }

    const roster = usersAll.map(u => {
      const prefs = u.preferences || {};
      const qualityTrend = computeQualityTrend(u.quality_history || []);
      const [dh, dm] = (prefs.delivery_time || "07:00").split(":").map(Number);
      const ampm = dh >= 12 ? "PM" : "AM";
      const hour = dh % 12 || 12;
      const min  = dm === 0 ? "" : `:${String(dm).padStart(2,"0")}`;
      const allowedDays = prefs.days_of_week || [1, 2, 3, 4, 5];
      const daysLabel = formatDaysLabel(allowedDays);
      const nextDelivery = u.status === "active" ? computeNextDeliveryEt(prefs) : null;
      const tgLinked = !!(u.chatId && !u.chatId.startsWith("email-"));
      const adminUserPath = u.email ? `/admin/user?email=${encodeURIComponent(u.email)}` : null;
      const archivePath = u.email
        ? (u.token
          ? `/archive?token=${encodeURIComponent(u.token)}&admin=1&admin_return=${encodeURIComponent(adminUserPath || "/admin")}`
          : `/archive?email=${encodeURIComponent(u.email)}&admin=1&admin_return=${encodeURIComponent(adminUserPath || "/admin")}`)
        : null;
      return {
        name:               u.name || "",
        email:              u.email || "",
        chat_id:            u.chatId || "",
        status:             u.status || "active",
        joined:             toETDate(u.joined_at),
        digests:            u.digests_received || 0,
        last_digest:        toETDate(u.last_digest_at),
        telegram:           tgLinked,
        email_enabled:      prefs.email_enabled !== false,
        telegram_enabled:   !!(prefs.telegram_enabled && tgLinked),
        topics:             (u.topics || []).length,
        topics_raw:         Array.isArray(u.topics) ? u.topics : [],
        topics_list:        (u.topics || []).map(t => t.replace(/^custom_/,"").replace(/_/g," ")).join(", ") || "—",
        bookmarks:          (u.bookmarks || []).length,
        adjustments:        Object.keys(u.topic_weights || {}).length,
        topic_weights:      u.topic_weights || {},
        last_digest_preview: (u.last_digest_items || []).slice(0, 3).map(item => ({
          headline: (item.headline || "").slice(0, 80),
          tag:      item.tag || "",
          url:      item.url || "",
        })),
        last_digest_item_count: Array.isArray(u.last_digest_items) ? u.last_digest_items.length : 0,
        days_missed:        u.status === "active" ? calcDaysMissed(u.last_digest_at, allowedDays) : 0,
        delivery_time:      `${hour}${min} ${ampm} ET`,
        delivery_time_raw:  prefs.delivery_time || "07:00",
        days_of_week:       allowedDays,
        days_label:         daysLabel,
        timezone:           prefs.timezone || "America/New_York",
        items_per_digest:   parseInt(prefs.items_per_digest, 10) || 5,
        depth:              depthLabel(prefs.depth),
        next_delivery_et:   nextDelivery?.label || "—",
        next_delivery_key:  nextDelivery?.key || null,
        settings_url:       adminUserPath ? `${BASE_URL}${adminUserPath}` : null,
        archive_url:        archivePath ? `${BASE_URL}${archivePath}` : null,
        dqs_current:        qualityTrend.current,
        dqs_7d_avg:         qualityTrend.avg_7d,
        dqs_14d_delta:      qualityTrend.delta_14d,
        dqs_floor_14d:      qualityTrend.floor_14d,
        dqs_band:           qualityTrend.band || null,
        dqs_sample_14d:     qualityTrend.sample_14d || 0,
      };
    }).sort((a, b) => (b.digests - a.digests));
    const activeUsersCount = roster.filter(u => u.status === "active").length;
    const activeTelegramUsersCount = roster.filter(u => u.status === "active" && u.telegram).length;
    const monthUsersServedFromRoster = roster.filter(u => u.last_digest && u.last_digest.startsWith(monthPrefix)).length;

    // Users whose deliveries appear to be falling behind (2+ scheduled days missed)
    const deliveryWarnings = roster
      .filter(u => u.status === "active" && u.days_missed >= 2)
      .map(u => ({ name: u.name || u.email, email: u.email, days_missed: u.days_missed }));

    // Delivery reliability snapshot (last 7 completed ET days vs previous 7)
    const activeRoster = roster.filter(u => u.status === "active");
    const activeEmailSet = new Set(
      activeRoster
        .map(u => String(u.email || "").toLowerCase().trim())
        .filter(Boolean)
    );
    const nowEt = parseEtNowParts();
    const toEtDateOffset = offset => {
      const d = new Date(Date.UTC(nowEt.year, nowEt.month - 1, nowEt.day + offset));
      return {
        dateKey: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
        dow: d.getUTCDay(),
      };
    };
    const buildWindow = (startOffset, endOffset) => {
      const rows = [];
      for (let offset = startOffset; offset <= endOffset; offset++) rows.push(toEtDateOffset(offset));
      return rows;
    };
    const currentWindow = buildWindow(-7, -1);
    const previousWindow = buildWindow(-14, -8);
    const expectedScheduledCount = (windowRows) => {
      let total = 0;
      for (const day of windowRows) {
        for (const u of activeRoster) {
          const allowedDays = Array.isArray(u.days_of_week) && u.days_of_week.length
            ? u.days_of_week.map(Number)
            : [1, 2, 3, 4, 5];
          if (allowedDays.includes(day.dow)) total++;
        }
      }
      return total;
    };
    const deliveredScheduledCount = (windowRows) => {
      const allowedDates = new Set(windowRows.map(row => row.dateKey));
      const deliveredSet = new Set();
      for (const run of runs) {
        if (run.on_demand) continue;
        const dateKey = String(run.date || "");
        if (!allowedDates.has(dateKey)) continue;
        const perUsers = Array.isArray(run.per_user) ? run.per_user : [];
        for (const pu of perUsers) {
          const uid = String((pu && pu.id) || "").toLowerCase().trim();
          if (!uid || !activeEmailSet.has(uid)) continue;
          deliveredSet.add(`${dateKey}|${uid}`);
        }
      }
      return deliveredSet.size;
    };
    const expectedCurrent7d = expectedScheduledCount(currentWindow);
    const deliveredCurrent7d = deliveredScheduledCount(currentWindow);
    const expectedPrevious7d = expectedScheduledCount(previousWindow);
    const deliveredPrevious7d = deliveredScheduledCount(previousWindow);
    const missedCurrent7d = Math.max(0, expectedCurrent7d - deliveredCurrent7d);
    const missedPrevious7d = Math.max(0, expectedPrevious7d - deliveredPrevious7d);
    const missedDelta7d = missedCurrent7d - missedPrevious7d;
    const successRate7d = expectedCurrent7d > 0
      ? Number(((deliveredCurrent7d / expectedCurrent7d) * 100).toFixed(1))
      : 100;
    const missedTrendLabel = missedDelta7d === 0
      ? "Flat vs prior 7d"
      : `${missedDelta7d > 0 ? "+" : ""}${missedDelta7d} missed vs prior 7d`;
    const lastSuccessfulScheduledRun = runs.find(r => !r.on_demand && (r.users_served || 0) > 0) || null;
    const nextExpectedActiveDelivery = activeRoster
      .filter(u => u.next_delivery_key)
      .sort((a, b) => String(a.next_delivery_key || "").localeCompare(String(b.next_delivery_key || "")))[0] || null;
    const minutesUntilEtKey = key => {
      const m = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) ET$/);
      if (!m) return null;
      const [, yy, mo, dd, hh, mm] = m;
      const nowStamp = Date.UTC(nowEt.year, nowEt.month - 1, nowEt.day, nowEt.hour, nowEt.minute);
      const targetStamp = Date.UTC(parseInt(yy, 10), parseInt(mo, 10) - 1, parseInt(dd, 10), parseInt(hh, 10), parseInt(mm, 10));
      return Math.max(0, Math.round((targetStamp - nowStamp) / 60000));
    };
    const formatCountdown = totalMinutes => {
      if (totalMinutes == null) return "—";
      const mins = Math.max(0, totalMinutes);
      const days = Math.floor(mins / 1440);
      const hours = Math.floor((mins % 1440) / 60);
      const minutes = mins % 60;
      if (days > 0) return `${days}d ${hours}h`;
      if (hours > 0) return `${hours}h ${minutes}m`;
      return `${minutes}m`;
    };
    const nextExpectedCountdownMinutes = nextExpectedActiveDelivery
      ? minutesUntilEtKey(nextExpectedActiveDelivery.next_delivery_key)
      : null;
    const serviceActionLog = readAdminServiceLog(12);
    const digestRun = digestRunStatus();

    // Health / system status
    const lastRun = runs[0] || null; // runs is newest-first
    const serverUptimeSecs = Math.floor(process.uptime());
    const uptimeHours = Math.floor(serverUptimeSecs / 3600);
    const uptimeMins  = Math.floor((serverUptimeSecs % 3600) / 60);
    const uptimeStr   = uptimeHours > 0 ? `${uptimeHours}h ${uptimeMins}m` : `${uptimeMins}m`;
    const launchAgents = getLaunchAgentHealth();
    const adminMessages = readAdminMessageLog(30).map(m => ({
      at: m.at || null,
      actor: m.actor || "unknown",
      action: m.action || "message_user",
      target_email: m.target_email || null,
      target_email_masked: maskEmail(m.target_email || ""),
      target_chat_id: m.target_chat_id || null,
      requested_channels: Array.isArray(m.requested_channels) ? m.requested_channels : [],
      sent_channels: Array.isArray(m.sent_channels) ? m.sent_channels : [],
      success: !!m.success,
      errors: Array.isArray(m.errors) ? m.errors : [],
      message_preview: m.message_preview || "",
      payload_hash: m.payload_hash || null,
    }));

    const qualityUsers = roster.filter((u) => Number.isFinite(Number(u.dqs_current)));
    const qualityCurrentAvg = qualityUsers.length
      ? Number((qualityUsers.reduce((sum, u) => sum + Number(u.dqs_current || 0), 0) / qualityUsers.length).toFixed(2))
      : null;
    const quality7dAvg = qualityUsers.length
      ? Number((qualityUsers.reduce((sum, u) => sum + Number(u.dqs_7d_avg || u.dqs_current || 0), 0) / qualityUsers.length).toFixed(2))
      : null;
    const qualityImproving14d = qualityUsers.filter((u) => Number(u.dqs_14d_delta || 0) >= 5).length;
    const qualityAtRisk = qualityUsers.filter((u) => Number(u.dqs_current || 0) < 75).length;
    const feedbackTrend = computeFeedbackTrend(usersAll);

    return json(res, {
      summary: {
        all_time_cost:      parseFloat(sum(runs, "total_cost_usd").toFixed(4)),
        all_time_runs:      runs.length,
        all_time_deliveries: sum(runs, "users_served"),
        month_cost:         parseFloat(sum(monthRuns, "total_cost_usd").toFixed(4)),
        month_runs:         monthRuns.length,
        month_on_demand:    monthRuns.filter(r => r.on_demand).length,
        month_users_served: monthUsersServedFromRoster,
        month_unique_users: monthUsersServedFromRoster,
        month_unique_users_log: monthUniqueUsersLog.size,
        month_deliveries:   monthDeliveries,
        total_users:        roster.length,
        active_users:       activeUsersCount,
        active_tg_users:    activeTelegramUsersCount,
        month_label:        monthLabel,
        quality: {
          users_scored: qualityUsers.length,
          dqs_current_avg: qualityCurrentAvg,
          dqs_7d_avg: quality7dAvg,
          improving_14d: qualityImproving14d,
          at_risk: qualityAtRisk,
        },
        feedback: feedbackTrend,
      },
      health: {
        server_uptime:            uptimeStr,
        last_run_at:              lastRun ? lastRun.run_at_et || lastRun.run_at : null,
        last_run_users:           lastRun ? lastRun.users_served : null,
        last_run_cost:            lastRun ? `$${(lastRun.total_cost_usd || 0).toFixed(4)}` : null,
        cron_schedule:            "6:45 AM ET · Mon–Sat (LaunchAgent)",
        users_delivery_warning:   deliveryWarnings,
        delivery_reliability: {
          success_rate_7d: successRate7d,
          delivered_7d: deliveredCurrent7d,
          expected_7d: expectedCurrent7d,
          missed_current_7d: missedCurrent7d,
          missed_previous_7d: missedPrevious7d,
          missed_delta_7d: missedDelta7d,
          missed_trend_label: missedTrendLabel,
          last_successful_scheduled_run: lastSuccessfulScheduledRun
            ? (lastSuccessfulScheduledRun.run_at_et || lastSuccessfulScheduledRun.run_at || null)
            : null,
          next_expected_delivery_et: nextExpectedActiveDelivery?.next_delivery_et || null,
          next_expected_countdown: formatCountdown(nextExpectedCountdownMinutes),
          next_expected_countdown_minutes: nextExpectedCountdownMinutes,
        },
        launch_agents:            launchAgents,
        launch_agent_actions:     serviceActionLog,
        digest_runner: digestRun.running
          ? {
            running: true,
            mode: digestRun.lock.mode || "scheduled",
            started_at: digestRun.lock.startedAtIso || null,
            age_seconds: Math.max(0, Math.round((digestRun.lock.ageMs || 0) / 1000)),
            pid: digestRun.lock.pid || null,
          }
          : { running: false },
        engagement_events: {
          ignored_backfill_emitted: ignoredBackfill.emitted || 0,
          ignored_backfill_considered: ignoredBackfill.considered || 0,
        },
      },
      runs: runs.slice(0, 30),
      per_user: perUser,
      roster,
      admin_messages: adminMessages,
    });
  }

  // GET /api/admin/user-by-email?email=... — admin user lookup
  if (pathname === "/api/admin/user-by-email" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const emailParam = url.searchParams.get("email");
    if (!emailParam) return json(res, { error: "email required" }, 400);
    const requestedAutoLimit = parseInt(url.searchParams.get("auto_limit"), 10);
    const autoLimit = Number.isFinite(requestedAutoLimit)
      ? Math.min(Math.max(requestedAutoLimit, 1), 20)
      : 8;
    const lookup = emailParam.toLowerCase().trim();
    const adminUser = allUsers().find(u => (u.email || "").toLowerCase().trim() === lookup);
    if (!adminUser) return json(res, { error: "not found" }, 404);
    return json(res, {
      ...adminUser,
      auto_adjustments_recent: getRecentAutoAdjustmentsForUser(adminUser, autoLimit),
    });
  }

  // GET /api/admin/audit?email=... — unified admin timeline per user
  if (pathname === "/api/admin/audit" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const email = String(url.searchParams.get("email") || "").toLowerCase().trim();
    if (!email) return json(res, { error: "email required" }, 400);
    const requestedLimit = parseInt(url.searchParams.get("limit"), 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 120) : 30;

    const actionRows = readAdminActionLog(limit * 6)
      .filter(row => String(row.target_email || "").toLowerCase().trim() === email)
      .map(row => {
        const action = String(row.action || "action");
        const details = row.details && typeof row.details === "object" ? row.details : {};
        let summary = action;
        if (action === "set_delivery_time" && details.from && details.to) {
          summary = `Delivery time ${details.from} → ${details.to}`;
        } else if (action === "bulk_pause") {
          summary = "Paused deliveries";
        } else if (action === "bulk_resume") {
          summary = "Resumed deliveries";
        } else if (action === "bulk_resend_link") {
          summary = "Resent settings link";
        } else if (action === "bulk_set_time" && details.to) {
          summary = `Set delivery time to ${details.to}`;
        } else if (action === "run_digest_targeted") {
          summary = row.success ? "Triggered digest run" : "Digest run failed";
        }
        return {
          at: row.at || null,
          actor: row.actor || "unknown",
          type: "action",
          action,
          success: row.success !== false,
          summary,
          details,
        };
      });

    const messageRows = readAdminMessageLog(limit * 6)
      .filter(row => String(row.target_email || "").toLowerCase().trim() === email)
      .map(row => ({
        at: row.at || null,
        actor: row.actor || "unknown",
        type: "message",
        action: "message_user",
        success: !!row.success,
        summary: row.success
          ? `Message sent via ${(row.sent_channels || []).join(" + ") || "channel"}`
          : `Message failed: ${(row.errors || []).join(" | ") || "unknown error"}`,
        details: {
          requested_channels: Array.isArray(row.requested_channels) ? row.requested_channels : [],
          sent_channels: Array.isArray(row.sent_channels) ? row.sent_channels : [],
          errors: Array.isArray(row.errors) ? row.errors : [],
          message_preview: row.message_preview || "",
        },
      }));

    const entries = [...actionRows, ...messageRows]
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
      .slice(0, limit);
    return json(res, { entries });
  }

  // POST /api/admin/bulk-action — dry-run + apply safe admin bulk ops
  if (pathname === "/api/admin/bulk-action" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await readBody(req);
    const action = String(body.action || "").toLowerCase().trim();
    const dryRun = body.dry_run !== false;
    const emailsRaw = Array.isArray(body.emails) ? body.emails : [];
    const uniqueEmails = [...new Set(
      emailsRaw
        .map(v => String(v || "").toLowerCase().trim())
        .filter(Boolean)
    )].slice(0, 200);

    if (!uniqueEmails.length) return json(res, { error: "at least one email required" }, 400);
    const allowedActions = new Set(["set_time", "pause", "resume", "resend_link"]);
    if (!allowedActions.has(action)) return json(res, { error: "unsupported bulk action" }, 400);

    let normalizedTime = null;
    if (action === "set_time") {
      normalizedTime = normalizeDeliveryTimeInput(body.delivery_time);
      if (!normalizedTime) return json(res, { error: "invalid delivery_time" }, 400);
    }

    const usersByEmail = new Map(
      allUsers()
        .filter(u => u.email)
        .map(u => [String(u.email).toLowerCase().trim(), u])
    );

    const planned = [];
    const skipped = [];
    for (const email of uniqueEmails) {
      const user = usersByEmail.get(email);
      if (!user) {
        skipped.push({ email, reason: "user not found" });
        continue;
      }
      if (action === "set_time") {
        const from = String((user.preferences || {}).delivery_time || "07:00");
        if (from === normalizedTime) {
          skipped.push({ email, reason: "delivery time unchanged" });
          continue;
        }
        planned.push({ email, user, kind: "bulk_set_time", from, to: normalizedTime });
        continue;
      }
      if (action === "pause") {
        const from = String(user.status || "active");
        if (from === "paused") {
          skipped.push({ email, reason: "already paused" });
          continue;
        }
        planned.push({ email, user, kind: "bulk_pause", from, to: "paused" });
        continue;
      }
      if (action === "resume") {
        const from = String(user.status || "active");
        if (from === "active") {
          skipped.push({ email, reason: "already active" });
          continue;
        }
        planned.push({ email, user, kind: "bulk_resume", from, to: "active" });
        continue;
      }
      if (action === "resend_link") {
        if (!user.token) {
          skipped.push({ email, reason: "missing user token" });
          continue;
        }
        planned.push({ email, user, kind: "bulk_resend_link" });
      }
    }

    const affected = planned.map(item => ({
      email: item.email,
      name: item.user.name || item.user.email || item.user.chatId || "",
      action: item.kind,
      from: item.from || null,
      to: item.to || null,
      status: "planned",
    }));

    if (dryRun) {
      return json(res, {
        success: true,
        dry_run: true,
        action,
        requested: uniqueEmails.length,
        applicable: planned.length,
        skipped,
        affected,
      });
    }

    const applied = [];
    for (const item of planned) {
      try {
        if (item.kind === "bulk_set_time") {
          const updated = {
            ...item.user,
            preferences: {
              ...(item.user.preferences || {}),
              delivery_time: item.to,
            },
            last_updated: new Date().toISOString(),
          };
          writeUser(item.user.chatId, updated);
        } else if (item.kind === "bulk_pause" || item.kind === "bulk_resume") {
          const updated = {
            ...item.user,
            status: item.to,
            last_updated: new Date().toISOString(),
          };
          writeUser(item.user.chatId, updated);
        } else if (item.kind === "bulk_resend_link") {
          await sendMagicLinkEmail(item.user);
        }
        logAdminActionEvent(req, {
          action: item.kind,
          target_email: item.email,
          success: true,
          details: { from: item.from || null, to: item.to || null },
        });
        applied.push({ ...item, status: "applied" });
      } catch (e) {
        const reason = e.message || "failed";
        skipped.push({ email: item.email, reason });
        logAdminActionEvent(req, {
          action: item.kind,
          target_email: item.email,
          success: false,
          details: { reason, from: item.from || null, to: item.to || null },
        });
      }
    }

    return json(res, {
      success: true,
      dry_run: false,
      action,
      requested: uniqueEmails.length,
      applicable: planned.length,
      applied: applied.length,
      skipped,
      affected: applied.map(item => ({
        email: item.email,
        name: item.user.name || item.user.email || item.user.chatId || "",
        action: item.kind,
        from: item.from || null,
        to: item.to || null,
        status: "applied",
      })),
    });
  }

  // POST /api/admin/launch-agent-action — safe service controls (restart only)
  if (pathname === "/api/admin/launch-agent-action" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await readBody(req);
    const key = String(body.key || "").toLowerCase().trim();
    const action = String(body.action || "restart").toLowerCase().trim();
    if (action !== "restart") return json(res, { error: "unsupported service action" }, 400);
    const service = getLaunchAgentServiceByKey(key);
    if (!service) return json(res, { error: "unknown service key" }, 400);

    const restart = restartLaunchAgent(service.label);
    const latestHealth = getLaunchAgentHealth(true);
    const latestService = (latestHealth.services || []).find(s => s.key === service.key) || null;
    const serviceLogEntry = {
      at: new Date().toISOString(),
      actor: getAdminActor(req),
      action: "restart",
      service_key: service.key,
      label: service.label,
      success: !!restart.ok,
      attempts: restart.attempts || [],
      state_after: latestService?.state || null,
    };
    appendAdminServiceLog(serviceLogEntry);
    logAdminActionEvent(req, {
      action: "launch_agent_restart",
      target_service: service.key,
      success: !!restart.ok,
      details: {
        attempts: restart.attempts || [],
        state_after: latestService?.state || null,
      },
    });

    return json(res, {
      success: !!restart.ok,
      service: latestService || {
        key: service.key,
        label: service.label,
        state: "unknown",
      },
      launch_agents: latestHealth,
      launch_agent_actions: readAdminServiceLog(12),
      error: restart.ok
        ? null
        : ((restart.attempts && restart.attempts[restart.attempts.length - 1] && restart.attempts[restart.attempts.length - 1].error) || "restart failed"),
    }, restart.ok ? 200 : 500);
  }

  // POST /api/admin/update-delivery-time — admin inline schedule editor
  if (pathname === "/api/admin/update-delivery-time" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);

    const body = await readBody(req);
    const email = String(body.email || "").toLowerCase().trim();
    const deliveryTime = normalizeDeliveryTimeInput(body.delivery_time);

    if (!email) return json(res, { error: "email required" }, 400);
    if (!deliveryTime) {
      return json(res, { error: "invalid delivery time (use HH:MM or H:MM AM/PM)" }, 400);
    }

    const user = allUsers().find(u => (u.email || "").toLowerCase().trim() === email);
    if (!user) return json(res, { error: "user not found" }, 404);
    const previousDeliveryTime = String((user.preferences || {}).delivery_time || "07:00");

    const [h, m] = deliveryTime.split(":").map(Number);
    const updated = {
      ...user,
      preferences: {
        ...(user.preferences || {}),
        delivery_time: deliveryTime,
      },
      last_updated: new Date().toISOString(),
    };

    writeUser(user.chatId, updated);
    logAdminActionEvent(req, {
      action: "set_delivery_time",
      target_email: email,
      success: true,
      details: {
        from: previousDeliveryTime,
        to: deliveryTime,
      },
    });
    return json(res, {
      success: true,
      email,
      delivery_time: deliveryTime,
      delivery_time_label: formatTimeEt(h, m),
    });
  }

  // POST /api/admin/run-digest — trigger a digest run
  if (pathname === "/api/admin/run-digest" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await readBody(req);
    const digestPath = path.join(__dirname, "../digest.js");
    const targetChatId = body.chatId ? String(body.chatId).trim() : "";
    const digestLock = digestRunStatus();
    const lockMsg = digestLock.running
      ? `Digest run already in progress (${digestLock.lock.mode || "scheduled"}, started ${digestLock.lock.startedAtIso || "recently"}).`
      : "";

    // Targeted admin sends are awaited so UI only reports success on real delivery.
    if (targetChatId) {
      if (digestLock.running) {
        logAdminActionEvent(req, {
          action: "run_digest_targeted",
          target_chat_id: targetChatId,
          success: false,
          details: { reason: "digest lock active", mode: digestLock.lock.mode || "scheduled" },
        });
        return json(res, { error: lockMsg }, 409);
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
        const run = await runDigestChild(digestPath, ["--chatId", targetChatId, "--suppressWelcome"], {
          timeoutMs: 12 * 60 * 1000,
        });
        if (run.code === 4) {
          const detail = run.stderr ? run.stderr.slice(-260) : "digest run lock active";
          logAdminActionEvent(req, {
            action: "run_digest_targeted",
            target_email: targetUser.email || null,
            target_chat_id: targetChatId,
            success: false,
            details: { detail, reason: "digest lock active" },
          });
          return json(res, { error: "Digest run already in progress. Try again shortly.", detail }, 409);
        }
        if (run.code !== 0) {
          const detail = run.stderr ? run.stderr.slice(-240) : `exit ${run.code}`;
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
        details: { reason: "digest lock active", mode: digestLock.lock.mode || "scheduled" },
      });
      return json(res, { error: lockMsg }, 409);
    }

    const child = spawn(process.execPath, [digestPath, "--suppressWelcome"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();
    logAdminActionEvent(req, {
      action: "run_digest_full",
      success: true,
    });
    return json(res, { success: true, message: "Full scheduled digest run triggered" });
  }

  // POST /api/admin/message-user — send custom admin message via configured channels
  // Accept trailing slash variant for proxy/canonicalization compatibility.
  if ((pathname === "/api/admin/message-user" || pathname === "/api/admin/message-user/") && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await readBody(req);
    const email = String(body.email || "").toLowerCase().trim();
    const message = String(body.message || "").trim();
    const subject = String(body.subject || "Message from SignalBrief").trim().slice(0, 140) || "Message from SignalBrief";
    const channels = Array.isArray(body.channels)
      ? body.channels.map(c => String(c).toLowerCase().trim()).filter(Boolean)
      : [];
    const messagePreview = summarizeMessage(message);
    const payloadHash = hashText(message);
    const writeAudit = (extra = {}) => {
      logAdminMessageEvent(req, {
        action: "message_user",
        target_email: email || null,
        target_chat_id: extra.target_chat_id || null,
        requested_channels: channels,
        sent_channels: Array.isArray(extra.sent_channels) ? extra.sent_channels : [],
        subject,
        message_length: message.length,
        message_preview: messagePreview,
        payload_hash: payloadHash,
        success: !!extra.success,
        errors: Array.isArray(extra.errors) ? extra.errors : [],
      });
    };

    if (!email) {
      writeAudit({ success: false, errors: ["email required"] });
      return json(res, { error: "email required" }, 400);
    }
    if (message.length < 2) {
      writeAudit({ success: false, errors: ["message too short"] });
      return json(res, { error: "message too short" }, 400);
    }
    if (message.length > 4000) {
      writeAudit({ success: false, errors: ["message too long (max 4000 chars)"] });
      return json(res, { error: "message too long (max 4000 chars)" }, 400);
    }
    if (!channels.length) {
      writeAudit({ success: false, errors: ["select at least one channel"] });
      return json(res, { error: "select at least one channel" }, 400);
    }

    const user = allUsers().find(u => (u.email || "").toLowerCase().trim() === email);
    if (!user) {
      writeAudit({ success: false, errors: ["user not found"] });
      return json(res, { error: "user not found" }, 404);
    }

    const prefs = user.preferences || {};
    const emailReady = !!user.email && prefs.email_enabled !== false;
    const tgReady = !!(user.chatId && !String(user.chatId).startsWith("email-") && prefs.telegram_enabled !== false);
    const wantsEmail = channels.includes("email");
    const wantsTelegram = channels.includes("telegram");

    const sent = { email: false, telegram: false };
    const errors = [];

    if (wantsEmail) {
      if (!emailReady) {
        errors.push("email channel not available for this user");
      } else {
        try {
          const html = `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:28px 22px;color:#111;">
              <div style="font-size:21px;font-weight:700;margin-bottom:12px;">☀️ SignalBrief</div>
              <div style="font-size:14px;color:#6B7280;margin-bottom:14px;">Message from the SignalBrief team</div>
              <div style="font-size:15px;line-height:1.65;color:#1F2937;white-space:pre-wrap;">${escapeHtml(message)}</div>
            </div>`;
          await sendEmail(user.email, subject, html, user.token || null);
          sent.email = true;
        } catch (e) {
          errors.push(`email failed: ${e.message}`);
        }
      }
    }

    if (wantsTelegram) {
      if (!tgReady) {
        errors.push("telegram channel not available for this user");
      } else {
        try {
          await sendTelegramText(user.chatId, `📣 SignalBrief update\n\n${message}`);
          sent.telegram = true;
        } catch (e) {
          errors.push(`telegram failed: ${e.message}`);
        }
      }
    }

    if (!sent.email && !sent.telegram) {
      writeAudit({
        target_chat_id: user.chatId || null,
        sent_channels: [],
        success: false,
        errors,
      });
      return json(res, { error: errors.join(" | ") || "no channels succeeded" }, 400);
    }

    writeAudit({
      target_chat_id: user.chatId || null,
      sent_channels: [
        sent.email ? "email" : null,
        sent.telegram ? "telegram" : null,
      ].filter(Boolean),
      success: true,
      errors,
    });

    return json(res, {
      success: true,
      sent,
      warnings: errors,
      message: `Sent via ${[
        sent.email ? "email" : null,
        sent.telegram ? "telegram" : null,
      ].filter(Boolean).join(" + ")}`,
    });
  }

  // GET /digest(/:date) — public shareable digest page
  if (req.method === "GET" && (pathname === "/digest" || /^\/digest\/\d{4}-\d{2}-\d{2}\/?$/.test(pathname))) {
    const archiveDir = path.join(__dirname, "../archive");
    const files = readArchiveFiles(archiveDir);
    let dateKey = null;
    const datedMatch = pathname.match(/^\/digest\/(\d{4}-\d{2}-\d{2})\/?$/);
    if (datedMatch) dateKey = datedMatch[1];
    else if (files.length > 0) dateKey = String(files[0] || "").replace(".json", "");

    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPublicDigestMissingPage(dateKey));
    }

    const archivePath = path.join(archiveDir, `${dateKey}.json`);
    if (!fs.existsSync(archivePath)) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPublicDigestMissingPage(dateKey));
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(archivePath, "utf8"));
      const dateLabel = String(parsed?.dateStr || "").trim() || formatPublicDigestDateLabel(dateKey);
      const html = renderPublicDigestPage({
        dateKey,
        dateLabel,
        quickScan: parsed?.quickScan || "",
        items: Array.isArray(parsed?.items) ? parsed.items : [],
      });
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      });
      return res.end(html);
    } catch {
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPublicDigestMissingPage(dateKey));
    }
  }

  // ── Static files ────────────────────────────────────────────────────────────

  if (pathname === "/" || pathname === "/index.html") {
    return serveFile(res, path.join(WEB_DIR, "index.html"));
  }
  if (pathname === "/settings" || pathname === "/settings.html") {
    return serveFile(res, path.join(WEB_DIR, "settings.html"));
  }
  if (pathname === "/archive" || pathname === "/archive.html") {
    return serveFile(res, path.join(WEB_DIR, "archive.html"));
  }
  if (pathname === "/admin/login") {
    return serveFile(res, path.join(WEB_DIR, "admin-login.html"));
  }
  if (pathname === "/admin" || pathname === "/admin.html") {
    return serveFile(res, path.join(WEB_DIR, "admin.html"));
  }
  if (pathname === "/admin/user") {
    return serveFile(res, path.join(WEB_DIR, "admin-user.html"));
  }
  if (pathname === "/robots.txt") return serveFile(res, path.join(WEB_DIR, "robots.txt"));
  if (pathname === "/sitemap.xml") return serveFile(res, path.join(WEB_DIR, "sitemap.xml"));
  if (pathname === "/style.css") return serveFile(res, path.join(WEB_DIR, "style.css"));
  if (pathname === "/app.js") return serveFile(res, path.join(WEB_DIR, "app.js"));
  if (pathname === "/settings.js") return serveFile(res, path.join(WEB_DIR, "settings.js"));

  res.writeHead(404); res.end("Not found");
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
