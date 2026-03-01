#!/usr/bin/env node
/**
 * SignalBrief Web — server.js
 * Serves onboarding + settings UI, proxies store reads/writes.
 * Port 3003
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { generateToken } = require("../store");
const { sendEmail } = require("../mailer");
const { readUser, writeUser, allUsers } = require("../store");

// ── Token auth helper ─────────────────────────────────────────────────────────
function findUserByToken(token) {
  if (!token) return null;
  return allUsers().find(u => u.token === token) || null;
}

const PORT = 3003;
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

const WELCOME_TEMPLATE = fs.readFileSync(path.join(__dirname, "../templates/welcome.html"), "utf8");
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

async function sendWelcomeEmail(user) {
  const { name, email } = user;
  const prefs = user.preferences || {};
  const settingsUrl = `${BASE_URL}/settings?token=${user.token}`;
  const archiveUrl  = `${BASE_URL}/archive?token=${user.token}`;
  const firstName = (name || "there").split(" ")[0];

  // Format delivery time: "06:45" → "6:45 AM"
  const [hRaw, mRaw] = (prefs.delivery_time || "07:00").split(":").map(Number);
  const ampm = hRaw >= 12 ? "PM" : "AM";
  const hour = hRaw % 12 || 12;
  const timeLabel = `${hour}:${String(mRaw).padStart(2, "0")} ${ampm} ET`;

  // Format days of week
  const days = prefs.days_of_week || [1, 2, 3, 4, 5];
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let daysLabel;
  if (days.length === 7) daysLabel = "Every day";
  else if (days.length === 6 && days.includes(6)) daysLabel = "Mon–Sat";
  else if (days.length === 5 && !days.includes(0) && !days.includes(6)) daysLabel = "Mon–Fri";
  else daysLabel = days.map(d => DAY_NAMES[d]).join(", ");

  // Format depth
  const DEPTH_LABELS = {
    headline_only:         "Scan (headlines only)",
    scan:                  "Scan (headlines only)",
    headline_plus_oneliner:"Brief (headline + one-liner)",
    headline_plus_why:     "Brief (headline + why it matters)",
    deep:                  "Deep (extended analysis)",
  };
  const depthLabel = DEPTH_LABELS[prefs.depth] || "Brief (headline + why it matters)";

  // Format topics as inline chips
  const topics = user.topics || [];
  const topicsHtml = topics.map(t => {
    if (t.startsWith("custom_")) {
      const label = "Custom: " + t.replace(/^custom_/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      return `<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.05em;color:#7C3AED;background:#F5F3FF;padding:3px 10px;border-radius:4px;margin:0 5px 6px 0;">${label}</span>`;
    }
    return `<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.05em;color:#2563EB;background:#EFF6FF;padding:3px 10px;border-radius:4px;margin:0 5px 6px 0;">${t}</span>`;
  }).join("");

  const html = WELCOME_TEMPLATE
    .replace(/\{\{NAME\}\}/g, firstName)
    .replace(/\{\{TOPICS_HTML\}\}/g, topicsHtml)
    .replace(/\{\{TOPIC_COUNT\}\}/g, String(topics.length))
    .replace(/\{\{DELIVERY_TIME_LABEL\}\}/g, timeLabel)
    .replace(/\{\{DELIVERY_DAYS_LABEL\}\}/g, daysLabel)
    .replace(/\{\{DEPTH_LABEL\}\}/g, depthLabel)
    .replace(/\{\{ITEMS_COUNT\}\}/g, String(prefs.items_per_digest || 5))
    .replace(/\{\{SETTINGS_URL\}\}/g, settingsUrl)
    .replace(/\{\{ARCHIVE_URL\}\}/g, archiveUrl)
    .replace(/\{\{USER_EMAIL\}\}/g, email); // raw email for /start command in Telegram tip (must NOT be URL-encoded)

  const subject = `Welcome to SignalBrief, ${firstName} — your brief is set for ${timeLabel}`;
  const result = await sendEmail(email, subject, html);
  console.log(`[welcome email] ${email} → ${result.ok ? "✅ sent via " + result.via : "❌ failed"}`);
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", c => body += c);
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

const server = http.createServer(async (req, res) => {
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

    if (!email || !name) return json(res, { error: "name and email required" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, { error: "invalid email address" }, 400);
    if (!topics || topics.length < 2) return json(res, { error: "select at least 2 topics" }, 400);

    // Rate limiting
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, email);
    if (rl.limited) return json(res, { error: rl.reason }, 429);

    // Sanitize telegram: strip leading @ characters
    const telegramClean = telegram ? String(telegram).replace(/^@+/, "").trim() : null;

    // Check existing
    const existing = allUsers().find(u => u.email === email);
    const chatId = existing?.chatId || `email-${Date.now()}`;

    const user = {
      ...(existing || {}),
      chatId,
      name,
      email,
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

    return json(res, { success: true, chatId });
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
    writeUser(existing.chatId, updated);
    return json(res, { success: true });
  }

  // GET|POST /api/unsubscribe — one-click unsubscribe (RFC 8058)
  // Supports: ?token=TOKEN (new) or ?email=... (legacy email links)
  // GET:  human-readable redirect to settings page with unsubscribed=1
  // POST: email client one-click (body: "List-Unsubscribe=One-Click")
  if (pathname === "/api/unsubscribe" && (req.method === "GET" || req.method === "POST")) {
    const tokenParam = url.searchParams.get("token") || "";
    const emailParam = url.searchParams.get("email") || "";
    let existing = null;

    if (tokenParam) {
      existing = findUserByToken(decodeURIComponent(tokenParam));
    } else if (emailParam) {
      const targetEmail = decodeURIComponent(emailParam).toLowerCase().trim();
      existing = allUsers().find(u => u.email.toLowerCase() === targetEmail);
    }

    if (!tokenParam && !emailParam) return json(res, { error: "token or email required" }, 400);

    if (existing) {
      writeUser(existing.chatId, { ...existing, status: "unsubscribed", email_unsubscribed_at: new Date().toISOString() });
      console.log(`[unsubscribe] ${existing.email}`);
    }
    // Always succeed (idempotent — if user not found, silently ok)
    if (req.method === "POST") return json(res, { success: true });
    // GET: redirect to settings confirmation page
    const redirectBase = process.env.BASE_URL || "https://getsignalbrief.com";
    const confirmUrl = existing?.token
      ? `${redirectBase}/settings?token=${existing.token}&unsubscribed=1`
      : `${redirectBase}/settings?unsubscribed=1`;
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

    const allowedDates = new Set(user.digest_dates || []);
    const files = fs.readdirSync(archiveDir)
      .filter(f => f.endsWith(".json"))
      .sort()
      .reverse(); // newest first

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

    // Token auth: verify user received this digest
    const token = url.searchParams.get("token");
    if (token) {
      const user = findUserByToken(token);
      if (!user) return json(res, { error: "invalid token" }, 401);
      if (!(user.digest_dates || []).includes(rawDate)) return json(res, { error: "not found" }, 404);
    }

    const file = path.join(__dirname, "../archive", `${rawDate}.json`);
    if (!fs.existsSync(file)) return json(res, { error: "not found" }, 404);
    try {
      return json(res, JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      return json(res, { error: "malformed archive file" }, 500);
    }
  }

  // POST /api/request-link — send magic access link to user's email
  if (pathname === "/api/request-link" && req.method === "POST") {
    const body = await readBody(req);
    const { email } = body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(res, { error: "valid email required" }, 400);
    }
    // Always return success (don't reveal whether email exists)
    const user = allUsers().find(u => u.email.toLowerCase() === email.toLowerCase());
    if (user && user.token) {
      sendMagicLinkEmail(user).catch(e => console.error("[magic link]", e));
    }
    return json(res, { success: true });
  }

  // GET /api/admin/stats — cost dashboard data (localhost only)
  if (pathname === "/api/admin/stats" && req.method === "GET") {
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
    const monthPrefix = now.toISOString().slice(0, 7); // "2026-03"
    const monthRuns = runs.filter(r => r.date.startsWith(monthPrefix));
    const sum = (arr, key) => arr.reduce((s, r) => s + (r[key] || 0), 0);

    // Per-user rollup across all runs
    const userMap = {};
    for (const r of runs) {
      for (const u of (r.per_user || [])) {
        if (!userMap[u.id]) userMap[u.id] = { id: u.id, runs: 0, total_cost: 0 };
        userMap[u.id].runs++;
        userMap[u.id].total_cost += r.total_cost_usd || 0;
      }
    }
    const perUser = Object.values(userMap)
      .map(u => ({ ...u, total_cost: parseFloat(u.total_cost.toFixed(5)) }))
      .sort((a, b) => b.total_cost - a.total_cost);

    // User roster for admin view
    // Convert UTC timestamps to ET dates (users signing up after 7 PM ET appear as next UTC day)
    const toETDate = iso => iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null;
    const roster = allUsers().map(u => ({
      name:           u.name || "",
      email:          u.email || "",
      status:         u.status || "active",
      joined:         toETDate(u.joined_at),
      digests:        u.digests_received || 0,
      last_digest:    toETDate(u.last_digest_at),
      telegram:       !!(u.chatId && !u.chatId.startsWith("email-")),
      topics:         (u.topics || []).length,
      bookmarks:      (u.bookmarks || []).length,
      adjustments:    Object.keys(u.topic_weights || {}).length,
    })).sort((a, b) => (b.digests - a.digests));

    return json(res, {
      summary: {
        all_time_cost:      parseFloat(sum(runs, "total_cost_usd").toFixed(4)),
        all_time_runs:      runs.length,
        month_cost:         parseFloat(sum(monthRuns, "total_cost_usd").toFixed(4)),
        month_runs:         monthRuns.length,
        month_on_demand:    monthRuns.filter(r => r.on_demand).length,
        month_users_served: sum(monthRuns, "users_served"),
        active_users:       allUsers().filter(u => u.status === "active").length,
      },
      runs: runs.slice(0, 30),
      per_user: perUser,
      roster,
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
  if (pathname === "/admin" || pathname === "/admin.html") {
    return serveFile(res, path.join(WEB_DIR, "admin.html"));
  }
  if (pathname === "/style.css") return serveFile(res, path.join(WEB_DIR, "style.css"));
  if (pathname === "/app.js") return serveFile(res, path.join(WEB_DIR, "app.js"));
  if (pathname === "/settings.js") return serveFile(res, path.join(WEB_DIR, "settings.js"));

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`SignalBrief web running on http://localhost:${PORT}`);
});
