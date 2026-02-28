#!/usr/bin/env node
/**
 * SignalBrief Web — server.js
 * Serves onboarding + settings UI, proxies store reads/writes.
 * Port 3003
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { readUser, writeUser, allUsers } = require("../store");

const PORT = 3003;
const WEB_DIR = __dirname;
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "../config.json"), "utf8"));

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

const DEFAULT_TOPICS = [
  "AI×TECH", "HEALTHCARE", "FINANCIAL SERVICES", "PE×M&A",
  "ENERGY", "CONSUMER", "POLICY×REGULATORY", "STRATEGY",
  "SUSTAINABILITY", "REAL ESTATE"
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  // ── API routes ──────────────────────────────────────────────────────────────

  // GET /api/topics — default topic list
  if (pathname === "/api/topics" && req.method === "GET") {
    return json(res, { topics: DEFAULT_TOPICS });
  }

  // GET /api/user?email=... — load user by email
  if (pathname === "/api/user" && req.method === "GET") {
    const email = url.searchParams.get("email");
    if (!email) return json(res, { error: "email required" }, 400);
    const users = allUsers();
    const user = users.find(u => u.email === email);
    if (!user) return json(res, { error: "not found" }, 404);
    return json(res, user);
  }

  // POST /api/signup — new user onboarding
  if (pathname === "/api/signup" && req.method === "POST") {
    const body = await readBody(req);
    const { name, email, telegram, topics, depth, delivery_time, frequency, items_per_digest } = body;

    if (!email || !name) return json(res, { error: "name and email required" }, 400);
    if (!topics || topics.length < 2) return json(res, { error: "select at least 2 topics" }, 400);

    // Check existing
    const existing = allUsers().find(u => u.email === email);
    const chatId = existing?.chatId || `email-${Date.now()}`;

    const user = {
      ...(existing || {}),
      chatId,
      name,
      email,
      telegram: telegram || null,
      topics,
      status: "active",
      joined_at: existing?.joined_at || new Date().toISOString(),
      last_updated: new Date().toISOString(),
      digests_received: existing?.digests_received || 0,
      bookmarks: existing?.bookmarks || [],
      topic_weights: existing?.topic_weights || {},
      custom_topics: topics.filter(t => !DEFAULT_TOPICS.includes(t)),
      last_digest_items: existing?.last_digest_items || [],
      preferences: {
        depth: depth || "full",
        delivery_time: delivery_time || "07:00",
        frequency: frequency || "weekdays",
        items_per_digest: parseInt(items_per_digest) || 7,
        timezone: "America/New_York",
        email_enabled: true,
        telegram_enabled: !!telegram,
      },
    };

    writeUser(chatId, user);
    console.log(`[signup] ${name} <${email}>`);
    return json(res, { success: true, chatId });
  }

  // POST /api/settings — update existing user
  if (pathname === "/api/settings" && req.method === "POST") {
    const body = await readBody(req);
    const { email } = body;
    if (!email) return json(res, { error: "email required" }, 400);

    const users = allUsers();
    const existing = users.find(u => u.email === email);
    if (!existing) return json(res, { error: "user not found" }, 404);

    const updated = {
      ...existing,
      ...body,
      last_updated: new Date().toISOString(),
      preferences: { ...existing.preferences, ...body.preferences },
    };
    writeUser(existing.chatId, updated);
    return json(res, { success: true });
  }

  // GET /api/archive — list of all past digests
  if (pathname === "/api/archive" && req.method === "GET") {
    const archiveDir = path.join(__dirname, "../archive");
    if (!fs.existsSync(archiveDir)) return json(res, { digests: [] });
    const files = fs.readdirSync(archiveDir)
      .filter(f => f.endsWith(".json"))
      .sort()
      .reverse(); // newest first
    const digests = files.map(f => {
      const d = JSON.parse(fs.readFileSync(path.join(archiveDir, f), "utf8"));
      return { date: d.date, dateStr: d.dateStr, quickScan: d.quickScan, itemCount: d.items.length };
    });
    return json(res, { digests });
  }

  // GET /api/archive/:date — full digest for a specific date
  if (pathname.startsWith("/api/archive/") && req.method === "GET") {
    const date = pathname.replace("/api/archive/", "");
    const file = path.join(__dirname, "../archive", `${date}.json`);
    if (!fs.existsSync(file)) return json(res, { error: "not found" }, 404);
    return json(res, JSON.parse(fs.readFileSync(file, "utf8")));
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
  if (pathname === "/style.css") return serveFile(res, path.join(WEB_DIR, "style.css"));
  if (pathname === "/app.js") return serveFile(res, path.join(WEB_DIR, "app.js"));
  if (pathname === "/settings.js") return serveFile(res, path.join(WEB_DIR, "settings.js"));

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`SignalBrief web running on http://localhost:${PORT}`);
});
