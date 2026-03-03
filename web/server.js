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
const { spawn } = require("child_process");
const { readUser, writeUser, allUsers, generateToken, findUserByToken } = require("../store");
const { sendEmail, sendWelcomeEmail, signUnsubEmail } = require("../mailer");

const PORT = parseInt(process.env.PORT, 10) || 3003;
const WEB_DIR = __dirname;
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "../config.json"), "utf8"));

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
const TEST_DIGEST_STATUS = {
  state: "idle", // idle | running | success | failed
  job_id: null,
  target_chat_id: null,
  started_at: null,
  finished_at: null,
  message: null,
};

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

function appendAdminMessageLog(entry) {
  try {
    const dir = path.dirname(ADMIN_MESSAGE_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(ADMIN_MESSAGE_LOG, JSON.stringify(entry) + "\n");
  } catch (e) {
    console.error("[admin-message-log]", e.message);
  }
}

function readAdminMessageLog(limit = 30) {
  if (!fs.existsSync(ADMIN_MESSAGE_LOG)) return [];
  const rows = fs.readFileSync(ADMIN_MESSAGE_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean)
    .reverse();
  return rows.slice(0, limit);
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

function resolveAdminTestChatId() {
  const explicit = process.env.ADMIN_TEST_CHAT_ID || CONFIG.admin?.testChatId || CONFIG.admin?.test_chat_id;
  if (explicit) return String(explicit);
  const adminEmail = (CONFIG.admin?.email || "").toLowerCase().trim();
  if (!adminEmail) return null;
  const match = allUsers().find(u => (u.email || "").toLowerCase().trim() === adminEmail);
  if (!match?.chatId) return null;
  if (String(match.chatId).startsWith("email-")) return null; // not linked to Telegram
  return String(match.chatId);
}

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
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
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
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

const server = http.createServer(async (req, res) => {
 try {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

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

    // Check existing
    const existing = allUsers().find(u => (u.email || "").toLowerCase().trim() === emailNorm);
    const chatId = existing?.chatId || `email-${Date.now()}`;

    const user = {
      ...(existing || {}),
      chatId,
      name,
      email: emailNorm,
      telegram: telegramClean || null,
      topics,
      status: "active",
      token: existing?.token || generateToken(),
      joined_at: existing?.joined_at || new Date().toISOString(),
      last_updated: new Date().toISOString(),
      digests_received: existing?.digests_received || 0,
      bookmarks: existing?.bookmarks || [],
      topic_weights: existing?.topic_weights || {},
      custom_topics: topics.filter(t => !DEFAULT_TOPICS.includes(t)),
      digest_dates: existing?.digest_dates || [],
      last_digest_items: existing?.last_digest_items || [],
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
    if (!fs.existsSync(archiveDir)) return json(res, { digests: [] });

    const files = fs.readdirSync(archiveDir)
      .filter(f => f.endsWith(".json"))
      .sort()
      .reverse(); // newest first
    let allowedList = Array.isArray(user.digest_dates) ? user.digest_dates.slice() : [];

    // Legacy backfill: older users may have digests_received ahead of digest_dates.
    if ((user.digests_received || 0) > allowedList.length) {
      const toETDate = iso => iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null;
      const joinedET = toETDate(user.joined_at);
      const inferred = files
        .map(f => f.replace(".json", ""))
        .filter(d => (!joinedET || d >= joinedET));
      const merged = [...new Set([...allowedList, ...inferred])].sort();
      if (merged.length > allowedList.length) {
        allowedList = merged;
        writeUser(user.chatId, { ...user, digest_dates: merged, last_updated: new Date().toISOString() });
      }
    }
    const allowedDates = new Set(allowedList);

    const digests = files.flatMap(f => {
      const dateKey = f.replace(".json", "");
      if (!allowedDates.has(dateKey)) return [];
      try {
        const d = JSON.parse(fs.readFileSync(path.join(archiveDir, f), "utf8"));
        return [{ date: d.date, dateStr: d.dateStr, quickScan: d.quickScan, itemCount: d.items?.length || 0 }];
      } catch { return []; }
    });
    return json(res, { digests });
  }

  // GET /api/archive/:date?token=... — full digest for a specific date
  if (pathname.startsWith("/api/archive/") && req.method === "GET") {
    const rawDate = pathname.replace("/api/archive/", "");
    // Sanitize: only allow YYYY-MM-DD format to prevent path traversal
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return json(res, { error: "invalid date" }, 400);

    // Token auth required: verify user received this digest
    const token = url.searchParams.get("token");
    if (!token) return json(res, { error: "token required" }, 400);
    const user = findUserByToken(token);
    if (!user) return json(res, { error: "invalid token" }, 401);
    if (!(user.digest_dates || []).includes(rawDate)) return json(res, { error: "not found" }, 404);

    const file = path.join(__dirname, "../archive", `${rawDate}.json`);
    if (!fs.existsSync(file)) return json(res, { error: "not found" }, 404);
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
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
        }));
      }
      return json(res, raw);
    } catch {
      return json(res, { error: "malformed archive file" }, 500);
    }
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
    const logPath = path.join(__dirname, "../data/cost-log.json");
    let runs = [];
    if (fs.existsSync(logPath)) {
      runs = fs.readFileSync(logPath, "utf8")
        .split("\n").filter(Boolean)
        .map(line => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean)
        .reverse(); // newest first
    }

    const now = new Date();
    // Use ET date for month prefix so runs at 10 PM ET (= 3 AM UTC next day) aren't miscounted
    const monthPrefix = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
    const monthLabel  = now.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" });
    const monthRuns = runs.filter(r => r.date.startsWith(monthPrefix));
    const sum = (arr, key) => arr.reduce((s, r) => s + (r[key] || 0), 0);
    const monthDeliveries = sum(monthRuns, "users_served");
    const monthUniqueUsersLog = new Set();
    for (const r of monthRuns) {
      for (const u of (r.per_user || [])) {
        if (u && u.id) monthUniqueUsersLog.add(String(u.id));
      }
    }

    // Per-user rollup across all runs — divide run cost by number of users served
    const userMap = {};
    for (const r of runs) {
      const usersServed = r.users_served || 1;
      for (const u of (r.per_user || [])) {
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

    const roster = allUsers().map(u => {
      const prefs = u.preferences || {};
      const [dh, dm] = (prefs.delivery_time || "07:00").split(":").map(Number);
      const ampm = dh >= 12 ? "PM" : "AM";
      const hour = dh % 12 || 12;
      const min  = dm === 0 ? "" : `:${String(dm).padStart(2,"0")}`;
      const allowedDays = prefs.days_of_week || [1, 2, 3, 4, 5];
      const daysLabel = formatDaysLabel(allowedDays);
      const nextDelivery = u.status === "active" ? computeNextDeliveryEt(prefs) : null;
      const tgLinked = !!(u.chatId && !u.chatId.startsWith("email-"));
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
        topics_list:        (u.topics || []).map(t => t.replace(/^custom_/,"").replace(/_/g," ")).join(", ") || "—",
        bookmarks:          (u.bookmarks || []).length,
        adjustments:        Object.keys(u.topic_weights || {}).length,
        topic_weights:      u.topic_weights || {},
        last_digest_preview: (u.last_digest_items || []).slice(0, 3).map(item => ({
          headline: (item.headline || "").slice(0, 80),
          tag:      item.tag || "",
          url:      item.url || "",
        })),
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
        settings_url:       u.email ? `${BASE_URL}/admin/user?email=${encodeURIComponent(u.email)}` : null,
      };
    }).sort((a, b) => (b.digests - a.digests));
    const activeUsersCount = roster.filter(u => u.status === "active").length;
    const activeTelegramUsersCount = roster.filter(u => u.status === "active" && u.telegram).length;
    const monthUsersServedFromRoster = roster.filter(u => u.last_digest && u.last_digest.startsWith(monthPrefix)).length;

    // Users whose deliveries appear to be falling behind (2+ scheduled days missed)
    const deliveryWarnings = roster
      .filter(u => u.status === "active" && u.days_missed >= 2)
      .map(u => ({ name: u.name || u.email, email: u.email, days_missed: u.days_missed }));

    // Health / system status
    const lastRun = runs[0] || null; // runs is newest-first
    const serverUptimeSecs = Math.floor(process.uptime());
    const uptimeHours = Math.floor(serverUptimeSecs / 3600);
    const uptimeMins  = Math.floor((serverUptimeSecs % 3600) / 60);
    const uptimeStr   = uptimeHours > 0 ? `${uptimeHours}h ${uptimeMins}m` : `${uptimeMins}m`;
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
      },
      health: {
        server_uptime:            uptimeStr,
        last_run_at:              lastRun ? lastRun.run_at_et || lastRun.run_at : null,
        last_run_users:           lastRun ? lastRun.users_served : null,
        last_run_cost:            lastRun ? `$${(lastRun.total_cost_usd || 0).toFixed(4)}` : null,
        cron_schedule:            "6:45 AM ET · Mon–Sat (LaunchAgent)",
        users_delivery_warning:   deliveryWarnings,
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
    const lookup = emailParam.toLowerCase().trim();
    const adminUser = allUsers().find(u => (u.email || "").toLowerCase().trim() === lookup);
    if (!adminUser) return json(res, { error: "not found" }, 404);
    return json(res, adminUser);
  }

  // GET /api/admin/test-digest-status — status for "Send test digest" job
  if (pathname === "/api/admin/test-digest-status" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    return json(res, {
      ...TEST_DIGEST_STATUS,
      admin_email: CONFIG.admin?.email || null,
      resolved_chat_id: resolveAdminTestChatId(),
    });
  }

  // POST/GET /api/admin/run-test-digest — trigger digest for admin account with job status tracking
  if (pathname === "/api/admin/run-test-digest" && (req.method === "POST" || req.method === "GET")) {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    if (TEST_DIGEST_STATUS.state === "running") {
      return json(res, { error: "Test digest already running", status: TEST_DIGEST_STATUS }, 409);
    }

    const digestPath = path.join(__dirname, "../digest.js");
    const targetChatId = resolveAdminTestChatId();
    if (!targetChatId) {
      return json(res, {
        error: "No admin Telegram chat ID found. Link your admin email to Telegram with /start email@... or set ADMIN_TEST_CHAT_ID.",
      }, 400);
    }

    const jobId = crypto.randomBytes(8).toString("hex");
    TEST_DIGEST_STATUS.state = "running";
    TEST_DIGEST_STATUS.job_id = jobId;
    TEST_DIGEST_STATUS.target_chat_id = targetChatId;
    TEST_DIGEST_STATUS.started_at = new Date().toISOString();
    TEST_DIGEST_STATUS.finished_at = null;
    TEST_DIGEST_STATUS.message = "Digest run in progress";

    const child = spawn(process.execPath, [digestPath, "--chatId", targetChatId, "--suppressWelcome"], {
      env: { ...process.env },
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", c => {
      stderr += c.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    child.on("error", err => {
      TEST_DIGEST_STATUS.state = "failed";
      TEST_DIGEST_STATUS.finished_at = new Date().toISOString();
      TEST_DIGEST_STATUS.message = `Failed to start: ${err.message}`;
    });

    child.on("close", code => {
      TEST_DIGEST_STATUS.state = code === 0 ? "success" : "failed";
      TEST_DIGEST_STATUS.finished_at = new Date().toISOString();
      TEST_DIGEST_STATUS.message = code === 0
        ? "Digest sent successfully"
        : `Digest process exited with code ${code}${stderr ? ` — ${stderr.slice(-240)}` : ""}`;
    });

    return json(res, { success: true, status: TEST_DIGEST_STATUS });
  }

  // POST /api/admin/run-digest — trigger a digest run
  if (pathname === "/api/admin/run-digest" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await readBody(req);
    const digestPath = path.join(__dirname, "../digest.js");
    const targetChatId = body.chatId ? String(body.chatId).trim() : "";

    // Targeted admin sends are awaited so UI only reports success on real delivery.
    if (targetChatId) {
      const targetUser = allUsers().find(u => String(u.chatId || "").trim() === targetChatId);
      if (!targetUser) return json(res, { error: `No user found for chatId ${targetChatId}` }, 404);
      if ((targetUser.status || "active") !== "active") {
        return json(res, { error: `User is ${targetUser.status}; re-activate before sending.` }, 400);
      }
      const prefs = targetUser.preferences || {};
      const emailReady = !!targetUser.email && prefs.email_enabled !== false;
      const tgReady = !!(targetUser.chatId && !String(targetUser.chatId).startsWith("email-") && prefs.telegram_enabled !== false);
      if (!emailReady && !tgReady) {
        return json(res, { error: "No enabled delivery channels for this user." }, 400);
      }

      try {
        const run = await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [digestPath, "--chatId", targetChatId, "--suppressWelcome"], {
            env: { ...process.env },
            stdio: ["ignore", "ignore", "pipe"],
          });
          let stderr = "";
          child.stderr.on("data", c => {
            stderr += c.toString();
            if (stderr.length > 4000) stderr = stderr.slice(-4000);
          });
          child.on("error", reject);
          child.on("close", code => resolve({ code, stderr }));
        });
        if (run.code !== 0) {
          const detail = run.stderr ? run.stderr.slice(-240) : `exit ${run.code}`;
          return json(res, { error: `Digest failed for ${targetChatId}`, detail }, 500);
        }
        return json(res, {
          success: true,
          message: `Digest sent to ${targetUser.email || targetChatId}`,
        });
      } catch (e) {
        return json(res, { error: `Failed to run digest: ${e.message}` }, 500);
      }
    }

    const child = spawn(process.execPath, [digestPath, "--suppressWelcome"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();
    return json(res, { success: true, message: "Full scheduled digest run triggered" });
  }

  // POST /api/admin/message-user — send custom admin message via configured channels
  if (pathname === "/api/admin/message-user" && req.method === "POST") {
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
