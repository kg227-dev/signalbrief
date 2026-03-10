const fs = require("fs");
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

function getSchedulerControlFile() {
  const raw = String(process.env.SCHEDULER_CONTROL_FILE || "").trim();
  if (raw) return path.resolve(raw);
  const heartbeatFile = getSchedulerHeartbeatFile();
  return path.join(path.dirname(heartbeatFile), "scheduler-control.json");
}

function sanitizeAssetVersion(raw) {
  return String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 64);
}

function getWebAssetVersion() {
  const explicit = sanitizeAssetVersion(
    process.env.WEB_ASSET_VERSION
    || process.env.RELEASE_VERSION
    || process.env.SIGNALBRIEF_BUILD_ID
  );
  if (explicit) return explicit;

  const candidates = [
    "index.js",
    "index-form-runtime.js",
    "index-helpers-runtime.js",
    "preferences-runtime.js",
  ];
  let newestMtimeMs = 0;
  for (const fileName of candidates) {
    try {
      const fullPath = path.join(WEB_DIR, fileName);
      const stat = fs.statSync(fullPath);
      if (Number.isFinite(stat.mtimeMs) && stat.mtimeMs > newestMtimeMs) {
        newestMtimeMs = stat.mtimeMs;
      }
    } catch {
      // Ignore missing files; fallback handled below.
    }
  }

  if (newestMtimeMs > 0) {
    return `m${Math.floor(newestMtimeMs / 1000).toString(36)}`;
  }
  return "dev";
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
  getSchedulerControlFile,
  getWebAssetVersion,
};
