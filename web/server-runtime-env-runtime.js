const fs = require("fs");
const path = require("path");
const { resolveSignalBriefRuntimePaths } = require("../src/runtime/runtime-state-paths-runtime");

const WEB_DIR = __dirname;
const APP_ROOT = path.resolve(__dirname, "..");
const CANONICAL_HOST = "getsignalbrief.com";
const PUBLIC_HOSTS = new Set([CANONICAL_HOST, `www.${CANONICAL_HOST}`]);

function normalizeOrigin(rawOrigin) {
  const value = String(rawOrigin || "").trim();
  if (!value) return "";
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return "";
  }
}

function getServerPort() {
  const parsed = parseInt(process.env.PORT, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3003;
}

function getBaseUrl() {
  return process.env.BASE_URL || `http://localhost:${getServerPort()}`;
}

function getTrustedCorsOrigins() {
  const configured = String(
    process.env.TRUSTED_CORS_ORIGINS
    || process.env.CORS_ALLOWED_ORIGINS
    || ""
  ).trim();
  if (configured) {
    return new Set(
      configured
        .split(",")
        .map((part) => normalizeOrigin(part))
        .filter(Boolean)
    );
  }

  const defaultOrigins = new Set([
    "https://getsignalbrief.com",
    "https://www.getsignalbrief.com",
    "http://localhost:3003",
    "http://127.0.0.1:3003",
  ]);
  const baseOrigin = normalizeOrigin(getBaseUrl());
  if (baseOrigin) defaultOrigins.add(baseOrigin);
  return defaultOrigins;
}

function getSchedulerHeartbeatFile() {
  return resolveSignalBriefRuntimePaths({
    appRoot: APP_ROOT,
    env: process.env,
  }).schedulerHeartbeatPath;
}

function getSchedulerControlFile() {
  return resolveSignalBriefRuntimePaths({
    appRoot: APP_ROOT,
    env: process.env,
  }).schedulerControlPath;
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
  getTrustedCorsOrigins,
  getSchedulerHeartbeatFile,
  getSchedulerControlFile,
  getWebAssetVersion,
};
