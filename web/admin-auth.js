const crypto = require("crypto");
const { isAdminLocalBypassEnabled } = require("./server-runtime-env-runtime");

const ADMIN_SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const READ_ONLY_METHODS = new Set(["GET", "HEAD"]);
const LOCAL_BYPASS_HTML_ROUTES = new Set([
  "/admin",
  "/admin/",
  "/admin.html",
  "/admin/user",
  "/admin/source-registry",
  "/admin/funnel",
]);
const LOCAL_BYPASS_API_ROUTES = new Set([
  "/api/admin/check",
  "/api/admin/stats",
  "/api/admin/user-by-email",
  "/api/admin/audit",
  "/api/admin/digest-audit",
  "/api/admin/funnel/dates",
  "/api/admin/funnel/summary",
  "/api/admin/funnel/topic",
]);

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW = 15 * 60 * 1000;

function createAdminAuthState() {
  return {
    sessions: new Map(), // token -> { email, createdAt }
    loginRate: new Map(), // ip -> { count, resetAt }
  };
}

let ADMIN_AUTH_STATE = createAdminAuthState();

function resetAdminAuthState() {
  ADMIN_AUTH_STATE = createAdminAuthState();
  return ADMIN_AUTH_STATE;
}

function pruneAdminSessions(now = Date.now()) {
  for (const [token, session] of ADMIN_AUTH_STATE.sessions.entries()) {
    if (!session || (now - Number(session.createdAt || 0)) > ADMIN_SESSION_TTL) {
      ADMIN_AUTH_STATE.sessions.delete(token);
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
  ADMIN_AUTH_STATE.sessions.set(token, { email, createdAt: Date.now() });
  return token;
}

function revokeAdminSession(token) {
  return ADMIN_AUTH_STATE.sessions.delete(String(token || ""));
}

function clearAdminSessionByRequest(req) {
  const token = extractAdminSessionToken(req);
  if (!token) return false;
  return revokeAdminSession(token);
}

function getAdminSession(req) {
  const token = extractAdminSessionToken(req);
  if (!token) return null;
  const session = ADMIN_AUTH_STATE.sessions.get(token);
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

function isAdminBypassRoute(req) {
  const method = String(req?.method || "GET").toUpperCase();
  if (!READ_ONLY_METHODS.has(method)) return false;
  const pathname = String((req && req.url) || "/").split("?")[0];
  if (LOCAL_BYPASS_HTML_ROUTES.has(pathname)) return true;
  return LOCAL_BYPASS_API_ROUTES.has(pathname);
}

function canUseAdminLocalBypass(req) {
  if (!isAdminLocalBypassEnabled()) return false;
  if (!isLocalRequest(req)) return false;
  return isAdminBypassRoute(req);
}

function getAdminActor(req) {
  const session = getAdminSession(req);
  if (session && session.email) return session.email;
  if (canUseAdminLocalBypass(req)) return "local-bypass";
  return "unknown";
}

function isAdminAuthed(req) {
  if (validateAdminSession(req)) return true;
  return canUseAdminLocalBypass(req);
}

function checkLoginRate(ip) {
  const now = Date.now();
  for (const [k, v] of ADMIN_AUTH_STATE.loginRate.entries()) {
    if (v.resetAt < now) ADMIN_AUTH_STATE.loginRate.delete(k);
  }
  const key = String(ip || "");
  const entry = ADMIN_AUTH_STATE.loginRate.get(key) || { count: 0, resetAt: now + LOGIN_WINDOW };
  if (entry.resetAt < now) {
    entry.count = 0;
    entry.resetAt = now + LOGIN_WINDOW;
  }
  if (entry.count >= LOGIN_LIMIT) return true;
  entry.count += 1;
  ADMIN_AUTH_STATE.loginRate.set(key, entry);
  return false;
}

module.exports = {
  createAdminAuthState,
  resetAdminAuthState,
  verifyAdminPassword,
  createAdminSession,
  clearAdminSessionByRequest,
  getAdminSession,
  getAdminActor,
  isAdminAuthed,
  checkLoginRate,
};
