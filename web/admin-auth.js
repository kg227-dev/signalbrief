const crypto = require("crypto");

const ADMIN_SESSIONS = new Map(); // token -> { email, createdAt }
const ADMIN_SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

const LOGIN_RATE = new Map(); // ip -> { count, resetAt }
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW = 15 * 60 * 1000;

const ADMIN_LOCAL_BYPASS = process.env.ADMIN_LOCAL_BYPASS === "1";
const ADMIN_LOCAL_BYPASS_ALLOWLIST = new Set([
  "GET /admin",
  "GET /admin/sandbox",
  "GET /api/admin/check",
  "GET /api/admin/stats",
  "POST /api/admin/sandbox/estimate",
  "POST /api/admin/sandbox/run",
]);

function pruneAdminSessions(now = Date.now()) {
  for (const [token, session] of ADMIN_SESSIONS.entries()) {
    if (!session || (now - Number(session.createdAt || 0)) > ADMIN_SESSION_TTL) {
      ADMIN_SESSIONS.delete(token);
    }
  }
}

function extractAdminSessionToken(req) {
  const cookieHeader = req && req.headers ? req.headers.cookie || "" : "";
  const match = cookieHeader.match(/(?:^|;\s*)sb_admin=([a-f0-9]{64})/);
  return match ? match[1] : null;
}

function verifyAdminPassword(password, adminConfig = {}) {
  const { salt, passwordHash } = adminConfig || {};
  if (!salt || !passwordHash) return false;
  const hash = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(passwordHash, "hex"));
}

function createAdminSession(email) {
  pruneAdminSessions();
  const token = crypto.randomBytes(32).toString("hex");
  ADMIN_SESSIONS.set(token, { email, createdAt: Date.now() });
  return token;
}

function revokeAdminSession(token) {
  return ADMIN_SESSIONS.delete(String(token || ""));
}

function clearAdminSessionByRequest(req) {
  const token = extractAdminSessionToken(req);
  if (!token) return false;
  return revokeAdminSession(token);
}

function getAdminSession(req) {
  const token = extractAdminSessionToken(req);
  if (!token) return null;
  const session = ADMIN_SESSIONS.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > ADMIN_SESSION_TTL) return null;
  return session;
}

function validateAdminSession(req) {
  pruneAdminSessions();
  return !!getAdminSession(req);
}

function isLocalRequest(req) {
  const ip = req && req.socket ? req.socket.remoteAddress || "" : "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function getAdminActor(req) {
  const session = getAdminSession(req);
  if (session && session.email) return session.email;
  if (ADMIN_LOCAL_BYPASS && isLocalRequest(req)) return "local-bypass";
  return "unknown";
}

function isAdminAuthed(req) {
  if (validateAdminSession(req)) return true;
  if (!ADMIN_LOCAL_BYPASS) return false;
  if (!isLocalRequest(req)) return false;
  const method = String((req && req.method) || "GET").toUpperCase();
  const pathname = String((req && req.url) || "/").split("?")[0];
  return ADMIN_LOCAL_BYPASS_ALLOWLIST.has(`${method} ${pathname}`);
}

function checkLoginRate(ip) {
  const now = Date.now();
  for (const [k, v] of LOGIN_RATE.entries()) {
    if (v.resetAt < now) LOGIN_RATE.delete(k);
  }
  const key = String(ip || "");
  const entry = LOGIN_RATE.get(key) || { count: 0, resetAt: now + LOGIN_WINDOW };
  if (entry.resetAt < now) {
    entry.count = 0;
    entry.resetAt = now + LOGIN_WINDOW;
  }
  if (entry.count >= LOGIN_LIMIT) return true;
  entry.count += 1;
  LOGIN_RATE.set(key, entry);
  return false;
}

module.exports = {
  verifyAdminPassword,
  createAdminSession,
  clearAdminSessionByRequest,
  getAdminSession,
  getAdminActor,
  isAdminAuthed,
  checkLoginRate,
};
