const fs = require("fs");
const path = require("path");
const {
  readEnvBoolean,
  readEnvNumber,
  readEnvString,
  getBaseUrl: getConfiguredBaseUrl,
  getNodeEnv,
  isProductionRuntime,
} = require("../src/runtime/config-provider");
const { resolveSignalBriefRuntimePaths } = require("../src/runtime/runtime-state-paths-runtime");

const WEB_DIR = __dirname;
const APP_ROOT = path.resolve(__dirname, "..");
const CANONICAL_HOST = "getsignalbrief.com";
const PUBLIC_HOSTS = new Set([CANONICAL_HOST, `www.${CANONICAL_HOST}`]);
const NON_PROD_RUNTIME_VALUES = new Set(["development", "dev", "test", "local", "ci"]);

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
  const parsed = readEnvNumber(["PORT"], 3003);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3003;
}

function getBaseUrl() {
  return getConfiguredBaseUrl(`http://localhost:${getServerPort()}`);
}

function getTrustedCorsOrigins() {
  const configured = readEnvString(["TRUSTED_CORS_ORIGINS", "CORS_ALLOWED_ORIGINS"], "");
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
  const explicit = sanitizeAssetVersion(readEnvString([
    "WEB_ASSET_VERSION",
    "RELEASE_VERSION",
    "SIGNALBRIEF_BUILD_ID",
  ], ""));
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

function isDebugWebServerEnabled() {
  return readEnvBoolean(["DEBUG_WEB_SERVER"], false);
}

function normalizeEnvName(value) {
  return String(value || "").toLowerCase().trim();
}

function resolveRuntimeEnvName() {
  return (
    normalizeEnvName(getNodeEnv())
    || normalizeEnvName(readEnvString(["SIGNALBRIEF_ENV", "DEPLOY_ENV", "APP_ENV"], ""))
  );
}

function isExplicitNonProductionRuntime() {
  return NON_PROD_RUNTIME_VALUES.has(resolveRuntimeEnvName());
}

function isAdminLocalBypassEnabled() {
  return readEnvBoolean(["ADMIN_LOCAL_BYPASS"], false)
    && isExplicitNonProductionRuntime();
}

function isAllowExampleSignupsEnabled() {
  return readEnvBoolean(["ALLOW_EXAMPLE_SIGNUPS"], false) || !isProductionRuntime();
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
  isDebugWebServerEnabled,
  resolveRuntimeEnvName,
  isExplicitNonProductionRuntime,
  isAdminLocalBypassEnabled,
  isAllowExampleSignupsEnabled,
  getNodeEnv,
};
