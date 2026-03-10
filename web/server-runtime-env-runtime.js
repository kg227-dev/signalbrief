const path = require("path");

const WEB_DIR = __dirname;
const APP_ROOT = path.resolve(__dirname, "..");
const CANONICAL_HOST = "getsignalbrief.com";
const PUBLIC_HOSTS = new Set([CANONICAL_HOST, `www.${CANONICAL_HOST}`]);

function getServerPort() {
  const parsed = parseInt(process.env.PORT, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3003;
}

function getBaseUrl() {
  return process.env.BASE_URL || `http://localhost:${getServerPort()}`;
}

function getArchiveLegacyDeprecationDeadlineUtc() {
  return process.env.ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC || "2026-06-30T00:00:00Z";
}

function getSchedulerHeartbeatFile() {
  const raw = String(process.env.SCHEDULER_HEARTBEAT_FILE || "").trim();
  return raw ? path.resolve(raw) : path.join(__dirname, "../data/scheduler-heartbeat.json");
}

module.exports = {
  WEB_DIR,
  APP_ROOT,
  CANONICAL_HOST,
  PUBLIC_HOSTS,
  getServerPort,
  getBaseUrl,
  getArchiveLegacyDeprecationDeadlineUtc,
  getSchedulerHeartbeatFile,
};
